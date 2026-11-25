// A prediction's locked copy: only the robot's key unlocks it, and only for the match and player
// it was locked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { ENVELOPE_BYTES, FOOTBALL, envelopeKey, fingerprintOf, isEnvelopeKey, openEnvelope, sealEnvelope, sealPick, toHex } from "../src/index.js";
import { envelopeKeysFrom } from "../../robot/src/envelope.js";

const id = (words) => new Uint8Array(createHash("sha256").update(words).digest());
const LEAGUE = id("the league");
const MATCH = id("Arsenal v Chelsea");
const ADA = id("ada");
const robot = envelopeKeysFrom("11".repeat(32));
const other = envelopeKeysFrom("22".repeat(32));

async function sealed(pick = { home: 2, away: 1 }) {
  const s = await sealPick({ league: LEAGUE, match: MATCH, sport: FOOTBALL, pick, player: ADA });
  const facts = { league: LEAGUE, match: MATCH, player: ADA, fingerprint: s.fingerprint };
  return { s, facts, envelope: await sealEnvelope({ to: robot.publicKey, ...facts, pickByte: s.pickByte, salt: s.salt }) };
}

test("the robot unlocks what a phone locked, and gets back the prediction and its secret exactly", async () => {
  const { s, facts, envelope } = await sealed();
  assert.equal(envelope.length, 2 * ENVELOPE_BYTES);
  const got = await openEnvelope({ key: await envelopeKey(robot.jwk), envelope, ...facts });
  assert.equal(got.pickByte, s.pickByte);
  assert.equal(toHex(got.salt), toHex(s.salt));
  // What comes out produces the fingerprint that was sealed, which is what lets it be scored.
  assert.equal(toHex(await fingerprintOf({ league: LEAGUE, match: MATCH, sport: FOOTBALL, pickByte: got.pickByte, player: ADA, salt: got.salt })), toHex(s.fingerprint));
});

test("the locked copy says nothing by itself: two copies of the same prediction look nothing alike", async () => {
  const { s, facts, envelope } = await sealed();
  const again = await sealEnvelope({ to: robot.publicKey, ...facts, pickByte: s.pickByte, salt: s.salt });
  assert.notEqual(envelope, again);
  assert.ok(!envelope.includes(toHex(s.salt)), "the secret is not in it in the clear");
  // Past the first byte, which only says what kind of copy it is, nothing is shared.
  assert.notEqual(envelope.slice(2, 40), again.slice(2, 40));
});

test("no other key unlocks it", async () => {
  const { facts, envelope } = await sealed();
  await assert.rejects(openEnvelope({ key: await envelopeKey(other.jwk), envelope, ...facts }), /could not be unlocked/);
});

test("a copy cannot be moved to another match, player, league or fingerprint, or altered", async () => {
  const { facts, envelope } = await sealed();
  const key = await envelopeKey(robot.jwk);
  for (const moved of [{ match: id("another match") }, { player: id("bola") }, { league: id("another league") }, { fingerprint: id("another fingerprint") }]) {
    await assert.rejects(openEnvelope({ key, envelope, ...facts, ...moved }), /could not be unlocked/, Object.keys(moved)[0]);
  }
  const flipped = envelope.slice(0, -2) + (envelope.endsWith("00") ? "01" : "00");
  await assert.rejects(openEnvelope({ key, envelope: flipped, ...facts }), /could not be unlocked/);
  for (const bad of ["", "zz", envelope.slice(2), `02${envelope.slice(2)}`, null]) {
    await assert.rejects(openEnvelope({ key, envelope: bad, ...facts }), /not a locked copy|of a kind this cannot read/);
  }
});

test("a copy is only locked to something that is a robot's key, and only for a real prediction", async () => {
  const { s, facts } = await sealed();
  assert.equal(isEnvelopeKey(robot.publicKey), true);
  for (const bad of [null, "", "04", robot.publicKey.slice(2), robot.publicKey.toUpperCase(), `05${robot.publicKey.slice(2)}`]) {
    assert.equal(isEnvelopeKey(bad), false);
    await assert.rejects(sealEnvelope({ to: bad, ...facts, pickByte: s.pickByte, salt: s.salt }), /not a key/);
  }
  await assert.rejects(sealEnvelope({ to: robot.publicKey, ...facts, pickByte: 256, salt: s.salt }), /not a prediction/);
});

test("the robot's key comes from its wallet key, the same every time, and differs from wallet to wallet", () => {
  assert.deepEqual(envelopeKeysFrom("11".repeat(32)), robot);
  assert.deepEqual(envelopeKeysFrom(`0x${"11".repeat(32)}`), robot, "with or without 0x");
  assert.notEqual(other.publicKey, robot.publicKey);
  assert.equal(isEnvelopeKey(robot.publicKey), true);
  assert.ok(!JSON.stringify(robot).includes("11".repeat(16)), "the wallet's key is not in it");
  assert.throws(() => envelopeKeysFrom(""), /wallet's key is not set/);
  assert.throws(() => envelopeKeysFrom("xyz"), /wallet's key is not set/);
});
