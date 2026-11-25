// Building a league's table and every player's record.
//
// Nothing here is stored. Give it the matches, with what is on chain for each and the picks that
// were opened, and it works the table out. Anyone who does the same gets the same table.
//
// A match looks like this:
//
//   {
//     id,          32 bytes
//     sport,       1 football, 2 basketball, 3 tennis
//     kickoff,     start time, in seconds
//     matchInfo,   for tennis, { bestOf: 3 | 5 }
//     state,       "final", "void" or "pending"
//     result,      when final: written like a pick (see score.js)
//     lock,        what is on chain: { root, count, lockedAt }, or null if nothing was locked
//     entries,     optional: the bundle's list of { player, fingerprint }, published after kickoff
//     openings,    the picks that were opened: [{ pickByte, player, salt, receipt }]
//   }
//
// What happens to a player in a match is one of:
//
//   scored       the pick was opened, checked and scored: 0, 1 or 3 points
//   refused      the pick was opened but did not pass the checks in open.js: 0 points, with the reason
//                (or "not-locked" when nothing was put on chain for the match before kickoff)
//   not-opened   the player has a sealed pick in the bundle but never opened it: 0 points
//   no-pick      the player made no pick: 0 points
//   void         the match was postponed, abandoned, or ended in a walkover or retirement: nobody scores
//   pending      the match has no result yet

import { compare, equal, id32, toHex } from "./bytes.js";
import { buildBundle } from "./bundle.js";
import { checkOpening } from "./open.js";
import { scorePick } from "./score.js";

/**
 * Does the published list of sealed picks really produce the root that is on chain? If it does,
 * the list is given back as it was published, with each player's `joined` if the file gave one.
 */
async function listedPlayers(league, match) {
  if (!match.lock || !match.entries) return null;
  try {
    const bundle = await buildBundle({ league, match: match.id, entries: match.entries });
    if (bundle.count !== match.lock.count || !equal(bundle.root, id32(match.lock.root, "root"))) return null;
    const joined = new Map(match.entries.filter((e) => Number.isSafeInteger(e.joined)).map((e) => [toHex(id32(e.player, "player")), e.joined]));
    return bundle.entries.map((e) => ({ player: e.player, joined: joined.get(toHex(e.player)) ?? null }));
  } catch {
    return null;
  }
}

/**
 * @param league    the league's 32-byte id
 * @param matches   the matches, as described at the top of this file
 * @param circuits  from loadCircuits() in score.js
 * @param players   optional: players to list even if they never made a pick
 * @returns { table, records }
 *   table    rows of { player, position, points, threes, ones, scored, joined }, best first.
 *            `joined` is when the player joined Kickoff as the league published it, or null
 *   records  for each player (by hex id), one line for each match, in the order the matches were given
 */
export async function buildTable({ league, matches, circuits, players = [] }) {
  const leagueId = id32(league, "league");
  const everyone = new Map(); // hex id -> bytes
  const note = (player) => everyone.set(toHex(player), player);
  // When each player joined Kickoff, as the league published it. If two files disagree, the
  // earlier time is the one used, so nothing published later can move a player back.
  const joinedAt = new Map();
  players.forEach((p) => note(id32(p, "player")));

  // First pass: decide what happened to each player who appears in each match.
  const outcomes = [];
  for (const match of matches) {
    const matchId = id32(match.id, "match");
    const byPlayer = new Map();
    const listed = await listedPlayers(leagueId, match);
    for (const { player, joined } of listed ?? []) {
      note(player);
      const key = toHex(player);
      if (joined !== null && joined < (joinedAt.get(key) ?? Infinity)) joinedAt.set(key, joined);
    }

    for (const o of match.openings ?? []) {
      const player = id32(o.player, "player");
      note(player);
      const key = toHex(player);
      if (byPlayer.get(key)?.state === "scored") continue; // one pick per player per match
      if (match.state !== "final") continue;
      if (!match.lock) {
        // Nothing was put on chain before kickoff, so there is nothing to check a pick against.
        byPlayer.set(key, { state: "refused", points: 0, reason: "not-locked" });
        continue;
      }
      const checked = await checkOpening({
        opening: { league: leagueId, match: matchId, sport: match.sport, pickByte: o.pickByte, player, salt: o.salt },
        receipt: o.receipt,
        lock: match.lock,
        kickoff: match.kickoff,
        matchInfo: match.matchInfo,
      });
      if (checked.ok) {
        const points = scorePick({
          circuits,
          sport: match.sport,
          pickByte: checked.pickByte,
          result: match.result,
          matchInfo: match.matchInfo,
        });
        byPlayer.set(key, { state: "scored", points, pick: checked.pick });
      } else if (!byPlayer.has(key)) {
        byPlayer.set(key, { state: "refused", points: 0, reason: checked.reason });
      }
    }
    outcomes.push({ match, matchId, byPlayer, listed: new Set((listed ?? []).map((l) => toHex(l.player))) });
  }

  // Second pass: one line for every player in every match.
  const records = {};
  const totals = new Map();
  for (const [key, player] of everyone) {
    records[key] = [];
    totals.set(key, { player, points: 0, threes: 0, ones: 0, scored: 0, joined: joinedAt.get(key) ?? null });
  }
  for (const { match, matchId, byPlayer, listed } of outcomes) {
    for (const key of everyone.keys()) {
      let line;
      if (match.state === "void") line = { state: "void", points: 0 };
      else if (match.state !== "final") line = { state: "pending", points: 0 };
      else if (byPlayer.has(key)) line = byPlayer.get(key);
      else if (listed.has(key)) line = { state: "not-opened", points: 0 };
      else line = { state: "no-pick", points: 0 };
      records[key].push({ match: toHex(matchId), ...line });
      if (line.state === "scored") {
        const t = totals.get(key);
        t.points += line.points;
        t.scored += 1;
        if (line.points === 3) t.threes += 1;
        if (line.points === 1) t.ones += 1;
      }
    }
  }

  // The table: most points first. Between players level on points, whoever joined Kickoff first is
  // ahead, so nobody shares a position. A player the league published no joining time for comes
  // after those it did. Level even on that, players are listed in order of id, which keeps the list
  // the same for everyone who builds it.
  const since = (row) => row.joined ?? Infinity;
  const rows = [...totals.values()].sort((x, y) => y.points - x.points || (since(x) === since(y) ? 0 : since(x) < since(y) ? -1 : 1) || compare(x.player, y.player));
  const table = rows.map((row, i) => ({ ...row, position: i + 1 }));
  return { table, records };
}
