// Carrying a sealed pick through, one step at a time.
//
//   1. Before picks close, its fingerprint is sent to Kickoff. Only the fingerprint.
//   2. Once picks have closed, the receipt is fetched and checked: the proof that this pick is in
//      the bundle that was locked.
//   3. Once the match has started, the pick and its secret are handed over, so everyone can see it.
//
// Each step is tried again whenever the page is opened or comes back online, until it is done.
// What happened is written on the pick itself, so the screens can say exactly where it stands.
//
//   sent      { fingerprint, at }   Kickoff has this fingerprint
//   waiting   true                  Kickoff could not be reached; it will be tried again
//   receipt   { index, count, path, root }
//   opened    { at }
//   problem   a plain sentence, when a step was refused for good

import { verifyReceipt } from "../engine/bundle.js";
import { fromHex } from "../engine/bytes.js";
import { closesAt } from "./time.js";

/**
 * @param store     from createStore()
 * @param client    from createClient()
 * @param player    this device's player id
 * @param league    Kickoff's id on X Layer, as the fixtures came with
 * @param fixtures  the real matches, by match id: { kickoff, ... }
 * @param now       the time in seconds
 * @returns true if anything kept on the device changed
 */
export async function syncPicks({ store, client, player, league, fixtures, now }) {
  let changed = false;
  for (const [match, kept] of Object.entries(store.all(player))) {
    const fixture = fixtures[match];
    if (!fixture) continue;
    let entry = { ...kept };
    const closes = closesAt(fixture.kickoff);
    const isSent = (e) => e.sent?.fingerprint === e.fingerprint;

    // 1. Send it, while picks are open.
    if (!isSent(entry) && now < closes) {
      try {
        const answer = await client.sendPick({ match, fingerprint: entry.fingerprint });
        const { fallback, waiting, problem, ...rest } = entry;
        entry = { ...rest, sent: { fingerprint: entry.fingerprint, at: answer.receivedAt ?? now } };
      } catch (error) {
        if (error.unreachable) entry.waiting = true;
        else entry.problem = error.message;
      }
    }

    // Picks have closed and this pick never got through. If an earlier one did, that is the one
    // Kickoff holds, so go back to it.
    if (!isSent(entry) && now >= closes && entry.fallback) {
      entry = { ...entry.fallback, replaced: { pick: entry.pick, sealedAt: entry.sealedAt } };
    }

    // 2. Fetch the receipt, once picks have closed.
    if (isSent(entry) && !entry.receipt && now >= closes) {
      try {
        const r = await client.receipt({ match, player });
        const proves =
          r.fingerprint === entry.fingerprint &&
          (await verifyReceipt({ league, match, player, fingerprint: r.fingerprint, index: r.index, count: r.count, path: r.path.map(fromHex), root: r.root }));
        if (proves) {
          const { problem, ...rest } = entry;
          entry = { ...rest, receipt: { index: r.index, count: r.count, path: r.path, root: r.root } };
        } else {
          entry.problem = "Kickoff's receipt does not prove this pick was locked.";
        }
      } catch (error) {
        // 409: the bundle has not been made yet. Anything else unreachable: try again later.
        if (error.status === 404) entry.problem = "Kickoff left this pick out of the locked bundle.";
      }
    }

    // 3. Open it, once the match has started.
    if (entry.receipt && !entry.opened && now >= fixture.kickoff) {
      try {
        await client.openPick({ match, pickByte: entry.pickByte, salt: entry.salt });
        const { problem, ...rest } = entry;
        entry = { ...rest, opened: { at: now } };
      } catch (error) {
        if (!error.unreachable) entry.problem = error.message;
      }
    }

    if (JSON.stringify(entry) !== JSON.stringify(kept)) {
      store.save(entry);
      changed = true;
    }
  }
  return changed;
}

/**
 * Where a pick stands, for the screens: one of
 *   "made-up"   the match is not a real one, so the pick stays on the device
 *   "problem"   a step was refused; `entry.problem` says why
 *   "missed"    picks closed before it reached Kickoff
 *   "waiting"   not sent yet; it will be tried again
 *   "sent"      Kickoff has it, picks are still open
 *   "closed"    picks have closed; waiting for the bundle to be locked
 *   "locked"    the receipt is in hand
 *   "opened"    handed over after the start
 */
export function standing(entry, fixture, now) {
  if (!fixture.real) return "made-up";
  if (entry.opened) return "opened";
  if (entry.problem) return "problem";
  if (entry.receipt) return "locked";
  const sent = entry.sent?.fingerprint === entry.fingerprint;
  const closed = now >= closesAt(fixture.kickoff);
  if (sent) return closed ? "closed" : "sent";
  return closed ? "missed" : "waiting";
}
