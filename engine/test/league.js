// Plays out matches for the tests: players seal picks, the league bundles and locks them, and some
// or all of the players open theirs afterwards.
import { readFileSync } from "node:fs";
import { buildBundle, loadCircuits, receiptFor, sealPick } from "../src/index.js";
import { KICKOFF, LEAGUE, id } from "./helpers.js";

const out = new URL("../../circuits/out/", import.meta.url);
const hex = (name) => readFileSync(new URL(`${name}.hex`, out), "utf8");

/** The three scoring circuits, read from circuits/out/, the same files that go on chain. */
export const CIRCUITS = loadCircuits({ football: hex("football"), basketball: hex("basketball"), tennis: hex("tennis") });
export const CHECK_RESULTS = JSON.parse(readFileSync(new URL("check.json", out), "utf8"));

/**
 * @param picks  { name: pick } for every player who seals a pick
 * @param open   the names of the players who open theirs (everyone, unless told otherwise)
 * @param joined { name: when they joined Kickoff, in seconds }, for the players the league says so for
 */
export async function playMatch({
  label,
  sport,
  picks,
  result,
  state = "final",
  matchInfo = {},
  kickoff = KICKOFF,
  lockedAt = kickoff - 600,
  open = Object.keys(picks),
  joined = {},
}) {
  const matchId = id(`match: ${label}`);
  const sealed = {};
  for (const [name, pick] of Object.entries(picks)) {
    sealed[name] = await sealPick({ league: LEAGUE, match: matchId, sport, pick, player: id(name), matchInfo });
  }
  const entries = Object.keys(picks).map((name) => ({ player: id(name), fingerprint: sealed[name].fingerprint, ...(name in joined ? { joined: joined[name] } : {}) }));
  const bundle = await buildBundle({ league: LEAGUE, match: matchId, entries });
  const openings = [];
  for (const name of open) {
    openings.push({
      pickByte: sealed[name].pickByte,
      player: id(name),
      salt: sealed[name].salt,
      receipt: await receiptFor(bundle, id(name)),
    });
  }
  return {
    id: matchId,
    sport,
    kickoff,
    matchInfo,
    state,
    result,
    lock: { root: bundle.root, count: bundle.count, lockedAt },
    entries,
    openings,
  };
}
