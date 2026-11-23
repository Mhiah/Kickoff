import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VECTORS_FILE, asText, makeVectors } from "../scripts/vectors.js";

test("vectors/league.json is exactly what the engine produces today", async () => {
  // The chain rehearsal reads this file. If the engine changes and the file is not remade, this fails.
  assert.equal(readFileSync(VECTORS_FILE, "utf8"), asText(await makeVectors()), "run: npm run vectors");
});

test("the fixed league comes out as expected: ada 7, bola 4, chidi 1", async () => {
  const { table, matches } = await makeVectors();
  assert.deepEqual(
    table.map((row) => `${row.position} ${row.name} ${row.points}`),
    ["1 ada 7", "2 bola 4", "3 chidi 1"],
  );
  // football 2-1: ada exact, bola right result, chidi wrong.
  assert.deepEqual(matches[0].picks.map((p) => p.points), [3, 1, 0]);
  // basketball, home by 7: ada right winner only, bola both, chidi wrong winner.
  assert.deepEqual(matches[1].picks.map((p) => p.points), [1, 3, 0]);
  // tennis, A in 4 of a best of 5: ada both, bola wrong winner, chidi right winner only.
  assert.deepEqual(matches[2].picks.map((p) => p.points), [3, 0, 1]);
});
