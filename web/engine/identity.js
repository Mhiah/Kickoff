// A device proving it is itself.
//
// A player has no account and no wallet. Their device makes a key the first time they play: a
// private half that never leaves the device, and a public half that anyone may see. The player's
// id is worked out from the public half, so nobody can claim an id without holding its key.
//
// Everything a device sends to Kickoff's server is signed with the private half. The server checks
// the signature, so nobody else can send a pick, change one, or open one in that player's name,
// even though player ids are public.
//
//   key          ECDSA on the P-256 curve, the kind every browser has built in
//   player id    SHA-256 of "kickoff/player/v1" (17 bytes) followed by the public key (65 bytes)
//   what is signed, as text:
//
//       kickoff/request/v1
//       <METHOD> <path>
//       <the time, in seconds>
//       <what is being sent, as JSON text>
//
// The time is inside what is signed, so an old request cannot be sent again later.

import { concat, fromHex, sha256, text, toHex } from "./bytes.js";

const PLAYER_TAG = text("kickoff/player/v1");
const CURVE = { name: "ECDSA", namedCurve: "P-256" };
const SIGNING = { name: "ECDSA", hash: "SHA-256" };

/** How far a request's time may be from the server's, in seconds. */
export const REQUEST_WINDOW = 5 * 60;

const subtle = () => globalThis.crypto.subtle;

/** Make a new device key. Returns the private half as a JWK (to keep on the device) and the public half as bytes. */
export async function newDeviceKey() {
  const pair = await subtle().generateKey(CURVE, true, ["sign", "verify"]);
  return {
    privateJwk: await subtle().exportKey("jwk", pair.privateKey),
    publicKey: new Uint8Array(await subtle().exportKey("raw", pair.publicKey)),
  };
}

/** The player id that belongs to a public key. */
export async function playerIdOf(publicKey) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("not a device's public key");
  return sha256(concat(PLAYER_TAG, publicKey));
}

/**
 * The note a wallet signs to link itself to a player. It is shown to the person in their wallet,
 * so it is written to be read. The check of the signature is in wallet.js.
 * @param player  the player id, 64 hex digits
 * @param wallet  the wallet's address
 * @param at      the time, in seconds
 */
export function walletLinkText({ player, wallet, at }) {
  return `Kickoff: link this wallet to my player.\nSigning is free and sends nothing.\n\nPlayer: ${player}\nWallet: ${String(wallet).toLowerCase()}\nTime: ${at}`;
}

/** Exactly what is signed for a request. */
export function requestText({ method, path, at, payload }) {
  return `kickoff/request/v1\n${method.toUpperCase()} ${path}\n${at}\n${payload}`;
}

/**
 * Sign a request on the device.
 * @param payload  what is being sent, as a plain object
 * @param at       the time now, in seconds
 * @returns what to send: { payload (as text), key, at, sig }
 */
export async function signRequest({ privateJwk, publicKey, method, path, payload, at }) {
  const key = await subtle().importKey("jwk", privateJwk, CURVE, false, ["sign"]);
  const asText = JSON.stringify(payload);
  const signature = await subtle().sign(SIGNING, key, text(requestText({ method, path, at, payload: asText })));
  return { payload: asText, key: toHex(publicKey), at, sig: toHex(new Uint8Array(signature)) };
}

/**
 * Check a signed request on the server.
 * @param envelope  what the device sent: { payload, key, at, sig }
 * @param now       the server's time, in seconds
 * @returns { player, payload, at }: the player id the key belongs to, and what was sent
 * Throws, with a plain reason, if the request is not properly signed or is too old.
 */
export async function verifyRequest({ method, path, envelope, now }) {
  const e = envelope;
  if (!e || typeof e.payload !== "string" || typeof e.key !== "string" || typeof e.sig !== "string" || !Number.isSafeInteger(e.at)) {
    throw new Error("the request is not signed");
  }
  if (!/^04[0-9a-f]{128}$/.test(e.key) || !/^[0-9a-f]{128}$/.test(e.sig)) throw new Error("the request's signature is not in the right form");
  if (Math.abs(now - e.at) > REQUEST_WINDOW) throw new Error("the request's time is too far from now. Check the clock on your device.");
  const publicKey = fromHex(e.key);
  let key;
  try {
    key = await subtle().importKey("raw", publicKey, CURVE, false, ["verify"]);
  } catch {
    throw new Error("the request's key is not a real key");
  }
  const ok = await subtle().verify(SIGNING, key, fromHex(e.sig), text(requestText({ method, path, at: e.at, payload: e.payload })));
  if (!ok) throw new Error("the request's signature does not match");
  let payload;
  try {
    payload = JSON.parse(e.payload);
  } catch {
    throw new Error("the request could not be read");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new Error("the request could not be read");
  return { player: await playerIdOf(publicKey), payload, at: e.at };
}
