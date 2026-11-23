// Reading a TapeOut circuit and working out its answer, in JavaScript.
//
// Kickoff scores every pick with the same three circuits that are published on chain (the .hex
// files in circuits/out/). This file is what lets the website and anyone checking a league run
// those exact circuits, so there is no second copy of the rules that could drift.
//
// The format is TAP-02: a circuit is a list of NAND gates, 7 bytes each (one opcode byte, then two
// 3-byte signal numbers). Signal 0 is the constant 0, signal 1 is the constant 1, the inputs come
// next, and every gate adds one more signal. The outputs are the last gates. Kickoff's circuits
// use NAND gates only, and anything else is refused.

import { fromHex } from "./bytes.js";

const RECORD = 7;

/** Check a circuit is well formed and get it ready to run. `netlist` is hex or bytes. */
export function readCircuit(netlist, nIn, nOut) {
  const data = typeof netlist === "string" ? fromHex(netlist.trim()) : netlist;
  if (data.length % RECORD !== 0) throw new Error("the last gate is cut short");
  const count = data.length / RECORD;
  if (!Number.isInteger(nOut) || nOut < 1 || nOut > count) throw new Error("too few gates for the outputs");
  const a = new Uint32Array(count);
  const b = new Uint32Array(count);
  for (let k = 0; k < count; k++) {
    const at = k * RECORD;
    if (data[at] !== 0) throw new Error(`gate ${k} is not a NAND gate`);
    a[k] = (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3];
    b[k] = (data[at + 4] << 16) | (data[at + 5] << 8) | data[at + 6];
    const thisSignal = 2 + nIn + k;
    if (a[k] >= thisSignal || b[k] >= thisSignal) throw new Error(`gate ${k} uses a signal that does not exist yet`);
  }
  return { nIn, nOut, gates: count, a, b };
}

/**
 * One evaluation, as a TapeOut processor's eval() does it: packed inputs in, output bits out.
 * Bits are packed lowest first: bit i is in byte i >> 3 at position i & 7. Missing bytes read as 0.
 * Returns the outputs as a list of 0s and 1s.
 */
export function evaluate(circuit, inputs) {
  const { nIn, nOut, gates, a, b } = circuit;
  const s = new Uint8Array(2 + nIn + gates);
  s[1] = 1;
  for (let i = 0; i < nIn; i++) {
    const byte = i >> 3;
    s[2 + i] = byte < inputs.length ? (inputs[byte] >> (i & 7)) & 1 : 0;
  }
  for (let k = 0; k < gates; k++) s[2 + nIn + k] = 1 - (s[a[k]] & s[b[k]]);
  return Array.from(s.subarray(s.length - nOut));
}
