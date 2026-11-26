// The server signs for every sealed prediction it takes, so a player whose prediction is later
// left out of the locked bundle holds proof that Kickoff was given it in time.
import { test } from "node:test";
import assert from "node:assert/strict";

import { FOOTBALL, sealPick, toHex, verifyTaken } from "../../engine/src/index.js";
import { CLOSES_BEFORE } from "../src/kickoff.js";
import { createSigner, signingKeysFrom } from "../src/signing.js";
import { fromEnv } from "../src/web.js";
import { FAKE_TOKEN, FAKE_URL, fakeRedis } from "./fake-redis.js";
import { LEAGUE, device, serverWithFixtures } from "./helpers.js";

const SECRET = "the server's secret, long enough to use";
const signer = createSigner(SECRET);

/** A phone seals a prediction and sends it. Returns the server's answer and the fingerprint. */
async function predict(s, who, pick) {
  s.clock.now += 1;
  const p = await sealPick({ league: LEAGUE, match: s.f.football.id, sport: FOOTBALL, pick, player: who.player });
  const fingerprint = toHex(p.fingerprint);
  return { fingerprint, answer: await s.post(who, "/api/picks", { match: s.f.football.id, fingerprint }) };
}
const noteFrom = (s, who, { fingerprint, answer }) => ({
  key: signer.publicKey, sig: answer.body.taken?.sig, league: LEAGUE, match: s.f.football.id, player: who.player, fingerprint, receivedAt: answer.body.receivedAt, closesAt: answer.body.closesAt,
});

test("the answer to a sealed prediction carries the server's signed word that it took it", async () => {
  const s = await serverWithFixtures({ signer });
  const ada = await device();
  const sent = await predict(s, ada, { home: 2, away: 1 });
  assert.equal(sent.answer.status, 200);
  assert.equal(sent.answer.body.taken.key, signer.publicKey);
  assert.equal(sent.answer.body.receivedAt, s.clock.now);
  assert.equal(sent.answer.body.closesAt, s.f.football.kickoff - CLOSES_BEFORE);
  assert.equal(await verifyTaken(noteFrom(s, ada, sent)), true);
  // The key it signs with is the one it tells anyone who asks.
  assert.deepEqual((await s.get("/api/key")).body, { key: signer.publicKey });
});

test("a note is for one player's one prediction: it proves nothing for anyone or anything else", async () => {
  const s = await serverWithFixtures({ signer });
  const [ada, bola] = [await device(), await device()];
  const adas = await predict(s, ada, { home: 2, away: 1 });
  const bolas = await predict(s, bola, { home: 0, away: 0 });
  const note = noteFrom(s, ada, adas);
  assert.equal(await verifyTaken({ ...note, player: bola.player }), false, "Bola cannot pass Ada's note off as hers");
  assert.equal(await verifyTaken({ ...note, fingerprint: bolas.fingerprint }), false);
  assert.equal(await verifyTaken({ ...note, match: s.f.basketball.id }), false);
  assert.notEqual(adas.answer.body.taken.sig, bolas.answer.body.taken.sig);
});

test("a changed prediction gets a note of its own, for the new fingerprint", async () => {
  const s = await serverWithFixtures({ signer });
  const ada = await device();
  const first = await predict(s, ada, { home: 2, away: 1 });
  const second = await predict(s, ada, { home: 1, away: 1 });
  assert.notEqual(second.fingerprint, first.fingerprint);
  assert.equal(await verifyTaken(noteFrom(s, ada, second)), true);
  assert.equal(await verifyTaken({ ...noteFrom(s, ada, second), fingerprint: first.fingerprint }), false);
  // The earlier note is still truly signed. The bundle holds the later prediction, which is Kickoff's answer to it.
  assert.equal(await verifyTaken(noteFrom(s, ada, first)), true);
  const bundle = (await s.freeze(s.f.football)).body;
  assert.deepEqual(bundle.entries.map((e) => e.fingerprint), [second.fingerprint]);
});

test("a prediction the server refuses gets no note", async () => {
  const s = await serverWithFixtures({ signer });
  const ada = await device();
  s.clock.now = s.f.football.kickoff - CLOSES_BEFORE; // predictions have closed
  const late = await predict(s, ada, { home: 2, away: 1 });
  assert.equal(late.answer.status, 409);
  assert.equal(late.answer.body.taken, undefined);
  const junk = await s.post(ada, "/api/picks", { match: s.f.basketball.id, fingerprint: "not a fingerprint" });
  assert.equal(junk.status, 400);
  assert.equal(junk.body.taken, undefined);
});

test("a server with no signing key still takes predictions, signs nothing, and says it has no key", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  const sent = await predict(s, ada, { home: 2, away: 1 });
  assert.equal(sent.answer.status, 200);
  assert.equal(sent.answer.body.taken, undefined);
  assert.deepEqual((await s.get("/api/key")).body, { key: null });
  assert.equal(createSigner("too short"), null);
  assert.equal(createSigner(null), null);
});

test("the hosted server signs with the key worked out from its own secret, and never shows the secret", async () => {
  const env = { KV_REST_API_URL: FAKE_URL, KV_REST_API_TOKEN: FAKE_TOKEN, KICKOFF_ADMIN_KEY: SECRET };
  const handler = fromEnv(env, { fetch: fakeRedis().fetch, log: () => {} });
  const answer = await handler(new Request("https://kickoff.example/api/key"));
  const words = await answer.text();
  assert.deepEqual(JSON.parse(words), { key: signingKeysFrom(SECRET).publicKey });
  assert.ok(!words.includes(SECRET));
  // One whose secret is too short to be safe signs nothing.
  const weak = fromEnv({ ...env, KICKOFF_ADMIN_KEY: "short" }, { fetch: fakeRedis().fetch, log: () => {} });
  assert.deepEqual(await (await weak(new Request("https://kickoff.example/api/key"))).json(), { key: null });
});
