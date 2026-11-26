// Sealing a pick.
//
// Before kickoff a player does not send their pick. They send its fingerprint: a short code worked
// out from the pick and a secret random number (the "salt"). Nobody can work the pick out from the
// fingerprint. After kickoff the player gives out the pick and the salt, and anyone can work the
// fingerprint out again and see that it matches.
//
// The fingerprint also covers the league, the match and the player. So a pick cannot be reused for
// another match, and one player cannot pass off another player's sealed pick as their own.
//
// The fingerprint is the SHA-256 of these 145 bytes, in this order:
//
//   "kickoff/pick/v1"   15 bytes   so this can never be confused with any other kind of fingerprint
//   league              32 bytes
//   match               32 bytes
//   sport                1 byte    1 football, 2 basketball, 3 tennis, and football's three
//                                  predictions: 4 result, 5 goal goal, 6 exact score
//   pick                 1 byte    as written by picks.js
//   player              32 bytes
//   salt                32 bytes

import { concat, id32, randomBytes, sha256, text } from "./bytes.js";
import { SPORTS, encodePick } from "./picks.js";

const TAG = text("kickoff/pick/v1");

/** Work out the fingerprint of a pick whose byte and salt are already known. */
export async function fingerprintOf({ league, match, sport, pickByte, player, salt }) {
  if (!SPORTS.includes(sport)) throw new RangeError("unknown sport");
  if (!Number.isInteger(pickByte) || pickByte < 0 || pickByte > 255) throw new RangeError("pick must be one byte");
  return sha256(
    concat(
      TAG,
      id32(league, "league"),
      id32(match, "match"),
      Uint8Array.of(sport),
      Uint8Array.of(pickByte),
      id32(player, "player"),
      id32(salt, "salt"),
    ),
  );
}

/**
 * Seal a pick. Returns what to send now (`fingerprint`) and what to keep secret until kickoff
 * (`salt` and `pickByte`). Lose the salt and the pick can never be opened.
 */
export async function sealPick({ league, match, sport, pick, player, matchInfo = {}, salt = randomBytes(32) }) {
  const pickByte = encodePick(sport, pick, matchInfo);
  const fingerprint = await fingerprintOf({ league, match, sport, pickByte, player, salt });
  return { fingerprint, salt, pickByte };
}
