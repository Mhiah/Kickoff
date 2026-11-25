// A prediction's locked copy: what lets a prediction be opened after kickoff without the phone
// that made it.
//
// When a player predicts, only a fingerprint goes on the record. The prediction and its secret
// stay on the phone, and to score it somebody has to hand them over once the match has started.
// If that had to be the phone, a player who never came back would never be scored.
//
// So the phone also sends a locked copy of the prediction and its secret, which only Kickoff's
// robot can unlock. Kickoff's server keeps it and cannot read it, and it hands it to nobody, not
// even the robot, until the match has started. Then the robot unlocks it, and from there it is
// treated exactly as if the phone had handed it over: it still has to produce the fingerprint
// that was locked before kickoff, so a locked copy can be read but can never change a prediction.
//
// What this does and does not promise:
//   - nobody can change a prediction after it is locked. That is the fingerprint's job.
//   - no other player, and nobody who only has Kickoff's database, can read one before kickoff.
//   - whoever holds the robot's key AND the database could read one before kickoff. Kickoff does
//     not, but that is Kickoff's word and not something anyone can check.
//
// How it is locked: the phone makes a key pair for this one copy, agrees a secret with the
// robot's public key (ECDH on P-256), turns that into a key (HKDF-SHA-256) and locks the copy
// with it (AES-256-GCM). The league, the match, the player and the fingerprint are bound in, so a
// copy cannot be moved to another match or another player.
//
//   1 byte    version (1)
//   65 bytes  the phone's public key for this copy
//   12 bytes  a number used once
//   49 bytes  the locked prediction (1 byte) and its secret (32 bytes), with the lock's own check

import { concat, fromHex, id32, text, toHex } from "./bytes.js";

const VERSION = 1;
const CURVE = { name: "ECDH", namedCurve: "P-256" };
/** How long a locked copy is, in bytes. */
export const ENVELOPE_BYTES = 1 + 65 + 12 + 33 + 16;

const subtle = () => globalThis.crypto.subtle;
const bound = ({ league, match, player, fingerprint }) => concat(id32(league, "league"), id32(match, "match"), id32(player, "player"), id32(fingerprint, "fingerprint"));

async function lockKey(shared, phoneKey) {
  const base = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: concat(text("kickoff locked copy v1"), phoneKey) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Is this the public key of a robot, as it is written down: 65 bytes as hex, starting 04? */
export const isEnvelopeKey = (key) => typeof key === "string" && /^04[0-9a-f]{128}$/.test(key);

/**
 * Lock a copy of a prediction so that only the robot can unlock it.
 * @param to  the robot's public key, as hex
 * @returns the locked copy, as hex
 */
export async function sealEnvelope({ to, league, match, player, fingerprint, pickByte, salt }) {
  if (!isEnvelopeKey(to)) throw new Error("that is not a key a copy can be locked to");
  if (!Number.isInteger(pickByte) || pickByte < 0 || pickByte > 255) throw new Error("that is not a prediction");
  const robot = await subtle().importKey("raw", fromHex(to), CURVE, false, []);
  const phone = await subtle().generateKey(CURVE, true, ["deriveBits"]);
  const phoneKey = new Uint8Array(await subtle().exportKey("raw", phone.publicKey));
  const key = await lockKey(await subtle().deriveBits({ name: "ECDH", public: robot }, phone.privateKey, 256), phoneKey);
  const once = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const inside = concat(Uint8Array.of(pickByte), id32(salt, "salt"));
  const locked = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: once, additionalData: bound({ league, match, player, fingerprint }) }, key, inside));
  return toHex(concat(Uint8Array.of(VERSION), phoneKey, once, locked));
}

/**
 * The robot's private key, ready to unlock with.
 * @param jwk  { d, x, y } as the web's key format writes them
 */
export const envelopeKey = (jwk) => subtle().importKey("jwk", { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y, ext: true }, CURVE, false, ["deriveBits"]);

/**
 * Unlock a copy. Throws if it is not a copy this key can unlock, or if it was locked for another
 * league, match, player or fingerprint.
 * @param key  from envelopeKey()
 * @returns { pickByte, salt }
 */
export async function openEnvelope({ key, envelope, league, match, player, fingerprint }) {
  if (typeof envelope !== "string" || !/^[0-9a-f]+$/.test(envelope) || envelope.length !== 2 * ENVELOPE_BYTES) throw new Error("that is not a locked copy");
  const bytes = fromHex(envelope);
  if (bytes[0] !== VERSION) throw new Error("that locked copy is of a kind this cannot read");
  const phoneKey = bytes.subarray(1, 66);
  const once = bytes.subarray(66, 78);
  const phone = await subtle().importKey("raw", phoneKey, CURVE, false, []);
  const lock = await lockKey(await subtle().deriveBits({ name: "ECDH", public: phone }, key, 256), phoneKey);
  let inside;
  try {
    inside = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: once, additionalData: bound({ league, match, player, fingerprint }) }, lock, bytes.subarray(78)));
  } catch {
    throw new Error("the locked copy could not be unlocked");
  }
  return { pickByte: inside[0], salt: inside.subarray(1) };
}
