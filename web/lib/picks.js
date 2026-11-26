// Sealing a pick on the visitor's own device, and keeping it there.
//
// Nothing here talks to a server. A pick is sealed with the picks engine (the copy in web/engine),
// and the pick and its secret are kept in this browser. Only the fingerprint is ever meant to
// leave the device before kickoff.
//
// A pick is sealed for one player: the id that belongs to this device's own key (lib/device.js).

import { fromHex, toHex } from "../engine/bytes.js";
import { matchId } from "../engine/match.js";
import { BASKETBALL, FOOTBALL, GOAL_GOAL, RESULT, SCORE } from "../engine/picks.js";
import { sealPick } from "../engine/seal.js";
import { hasClosed } from "./time.js";

const SPORT = { football: FOOTBALL, basketball: BASKETBALL };
const PICKS_KEY = "kickoff-picks";

/**
 * The facts about a match that go into its id. The competition is part of the label, so two
 * competitions can never share a match.
 */
export function fixtureFacts(fixture, competitions) {
  const competition = competitions[fixture.comp];
  // A football match is three predictions, each a match of its own with its own kind (`sport`):
  // the result, goal goal, the exact score. A fixture that says which one it is, is that one.
  return { sport: fixture.sport ?? SPORT[competition.sport], kickoff: fixture.kickoff, bestOf: 0, label: `${competition.name}: ${fixture.home} v ${fixture.away}` };
}

/** A match's id, as hex. */
export async function matchIdOf(league, fixture, competitions) {
  return toHex(await matchId(league, fixtureFacts(fixture, competitions)));
}

/**
 * Somewhere to keep picks. `storage` is the browser's localStorage, or anything shaped like it.
 * If the browser will not store anything (private browsing can refuse), picks are kept for this
 * visit only, and `lasting` says so.
 */
export function createStore(storage) {
  const memory = new Map();
  let lasting = true;
  const read = (key) => {
    try {
      const value = storage?.getItem(key);
      return value ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  };
  const write = (key, value) => {
    memory.set(key, value);
    try {
      if (!storage) throw new Error("nowhere to store");
      storage.setItem(key, value);
    } catch {
      lasting = false;
    }
  };
  const picks = () => {
    try {
      const all = JSON.parse(read(PICKS_KEY) ?? "{}");
      return all && typeof all === "object" && !Array.isArray(all) ? all : {};
    } catch {
      return {}; // what was stored is damaged: start again and do not crash
    }
  };
  return {
    /** Whether picks will still be here after the browser is closed. */
    get lasting() {
      return lasting;
    },
    /** Anything else this device keeps (its key, its groups), as text under a name. */
    read,
    write,
    /**
     * The picks kept on this device, by match id. Given a player id, only that player's: a pick
     * sealed for any other id could never be opened by this device's key, so it is not shown.
     */
    all(player) {
      const all = picks();
      if (player === undefined) return all;
      return Object.fromEntries(Object.entries(all).filter(([, entry]) => entry?.player === player));
    },
    /** The pick kept for a match, or null. */
    get(match) {
      return picks()[match] ?? null;
    },
    save(entry) {
      write(PICKS_KEY, JSON.stringify({ ...picks(), [entry.match]: entry }));
    },
  };
}

/**
 * Seal a pick for a match and keep it on this device. Sealing again for the same match replaces
 * the earlier pick with a new secret.
 *
 * @param player  this device's player id, as hex
 * @returns the entry that was kept: { match, player, sport, pick, pickByte, salt, fingerprint, sealedAt }
 *          and, if an earlier pick had already been sent, `fallback`: that earlier entry
 */
export async function seal({ store, league, fixture, competitions, pick, now, player }) {
  if (hasClosed(now, fixture.kickoff)) throw new Error("Predictions for this match have closed.");
  if (typeof player !== "string" || !/^[0-9a-f]{64}$/.test(player)) throw new Error("This device has no player id yet.");
  const facts = fixtureFacts(fixture, competitions);
  const match = await matchId(league, facts);
  const sealed = await sealPick({ league, match, sport: facts.sport, pick, player: fromHex(player) });
  // If a pick for this match has already been sent to Kickoff, keep it until the new one has been
  // sent too. Should the new one never get through, the earlier one is still the one Kickoff holds,
  // and without its secret it could never be opened.
  const before = store.get(toHex(match));
  const { fallback: olderFallback = null, ...beforeItself } = before?.player === player ? before : {};
  const fallback = before?.player === player ? (before.sent ? beforeItself : olderFallback) : null;
  const entry = {
    match: toHex(match),
    player,
    sport: facts.sport,
    pick,
    pickByte: sealed.pickByte,
    salt: toHex(sealed.salt),
    fingerprint: toHex(sealed.fingerprint),
    sealedAt: now,
    ...(fallback ? { fallback } : {}),
  };
  store.save(entry);
  return entry;
}

const BANDS = { A: "1 to 5", B: "6 to 10", C: "11 to 15", D: "16 or more" };
export const BAND_KEYS = Object.keys(BANDS);
export const bandWords = (band) => BANDS[band];

/** A pick in words: "2 – 1", or "Knicks by 6 to 10". */
export function pickWords(entry, fixture) {
  if (entry.sport === FOOTBALL || entry.sport === SCORE) return `${entry.pick.home} – ${entry.pick.away}`;
  if (entry.sport === RESULT) return entry.pick.result === "draw" ? "Draw" : `${entry.pick.result === "home" ? fixture.home : fixture.away} win`;
  if (entry.sport === GOAL_GOAL) return `Goal Goal: ${entry.pick.both ? "yes" : "no"}`;
  return `${entry.pick.winner === "home" ? fixture.home : fixture.away} by ${BANDS[entry.pick.band]}`;
}

/** The three predictions of a football match, by their kind, with the name each goes by. */
export const MARKETS = { [RESULT]: "Result", [GOAL_GOAL]: "Goal Goal", [SCORE]: "Exact score" };
/** The most points one prediction of this kind can give. */
export const pointsFor = (sport) => (sport === RESULT || sport === GOAL_GOAL ? 1 : 3);
