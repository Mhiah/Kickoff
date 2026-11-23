// Sealing a pick on the visitor's own device, and keeping it there.
//
// Nothing here talks to a server. A pick is sealed with the picks engine (the copy in web/engine),
// and the pick and its secret are kept in this browser. Only the fingerprint is ever meant to
// leave the device before kickoff.

import { fromHex, randomBytes, toHex } from "../engine/bytes.js";
import { matchId } from "../engine/match.js";
import { BASKETBALL, FOOTBALL } from "../engine/picks.js";
import { sealPick } from "../engine/seal.js";
import { hasClosed } from "./time.js";

const SPORT = { football: FOOTBALL, basketball: BASKETBALL };
const PICKS_KEY = "kickoff-picks";
const PLAYER_KEY = "kickoff-player";

/**
 * The facts about a match that go into its id. The competition is part of the label, so two
 * competitions can never share a match.
 */
export function fixtureFacts(fixture, competitions) {
  const competition = competitions[fixture.comp];
  return { sport: SPORT[competition.sport], kickoff: fixture.kickoff, bestOf: 0, label: `${competition.name}: ${fixture.home} v ${fixture.away}` };
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
    /** This device's player id: 32 random bytes, made the first time it is asked for. */
    playerId() {
      let id = read(PLAYER_KEY);
      if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) {
        id = toHex(randomBytes(32));
        write(PLAYER_KEY, id);
      }
      return id;
    },
    /** Every pick kept on this device, by match id. */
    all: picks,
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
 * @returns the entry that was kept: { match, sport, pick, pickByte, salt, fingerprint, sealedAt }
 */
export async function seal({ store, league, fixture, competitions, pick, now }) {
  if (hasClosed(now, fixture.kickoff)) throw new Error("Picks for this match have closed.");
  const facts = fixtureFacts(fixture, competitions);
  const match = await matchId(league, facts);
  const sealed = await sealPick({ league, match, sport: facts.sport, pick, player: fromHex(store.playerId()) });
  const entry = {
    match: toHex(match),
    sport: facts.sport,
    pick,
    pickByte: sealed.pickByte,
    salt: toHex(sealed.salt),
    fingerprint: toHex(sealed.fingerprint),
    sealedAt: now,
  };
  store.save(entry);
  return entry;
}

const BANDS = { A: "1 to 5", B: "6 to 10", C: "11 to 15", D: "16 or more" };
export const BAND_KEYS = Object.keys(BANDS);
export const bandWords = (band) => BANDS[band];

/** A pick in words: "2 – 1", or "Knicks by 6 to 10". */
export function pickWords(entry, fixture) {
  if (entry.sport === FOOTBALL) return `${entry.pick.home} – ${entry.pick.away}`;
  return `${entry.pick.winner === "home" ? fixture.home : fixture.away} by ${BANDS[entry.pick.band]}`;
}
