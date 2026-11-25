// The matches to pick.
//
// Real matches come from Kickoff's server, which gets them from live sports data. A copy is kept
// on the device so the screens can be drawn at once and offline. Until real matches are on the
// server's list, the made-up ones in data/sample.js are shown instead, and the screens say so.
//
// A match from the server is only used if this device works out the same id for it from its facts
// (the competition, the two sides and the start time). So a pick is always sealed for the match
// the screen shows, whatever a server says.

import { BASKETBALL, FOOTBALL } from "../engine/picks.js";
import { matchIdOf } from "./picks.js";

const FIXTURES_KEY = "kickoff-fixtures";
const SPORT = { football: FOOTBALL, basketball: BASKETBALL };
const HOUR = 3600;

/**
 * @param store         from createStore() in picks.js
 * @param client        from createClient() in server.js
 * @param competitions  the competitions Kickoff covers
 * @param sample        { league, fixtures(now) }: the made-up matches, shown until there are real ones
 */
export function createFixtures({ store, client, competitions, sample }) {
  const kept = () => {
    try {
      const d = JSON.parse(store.read(FIXTURES_KEY) ?? "null");
      if (d && typeof d.league === "string" && Array.isArray(d.fixtures)) return d;
    } catch {
      // what was kept is damaged: treat it as nothing
    }
    return null;
  };

  return {
    /**
     * What the screens are handed: { real, league, fixtures, matchIds }.
     * `fixtures` is by id. For a real match the id is its match id.
     */
    async view(now) {
      const d = kept();
      const fixtures = {};
      const matchIds = {};
      for (const f of d?.fixtures ?? []) {
        const competition = competitions[f?.comp];
        if (!competition || SPORT[competition.sport] !== f.sport || !Number.isSafeInteger(f.kickoff)) continue;
        if (typeof f.home !== "string" || typeof f.away !== "string" || typeof f.id !== "string") continue;
        if (f.kickoff < now - 3 * HOUR || f.kickoff > now + 8 * 24 * HOUR) continue;
        const fixture = { comp: f.comp, home: f.home, away: f.away, kickoff: f.kickoff, state: f.state, real: true };
        // How locking this match's picks on X Layer went, once Kickoff's robot has said.
        if (f.lock === "locked" || f.lock === "missed") fixture.lock = f.lock;
        let id;
        try {
          id = await matchIdOf(d.league, fixture, competitions);
        } catch {
          continue;
        }
        if (id !== f.id) continue; // the facts do not make the id the server gave: not shown
        fixtures[id] = fixture;
        matchIds[id] = id;
      }
      if (Object.keys(fixtures).length > 0) return { real: true, league: d.league, fixtures, matchIds };

      const made = sample.fixtures(now);
      for (const [id, fixture] of Object.entries(made)) matchIds[id] = await matchIdOf(sample.league, fixture, competitions);
      return { real: false, league: sample.league, fixtures: made, matchIds };
    },
    /** Ask the server for its list. Returns true if what is kept changed. Offline, nothing changes. */
    async refresh() {
      const before = store.read(FIXTURES_KEY);
      try {
        const { league, fixtures } = await client.fixtures();
        store.write(FIXTURES_KEY, JSON.stringify({ league, fixtures }));
      } catch {
        return false;
      }
      return store.read(FIXTURES_KEY) !== before;
    },
  };
}
