// The robot's work on X Layer.
//
// Kickoff's server holds the sealed picks. What makes them impossible to change afterwards is the
// record on X Layer, written through TapeOut's mailbox. This file decides what has to be written,
// and when:
//
//   announce   a match is announced before it is locked. Only matches somebody has picked are
//              announced, so nothing is spent on matches nobody played.
//   lock       a few seconds after picks close, the fingerprint of the match's bundle of sealed
//              picks is written. It must be on X Layer before kickoff, or it never counts.
//   result     once the feed says a match is finished (or is off), its result is written.
//   report     Kickoff's server is told how each lock went: "locked" or "missed". The server only
//              gives points for a match once it has been told it was locked, so a pick counts
//              only if it was locked on X Layer before kickoff.
//   openings   the opened picks are published on the league's on-chain site, so anyone can rebuild
//              the table. Published again whenever more phones have opened their picks. However
//              many players picked a match, the file goes up whole, in pieces.
//
// Nothing here signs or sends anything itself. It is handed a `chain` that can read the league and
// send to it, and a `server` that can be asked for bundles, so every rule can be checked with
// stand-ins. The record on X Layer is always read before writing, so starting the robot again, or
// running two by mistake, never writes the same thing twice.

import { buildBundle, fromHex, lockMessage, matchMessage, resultMessage, toHex } from "../../engine/src/index.js";

/** Picks close this long before kickoff, and the server bundles them this long after that. As in server/src/kickoff.js. */
export const CLOSES_BEFORE = 10 * 60;
export const SETTLE = 5;
/** A lock is not started this close to kickoff: it could land after it, and a late lock never counts. */
export const TOO_LATE = 30;
/** How long after kickoff results and newly opened picks are still looked for, in seconds. */
export const LOOK_BACK = 2 * 24 * 3600;
/** What the robot remembers between ticks, so it does not ask about things it has already settled. */
export const newMemory = () => ({ locked: new Set(), nobody: new Set(), missed: new Set(), resulted: new Set(), published: new Map(), lookedAt: new Map(), told: new Map() });
/** Opened picks for a match are looked for at most this often, in seconds. */
export const OPENINGS_EVERY = 10 * 60;

/** The earliest moment anything on X Layer is due for a match: when its bundle can be locked. */
export const lockTime = (fixture) => fixture.kickoff - CLOSES_BEFORE + SETTLE;

/** When the robot next has to be awake for a lock, given the list of matches. Null if none is ahead. */
export function nextLock(fixtures, now, memory) {
  const ahead = fixtures
    .filter((f) => f.state === "scheduled" && !memory.locked.has(f.id) && !memory.nobody.has(f.id) && !memory.missed.has(f.id))
    .map(lockTime)
    .filter((t) => t > now);
  return ahead.length ? Math.min(...ahead) : null;
}

/**
 * Do everything that is due now.
 * @param now       the time in seconds
 * @param league    Kickoff's id on X Layer, as hex
 * @param fixtures  the server's list of matches
 * @param server    { bundle(match) -> { count, root, entries }, openings(match) -> text or null,
 *                    report([{ match, state }]) } where state is "locked" or "missed"
 * @param chain     { read() -> Map(match id -> { announced, lock, resulted }), send(message), publish(match, text) -> pieces, publishedCount(match) }
 * @param memory    from newMemory(), kept between ticks
 * @param since     when Kickoff went live on X Layer, in seconds. A match that started before then
 *                  could not have been locked, so it is never reported as a lock that was missed
 * @returns { did: [plain sentences], problems: [plain sentences], missed }
 *   missed  the matches found this time whose sealed picks were not locked on X Layer before
 *           kickoff: [{ id, label, kickoff, count }]. Each is reported once.
 */
export async function chainTick({ now, league, fixtures, server, chain, memory, since = 0 }) {
  const did = [];
  const problems = [];
  const missed = [];
  let record = null; // what is on X Layer, read once, only if something is due
  const onChain = async (id) => ((record ??= await chain.read()).get(id) ?? { announced: false, lock: null, resulted: false });
  const reread = () => (record = null);

  for (const f of [...fixtures].sort((a, b) => a.kickoff - b.kickoff)) {
    if (f.kickoff < now - LOOK_BACK || lockTime(f) > now) continue;

    // ---- lock, between picks closing and kickoff
    if (now < f.kickoff && !memory.locked.has(f.id) && !memory.nobody.has(f.id) && !memory.missed.has(f.id)) {
      try {
        const bundle = await server.bundle(f.id);
        if (bundle.count === 0) {
          memory.nobody.add(f.id);
        } else {
          const there = await onChain(f.id);
          if (there.lock && toHex(there.lock.root) === bundle.root) {
            memory.locked.add(f.id);
          } else if (now >= f.kickoff - TOO_LATE) {
            memory.missed.add(f.id);
            missed.push({ id: f.id, label: f.label, kickoff: f.kickoff, count: bundle.count });
            problems.push(`${f.label}: there was not enough time left to lock ${bundle.count} sealed ${bundle.count === 1 ? "pick" : "picks"} before kickoff. They do not count.`);
          } else {
            if (!there.announced) {
              await chain.send(await matchMessage(league, { sport: f.sport, kickoff: f.kickoff, bestOf: 0, label: f.label }));
              did.push(`${f.label}: announced`);
            }
            // The bundle is rebuilt here from the entries, so what is locked is what the picks
            // engine works out, not a number taken on trust from the server.
            const built = await buildBundle({ league, match: f.id, entries: bundle.entries });
            if (toHex(built.root) !== bundle.root) throw new Error("the server's bundle does not add up to the fingerprint it gave");
            await chain.send(await lockMessage(built));
            memory.locked.add(f.id);
            reread();
            did.push(`${f.label}: locked ${bundle.count} sealed ${bundle.count === 1 ? "pick" : "picks"}, ${f.kickoff - now} seconds before kickoff`);
          }
        }
      } catch (error) {
        problems.push(`${f.label}: could not be locked this time (${error.message}). It will be tried again.`);
        reread();
      }
      continue;
    }
    if (now < f.kickoff) continue;

    // ---- after kickoff: only matches whose lock made it on to X Layer in time have anything more to do
    if (memory.nobody.has(f.id) || memory.missed.has(f.id)) continue;
    const wantsResult = !memory.resulted.has(f.id) && (f.state === "final" || f.state === "void");
    // X Layer is only read when the robot does not already know: after a restart, or just before
    // writing a result.
    if (!memory.locked.has(f.id) || wantsResult) {
      let there;
      try {
        there = await onChain(f.id);
      } catch (error) {
        problems.push(`X Layer could not be read (${error.message}). It will be tried again.`);
        break;
      }
      if (!there.lock && f.lock === "missed") {
        memory.missed.add(f.id); // known already, and Kickoff's server has been told
        continue;
      }
      if (!there.lock && f.kickoff < since) {
        memory.nobody.add(f.id); // from before Kickoff was on X Layer: nothing to lock, nothing missed
        continue;
      }
      if (!there.lock) {
        // Nobody picked it, or its picks were never locked in time. Either way there is nothing to
        // score from X Layer. If picks were sealed, that is a missed lock, and it is said once: the
        // robot was not awake for it, or could not reach X Layer until it was too late.
        let sealed;
        try {
          sealed = (await server.bundle(f.id)).count;
        } catch (error) {
          problems.push(`${f.label}: Kickoff's server could not say whether anyone picked it (${error.message}). It will be asked again.`);
          continue;
        }
        if (sealed > 0) {
          memory.missed.add(f.id);
          missed.push({ id: f.id, label: f.label, kickoff: f.kickoff, count: sealed });
          problems.push(`${f.label}: its ${sealed} sealed ${sealed === 1 ? "pick was" : "picks were"} never locked on X Layer before kickoff. They cannot be checked there.`);
        } else memory.nobody.add(f.id);
        continue;
      }
      memory.locked.add(f.id);
      if (there.resulted) memory.resulted.add(f.id);
    }

    // ---- result
    if (!memory.resulted.has(f.id) && (f.state === "final" || f.state === "void")) {
      try {
        if (f.state === "final" && !Number.isInteger(f.resultByte)) throw new Error("the match is finished but has no result");
        await chain.send(resultMessage(fromHex(f.id), f.state === "void" ? "void" : f.resultByte));
        memory.resulted.add(f.id);
        reread();
        did.push(f.state === "void" ? `${f.label}: recorded as off. Nobody scores.` : `${f.label}: result recorded${f.score ? ` (${f.score})` : ""}`);
      } catch (error) {
        problems.push(`${f.label}: its result could not be recorded this time (${error.message}). It will be tried again.`);
      }
    }

    // ---- opened picks, published whenever there are more of them than last time
    if (now - (memory.lookedAt.get(f.id) ?? -Infinity) < OPENINGS_EVERY) continue;
    memory.lookedAt.set(f.id, now);
    try {
      const file = await server.openings(f.id);
      if (file === null) continue;
      const count = JSON.parse(file).openings.length;
      if (count === 0 || memory.published.get(f.id) === count) continue;
      if (memory.published.get(f.id) === undefined && (await chain.publishedCount(f.id)) === count) {
        memory.published.set(f.id, count);
        continue;
      }
      const pieces = await chain.publish(f.id, file);
      memory.published.set(f.id, count);
      did.push(`${f.label}: published ${count} opened ${count === 1 ? "pick" : "picks"}${pieces > 1 ? `, in ${pieces} pieces` : ""}`);
    } catch (error) {
      problems.push(`${f.label}: its opened picks could not be published this time (${error.message}). It will be tried again.`);
    }
  }

  // ---- tell Kickoff's server how each lock went. It gives points only for matches it has been
  // told were locked. What the server's own list already says is not sent again.
  const news = [];
  for (const f of fixtures) {
    if (f.kickoff < now - LOOK_BACK) continue;
    const state = memory.locked.has(f.id) ? "locked" : memory.missed.has(f.id) ? "missed" : null;
    if (state && f.lock !== state && memory.told.get(f.id) !== state) news.push({ match: f.id, state });
  }
  if (news.length > 0) {
    try {
      await server.report(news);
      for (const n of news) memory.told.set(n.match, n.state);
    } catch (error) {
      problems.push(`Kickoff's server could not be told how ${news.length === 1 ? "a lock" : `${news.length} locks`} went (${error.message}). It will be told again.`);
    }
  }
  return { did, problems, missed };
}
