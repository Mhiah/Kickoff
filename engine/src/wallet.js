// A wallet proving it stands behind a player.
//
// A player is a device key (identity.js). A player who also has a wallet can link the two: the
// wallet signs a short note naming the player, and anyone holding that note can check the wallet
// really signed it. Signing costs nothing and sends nothing to any chain.
//
// The note is signed the way every Ethereum-style wallet signs a message ("personal_sign"): the
// text is fingerprinted with Keccak-256 behind a fixed prefix, and signed on the secp256k1 curve.
// A wallet's address is the last 20 bytes of the Keccak-256 of its public key. So the check is:
// work out which public key made the signature, turn it into an address, and compare.
//
// Neither Node nor a browser has this curve built in for that purpose, so the arithmetic is
// written out here with nothing to install. It only ever checks signatures. It never signs, and
// never touches a private key. The tests check it against a signature published elsewhere and
// against keys made by Node's own cryptography.

import { concat, fromHex, text, toHex } from "./bytes.js";
import { walletLinkText } from "./identity.js";
import { keccak256 } from "./keccak.js";

/** How old a link note may be when it reaches the server, in seconds. Signing in a wallet takes a person a moment. */
export const WALLET_LINK_WINDOW = 15 * 60;

// The secp256k1 curve: y^2 = x^3 + 7 over the field of whole numbers below P.
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

const mod = (a, m) => ((a % m) + m) % m;

function power(base, exponent, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}
const inverse = (a, m) => power(a, m - 2n, m); // m is prime

// Points are kept as [X, Y, Z] standing for (X/Z^2, Y/Z^3), so adding needs no division.
// Z = 0 is the point at infinity.
const INFINITY = [0n, 1n, 0n];

function double([x, y, z]) {
  if (z === 0n || y === 0n) return INFINITY;
  const yy = (y * y) % P;
  const s = (4n * x * yy) % P;
  const m = (3n * x * x) % P;
  const x3 = mod(m * m - 2n * s, P);
  return [x3, mod(m * (s - x3) - 8n * yy * yy, P), (2n * y * z) % P];
}

function add(a, b) {
  if (a[2] === 0n) return b;
  if (b[2] === 0n) return a;
  const [x1, y1, z1] = a;
  const [x2, y2, z2] = b;
  const z1z1 = (z1 * z1) % P;
  const z2z2 = (z2 * z2) % P;
  const u1 = (x1 * z2z2) % P;
  const u2 = (x2 * z1z1) % P;
  const s1 = (y1 * z2 * z2z2) % P;
  const s2 = (y2 * z1 * z1z1) % P;
  if (u1 === u2) return s1 === s2 ? double(a) : INFINITY;
  const h = mod(u2 - u1, P);
  const r = mod(s2 - s1, P);
  const hh = (h * h) % P;
  const hhh = (h * hh) % P;
  const v = (u1 * hh) % P;
  const x3 = mod(r * r - hhh - 2n * v, P);
  return [x3, mod(r * (v - x3) - s1 * hhh, P), (h * z1 * z2) % P];
}

function times(point, scalar) {
  let result = INFINITY;
  let p = point;
  let k = scalar;
  while (k > 0n) {
    if (k & 1n) result = add(result, p);
    p = double(p);
    k >>= 1n;
  }
  return result;
}

function plain([x, y, z]) {
  if (z === 0n) return null;
  const zi = inverse(z, P);
  const zi2 = (zi * zi) % P;
  return [(x * zi2) % P, (y * zi2 * zi) % P];
}

const number = (bytes) => BigInt(`0x${toHex(bytes) || "0"}`);
const bytes32 = (n) => fromHex(n.toString(16).padStart(64, "0"));

/** The address that belongs to a public key, given as its two 32-byte halves. Lowercase, with 0x. */
function addressOf([x, y]) {
  return `0x${toHex(keccak256(concat(bytes32(x), bytes32(y))).subarray(12))}`;
}

/**
 * The address of the wallet that signed a 32-byte fingerprint.
 * @param hash       32 bytes
 * @param signature  65 bytes: r, s, then one byte that is 0, 1, 27 or 28
 * Throws if the signature is not a possible one.
 */
export function recoverAddress(hash, signature) {
  if (!(hash instanceof Uint8Array) || hash.length !== 32) throw new Error("not a 32-byte fingerprint");
  if (!(signature instanceof Uint8Array) || signature.length !== 65) throw new Error("a wallet's signature is 65 bytes");
  const r = number(signature.subarray(0, 32));
  const s = number(signature.subarray(32, 64));
  const last = signature[64];
  const odd = last === 1 || last === 28 ? 1n : last === 0 || last === 27 ? 0n : null;
  if (odd === null) throw new Error("the signature's last byte is not one a wallet writes");
  if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error("the signature's numbers are out of range");
  // The point the signer used: its x is r, and its y is whichever root has the right oddness.
  const ySquared = mod(r * r * r + 7n, P);
  let y = power(ySquared, (P + 1n) / 4n, P);
  if ((y * y) % P !== ySquared) throw new Error("the signature does not point at the curve");
  if ((y & 1n) !== odd) y = P - y;
  // public key = (s * R - z * G) / r
  const z = number(hash);
  const ri = inverse(r, N);
  const key = plain(add(times([r, y, 1n], mod(s * ri, N)), times([GX, GY, 1n], mod(-z * ri, N))));
  if (!key) throw new Error("the signature does not give a key");
  return addressOf(key);
}

/** The fingerprint a wallet signs for a piece of text ("personal_sign"). */
export function personalMessageHash(message) {
  const body = text(message);
  return keccak256(concat(text(`\u0019Ethereum Signed Message:\n${body.length}`), body));
}

/** The address of the wallet that signed a piece of text with "personal_sign". `signature` is hex. */
export function signerOfText(message, signature) {
  return recoverAddress(personalMessageHash(message), fromHex(signature));
}

const ADDRESS = /^0x[0-9a-f]{40}$/;

/**
 * Check a wallet's link to a player.
 * @param player     the player id, 64 hex digits
 * @param wallet     the wallet's address
 * @param at         the time written in the note, in seconds
 * @param signature  the wallet's signature of the note, as hex
 * @param now        the time now, in seconds. Leave it out to check an old link without minding its age.
 * @returns the wallet's address, in lowercase
 * Throws, with a plain reason, if the note was not signed by that wallet.
 */
export function verifyWalletLink({ player, wallet, at, signature, now }) {
  const address = String(wallet ?? "").toLowerCase();
  if (!ADDRESS.test(address)) throw new Error("that is not a wallet address");
  if (typeof player !== "string" || !/^[0-9a-f]{64}$/.test(player)) throw new Error("that is not a player");
  if (!Number.isSafeInteger(at)) throw new Error("the link has no time on it");
  if (typeof signature !== "string" || !/^(0x)?[0-9a-fA-F]{130}$/.test(signature)) throw new Error("the wallet's signature is not in the right form");
  if (now !== undefined && (at > now + 5 * 60 || now - at > WALLET_LINK_WINDOW)) throw new Error("the link was signed too long ago. Sign it again.");
  let signer;
  try {
    signer = signerOfText(walletLinkText({ player, wallet: address, at }), signature);
  } catch {
    throw new Error("the wallet's signature could not be read");
  }
  if (signer !== address) throw new Error("that wallet did not sign this link");
  return address;
}
