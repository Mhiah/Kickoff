// One run of the robot's first job: make Kickoff's list match the feed.
//
// It reads the feed, reads Kickoff's list, works out the difference (fixtures.js) and sends only
// what changed. The robot's key goes to Kickoff's own server and nowhere else, in a header, and is
// never written to the report.

import { day, fetchWeek } from "../../feed/src/index.js";
import { AHEAD, BEHIND, CONFIRM_AFTER, holdResults, plan } from "./fixtures.js";

/**
 * @param server    Kickoff's server address
 * @param adminKey  the robot's key
 * @param keys      the two feeds' keys: { football, basketball }
 * @param now       the time in seconds
 * @param dryRun    work everything out and report it, but change nothing
 * @param fetch     the function used to make web requests (the tests pass a stand-in)
 * @returns a report: { ok, dryRun, from, to, fetched, added, updated, calledOff, unchanged, problems }
 */
/**
 * @param pending  the final scores being waited on (see holdResults in fixtures.js), kept by the
 *                 caller between rounds. A round with no memory of its own never records a final
 *                 score: it only starts the wait. Null switches the waiting off.
 */
export async function syncFixtures({ server, adminKey, keys, now, dryRun = false, fetch = globalThis.fetch, pending = new Map(), wait = CONFIRM_AFTER }) {
  const report = { ok: true, dryRun, from: day(now, -BEHIND), to: day(now, AHEAD), fetched: {}, added: [], updated: [], calledOff: [], replaced: [], waiting: [], lookAgainAt: null, unchanged: 0, problems: [] };

  const list = await fetch(`${server}/api/fixtures`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch(() => null);
  if (!list || list.status !== 200 || !Array.isArray(list.body?.fixtures)) {
    report.ok = false;
    report.problems.push(`Kickoff's server did not give its list of matches${list ? ` (status ${list.status})` : ""}`);
    return report;
  }

  const feed = await fetchWeek({ keys, from: report.from, to: report.to, fetch });
  report.fetched = feed.fetched;
  report.problems.push(...feed.problems);
  // A competition that could not be fetched is left exactly as it is on the list. It is not a
  // reason to stop the others.
  if (Object.values(feed.fetched).every((n) => n === null)) report.ok = false;

  // A final score is acted on only once the feed has given the same one twice, some minutes apart.
  const held = pending ? holdResults({ feed: feed.matches, listed: list.body.fixtures, pending, now, wait }) : { feed: feed.matches, waiting: [], lookAgainAt: null };
  report.waiting = held.waiting;
  report.lookAgainAt = held.lookAgainAt;
  const changes = await plan({ league: list.body.league, feed: held.feed, listed: list.body.fixtures, now });
  report.added = changes.added;
  report.updated = changes.updated;
  report.calledOff = changes.calledOff;
  report.replaced = changes.replaced;
  report.unchanged = changes.unchanged;
  for (const u of changes.updated.filter((x) => x.refused)) report.problems.push(`${u.label}: the feed now says "${u.to}" for a match already finished as "${u.from}". Left as it was.`);

  if (changes.put.length === 0 || dryRun) return report;
  // Sent in small batches, so one refused match does not hold up the rest.
  for (let i = 0; i < changes.put.length; i += 25) {
    const batch = changes.put.slice(i, i + 25);
    let response;
    try {
      response = await fetch(`${server}/api/admin/fixtures`, { method: "POST", headers: { "content-type": "application/json", "x-kickoff-admin": adminKey }, body: JSON.stringify({ fixtures: batch }) });
    } catch {
      report.ok = false;
      report.problems.push("Kickoff's server could not be reached to update its list");
      break;
    }
    if (!response.ok) {
      const answer = await response.json().catch(() => null);
      report.ok = false;
      report.problems.push(`Kickoff's server refused an update (status ${response.status}): ${answer?.error ?? "no reason given"}`);
      if (response.status === 403) break; // the key is wrong: no point trying the rest
    }
  }
  return report;
}

/** The report in plain words, one line each. */
export function inWords(report) {
  const lines = [];
  const names = { pl: "Premier League", cl: "Champions League", ll: "La Liga", sa: "Serie A", nba: "NBA", wnba: "WNBA" };
  lines.push(`Matches from ${report.from} to ${report.to}${report.dryRun ? " (a dry run: nothing was changed)" : ""}`);
  for (const [comp, n] of Object.entries(report.fetched)) lines.push(`  ${names[comp] ?? comp}: ${n === null ? "could not be fetched" : `${n} in the feed`}`);
  lines.push(`Added: ${report.added.length}. Updated: ${report.updated.filter((u) => !u.refused).length}. Called off: ${report.calledOff.length}. Unchanged: ${report.unchanged}.`);
  for (const label of report.added.slice(0, 40)) lines.push(`  + ${label}`);
  if (report.added.length > 40) lines.push(`  + and ${report.added.length - 40} more`);
  for (const u of report.updated.filter((x) => !x.refused)) lines.push(`  ~ ${u.label}: ${u.from} -> ${u.to}`);
  for (const label of report.calledOff) lines.push(`  x ${label}: moved, so the old time is off`);
  for (const label of report.replaced ?? []) lines.push(`  x ${label}: was one prediction, now three (result, goal goal, exact score)`);
  for (const w of report.waiting ?? []) {
    lines.push(`  … ${w.label}: the feed says it finished ${w.score}${w.changedFrom ? `, where it said ${w.changedFrom} before` : ""}. Not recorded until the feed says so again.`);
  }
  if (report.problems.length) lines.push("Problems:");
  for (const p of report.problems) lines.push(`  ! ${p}`);
  return lines.join("\n");
}
