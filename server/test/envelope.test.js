// The locked copies that let the robot open predictions after kickoff: kept unread, handed over
// only once the match has started, and never able to change a prediction.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ENVELOPE_BYTES, FOOTBALL, encodePick, sealEnvelope, sealPick, toHex } from "../../engine/src/index.js";
import { envelopeKeysFrom } from "../../robot/src/envelope.js";
import { ADMIN_KEY, LEAGUE, device, serverWithFixtures } from "./helpers.js";

const ROBOT = envelopeKeysFrom("ab".repeat(32)).publicKey;

/** A phone seals a prediction and sends it with its locked copy, as the website does. */
async function predict(s, who, pick, { copy = true } = {}) {
  s.clock.now += 1;
  const p = await sealPick({ league: LEAGUE, match: s.f.football.id, sport: FOOTBALL, pick, player: who.player });
  const envelope = copy ? await sealEnvelope({ to: ROBOT, league: LEAGUE, match: s.f.football.id, player: who.player, fingerprint: p.fingerprint, pickByte: p.pickByte, salt: p.salt }) : undefined;
  const r = await s.post(who, "/api/picks", { match: s.f.football.id, fingerprint: toHex(p.fingerprint), ...(envelope ? { envelope } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { fingerprint: toHex(p.fingerprint), envelope, opening: { player: who.player, pickByte: p.pickByte, salt: toHex(p.salt) } };
}
const copies = (s, key = ADMIN_KEY) => s.handle({ method: "GET", path: `/api/admin/envelopes/${s.f.football.id}`, headers: { "x-kickoff-admin": key }, body: null });

test("locked copies are kept with the sealed prediction and handed to the robot only once the match has started", async () => {
  const s = await serverWithFixtures();
  const [ada, bola, chidi] = [await device(), await device(), await device()];
  const adas = await predict(s, ada, { home: 2, away: 1 });
  const bolas = await predict(s, bola, { home: 1, away: 0 });
  await predict(s, chidi, { home: 0, away: 0 }, { copy: false }); // sent the old way, with no copy

  // Nobody is told anything about a copy before kickoff: not the public, and not the robot.
  const seen = (await s.get(`/api/matches/${s.f.football.id}`)).body;
  assert.ok(!JSON.stringify(seen).includes(adas.envelope));
  assert.equal(seen.sealedCount, 3);
  const early = await copies(s);
  assert.deepEqual([early.status, early.body.error], [409, "Predictions are not opened before the match starts."]);
  s.clock.now = s.f.football.kickoff - 1;
  assert.equal((await copies(s)).status, 409, "not one second early");

  s.clock.now = s.f.football.kickoff;
  const after = await copies(s);
  assert.equal(after.status, 200);
  assert.deepEqual(after.body.envelopes.map((e) => [e.player, e.fingerprint, e.envelope]).sort(), [[ada.player, adas.fingerprint, adas.envelope], [bola.player, bolas.fingerprint, bolas.envelope]].sort());
  // Only with the robot's key.
  assert.equal((await s.get(`/api/admin/envelopes/${s.f.football.id}`)).status, 403);
  assert.equal((await copies(s, "not-the-key")).status, 403);
});

test("the robot opens predictions for players who never came back, and they are scored like any other", async () => {
  const s = await serverWithFixtures();
  const [ada, bola] = [await device(), await device()];
  const adas = await predict(s, ada, { home: 2, away: 1 });
  const bolas = await predict(s, bola, { home: 1, away: 0 });
  await s.freeze(s.f.football);
  await s.robot("/api/admin/locks", { locks: [{ match: s.f.football.id, state: "locked" }] });
  s.clock.now = s.f.football.kickoff + 60;
  const done = await s.robot("/api/admin/opened", { match: s.f.football.id, openings: [adas.opening, bolas.opening] });
  assert.deepEqual(done.body, { opened: 2, refused: [] });
  assert.deepEqual((await copies(s)).body.envelopes, [], "nothing is left to open");

  s.clock.now = s.f.football.kickoff + 2 * 3600;
  await s.robot("/api/admin/fixtures", { fixtures: [{ ...s.f.football, state: "final", score: "2 – 1", resultByte: encodePick(FOOTBALL, { home: 2, away: 1 }) }] });
  const points = async (who) => (await s.post(who, "/api/me/table", { group: null })).body.you.points;
  assert.deepEqual([await points(ada), await points(bola)], [3, 1]);
  // A phone that does come back and hands its own over is told it is fine, and nothing changes.
  assert.equal((await s.post(ada, "/api/opened", { match: s.f.football.id, pickByte: adas.opening.pickByte, salt: adas.opening.salt })).status, 200);
  assert.equal(await points(ada), 3);
});

test("the robot can open a prediction but cannot change one: what it hands over must match the fingerprint that was locked", async () => {
  const s = await serverWithFixtures();
  const [ada, bola] = [await device(), await device()];
  const adas = await predict(s, ada, { home: 0, away: 3 });
  const bolas = await predict(s, bola, { home: 1, away: 0 });
  s.clock.now = s.f.football.kickoff + 60;
  // The robot tries to say Ada predicted 2 – 1.
  const forged = { ...adas.opening, pickByte: encodePick(FOOTBALL, { home: 2, away: 1 }) };
  const outsider = { player: "ab".repeat(32), pickByte: 0, salt: "cd".repeat(32) };
  const r = await s.robot("/api/admin/opened", { match: s.f.football.id, openings: [forged, bolas.opening, outsider, { player: "nobody" }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.opened, 1, "the honest one still goes through");
  assert.deepEqual(r.body.refused.map((x) => x.why), ["That prediction and secret do not produce the fingerprint you sealed.", "You have no sealed prediction in this match's bundle.", "That is not a player."]);
  assert.deepEqual((await copies(s)).body.envelopes.map((e) => e.player), [ada.player], "Ada's is still waiting, unopened");
  // Only the robot may do this at all, and not before kickoff.
  assert.equal((await s.post(ada, "/api/admin/opened", { match: s.f.football.id, openings: [adas.opening] })).status, 403);
  assert.equal((await s.robot("/api/admin/opened", { match: s.f.football.id, openings: "all" })).status, 400);
});

test("a changed prediction replaces its locked copy, and something that is not a locked copy is refused", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  const first = await predict(s, ada, { home: 2, away: 1 });
  const second = await predict(s, ada, { home: 0, away: 0 });
  for (const bad of ["", "zz", "ab".repeat(ENVELOPE_BYTES - 1), "AB".repeat(ENVELOPE_BYTES), "ab".repeat(ENVELOPE_BYTES + 1), 7]) {
    s.clock.now += 1;
    const r = await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: second.fingerprint, envelope: bad });
    assert.deepEqual([r.status, r.body.error], [400, "That is not a locked copy of a prediction."], JSON.stringify(bad));
  }
  s.clock.now = s.f.football.kickoff;
  const kept = (await copies(s)).body.envelopes;
  assert.deepEqual(kept.map((e) => [e.fingerprint, e.envelope]), [[second.fingerprint, second.envelope]]);
  assert.notEqual(first.envelope, second.envelope);
});
