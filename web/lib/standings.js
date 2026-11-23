// Turning each player's picks into a table.
//
// Most points first, then most 3-point picks, then most 1-point picks. Players level on all three
// share a position, and the next position is skipped. These are the rules in docs/RULES.md, and
// the same ones the picks engine uses.

/** @param scores [{ name, threes, ones }] */
export function standings(scores) {
  const rows = scores
    .map((s) => ({ ...s, points: 3 * s.threes + s.ones }))
    .sort((a, b) => b.points - a.points || b.threes - a.threes || b.ones - a.ones || a.name.localeCompare(b.name));
  rows.forEach((row, i) => {
    const above = rows[i - 1];
    const level = above && above.points === row.points && above.threes === row.threes && above.ones === row.ones;
    row.position = level ? above.position : i + 1;
  });
  for (const row of rows) row.sharedWith = rows.filter((r) => r.position === row.position && r !== row).map((r) => r.name);
  return rows;
}

/** 1 becomes "1st", 2 "2nd", 3 "3rd", 11 "11th". */
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

/** A position in words for a sentence: "first", "second", "third", then "4th" and so on. */
export function placeName(n) {
  return { 1: "first", 2: "second", 3: "third" }[n] ?? ordinal(n);
}
