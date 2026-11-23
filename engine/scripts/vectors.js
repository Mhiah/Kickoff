// Plays out a small, fixed league with the engine and writes down every value along the way:
// each pick's fingerprint, each bundle's root, each receipt, the points and the final table.
//
// The file it produces, vectors/league.json, is read by the chain rehearsal
// (chain/test/LeagueSeason.t.sol), which works the same values out again in Solidity, with the
// real TapeOut contracts doing the scoring. If the engine and the chain ever disagreed, that
// rehearsal would fail.
//
// Everything here is fixed, including the salts, so the file is the same every time it is made.
// Real salts are random. These are not, on purpose.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  BASKETBALL, FOOTBALL, TENNIS,
  basketballResult, buildBundle, buildTable, encodePick, fingerprintOf, loadCircuits, lockRef, receiptFor, toHex,
} from "../src/index.js";

const fixed = (label) => new Uint8Array(createHash("sha256").update(`kickoff vector: ${label}`).digest());
const hex = (bytes) => `0x${toHex(bytes)}`;

const circuitsDir = new URL("../../circuits/out/", import.meta.url);
const circuitHex = (name) => readFileSync(new URL(`${name}.hex`, circuitsDir), "utf8");

const LEAGUE = fixed("league");
const PLAYERS = ["ada", "bola", "chidi"];

// Three matches, one for each sport. Kickoff is given as seconds after the rehearsal starts.
const SEASON = [
  {
    label: "football",
    sport: FOOTBALL,
    matchInfo: {},
    kickoffAfter: 3600,
    picks: { ada: { home: 2, away: 1 }, bola: { home: 1, away: 0 }, chidi: { home: 0, away: 0 } },
    result: { home: 2, away: 1 },
  },
  {
    label: "basketball",
    sport: BASKETBALL,
    matchInfo: {},
    kickoffAfter: 7200,
    picks: {
      ada: { winner: "home", band: "A" },
      bola: { winner: "home", band: "B" },
      chidi: { winner: "away", band: "B" },
    },
    result: basketballResult({ home: 104, away: 97 }),
  },
  {
    label: "tennis",
    sport: TENNIS,
    matchInfo: { bestOf: 5 },
    kickoffAfter: 10800,
    picks: { ada: { winner: "A", sets: 4 }, bola: { winner: "B", sets: 3 }, chidi: { winner: "A", sets: 5 } },
    result: { winner: "A", sets: 4 },
  },
];

export async function makeVectors() {
  const circuits = loadCircuits({
    football: circuitHex("football"),
    basketball: circuitHex("basketball"),
    tennis: circuitHex("tennis"),
  });

  const matches = [];
  const forTable = [];
  for (const m of SEASON) {
    const match = fixed(`match: ${m.label}`);
    const sealed = {};
    for (const name of PLAYERS) {
      const pickByte = encodePick(m.sport, m.picks[name], m.matchInfo);
      const salt = fixed(`salt: ${m.label} / ${name}`);
      const fingerprint = await fingerprintOf({ league: LEAGUE, match, sport: m.sport, pickByte, player: fixed(name), salt });
      sealed[name] = { pickByte, salt, fingerprint };
    }
    const entries = PLAYERS.map((name) => ({ player: fixed(name), fingerprint: sealed[name].fingerprint }));
    const bundle = await buildBundle({ league: LEAGUE, match, entries });

    const openings = [];
    const picks = [];
    for (const name of PLAYERS) {
      const receipt = await receiptFor(bundle, fixed(name));
      openings.push({ pickByte: sealed[name].pickByte, player: fixed(name), salt: sealed[name].salt, receipt });
      picks.push({
        name,
        player: hex(fixed(name)),
        pickByte: sealed[name].pickByte,
        salt: hex(sealed[name].salt),
        fingerprint: hex(sealed[name].fingerprint),
        index: receipt.index,
        path: receipt.path.map(hex),
      });
    }
    forTable.push({
      id: match,
      sport: m.sport,
      kickoff: 1_000_000 + m.kickoffAfter,
      matchInfo: m.matchInfo,
      state: "final",
      result: m.result,
      lock: { root: bundle.root, count: bundle.count, lockedAt: 1_000_000 },
      entries,
      openings,
    });
    matches.push({
      label: m.label,
      id: hex(match),
      sport: m.sport,
      bestOf5: m.matchInfo.bestOf === 5,
      kickoffAfter: m.kickoffAfter,
      resultByte: encodePick(m.sport, m.result, m.matchInfo),
      count: bundle.count,
      root: hex(bundle.root),
      lockRef: hex(await lockRef(bundle)),
      picks,
    });
  }

  const { table, records } = await buildTable({ league: LEAGUE, matches: forTable, circuits });
  matches.forEach((m, i) => {
    for (const pick of m.picks) pick.points = records[pick.player.slice(2)][i].points;
  });

  return {
    about: "Made by engine/scripts/vectors.js. Do not edit by hand. Salts here are fixed on purpose; real ones are random.",
    league: hex(LEAGUE),
    matchCount: matches.length,
    playerCount: PLAYERS.length,
    matches,
    table: table.map((row) => ({
      name: PLAYERS.find((n) => toHex(fixed(n)) === toHex(row.player)),
      player: hex(row.player),
      position: row.position,
      points: row.points,
      threes: row.threes,
      ones: row.ones,
    })),
  };
}

export const VECTORS_FILE = new URL("../vectors/league.json", import.meta.url);
export const asText = (vectors) => `${JSON.stringify(vectors, null, 2)}\n`;
