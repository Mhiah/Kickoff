// A brand's group with a prize: it has an end, its leaderboard counts only its own matches, its top
// player when it ends is the winner, and a payment is recorded only if it went to the wallet the
// winner linked. Kickoff never holds or sends the prize.
import { test } from "node:test";
import assert from "node:assert/strict";

import { basketballResult, encodePick, sealPick, toHex, walletLinkText } from "../../engine/src/index.js";
import { testWallet } from "../../engine/test/test-wallet.js";
import { MAX_WINNERS, PRIZE_TOKENS } from "../src/kickoff.js";
import { device, serverWithFixtures } from "./helpers.js";

const DAY = 24 * 3600;
const TX = `0x${"ab".repeat(32)}`;
const table = async (s, who, group = null) => (await s.post(who, "/api/me/table", { group })).body;
const names = (board) => board.rows.map((r) => `${r.place} ${r.name} ${r.points}`);
const seen = async (s, code) => (await s.get(`/api/groups/${code}`)).body;
const look = async (s, code) => (await s.robot("/api/admin/prize/look", { code })).body;

/** A brand's group that plays basketball only and ends in three days, with three players in it. */
async function season() {
  const s = await serverWithFixtures();
  const made = await s.robot("/api/admin/brand-groups", { name: "Hoops Week", brand: "OKX", prize: "100 USDT for 1st place", plays: ["nba"], ends: s.clock.now + 3 * DAY });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const g = made.body;
  const [ada, bola, chidi] = [await device(), await device(), await device()];
  for (const [who, name] of [[ada, "Ada"], [bola, "Bola"], [chidi, "Chidi"]]) {
    s.clock.now += 60;
    assert.equal((await s.post(who, `/api/groups/${g.code}/join`, { playerName: name })).status, 200);
  }
  const pick = async (who, fixture, what) => {
    const sealed = await sealPick({ league: s.kickoff.league, match: fixture.id, sport: fixture.sport, pick: what, player: who.player });
    assert.equal((await s.post(who, "/api/picks", { match: fixture.id, fingerprint: toHex(sealed.fingerprint) })).status, 200);
    return [who, { match: fixture.id, pickByte: sealed.pickByte, salt: toHex(sealed.salt) }];
  };
  // Football is not one of the group's competitions: Ada's 3 points there do not count in it.
  const sealed = [
    await pick(ada, s.f.football, { home: 2, away: 1 }),
    await pick(ada, s.f.basketball, { winner: "home", band: "D" }), // the winner only: 1
    await pick(bola, s.f.basketball, { winner: "home", band: "B" }), // spot on: 3
    await pick(chidi, s.f.basketball, { winner: "away", band: "A" }), // wrong: 0
  ];
  const finish = async (fixture, score, res) => {
    await s.robot("/api/admin/locks", { locks: [{ match: fixture.id, state: "locked" }] });
    await s.robot("/api/admin/fixtures", { fixtures: [{ ...fixture, state: "final", score, resultByte: encodePick(fixture.sport, res) }] });
  };
  const open = async () => {
    s.clock.now = Math.max(s.clock.now, s.f.basketball.kickoff + 3 * 3600);
    for (const [who, p] of sealed) assert.equal((await s.post(who, "/api/opened", p)).status, 200);
  };
  return { s, g, ada, bola, chidi, finish, open, football: () => finish(s.f.football, "2 – 1", { home: 2, away: 1 }), basketball: () => finish(s.f.basketball, "104 – 96", basketballResult({ home: 104, away: 96 })) };
}
const link = (s, who, wallet) => {
  const at = s.clock.now;
  return s.post(who, "/api/wallet", { wallet: wallet.address, linkAt: at, signature: wallet.sign(walletLinkText({ player: who.player, wallet: wallet.address, at })) });
};

test("a brand's group can be given an end, which has to be still to come", async () => {
  const s = await serverWithFixtures();
  const ask = { name: "Hoops Week", brand: "OKX", plays: ["nba"] };
  for (const ends of [s.clock.now, s.clock.now - 1, "tomorrow", 1.5]) assert.equal((await s.robot("/api/admin/brand-groups", { ...ask, ends })).status, 400);
  const g = (await s.robot("/api/admin/brand-groups", { ...ask, ends: s.clock.now + DAY })).body;
  assert.deepEqual([g.ends, g.ended, g.decided, g.winners], [s.clock.now + DAY, false, false, []]);
  // One with no end says nothing about a prize at all.
  const plain = (await s.robot("/api/admin/brand-groups", ask)).body;
  for (const key of ["ends", "ended", "decided", "winners", "share"]) assert.equal(key in plain, false);
});

test("its leaderboard counts only its own matches: its competitions, from its start to its end", async () => {
  const { s, g, ada, open, football, basketball } = await season();
  await open();
  await football();
  await basketball();
  const t = await table(s, ada, g.code);
  // Among everyone Ada leads with 4. In the group only the basketball counts: Bola's 3 beats her 1.
  assert.deepEqual(names(t.everyone), ["1 Ada 4", "2 Bola 3", "3 Chidi 0"]);
  assert.deepEqual(names(t.group), ["1 Bola 3", "2 Ada 1", "3 Chidi 0"]);
  assert.deepEqual([t.group.rows[1].threes, t.group.rows[1].ones], [0, 1]);
});

test("the winner is fixed once the group has ended and its last match has a result, and not before", async () => {
  const { s, g, bola, open, football, basketball } = await season();
  await open();
  await football();
  // Still running.
  assert.deepEqual([(await seen(s, g.code)).ended, (await seen(s, g.code)).decided], [false, false]);
  // Ended, but the basketball game it counts has no result yet.
  s.clock.now = g.ends + 60;
  let now = await seen(s, g.code);
  assert.deepEqual([now.ended, now.decided, now.winners], [true, false, []]);
  await basketball();
  now = await seen(s, g.code);
  // A prize that is a line of words has one winner.
  assert.deepEqual([now.decided, now.winners], [true, [{ place: 1, name: "Bola", points: 3, you: false, linked: false, paid: null }]]);
  // Bola is told it is her. Nobody is told which devices or which wallet are the winner's.
  const hers = (await s.post(bola, "/api/me/groups", {})).body.groups[0];
  assert.equal(hers.winners[0].you, true);
  assert.ok(!JSON.stringify(now).includes(bola.player), "what anyone can see does not say which device the winner plays on");
  for (const hidden of ["final", "paid", "claims", "money", "toPay", "organiser"]) assert.ok(!(hidden in now));
  // Nobody new joins a group that has ended.
  const late = await s.post(await device(), `/api/groups/${g.code}/join`, { playerName: "Late" });
  assert.deepEqual([late.status, late.body.error], [409, "This group has ended."]);
});

test("a winner, once fixed, stays the winner whatever happens after", async () => {
  const { s, g, ada, open, basketball } = await season();
  await open();
  s.clock.now = g.ends + 60;
  await basketball();
  assert.equal((await seen(s, g.code)).winners[0].name, "Bola");
  // Ada changes her name and time goes by. The group's winner does not move.
  await s.post(ada, `/api/groups/${g.code}/join`, { playerName: "Ada the Great" });
  s.clock.now += 10 * DAY;
  assert.deepEqual((await seen(s, g.code)).winners, [{ place: 1, name: "Bola", points: 3, you: false, linked: false, paid: null }]);
});

test("CHEAT: a payment is recorded only if it went to the wallet the winner linked, and only by Kickoff", async () => {
  const { s, g, bola, open, basketball } = await season();
  const wallet = testWallet("bola");
  const pay = (body, key) => s.robot("/api/admin/prize", { code: g.code, tx: TX, to: wallet.address, what: "100 USDT", ...body }, key);
  await open();
  // Not ended.
  assert.deepEqual([(await pay()).status, (await pay()).body.error], [409, "This group has not ended yet."]);
  s.clock.now = g.ends + 60;
  assert.match((await pay()).body.error, /some of its matches have no result yet/);
  await basketball();
  // The winner has linked no wallet: there is nowhere it could have been paid.
  assert.equal((await look(s, g.code)).winners[0].wallet, null);
  assert.deepEqual([(await pay()).status, (await pay()).body.error], [409, "Bola has not linked a wallet yet, so there is nowhere the prize could have been paid."]);
  assert.equal((await link(s, bola, wallet)).status, 200);
  assert.deepEqual((await look(s, g.code)).winners, [{ place: 1, name: "Bola", points: 3, wallet: wallet.address.toLowerCase(), paid: null }]);
  assert.equal((await seen(s, g.code)).winners[0].linked, true);

  // To anybody else's wallet, with a made-up transaction, or without Kickoff's key: refused.
  assert.equal((await pay({ to: testWallet("mallory").address })).body.error, "That payment did not go to the wallet Bola linked.");
  for (const tx of ["0x1234", "", null, `0x${"zz".repeat(32)}`]) assert.equal((await pay({ tx })).status, 400);
  assert.equal((await pay({ place: 2 })).body.error, "This group has no winner in that place.");
  assert.equal((await pay({}, "not-the-key")).status, 403);
  assert.equal((await s.post(bola, "/api/admin/prize", { code: g.code, tx: TX, to: wallet.address, what: "100 USDT" })).status, 403);
  for (const path of ["/api/admin/prize/look", "/api/admin/prize/claims", "/api/admin/prize/refuse"]) assert.equal((await s.robot(path, { code: g.code }, "not-the-key")).status, 403);
  assert.equal((await seen(s, g.code)).winners[0].paid, null);

  // The real one is recorded, and everyone sees it. The wallet itself is not shown to anyone.
  const paid = await pay();
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const now = await seen(s, g.code);
  assert.deepEqual(now.winners[0].paid, { tx: TX, what: "100 USDT" });
  assert.ok(!JSON.stringify(now).toLowerCase().includes(wallet.address.toLowerCase().slice(2, 20)));
  // Recording the same payment again changes nothing. Another payment cannot take its place.
  assert.equal((await pay()).status, 200);
  assert.equal((await pay({ tx: `0x${"cd".repeat(32)}` })).body.error, "A payment is already recorded for that winner.");
  assert.equal((await seen(s, g.code)).winners[0].paid.tx, TX);
});

test("nobody wins a group in which nobody scored, and only a brand's group with an end has a prize to record", async () => {
  const s = await serverWithFixtures();
  const empty = (await s.robot("/api/admin/brand-groups", { name: "Quiet Week", brand: "OKX", plays: ["nba"], ends: s.clock.now + DAY })).body;
  const ada = await device();
  await s.post(ada, `/api/groups/${empty.code}/join`, { playerName: "Ada" });
  const endless = (await s.robot("/api/admin/brand-groups", { name: "No End", brand: "OKX" })).body;
  const friends = (await s.post(ada, "/api/groups", { name: "Friends", playerName: "Ada" })).body;
  s.clock.now = empty.ends + 60;
  // Its one match in that time was never played out: once it is called off, the group is decided, with no winner.
  await s.robot("/api/admin/fixtures", { fixtures: [{ ...s.f.basketball, state: "void", note: "Postponed" }] });
  const now = await seen(s, empty.code);
  assert.deepEqual([now.decided, now.winners], [true, []]);
  assert.equal((await s.robot("/api/admin/prize", { code: empty.code, tx: TX, to: testWallet("ada").address, what: "100 USDT" })).body.error, "Nobody scored in this group, so it has no winner.");
  assert.match((await s.robot("/api/admin/prize/look", { code: endless.code })).body.error, /has no end/);
  assert.match((await s.robot("/api/admin/prize/look", { code: friends.code })).body.error, /group of friends/);
  assert.equal((await s.robot("/api/admin/prize/look", { code: "NOSUCH-0000" })).status, 404);
});

// ---- A brand's group started from the website, with a prize that is an amount of USDT or USDC

const USDT = PRIZE_TOKENS.USDT.address;
/** Okx starts "Hoops Cup" on the website: 300 USDT shared by the top 2, ending in three days. Ada, Bola and Chidi join and play. */
async function cup({ winners = 2, amount = 300, token = "USDT" } = {}) {
  const s = await serverWithFixtures();
  const okx = await device();
  const started = await s.post(okx, "/api/groups", { name: "Hoops Cup", playerName: "OKX team", plays: ["nba"], brand: { name: "OKX", amount, winners, token, ends: s.clock.now + 3 * DAY } });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const g = started.body;
  const [ada, bola, chidi] = [await device(), await device(), await device()];
  for (const [who, name] of [[ada, "Ada"], [bola, "Bola"], [chidi, "Chidi"]]) {
    s.clock.now += 60;
    assert.equal((await s.post(who, `/api/groups/${g.code}/join`, { playerName: name })).status, 200);
  }
  const sealed = [];
  for (const [who, what] of [[ada, { winner: "home", band: "D" }], [bola, { winner: "home", band: "B" }], [chidi, { winner: "away", band: "A" }]]) {
    const p = await sealPick({ league: s.kickoff.league, match: s.f.basketball.id, sport: s.f.basketball.sport, pick: what, player: who.player });
    await s.post(who, "/api/picks", { match: s.f.basketball.id, fingerprint: toHex(p.fingerprint) });
    sealed.push([who, { match: s.f.basketball.id, pickByte: p.pickByte, salt: toHex(p.salt) }]);
  }
  const finish = async () => {
    s.clock.now = Math.max(s.clock.now, s.f.basketball.kickoff + 3 * 3600);
    for (const [who, p] of sealed) await s.post(who, "/api/opened", p);
    await s.robot("/api/admin/locks", { locks: [{ match: s.f.basketball.id, state: "locked" }] });
    await s.robot("/api/admin/fixtures", { fixtures: [{ ...s.f.basketball, state: "final", score: "104 – 96", resultByte: encodePick(s.f.basketball.sport, basketballResult({ home: 104, away: 96 })) }] });
    s.clock.now = Math.max(s.clock.now, g.ends + 60);
  };
  const as = async (who) => (await s.post(who, "/api/me/groups", {})).body.groups.find((x) => x.code === g.code);
  return { s, g, okx, ada, bola, chidi, finish, as };
}

test("anyone can start a group for a brand on the website: it says who runs it, what the prize is and when it ends", async () => {
  const { s, g, okx, as } = await cup();
  assert.deepEqual(
    { code: g.code, name: g.name, brand: g.brand, prize: g.prize, plays: g.plays, startedBy: g.startedBy, players: g.players, share: g.share, winners: g.winners, organiser: g.organiser, toPay: g.toPay },
    { code: g.code, name: "Hoops Cup", brand: "OKX", prize: "300 USDT shared by the top 2", plays: ["nba"], startedBy: okx.player, players: 1, share: "150 USDT", winners: [], organiser: true, toPay: [] },
  );
  // Whoever started it is in it, under their own name, and it holds far more than a group of friends.
  assert.equal(g.members[0].name, "OKX team");
  assert.equal((await as(okx)).players, 4);
  // One winner reads differently, and a share that does not divide evenly is cut to the token's last place.
  assert.equal((await cup({ winners: 1, amount: 100 })).g.prize, "100 USDT for 1st place");
  const thirds = (await cup({ winners: 3, amount: 100, token: "USDC" })).g;
  assert.deepEqual([thirds.prize, thirds.share], ["100 USDC shared by the top 3", "33.333333 USDC"]);
  assert.equal((await cup({ amount: 25000 })).g.prize, "25,000 USDT shared by the top 2");
  // Whoever pays is told exactly which token: the real one, by its address.
  assert.deepEqual(g.payIn, { symbol: "USDT", address: PRIZE_TOKENS.USDT.address });
  // Only the person who started it is told they are the one paying.
  const other = await s.get(`/api/groups/${g.code}`);
  assert.ok(!("organiser" in other.body) && !("toPay" in other.body));
});

test("CHEAT: a brand's group needs a real prize, a real token, a sensible number of winners and an end still to come", async () => {
  const s = await serverWithFixtures();
  const who = await device();
  const good = { name: "OKX", amount: 300, winners: 2, token: "USDT", ends: s.clock.now + 3 * DAY };
  const start = (brand) => s.post(who, "/api/groups", { name: "Hoops Cup", playerName: "OKX team", brand });
  const refused = async (change, words) => {
    const r = await start({ ...good, ...change });
    assert.equal(r.status, 400, JSON.stringify(change));
    if (words) assert.match(r.body.error, words);
  };
  await refused({ token: "DOGE" }, /paid in USDT or USDC/);
  await refused({ token: "__proto__" });
  for (const amount of [0, -5, 1.5, "300", 1_000_001, null]) await refused({ amount }, /whole number, from 1 to 1,000,000/);
  for (const winners of [0, MAX_WINNERS + 1, 2.5, "2"]) await refused({ winners }, /between 1 and 10 winners/);
  for (const ends of [s.clock.now, s.clock.now - DAY, null, "soon"]) await refused({ ends }, /last day has to be still to come/);
  await refused({ ends: s.clock.now + 400 * DAY }, /at most a year away/);
  await refused({ name: "" });
  assert.equal((await start(good)).status, 200);
});

test("the top players share the prize: each is a winner, in order, and only those who scored", async () => {
  const { s, g, okx, ada, bola, finish, as } = await cup({ winners: 3 });
  await finish();
  const now = await as(okx);
  // Three were to share it, but only two scored. Chidi, with nothing, is not a winner.
  assert.deepEqual(now.winners.map((w) => `${w.place} ${w.name} ${w.points}`), ["1 Bola 3", "2 Ada 1"]);
  assert.equal(now.share, "100 USDT");
  assert.equal((await as(bola)).winners[0].you, true);
  assert.deepEqual((await as(ada)).winners.map((w) => w.you), [false, true]);
  // Whoever started the group is told who to pay and how much. Where, once each has linked a wallet.
  assert.deepEqual(now.toPay, [
    { place: 1, name: "Bola", wallet: null, what: "100 USDT", checking: null, refused: null },
    { place: 2, name: "Ada", wallet: null, what: "100 USDT", checking: null, refused: null },
  ]);
  await link(s, bola, testWallet("bola"));
  assert.equal((await as(okx)).toPay[0].wallet, testWallet("bola").address.toLowerCase());
  // Nobody else is told any of it.
  for (const who of [ada, bola]) assert.ok(!("toPay" in (await as(who))));
  assert.ok(!JSON.stringify(await seen(s, g.code)).toLowerCase().includes(testWallet("bola").address.toLowerCase().slice(2, 22)));
});

test("whoever started the group says they paid; the robot reads the payment; only then is it shown as paid", async () => {
  const { s, g, okx, ada, bola, finish, as } = await cup();
  await finish();
  const wallet = testWallet("bola");
  const said = (who, body) => s.post(who, `/api/groups/${g.code}/paid`, body);
  // Nobody but the starter can say so, and not before the winner has a wallet.
  assert.equal((await said(ada, { place: 1, tx: TX })).status, 403);
  assert.match((await said(okx, { place: 1, tx: TX })).body.error, /Bola has not linked a wallet yet/);
  await link(s, bola, wallet);
  for (const tx of ["", "0x12", "paid!", null]) assert.equal((await said(okx, { place: 1, tx })).status, 400);
  assert.equal((await said(okx, { place: 7, tx: TX })).status, 409);
  const claimed = await said(okx, { place: 1, tx: TX.toUpperCase().replace("0X", "0x") });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  // It is being checked: not paid yet, for anyone.
  assert.equal(claimed.body.toPay[0].checking, TX);
  assert.equal((await seen(s, g.code)).winners[0].paid, null);

  // What the robot is handed to check: where it must have gone, in which token, and at least how much.
  const waiting = (await s.robot("/api/admin/prize/claims", {})).body.claims;
  assert.deepEqual(waiting, [{ code: g.code, place: 1, tx: TX, at: s.clock.now, decidedAt: g.ends + 60, name: "Bola", wallet: wallet.address.toLowerCase(), token: USDT, raw: "150000000", what: "150 USDT" }]);

  // The robot read it on X Layer and it is right: recorded, and nothing is left waiting.
  const done = await s.robot("/api/admin/prize", { code: g.code, place: 1, tx: TX, to: wallet.address, token: USDT, raw: "150000000" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual((await seen(s, g.code)).winners.map((w) => w.paid), [{ tx: TX, what: "150 USDT" }, null]);
  assert.deepEqual((await s.robot("/api/admin/prize/claims", {})).body.claims, []);
  // The starter now has one winner left to pay.
  assert.deepEqual((await as(okx)).toPay.map((w) => w.name), ["Ada"]);
  // The same payment cannot be used again, for this winner's place or another's.
  await link(s, ada, testWallet("ada"));
  assert.match((await said(okx, { place: 2, tx: TX })).body.error, /already recorded for a prize/);
});

test("CHEAT: the wrong token, too little, or a payment to somebody else is refused, and the starter is told why", async () => {
  const { s, g, okx, bola, finish, as } = await cup();
  await finish();
  const wallet = testWallet("bola");
  await link(s, bola, wallet);
  const record = (body) => s.robot("/api/admin/prize", { code: g.code, place: 1, tx: TX, to: wallet.address, token: USDT, raw: "150000000", ...body });
  // A token that only calls itself USDT, the old wrapped USDT, USDC when USDT was promised, or no token at all.
  for (const token of [`0x${"aa".repeat(20)}`, "0x1e4a5963abfd975d8c9021ce480b42188849d41d", PRIZE_TOKENS.USDC.address, null]) {
    assert.equal((await record({ token })).body.error, "That payment was not in the token this prize is paid in (USDT).");
  }
  for (const raw of ["149999999", "0", "1", null, "lots"]) assert.equal((await record({ raw })).body.error, "That payment is less than Bola's share of 150 USDT.");
  assert.equal((await record({ to: testWallet("mallory").address })).body.error, "That payment did not go to the wallet Bola linked.");
  assert.equal((await seen(s, g.code)).winners[0].paid, null);

  // The robot read a payment the starter gave and found it short: the starter is told, and can give another.
  await s.post(okx, `/api/groups/${g.code}/paid`, { place: 1, tx: TX });
  assert.deepEqual((await s.robot("/api/admin/prize/refuse", { code: g.code, place: 1, tx: TX, reason: "It paid 15 USDT, less than the 150 USDT share." })).body, { refused: true });
  let now = await as(okx);
  assert.deepEqual([now.toPay[0].checking, now.toPay[0].refused], [null, "It paid 15 USDT, less than the 150 USDT share."]);
  assert.deepEqual((await s.robot("/api/admin/prize/claims", {})).body.claims, []);
  const second = `0x${"cd".repeat(32)}`;
  await s.post(okx, `/api/groups/${g.code}/paid`, { place: 1, tx: second });
  now = await as(okx);
  assert.deepEqual([now.toPay[0].checking, now.toPay[0].refused], [second, null]);
  // More than the share is fine, and is shown as what was paid.
  assert.equal((await record({ tx: second, raw: "200000000" })).status, 200);
  assert.deepEqual((await seen(s, g.code)).winners[0].paid, { tx: second, what: "200 USDT" });
});
