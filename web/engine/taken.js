// Kickoff's signed word that it took a sealed prediction.
//
// A receipt (bundle.js) proves a sealed prediction IS in the bundle that was locked. It cannot
// help a player whose prediction was left out: there is no receipt for them at all, and before
// this there was nothing to show that Kickoff had ever been given the prediction.
//
// So every time Kickoff's server takes a sealed prediction, it signs a short note saying so and
// sends it back. The phone checks the signature and keeps the note. If the prediction is then
// missing from the locked bundle, the player holds something Kickoff signed and cannot deny:
// "I took this fingerprint, from this player, for this match, at this time, before predictions
// closed."
//
// What it does not settle: a player may send a later prediction for the same match, which
// replaces the earlier one, and then holds two notes. The note for the earlier one is still
// truly signed. Kickoff's answer to it is the bundle itself, which holds the later one.
//
//   key          ECDSA on the P-256 curve, with SHA-256: the kind every browser can check
//   what is signed, as text:
//
//       kickoff/taken/v1
//       <the league's id>
//       <the match's id>
//       <the player's id>
//       <the sealed prediction's fingerprint>
//       <when the server took it, in seconds>
//       <when predictions for the match close, in seconds>

import { fromHex, text, toHex } from "./bytes.js";

const CURVE = { name: "ECDSA", namedCurve: "P-256" };
const SIGNING = { name: "ECDSA", hash: "SHA-256" };
const ID = /^[0-9a-f]{64}$/;

const subtle = () => globalThis.crypto.subtle;

/** True if this is a public key a note can be checked against: 65 bytes, as hex. */
export const isServerKey = (key) => typeof key === "string" && /^04[0-9a-f]{128}$/.test(key);

/** Exactly what is signed. Throws if any part is not in the right form, so nothing loose is ever signed. */
export function takenText({ league, match, player, fingerprint, receivedAt, closesAt }) {
  for (const [name, value] of Object.entries({ league, match, player, fingerprint })) {
    if (typeof value !== "string" || !ID.test(value)) throw new Error(`the ${name} is not 64 hex digits`);
  }
  if (!Number.isSafeInteger(receivedAt) || !Number.isSafeInteger(closesAt) || receivedAt < 0 || closesAt < 0) throw new Error("the times are not whole seconds");
  return `kickoff/taken/v1\n${league}\n${match}\n${player}\n${fingerprint}\n${receivedAt}\n${closesAt}`;
}

/**
 * Sign a note. Only Kickoff's server does this.
 * @param privateJwk  the server's signing key, as a JWK
 * @returns the signature, as hex (64 bytes)
 */
export async function signTaken({ privateJwk, league, match, player, fingerprint, receivedAt, closesAt }) {
  const key = await subtle().importKey("jwk", privateJwk, CURVE, false, ["sign"]);
  const signature = await subtle().sign(SIGNING, key, text(takenText({ league, match, player, fingerprint, receivedAt, closesAt })));
  return toHex(new Uint8Array(signature));
}

/**
 * Check a note. Anyone can do this: it needs only the server's public key.
 * @param key  the server's public key, as hex
 * @param sig  the signature, as hex
 * @returns true only if `key` signed exactly these facts
 */
export async function verifyTaken({ key, sig, league, match, player, fingerprint, receivedAt, closesAt }) {
  if (!isServerKey(key) || typeof sig !== "string" || !/^[0-9a-f]{128}$/.test(sig)) return false;
  let signed;
  try {
    signed = takenText({ league, match, player, fingerprint, receivedAt, closesAt });
  } catch {
    return false;
  }
  try {
    const publicKey = await subtle().importKey("raw", fromHex(key), CURVE, false, ["verify"]);
    return await subtle().verify(SIGNING, publicKey, fromHex(sig), text(signed));
  } catch {
    return false;
  }
}
