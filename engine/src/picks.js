// What a pick is, for each sport, and how it is written as one byte.
//
// The byte is laid out exactly as the "your pick" inputs of that sport's scoring circuit
// (see circuits/README.md), so an opened pick can be handed straight to the circuit.

export const FOOTBALL = 1;
export const BASKETBALL = 2;
export const TENNIS = 3;
// A football match can be predicted three ways, each sealed, locked and scored by itself. Each is
// a "sport" of its own here, because that one byte is what decides the scoring circuit. FOOTBALL
// above is the older single prediction (the exact score, with 1 point for the right result),
// which the first matches were played under and which still reads back from X Layer.
export const RESULT = 4; //     how the match ends: home, draw or away. 1 point
export const GOAL_GOAL = 5; //  whether both sides score. 1 point
export const SCORE = 6; //      the exact score. 3 points

export const SPORTS = [FOOTBALL, BASKETBALL, TENNIS, RESULT, GOAL_GOAL, SCORE];
/** The three predictions of a football match, in the order they are shown. */
export const FOOTBALL_MARKETS = [RESULT, GOAL_GOAL, SCORE];
/** True for every kind of prediction whose result is a football score. */
export const isFootball = (sport) => sport === FOOTBALL || FOOTBALL_MARKETS.includes(sport);

export const SPORT_NAMES = {
  [FOOTBALL]: "football", [BASKETBALL]: "basketball", [TENNIS]: "tennis",
  [RESULT]: "football result", [GOAL_GOAL]: "football goal goal", [SCORE]: "football exact score",
};

const RESULTS = ["home", "draw", "away"];

const BANDS = ["A", "B", "C", "D"]; // A: 1 to 5, B: 6 to 10, C: 11 to 15, D: 16 and over

function whole(n, low, high, what) {
  if (!Number.isInteger(n) || n < low || n > high) throw new RangeError(`${what} must be a whole number from ${low} to ${high}`);
  return n;
}

function oneOf(value, options, what) {
  const i = options.indexOf(value);
  if (i < 0) throw new RangeError(`${what} must be one of: ${options.join(", ")}`);
  return i;
}

/**
 * Write a pick as one byte.
 *
 *   football    { home: 0..15, away: 0..15 }
 *   result      { result: "home" | "draw" | "away" }
 *   goal goal   { both: true | false }      true means both sides score
 *   score       { home: 0..15, away: 0..15 }
 *   basketball  { winner: "home" | "away", band: "A" | "B" | "C" | "D" }
 *   tennis      { winner: "A" | "B", sets: 2..5 }
 *
 * `match.bestOf` (3 or 5) is needed for tennis, because the number of sets that can happen depends
 * on it. A pick that cannot happen is refused here, and the tennis circuit refuses it again.
 */
export function encodePick(sport, pick, match = {}) {
  if (sport === FOOTBALL || sport === SCORE) {
    return whole(pick.home, 0, 15, "home goals") | (whole(pick.away, 0, 15, "away goals") << 4);
  }
  if (sport === RESULT) return oneOf(pick.result, RESULTS, "result");
  if (sport === GOAL_GOAL) {
    if (typeof pick.both !== "boolean") throw new RangeError("goal goal must be yes or no");
    return pick.both ? 1 : 0;
  }
  if (sport === BASKETBALL) {
    return oneOf(pick.winner, ["home", "away"], "winner") | (oneOf(pick.band, BANDS, "margin band") << 1);
  }
  if (sport === TENNIS) {
    const allowed = { 3: [2, 3], 5: [3, 4, 5] }[match.bestOf];
    if (!allowed) throw new RangeError("a tennis match must be best of 3 or best of 5");
    oneOf(pick.sets, allowed, `sets in a best of ${match.bestOf}`);
    return oneOf(pick.winner, ["A", "B"], "winner") | ((pick.sets - 2) << 1);
  }
  throw new RangeError("unknown sport");
}

/** Read a pick back from its byte. Throws if the byte is not a possible pick. */
export function decodePick(sport, byte, match = {}) {
  whole(byte, 0, 255, "pick byte");
  let pick;
  if (sport === FOOTBALL || sport === SCORE) {
    pick = { home: byte & 15, away: byte >> 4 };
  } else if (sport === RESULT) {
    if (byte > 2) throw new RangeError("not a result");
    pick = { result: RESULTS[byte] };
  } else if (sport === GOAL_GOAL) {
    if (byte > 1) throw new RangeError("not a goal goal answer");
    pick = { both: byte === 1 };
  } else if (sport === BASKETBALL) {
    if (byte > 7) throw new RangeError("not a basketball pick");
    pick = { winner: byte & 1 ? "away" : "home", band: BANDS[byte >> 1] };
  } else if (sport === TENNIS) {
    if (byte > 7) throw new RangeError("not a tennis pick");
    pick = { winner: byte & 1 ? "B" : "A", sets: (byte >> 1) + 2 };
  } else {
    throw new RangeError("unknown sport");
  }
  if (encodePick(sport, pick, match) !== byte) throw new RangeError("not a possible pick");
  return pick;
}

/**
 * Write a result as one byte. A result is laid out as a pick of the same sport, except for the
 * three football predictions: whatever was predicted, the result of a football match is its score.
 */
export function encodeResult(sport, result, match = {}) {
  return encodePick(FOOTBALL_MARKETS.includes(sport) ? FOOTBALL : sport, result, match);
}

/** Read a result back from its byte. Throws if the byte is not a possible result. */
export function decodeResult(sport, byte, match = {}) {
  return decodePick(FOOTBALL_MARKETS.includes(sport) ? FOOTBALL : sport, byte, match);
}
