import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOOTBALL, TENNIS,
  challengeMessage, encodePick, lockMessage, matchId, matchMessage, parseMessage, readLeague, resultMessage,
  tableFromChain, toHex,
} from "../src/index.js";
import { id, nodeSha256 } from "./helpers.js";
import { CIRCUITS } from "./league.js";
import {
  FIXTURES, Inbox, LEAGUE, LEAGUE_ACCOUNT, MEMBER, START, STRANGER, honestSeason, sealAndBundle,
} from "./chain.js";

const name = (player) => ["ada", "bola", "chidi", "dayo"].find((n) => toHex(id(n)) === toHex(player)) ?? "?";
const lines = (table) => table.map((row) => `${row.position} ${name(row.player)} ${row.points}`);
const fromChain = (inbox, files) =>
  tableFromChain({ league: LEAGUE, account: LEAGUE_ACCOUNT, messages: inbox.messages, openingsFiles: files, circuits: CIRCUITS });
const reasons = (ignored) => ignored.map((i) => i.why);

// ---- a match's id

test("a match's id is the SHA-256 of its facts, laid out as match.js says", async () => {
  const f = FIXTURES.tennis;
  const kickoff = Buffer.alloc(8);
  kickoff.writeBigUInt64BE(BigInt(f.kickoff));
  const expected = nodeSha256(
    Buffer.from("kickoff/match/v1", "ascii"), LEAGUE, Uint8Array.of(f.sport), kickoff, Uint8Array.of(f.bestOf), Buffer.from(f.label, "utf8"),
  );
  assert.equal(toHex(await matchId(LEAGUE, f)), toHex(expected));
});

test("change any fact about a match and its id changes", async () => {
  const f = FIXTURES.football;
  const original = toHex(await matchId(LEAGUE, f));
  assert.notEqual(toHex(await matchId(id("another league"), f)), original);
  assert.notEqual(toHex(await matchId(LEAGUE, { ...f, kickoff: f.kickoff + 60 })), original, "a later kickoff is a different match");
  assert.notEqual(toHex(await matchId(LEAGUE, { ...f, label: "Arsenal v Spurs" })), original);
  assert.notEqual(toHex(await matchId(LEAGUE, { ...f, sport: 2 })), original);
});

test("a match must make sense", async () => {
  const f = FIXTURES.football;
  await assert.rejects(matchId(LEAGUE, { ...f, bestOf: 3 }), /best of/, "football has no best-of");
  await assert.rejects(matchId(LEAGUE, { ...FIXTURES.tennis, bestOf: 4 }), /best of/);
  await assert.rejects(matchId(LEAGUE, { ...f, label: "" }), /label/);
  await assert.rejects(matchId(LEAGUE, { ...f, label: 'Arsenal "v" Chelsea' }), /not allowed/);
  await assert.rejects(matchId(LEAGUE, { ...f, label: "x".repeat(81) }), /longer/);
});

// ---- what the messages look like

test("a lock message is exactly the bytes the chain rehearsal writes", async () => {
  const { bundle } = await sealAndBundle(FIXTURES.football, { ada: { home: 1, away: 0 } });
  const { payload } = await lockMessage(bundle);
  assert.deepEqual([...payload.subarray(0, 4)], [0x54, 0x53, 0x02, 0x00], '"TS", version 2, public');
  assert.equal(
    new TextDecoder().decode(payload.subarray(4)),
    `{"v":1,"kind":"message","subject":"kickoff/lock/v1","body":"0x${toHex(bundle.match)} 1 0x${toHex(bundle.root)}"}`,
  );
});

test("every kind of message reads back as what was written", async () => {
  const f = FIXTURES.tennis;
  const match = await matchId(LEAGUE, f);
  assert.deepEqual(parseMessage((await matchMessage(LEAGUE, f)).payload), { kind: "match", fixture: f });
  assert.deepEqual(parseMessage(resultMessage(match, 4).payload), { kind: "result", match, state: "final", resultByte: 4 });
  assert.deepEqual(parseMessage(resultMessage(match, "void").payload), { kind: "result", match, state: "void" });
  assert.deepEqual(parseMessage(challengeMessage(match, 6).payload), { kind: "challenge", match, resultByte: 6 });
});

test("anything that is not a well-formed Kickoff message reads as nothing", () => {
  const good = resultMessage(id("m"), 4).payload;
  const withBody = (body) => new TextEncoder().encode(`TS\u0002\u0000${JSON.stringify({ v: 1, kind: "message", subject: "kickoff/result/v1", body })}`);
  assert.notEqual(parseMessage(good), null);
  assert.equal(parseMessage(good.subarray(1)), null, "wrong first bytes");
  assert.equal(parseMessage(new TextEncoder().encode("TS\u0002\u0000not json")), null);
  assert.equal(parseMessage(new TextEncoder().encode('TS\u0002\u0000{"v":1,"kind":"message","subject":"hello","body":"hi"}')), null, "an ordinary message");
  assert.equal(parseMessage(withBody(`0x${"ab".repeat(32)} final 4 extra`)), null, "extra words");
  assert.equal(parseMessage(withBody(`0x${"AB".repeat(32)} final 4`)), null, "capital letters in an id");
  assert.equal(parseMessage(withBody(`0x${"ab".repeat(32)} final 04`)), null, "a number with a leading zero");
  assert.equal(parseMessage(withBody(`0x${"ab".repeat(32)} final 256`)), null, "a result byte over 255");
  assert.equal(parseMessage(withBody(`0x${"ab".repeat(31)} void`)), null, "an id that is too short");
});

// ---- reading a league

test("an honest season read back from the chain gives the right table", async () => {
  const { inbox, files } = await honestSeason();
  const { table, matches, ignored } = await fromChain(inbox, files);
  assert.deepEqual(lines(table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
  assert.deepEqual(matches.map((m) => m.label), ["Arsenal v Chelsea", "Lakers v Celtics", "Alcaraz v Sinner"]);
  assert.deepEqual(matches.map((m) => m.state), ["final", "final", "final"]);
  assert.deepEqual(ignored, [], "nothing was disbelieved");
});

test("the same messages in any order give the same table", async () => {
  const { inbox, files } = await honestSeason();
  const shuffled = new Inbox();
  shuffled.messages = [...inbox.messages].reverse();
  assert.deepEqual(lines((await fromChain(shuffled, files)).table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
});

test("before any results are in, every match is pending and nobody has points", async () => {
  const { inbox, files } = await honestSeason();
  inbox.messages = inbox.messages.slice(0, 6); // three announcements and three locks
  const { table, matches } = await fromChain(inbox, files);
  assert.deepEqual(matches.map((m) => m.state), ["pending", "pending", "pending"]);
  assert.equal(table.every((row) => row.points === 0), true);
});

test("CHEAT: a stranger writes to the league's inbox. None of it is believed", async () => {
  const { inbox, files, parts } = await honestSeason();
  const extra = { sport: FOOTBALL, kickoff: START + 50_000, bestOf: 0, label: "A match that is not the league's" };
  inbox.at(START + 20_000).send(STRANGER, await matchMessage(LEAGUE, extra));
  inbox.send(STRANGER, await lockMessage(parts.football.bundle));
  inbox.send(STRANGER, resultMessage(parts.football.match, encodePick(FOOTBALL, { home: 0, away: 0 })));
  const { table, matches, ignored } = await fromChain(inbox, files);
  assert.deepEqual(lines(table), ["1 ada 7", "2 bola 4", "3 chidi 1"], "the table is unchanged");
  assert.equal(matches.length, 3);
  assert.deepEqual(reasons(ignored), [
    "a match announced by someone other than the league",
    "a lock by someone other than the league",
    "a result by someone other than the league",
  ]);
});

test("CHEAT: the bundle is locked after kickoff. It is not in force and no pick counts", async () => {
  const f = FIXTURES.football;
  const inbox = new Inbox();
  inbox.send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, f));
  const made = await sealAndBundle(f, { ada: { home: 2, away: 1 } });
  inbox.at(f.kickoff + 60).send(LEAGUE_ACCOUNT, await lockMessage(made.bundle));
  inbox.at(f.kickoff + 7200).send(LEAGUE_ACCOUNT, resultMessage(made.match, 0x12));
  const { table, records, matches } = await fromChain(inbox, { [toHex(made.match)]: made.file });
  assert.equal(matches[0].lock, null, "no lock is in force");
  assert.equal(matches[0].locks[0].inTime, false, "but the late lock is still on the record");
  assert.deepEqual(lines(table), ["1 ada 0"]);
  assert.equal(records[toHex(id("ada"))][0].reason, "not-locked");
});

test("CHEAT: the league swaps in a new bundle after kickoff. The one locked before kickoff stays in force", async () => {
  const f = FIXTURES.football;
  const inbox = new Inbox();
  inbox.send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, f));
  const honest = await sealAndBundle(f, { ada: { home: 0, away: 0 }, bola: { home: 1, away: 1 } });
  inbox.at(f.kickoff - 600).send(LEAGUE_ACCOUNT, await lockMessage(honest.bundle));
  // The match ends 2-1. The league makes a second bundle with a winning pick for a friend.
  const rigged = await sealAndBundle(f, { ada: { home: 0, away: 0 }, bola: { home: 1, away: 1 }, dayo: { home: 2, away: 1 } });
  inbox.at(f.kickoff + 6000).send(LEAGUE_ACCOUNT, await lockMessage(rigged.bundle));
  inbox.at(f.kickoff + 7200).send(LEAGUE_ACCOUNT, resultMessage(honest.match, 0x12));

  // Even if the league publishes the rigged bundle's openings, they are checked against the lock in force.
  const { table, records, matches } = await fromChain(inbox, { [toHex(honest.match)]: rigged.file });
  assert.equal(toHex(matches[0].lock.root), toHex(honest.bundle.root));
  assert.equal(records[toHex(id("dayo"))][0].state, "refused");
  assert.equal(table.find((row) => name(row.player) === "dayo").points, 0);
});

test("two locks before kickoff: the last one is in force, so picks can be added until kickoff", async () => {
  const f = FIXTURES.football;
  const inbox = new Inbox();
  inbox.send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, f));
  const early = await sealAndBundle(f, { ada: { home: 2, away: 1 } });
  inbox.at(f.kickoff - 3000).send(LEAGUE_ACCOUNT, await lockMessage(early.bundle));
  const later = await sealAndBundle(f, { ada: { home: 2, away: 1 }, bola: { home: 2, away: 1 } });
  inbox.at(f.kickoff - 60).send(LEAGUE_ACCOUNT, await lockMessage(later.bundle));
  inbox.at(f.kickoff + 7200).send(LEAGUE_ACCOUNT, resultMessage(later.match, 0x12));
  const { table, matches } = await fromChain(inbox, { [toHex(later.match)]: later.file });
  assert.equal(matches[0].lock.count, 2);
  assert.deepEqual(table.map((row) => row.points), [3, 3]);
});

test("CHEAT: moving the kickoff time. A later kickoff is a different match, and picks do not carry over", async () => {
  const f = FIXTURES.football;
  const inbox = new Inbox();
  inbox.send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, f));
  const made = await sealAndBundle(f, { ada: { home: 2, away: 1 } });
  // The league missed the lock. After the match it announces "the same match" with a kickoff in
  // the future and locks the old bundle under it.
  const moved = { ...f, kickoff: f.kickoff + 20_000 };
  inbox.at(f.kickoff + 8000).send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, moved));
  inbox.send(LEAGUE_ACCOUNT, await lockMessage(made.bundle));
  const { matches, ignored } = await readLeague({ league: LEAGUE, account: LEAGUE_ACCOUNT, messages: inbox.messages });
  assert.equal(matches.length, 2, "the moved match is a second, different match");
  assert.notEqual(toHex(matches[0].id), toHex(matches[1].id));
  assert.equal(matches[0].lock, null, "the old bundle's lock is late for the match it was sealed for");
  assert.equal(matches[1].lock, null, "and it is not a lock for the new match at all");
  assert.deepEqual(reasons(ignored), []);
});

test("CHEAT: a match announced after its own kickoff does not count, and nor does anything about it", async () => {
  const f = FIXTURES.football;
  const inbox = new Inbox().at(f.kickoff + 10);
  inbox.send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, f));
  const made = await sealAndBundle(f, { ada: { home: 2, away: 1 } });
  inbox.send(LEAGUE_ACCOUNT, await lockMessage(made.bundle));
  const { matches, ignored } = await readLeague({ league: LEAGUE, account: LEAGUE_ACCOUNT, messages: inbox.messages });
  assert.equal(matches.length, 0);
  assert.deepEqual(reasons(ignored), ["a match announced at or after its kickoff", "about a match that has not been announced"]);
});

test("CHEAT: a message with someone else's reference on it is not believed", async () => {
  const f = FIXTURES.football;
  const inbox = new Inbox();
  const announcement = await matchMessage(LEAGUE, f);
  inbox.send(LEAGUE_ACCOUNT, { ref: id("some other reference"), payload: announcement.payload });
  const { matches, ignored } = await readLeague({ league: LEAGUE, account: LEAGUE_ACCOUNT, messages: inbox.messages });
  assert.equal(matches.length, 0);
  assert.deepEqual(reasons(ignored), ["the match's reference is not the id its facts produce"]);
});

test("a result given before kickoff is ignored", async () => {
  const f = FIXTURES.football;
  const inbox = new Inbox();
  inbox.send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, f));
  inbox.at(f.kickoff - 10).send(LEAGUE_ACCOUNT, resultMessage(await matchId(LEAGUE, f), 0x12));
  const { matches, ignored } = await readLeague({ league: LEAGUE, account: LEAGUE_ACCOUNT, messages: inbox.messages });
  assert.equal(matches[0].state, "pending");
  assert.deepEqual(reasons(ignored), ["a result given before kickoff"]);
});

test("a result that cannot happen is ignored", async () => {
  const f = FIXTURES.tennis; // best of 5
  const inbox = new Inbox();
  inbox.send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, f));
  inbox.at(f.kickoff + 7200).send(LEAGUE_ACCOUNT, resultMessage(await matchId(LEAGUE, f), 0)); // "A in 2 sets"
  const { matches, ignored } = await readLeague({ league: LEAGUE, account: LEAGUE_ACCOUNT, messages: inbox.messages });
  assert.equal(matches[0].state, "pending");
  assert.deepEqual(reasons(ignored), ["a result that cannot happen in this kind of match"]);
});

test("a league can correct a result: the last one is in force, and the first stays in the history", async () => {
  const { inbox, files, parts } = await honestSeason();
  const f = FIXTURES.football;
  // The league first enters 0-0 by mistake, then corrects it to 2-1.
  const wrong = new Inbox();
  wrong.messages = inbox.messages.filter((m) => parseMessage(m.payload).kind !== "result");
  wrong.at(f.kickoff + 7000).send(LEAGUE_ACCOUNT, resultMessage(parts.football.match, 0x00));
  wrong.at(f.kickoff + 7600).send(LEAGUE_ACCOUNT, resultMessage(parts.football.match, 0x12));
  const { matches, records } = await fromChain(wrong, files);
  const football = matches.find((m) => m.label === "Arsenal v Chelsea");
  assert.deepEqual(football.result, { home: 2, away: 1 });
  assert.deepEqual(football.results.map((r) => r.resultByte), [0x00, 0x12], "both results are on the record");
  assert.equal(records[toHex(id("ada"))][0].points, 3, "scored against the corrected result");
});

test("a void match scores nobody", async () => {
  const f = FIXTURES.football;
  const inbox = new Inbox();
  inbox.send(LEAGUE_ACCOUNT, await matchMessage(LEAGUE, f));
  const made = await sealAndBundle(f, { ada: { home: 2, away: 1 } });
  inbox.at(f.kickoff - 600).send(LEAGUE_ACCOUNT, await lockMessage(made.bundle));
  inbox.at(f.kickoff + 7200).send(LEAGUE_ACCOUNT, resultMessage(made.match, "void"));
  const { table, records } = await fromChain(inbox, { [toHex(made.match)]: made.file });
  assert.deepEqual(lines(table), ["1 ada 0"]);
  assert.equal(records[toHex(id("ada"))][0].state, "void");
});

test("a member's challenge is never hidden, and is marked as inside or outside the 24 hours", async () => {
  const { inbox, files, parts } = await honestSeason();
  const f = FIXTURES.football;
  const resultAt = f.kickoff + 7200;
  inbox.at(resultAt + 3600).send(MEMBER, challengeMessage(parts.football.match, 0x13)); // "it was 3-1"
  inbox.at(resultAt + 25 * 3600).send(MEMBER, challengeMessage(parts.football.match, 0x13));
  const { matches, table } = await fromChain(inbox, files);
  const football = matches.find((m) => m.label === "Arsenal v Chelsea");
  assert.equal(football.challenges.length, 2);
  assert.deepEqual(football.challenges.map((c) => c.inWindow), [true, false]);
  assert.equal(football.challenges[0].from, MEMBER);
  assert.deepEqual(football.result, { home: 2, away: 1 }, "a challenge does not change the result by itself");
  assert.deepEqual(lines(table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
});

test("an openings file for a different match is not used", async () => {
  const { inbox, files, parts } = await honestSeason();
  const swapped = { ...files, [toHex(parts.football.match)]: parts.tennis.file };
  const { table, ignored } = await fromChain(inbox, swapped);
  assert.match(ignored[0].why, /different match/);
  // Nobody's football pick was opened, so football scores nobody: ada 1+3, bola 3+0, chidi 0+1.
  assert.deepEqual(lines(table), ["1 ada 4", "2 bola 3", "3 chidi 1"]);
});

test("a match with no openings file yet: sealed picks are not shown as opened", async () => {
  const { inbox, files, parts } = await honestSeason();
  delete files[toHex(parts.tennis.match)];
  const { table, records } = await fromChain(inbox, files);
  // Without tennis: ada 3 + 1, bola 1 + 3, chidi 0 + 0. Ada and Bola are level on everything, so
  // they share first place.
  assert.deepEqual(lines(table).sort(), ["1 ada 4", "1 bola 4", "3 chidi 0"]);
  assert.equal(records[toHex(id("ada"))][2].state, "no-pick", "with no file, the chain alone cannot show who sealed a pick");
});
