// A football match as three predictions: the result, goal goal and the exact score.
import { test } from "node:test";
import assert from "node:assert/strict";

import { FOOTBALL_MARKETS, GOAL_GOAL, RESULT, SCORE, TENNIS, encodeResult, matchId, sealPick, toHex } from "../../engine/src/index.js";
import { LEAGUE, device, server } from "./helpers.js";

const KICKOFF = 1_900_000_000;
const facts = { comp: "pl", home: "Arsenal", away: "Chelsea", kickoff: KICKOFF, label: "Premier League: Arsenal v Chelsea", state: "scheduled" };

/** A server with one football match on its list, as its three predictions. */
async function withMatch() {
  const s = server();
  s.clock.now = KICKOFF - 86400;
  const f = {};
  for (const sport of FOOTBALL_MARKETS) f[sport] = { ...facts, sport, id: toHex(await matchId(LEAGUE, { sport, kickoff: KICKOFF, bestOf: 0, label: facts.label })) };
  assert.equal((await s.robot("/api/admin/fixtures", { fixtures: Object.values(f) })).status, 200);
  return { ...s, f };
}
async function join(s, who, name) {
  s.clock.now += 60;
  assert.equal((await s.post(who, "/api/groups", { name: `${name}'s lot`, playerName: name })).status, 200);
}
async function predict(s, who, fixture, what) {
  const sealed = await sealPick({ league: LEAGUE, match: fixture.id, sport: fixture.sport, pick: what, player: who.player });
  const sent = await s.post(who, "/api/picks", { match: fixture.id, fingerprint: toHex(sealed.fingerprint) });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  return { match: fixture.id, pickByte: sealed.pickByte, salt: toHex(sealed.salt) };
}
/** Predictions close, each is locked, the match is played, and everyone's are opened. */
async function play(s, opened, score, real) {
  s.clock.now = KICKOFF - 595;
  for (const f of Object.values(s.f)) await s.robot("/api/admin/locks", { locks: [{ match: f.id, state: "locked" }] });
  s.clock.now = KICKOFF + 2 * 3600;
  for (const [who, sealed] of opened) assert.equal((await s.post(who, "/api/opened", sealed)).status, 200);
  for (const f of Object.values(s.f)) {
    assert.equal((await s.robot("/api/admin/fixtures", { fixtures: [{ ...f, state: "final", score, resultByte: encodeResult(f.sport, real) }] })).status, 200);
  }
}
const table = async (s, who) => (await s.post(who, "/api/me/table", { group: null })).body;

test("all three right is 5 points: 1 for the result, 1 for goal goal, 3 for the exact score", async () => {
  const s = await withMatch();
  const mya = await device();
  await join(s, mya, "mya");
  const opened = [
    [mya, await predict(s, mya, s.f[RESULT], { result: "home" })],
    [mya, await predict(s, mya, s.f[GOAL_GOAL], { both: true })],
    [mya, await predict(s, mya, s.f[SCORE], { home: 2, away: 1 })],
  ];
  await play(s, opened, "2 – 1", { home: 2, away: 1 });
  const t = await table(s, mya);
  assert.deepEqual(t.you, { place: 1, points: 5, threes: 1, ones: 2, wrong: 0 });
  assert.deepEqual(t.played.map((p) => `${p.sport} ${p.score} ${p.points}`).sort(), [`${RESULT} 2 – 1 1`, `${GOAL_GOAL} 2 – 1 1`, `${SCORE} 2 – 1 3`]);
});

test("each prediction stands by itself: a player can make one, two or all three, and get some right", async () => {
  const s = await withMatch();
  const [mya, jerkson, kemi] = [await device(), await device(), await device()];
  await join(s, mya, "mya");
  await join(s, jerkson, "Jerkson");
  await join(s, kemi, "Kemi");
  const opened = [
    // mya: the right result, the wrong score. The exact score no longer gives a point for the right winner.
    [mya, await predict(s, mya, s.f[RESULT], { result: "home" })],
    [mya, await predict(s, mya, s.f[SCORE], { home: 1, away: 0 })],
    // Jerkson: only goal goal, and wrong.
    [jerkson, await predict(s, jerkson, s.f[GOAL_GOAL], { both: false })],
    // Kemi: a draw, and yes to goal goal.
    [kemi, await predict(s, kemi, s.f[RESULT], { result: "draw" })],
    [kemi, await predict(s, kemi, s.f[GOAL_GOAL], { both: true })],
  ];
  await play(s, opened, "2 – 1", { home: 2, away: 1 });
  const t = await table(s, mya);
  assert.deepEqual(t.everyone.rows.map((r) => `${r.place} ${r.name} ${r.points}`), ["1 mya 1", "2 Kemi 1", "3 Jerkson 0"]);
  assert.deepEqual(t.you, { place: 1, points: 1, threes: 0, ones: 1, wrong: 1 });
  assert.deepEqual((await table(s, jerkson)).you, { place: 3, points: 0, threes: 0, ones: 0, wrong: 1 });
});

test("a prediction of one kind cannot be opened as another", async () => {
  const s = await withMatch();
  const mya = await device();
  await join(s, mya, "mya");
  const sealed = await predict(s, mya, s.f[RESULT], { result: "away" });
  await play(s, [], "0 – 1", { home: 0, away: 1 });
  // Handing the same byte and secret to the goal goal match is refused: it was never sealed there.
  assert.notEqual((await s.post(mya, "/api/opened", { ...sealed, match: s.f[GOAL_GOAL].id })).status, 200);
  assert.equal((await s.post(mya, "/api/opened", sealed)).status, 200);
  assert.equal((await table(s, mya)).you.points, 1);
});

test("tennis is still not offered, and a kind of match nobody knows is refused", async () => {
  const s = server();
  for (const sport of [TENNIS, 7, 0]) {
    const put = await s.robot("/api/admin/fixtures", { fixtures: [{ ...facts, sport, id: "ab".repeat(32) }] });
    assert.equal(put.status, 400, `sport ${sport}`);
  }
});
