// From the feed's matches to Kickoff's list.
//
// The feed says what the matches are. Kickoff's server keeps the list players pick from. This file
// works out what has to change on that list so it matches the feed, and nothing else: it makes no
// web requests and holds no key, so every rule here can be checked on its own.
//
// A match's id is made from its facts: the competition, the two sides and the start time. So:
//   - the same match always gets the same id, however often the robot runs
//   - a match that is moved to a new time is a new match with a new id. The old one is called off,
//     and nobody scores for it.

import { matchId, toHex } from "../../engine/src/index.js";

/** How far ahead matches are put on the list, and how far back results are still looked for, in days. */
export const AHEAD = 7;
export const BEHIND = 2;

/** The parts of a match that the list keeps and shows. */
const shown = (m) => ({
  feedId: m.feedId, comp: m.comp, sport: m.sport, kickoff: m.kickoff, label: m.label, home: m.home, away: m.away, state: m.state,
  ...(m.score ? { score: m.score } : {}),
  ...(m.state === "final" ? { resultByte: m.resultByte } : {}),
  ...(m.note ? { note: m.note } : {}),
});

/** Give each of the feed's matches its Kickoff id. */
export async function withIds(league, matches) {
  const out = [];
  for (const m of matches) {
    out.push({ id: toHex(await matchId(league, { sport: m.sport, kickoff: m.kickoff, bestOf: 0, label: m.label })), ...shown(m) });
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const comparable = (f) => {
  const { id, feedId, comp, sport, kickoff, label, home, away, state, score, resultByte, note } = f;
  return { id, feedId, comp, sport, kickoff, label, home, away, state, score, resultByte, note };
};

/**
 * What has to change on Kickoff's list.
 * @param league  Kickoff's id on X Layer
 * @param feed    the feed's matches for the days being looked at
 * @param listed  what is on Kickoff's list now
 * @param now     the time in seconds
 * @returns { put, added, updated, calledOff, unchanged }
 *   put        the matches to send to the server, new and changed together
 *   added      new matches (by label)
 *   updated    matches whose state or score changed: [{ label, from, to }]
 *   calledOff  matches the feed has moved to another time, so the old one is off: [label]
 */
export async function plan({ league, feed, listed, now }) {
  const wanted = await withIds(league, feed);
  const byId = new Map(listed.map((f) => [f.id, f]));
  const put = [];
  const added = [];
  const updated = [];
  const calledOff = [];
  let unchanged = 0;

  for (const w of wanted) {
    const have = byId.get(w.id);
    if (!have) {
      // A match that has already started is not put on the list for the first time: nobody could
      // have picked it.
      if (w.kickoff <= now) continue;
      put.push(w);
      added.push(w.label);
    } else if (!same(comparable(have), comparable(w))) {
      // A finished match stays finished. A feed that goes back on a result is flagged, not obeyed.
      if (have.state === "final" && (w.state !== "final" || w.resultByte !== have.resultByte)) {
        updated.push({ label: w.label, from: `final ${have.score ?? ""}`.trim(), to: `${w.state} ${w.score ?? ""}`.trim(), refused: true });
        continue;
      }
      put.push(w);
      updated.push({ label: w.label, from: `${have.state} ${have.score ?? ""}`.trim(), to: `${w.state} ${w.score ?? ""}`.trim() });
    } else {
      unchanged++;
    }
  }

  // A match the feed still has, under the same name of its own, but at a different time: it has
  // been moved. The one on the list at the old time is called off.
  const nowAt = new Map(wanted.map((w) => [w.feedId, w.id]));
  for (const have of listed) {
    const movedTo = nowAt.get(have.feedId);
    if (movedTo && movedTo !== have.id && have.state !== "void" && have.state !== "final") {
      put.push({ ...comparable(have), state: "void", note: "moved to another time", score: undefined, resultByte: undefined });
      calledOff.push(have.label);
    }
  }
  return { put: put.map((f) => JSON.parse(JSON.stringify(f))), added, updated, calledOff, unchanged };
}
