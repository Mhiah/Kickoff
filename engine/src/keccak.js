// Keccak-256, the fingerprint X Layer itself uses.
//
// Kickoff's own fingerprints are all SHA-256, which Node and every browser have built in. But
// TapeOut's mailbox ties each message to its inbox with Keccak-256, and neither Node nor a browser
// has that built in. So it is written out here, with nothing to install. The tests check it against
// published values.

const MASK = (1n << 64n) - 1n;
const RATE = 136; // bytes taken in per round, for a 256-bit result

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const rotate = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK);

function permute(a) {
  const c = new Array(5);
  for (const constant of ROUND_CONSTANTS) {
    // theta
    for (let x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotate(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) a[x + y] ^= d;
    }
    // rho and pi
    let x = 1;
    let y = 0;
    let carried = a[1];
    for (let t = 0; t < 24; t++) {
      [x, y] = [y, (2 * x + 3 * y) % 5];
      const next = a[x + 5 * y];
      a[x + 5 * y] = rotate(carried, (((t + 1) * (t + 2)) / 2) % 64);
      carried = next;
    }
    // chi
    for (let row = 0; row < 25; row += 5) {
      const r = a.slice(row, row + 5);
      for (let i = 0; i < 5; i++) a[row + i] = r[i] ^ (~r[(i + 1) % 5] & MASK & r[(i + 2) % 5]);
    }
    // iota
    a[0] ^= constant;
  }
}

/** Keccak-256 of some bytes. Returns 32 bytes. */
export function keccak256(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("expected bytes");
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / RATE) * RATE);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  const state = new Array(25).fill(0n);
  const view = new DataView(padded.buffer);
  for (let at = 0; at < padded.length; at += RATE) {
    for (let i = 0; i < RATE / 8; i++) state[i] ^= view.getBigUint64(at + 8 * i, true);
    permute(state);
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) outView.setBigUint64(8 * i, state[i], true);
  return out;
}
