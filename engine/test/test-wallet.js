// A wallet for the tests. It signs the way a real wallet's "personal_sign" does.
//
// It shares no arithmetic with engine/src/wallet.js, which is the point: the curve work here is
// done by Node's own cryptography (OpenSSL), so the tests check Kickoff's reading of a signature
// against an independent maker of signatures.
import { createECDH, createHash } from "node:crypto";

import { keccak256, personalMessageHash, toHex } from "../src/index.js";

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const big = (bytes) => BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
const b32 = (n) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");

function power(base, exponent, m) {
  let result = 1n;
  let b = base % m;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/** The public point for a private number, from OpenSSL: 65 bytes, 04 then x then y. */
function point(d) {
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(b32(d));
  return ecdh.getPublicKey();
}

/** A wallet made from any text. The same text always gives the same wallet. */
export function testWallet(seed) {
  const d = (big(createHash("sha256").update(`kickoff test wallet ${seed}`).digest()) % (N - 1n)) + 1n;
  const address = `0x${toHex(keccak256(new Uint8Array(point(d).subarray(1))).subarray(12))}`;
  return {
    address,
    /** Sign a piece of text, as personal_sign does. Returns 0x and 130 hex digits. */
    sign(message) {
      const hash = personalMessageHash(message);
      const z = big(hash);
      for (let n = 0; ; n++) {
        const k = (big(createHash("sha256").update(b32(d)).update(Buffer.from(hash)).update(String(n)).digest()) % (N - 1n)) + 1n;
        const R = point(k);
        const r = big(R.subarray(1, 33)) % N;
        let odd = R[64] & 1;
        let s = (power(k, N - 2n, N) * ((z + r * d) % N)) % N;
        if (r === 0n || s === 0n) continue;
        if (s > N / 2n) {
          s = N - s;
          odd ^= 1;
        }
        return `0x${b32(r).toString("hex")}${b32(s).toString("hex")}${(27 + odd).toString(16)}`;
      }
    },
  };
}
