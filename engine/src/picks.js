// What a pick is, for each sport, and how it is written as one byte.
//
// The byte is laid out exactly as the "your pick" inputs of that sport's scoring circuit
// (see circuits/README.md), so an opened pick can be handed straight to the circuit.

export const FOOTBALL = 1;
export const BASKETBALL = 2;
export const TENNIS = 3;

export const SPORT_NAMES = { [FOOTBALL]: "football", [BASKETBALL]: "basketball", [TENNIS]: "tennis" };

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
 *   basketball  { winner: "home" | "away", band: "A" | "B" | "C" | "D" }
 *   tennis      { winner: "A" | "B", sets: 2..5 }
 *
 * `match.bestOf` (3 or 5) is needed for tennis, because the number of sets that can happen depends
 * on it. A pick that cannot happen is refused here, and the tennis circuit refuses it again.
 */
export function encodePick(sport, pick, match = {}) {
  if (sport === FOOTBALL) {
    return whole(pick.home, 0, 15, "home goals") | (whole(pick.away, 0, 15, "away goals") << 4);
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
  if (sport === FOOTBALL) {
    pick = { home: byte & 15, away: byte >> 4 };
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
