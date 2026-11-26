// Scoring an opened pick with the scoring circuits.
//
// A result is written the same way as a pick. A football result is a score, a basketball result is
// a winner and a margin band, a tennis result is a winner and a number of sets.

import { evaluate, readCircuit } from "./circuit.js";
import { BASKETBALL, FOOTBALL, GOAL_GOAL, RESULT, SCORE, TENNIS, encodeResult } from "./picks.js";

const INPUTS = { [FOOTBALL]: 16, [BASKETBALL]: 6, [TENNIS]: 7, [RESULT]: 10, [GOAL_GOAL]: 9, [SCORE]: 16 };

/**
 * Get the three scoring circuits ready. Pass the contents of circuits/out/football.hex,
 * basketball.hex and tennis.hex.
 */
export function loadCircuits({ football, basketball, tennis, result, goalgoal, score }) {
  const circuits = {
    [FOOTBALL]: readCircuit(football, INPUTS[FOOTBALL], 2),
    [BASKETBALL]: readCircuit(basketball, INPUTS[BASKETBALL], 2),
    [TENNIS]: readCircuit(tennis, INPUTS[TENNIS], 2),
  };
  // The three football predictions: circuits/out/result.hex, goalgoal.hex and score.hex.
  if (result) circuits[RESULT] = readCircuit(result, INPUTS[RESULT], 2);
  if (goalgoal) circuits[GOAL_GOAL] = readCircuit(goalgoal, INPUTS[GOAL_GOAL], 2);
  if (score) circuits[SCORE] = readCircuit(score, INPUTS[SCORE], 2);
  return circuits;
}

/** A football result from the real score. A side that scores more than 15 is recorded as 15. */
export function footballResult({ home, away }) {
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) throw new RangeError("goals must be whole numbers from 0 up");
  return { home: Math.min(home, 15), away: Math.min(away, 15) };
}

/** A basketball result from the final score, overtime included. There is always a winner. */
export function basketballResult({ home, away }) {
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) throw new RangeError("points must be whole numbers from 0 up");
  if (home === away) throw new RangeError("a basketball match cannot end level");
  const margin = Math.abs(home - away);
  const band = margin <= 5 ? "A" : margin <= 10 ? "B" : margin <= 15 ? "C" : "D";
  return { winner: home > away ? "home" : "away", band };
}

/** The bytes handed to a sport's circuit: the pick, then the result (and, for tennis, the match type). */
export function circuitInputs(sport, pickByte, result, matchInfo = {}) {
  const resultByte = encodeResult(sport, result, matchInfo);
  if (sport === FOOTBALL || sport === SCORE) return Uint8Array.of(pickByte, resultByte);
  if (sport === RESULT) return Uint8Array.of((pickByte | (resultByte << 2)) & 255, resultByte >> 6);
  if (sport === GOAL_GOAL) return Uint8Array.of((pickByte | (resultByte << 1)) & 255, resultByte >> 7);
  if (sport === BASKETBALL) return Uint8Array.of(pickByte | (resultByte << 3));
  if (sport === TENNIS) return Uint8Array.of(pickByte | (resultByte << 3) | (matchInfo.bestOf === 5 ? 64 : 0));
  throw new RangeError("unknown sport");
}

/** The points for one opened pick: 0, 1 or 3. Worked out by the sport's circuit. */
export function scorePick({ circuits, sport, pickByte, result, matchInfo = {} }) {
  const circuit = circuits[sport];
  if (!circuit) throw new RangeError("unknown sport");
  const [atLeastOne, full] = evaluate(circuit, circuitInputs(sport, pickByte, result, matchInfo));
  return atLeastOne + 2 * full;
}
