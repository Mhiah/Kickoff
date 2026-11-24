// Staying awake.
//
// One run of the robot lasts hours. In that time it has two rhythms:
//
//   every half hour     make Kickoff's list of matches agree with the feeds (sync.js)
//   to the second       be awake a few seconds after each match's picks close, to lock them on
//                       X Layer before kickoff (chain.js). In between it looks every five minutes
//                       for results to record and opened picks to publish.
//
// This file is only the timing. It is handed the jobs to do, the clock and a way to sleep, so the
// timing itself can be checked without waiting.

import { lockTime, nextLock } from "./chain.js";

export const SYNC_EVERY = 30 * 60;
export const LOOK_EVERY = 5 * 60;
/** After a round that had a problem, the robot looks again this soon. */
export const RETRY_IN = 20;

/**
 * @param until     when to stop, in seconds
 * @param now       a function giving the time in seconds
 * @param sleep     a function that waits a number of seconds
 * @param sync      does one fixtures round; returns its report, or throws
 * @param list      gives Kickoff's current list of matches
 * @param chain     does one X Layer round for a list of matches; returns { did, problems }. Null if
 *                  the robot has no wallet yet, in which case only the list is kept up to date.
 * @param memory    the X Layer memory from chain.js (only read here, to know what is still to lock)
 * @param say       where to write what happened
 * @returns { syncs, looks, problems }: how many rounds of each were done, and how many had problems
 */
export async function watch({ until, now, sleep, sync, list, chain = null, memory = null, say = () => {} }) {
  let lastSync = -Infinity;
  let lastLook = -Infinity;
  let fixtures = [];
  let retryAt = Infinity;
  const tally = { syncs: 0, looks: 0, problems: 0 };

  while (now() < until) {
    let t = now();
    if (t - lastSync >= SYNC_EVERY) {
      lastSync = t;
      tally.syncs++;
      try {
        const report = await sync();
        if (!report.ok) tally.problems++;
      } catch (error) {
        tally.problems++;
        say(`The list of matches could not be brought up to date this time (${error.message}).`);
      }
      try {
        fixtures = await list();
      } catch (error) {
        say(`Kickoff's list of matches could not be read (${error.message}). Carrying on with the last one.`);
      }
      lastLook = -Infinity; // a fresh list may hold new results, so look straight away
    }

    t = now();
    if (chain) {
      // A lock is due if picks have closed for a match that has not been settled yet.
      const lockDue = fixtures.some((f) => f.state === "scheduled" && lockTime(f) <= t && t < f.kickoff && !memory.locked.has(f.id) && !memory.nobody.has(f.id) && !memory.missed.has(f.id));
      if (lockDue || t - lastLook >= LOOK_EVERY || t >= retryAt) {
        if (!lockDue || t - lastLook >= LOOK_EVERY) lastLook = t;
        tally.looks++;
        retryAt = Infinity;
        try {
          const out = await chain(fixtures);
          for (const line of out.did) say(line);
          for (const line of out.problems) say(`PROBLEM: ${line}`);
          if (out.problems.length) {
            tally.problems++;
            retryAt = now() + RETRY_IN;
          }
        } catch (error) {
          tally.problems++;
          retryAt = now() + RETRY_IN;
          say(`PROBLEM: the X Layer round failed (${error.message}). It will be tried again.`);
        }
      }
    }

    t = now();
    const wakes = [lastSync + SYNC_EVERY, until];
    if (chain) wakes.push(lastLook + LOOK_EVERY, retryAt, nextLock(fixtures, t, memory) ?? Infinity);
    const wake = Math.min(...wakes);
    // Sleep in short stretches, so a clock that jumps (a paused machine) cannot make it oversleep a lock.
    await sleep(Math.max(1, Math.min(wake - t, 30)));
  }
  return tally;
}
