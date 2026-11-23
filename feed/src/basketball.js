// Basketball: the NBA and the WNBA, from balldontlie.
//
// One request for each league, more if there are over 100 games:
//
//   GET https://api.balldontlie.io/v1/games?start_date=2026-11-22&end_date=2026-11-30&per_page=100
//   GET https://api.balldontlie.io/wnba/v1/games?...
//   Authorization: <key>
//
// What Kickoff takes from it:
//
//   - The result is the winner and the winning margin from the final score, overtime included.
//   - `status_state` says where a game is: scheduled, in_progress, final, postponed, canceled,
//     delayed, suspended, abandoned or unknown. Postponed, canceled and abandoned are void.
//     Delayed and suspended games are left as "live" until the feed says more.
//   - The two leagues name things differently. The NBA gives the start time as `datetime` and the
//     scores as `home_team_score` and `visitor_team_score`. The WNBA gives the start time as `date`
//     and the scores as `home_score` and `away_score`.
//   - The NBA's `date` is the day in the United States, which can be the day before in Lagos or
//     London. So the request starts a day early, and games are kept by their real start time.

import { basketballResult } from "../../engine/src/index.js";
import { count, finish, seconds } from "./shape.js";

const HOSTS = { nba: "https://api.balldontlie.io/v1", wnba: "https://api.balldontlie.io/wnba/v1" };
const VOID = { postponed: "Postponed", canceled: "Called off", abandoned: "Abandoned" };
const MAX_PAGES = 10;

/** Turn one game from the feed into Kickoff's shape. Returns { match } or { problem }. */
export function basketballGame(comp, g) {
  if (!Number.isInteger(g?.id)) return { problem: `balldontlie ${comp}: a game with no id was left out` };
  const base = {
    feedId: `balldontlie:${comp}:${g.id}`,
    comp,
    home: g.home_team?.name || g.home_team?.full_name,
    away: g.visitor_team?.name || g.visitor_team?.full_name,
    // A bare day ("2025-01-05") is not a start time, so it is not used as one.
    kickoff: seconds(g.datetime) ?? (typeof g.date === "string" && g.date.includes("T") ? seconds(g.date) : null),
  };
  const state = g.status_state;
  if (g.postponed === true || VOID[state]) return finish({ ...base, state: "void", note: VOID[state] ?? "Postponed" });
  if (state === "scheduled") return finish({ ...base, state: "scheduled" });
  if (state === "in_progress") return finish({ ...base, state: "live" });
  if (state === "delayed" || state === "suspended") return finish({ ...base, state: "live", note: "Held up. Waiting to hear whether it will be finished." });

  if (state === "final") {
    const home = count(g.home_team_score ?? g.home_score);
    const away = count(g.visitor_team_score ?? g.away_score);
    if (home === null || away === null) return finish({ ...base, state: "unknown", note: "The feed says it finished but gave no score." });
    if (home === away) return finish({ ...base, state: "unknown", note: `The feed says it finished level at ${home}, which a basketball game cannot.` });
    return finish({ ...base, state: "final", score: `${home} – ${away}`, result: basketballResult({ home, away }) });
  }
  return finish({ ...base, state: "unknown", note: `The feed could not say where this game is (${String(state)}).` });
}

const dayBefore = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/**
 * Fetch a league's games that start between two days (inclusive, written "2026-11-23", counted in
 * UTC).
 * @returns { matches, problems }
 */
export async function basketballGames({ key, comp, from, to, fetch = globalThis.fetch }) {
  const host = HOSTS[comp];
  if (!host) throw new Error(`not a basketball league: ${comp}`);
  const first = seconds(`${from}T00:00:00Z`);
  const last = seconds(`${to}T23:59:59Z`);
  const matches = [];
  const problems = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${host}/games?start_date=${dayBefore(from)}&end_date=${to}&per_page=100${cursor === null ? "" : `&cursor=${cursor}`}`;
    const response = await fetch(url, { headers: { Authorization: key } });
    if (!response.ok) {
      const why = { 401: "the key was refused", 403: "the key's plan does not cover this", 429: "too many requests in a minute" }[response.status];
      throw new Error(`balldontlie answered ${response.status}${why ? `: ${why}` : ""}`);
    }
    const body = await response.json();
    if (!Array.isArray(body?.data)) throw new Error("balldontlie's answer had no list of games");
    for (const g of body.data) {
      const { match, problem } = basketballGame(comp, g);
      if (problem) problems.push(problem);
      else if (match.kickoff >= first && match.kickoff <= last) matches.push(match);
    }
    cursor = body.meta?.next_cursor ?? null;
    if (cursor === null) return { matches, problems };
  }
  problems.push(`balldontlie ${comp}: there were more games than ${MAX_PAGES} pages, so the list is cut short`);
  return { matches, problems };
}
