// What a league writes on chain, and how to read it back.
//
// A league writes three kinds of message to its own inbox in TapeOut's mailbox (TapeSend). Each is
// an ordinary public TapeSend message (TAP-10): the four bytes "TS" 0x02 0x00, then a small piece
// of JSON with a subject and a body. Each message also carries a 32-byte reference, which the
// mailbox stores a fingerprint of, and which Kickoff uses to tie the message to what it is about.
//
//   subject               reference              body
//   kickoff/match/v1      the match's id         <sport> <kickoff> <best of> <label>
//   kickoff/lock/v1       the lock value         <match id> <number of picks> <bundle root>
//   kickoff/result/v1     the match's id         <match id> final <result byte>     or     <match id> void
//
// Anyone may also write to a league's inbox. A member who disputes a result writes:
//
//   kickoff/challenge/v1  the match's id         <match id> <the result byte they say is right>
//
// Ids and roots are written as 0x followed by 64 hex digits. Numbers are written in decimal.

import { concat, equal, fromHex, id32, text, toHex } from "./bytes.js";
import { lockRef } from "./bundle.js";
import { checkFixture, matchId } from "./match.js";

const HEADER = Uint8Array.of(0x54, 0x53, 0x02, 0x00); // "TS", version 2, kind 0 (public)
export const MAX_PAYLOAD = 16000;

export const SUBJECTS = Object.freeze({
  match: "kickoff/match/v1",
  lock: "kickoff/lock/v1",
  result: "kickoff/result/v1",
  challenge: "kickoff/challenge/v1",
});

const hex32 = (bytes) => `0x${toHex(id32(bytes, "id"))}`;

function payload(subject, body) {
  const out = concat(HEADER, text(JSON.stringify({ v: 1, kind: "message", subject, body })));
  if (out.length > MAX_PAYLOAD) throw new RangeError("the message is too long for the mailbox");
  return out;
}

/** The message that announces a match. Returns { ref, payload } to hand to the mailbox. */
export async function matchMessage(league, fixture) {
  const f = checkFixture(fixture);
  return { ref: await matchId(league, f), payload: payload(SUBJECTS.match, `${f.sport} ${f.kickoff} ${f.bestOf} ${f.label}`) };
}

/** The message that locks a match's bundle. `bundle` is { league, match, count, root }. */
export async function lockMessage(bundle) {
  return {
    ref: await lockRef(bundle),
    payload: payload(SUBJECTS.lock, `${hex32(bundle.match)} ${bundle.count} ${hex32(bundle.root)}`),
  };
}

/** The message that gives a match's result: a result byte, or `void` for a match that did not finish. */
export function resultMessage(match, result) {
  const body = result === "void" ? `${hex32(match)} void` : `${hex32(match)} final ${result}`;
  return { ref: id32(match, "match"), payload: payload(SUBJECTS.result, body) };
}

/** The message a member sends to dispute a result. */
export function challengeMessage(match, resultByte) {
  return { ref: id32(match, "match"), payload: payload(SUBJECTS.challenge, `${hex32(match)} ${resultByte}`) };
}

// ---- reading

const number = (s) => (/^(0|[1-9][0-9]{0,15})$/.test(s) ? Number(s) : NaN);
const idOf = (s) => (/^0x[0-9a-f]{64}$/.test(s) ? fromHex(s) : null);

/**
 * Read one mailbox message. Returns null if it is not a well-formed Kickoff message. This only
 * reads what the message says. Whether it should be believed is decided in reader.js.
 */
export function parseMessage(payloadBytes) {
  if (!(payloadBytes instanceof Uint8Array) || payloadBytes.length < 5 || payloadBytes.length > MAX_PAYLOAD) return null;
  if (!equal(payloadBytes.subarray(0, 4), HEADER)) return null;
  let content;
  try {
    content = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes.subarray(4)));
  } catch {
    return null;
  }
  if (content === null || typeof content !== "object" || Array.isArray(content)) return null;
  if (content.v !== 1 || content.kind !== "message" || typeof content.subject !== "string" || typeof content.body !== "string") return null;
  const { subject, body } = content;
  const parts = body.split(" ");

  if (subject === SUBJECTS.match) {
    if (parts.length < 4) return null;
    const fixture = { sport: number(parts[0]), kickoff: number(parts[1]), bestOf: number(parts[2]), label: parts.slice(3).join(" ") };
    try {
      return { kind: "match", fixture: checkFixture(fixture) };
    } catch {
      return null;
    }
  }
  if (subject === SUBJECTS.lock) {
    if (parts.length !== 3) return null;
    const match = idOf(parts[0]);
    const count = number(parts[1]);
    const root = idOf(parts[2]);
    if (!match || !root || !Number.isInteger(count)) return null;
    return { kind: "lock", match, count, root };
  }
  if (subject === SUBJECTS.result) {
    const match = idOf(parts[0] ?? "");
    if (!match) return null;
    if (parts.length === 2 && parts[1] === "void") return { kind: "result", match, state: "void" };
    if (parts.length === 3 && parts[1] === "final") {
      const resultByte = number(parts[2]);
      if (!Number.isInteger(resultByte) || resultByte > 255) return null;
      return { kind: "result", match, state: "final", resultByte };
    }
    return null;
  }
  if (subject === SUBJECTS.challenge) {
    if (parts.length !== 2) return null;
    const match = idOf(parts[0]);
    const resultByte = number(parts[1]);
    if (!match || !Number.isInteger(resultByte) || resultByte > 255) return null;
    return { kind: "challenge", match, resultByte };
  }
  return null;
}
