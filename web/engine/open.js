// Opening a pick, and deciding whether it counts.
//
// After kickoff a player gives out their pick and their salt. Before the pick is scored, every one
// of these must hold. The first one that fails is the reason the pick is refused.
//
//   1. locked-late       The bundle was put on chain at or after kickoff. Nothing in it counts.
//   2. wrong-bundle      The receipt is for a different bundle from the one on chain.
//   3. wrong-match       The receipt or the opening is for another league or another match.
//   4. wrong-player      The opening is by a different player from the receipt.
//   5. not-in-bundle     The receipt does not prove the sealed pick is in the bundle.
//   6. does-not-match    The pick and salt given do not produce the sealed fingerprint.
//   7. impossible-pick   The pick is not one that can happen in this kind of match.

import { equal, id32 } from "./bytes.js";
import { verifyReceipt } from "./bundle.js";
import { decodePick } from "./picks.js";
import { fingerprintOf } from "./seal.js";

export const REASONS = Object.freeze([
  "locked-late",
  "wrong-bundle",
  "wrong-match",
  "wrong-player",
  "not-in-bundle",
  "does-not-match",
  "impossible-pick",
]);

/**
 * @param opening  { league, match, sport, pickByte, player, salt }  what the player gives out
 * @param receipt  the player's receipt from bundle.js
 * @param lock     { root, count, lockedAt }  what is on chain: the bundle's root and size, and the
 *                 time (in seconds) the chain stamped on it
 * @param kickoff  the match's start time, in seconds
 * @param matchInfo  for tennis, { bestOf: 3 | 5 }
 * @returns { ok: true, pick, pickByte } or { ok: false, reason }
 */
export async function checkOpening({ opening, receipt, lock, kickoff, matchInfo = {} }) {
  const refuse = (reason) => ({ ok: false, reason });

  if (!Number.isInteger(lock.lockedAt) || !Number.isInteger(kickoff)) throw new TypeError("times must be whole seconds");
  if (lock.lockedAt >= kickoff) return refuse("locked-late");

  if (!equal(id32(receipt.root, "root"), id32(lock.root, "root")) || receipt.count !== lock.count) {
    return refuse("wrong-bundle");
  }
  const league = id32(opening.league, "league");
  const match = id32(opening.match, "match");
  if (!equal(id32(receipt.league, "league"), league) || !equal(id32(receipt.match, "match"), match)) {
    return refuse("wrong-match");
  }
  const player = id32(opening.player, "player");
  if (!equal(id32(receipt.player, "player"), player)) return refuse("wrong-player");

  if (!(await verifyReceipt(receipt))) return refuse("not-in-bundle");

  const fingerprint = await fingerprintOf({
    league,
    match,
    sport: opening.sport,
    pickByte: opening.pickByte,
    player,
    salt: opening.salt,
  });
  if (!equal(fingerprint, id32(receipt.fingerprint, "fingerprint"))) return refuse("does-not-match");

  let pick;
  try {
    pick = decodePick(opening.sport, opening.pickByte, matchInfo);
  } catch {
    return refuse("impossible-pick");
  }
  return { ok: true, pick, pickByte: opening.pickByte };
}
