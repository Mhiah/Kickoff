import { test } from "node:test";
import assert from "node:assert/strict";
import { BASKETBALL, FOOTBALL, TENNIS, decodePick, encodePick } from "../src/index.js";

test("a pick's byte is laid out as the scoring circuit expects (the examples in circuits/README.md)", () => {
  assert.equal(encodePick(FOOTBALL, { home: 2, away: 1 }), 0x12);
  assert.equal(encodePick(FOOTBALL, { home: 1, away: 0 }), 0x01);
  assert.equal(encodePick(FOOTBALL, { home: 0, away: 2 }), 0x20);
  assert.equal(encodePick(BASKETBALL, { winner: "home", band: "B" }), 0x02);
  assert.equal(encodePick(BASKETBALL, { winner: "home", band: "A" }), 0x00);
  assert.equal(encodePick(BASKETBALL, { winner: "away", band: "B" }), 0x03);
  assert.equal(encodePick(TENNIS, { winner: "A", sets: 3 }, { bestOf: 3 }), 0x02);
  assert.equal(encodePick(TENNIS, { winner: "A", sets: 2 }, { bestOf: 3 }), 0x00);
  assert.equal(encodePick(TENNIS, { winner: "B", sets: 3 }, { bestOf: 3 }), 0x03);
  assert.equal(encodePick(TENNIS, { winner: "A", sets: 4 }, { bestOf: 5 }), 0x04);
});

test("every possible pick survives being written as a byte and read back", () => {
  let count = 0;
  for (let home = 0; home <= 15; home++) {
    for (let away = 0; away <= 15; away++) {
      const pick = { home, away };
      assert.deepEqual(decodePick(FOOTBALL, encodePick(FOOTBALL, pick)), pick);
      count++;
    }
  }
  for (const winner of ["home", "away"]) {
    for (const band of ["A", "B", "C", "D"]) {
      const pick = { winner, band };
      assert.deepEqual(decodePick(BASKETBALL, encodePick(BASKETBALL, pick)), pick);
      count++;
    }
  }
  for (const [bestOf, allowed] of [[3, [2, 3]], [5, [3, 4, 5]]]) {
    for (const winner of ["A", "B"]) {
      for (const sets of allowed) {
        const pick = { winner, sets };
        assert.deepEqual(decodePick(TENNIS, encodePick(TENNIS, pick, { bestOf }), { bestOf }), pick);
        count++;
      }
    }
  }
  assert.equal(count, 256 + 8 + 10);
});

test("different picks never share a byte within a sport", () => {
  const seen = new Set();
  for (let home = 0; home <= 15; home++) for (let away = 0; away <= 15; away++) seen.add(encodePick(FOOTBALL, { home, away }));
  assert.equal(seen.size, 256);
});

test("a pick that cannot happen is refused", () => {
  assert.throws(() => encodePick(FOOTBALL, { home: 16, away: 0 }), RangeError);
  assert.throws(() => encodePick(FOOTBALL, { home: -1, away: 0 }), RangeError);
  assert.throws(() => encodePick(FOOTBALL, { home: 1.5, away: 0 }), RangeError);
  assert.throws(() => encodePick(BASKETBALL, { winner: "draw", band: "A" }), RangeError);
  assert.throws(() => encodePick(BASKETBALL, { winner: "home", band: "E" }), RangeError);
  assert.throws(() => encodePick(TENNIS, { winner: "A", sets: 2 }, { bestOf: 5 }), RangeError, "2 sets in a best of 5");
  assert.throws(() => encodePick(TENNIS, { winner: "A", sets: 4 }, { bestOf: 3 }), RangeError, "4 sets in a best of 3");
  assert.throws(() => encodePick(TENNIS, { winner: "A", sets: 3 }), RangeError, "tennis needs the match type");
  assert.throws(() => encodePick(9, {}), RangeError);
});

test("a byte that is not a possible pick is refused when read back", () => {
  assert.throws(() => decodePick(BASKETBALL, 8), RangeError);
  assert.throws(() => decodePick(TENNIS, 0, { bestOf: 5 }), RangeError, "A in 2 sets cannot happen in a best of 5");
  assert.throws(() => decodePick(TENNIS, 4, { bestOf: 3 }), RangeError, "A in 4 sets cannot happen in a best of 3");
  assert.throws(() => decodePick(FOOTBALL, 256), RangeError);
});
