// Reading a league back from the chain.
//
// Everything a league does is in its inbox in TapeOut's mailbox. This file takes the messages in
// that inbox, exactly as the chain holds them, and works out the league's matches: when each
// kicks off, which bundle was locked for it, and its result. It believes nothing it cannot check.
//
// A message is given as the chain records it:
//
//   { index, from, timestamp, ref, payload }
//
//   index       its place in the inbox, counting from 0
//   from        the account that sent it (an address)
//   timestamp   the time the chain stamped on it, in seconds
//   ref         its 32-byte reference
//   payload     its bytes
//
// The rules:
//
//   - Announcing a match, locking a bundle and giving a result only count when they come from the
//     league's own account. Anyone can write to a league's inbox, so everything else is ignored,
//     apart from challenges, which are meant to come from members.
//   - A match counts only if its reference is the id its own facts produce (see match.js), and it
//     was announced before its kickoff.
//   - A lock counts only if its reference is the value its own contents produce, and its match was
//     already announced. Of the locks for a match, the LAST one stamped before kickoff is the one
//     in force. A lock stamped at or after kickoff is never in force.
//   - A result counts only if it is stamped at or after kickoff and is a result that can happen in
//     that sport. The LAST result given is the one in force, so a league can correct a mistake,
//     but every result it gave stays in the history.
//   - A challenge is never hidden. It is listed with the match, with whether it came within 24
//     hours of the result it disputes.

import { equal, id32, toHex } from "./bytes.js";
import { lockRef } from "./bundle.js";
import { matchId, matchInfoOf } from "./match.js";
import { parseMessage } from "./messages.js";
import { decodeResult } from "./picks.js";

export const CHALLENGE_WINDOW = 24 * 60 * 60;

const address = (a) => {
  const s = (typeof a === "string" ? a : toHex(a)).toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(s)) throw new Error("not an address");
  return s;
};

/**
 * @param league    the league's 32-byte id (its endpoint id in the mailbox)
 * @param account   the league's own account, the only one whose word counts
 * @param messages  the league's inbox, as the chain holds it
 * @returns { matches, ignored }
 *   matches   each match, in order of kickoff, ready to hand to the table builder
 *   ignored   every message that was not believed, with the reason
 */
export async function readLeague({ league, account, messages }) {
  const leagueId = id32(league, "league");
  const own = address(account);
  const byId = new Map();
  const ignored = [];
  const ignore = (m, why) => ignored.push({ index: m.index, why });

  for (const m of [...messages].sort((x, y) => x.index - y.index)) {
    const parsed = parseMessage(m.payload);
    if (!parsed) {
      ignore(m, "not a Kickoff message");
      continue;
    }
    const ref = id32(m.ref, "ref");
    const fromLeague = address(m.from) === own;

    if (parsed.kind === "match") {
      if (!fromLeague) { ignore(m, "a match announced by someone other than the league"); continue; }
      const id = await matchId(leagueId, parsed.fixture);
      if (!equal(ref, id)) { ignore(m, "the match's reference is not the id its facts produce"); continue; }
      if (m.timestamp >= parsed.fixture.kickoff) { ignore(m, "a match announced at or after its kickoff"); continue; }
      const key = toHex(id);
      if (byId.has(key)) { ignore(m, "the match was already announced"); continue; }
      byId.set(key, { id, fixture: parsed.fixture, announcedAt: m.timestamp, locks: [], results: [], challenges: [] });
      continue;
    }

    const match = byId.get(toHex(parsed.match));
    if (!match) { ignore(m, "about a match that has not been announced"); continue; }

    if (parsed.kind === "lock") {
      if (!fromLeague) { ignore(m, "a lock by someone other than the league"); continue; }
      const expected = await lockRef({ league: leagueId, match: match.id, count: parsed.count, root: parsed.root });
      if (!equal(ref, expected)) { ignore(m, "the lock's reference is not the value its contents produce"); continue; }
      match.locks.push({
        index: m.index,
        root: parsed.root,
        count: parsed.count,
        lockedAt: m.timestamp,
        inTime: m.timestamp < match.fixture.kickoff,
      });
    } else if (parsed.kind === "result") {
      if (!fromLeague) { ignore(m, "a result by someone other than the league"); continue; }
      if (!equal(ref, match.id)) { ignore(m, "the result's reference is not its match"); continue; }
      if (m.timestamp < match.fixture.kickoff) { ignore(m, "a result given before kickoff"); continue; }
      const entry = { index: m.index, givenAt: m.timestamp, state: parsed.state };
      if (parsed.state === "final") {
        try {
          entry.result = decodeResult(match.fixture.sport, parsed.resultByte, matchInfoOf(match.fixture));
          entry.resultByte = parsed.resultByte;
        } catch {
          ignore(m, "a result that cannot happen in this kind of match");
          continue;
        }
      }
      match.results.push(entry);
    } else if (parsed.kind === "challenge") {
      if (!equal(ref, match.id)) { ignore(m, "the challenge's reference is not its match"); continue; }
      const disputed = match.results.at(-1);
      match.challenges.push({
        index: m.index,
        from: `0x${address(m.from)}`,
        at: m.timestamp,
        resultByte: parsed.resultByte,
        inWindow: Boolean(disputed) && m.timestamp - disputed.givenAt <= CHALLENGE_WINDOW,
        disputes: disputed ? disputed.index : null,
      });
    }
  }

  const matches = [...byId.values()]
    .sort((x, y) => x.fixture.kickoff - y.fixture.kickoff || (toHex(x.id) < toHex(y.id) ? -1 : 1))
    .map((match) => {
      const lock = match.locks.filter((l) => l.inTime).at(-1) ?? null;
      const last = match.results.at(-1);
      return {
        id: match.id,
        label: match.fixture.label,
        sport: match.fixture.sport,
        kickoff: match.fixture.kickoff,
        matchInfo: matchInfoOf(match.fixture),
        state: last ? last.state : "pending",
        result: last?.result,
        resultByte: last?.resultByte,
        lock: lock ? { root: lock.root, count: lock.count, lockedAt: lock.lockedAt } : null,
        locks: match.locks,
        results: match.results,
        challenges: match.challenges,
      };
    });
  return { matches, ignored };
}
