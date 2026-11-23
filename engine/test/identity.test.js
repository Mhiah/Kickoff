import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createVerify } from "node:crypto";

import { REQUEST_WINDOW, newDeviceKey, playerIdOf, requestText, signRequest, toHex, verifyRequest } from "../src/index.js";

const NOW = 1_800_000_000;
const send = { method: "POST", path: "/api/picks", payload: { match: "ab".repeat(32), fingerprint: "cd".repeat(32) } };
const signed = async (device, extra = {}) => signRequest({ ...device, ...send, at: NOW, ...extra });
const check = (envelope, extra = {}) => verifyRequest({ method: send.method, path: send.path, envelope, now: NOW, ...extra });

test("a player's id is the SHA-256 of a fixed label and their device's public key", async () => {
  const device = await newDeviceKey();
  assert.equal(device.publicKey.length, 65);
  const expected = createHash("sha256").update("kickoff/player/v1").update(device.publicKey).digest("hex");
  assert.equal(toHex(await playerIdOf(device.publicKey)), expected);
  const other = await newDeviceKey();
  assert.notEqual(toHex(await playerIdOf(other.publicKey)), expected, "two devices never share an id");
  await assert.rejects(playerIdOf(new Uint8Array(65)), /not a device's public key/);
  await assert.rejects(playerIdOf(device.publicKey.slice(0, 33)), /not a device's public key/);
});

test("a signed request is accepted, and names the player it came from", async () => {
  const device = await newDeviceKey();
  const got = await check(await signed(device));
  assert.equal(toHex(got.player), toHex(await playerIdOf(device.publicKey)));
  assert.deepEqual(got.payload, send.payload);
  assert.equal(got.at, NOW);
});

test("what is signed is laid out exactly as identity.js says, and a separate library agrees", async () => {
  const device = await newDeviceKey();
  const envelope = await signed(device);
  const words = requestText({ method: "post", path: send.path, at: NOW, payload: envelope.payload });
  assert.equal(words, `kickoff/request/v1\nPOST /api/picks\n${NOW}\n${JSON.stringify(send.payload)}`);
  // Node's own signature checker, separate from the one the engine uses.
  const verifier = createVerify("SHA256").update(words);
  const publicKey = { key: { kty: "EC", crv: "P-256", x: device.privateJwk.x, y: device.privateJwk.y }, format: "jwk", dsaEncoding: "ieee-p1363" };
  assert.equal(verifier.verify(publicKey, Buffer.from(envelope.sig, "hex")), true);
});

test("CHEAT: changing anything in a signed request breaks it", async () => {
  const device = await newDeviceKey();
  const envelope = await signed(device);
  const swapped = JSON.stringify({ ...send.payload, fingerprint: "ee".repeat(32) });
  await assert.rejects(check({ ...envelope, payload: swapped }), /signature does not match/);
  await assert.rejects(check({ ...envelope, at: NOW + 1 }), /signature does not match/);
  await assert.rejects(check(envelope, { path: "/api/opened" }), /signature does not match/);
  await assert.rejects(check(envelope, { method: "DELETE" }), /signature does not match/);
});

test("CHEAT: signing with your own key does not let you speak as someone else", async () => {
  const victim = await newDeviceKey();
  const attacker = await newDeviceKey();
  // The attacker signs, then claims the victim's public key.
  const forged = { ...(await signed(attacker)), key: toHex(victim.publicKey) };
  await assert.rejects(check(forged), /signature does not match/);
  // Sent honestly under the attacker's own key, it is the attacker's id, not the victim's.
  const honest = await check(await signed(attacker));
  assert.notEqual(toHex(honest.player), toHex(await playerIdOf(victim.publicKey)));
});

test("CHEAT: an old request cannot be sent again later", async () => {
  const device = await newDeviceKey();
  const envelope = await signed(device);
  await check(envelope, { now: NOW + REQUEST_WINDOW }); // still inside the window
  await assert.rejects(check(envelope, { now: NOW + REQUEST_WINDOW + 1 }), /too far from now/);
  await assert.rejects(check(envelope, { now: NOW - REQUEST_WINDOW - 1 }), /too far from now/);
});

test("requests that are not signed, or are malformed, are refused with a reason", async () => {
  const device = await newDeviceKey();
  const envelope = await signed(device);
  await assert.rejects(check(null), /not signed/);
  await assert.rejects(check({}), /not signed/);
  await assert.rejects(check({ ...envelope, at: "now" }), /not signed/);
  await assert.rejects(check({ ...envelope, sig: "zz" }), /not in the right form/);
  await assert.rejects(check({ ...envelope, key: "04" + "00".repeat(64) }), /not a real key|does not match/);
  const notAnObject = await signRequest({ ...device, method: send.method, path: send.path, payload: [1, 2], at: NOW });
  await assert.rejects(check(notAnObject), /could not be read/);
});

test("signing the same thing twice gives two different signatures, and both are accepted", async () => {
  const device = await newDeviceKey();
  const a = await signed(device);
  const b = await signed(device);
  assert.notEqual(a.sig, b.sig);
  await check(a);
  await check(b);
});
