// Football: the Premier League, the Champions League, La Liga and Serie A, from football-data.org (version 4).
//
// One request for each competition:
//
//   GET https://api.football-data.org/v4/competitions/PL/matches?dateFrom=2026-11-23&dateTo=2026-11-30
//   X-Auth-Token: <key>
//
// What Kickoff takes from it:
//
//   - The result is the score after 90 minutes. For a match that went to extra time or penalties,
//     the feed gives that in `score.regularTime`; `score.fullTime` there includes the extra-time
//     goals and the penalties. For a match that ended in normal time, `score.fullTime` is the
//     90-minute score.
//   - A side that scores more than 15 is recorded as 15, as the rules say.
//   - POSTPONED and CANCELLED are void. So is AWARDED: a result handed out by a committee is not a
//     result anybody predicted.
//   - SUSPENDED is not void yet. A match stopped part way may be finished later, so it is left as
//     "live" until the feed says more.

import { footballResult } from "../../engine/src/index.js";
import { count, finish, seconds } from "./shape.js";

const HOST = "https://api.football-data.org/v4";
// La Liga is "PD" in the feed (Primera División) and Serie A is "SA".
export const FOOTBALL_CODES = { pl: "PL", cl: "CL", ll: "PD", sa: "SA" };

const VOID = {
  POSTPONED: "Postponed",
  CANCELLED: "Called off",
  AWARDED: "The result was awarded, not played out",
};
const side = (node, which) => count(node?.[which] ?? node?.[`${which}Team`]);

/** Turn one match from the feed into Kickoff's shape. Returns { match } or { problem }. */
export function footballMatch(comp, m) {
  const base = {
    feedId: `football-data:${m?.id}`,
    comp,
    home: m?.homeTeam?.shortName || m?.homeTeam?.name,
    away: m?.awayTeam?.shortName || m?.awayTeam?.name,
    kickoff: seconds(m?.utcDate),
  };
  if (!Number.isInteger(m?.id)) return { problem: "football-data: a match with no id was left out" };
  const status = m.status;

  if (status === "SCHEDULED" || status === "TIMED") return finish({ ...base, state: "scheduled" });
  if (status === "IN_PLAY" || status === "PAUSED" || status === "SUSPENDED") {
    return finish({ ...base, state: "live", note: status === "SUSPENDED" ? "Stopped part way. Waiting to hear whether it will be finished." : null });
  }
  if (VOID[status]) return finish({ ...base, state: "void", note: VOID[status] });

  if (status === "FINISHED") {
    const duration = m.score?.duration ?? "REGULAR";
    const ninety = duration === "REGULAR" ? m.score?.fullTime : m.score?.regularTime;
    const home = side(ninety, "home");
    const away = side(ninety, "away");
    if (home === null || away === null) {
      const why =
        duration === "REGULAR"
          ? "The feed says it finished but gave no score."
          : "It went past 90 minutes and the feed did not give the 90-minute score.";
      return finish({ ...base, state: "unknown", note: why });
    }
    const extra = duration === "EXTRA_TIME" ? " after 90 minutes (it went to extra time)" : duration === "PENALTY_SHOOTOUT" ? " after 90 minutes (it went to penalties)" : "";
    return finish({ ...base, state: "final", score: `${home} – ${away}${extra}`, result: footballResult({ home, away }) });
  }
  return finish({ ...base, state: "unknown", note: `The feed gave a status this code does not know: ${String(status)}` });
}

/**
 * Fetch a competition's matches between two days (inclusive, written "2026-11-23").
 * @returns { matches, problems }
 */
export async function footballMatches({ key, comp, from, to, fetch = globalThis.fetch }) {
  const code = FOOTBALL_CODES[comp];
  if (!code) throw new Error(`not a football competition: ${comp}`);
  const response = await fetch(`${HOST}/competitions/${code}/matches?dateFrom=${from}&dateTo=${to}`, { headers: { "X-Auth-Token": key } });
  if (!response.ok) {
    const why = { 400: "the request was refused as badly formed", 401: "the key was refused", 403: "this competition is not in the plan the key is on", 429: "too many requests in a minute" }[response.status];
    throw new Error(`football-data.org answered ${response.status}${why ? `: ${why}` : ""}`);
  }
  const body = await response.json();
  if (!Array.isArray(body?.matches)) throw new Error("football-data.org's answer had no list of matches");
  const matches = [];
  const problems = [];
  for (const m of body.matches) {
    const { match, problem } = footballMatch(comp, m);
    if (match) matches.push(match);
    else problems.push(problem);
  }
  return { matches, problems };
}
