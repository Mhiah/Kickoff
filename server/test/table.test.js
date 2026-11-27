// Names, points and the two tables: everyone, and a group.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BASKETBALL, BASKETBALL_HEX, FOOTBALL, FOOTBALL_HEX, TENNIS_HEX, basketballResult, buildBundle, buildTable, encodePick, fromHex, loadCircuits, parseOpenings, sealPick, toHex,
  walletLinkText, withOpenings,
} from "../../engine/src/index.js";
import { testWallet } from "../../engine/test/test-wallet.js";
import { TABLE_TOP, WEEK, weekStart } from "../src/kickoff.js";
import { RedisStore } from "../src/redis-store.js";
import { FAKE_TOKEN, FAKE_URL, fakeRedis } from "./fake-redis.js";
import { LEAGUE, device, server, serverWithFixtures } from "./helpers.js";

const table = async (s, who, group = null) => (await s.post(who, "/api/me/table", { group })).body;
const names = (board) => board.rows.map((r) => `${r.place} ${r.name} ${r.points}`);

/** Start or join so as to have a name. Each call a minute after the last, so who joined first is clear. */
async function join(s, who, name, code = null) {
  s.clock.now += 60;
  const r = code ? await s.post(who, `/api/groups/${code}/join`, { playerName: name }) : await s.post(who, "/api/groups", { name: `${name}'s lot`, playerName: name });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

/** A device seals a pick and sends its fingerprint. Returns what it needs to open it later. */
async function pick(s, who, fixture, what) {
  const sealed = await sealPick({ league: LEAGUE, match: fixture.id, sport: fixture.sport, pick: what, player: who.player });
  const sent = await s.post(who, "/api/picks", { match: fixture.id, fingerprint: toHex(sealed.fingerprint) });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  return { match: fixture.id, pickByte: sealed.pickByte, salt: toHex(sealed.salt) };
}
const open = async (s, who, sealed) => assert.equal((await s.post(who, "/api/opened", sealed)).status, 200);
/** The robot says how locking a match's picks on X Layer went. */
const lock = (s, fixture, state = "locked") => s.robot("/api/admin/locks", { locks: [{ match: fixture.id, state }] });
/** The robot records a result, as it does from the sports feed. Only the result: nothing about the lock. */
const resultOnly = (s, fixture, score, res) => s.robot("/api/admin/fixtures", { fixtures: [{ ...fixture, state: "final", score, resultByte: encodePick(fixture.sport, res) }] });
/** A match that went as it should: locked on X Layer before kickoff, then its result. */
const result = async (s, fixture, score, res) => {
  await lock(s, fixture);
  return resultOnly(s, fixture, score, res);
};

test("the server's copies of the scoring circuits are the published ones", () => {
  const file = (name) => readFileSync(new URL(`../../circuits/out/${name}.hex`, import.meta.url), "utf8").trim();
  assert.equal(FOOTBALL_HEX, file("football"));
  assert.equal(BASKETBALL_HEX, file("basketball"));
  assert.equal(TENNIS_HEX, file("tennis"));
});

test("nobody has the same name: across groups, and whatever the capitals", async () => {
  const s = server();
  const [ada, other, third] = [await device(), await device(), await device()];
  const group = await join(s, ada, "Ada");
  // In the same group, in another group, and in capitals.
  let r = await s.post(other, `/api/groups/${group.code}/join`, { playerName: "Ada" });
  assert.equal(r.status, 409);
  r = await s.post(other, "/api/groups", { name: "Elsewhere", playerName: "ADA" });
  assert.deepEqual([r.status, r.body.error], [409, "That name is taken. Choose another."]);
  assert.deepEqual((await s.post(other, "/api/me/groups")).body.groups, [], "and no group was started for a name that was refused");
  await join(s, other, "Ada B");
  // A player keeps their own name wherever they go.
  const elsewhere = await join(s, ada, "Ada");
  assert.equal(elsewhere.members[0].name, "Ada");
  await join(s, third, "Chidi", group.code);
});

test("a player has one name everywhere, and changing it frees the old one", async () => {
  const s = server();
  const [ada, bola] = [await device(), await device()];
  const first = await join(s, ada, "Ada");
  const second = await join(s, ada, "Ada");
  // Giving a new name when joining changes it in every group.
  await join(s, bola, "Bola", first.code);
  const renamed = await join(s, ada, "Ada the Great", first.code);
  assert.deepEqual(renamed.members.map((m) => m.name), ["Ada the Great", "Bola"]);
  assert.equal((await s.get(`/api/groups/${second.code}`)).body.members[0].name, "Ada the Great");
  assert.deepEqual(names((await table(s, bola)).everyone), ["1 Ada the Great 0", "2 Bola 0"]);
  // Only a change of capitals is still her own name.
  assert.equal((await s.post(ada, `/api/groups/${first.code}/join`, { playerName: "ADA THE GREAT" })).status, 200);
  // The old name is free for somebody else.
  await join(s, await device(), "Ada");
});

test("everyone is numbered from 1 in the order they joined, until points say otherwise", async () => {
  const s = await serverWithFixtures();
  const [mya, jerkson, kemi] = [await device(), await device(), await device()];
  const group = await join(s, mya, "mya");

  // The first person is 1st of 1.
  let t = await table(s, mya, group.code);
  assert.deepEqual(names(t.everyone), ["1 mya 0"]);
  assert.deepEqual(t.you, { place: 1, points: 0, threes: 0, ones: 0, wrong: 0 });
  assert.deepEqual(t.played, []);
  assert.deepEqual(t.everyone.rows[0], { place: 1, name: "mya", threes: 0, ones: 0, points: 0, you: true });

  // Whoever joins next is 2nd, then 3rd.
  await join(s, jerkson, "Jerkson", group.code);
  await join(s, kemi, "Kemi");
  t = await table(s, jerkson, group.code);
  assert.deepEqual(names(t.everyone), ["1 mya 0", "2 Jerkson 0", "3 Kemi 0"]);
  assert.equal(t.everyone.players, 3);
  assert.deepEqual(t.you.place, 2);
  assert.deepEqual(names(t.group), ["1 mya 0", "2 Jerkson 0"], "the group's table has only the group in it");
  assert.equal(t.group.rows[1].you, true);

  // All three pick Arsenal v Chelsea. It ends 2–1.
  const picks = {
    mya: await pick(s, mya, s.f.football, { home: 0, away: 0 }), // wrong
    jerkson: await pick(s, jerkson, s.f.football, { home: 2, away: 1 }), // spot on: 3
    kemi: await pick(s, kemi, s.f.football, { home: 1, away: 0 }), // right winner: 1
  };
  s.clock.now = s.f.football.kickoff + 2 * 3600;
  await open(s, mya, picks.mya);
  await open(s, jerkson, picks.jerkson);
  assert.deepEqual(names((await table(s, mya)).everyone), ["1 mya 0", "2 Jerkson 0", "3 Kemi 0"], "nothing is scored before the result is in");
  assert.equal((await result(s, s.f.football, "2 – 1", { home: 2, away: 1 })).status, 200);

  // Jerkson passes mya and is 1st. Kemi has not opened her pick yet, so it has not scored.
  t = await table(s, mya, group.code);
  assert.deepEqual(names(t.everyone), ["1 Jerkson 3", "2 mya 0", "3 Kemi 0"]);
  assert.deepEqual(t.you, { place: 2, points: 0, threes: 0, ones: 0, wrong: 1 });
  assert.deepEqual(names(t.group), ["1 Jerkson 3", "2 mya 0"]);
  assert.deepEqual(t.played, [{ match: s.f.football.id, comp: "pl", sport: FOOTBALL, home: "Arsenal", away: "Chelsea", score: "2 – 1", kickoff: s.f.football.kickoff, pickByte: picks.mya.pickByte, points: 0 }]);

  // Kemi opens hers after the result. It scores then, and she passes mya too.
  await open(s, kemi, picks.kemi);
  t = await table(s, kemi);
  assert.deepEqual(names(t.everyone), ["1 Jerkson 3", "2 Kemi 1", "3 mya 0"]);
  assert.deepEqual(t.you, { place: 2, points: 1, threes: 0, ones: 1, wrong: 0 });
  assert.equal(t.group, null, "no group was asked for");
  assert.deepEqual(t.everyone.rows[0], { place: 1, name: "Jerkson", threes: 1, ones: 0, points: 3, you: false });
});

test("level on points, whoever joined Kickoff first is ahead. Nobody shares a place", async () => {
  const s = await serverWithFixtures();
  const [first, second, third] = [await device(), await device(), await device()];
  await join(s, first, "First");
  await join(s, second, "Second");
  await join(s, third, "Third");
  const sealed = [];
  for (const who of [third, second, first]) sealed.push([who, await pick(s, who, s.f.basketball, { winner: "home", band: "B" })]);
  s.clock.now = s.f.basketball.kickoff + 3 * 3600;
  for (const [who, p] of sealed) await open(s, who, p);
  // Knicks win by 8: the right winner and the right margin, 3 points each.
  await result(s, s.f.basketball, "104 – 96", basketballResult({ home: 104, away: 96 }));
  const t = await table(s, third);
  assert.deepEqual(names(t.everyone), ["1 First 3", "2 Second 3", "3 Third 3"]);
  assert.equal(t.played[0].sport, BASKETBALL);
});

test("the leaderboard anyone builds from the published file is in the same order as Kickoff's own", async () => {
  const s = await serverWithFixtures();
  const [first, second, third, fourth] = [await device(), await device(), await device(), await device()];
  await join(s, first, "First");
  await join(s, second, "Second");
  await join(s, third, "Third");
  await join(s, fourth, "Fourth");
  // Second links a wallet, then plays from another device of the same wallet.
  const wallet = testWallet("the leaderboard order test");
  const link = async (who) => {
    const text = walletLinkText({ player: who.player, wallet: wallet.address, at: s.clock.now });
    const r = await s.post(who, "/api/wallet", { wallet: wallet.address, linkAt: s.clock.now, signature: wallet.sign(text) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  };
  await link(second);
  const secondsOtherPhone = await device();
  s.clock.now += 60;
  await link(secondsOtherPhone);

  // Everyone gets it right, entered in an order that is not the order they joined.
  const sealed = [];
  for (const who of [fourth, secondsOtherPhone, third, first]) sealed.push([who, await pick(s, who, s.f.basketball, { winner: "home", band: "B" })]);
  s.clock.now = s.f.basketball.kickoff + 3 * 3600;
  for (const [who, p] of sealed) await open(s, who, p);
  await result(s, s.f.basketball, "104 – 96", basketballResult({ home: 104, away: 96 }));
  assert.deepEqual(names((await table(s, first)).everyone), ["1 First 3", "2 Second 3", "3 Third 3", "4 Fourth 3"]);

  // The file the robot publishes on X Layer, read with the picks engine alone.
  const file = await s.get(`/api/matches/${s.f.basketball.id}/openings`);
  assert.equal(file.status, 200);
  const read = parseOpenings(JSON.stringify(file.body));
  assert.equal(read.entries.every((e) => Number.isInteger(e.joined)), true, "every player's joining time is in the file");
  const bundle = await buildBundle({ league: LEAGUE, match: s.f.basketball.id, entries: read.entries });
  const match = await withOpenings(fromHex(LEAGUE), { id: fromHex(s.f.basketball.id), sport: BASKETBALL, kickoff: s.f.basketball.kickoff, matchInfo: {}, state: "final", result: basketballResult({ home: 104, away: 96 }), lock: { root: bundle.root, count: bundle.count, lockedAt: s.f.basketball.kickoff - 600 } }, read);
  const built = await buildTable({ league: fromHex(LEAGUE), matches: [match], circuits: loadCircuits({ football: FOOTBALL_HEX, basketball: BASKETBALL_HEX, tennis: TENNIS_HEX }) });
  const who = new Map([[first.player, "First"], [secondsOtherPhone.player, "Second"], [third.player, "Third"], [fourth.player, "Fourth"]]);
  assert.deepEqual(built.table.map((row) => `${row.position} ${who.get(toHex(row.player))} ${row.points}`), ["1 First 3", "2 Second 3", "3 Third 3", "4 Fourth 3"]);
});

test("scoring a match twice changes nothing, and a result put right is scored again", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  await join(s, ada, "Ada");
  const mine = await pick(s, ada, s.f.football, { home: 2, away: 1 });
  s.clock.now = s.f.football.kickoff + 2 * 3600;
  await open(s, ada, mine);
  await result(s, s.f.football, "2 – 1", { home: 2, away: 1 });
  await result(s, s.f.football, "2 – 1", { home: 2, away: 1 });
  await open(s, ada, mine);
  assert.deepEqual((await table(s, ada)).you, { place: 1, points: 3, threes: 1, ones: 0, wrong: 0 });
  // The feed corrects the score to 3–1: the right winner now, not the exact score.
  await result(s, s.f.football, "3 – 1", { home: 3, away: 1 });
  const t = await table(s, ada);
  assert.deepEqual(t.you, { place: 1, points: 1, threes: 0, ones: 1, wrong: 0 });
  assert.equal(t.played[0].score, "3 – 1");
  assert.equal(t.played.length, 1);
});

test("a prediction only counts once the robot has said the match was locked on X Layer, whichever order things arrive in", async () => {
  for (const order of ["lock, result, open", "result, open, lock", "open, lock, result", "result, lock, open"]) {
    const s = await serverWithFixtures();
    const ada = await device();
    await join(s, ada, "Ada");
    const mine = await pick(s, ada, s.f.football, { home: 2, away: 1 });
    s.clock.now = s.f.football.kickoff + 2 * 3600;
    const steps = {
      lock: () => lock(s, s.f.football),
      result: () => resultOnly(s, s.f.football, "2 – 1", { home: 2, away: 1 }),
      open: () => open(s, ada, mine),
    };
    const [first, second, third] = order.split(", ");
    await steps[first]();
    await steps[second]();
    // Two of the three are not enough: no points, and nothing listed as played.
    const before = await table(s, ada);
    assert.deepEqual([before.you.points, before.played], [0, []], `${order}: after two steps`);
    await steps[third]();
    const after = await table(s, ada);
    assert.deepEqual(after.you, { place: 1, points: 3, threes: 1, ones: 0, wrong: 0 }, order);
    assert.deepEqual(after.played.map((p) => [p.score, p.points]), [["2 – 1", 3]], order);
  }
});

test("a match that was not locked in time never scores for anyone, and each player is told why", async () => {
  const s = await serverWithFixtures();
  const [ada, bola] = [await device(), await device()];
  await join(s, ada, "Ada");
  await join(s, bola, "Bola");
  const adas = await pick(s, ada, s.f.football, { home: 2, away: 1 });
  const bolas = await pick(s, bola, s.f.football, { home: 0, away: 3 });
  const onTheOther = await pick(s, ada, s.f.basketball, { winner: "home", band: "B" });
  await s.freeze(s.f.football);

  // The robot was too late for the football.
  s.clock.now = s.f.football.kickoff + 2 * 3600;
  assert.deepEqual((await lock(s, s.f.football, "missed")).body, { changed: 1 });
  await open(s, ada, adas);
  await open(s, bola, bolas);
  await resultOnly(s, s.f.football, "2 – 1", { home: 2, away: 1 });
  let t = await table(s, ada);
  assert.deepEqual(t.you, { place: 1, points: 0, threes: 0, ones: 0, wrong: 0 }, "no points, and it is not counted as a prediction she got wrong");
  assert.deepEqual(t.played, [{ match: s.f.football.id, comp: "pl", sport: FOOTBALL, home: "Arsenal", away: "Chelsea", score: "2 – 1", kickoff: s.f.football.kickoff, missed: true, points: 0 }]);
  assert.deepEqual((await table(s, bola)).you.wrong, 0, "nor as one he got wrong");
  // The list of matches says so too, which is how the website knows.
  const listed = (await s.get("/api/fixtures")).body.fixtures;
  assert.deepEqual(listed.map((f) => [f.home, f.lock]), [["Arsenal", "missed"], ["Knicks", undefined]]);

  // The other match went as it should, and scores as ever.
  s.clock.now = s.f.basketball.kickoff + 3 * 3600;
  await open(s, ada, onTheOther);
  await result(s, s.f.basketball, "104 – 96", basketballResult({ home: 104, away: 96 }));
  t = await table(s, ada);
  assert.deepEqual(t.you, { place: 1, points: 3, threes: 1, ones: 0, wrong: 0 });
  assert.deepEqual(t.played.map((p) => [p.home, p.points, p.missed ?? false]), [["Knicks", 3, false], ["Arsenal", 0, true]]);
});

test("if a lock turns out to have been missed after all, the points given for that match are taken back", async () => {
  const s = await serverWithFixtures();
  const [ada, bola] = [await device(), await device()];
  await join(s, ada, "Ada");
  await join(s, bola, "Bola");
  const adas = await pick(s, ada, s.f.football, { home: 2, away: 1 });
  const bolas = await pick(s, bola, s.f.football, { home: 1, away: 0 });
  s.clock.now = s.f.football.kickoff + 2 * 3600;
  await open(s, ada, adas);
  await open(s, bola, bolas);
  await result(s, s.f.football, "2 – 1", { home: 2, away: 1 });
  assert.deepEqual(names((await table(s, ada)).everyone), ["1 Ada 3", "2 Bola 1"]);

  await lock(s, s.f.football, "missed");
  const t = await table(s, ada);
  assert.deepEqual(names(t.everyone), ["1 Ada 0", "2 Bola 0"]);
  assert.deepEqual(t.played.map((p) => [p.points, p.missed]), [[0, true]]);
  // Saying it again is not news, and a result put right afterwards still gives nothing.
  assert.deepEqual((await lock(s, s.f.football, "missed")).body, { changed: 0 });
  await resultOnly(s, s.f.football, "3 – 1", { home: 3, away: 1 });
  assert.deepEqual(names((await table(s, ada)).everyone), ["1 Ada 0", "2 Bola 0"]);
});

test("only the robot can say how a lock went, and only in so many words", async () => {
  const s = await serverWithFixtures();
  const locks = [{ match: s.f.football.id, state: "locked" }];
  assert.equal((await s.robot("/api/admin/locks", { locks }, "not-the-key")).status, 403);
  assert.equal((await s.post(await device(), "/api/admin/locks", { locks })).status, 403);
  for (const bad of [null, {}, { locks: "all" }, { locks: [{ match: s.f.football.id, state: "probably" }] }, { locks: [{ match: "ab", state: "locked" }] }]) {
    assert.equal((await s.robot("/api/admin/locks", bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await s.robot("/api/admin/locks", { locks: [{ match: "ab".repeat(32), state: "locked" }] })).status, 404, "a match that is not on the list");
  assert.deepEqual((await s.robot("/api/admin/locks", { locks })).body, { changed: 1 });
  assert.deepEqual((await s.robot("/api/admin/locks", { locks })).body, { changed: 0 });
  // The list of matches cannot be used to slip a lock in: it comes in through this door only.
  await s.robot("/api/admin/fixtures", { fixtures: [{ ...s.f.basketball, lock: "locked" }] });
  assert.equal((await s.get("/api/fixtures")).body.fixtures.find((f) => f.home === "Knicks").lock, undefined);
  // And bringing the list up to date does not wipe a lock that was reported.
  await s.robot("/api/admin/fixtures", { fixtures: [{ ...s.f.football, state: "live" }] });
  assert.equal((await s.get("/api/fixtures")).body.fixtures.find((f) => f.home === "Arsenal").lock, "locked");
});

test("someone who predictions before choosing a name is on the table as Player and four characters", async () => {
  const s = await serverWithFixtures();
  const [ada, guest] = [await device(), await device()];
  await join(s, ada, "Ada");
  assert.deepEqual((await table(s, guest)).you, { place: null, points: 0, threes: 0, ones: 0, wrong: 0 }, "not on the table before playing");
  assert.equal((await table(s, guest)).everyone.rows.some((r) => r.you), false);
  s.clock.now += 60;
  await pick(s, guest, s.f.football, { home: 1, away: 1 });
  const t = await table(s, guest);
  const placeholder = `Player ${guest.player.slice(0, 4).toUpperCase()}`;
  assert.deepEqual(names(t.everyone), ["1 Ada 0", `2 ${placeholder} 0`]);
  // They choose a real name by starting or joining a group, and keep their place in the queue.
  await join(s, guest, "Guest");
  assert.deepEqual(names((await table(s, guest)).everyone), ["1 Ada 0", "2 Guest 0"]);
  await join(s, await device(), placeholder);
});

test("only the top of a long table is sent, with your own row if you are further down", async () => {
  const s = server();
  const players = [];
  for (let i = 1; i <= TABLE_TOP + 5; i++) {
    const d = await device();
    players.push(d);
    await join(s, d, `Player number ${i}`);
  }
  const last = await table(s, players.at(-1));
  assert.equal(last.everyone.players, TABLE_TOP + 5);
  assert.equal(last.everyone.rows.length, TABLE_TOP + 1);
  assert.deepEqual(last.everyone.rows.at(-1), { place: TABLE_TOP + 5, name: `Player number ${TABLE_TOP + 5}`, threes: 0, ones: 0, points: 0, you: true, below: true });
  const top = await table(s, players[2]);
  assert.equal(top.everyone.rows.length, TABLE_TOP);
  assert.equal(top.everyone.rows[2].you, true);
});

test("a wallet's devices are one person on the table: one row, one name, their points together", async () => {
  const s = await serverWithFixtures();
  const [phone, laptop, bola] = [await device(), await device(), await device()];
  const wallet = testWallet("ada");
  const link = (who) => {
    const at = s.clock.now;
    return s.post(who, "/api/wallet", { wallet: wallet.address, linkAt: at, signature: wallet.sign(walletLinkText({ player: who.player, wallet: wallet.address, at })) });
  };
  await join(s, bola, "Bola");
  const group = await join(s, phone, "Ada");
  await join(s, laptop, "Ada laptop");
  assert.equal((await table(s, bola)).everyone.players, 3);

  // The phone picks football, the laptop basketball. Then both link the same wallet.
  const onPhone = await pick(s, phone, s.f.football, { home: 2, away: 1 });
  const onLaptop = await pick(s, laptop, s.f.basketball, { winner: "home", band: "A" });
  assert.equal((await link(phone)).status, 200);
  assert.equal((await link(laptop)).status, 200);
  let t = await table(s, laptop, group.code);
  assert.deepEqual(names(t.everyone), ["1 Bola 0", "2 Ada 0"], "two rows became one, under the name the wallet had first");
  assert.equal(t.everyone.rows[1].you, true);
  assert.deepEqual(names(t.group), ["1 Ada 0"]);
  assert.ok(!JSON.stringify(t).includes(wallet.address.slice(2)), "the wallet's address is not in the table");

  s.clock.now = s.f.basketball.kickoff + 3 * 3600;
  await open(s, phone, onPhone);
  await open(s, laptop, onLaptop);
  await result(s, s.f.football, "2 – 1", { home: 2, away: 1 }); // 3
  await result(s, s.f.basketball, "101 – 99", basketballResult({ home: 101, away: 99 })); // 3
  t = await table(s, phone);
  assert.deepEqual(names(t.everyone), ["1 Ada 6", "2 Bola 0"]);
  assert.deepEqual(t.you, { place: 1, points: 6, threes: 2, ones: 0, wrong: 0 });
  assert.equal(t.played.length, 2, "the phone sees the laptop's match too");
  assert.equal(t.played[0].sport, BASKETBALL, "newest first");
});

test("people who joined a group before names were shared keep their names, and are put on the table", async () => {
  const s = server();
  const [ada, bola, alsoAda] = [await device(), await device(), await device()];
  // As the database held them before: members of groups, and nothing else.
  const put = async (code, who, name, joinedAt, startedBy = who) => {
    await s.store.setIfAbsent(`group:${code}`, { code, name: code, startedBy: startedBy.player, startedAt: joinedAt, plays: ["pl"] });
    await s.store.tableSet(`members:${code}`, who.player, { name, joinedAt });
    await s.store.tableSet(`groups-of:${who.player}`, code, { joinedAt });
  };
  await put("OLD-0001", ada, "Ada", 100);
  await put("OLD-0001", bola, "Bola", 200, ada);
  await put("OLD-0002", alsoAda, "Ada", 300);

  const t = await table(s, bola, "OLD-0001");
  assert.deepEqual(names(t.group), ["1 Ada 0", "2 Bola 0"]);
  assert.deepEqual(names(t.everyone), ["1 Ada 0", "2 Bola 0"]);
  // The second Ada turns up later. The name is taken, so a number is added, in her group too.
  const late = await s.post(alsoAda, "/api/me/groups");
  assert.equal(late.body.groups[0].members[0].name, "Ada 2");
  assert.deepEqual(names((await table(s, alsoAda)).everyone), ["1 Ada 0", "2 Bola 0", "3 Ada 2 0"]);
});

test("a wallet linked on two devices before names were shared is one person, not two", async () => {
  const s = server();
  const [phone, laptop] = [await device(), await device()];
  const wallet = testWallet("ada").address;
  // As the database held them before: one seat shared by the wallet's two devices.
  await s.store.setIfAbsent("group:OLD-0001", { code: "OLD-0001", name: "Old", startedBy: phone.player, startedAt: 100, plays: ["pl"] });
  for (const [who, since] of [[phone, 100], [laptop, 500]]) {
    await s.store.set(`wallet-of:${who.player}`, { wallet, at: since, signature: "00", linkedAt: since });
    await s.store.tableSet(`players-of:${wallet}`, who.player, { linkedAt: since });
    await s.store.tableSet("members:OLD-0001", who.player, { name: "Ada", joinedAt: 100, wallet, since });
    await s.store.tableSet(`groups-of:${who.player}`, "OLD-0001", { joinedAt: 100 });
  }
  let t = await table(s, laptop, "OLD-0001");
  assert.deepEqual(names(t.everyone), ["1 Ada 0"]);
  assert.equal(t.everyone.rows[0].you, true);
  t = await table(s, phone, "OLD-0001");
  assert.deepEqual(names(t.everyone), ["1 Ada 0"]);
  assert.equal(t.everyone.rows[0].you, true);
  assert.deepEqual(names(t.group), ["1 Ada 0"]);
});

test("the tables work the same on the real kind of database", async () => {
  const redis = fakeRedis();
  const s = await serverWithFixtures({ store: new RedisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: redis.fetch }) });
  const [ada, bola] = [await device(), await device()];
  const group = await join(s, ada, "Ada");
  await join(s, bola, "Bola", group.code);
  const mine = await pick(s, bola, s.f.football, { home: 2, away: 1 });
  s.clock.now = s.f.football.kickoff + 2 * 3600;
  await open(s, bola, mine);
  await result(s, s.f.football, "2 – 1", { home: 2, away: 1 });
  const before = redis.seen.length;
  assert.deepEqual(names((await table(s, ada, group.code)).group), ["1 Bola 3", "2 Ada 0"]);
  const first = redis.seen.length - before;
  await table(s, ada, group.code);
  assert.ok(redis.seen.length - before - first < first, "the second look does less work, because the table was kept");
  await join(s, ada, "Ada B", group.code);
  assert.deepEqual(names((await table(s, bola)).everyone), ["1 Bola 3", "2 Ada B 0"]);
});

// ---- The player of the week

const monday = (y, m, d) => Date.UTC(y, m, d) / 1000;

test("a week runs from Monday to Sunday, by the clock X Layer keeps", () => {
  const start = monday(2026, 10, 23); // Monday 23 November 2026
  assert.equal(new Date(start * 1000).getUTCDay(), 1);
  for (const moment of [start, start + 1, Date.UTC(2026, 10, 26, 13, 5) / 1000, start + WEEK - 1]) assert.equal(weekStart(moment), start);
  assert.equal(weekStart(start - 1), start - WEEK);
  assert.equal(weekStart(start + WEEK), start + WEEK);
});

test("the player of the week is whoever gained the most in the last finished week, and nobody until a week has finished", async () => {
  const s = await serverWithFixtures();
  const [ada, bola, chidi] = [await device(), await device(), await device()];
  await join(s, ada, "Ada");
  await join(s, bola, "Bola");
  await join(s, chidi, "Chidi");
  const sealed = [
    [ada, await pick(s, ada, s.f.football, { home: 2, away: 1 })], // spot on: 3
    [bola, await pick(s, bola, s.f.football, { home: 1, away: 0 })], // right winner: 1
    [chidi, await pick(s, chidi, s.f.football, { home: 0, away: 2 })], // wrong: 0
  ];
  s.clock.now = s.f.football.kickoff + 3 * 3600;
  for (const [who, p] of sealed) await open(s, who, p);
  await result(s, s.f.football, "2 – 1", { home: 2, away: 1 });

  // The week the match was played in is still running: there is no player of that week yet.
  const thisWeek = weekStart(s.f.football.kickoff);
  let t = await table(s, bola);
  assert.deepEqual(t.week, { from: thisWeek - WEEK, to: thisWeek, everyone: null, group: null });

  // The Monday after, it is Ada, for everyone who asks.
  s.clock.now = thisWeek + WEEK + 60;
  t = await table(s, bola);
  assert.deepEqual(t.week, { from: thisWeek, to: thisWeek + WEEK, everyone: { name: "Ada", points: 3, you: false }, group: null });
  assert.deepEqual((await table(s, ada)).week.everyone, { name: "Ada", points: 3, you: true });

  // A week later nothing was played in the week just gone, so there is nobody. Ada's total stands.
  s.clock.now += WEEK;
  t = await table(s, ada);
  assert.deepEqual([t.week.from, t.week.everyone], [thisWeek + WEEK, null]);
  assert.deepEqual(names(t.everyone), ["1 Ada 3", "2 Bola 1", "3 Chidi 0"]);
});

test("level for the week, it goes to whoever joined Kickoff first; and a group has its own player of the week", async () => {
  const s = await serverWithFixtures();
  const [ada, bola, chidi, dayo] = [await device(), await device(), await device(), await device()];
  const adas = await join(s, ada, "Ada"); // Ada's group
  const bolas = await join(s, bola, "Bola"); // Bola's group, which Chidi and Dayo join
  await join(s, chidi, "Chidi", bolas.code);
  await join(s, dayo, "Dayo", bolas.code);
  const sealed = [];
  // Football: Ada spot on (3). Basketball: Chidi and Dayo spot on (3 each), Bola the winner only (1).
  sealed.push([ada, await pick(s, ada, s.f.football, { home: 2, away: 1 })]);
  sealed.push([dayo, await pick(s, dayo, s.f.basketball, { winner: "home", band: "B" })]);
  sealed.push([chidi, await pick(s, chidi, s.f.basketball, { winner: "home", band: "B" })]);
  sealed.push([bola, await pick(s, bola, s.f.basketball, { winner: "home", band: "D" })]);
  s.clock.now = s.f.basketball.kickoff + 3 * 3600;
  for (const [who, p] of sealed) await open(s, who, p);
  await result(s, s.f.football, "2 – 1", { home: 2, away: 1 });
  await result(s, s.f.basketball, "104 – 96", basketballResult({ home: 104, away: 96 }));
  assert.equal(weekStart(s.f.football.kickoff), weekStart(s.f.basketball.kickoff), "both matches are in one week");

  s.clock.now = weekStart(s.f.basketball.kickoff) + WEEK + 60;
  // Among everyone, three have 3 for the week. Ada joined first.
  const t = await table(s, dayo, bolas.code);
  assert.deepEqual(t.week.everyone, { name: "Ada", points: 3, you: false });
  // In Bola's group Ada is not there to win it. Chidi and Dayo are level; Chidi joined first.
  assert.deepEqual(t.week.group, { name: "Chidi", points: 3, you: false });
  assert.deepEqual((await table(s, chidi, bolas.code)).week.group, { name: "Chidi", points: 3, you: true });
  // In Ada's group of one, it is Ada.
  assert.deepEqual((await table(s, ada, adas.code)).week.group, { name: "Ada", points: 3, you: true });
});

test("a match that was not locked on X Layer in time gives nobody a week, as it gives nobody points", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  await join(s, ada, "Ada");
  const p = await pick(s, ada, s.f.football, { home: 2, away: 1 });
  s.clock.now = s.f.football.kickoff + 3 * 3600;
  await open(s, ada, p);
  await lock(s, s.f.football, "missed");
  await resultOnly(s, s.f.football, "2 – 1", { home: 2, away: 1 });
  s.clock.now = weekStart(s.f.football.kickoff) + WEEK + 60;
  const t = await table(s, ada);
  assert.equal(t.week.everyone, null);
  assert.equal(t.you.points, 0);
});
