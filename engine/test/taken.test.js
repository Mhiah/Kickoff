// Kickoff's signed word that it took a sealed prediction: only the server's key makes one, and it
// stands for exactly the prediction, player, match and time it names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { isServerKey, signTaken, takenText, toHex, verifyTaken } from "../src/index.js";
import { signingKeysFrom } from "../../server/src/signing.js";

const id = (words) => createHash("sha256").update(words).digest("hex");
const server = signingKeysFrom("the server's secret, long enough to use");
const other = signingKeysFrom("somebody else's secret, just as long");
const FACTS = { league: id("the league"), match: id("Arsenal v Chelsea"), player: id("ada"), fingerprint: id("2 - 1, sealed"), receivedAt: 1_800_000_000, closesAt: 1_800_003_000 };

const note = async (facts = FACTS, keys = server) => ({ key: keys.publicKey, sig: await signTaken({ privateJwk: keys.jwk, ...facts }), ...facts });

test("a note the server signed checks out against the server's public key", async () => {
  const n = await note();
  assert.ok(isServerKey(n.key));
  assert.match(n.sig, /^[0-9a-f]{128}$/);
  assert.equal(await verifyTaken(n), true);
});

test("what is signed is plain text that names everything the note stands for", () => {
  assert.equal(takenText(FACTS), `kickoff/taken/v1\n${FACTS.league}\n${FACTS.match}\n${FACTS.player}\n${FACTS.fingerprint}\n1800000000\n1800003000`);
});

test("CHEAT: a note cannot be moved to another prediction, player, match, league or time", async () => {
  const n = await note();
  const changes = {
    league: id("another league"),
    match: id("Spurs v Newcastle"),
    player: id("bola"),
    fingerprint: id("3 - 0, sealed"),
    receivedAt: FACTS.receivedAt - 3600,
    closesAt: FACTS.closesAt + 3600,
  };
  for (const [name, value] of Object.entries(changes)) {
    assert.equal(await verifyTaken({ ...n, [name]: value }), false, `the ${name} was changed and the note still passed`);
  }
});

test("CHEAT: a note signed by anybody else's key is not Kickoff's", async () => {
  const forged = await note(FACTS, other);
  // Checked against the key that signed it, it is a real signature. Against Kickoff's, it is nothing.
  assert.equal(await verifyTaken(forged), true);
  assert.equal(await verifyTaken({ ...forged, key: server.publicKey }), false);
});

test("CHEAT: a signature that has been altered, cut short or made up is refused, without anything breaking", async () => {
  const n = await note();
  const flipped = `${n.sig.slice(0, -1)}${n.sig.endsWith("0") ? "1" : "0"}`;
  for (const sig of [flipped, n.sig.slice(2), "00".repeat(64), "", null, undefined, 7]) {
    assert.equal(await verifyTaken({ ...n, sig }), false);
  }
  for (const key of ["", null, "04", `05${n.key.slice(2)}`, `04${"00".repeat(64)}`]) {
    assert.equal(await verifyTaken({ ...n, key }), false);
  }
});

test("nothing loose is ever signed: every part has to be in its exact form", async () => {
  // A line break inside a part could make one note read as another.
  const loose = [
    { player: `${FACTS.player}\n${FACTS.fingerprint}` },
    { match: FACTS.match.toUpperCase() },
    { fingerprint: FACTS.fingerprint.slice(2) },
    { league: null },
    { receivedAt: "1800000000" },
    { receivedAt: 1.5 },
    { closesAt: -1 },
  ];
  for (const change of loose) {
    assert.throws(() => takenText({ ...FACTS, ...change }));
    await assert.rejects(signTaken({ privateJwk: server.jwk, ...FACTS, ...change }));
    assert.equal(await verifyTaken({ ...(await note()), ...change }), false);
  }
});

test("the server's signing key is worked out from its secret: the same secret gives the same key, another gives another", () => {
  assert.equal(signingKeysFrom("the server's secret, long enough to use").publicKey, server.publicKey);
  assert.notEqual(other.publicKey, server.publicKey);
  assert.ok(isServerKey(server.publicKey));
  // A secret too short to be safe gives no key at all.
  for (const weak of ["", "dev", "x".repeat(23), null, undefined, 12345]) assert.throws(() => signingKeysFrom(weak));
  // The public half does not carry the secret.
  assert.ok(!server.publicKey.includes(toHex(new TextEncoder().encode("the server's secret")).slice(0, 16)));
});
