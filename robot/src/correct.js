// Putting a wrong result right, by hand.
//
// The robot never changes a result once it is recorded: if the feed later says something else, the
// robot keeps the first result and opens a note for a person (see sync.js and notes.js). That is
// on purpose, so that nobody can quietly alter a result after the fact.
//
// Sometimes the first result really was wrong. A late goal is ruled out after the feed has already
// called the match finished, say. This is how a person then puts it right:
//
//   - only for a match whose predictions were never locked on X Layer. Nobody's points came from
//     its result, and its result was never written to X Layer, so nothing else changes;
//   - only to what the feed says now, read again here. Nobody types a score in;
//   - and the list keeps what the result was first recorded as, for anyone to see.
//
// A match that was locked is refused. Its points were worked out from the first result and that
// result is on X Layer, so changing it is a decision about people's points, not a correction.

import { day, fetchWeek } from "../../feed/src/index.js";
import { plan } from "./fixtures.js";


/**
 * Work out a correction, and make it if asked to.
 * @param server    Kickoff's server address
 * @param adminKey  Kickoff's key. Needed only to make the correction
 * @param keys      the two feeds' keys: { football, basketball }
 * @param words     some words of the match's name, like "Sporting CP v Man United"
 * @param now       the time in seconds
 * @param go        make the correction. Otherwise nothing is changed
 * @returns { label, kickoff, recorded, feed, done }: what Kickoff has, what the feed says, and
 *          whether it was changed. Throws, in plain words, if it cannot or should not be.
 */
export async function correctResult({ server, adminKey, keys, words, now, go = false, fetch = globalThis.fetch }) {
  const wanted = String(words ?? "").trim().toLowerCase();
  if (wanted.length < 4) throw new Error("Say which match, with a few words of its name. For example: Sporting CP v Man United.");
  const list = await fetch(`${server}/api/fixtures`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })).catch(() => null);
  if (!list || list.status !== 200 || !Array.isArray(list.body?.fixtures)) throw new Error("Kickoff's server did not give its list of matches.");

  // The match: every line of it. A football match can be three lines, one for each prediction.
  const lines = list.body.fixtures.filter((f) => f.label.toLowerCase().includes(wanted) && f.state === "final");
  const matches = [...new Set(lines.map((f) => `${f.label}|${f.kickoff}`))];
  if (matches.length === 0) throw new Error(`No finished match on Kickoff's list has "${words}" in its name.`);
  if (matches.length > 1) throw new Error(`More than one finished match has "${words}" in its name: ${[...new Set(lines.map((f) => f.label))].join("; ")}. Use more of the name.`);
  const { label, kickoff } = lines[0];
  const recorded = `final ${lines[0].score ?? ""}`.trim();
  if (lines.some((f) => f.lock === "locked")) {
    throw new Error(`Predictions for ${label} were locked on X Layer, so points were worked out from its result and the result is on X Layer too. That cannot be corrected here: it needs a decision about those points.`);
  }

  // What the feed says now, read for the days around the match.
  const feed = await fetchWeek({ keys, from: day(kickoff, -1), to: day(kickoff, 1), fetch });
  const changes = await plan({ league: list.body.league, feed: feed.matches, listed: list.body.fixtures, now });
  const mine = changes.heldBack.filter((f) => f.label === label && f.kickoff === kickoff);
  if (mine.length === 0) {
    const unread = feed.problems.length > 0 ? ` The feed could not be read fully: ${feed.problems.join(" ")}` : "";
    throw new Error(`The feed does not disagree with what Kickoff has for ${label} (${recorded}), so there is nothing to correct.${unread}`);
  }
  const says = `${mine[0].state} ${mine[0].score ?? ""}`.trim();
  if (mine.some((f) => f.state !== "final")) throw new Error(`The feed does not give a final score for ${label} now (it says "${says}"), so there is nothing to correct it to.`);
  if (!go) return { label, kickoff, recorded, feed: says, done: false };

  if (!adminKey) throw new Error("Kickoff's key is not set (KICKOFF_ADMIN_KEY).");
  // Each line is put right, and keeps what it was first recorded as.
  const byId = new Map(lines.map((f) => [f.id, f]));
  const put = mine.map((f) => ({ ...f, corrected: { from: byId.get(f.id)?.score ?? null, at: now } }));
  const response = await fetch(`${server}/api/admin/fixtures`, { method: "POST", headers: { "content-type": "application/json", "x-kickoff-admin": adminKey }, body: JSON.stringify({ fixtures: put }) });
  if (!response.ok) {
    const answer = await response.json().catch(() => null);
    throw new Error(`Kickoff's server refused the correction (status ${response.status}): ${answer?.error ?? "no reason given"}`);
  }
  return { label, kickoff, recorded, feed: says, done: true };
}

