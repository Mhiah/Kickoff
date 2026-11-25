// The small part of X Layer's calling format that Kickoff needs: how to ask a contract a question
// and how to read its answer. Only these kinds of value are handled:
//
//   uint… (any size)   a whole number, given as a number or a BigInt, read back as a BigInt
//   bool               true or false
//   address            "0x" and 40 hex digits, read back in lowercase
//   bytes32            32 bytes
//   bytes              any number of bytes
//   string             text
//
// No dependencies.

import { concat, fromHex, text, toHex } from "./bytes.js";
import { keccak256 } from "./keccak.js";

const WORD = 32;
const isDynamic = (type) => type === "bytes" || type === "string";

function word(value) {
  const n = BigInt(value);
  if (n < 0n || n >> 256n !== 0n) throw new RangeError("number does not fit in 32 bytes");
  return fromHex(n.toString(16).padStart(64, "0"));
}

function padded(bytes) {
  const out = new Uint8Array(Math.ceil(bytes.length / WORD) * WORD);
  out.set(bytes);
  return concat(word(bytes.length), out);
}

function encodeStatic(type, value) {
  if (type.startsWith("uint")) return word(value);
  if (type === "bool") return word(value ? 1 : 0);
  if (type === "address") {
    const clean = String(value).toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error("not an address");
    return fromHex(clean.padStart(64, "0"));
  }
  if (type === "bytes32") {
    const bytes = typeof value === "string" ? fromHex(value) : value;
    if (bytes.length !== WORD) throw new Error("bytes32 must be 32 bytes");
    return bytes;
  }
  throw new Error(`a kind of value this file does not handle: ${type}`);
}

/** Write values out in the order of their types. */
export function encode(types, values) {
  if (types.length !== values.length) throw new Error("one value for each type");
  const heads = [];
  const tails = [];
  let tailAt = types.length * WORD;
  types.forEach((type, i) => {
    if (!isDynamic(type)) {
      heads.push(encodeStatic(type, values[i]));
      return;
    }
    const bytes = type === "string" ? text(values[i]) : typeof values[i] === "string" ? fromHex(values[i]) : values[i];
    const tail = padded(bytes);
    heads.push(word(tailAt));
    tails.push(tail);
    tailAt += tail.length;
  });
  return concat(...heads, ...tails);
}

/** The first four bytes of a call: which function is being called. */
export function selector(signature) {
  return keccak256(text(signature)).slice(0, 4);
}

/** The 32-byte name an event is filed under in a block's logs. */
export function eventTopic(signature) {
  return keccak256(text(signature));
}

/** The bytes of a call, as 0x hex. `signature` is like "inboxCount(bytes32)". */
export function callData(signature, values = []) {
  const inside = signature.slice(signature.indexOf("(") + 1, signature.lastIndexOf(")"));
  const types = inside === "" ? [] : inside.split(",");
  return `0x${toHex(concat(selector(signature), encode(types, values)))}`;
}

function wordAt(data, at) {
  if (at + WORD > data.length) throw new Error("the answer is shorter than it should be");
  return data.subarray(at, at + WORD);
}

const numberAt = (data, at) => BigInt(`0x${toHex(wordAt(data, at))}`);

function smallNumberAt(data, at) {
  const n = numberAt(data, at);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("the answer has a number that is too large to be real");
  return Number(n);
}

/** Read an answer back. `data` is bytes or 0x hex. Returns one value for each type. */
export function decode(types, data) {
  const bytes = typeof data === "string" ? fromHex(data) : data;
  return types.map((type, i) => {
    const at = i * WORD;
    if (type.startsWith("uint")) return numberAt(bytes, at);
    if (type === "bool") return numberAt(bytes, at) !== 0n;
    if (type === "address") return `0x${toHex(wordAt(bytes, at).subarray(12))}`;
    if (type === "bytes32") return wordAt(bytes, at).slice();
    if (isDynamic(type)) {
      const start = smallNumberAt(bytes, at);
      const length = smallNumberAt(bytes, start);
      if (start + WORD + length > bytes.length) throw new Error("the answer is shorter than it should be");
      const body = bytes.slice(start + WORD, start + WORD + length);
      return type === "string" ? new TextDecoder().decode(body) : body;
    }
    throw new Error(`a kind of value this file does not handle: ${type}`);
  });
}

/**
 * Read a list of fixed-size records, such as a page of an inbox. `fields` are the types in one
 * record. Returns a list of lists.
 */
export function decodeRecords(fields, data) {
  const bytes = typeof data === "string" ? fromHex(data) : data;
  const start = smallNumberAt(bytes, 0);
  const count = smallNumberAt(bytes, start);
  const size = fields.length * WORD;
  if (start + WORD + count * size > bytes.length) throw new Error("the answer is shorter than it should be");
  const out = [];
  for (let i = 0; i < count; i++) {
    const at = start + WORD + i * size;
    out.push(decode(fields, bytes.subarray(at, at + size)));
  }
  return out;
}
