import { test } from "node:test";
import assert from "node:assert/strict";
import { BASKETBALL, FOOTBALL, TENNIS, basketballResult, buildTable, toHex } from "../src/index.js";
import { KICKOFF, LEAGUE, id } from "./helpers.js";
import { CIRCUITS, playMatch } from "./league.js";

const name = (player) => ["ada", "bola", "chidi", "dayo", "efe"].find((n) => toHex(id(n)) === toHex(player)) ?? "?";
const build = (matches, players = []) => buildTable({ league: LEAGUE, matches, circuits: CIRCUITS, players });
/** The table as short lines: "1 ada 6" means first place, ada, 6 points. */
const lines = (table) => table.map((row) => `${row.position} ${name(row.player)} ${row.points}`);
const recordOf = (records, who) => records[toHex(id(who))];

test("a league across all three sports: points add up and the table is in order", async () => {
  const matches = [
    await playMatch({
      label: "football",
      sport: FOOTBALL,
      picks: { ada: { home: 2, away: 1 }, bola: { home: 1, away: 0 }, chidi: { home: 0, away: 0 } },
      result: { home: 2, away: 1 },
    }),
    await playMatch({
      label: "basketball",
      sport: BASKETBALL,
      picks: {
        ada: { winner: "home", band: "A" },
        bola: { winner: "home", band: "B" },
        chidi: { winner: "away", band: "B" },
      },
      result: basketballResult({ home: 104, away: 97 }),
    }),
    await playMatch({
      label: "tennis",
      sport: TENNIS,
      matchInfo: { bestOf: 3 },
      picks: { ada: { winner: "A", sets: 3 }, bola: { winner: "B", sets: 2 }, chidi: { winner: "A", sets: 2 } },
      result: { winner: "A", sets: 3 },
    }),
  ];
  const { table, records } = await build(matches);
  // ada: 3 + 1 + 3 = 7.  bola: 1 + 3 + 0 = 4.  chidi: 0 + 0 + 1 = 1.
  assert.deepEqual(lines(table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
  assert.deepEqual(recordOf(records, "ada").map((r) => r.points), [3, 1, 3]);
  assert.deepEqual(recordOf(records, "ada")[0].pick, { home: 2, away: 1 });
  assert.equal(table[0].threes, 2);
  assert.equal(table[0].ones, 1);
  assert.equal(table[0].scored, 3);
});

test("level on points: more 3-point picks comes first, then more 1-point picks", async () => {
  // Three matches, all ending 1-0.
  const real = { home: 1, away: 0 };
  const exact = { home: 1, away: 0 };
  const rightResult = { home: 2, away: 0 };
  const wrong = { home: 0, away: 1 };
  const matches = [
    await playMatch({ label: "m1", sport: FOOTBALL, result: real, picks: { ada: exact, bola: rightResult, chidi: exact } }),
    await playMatch({ label: "m2", sport: FOOTBALL, result: real, picks: { ada: wrong, bola: rightResult, chidi: wrong } }),
    await playMatch({ label: "m3", sport: FOOTBALL, result: real, picks: { ada: wrong, bola: rightResult, chidi: wrong } }),
  ];
  const { table } = await build(matches);
  // ada and chidi: one exact, 3 points. bola: three right results, 3 points.
  // All three are level on points. ada and chidi have a 3-point pick, bola has none.
  assert.equal(table.every((row) => row.points === 3), true);
  assert.equal(name(table[2].player), "bola", "no 3-point picks, so last of the three");
  assert.equal(table[2].position, 3);
  // ada and chidi are level on everything, so they share first place.
  assert.deepEqual(table.slice(0, 2).map((row) => row.position), [1, 1]);
});

test("level on points and 3-point picks: more 1-point picks comes first", async () => {
  const real = { home: 1, away: 0 };
  const matches = [
    await playMatch({ label: "m1", sport: FOOTBALL, result: real, picks: { ada: { home: 1, away: 0 }, bola: { home: 1, away: 0 } } }),
    await playMatch({ label: "m2", sport: FOOTBALL, result: real, picks: { ada: { home: 3, away: 0 }, bola: { home: 0, away: 1 } } }),
  ];
  const { table } = await build(matches);
  assert.deepEqual(lines(table), ["1 ada 4", "2 bola 3"]);
});

test("players who are level on everything share a position, and the next position is skipped", async () => {
  const real = { home: 1, away: 0 };
  const exact = { home: 1, away: 0 };
  const matches = [
    await playMatch({
      label: "m1",
      sport: FOOTBALL,
      result: real,
      picks: { ada: exact, bola: exact, chidi: { home: 2, away: 0 }, dayo: { home: 0, away: 3 } },
    }),
  ];
  const { table } = await build(matches);
  assert.deepEqual(table.map((row) => row.position), [1, 1, 3, 4]);
  assert.deepEqual(table.map((row) => row.points), [3, 3, 1, 0]);
});

test("a void match scores nobody, and shows as void on every record", async () => {
  const matches = [
    await playMatch({ label: "played", sport: FOOTBALL, result: { home: 1, away: 0 }, picks: { ada: { home: 1, away: 0 } } }),
    await playMatch({ label: "abandoned", sport: FOOTBALL, state: "void", result: undefined, picks: { ada: { home: 1, away: 0 } } }),
  ];
  const { table, records } = await build(matches);
  assert.deepEqual(lines(table), ["1 ada 3"]);
  assert.deepEqual(recordOf(records, "ada").map((r) => r.state), ["scored", "void"]);
});

test("a match with no result yet shows as pending and scores nobody", async () => {
  const matches = [
    await playMatch({ label: "tonight", sport: FOOTBALL, state: "pending", result: undefined, picks: { ada: { home: 1, away: 0 } } }),
  ];
  const { table, records } = await build(matches);
  assert.deepEqual(lines(table), ["1 ada 0"]);
  assert.equal(recordOf(records, "ada")[0].state, "pending");
});

test("a sealed pick that is never opened scores 0 and shows as not opened", async () => {
  const matches = [
    await playMatch({
      label: "m1",
      sport: FOOTBALL,
      result: { home: 1, away: 0 },
      picks: { ada: { home: 1, away: 0 }, bola: { home: 1, away: 0 } },
      open: ["ada"], // bola sealed the exact score but never opens it
    }),
  ];
  const { table, records } = await build(matches);
  assert.deepEqual(lines(table), ["1 ada 3", "2 bola 0"]);
  assert.deepEqual(recordOf(records, "bola")[0], { match: toHex(matches[0].id), state: "not-opened", points: 0 });
});

test("a player who made no pick for a match scores 0 and shows as no pick", async () => {
  const matches = [
    await playMatch({ label: "m1", sport: FOOTBALL, result: { home: 1, away: 0 }, picks: { ada: { home: 1, away: 0 }, bola: { home: 0, away: 0 } } }),
    await playMatch({ label: "m2", sport: FOOTBALL, result: { home: 1, away: 0 }, picks: { ada: { home: 1, away: 0 } } }),
  ];
  const { records } = await build(matches, [id("efe")]); // efe is in the league but never picks
  assert.deepEqual(recordOf(records, "bola").map((r) => r.state), ["scored", "no-pick"]);
  assert.deepEqual(recordOf(records, "efe").map((r) => r.state), ["no-pick", "no-pick"]);
});

test("CHEAT: a pick changed after kickoff is refused, scores 0, and the record says why", async () => {
  const match = await playMatch({
    label: "m1",
    sport: FOOTBALL,
    result: { home: 2, away: 1 },
    picks: { ada: { home: 0, away: 0 }, bola: { home: 2, away: 1 } },
  });
  // Ada sealed 0-0. After the match she opens it as 2-1.
  const adas = match.openings.find((o) => toHex(o.player) === toHex(id("ada")));
  adas.pickByte = 0x12;
  const { table, records } = await build([match]);
  assert.deepEqual(lines(table), ["1 bola 3", "2 ada 0"]);
  assert.deepEqual(recordOf(records, "ada")[0], {
    match: toHex(match.id),
    state: "refused",
    points: 0,
    reason: "does-not-match",
  });
  assert.equal(table[1].scored, 0, "a refused pick is not counted as scored");
});

test("CHEAT: a bundle locked after kickoff. Every pick in that match is refused", async () => {
  const late = await playMatch({
    label: "late",
    sport: FOOTBALL,
    result: { home: 1, away: 0 },
    picks: { ada: { home: 1, away: 0 }, bola: { home: 1, away: 0 } },
    lockedAt: KICKOFF + 60,
  });
  const { table, records } = await build([late]);
  assert.deepEqual(table.map((row) => row.points), [0, 0]);
  assert.equal(recordOf(records, "ada")[0].reason, "locked-late");
  assert.equal(recordOf(records, "bola")[0].reason, "locked-late");
});

test("CHEAT: nothing was put on chain before kickoff. Opened picks are refused", async () => {
  const match = await playMatch({ label: "m1", sport: FOOTBALL, result: { home: 1, away: 0 }, picks: { ada: { home: 1, away: 0 } } });
  match.lock = null;
  const { table, records } = await build([match]);
  assert.deepEqual(lines(table), ["1 ada 0"]);
  assert.equal(recordOf(records, "ada")[0].reason, "not-locked");
});

test("CHEAT: opening the same pick twice does not score twice", async () => {
  const match = await playMatch({ label: "m1", sport: FOOTBALL, result: { home: 1, away: 0 }, picks: { ada: { home: 1, away: 0 } } });
  match.openings.push({ ...match.openings[0] });
  const { table } = await build([match]);
  assert.deepEqual(lines(table), ["1 ada 3"]);
  assert.equal(table[0].scored, 1);
});

test("a bad opening followed by the real one: the real one counts", async () => {
  const match = await playMatch({ label: "m1", sport: FOOTBALL, result: { home: 1, away: 0 }, picks: { ada: { home: 1, away: 0 } } });
  match.openings.unshift({ ...match.openings[0], pickByte: 0x33 });
  const { table, records } = await build([match]);
  assert.deepEqual(lines(table), ["1 ada 3"]);
  assert.equal(recordOf(records, "ada")[0].state, "scored");
});

test("a published list of sealed picks that does not match the chain is ignored", async () => {
  const match = await playMatch({
    label: "m1",
    sport: FOOTBALL,
    result: { home: 1, away: 0 },
    picks: { ada: { home: 1, away: 0 }, bola: { home: 1, away: 0 } },
    open: ["ada"],
  });
  // The league publishes a list with an extra name on it. It no longer produces the root on chain.
  match.entries = [...match.entries, { player: id("efe"), fingerprint: id("made up") }];
  const { records } = await build([match]);
  assert.equal(recordOf(records, "ada")[0].state, "scored", "ada's own receipt still proves her pick");
  assert.equal(records[toHex(id("efe"))], undefined, "the made-up name is not taken on trust");
});

test("anyone who builds the table from the same facts gets the same table, whatever order the facts come in", async () => {
  const real = { home: 2, away: 2 };
  const picks = {
    ada: { home: 2, away: 2 },
    bola: { home: 1, away: 1 },
    chidi: { home: 0, away: 3 },
    dayo: { home: 2, away: 2 },
    efe: { home: 3, away: 3 },
  };
  const m1 = await playMatch({ label: "m1", sport: FOOTBALL, result: real, picks });
  const m2 = await playMatch({ label: "m2", sport: FOOTBALL, result: { home: 0, away: 3 }, picks });
  const forward = await build([m1, m2]);

  const shuffled = (m) => ({ ...m, openings: [...m.openings].reverse(), entries: [...m.entries].reverse() });
  const backward = await build([shuffled(m1), shuffled(m2)]);

  assert.deepEqual(lines(backward.table), lines(forward.table));
  // m1 ends 2-2: ada and dayo exact (3), bola and efe right result (1), chidi wrong (0).
  // m2 ends 0-3: chidi exact (3), everyone else picked a draw (0).
  assert.deepEqual(lines(forward.table).map((l) => l.replace(/^\d+ /, "")).sort(), ["ada 3", "bola 1", "chidi 3", "dayo 3", "efe 1"]);
  assert.deepEqual(forward.table.map((row) => row.position), [1, 1, 1, 4, 4]);
});
