// The server's key for signing that it took a sealed prediction (see engine/src/taken.js).
//
// It is not a new secret to look after. It is worked out from the key the server already holds
// (KICKOFF_ADMIN_KEY), so nothing new has to be created or stored. The public half is safe to
// print, and is written into the website (SERVER_KEY in web/config.js) so every phone checks
// notes against this server's key and no other.
//
// If KICKOFF_ADMIN_KEY is ever changed, this key changes with it, and SERVER_KEY in web/config.js
// has to be changed to match: the "Server's public key" action prints the new one.

import { createECDH, hkdfSync } from "node:crypto";

import { signTaken, toHex } from "../../engine/src/index.js";

/** The order of the P-256 curve: a private key is a number from 1 to one less than this. */
const ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
/** A secret shorter than this is not safe to make a key from, and none is made. */
export const MIN_SECRET = 24;
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");

/**
 * The key pair, from the server's secret.
 * @param secret  KICKOFF_ADMIN_KEY, as it is
 * @returns { publicKey: hex of 65 bytes, jwk } for signing
 */
export function signingKeysFrom(secret) {
  if (typeof secret !== "string" || secret.length < MIN_SECRET) throw new Error(`the server's key is not set, or is shorter than ${MIN_SECRET} characters, so the key for signing cannot be worked out`);
  for (let n = 1; ; n++) {
    const d = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), `kickoff server signing key v1 #${n}`, 32));
    const number = BigInt(`0x${d.toString("hex")}`);
    if (number === 0n || number >= ORDER) continue; // one chance in four thousand million: take the next
    const pair = createECDH("prime256v1");
    pair.setPrivateKey(d);
    const publicKey = pair.getPublicKey();
    return { publicKey: toHex(publicKey), jwk: { kty: "EC", crv: "P-256", d: b64(d), x: b64(publicKey.subarray(1, 33)), y: b64(publicKey.subarray(33)) } };
  }
}

/**
 * Something that signs notes, for createKickoff().
 * @returns { publicKey, sign({ league, match, player, fingerprint, receivedAt, closesAt }) -> signature as hex },
 *          or null if the secret is missing or too short to be safe. A server without one still
 *          takes predictions; it just signs nothing.
 */
export function createSigner(secret) {
  let keys;
  try {
    keys = signingKeysFrom(secret);
  } catch {
    return null;
  }
  return { publicKey: keys.publicKey, sign: (facts) => signTaken({ privateJwk: keys.jwk, ...facts }) };
}
