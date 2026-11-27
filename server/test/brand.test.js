// Groups run by a brand: started only by Kickoff, far bigger than a group of friends, and never
// listed member by member.
import { test } from "node:test";
import assert from "node:assert/strict";

import { FOOTBALL, encodePick, sealPick, toHex, walletLinkText } from "../../engine/src/index.js";
import { testWallet } from "../../engine/test/test-wallet.js";
import { BRAND_MAX, MAX_MEMBERS } from "../src/kickoff.js";
import { RedisStore } from "../src/redis-store.js";
import { FAKE_TOKEN, FAKE_URL, fakeRedis } from "./fake-redis.js";
import { LEAGUE, device, server, serverWithFixtures } from "./helpers.js";

const ask = { name: "World Cup Predictions", brand: "OKX", prize: "100 USDT for 1st place", plays: ["pl", "cl"] };
const start = async (s, what = ask) => {
  const r = await s.robot("/api/admin/brand-groups", what);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const join = async (s, who, name, code) => {
  s.clock.now += 60;
  const r = await s.post(who, `/api/groups/${code}/join`, { playerName: name });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const table = async (s, who, group = null) => (await s.post(who, "/api/me/table", { group })).body;
const mine = async (s, who) => (await s.post(who, "/api/me/groups", {})).body.groups;

test("only Kickoff can start a brand's group, and it starts with nobody in it", async () => {
  const s = server();
  assert.equal((await s.robot("/api/admin/brand-groups", ask, "not-the-key")).status, 403);
  assert.equal((await s.post(await device(), "/api/admin/brand-groups", ask)).status, 403);

  const g = await start(s);
  assert.deepEqual(g, { code: "WORLDCU-4821", name: "World Cup Predictions", startedBy: null, startedAt: s.clock.now, plays: ["pl", "cl"], brand: "OKX", prize: "100 USDT for 1st place", players: 0, members: [] });
  // The prize line and the competitions can be left out: no prize line, and every competition.
  const plain = await start(s, { name: "Derby Day", brand: "Blokyz" });
  assert.equal("prize" in plain, false);
  assert.deepEqual(plain.plays, ["pl", "cl", "ll", "sa", "nba", "wnba"]);
  assert.equal("prize" in (await start(s, { name: "Derby Day", brand: "Blokyz", prize: "   " })), false);

  for (const bad of [{ ...ask, brand: "" }, { ...ask, brand: "x".repeat(31) }, { ...ask, name: "" }, { ...ask, prize: "x".repeat(81) }, { ...ask, plays: ["chess"] }, { brand: "OKX" }]) {
    assert.equal((await s.robot("/api/admin/brand-groups", bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(BRAND_MAX, 5000);
});

test("far more than a group of friends can join, and nobody is handed the list of who is in it", async () => {
  const s = server();
  const { code } = await start(s);
  const phones = [];
  for (let i = 0; i < MAX_MEMBERS + 12; i++) {
    phones.push(await device());
    await join(s, phones[i], `Fan ${i + 1}`, code);
  }
  // Someone with only the code sees what the group is and how big, and no names.
  const seen = (await s.get(`/api/groups/${code}`)).body;
  assert.deepEqual([seen.brand, seen.prize, seen.players, seen.members], ["OKX", "100 USDT for 1st place", 42, []]);
  // A player in it sees their own seat and nobody else's.
  const [g] = await mine(s, phones[7]);
  assert.equal(g.players, 42);
  assert.deepEqual(g.members, [{ player: phones[7].player, name: "Fan 8", joinedAt: g.members[0].joinedAt }]);
  // Joining again changes nothing.
  await join(s, phones[7], "Fan 8", code);
  assert.equal((await s.get(`/api/groups/${code}`)).body.players, 42);
  // A name somebody on Kickoff already has is refused here as anywhere.
  const late = await s.post(await device(), `/api/groups/${code}/join`, { playerName: "fan 3" });
  assert.deepEqual([late.status, late.body.error], [409, "That name is taken. Choose another."]);
  // Nobody in it can change what it plays.
  const change = await s.post(phones[0], `/api/groups/${code}/plays`, { plays: ["nba"] });
  assert.deepEqual([change.status, change.body.error], [403, "This group's competitions were chosen by whoever runs it."]);
  // A group of friends is still full at 30.
  const friends = (await s.post(phones[0], "/api/groups", { name: "Friends", playerName: "Fan 1" })).body;
  for (let i = 1; i < MAX_MEMBERS; i++) await join(s, phones[i], `Fan ${i + 1}`, friends.code);
  assert.equal((await s.post(phones[MAX_MEMBERS], `/api/groups/${friends.code}/join`, { playerName: `Fan ${MAX_MEMBERS + 1}` })).status, 409);
});

test("a brand's group is full at its limit, and says so", async () => {
  const s = server({ brandMax: 3 });
  const { code } = await start(s);
  const phones = [await device(), await device(), await device(), await device()];
  for (let i = 0; i < 3; i++) await join(s, phones[i], `Fan ${i + 1}`, code);
  const full = await s.post(phones[3], `/api/groups/${code}/join`, { playerName: "Fan 4" });
  assert.deepEqual([full.status, full.body.error], [409, "This group is full. It can have 3 players."]);
  // Someone already in it can still come back.
  await join(s, phones[1], "Fan 2", code);
});

test("its leaderboard is the top twenty and your own row, in the same order as everybody's", async () => {
  const s = await serverWithFixtures();
  const { code } = await start(s);
  const phones = [];
  const sealed = [];
  // 26 fans join one after another. An outsider plays too, and is on the leaderboard of everybody only.
  for (let i = 0; i < 26; i++) {
    phones.push(await device());
    await join(s, phones[i], `Fan ${i + 1}`, code);
  }
  const outsider = await device();
  s.clock.now += 60;
  await s.post(outsider, "/api/groups", { name: "Elsewhere", playerName: "Outsider" });
  // Fans 25 and 26 call it exactly. Fan 24 gets the winner. Everyone else is wrong. The outsider is spot on.
  const pickOf = (i) => (i >= 24 ? { home: 2, away: 1 } : i === 23 ? { home: 1, away: 0 } : { home: 0, away: 2 });
  const enter = async (who, what) => {
    const p = await sealPick({ league: LEAGUE, match: s.f.football.id, sport: FOOTBALL, pick: what, player: who.player });
    assert.equal((await s.post(who, "/api/picks", { match: s.f.football.id, fingerprint: toHex(p.fingerprint) })).status, 200);
    sealed.push([who, { match: s.f.football.id, pickByte: p.pickByte, salt: toHex(p.salt) }]);
  };
  for (let i = 0; i < 26; i++) await enter(phones[i], pickOf(i));
  await enter(outsider, { home: 2, away: 1 });
  s.clock.now = s.f.football.kickoff + 2 * 3600;
  for (const [who, p] of sealed) assert.equal((await s.post(who, "/api/opened", p)).status, 200);
  await s.robot("/api/admin/locks", { locks: [{ match: s.f.football.id, state: "locked" }] });
  await s.robot("/api/admin/fixtures", { fixtures: [{ ...s.f.football, state: "final", score: "2 – 1", resultByte: encodePick(FOOTBALL, { home: 2, away: 1 }) }] });

  // Fan 3 scored nothing and joined third, so is 6th in the group: after the three who scored and Fans 1 and 2.
  const t = await table(s, phones[2], code);
  assert.equal(t.group.players, 26);
  assert.equal(t.group.rows.length, 20, "the top twenty, and Fan 3 is among them");
  assert.deepEqual(t.group.rows.slice(0, 6).map((r) => `${r.place} ${r.name} ${r.points}`), ["1 Fan 25 3", "2 Fan 26 3", "3 Fan 24 1", "4 Fan 1 0", "5 Fan 2 0", "6 Fan 3 0"]);
  assert.equal(t.group.rows[5].you, true);
  assert.ok(!t.group.rows.some((r) => r.name === "Outsider"), "someone who is not in the group is not on its leaderboard");
  // Each row carries the ids that player picks with, for checking on X Layer.
  assert.deepEqual(t.group.rows[0].players, [phones[24].player]);

  // Fan 23 is 26th in the group: outside the top twenty, so their own row is added below it.
  const low = await table(s, phones[22], code);
  assert.equal(low.group.rows.length, 21);
  assert.deepEqual([low.group.rows[20].place, low.group.rows[20].name, low.group.rows[20].below, low.group.rows[20].you], [26, "Fan 23", true, true]);
  // On the leaderboard of everybody the outsider is there too, level with the best and behind them for joining later.
  assert.deepEqual(low.everyone.rows.slice(0, 3).map((r) => `${r.place} ${r.name} ${r.points}`), ["1 Fan 25 3", "2 Fan 26 3", "3 Outsider 3"]);
  // Someone not in the group can look at its leaderboard and gets no row of their own.
  const from = await table(s, outsider, code);
  assert.deepEqual([from.group.rows.length, from.group.rows.some((r) => r.you)], [20, false]);
});

test("three hundred players in one brand's group, and its list of members is never fetched whole", async () => {
  const s = server();
  const { code } = await start(s);
  const phones = [];
  for (let i = 0; i < 300; i++) {
    phones.push(await device());
    await join(s, phones[i], `Fan ${i + 1}`, code);
  }
  // From here on, note every table the server fetches whole.
  const fetched = [];
  const tableAll = s.store.tableAll.bind(s.store);
  s.store.tableAll = (name) => (fetched.push(name), tableAll(name));

  assert.equal((await s.get(`/api/groups/${code}`)).body.players, 300);
  const [g] = await mine(s, phones[299]);
  assert.deepEqual([g.players, g.members.length, g.members[0].name], [300, 1, "Fan 300"]);
  const t = await table(s, phones[299], code);
  assert.equal(t.group.players, 300);
  assert.equal(t.group.rows.length, 21);
  assert.deepEqual([t.group.rows[0].name, t.group.rows[19].name], ["Fan 1", "Fan 20"]);
  assert.deepEqual([t.group.rows[20].place, t.group.rows[20].name, t.group.rows[20].below], [300, "Fan 300", true]);
  // One more joins, and comes back.
  const late = await device();
  await join(s, late, "Fan 301", code);
  await join(s, late, "Fan 301", code);
  assert.equal((await s.get(`/api/groups/${code}`)).body.players, 301);

  assert.equal(fetched.some((name) => name.startsWith("members:")), false, `the members were fetched whole: ${fetched.filter((n) => n.startsWith("members:"))[0]}`);
});

test("a wallet's devices are one player in a brand's group, on any of them", async () => {
  const s = server();
  const { code } = await start(s);
  const [phone, laptop, other] = [await device(), await device(), await device()];
  await join(s, phone, "Ada", code);
  await join(s, other, "Bola", code);
  const wallet = testWallet("the brand group test");
  const link = async (who) => {
    const text = walletLinkText({ player: who.player, wallet: wallet.address, at: s.clock.now });
    const r = await s.post(who, "/api/wallet", { wallet: wallet.address, linkAt: s.clock.now, signature: wallet.sign(text) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  await link(phone);
  // A new laptop, named and in a brand group of its own, links the same wallet.
  const second = await start(s, { name: "Second Cup", brand: "OKX" });
  await join(s, laptop, "Ada Two", second.code);
  s.clock.now += 60;
  assert.equal((await link(laptop)).carried, 1, "it is brought into the phone's group");

  const groups = await mine(s, laptop);
  assert.deepEqual(groups.map((g) => g.code).sort(), [code, second.code].sort());
  const g = groups.find((x) => x.code === code);
  assert.deepEqual([g.members[0].name, g.members[0].linked, g.members[0].players], ["Ada", true, [phone.player, laptop.player].sort()]);
  // One row for Ada on each group's leaderboard, whichever device asks, and it is hers on both.
  for (const who of [phone, laptop]) {
    const first = await table(s, who, code);
    assert.deepEqual(first.group.rows.map((r) => [r.name, r.you]), [["Ada", true], ["Bola", false]]);
    assert.deepEqual(first.group.rows[0].players, [phone.player, laptop.player].sort());
    const also = await table(s, who, second.code);
    assert.deepEqual(also.group.rows.map((r) => [r.name, r.you]), [["Ada", true]]);
  }
});

test("brand groups work the same on the real kind of database", async () => {
  const redis = fakeRedis();
  const s = server({ store: new RedisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: redis.fetch }), brandMax: 2 });
  const { code } = await start(s);
  const [a, b, c] = [await device(), await device(), await device()];
  await join(s, a, "Ada", code);
  await join(s, b, "Bola", code);
  assert.equal((await s.get(`/api/groups/${code}`)).body.players, 2);
  assert.equal((await s.post(c, `/api/groups/${code}/join`, { playerName: "Chidi" })).status, 409);
  assert.deepEqual((await table(s, a, code)).group.rows.map((r) => r.name), ["Ada", "Bola"]);
});
