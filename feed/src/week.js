// Every competition's matches for a stretch of days, from both feeds, in one list.

import { basketballGames } from "./basketball.js";
import { footballMatches } from "./football.js";
import { COMPETITIONS } from "./shape.js";

export const FOOTBALL = ["pl", "cl"];
export const BASKETBALL = ["nba", "wnba"];

/**
 * @param keys  { football, basketball }: the two feeds' keys. A feed with no key is skipped, and
 *              the list of problems says so.
 * @param from, to  days written "2026-11-23", inclusive
 * @returns { matches, problems, fetched }
 *   matches   every match, soonest first
 *   problems  everything that went wrong or was left out, in plain words. One feed failing does
 *             not stop the other, but it is never hidden.
 *   fetched   how many matches came from each competition, or null where the fetch failed
 */
export async function fetchWeek({ keys, from, to, competitions = [...FOOTBALL, ...BASKETBALL], fetch = globalThis.fetch }) {
  const matches = [];
  const problems = [];
  const fetched = {};
  for (const comp of competitions) {
    const football = FOOTBALL.includes(comp);
    const key = football ? keys.football : keys.basketball;
    const name = COMPETITIONS[comp].name;
    if (!key) {
      problems.push(`${name}: no key was given for the ${football ? "football" : "basketball"} feed, so it was not fetched`);
      fetched[comp] = null;
      continue;
    }
    try {
      const got = await (football ? footballMatches : basketballGames)({ key, comp, from, to, fetch });
      matches.push(...got.matches);
      problems.push(...got.problems);
      fetched[comp] = got.matches.length;
    } catch (error) {
      problems.push(`${name}: could not be fetched (${error.message})`);
      fetched[comp] = null;
    }
  }
  matches.sort((a, b) => a.kickoff - b.kickoff || a.label.localeCompare(b.label));
  return { matches, problems, fetched };
}

/** A day written "2026-11-23", `days` on from the day of `now` (in seconds), counted in UTC. */
export function day(now, days = 0) {
  return new Date((now + days * 86400) * 1000).toISOString().slice(0, 10);
}
