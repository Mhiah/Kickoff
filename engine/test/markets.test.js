// Football's three predictions: the result, goal goal and the exact score.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  FOOTBALL, FOOTBALL_MARKETS, GOAL_GOAL, PUBLISHED, RESULT, SCORE, checkFixture, decodePick, decodeResult, encodePick, encodeResult, fingerprintOf,
  loadCircuits, matchId, scorePick,
} from "../src/index.js";

const circuits = loadCircuits(PUBLISHED);
const points = (sport, pick, result) => scorePick({ circuits, sport, pickByte: encodePick(sport, pick), result });

test("the copies of the three new circuits are the files in circuits/out", async () => {
  for (const name of ["result", "goalgoal", "score"]) {
    const file = (await readFile(new URL(`../../circuits/out/${name}.hex`, import.meta.url), "utf8")).trim();
    assert.equal(PUBLISHED[name], file, name);
  }
});

test("Result: 1 point for saying how the match ends, on every score a match can have", () => {
  for (let home = 0; home <= 15; home++) {
    for (let away = 0; away <= 15; away++) {
      const real = home > away ? "home" : home < away ? "away" : "draw";
      for (const said of ["home", "draw", "away"]) {
        assert.equal(points(RESULT, { result: said }, { home, away }), said === real ? 1 : 0, `${said} on ${home}-${away}`);
      }
    }
  }
});

test("Goal Goal: 1 point for saying whether both sides score", () => {
  for (let home = 0; home <= 15; home++) {
    for (let away = 0; away <= 15; away++) {
      const both = home > 0 && away > 0;
      assert.equal(points(GOAL_GOAL, { both: true }, { home, away }), both ? 1 : 0, `yes on ${home}-${away}`);
      assert.equal(points(GOAL_GOAL, { both: false }, { home, away }), both ? 0 : 1, `no on ${home}-${away}`);
    }
  }
});

test("Exact score: 3 points for the exact score and nothing for the right winner", () => {
  assert.equal(points(SCORE, { home: 2, away: 1 }, { home: 2, away: 1 }), 3);
  assert.equal(points(SCORE, { home: 2, away: 1 }, { home: 1, away: 0 }), 0);
  assert.equal(points(SCORE, { home: 0, away: 0 }, { home: 1, away: 1 }), 0);
  // The older single football prediction still scores as it always did.
  assert.equal(points(FOOTBALL, { home: 2, away: 1 }, { home: 1, away: 0 }), 1);
  assert.equal(points(FOOTBALL, { home: 2, away: 1 }, { home: 2, away: 1 }), 3);
});

test("a perfect football match is 5 points across the three predictions", () => {
  const real = { home: 2, away: 1 };
  const total = points(RESULT, { result: "home" }, real) + points(GOAL_GOAL, { both: true }, real) + points(SCORE, { home: 2, away: 1 }, real);
  assert.equal(total, 5);
});

test("each prediction is written as one byte and read back, and anything else is refused", () => {
  assert.deepEqual(["home", "draw", "away"].map((result) => encodePick(RESULT, { result })), [0, 1, 2]);
  assert.deepEqual(decodePick(RESULT, 2), { result: "away" });
  assert.throws(() => decodePick(RESULT, 3), /not a result/);
  assert.throws(() => encodePick(RESULT, { result: "win" }), /result must be one of/);
  assert.equal(encodePick(GOAL_GOAL, { both: true }), 1);
  assert.deepEqual(decodePick(GOAL_GOAL, 0), { both: false });
  assert.throws(() => decodePick(GOAL_GOAL, 2), /not a goal goal answer/);
  assert.throws(() => encodePick(GOAL_GOAL, { both: "yes" }), /yes or no/);
  assert.deepEqual(decodePick(SCORE, encodePick(SCORE, { home: 3, away: 2 })), { home: 3, away: 2 });
});

test("the result of a football match is its score, whichever prediction it is scored for", () => {
  for (const sport of [FOOTBALL, ...FOOTBALL_MARKETS]) {
    const byte = encodeResult(sport, { home: 3, away: 2 });
    assert.equal(byte, 3 | (2 << 4));
    assert.deepEqual(decodeResult(sport, byte), { home: 3, away: 2 });
  }
});

test("the three predictions of one match are three matches on the record, with three fingerprints", async () => {
  const league = "11".repeat(32);
  const facts = { kickoff: 1795000000, bestOf: 0, label: "Premier League: Arsenal v Chelsea" };
  const ids = [];
  for (const sport of FOOTBALL_MARKETS) {
    checkFixture({ sport, ...facts });
    ids.push(Buffer.from(await matchId(league, { sport, ...facts })).toString("hex"));
  }
  assert.equal(new Set(ids).size, 3);
  const a = await fingerprintOf({ league, match: ids[0], sport: RESULT, pickByte: 0, player: "22".repeat(32), salt: "33".repeat(32) });
  const b = await fingerprintOf({ league, match: ids[0], sport: GOAL_GOAL, pickByte: 0, player: "22".repeat(32), salt: "33".repeat(32) });
  assert.notDeepEqual(a, b);
});
