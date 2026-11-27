// Carrying a sealed pick through, one step at a time.
//
//   1. Before picks close, its fingerprint is sent to Kickoff, with a locked copy of the pick that
//      only Kickoff's robot can open, and only once the match has started.
//   2. Once picks have closed, the receipt is fetched and checked: the proof that this pick is in
//      the bundle that was locked.
//   3. Once the match has started, the robot opens every pick from its locked copy. The player
//      does not have to come back. If this device does happen to be open, it hands its own over
//      too, which does no harm and covers a pick that was sent without a copy.
//
// With step 1, Kickoff's server sends back a signed note saying it took the pick. The phone checks
// the signature and keeps the note. If step 2 then finds the pick was left out of the bundle, the
// note is the proof that Kickoff was given it in time.
//
// Each step is tried again whenever the page is opened or comes back online, until it is done.
// What happened is written on the pick itself, so the screens can say exactly where it stands.
//
//   sent      { fingerprint, at, copy }   Kickoff has this fingerprint; `copy` is true if the locked
//                                   copy went with it
//   taken     { league, match, player, fingerprint, receivedAt, closesAt, key, sig }
//                                   Kickoff's signed note that it took this pick, whole, so it
//                                   can be checked by anyone with nothing else to hand
//   elsewhere { fingerprint }       the player changed this pick on their other phone, and
//                                   that one is what was locked
//   waiting   true                  Kickoff could not be reached; it will be tried again
//   receipt   { index, count, path, root }
//   opened    { at }
//   problem   a plain sentence, when a step was refused for good

import { verifyReceipt } from "../engine/bundle.js";
import { isEnvelopeKey, sealEnvelope } from "../engine/envelope.js";
import { fromHex } from "../engine/bytes.js";
import { isServerKey, verifyTaken } from "../engine/taken.js";
import { closesAt } from "./time.js";

/** How long to wait before asking again after the server has refused a step, in seconds. */
export const RETRY_AFTER = 5 * 60;
/** What a pick says while Kickoff holds it but has not properly signed for it. */
export const UNSIGNED = "Kickoff has this prediction but did not sign for it. It will be asked again.";

/**
 * @param store     from createStore()
 * @param client    from createClient()
 * @param player    this device's player id
 * @param league    Kickoff's id on X Layer, as the fixtures came with
 * @param fixtures  the real matches, by match id: { kickoff, ... }
 * @param now       the time in seconds
 * @param robotKey  the public key of Kickoff's robot, which copies are locked to. Without it,
 *                  picks are sent without a copy and only this device can open them
 * @param serverKey the public key of Kickoff's server, which its signed notes are checked
 *                  against. Without it, notes are not asked for
 * @param shared    true if this phone's key is also on another phone (move.js), so a pick may
 *                  have been changed from there
 * @returns true if anything kept on the device changed
 */
export async function syncPicks({ store, client, player, league, fixtures, now, robotKey = null, serverKey = null, shared = false }) {
  const copies = isEnvelopeKey(robotKey);
  const notes = isServerKey(serverKey);
  let changed = false;
  for (const [match, kept] of Object.entries(store.all(player))) {
    const fixture = fixtures[match];
    if (!fixture) continue;
    let entry = { ...kept };
    const closes = closesAt(fixture.kickoff);
    const isSent = (e) => e.sent?.fingerprint === e.fingerprint;
    // After the server has refused a step, it is not asked again straight away.
    if (entry.problem && entry.triedAt && now >= entry.triedAt && now - entry.triedAt < RETRY_AFTER) continue;

    const hasNote = (e) => e.taken?.fingerprint === e.fingerprint;

    // 1. Send it, while picks are open. A pick that went earlier without its locked copy is sent
    // again with one, so that it too opens by itself. So is one Kickoff has not signed for.
    if ((!isSent(entry) || (copies && !entry.sent.copy) || (notes && !hasNote(entry))) && now < closes) {
      try {
        const envelope = copies
          ? await sealEnvelope({ to: robotKey, league, match, player, fingerprint: entry.fingerprint, pickByte: entry.pickByte, salt: entry.salt })
          : null;
        const answer = await client.sendPick({ match, fingerprint: entry.fingerprint, envelope });
        // The server's signed note. It has to be signed by Kickoff's own key, for exactly this
        // pick, and say what this phone knows to be true: taken before picks close, and that they
        // close when they do.
        const note = { league, match, player, fingerprint: entry.fingerprint, receivedAt: answer.receivedAt, closesAt: answer.closesAt };
        const signed = notes && note.closesAt === closes && note.receivedAt < closes && (await verifyTaken({ key: serverKey, sig: answer.taken?.sig, ...note }));
        const { fallback, waiting, problem, triedAt, taken, ...rest } = entry;
        entry = {
          ...rest,
          sent: { fingerprint: entry.fingerprint, at: answer.receivedAt ?? now, ...(envelope ? { copy: true } : {}) },
          ...(signed ? { taken: { ...note, key: serverKey, sig: answer.taken.sig } } : {}),
        };
        // Kickoff holds the pick either way. Without its signature the player has only Kickoff's
        // word for that, so it is said, and asked for again.
        if (notes && !signed) Object.assign(entry, { problem: UNSIGNED, triedAt: now });
      } catch (error) {
        if (error.unreachable) entry.waiting = true;
        else Object.assign(entry, { problem: error.message, triedAt: now });
      }
    }

    // Picks have closed and this pick never got through. If an earlier one did, that is the one
    // Kickoff holds, so go back to it.
    if (!isSent(entry) && now >= closes && entry.fallback) {
      entry = { ...entry.fallback, replaced: { pick: entry.pick, sealedAt: entry.sealedAt } };
    }

    // 2. Fetch the receipt, once picks have closed.
    if (isSent(entry) && !entry.receipt && !entry.elsewhere && now >= closes) {
      try {
        const r = await client.receipt({ match, player });
        const inBundle = await verifyReceipt({ league, match, player, fingerprint: r.fingerprint, index: r.index, count: r.count, path: r.path.map(fromHex), root: r.root });
        const proves = r.fingerprint === entry.fingerprint && inBundle;
        if (proves) {
          const { problem, triedAt, ...rest } = entry;
          entry = { ...rest, receipt: { index: r.index, count: r.count, path: r.path, root: r.root } };
        } else if (inBundle && shared) {
          // This player is in the bundle with a different pick, and plays on two phones: the pick
          // was changed on the other one after this phone sent its own. That one counts.
          const { problem, triedAt, ...rest } = entry;
          entry = { ...rest, elsewhere: { fingerprint: r.fingerprint } };
        } else {
          Object.assign(entry, { problem: "Kickoff's receipt does not prove this prediction was locked.", triedAt: now });
        }
      } catch (error) {
        // 409: the bundle has not been made yet. Anything else unreachable: try again later.
        if (error.status === 404) Object.assign(entry, { problem: "Kickoff left this prediction out of the locked bundle.", triedAt: now });
      }
    }

    // 3. Open it, once the match has started.
    if (entry.receipt && !entry.opened && now >= fixture.kickoff) {
      try {
        await client.openPick({ match, pickByte: entry.pickByte, salt: entry.salt });
        const { problem, triedAt, ...rest } = entry;
        entry = { ...rest, opened: { at: now } };
      } catch (error) {
        if (!error.unreachable) Object.assign(entry, { problem: error.message, triedAt: now });
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
 *   "unlocked"  the pick reached Kickoff, but the match's picks were not locked on X Layer before
 *               kickoff, so nobody scores for it
 *   "elsewhere" the player changed this pick on their other phone, and that one was locked
 */
export function standing(entry, fixture, now) {
  if (!fixture.real) return "made-up";
  if (fixture.lock === "missed" && (entry.opened || entry.receipt || entry.sent?.fingerprint === entry.fingerprint)) return "unlocked";
  if (entry.opened) return "opened";
  if (entry.elsewhere) return "elsewhere";
  if (entry.problem) return "problem";
  if (entry.receipt) return "locked";
  const sent = entry.sent?.fingerprint === entry.fingerprint;
  const closed = now >= closesAt(fixture.kickoff);
  if (sent) return closed ? "closed" : "sent";
  return closed ? "missed" : "waiting";
}
