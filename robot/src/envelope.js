// The robot's key for unlocking predictions after kickoff (see engine/src/envelope.js).
//
// It is not a new secret to look after. It is worked out from the robot's wallet key, which only
// the robot has, so Kickoff's server cannot work it out. The public half is safe to print, and is
// written into the website so every phone locks its copies to this robot and no other.

import { createECDH, hkdfSync } from "node:crypto";

import { envelopeKey, openEnvelope, toHex } from "../../engine/src/index.js";

/** The order of the P-256 curve: a private key is a number from 1 to one less than this. */
const ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");

/**
 * The key pair, from the wallet's private key.
 * @param secret  the wallet's private key, as hex, with or without 0x
 * @returns { publicKey: hex of 65 bytes, jwk: { d, x, y } }
 */
export function envelopeKeysFrom(secret) {
  const tidy = String(secret ?? "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(tidy)) throw new Error("the wallet's key is not set, so the key for unlocking predictions cannot be worked out");
  for (let n = 1; ; n++) {
    const d = Buffer.from(hkdfSync("sha256", Buffer.from(tidy, "hex"), Buffer.alloc(0), `kickoff robot unlocking key v1 #${n}`, 32));
    const number = BigInt(`0x${d.toString("hex")}`);
    if (number === 0n || number >= ORDER) continue; // one chance in four thousand million: take the next
    const pair = createECDH("prime256v1");
    pair.setPrivateKey(d);
    const publicKey = pair.getPublicKey();
    return { publicKey: toHex(publicKey), jwk: { d: b64(d), x: b64(publicKey.subarray(1, 33)), y: b64(publicKey.subarray(33)) } };
  }
}

/**
 * Something that unlocks copies, for chainTick().
 * @returns an async function ({ league, match, player, fingerprint, envelope }) -> { pickByte, salt as hex }
 */
export function createOpener(secret) {
  const { jwk } = envelopeKeysFrom(secret);
  let key = null;
  return async ({ league, match, player, fingerprint, envelope }) => {
    key ??= await envelopeKey(jwk);
    const { pickByte, salt } = await openEnvelope({ key, envelope, league, match, player, fingerprint });
    return { pickByte, salt: toHex(salt) };
  };
}
