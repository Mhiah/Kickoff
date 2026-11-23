// A match's id.
//
// A match's id is worked out from the facts about it: the league, the sport, the kickoff time, the
// match type and its label. Because the id is inside every sealed pick and every lock, those facts
// cannot be changed afterwards. In particular, a league cannot later claim a match kicked off at a
// different time in order to let a late bundle through.
//
// The id is the SHA-256 of:
//
//   "kickoff/match/v1"   16 bytes
//   league               32 bytes
//   sport                 1 byte    1 football, 2 basketball, 3 tennis
//   kickoff               8 bytes   start time in seconds, biggest part first
//   best of               1 byte    3 or 5 for tennis, 0 for the other sports
//   label                 the rest  for example "Arsenal v Chelsea", as plain text

import { concat, id32, sha256, text, u64 } from "./bytes.js";
import { BASKETBALL, FOOTBALL, TENNIS } from "./picks.js";

const TAG = text("kickoff/match/v1");
export const MAX_LABEL_BYTES = 80;

/** Check the facts about a match and return them tidied. Throws if they cannot be a match. */
export function checkFixture({ sport, kickoff, bestOf = 0, label }) {
  if (![FOOTBALL, BASKETBALL, TENNIS].includes(sport)) throw new RangeError("unknown sport");
  if (!Number.isSafeInteger(kickoff) || kickoff <= 0) throw new RangeError("kickoff must be a time in whole seconds");
  if (sport === TENNIS ? bestOf !== 3 && bestOf !== 5 : bestOf !== 0) {
    throw new RangeError("best of must be 3 or 5 for tennis and 0 for the other sports");
  }
  if (typeof label !== "string" || label.length === 0 || label !== label.trim()) throw new RangeError("a match needs a label");
  // Plain printable text only, so a label can never break the message it is carried in.
  if (/[\u0000-\u001f\u007f"\\]/.test(label)) throw new RangeError("the label has characters that are not allowed");
  if (text(label).length > MAX_LABEL_BYTES) throw new RangeError(`the label is longer than ${MAX_LABEL_BYTES} bytes`);
  return { sport, kickoff, bestOf, label };
}

/** The id of a match in a league. */
export async function matchId(league, fixture) {
  const { sport, kickoff, bestOf, label } = checkFixture(fixture);
  return sha256(concat(TAG, id32(league, "league"), Uint8Array.of(sport), u64(kickoff), Uint8Array.of(bestOf), text(label)));
}

/** What the scoring needs to know about the kind of match. */
export function matchInfoOf(fixture) {
  return fixture.sport === TENNIS ? { bestOf: fixture.bestOf } : {};
}
