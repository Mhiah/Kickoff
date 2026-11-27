// The one shape every match is put into, whichever feed it came from.
//
//   feedId      the feed's own name for the match, which stays the same if the match is moved
//   comp        "pl", "cl", "ll", "sa", "nba" or "wnba"
//   sport       1 football, 2 basketball (the picks engine's numbers)
//   home, away  the two sides, by the short names people use
//   kickoff     the start time, in seconds
//   label       the text that goes into the match's id: "Premier League: Arsenal v Chelsea"
//   state       "scheduled"  not started
//               "live"       started and not finished, or held up part way
//               "final"      finished, with a result
//               "void"       postponed, called off, abandoned or awarded: nobody scores
//               "unknown"    the feed said something this code cannot be sure about
//   score       the score as the feed gave it, for showing: "2 – 1", "104 – 97"
//   result      the result as Kickoff scores it (only when final)
//   resultByte  that result written as one byte, as the scoring circuit takes it (only when final)
//   note        why a match is void or unknown, in plain words

import { BASKETBALL, FOOTBALL, checkFixture, encodePick } from "../../engine/src/index.js";

export const COMPETITIONS = {
  pl: { name: "Premier League", sport: FOOTBALL },
  cl: { name: "Champions League", sport: FOOTBALL },
  ll: { name: "La Liga", sport: FOOTBALL },
  sa: { name: "Serie A", sport: FOOTBALL },
  nba: { name: "NBA", sport: BASKETBALL },
  wnba: { name: "WNBA", sport: BASKETBALL },
};

/** Seconds from a time written like "2026-11-28T17:30:00Z". Returns null if it is not a time. */
export function seconds(isoTime) {
  if (typeof isoTime !== "string") return null;
  const ms = Date.parse(isoTime);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** A whole number from 0 up, or null. */
export function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Finish a match: work out its label, check it can be a Kickoff match, and write its result as a
 * byte. Returns { match } or { problem } saying why the match was left out.
 */
export function finish({ feedId, comp, home, away, kickoff, state, score = null, result = null, note = null }) {
  const competition = COMPETITIONS[comp];
  const where = `${feedId}`;
  if (typeof home !== "string" || typeof away !== "string" || !home.trim() || !away.trim()) {
    return { problem: `${where}: the feed did not name both sides` };
  }
  if (kickoff === null) return { problem: `${where} (${home} v ${away}): the feed gave no start time` };
  const label = `${competition.name}: ${home.trim()} v ${away.trim()}`;
  try {
    checkFixture({ sport: competition.sport, kickoff, bestOf: 0, label });
  } catch (error) {
    return { problem: `${where} (${label}): ${error.message}` };
  }
  const match = { feedId, comp, sport: competition.sport, home: home.trim(), away: away.trim(), kickoff, label, state };
  if (score) match.score = score;
  if (note) match.note = note;
  if (state === "final") {
    match.result = result;
    match.resultByte = encodePick(competition.sport, result);
  }
  return { match };
}
