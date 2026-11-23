// A stand-in for a league's inbox on chain, for the tests. It holds messages the way TapeOut's
// mailbox does: in order, each with who sent it and the time it arrived.
import {
  BASKETBALL, FOOTBALL, TENNIS,
  basketballResult, buildBundle, encodePick, lockMessage, matchId, matchInfoOf, matchMessage, receiptFor,
  resultMessage, sealPick, toHex, writeOpenings,
} from "../src/index.js";
import { id } from "./helpers.js";

export const LEAGUE_ACCOUNT = "0x00000000000000000000000000000000000a11ce";
export const STRANGER = "0x000000000000000000000000000000000000beef";
export const MEMBER = "0x0000000000000000000000000000000000c0ffee";
export const LEAGUE = id("league endpoint");
export const START = 1_800_000_000;

export class Inbox {
  messages = [];
  now = START;
  at(time) {
    this.now = time;
    return this;
  }
  send(from, { ref, payload }) {
    this.messages.push({ index: this.messages.length, from, timestamp: this.now, ref, payload });
    return this.messages.length - 1;
  }
}

/** Players seal picks for a match and the league bundles them. Nothing is sent anywhere. */
export async function sealAndBundle(fixture, picks) {
  const match = await matchId(LEAGUE, fixture);
  const sealed = {};
  for (const [name, pick] of Object.entries(picks)) {
    sealed[name] = await sealPick({ league: LEAGUE, match, sport: fixture.sport, pick, player: id(name), matchInfo: matchInfoOf(fixture) });
  }
  const entries = Object.keys(picks).map((name) => ({ player: id(name), fingerprint: sealed[name].fingerprint }));
  const bundle = await buildBundle({ league: LEAGUE, match, entries });
  const openings = [];
  for (const name of Object.keys(picks)) {
    openings.push({ pickByte: sealed[name].pickByte, player: id(name), salt: sealed[name].salt, receipt: await receiptFor(bundle, id(name)) });
  }
  return { match, bundle, entries, openings, file: writeOpenings({ match, entries, openings }) };
}

export const FIXTURES = {
  football: { sport: FOOTBALL, kickoff: START + 3600, bestOf: 0, label: "Arsenal v Chelsea" },
  basketball: { sport: BASKETBALL, kickoff: START + 7200, bestOf: 0, label: "Lakers v Celtics" },
  tennis: { sport: TENNIS, kickoff: START + 10800, bestOf: 5, label: "Alcaraz v Sinner" },
};

const PICKS = {
  football: { ada: { home: 2, away: 1 }, bola: { home: 1, away: 0 }, chidi: { home: 0, away: 0 } },
  basketball: { ada: { winner: "home", band: "A" }, bola: { winner: "home", band: "B" }, chidi: { winner: "away", band: "B" } },
  tennis: { ada: { winner: "A", sets: 4 }, bola: { winner: "B", sets: 3 }, chidi: { winner: "A", sets: 5 } },
};

const RESULTS = {
  football: { home: 2, away: 1 },
  basketball: basketballResult({ home: 104, away: 97 }),
  tennis: { winner: "A", sets: 4 },
};

/**
 * An honest season of three matches, written to an inbox the way a league would:
 * every match announced at the start, each bundle locked ten minutes before kickoff, each result
 * given two hours after. Returns the inbox, the openings files, and the pieces, so a test can
 * change one thing and see what happens.
 */
export async function honestSeason() {
  const inbox = new Inbox();
  const files = {};
  const parts = {};
  for (const fixture of Object.values(FIXTURES)) inbox.send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, fixture));
  for (const [key, fixture] of Object.entries(FIXTURES)) {
    const made = await sealAndBundle(fixture, PICKS[key]);
    inbox.at(fixture.kickoff - 600).send(LEAGUE_ACCOUNT, await lockMessage(made.bundle));
    parts[key] = made;
    files[toHex(made.match)] = made.file;
  }
  for (const [key, fixture] of Object.entries(FIXTURES)) {
    const resultByte = encodePick(fixture.sport, RESULTS[key], matchInfoOf(fixture));
    inbox.at(fixture.kickoff + 7200).send(LEAGUE_ACCOUNT, resultMessage(parts[key].match, resultByte));
  }
  return { inbox, files, parts };
}
