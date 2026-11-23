// Small helpers for working with raw bytes. No dependencies. Works in Node and in a browser.

/** Turn a hex string (with or without 0x) into bytes. */
export function fromHex(hex) {
  if (typeof hex !== "string") throw new TypeError("expected a hex string");
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new Error("not a hex string");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Turn bytes into a lowercase hex string without 0x. */
export function toHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Join byte arrays end to end. */
export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The bytes of a piece of plain text. */
export function text(s) {
  return new TextEncoder().encode(s);
}

/** A whole number from 0 up, written as 8 bytes, biggest part first. */
export function u64(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("expected a whole number from 0 up");
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n));
  return out;
}

/** Accept a 32-byte id as bytes or as hex, and return it as bytes. */
export function id32(value, name) {
  const bytes = typeof value === "string" ? fromHex(value) : value;
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error(`${name} must be 32 bytes`);
  return bytes;
}

/** Compare two byte arrays the way a dictionary orders words. Returns -1, 0 or 1. */
export function compare(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

export function equal(a, b) {
  return a.length === b.length && compare(a, b) === 0;
}

/** SHA-256, using the one built into Node and into every browser. */
export async function sha256(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

/** `n` random bytes from the system's secure source. */
export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
