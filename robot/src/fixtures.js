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

import { FOOTBALL, FOOTBALL_MARKETS, GOAL_GOAL, RESULT, SCORE, matchId, toHex } from "../../engine/src/index.js";

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
 * @returns { put, added, updated, calledOff, unchanged, heldBack }
 *   put        the matches to send to the server, new and changed together
 *   added      new matches (by label)
 *   updated    matches whose state or score changed: [{ label, from, to }]
 *   calledOff  matches the feed has moved to another time, so the old one is off: [label]
 *   heldBack   the lines the feed now gives differently for a match already finished. They are
 *              flagged and never sent. A person can put one right with correct.js.
 */
/** Predictions close this long before kickoff, in seconds. The same number as the server's. */
const CLOSES_BEFORE = 10 * 60;
const MARKET_TAGS = { [RESULT]: "result", [GOAL_GOAL]: "goalgoal", [SCORE]: "score" };
const REPLACED = "now three predictions";

/**
 * A football match is three predictions: the result, goal goal and the exact score. Each is a
 * match of its own on Kickoff's list, with its own id, and all three share the teams, the time
 * and the result. This turns the feed's one football match into those three.
 *
 * The first football matches were listed as ONE prediction (the exact score). One of those that
 * has already closed, or finished, is left to play out as it was. One that is still open is
 * replaced by the three (see plan() below).
 */
async function asListed(league, feed, byId, now) {
  const out = [];
  for (const m of feed) {
    if (m.sport !== FOOTBALL) {
      out.push(m);
      continue;
    }
    const old = byId.get(toHex(await matchId(league, { sport: FOOTBALL, kickoff: m.kickoff, bestOf: 0, label: m.label })));
    if (old && old.state !== "void" && (old.state === "final" || now >= old.kickoff - CLOSES_BEFORE)) {
      out.push(m);
      continue;
    }
    for (const sport of FOOTBALL_MARKETS) out.push({ ...m, sport, feedId: `${m.feedId}:${MARKET_TAGS[sport]}` });
  }
  return out;
}

export async function plan({ league, feed, listed, now }) {
  const byId = new Map(listed.map((f) => [f.id, f]));
  const wanted = await withIds(league, await asListed(league, feed, byId, now));
  const put = [];
  const added = [];
  const updated = [];
  const calledOff = [];
  const replaced = [];
  const same_ = new Set(); // matches with nothing to change: a football match's three lines count once
  const heldBack = []; // every line the feed now gives differently for a finished match: not sent

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
        heldBack.push(w);
        continue;
      }
      put.push(w);
      updated.push({ label: w.label, from: `${have.state} ${have.score ?? ""}`.trim(), to: `${w.state} ${w.score ?? ""}`.trim() });
    } else {
      same_.add(`${w.label}|${w.kickoff}`);
    }
  }

  // A match the feed still has, under the same name of its own, but at a different time: it has
  // been moved. The one on the list at the old time is called off.
  const nowAt = new Map(wanted.map((w) => [w.feedId, w.id]));
  const wantedIds = new Set(wanted.map((w) => w.id));
  for (const have of listed) {
    const movedTo = nowAt.get(have.feedId);
    if (movedTo && movedTo !== have.id && have.state !== "void" && have.state !== "final") {
      put.push({ ...comparable(have), state: "void", note: "moved to another time", score: undefined, resultByte: undefined });
      calledOff.push(have.label);
    } else if (have.sport === FOOTBALL && !wantedIds.has(have.id) && have.state !== "void" && have.state !== "final" && now < have.kickoff - CLOSES_BEFORE) {
      // A football match listed the older way, as one prediction, and still open: the three
      // predictions have taken its place. Nobody scores for the old one.
      put.push({ ...comparable(have), state: "void", note: REPLACED, score: undefined, resultByte: undefined });
      replaced.push(have.label);
    }
  }
  // A football match is three lines on the list and one match to a person: say each once.
  const once = (labels) => [...new Set(labels)];
  const seen = new Set();
  const updatedOnce = updated.filter((u) => {
    const key = `${u.label}|${u.from}|${u.to}|${u.refused ?? ""}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  return { put: put.map((f) => JSON.parse(JSON.stringify(f))), added: once(added), updated: updatedOnce, calledOff: once(calledOff), replaced: once(replaced), unchanged: same_.size, heldBack: heldBack.map((f) => JSON.parse(JSON.stringify(f))) };
}

/** How long the feed has to keep saying the same final score before it is believed, in seconds. */
export const CONFIRM_AFTER = 5 * 60;

/**
 * A final score is not believed the first time the feed gives it. A feed can call a match
 * finished and correct the score a few minutes later, and a result, once recorded, is never
 * changed. So the first time a match comes back finished, its score is only noted, and the match
 * is passed on as still being played. When a later look, at least `wait` seconds on, gives the
 * same score, it is passed on as finished. If the score has changed, the wait starts again.
 *
 * A match that is already finished on Kickoff's list is passed on untouched, and so is a match
 * called off: only a score is waited for.
 *
 * @param pending  what is being waited on, kept between looks: feedId -> { resultByte, score, since }
 * @returns {{ feed, waiting, lookAgainAt }}  the feed's matches to act on, the matches waited on,
 *          and when the earliest of them can be confirmed (null if none)
 */
export function holdResults({ feed, listed, pending, now, wait = CONFIRM_AFTER }) {
  const finished = new Set();
  for (const f of listed) if (f.state === "final" && f.feedId) finished.add(f.feedId.replace(/:(result|goalgoal|score)$/, ""));
  const waiting = [];
  const out = feed.map((m) => {
    if (m.state !== "final" || finished.has(m.feedId)) {
      if (m.state !== "final") pending.delete(m.feedId);
      return m;
    }
    const seen = pending.get(m.feedId);
    if (seen && seen.resultByte === m.resultByte && seen.score === m.score) {
      if (now - seen.since >= wait) {
        pending.delete(m.feedId);
        return m;
      }
    } else {
      pending.set(m.feedId, { resultByte: m.resultByte, score: m.score, since: now, changedFrom: seen ? seen.score : undefined });
    }
    const held = pending.get(m.feedId);
    waiting.push({ label: m.label, score: m.score, since: held.since, changedFrom: held.changedFrom });
    const { score, result, resultByte, ...rest } = m;
    return { ...rest, state: "live" };
  });
  const lookAgainAt = waiting.length ? Math.min(...waiting.map((w) => w.since + wait)) : null;
  return { feed: out, waiting, lookAgainAt };
}
