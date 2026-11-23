import { test } from "node:test";
import assert from "node:assert/strict";
import { FOOTBALL, BASKETBALL, fingerprintOf, sealPick, toHex } from "../src/index.js";
import { LEAGUE, MATCH, OTHER_MATCH, id, nodeSha256 } from "./helpers.js";

const PLAYER = id("ada");
const SALT = id("ada's salt");
const base = { league: LEAGUE, match: MATCH, sport: FOOTBALL, pickByte: 0x12, player: PLAYER, salt: SALT };

test("the fingerprint is the SHA-256 of the 145 bytes the engine says it is", async () => {
  // Built here by hand, with Node's own SHA-256, without using any of the engine's code.
  const expected = nodeSha256(
    Buffer.from("kickoff/pick/v1", "ascii"),
    LEAGUE,
    MATCH,
    Uint8Array.of(FOOTBALL),
    Uint8Array.of(0x12),
    PLAYER,
    SALT,
  );
  assert.equal(15 + 32 + 32 + 1 + 1 + 32 + 32, 145);
  assert.equal(toHex(await fingerprintOf(base)), toHex(expected));
});

test("the same pick and salt always give the same fingerprint", async () => {
  assert.equal(toHex(await fingerprintOf(base)), toHex(await fingerprintOf({ ...base })));
});

test("changing anything at all changes the fingerprint", async () => {
  const original = toHex(await fingerprintOf(base));
  const changes = {
    "another league": { league: id("another league") },
    "another match": { match: OTHER_MATCH },
    "another sport": { sport: BASKETBALL },
    "another score": { pickByte: 0x13 },
    "another player": { player: id("bola") },
    "another salt": { salt: id("another salt") },
  };
  for (const [what, change] of Object.entries(changes)) {
    assert.notEqual(toHex(await fingerprintOf({ ...base, ...change })), original, what);
  }
});

test("sealing a pick makes a fresh 32-byte salt each time, so the same pick sealed twice looks different", async () => {
  const args = { league: LEAGUE, match: MATCH, sport: FOOTBALL, pick: { home: 2, away: 1 }, player: PLAYER };
  const first = await sealPick(args);
  const second = await sealPick(args);
  assert.equal(first.salt.length, 32);
  assert.equal(first.pickByte, 0x12);
  assert.notEqual(toHex(first.salt), toHex(second.salt));
  assert.notEqual(toHex(first.fingerprint), toHex(second.fingerprint));
  // And the fingerprint is the one fingerprintOf gives for that salt.
  assert.equal(
    toHex(first.fingerprint),
    toHex(await fingerprintOf({ ...base, salt: first.salt })),
  );
});

test("a pick that cannot happen cannot be sealed", async () => {
  await assert.rejects(
    sealPick({ league: LEAGUE, match: MATCH, sport: FOOTBALL, pick: { home: 20, away: 0 }, player: PLAYER }),
    RangeError,
  );
});

test("ids must be exactly 32 bytes", async () => {
  await assert.rejects(fingerprintOf({ ...base, league: new Uint8Array(31) }), /league must be 32 bytes/);
  await assert.rejects(fingerprintOf({ ...base, salt: new Uint8Array(33) }), /salt must be 32 bytes/);
});
