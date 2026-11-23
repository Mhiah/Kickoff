import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASKETBALL, FOOTBALL, TENNIS, basketballResult, circuitInputs, encodePick, footballResult, scorePick, toHex,
} from "../src/index.js";
import { CIRCUITS } from "./league.js";

const score = (sport, pick, result, matchInfo = {}) =>
  scorePick({ circuits: CIRCUITS, sport, pickByte: encodePick(sport, pick, matchInfo), result, matchInfo });

test("football: the worked examples from docs/RULES.md", () => {
  const real = { home: 2, away: 1 };
  assert.equal(score(FOOTBALL, { home: 2, away: 1 }, real), 3, "exact score");
  assert.equal(score(FOOTBALL, { home: 1, away: 0 }, real), 1, "home win, wrong score");
  assert.equal(score(FOOTBALL, { home: 3, away: 1 }, real), 1, "home win, wrong score");
  assert.equal(score(FOOTBALL, { home: 1, away: 1 }, real), 0, "picked a draw");
  assert.equal(score(FOOTBALL, { home: 0, away: 2 }, real), 0, "picked an away win");
});

test("basketball: the worked examples from docs/RULES.md", () => {
  const real = basketballResult({ home: 104, away: 97 });
  assert.deepEqual(real, { winner: "home", band: "B" }, "a margin of 7 is band B");
  assert.equal(score(BASKETBALL, { winner: "home", band: "B" }, real), 3);
  assert.equal(score(BASKETBALL, { winner: "home", band: "A" }, real), 1);
  assert.equal(score(BASKETBALL, { winner: "away", band: "B" }, real), 0, "wrong winner, so the band does not count");
});

test("tennis: the worked examples from docs/RULES.md", () => {
  const real = { winner: "A", sets: 3 };
  const bo3 = { bestOf: 3 };
  assert.equal(score(TENNIS, { winner: "A", sets: 3 }, real, bo3), 3);
  assert.equal(score(TENNIS, { winner: "A", sets: 2 }, real, bo3), 1);
  assert.equal(score(TENNIS, { winner: "B", sets: 3 }, real, bo3), 0, "wrong winner, so the sets do not count");
  assert.equal(score(TENNIS, { winner: "A", sets: 4 }, { winner: "A", sets: 4 }, { bestOf: 5 }), 3);
});

test("the bytes handed to each circuit are the ones shown in circuits/README.md", () => {
  assert.equal(toHex(circuitInputs(FOOTBALL, 0x12, { home: 2, away: 1 })), "1212");
  assert.equal(toHex(circuitInputs(FOOTBALL, 0x01, { home: 2, away: 1 })), "0112");
  assert.equal(toHex(circuitInputs(BASKETBALL, 0x02, { winner: "home", band: "B" })), "12");
  assert.equal(toHex(circuitInputs(BASKETBALL, 0x03, { winner: "home", band: "B" })), "13");
  assert.equal(toHex(circuitInputs(TENNIS, 0x02, { winner: "A", sets: 3 }, { bestOf: 3 })), "12");
  assert.equal(toHex(circuitInputs(TENNIS, 0x04, { winner: "A", sets: 4 }, { bestOf: 5 })), "64");
});

test("basketball margin bands change at 5, 10 and 15", () => {
  const band = (margin) => basketballResult({ home: 100 + margin, away: 100 }).band;
  assert.deepEqual([1, 5, 6, 10, 11, 15, 16, 40].map(band), ["A", "A", "B", "B", "C", "C", "D", "D"]);
  assert.equal(basketballResult({ home: 90, away: 101 }).winner, "away");
  assert.throws(() => basketballResult({ home: 100, away: 100 }), /cannot end level/);
});

test("a football side that scores more than 15 is recorded as 15", () => {
  assert.deepEqual(footballResult({ home: 17, away: 0 }), { home: 15, away: 0 });
  assert.deepEqual(footballResult({ home: 3, away: 2 }), { home: 3, away: 2 });
  // So a pick of 15-0 is the exact score for a 17-0 match.
  assert.equal(score(FOOTBALL, { home: 15, away: 0 }, footballResult({ home: 17, away: 0 })), 3);
});

test("the only points a circuit can give are 0, 1 and 3", () => {
  const seen = new Set();
  for (let pick = 0; pick < 256; pick += 7) {
    for (let home = 0; home <= 15; home += 3) {
      for (let away = 0; away <= 15; away += 3) {
        seen.add(scorePick({ circuits: CIRCUITS, sport: FOOTBALL, pickByte: pick, result: { home, away } }));
      }
    }
  }
  assert.deepEqual([...seen].sort(), [0, 1, 3]);
});
