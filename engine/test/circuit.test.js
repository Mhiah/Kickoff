import { test } from "node:test";
import assert from "node:assert/strict";
import { BASKETBALL, FOOTBALL, TENNIS, evaluate, readCircuit } from "../src/index.js";
import { CHECK_RESULTS, CIRCUITS } from "./league.js";

const points = (circuit, bytes) => {
  const [atLeastOne, full] = evaluate(circuit, Uint8Array.from(bytes));
  return atLeastOne + 2 * full;
};

// The rules, written out plainly here, separately from the circuits and from the engine.
function footballRule(myHome, myAway, realHome, realAway) {
  if (myHome === realHome && myAway === realAway) return 3;
  const result = (h, a) => Math.sign(h - a);
  return result(myHome, myAway) === result(realHome, realAway) ? 1 : 0;
}
function winnerPlusDetailRule(myWinner, myDetail, realWinner, realDetail) {
  if (myWinner !== realWinner) return 0;
  return myDetail === realDetail ? 3 : 1;
}
function tennisRule(myWinner, mySets, realWinner, realSets, bestOf5) {
  const possible = (sets) => (bestOf5 ? sets >= 3 && sets <= 5 : sets === 2 || sets === 3);
  if (!possible(mySets) || !possible(realSets)) return 0;
  return winnerPlusDetailRule(myWinner, mySets, realWinner, realSets);
}

function tally() {
  return { 0: 0, 1: 0, 3: 0 };
}

test("the football circuit, run in JavaScript, gives the rule's points on all 65,536 cases", () => {
  const seen = tally();
  for (let mine = 0; mine < 256; mine++) {
    for (let real = 0; real < 256; real++) {
      const got = points(CIRCUITS[FOOTBALL], [mine, real]);
      assert.equal(got, footballRule(mine & 15, mine >> 4, real & 15, real >> 4));
      seen[got]++;
    }
  }
  // And the split by points is the one the Python checker recorded for the same circuit file.
  const recorded = CHECK_RESULTS.football;
  assert.deepEqual(seen, { 0: recorded.cases_scoring_0, 1: recorded.cases_scoring_1, 3: recorded.cases_scoring_3 });
  assert.equal(recorded.cases_checked, 65536);
});

test("the basketball circuit gives the rule's points on all 64 cases", () => {
  const seen = tally();
  for (let b = 0; b < 64; b++) {
    const got = points(CIRCUITS[BASKETBALL], [b]);
    assert.equal(got, winnerPlusDetailRule(b & 1, (b >> 1) & 3, (b >> 3) & 1, (b >> 4) & 3));
    seen[got]++;
  }
  const recorded = CHECK_RESULTS.basketball;
  assert.deepEqual(seen, { 0: recorded.cases_scoring_0, 1: recorded.cases_scoring_1, 3: recorded.cases_scoring_3 });
});

test("the tennis circuit gives the rule's points on all 128 cases", () => {
  const seen = tally();
  for (let b = 0; b < 128; b++) {
    const got = points(CIRCUITS[TENNIS], [b]);
    assert.equal(got, tennisRule(b & 1, ((b >> 1) & 3) + 2, (b >> 3) & 1, ((b >> 4) & 3) + 2, ((b >> 6) & 1) === 1));
    seen[got]++;
  }
  const recorded = CHECK_RESULTS.tennis;
  assert.deepEqual(seen, { 0: recorded.cases_scoring_0, 1: recorded.cases_scoring_1, 3: recorded.cases_scoring_3 });
});

test("the circuits read here are the ones the checker checked: same number of gates", () => {
  assert.equal(CIRCUITS[FOOTBALL].gates, CHECK_RESULTS.football.gates);
  assert.equal(CIRCUITS[BASKETBALL].gates, CHECK_RESULTS.basketball.gates);
  assert.equal(CIRCUITS[TENNIS].gates, CHECK_RESULTS.tennis.gates);
});

test("a circuit that is not well formed is refused", () => {
  const not = "00000002000002"; // one NAND gate that flips input 0
  assert.equal(readCircuit(not, 1, 1).gates, 1);
  assert.throws(() => readCircuit("000000020000", 1, 1), /cut short/);
  assert.throws(() => readCircuit("01000002000002", 1, 1), /not a NAND gate/);
  assert.throws(() => readCircuit("00000003000002", 1, 1), /does not exist yet/, "a gate cannot use its own output");
  assert.throws(() => readCircuit(not, 1, 2), /too few gates/);
});

test("missing input bytes read as zero, as on chain", () => {
  const not = readCircuit("00000002000002", 1, 1);
  assert.deepEqual(evaluate(not, Uint8Array.of()), [1]);
  assert.deepEqual(evaluate(not, Uint8Array.of(0)), [1]);
  assert.deepEqual(evaluate(not, Uint8Array.of(1)), [0]);
});
