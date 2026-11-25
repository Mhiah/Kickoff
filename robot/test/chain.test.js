// The robot's work on X Layer, checked with the real server's code and a stand-in for the chain
// that keeps messages the way TapeOut's mailbox does. The record it leaves is then read with the
// picks engine's own reader, exactly as it would be read from X Layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  BASKETBALL, FOOTBALL, basketballResult, buildBundle, encodePick, sealEnvelope, fromHex, loadCircuits, lockMessage, matchId, newDeviceKey, openingsPath, parseMessage, playerIdOf, readLeague,
  sealPick, signRequest, tableFromChain, toHex,
} from "../../engine/src/index.js";
import { createHandler } from "../../server/src/http.js";
import { createKickoff } from "../../server/src/kickoff.js";
import { MemoryStore } from "../../server/src/store.js";
import { CLOSES_BEFORE, SETTLE, TOO_LATE, chainTick, lockTime, newMemory, nextLock } from "../src/chain.js";
import { createOpener, envelopeKeysFrom } from "../src/envelope.js";
import { PIECE, publishCalls } from "../src/xlayer.js";

const LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
const ACCOUNT = `0x${LEAGUE.slice(24)}`;
const START = 1_800_000_000;
const HOUR = 3600;
const ADMIN = "the-robots-key-of-enough-length";

const FACTS = {
  football: { comp: "pl", sport: FOOTBALL, home: "Arsenal", away: "Chelsea", kickoff: START + 2 * HOUR, label: "Premier League: Arsenal v Chelsea" },
  basketball: { comp: "nba", sport: BASKETBALL, home: "Knicks", away: "Bucks", kickoff: START + 3 * HOUR, label: "NBA: Knicks v Bucks" },
  nobody: { comp: "cl", sport: FOOTBALL, home: "Inter", away: "Barcelona", kickoff: START + 2 * HOUR, label: "Champions League: Inter v Barcelona" },
};

async function world() {
  const clock = { now: START };
  const kickoff = createKickoff({ store: new MemoryStore(), league: LEAGUE });
  const handle = createHandler({ kickoff, now: () => clock.now, adminKey: ADMIN });
  const f = {};
  for (const [name, facts] of Object.entries(FACTS)) {
    f[name] = { id: toHex(await matchId(LEAGUE, { sport: facts.sport, kickoff: facts.kickoff, bestOf: 0, label: facts.label })), feedId: `test:${name}`, state: "scheduled", ...facts };
  }
  await kickoff.putFixtures({ fixtures: Object.values(f) });

  // The stand-in for X Layer: the league's inbox and its site.
  const inbox = [];
  const files = {};
  const sent = [];
  const chain = {
    down: false,
    async read() {
      if (chain.down) throw new Error("the node did not answer");
      const { matches } = await readLeague({ league: fromHex(LEAGUE), account: ACCOUNT, messages: inbox });
      return new Map(matches.map((m) => [toHex(m.id), { announced: true, lock: m.lock, resulted: m.state !== "pending" }]));
    },
    async send(message) {
      if (chain.down) throw new Error("the node did not answer");
      inbox.push({ index: inbox.length, from: ACCOUNT, timestamp: clock.now, ref: message.ref, payload: message.payload });
      sent.push(clock.now);
    },
    // Published the way the real robot does it: the calls it would send to TapeOut's site store
    // are made on a stand-in that keeps the store's rules. A file only counts once every piece is
    // in and the whole matches the fingerprint given with the first piece.
    async publish(match, text) {
      const calls = publishCalls({ account: ACCOUNT, path: openingsPath(fromHex(match)), bytes: new TextEncoder().encode(text) });
      for (const call of calls) {
        if (chain.stopAfter !== undefined && site.calls >= chain.stopAfter) throw new Error("the node did not answer");
        site.take(call);
      }
      delete files[match];
      const whole = site.read(openingsPath(fromHex(match)));
      if (whole !== null) files[match] = whole;
      return calls.length;
    },
    async publishedCount(match) {
      const whole = site.read(openingsPath(fromHex(match)));
      return whole ? JSON.parse(whole).openings.length : 0;
    },
  };
  const site = siteStore();
  const server = {
    bundle: (match) => kickoff.freeze({ now: clock.now, match }),
    openings: (match) => kickoff.openingsFile({ now: clock.now, match }).catch(() => null),
    envelopes: (match) => kickoff.envelopes({ now: clock.now, match }),
    open: (match, openings) => kickoff.openMany({ now: clock.now, match, openings }),
    reports: [],
    async report(locks) {
      if (server.deaf) throw new Error("status 503: no answer");
      server.reports.push(...locks.map((l) => `${Object.values(f).find((x) => x.id === l.match).home} ${l.state}`));
      return kickoff.putLocks({ locks });
    },
  };
  const w = { clock, kickoff, handle, f, inbox, files, sent, chain, site, server, memory: newMemory() };
  w.reads = 0;
  const read = chain.read;
  chain.read = async () => (w.reads++, read());
  w.tick = async ({ patient = false } = {}) => {
    if (!patient) w.memory.lookedAt.clear(); // most checks here do not wait ten minutes between looks
    return chainTick({ now: clock.now, league: LEAGUE, fixtures: await kickoff.fixtures(), server, chain, memory: w.memory, opener: w.opener ?? null });
  };
  w.kinds = () => inbox.map((m) => parseMessage(m.payload).kind);
  return w;
}

/** A stand-in for TapeOut's site store, with its rules: 24,000 bytes a piece, pieces in order, one fingerprint for the whole file. */
function siteStore() {
  const kept = new Map();
  const store = {
    calls: 0,
    take({ signature, values }) {
      store.calls++;
      const data = values.at(-1);
      assert.ok(data.length <= PIECE, "no piece is bigger than the site store takes");
      if (signature.startsWith("putFile(")) {
        const [, path, , sha] = values;
        kept.set(path, { sha: toHex(sha), pieces: [Uint8Array.from(data)] });
      } else if (signature.startsWith("appendChunk(")) {
        const [, path, index] = values;
        const file = kept.get(path);
        assert.ok(file, "a piece can only be added to a file that has been started");
        assert.equal(Number(index), file.pieces.length, "pieces go in order");
        assert.equal(file.pieces.at(-1).length, PIECE, "only the last piece may be short");
        file.pieces.push(Uint8Array.from(data));
      } else assert.fail(`the site store has no ${signature}`);
    },
    pieces: (path) => kept.get(path)?.pieces.length ?? 0,
    /** The file's text, or null if it is not there or not all there. */
    read(path) {
      const file = kept.get(path);
      if (!file) return null;
      const whole = Buffer.concat(file.pieces);
      return createHash("sha256").update(whole).digest("hex") === file.sha ? whole.toString("utf8") : null;
    },
  };
  return store;
}

/** A phone seals a pick and enters it. `open()` hands it over after kickoff. */
/** The robot's key for unlocking predictions in these tests, and somebody else's. */
const ROBOT_KEY = "ab".repeat(32);
const lockedTo = (secret) => envelopeKeysFrom(secret).publicKey;

/**
 * @param copyFor  the wallet key of the robot the phone locks a copy of its prediction to, as the
 *                 website does. Left out, the phone sends only the fingerprint, as it used to.
 */
async function phone(w, which, pick, { copyFor = null } = {}) {
  const key = await newDeviceKey();
  const id = toHex(await playerIdOf(key.publicKey));
  const f = w.f[which];
  const sealed = await sealPick({ league: LEAGUE, match: f.id, sport: f.sport, pick, player: id });
  const post = async (path, payload) => w.handle({ method: "POST", path, headers: {}, body: await signRequest({ ...key, method: "POST", path, payload, at: w.clock.now }) });
  const envelope = copyFor ? await sealEnvelope({ to: lockedTo(copyFor), league: LEAGUE, match: f.id, player: id, fingerprint: sealed.fingerprint, pickByte: sealed.pickByte, salt: sealed.salt }) : undefined;
  assert.equal((await post("/api/picks", { match: f.id, fingerprint: toHex(sealed.fingerprint), ...(envelope ? { envelope } : {}) })).status, 200);
  return { id, open: async () => assert.equal((await post("/api/opened", { match: f.id, pickByte: sealed.pickByte, salt: toHex(sealed.salt) })).status, 200) };
}
const finish = (w, which, result, score) =>
  w.kickoff.putFixtures({ fixtures: [{ ...w.f[which], state: "final", score, resultByte: encodePick(w.f[which].sport, result) }] });

test("a whole match: announced and locked before kickoff, result and opened picks after, and the table comes out right", async () => {
  const w = await world();
  const ada = await phone(w, "football", { home: 2, away: 1 });
  const bola = await phone(w, "football", { home: 1, away: 0 });
  const chidi = await phone(w, "football", { home: 0, away: 3 });
  const adaB = await phone(w, "basketball", { winner: "home", band: "A" });

  // While picks are open the robot writes nothing.
  w.clock.now = w.f.football.kickoff - CLOSES_BEFORE - 1;
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  assert.equal(w.inbox.length, 0);

  // A few seconds after picks close: announce, then lock. The match nobody picked is left alone.
  w.clock.now = lockTime(w.f.football);
  const locked = await w.tick();
  assert.deepEqual(locked.did, ["Premier League: Arsenal v Chelsea: announced", `Premier League: Arsenal v Chelsea: locked 3 sealed picks, ${CLOSES_BEFORE - SETTLE} seconds before kickoff`]);
  assert.deepEqual(w.kinds(), ["match", "lock"]);
  assert.ok(w.sent.every((t) => t < w.f.football.kickoff), "everything was written before kickoff");

  // After kickoff two phones open their picks. Chidi never comes back.
  w.clock.now = w.f.football.kickoff + 60;
  await ada.open();
  await bola.open();
  assert.deepEqual((await w.tick()).did, ["Premier League: Arsenal v Chelsea: published 2 opened picks"]);

  // The basketball match is locked in its own time.
  w.clock.now = lockTime(w.f.basketball);
  assert.deepEqual((await w.tick()).did, ["NBA: Knicks v Bucks: announced", `NBA: Knicks v Bucks: locked 1 sealed pick, ${CLOSES_BEFORE - SETTLE} seconds before kickoff`]);

  // The feed says the football is finished, 2-1.
  w.clock.now = w.f.football.kickoff + 2 * HOUR;
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  await adaB.open();
  await finish(w, "basketball", basketballResult({ home: 104, away: 101 }), "104 – 101");
  const after = await w.tick();
  assert.deepEqual(after.did, ["Premier League: Arsenal v Chelsea: result recorded (2 – 1)", "NBA: Knicks v Bucks: result recorded (104 – 101)", "NBA: Knicks v Bucks: published 1 opened pick"]);
  assert.deepEqual(after.problems, []);
  assert.deepEqual(w.kinds(), ["match", "lock", "match", "lock", "result", "result"]);

  // Now everything else is thrown away. The table is rebuilt from the record alone.
  const circuit = (name) => readFileSync(new URL(`../../circuits/out/${name}.hex`, import.meta.url), "utf8");
  const circuits = loadCircuits({ football: circuit("football"), basketball: circuit("basketball"), tennis: circuit("tennis") });
  const { table, ignored } = await tableFromChain({ league: fromHex(LEAGUE), account: ACCOUNT, messages: w.inbox, openingsFiles: w.files, circuits });
  assert.deepEqual(ignored, []);
  const names = { [ada.id]: "ada", [bola.id]: "bola", [chidi.id]: "chidi", [adaB.id]: "ada on basketball" };
  assert.deepEqual(Object.fromEntries(table.map((row) => [names[toHex(row.player)], row.points])), { ada: 3, "ada on basketball": 3, bola: 1, chidi: 0 });

  // And with nothing new, the robot does nothing more.
  w.clock.now += HOUR;
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
});

test("a hundred players on one match: the file goes up in pieces, and every one of them is scored from the record", async () => {
  const w = await world();
  const picks = [{ home: 2, away: 1 }, { home: 1, away: 0 }, { home: 0, away: 3 }]; // spot on, right winner, wrong
  const crowd = [];
  for (let i = 0; i < 100; i++) {
    w.clock.now = START + i; // each joins a second after the one before
    crowd.push(await phone(w, "football", picks[i % 3]));
  }
  w.clock.now = lockTime(w.f.football);
  assert.equal((await w.tick()).did[1], `Premier League: Arsenal v Chelsea: locked 100 sealed picks, ${CLOSES_BEFORE - SETTLE} seconds before kickoff`);

  w.clock.now = w.f.football.kickoff + 2 * HOUR;
  for (const p of crowd) await p.open();
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  const after = await w.tick();
  assert.deepEqual(after.problems, []);
  const path = openingsPath(fromHex(w.f.football.id));
  const pieces = w.site.pieces(path);
  assert.ok(pieces >= 4, `a hundred opened picks need several pieces (it took ${pieces})`);
  assert.deepEqual(after.did, ["Premier League: Arsenal v Chelsea: result recorded (2 – 1)", `Premier League: Arsenal v Chelsea: published 100 opened picks, in ${pieces} pieces`]);
  assert.ok(new TextEncoder().encode(w.files[w.f.football.id]).length > 3 * PIECE);

  const circuit = (name) => readFileSync(new URL(`../../circuits/out/${name}.hex`, import.meta.url), "utf8");
  const circuits = loadCircuits({ football: circuit("football"), basketball: circuit("basketball"), tennis: circuit("tennis") });
  const { table, ignored } = await tableFromChain({ league: fromHex(LEAGUE), account: ACCOUNT, messages: w.inbox, openingsFiles: w.files, circuits });
  assert.deepEqual(ignored, []);
  assert.equal(table.length, 100);
  const pointsOf = new Map(table.map((row) => [toHex(row.player), row.points]));
  crowd.forEach((p, i) => assert.equal(pointsOf.get(p.id), [3, 1, 0][i % 3], `player ${i + 1}`));
  // Nobody shares a place, and players level on points are in the order they joined.
  assert.deepEqual(table.map((row) => row.position), table.map((_, i) => i + 1));
  const order = table.map((row) => crowd.findIndex((p) => p.id === toHex(row.player)));
  const expected = crowd.map((_, i) => i).sort((a, b) => [3, 1, 0][b % 3] - [3, 1, 0][a % 3] || a - b);
  assert.deepEqual(order, expected);

  // Nothing new, so nothing more is written.
  const callsBefore = w.site.calls;
  w.clock.now += HOUR;
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  assert.equal(w.site.calls, callsBefore);
});

test("if the robot is cut off half way through a big file, readers leave the half file alone and the next try puts it all up", async () => {
  const w = await world();
  const crowd = [];
  for (let i = 0; i < 70; i++) crowd.push(await phone(w, "football", { home: 2, away: 1 }));
  w.clock.now = lockTime(w.f.football);
  await w.tick();
  w.clock.now = w.f.football.kickoff + 60;
  for (const p of crowd) await p.open();

  w.chain.stopAfter = 2; // the node stops answering after two pieces
  const cut = await w.tick();
  assert.deepEqual(cut.did, []);
  assert.match(cut.problems[0], /could not be published this time/);
  const path = openingsPath(fromHex(w.f.football.id));
  assert.equal(w.site.pieces(path), 2, "two pieces made it");
  assert.equal(w.site.read(path), null, "a half file does not match its fingerprint, so it is not read");
  assert.equal(w.files[w.f.football.id], undefined);

  delete w.chain.stopAfter;
  w.clock.now += 600;
  const again = await w.tick();
  assert.deepEqual(again.problems, []);
  assert.match(again.did[0], /published 70 opened picks, in \d+ pieces/);
  assert.equal(JSON.parse(w.site.read(path)).openings.length, 70);
});

test("a file is cut into pieces the site store takes: one piece if it fits, the next piece only when there is more", () => {
  const cut = (size) => publishCalls({ account: ACCOUNT, path: "openings/x.json", bytes: new Uint8Array(size).fill(7) });
  assert.deepEqual(cut(10).map((c) => c.signature.split("(")[0]), ["putFile"]);
  assert.deepEqual(cut(PIECE).map((c) => c.values.at(-1).length), [PIECE], "a file of exactly one piece is one piece");
  const three = cut(2 * PIECE + 5);
  assert.deepEqual(three.map((c) => c.signature.split("(")[0]), ["putFile", "appendChunk", "appendChunk"]);
  assert.deepEqual(three.map((c) => c.values.at(-1).length), [PIECE, PIECE, 5]);
  assert.deepEqual(three.slice(1).map((c) => c.values[2]), [1n, 2n], "each later piece says which piece it is");
  // The first call carries the fingerprint of the whole file, not of its first piece.
  assert.equal(toHex(three[0].values[3]), createHash("sha256").update(new Uint8Array(2 * PIECE + 5).fill(7)).digest("hex"));
});

test("a match nobody picked costs nothing: it is never announced or locked", async () => {
  const w = await world();
  w.clock.now = lockTime(w.f.nobody);
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  w.clock.now = w.f.nobody.kickoff + HOUR;
  await finish(w, "nobody", { home: 1, away: 1 }, "1 – 1");
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  assert.equal(w.inbox.length, 0);
});

test("starting the robot again never writes the same thing twice", async () => {
  const w = await world();
  await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = lockTime(w.f.football);
  await w.tick();
  // The robot stops and a new one starts, remembering nothing.
  w.memory = newMemory();
  w.clock.now += 60;
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  assert.deepEqual(w.kinds(), ["match", "lock"]);
  // The same after the result.
  w.clock.now = w.f.football.kickoff + 2 * HOUR;
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  await w.tick();
  w.memory = newMemory();
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  assert.deepEqual(w.kinds(), ["match", "lock", "result"]);
});

test("a robot that wakes too close to kickoff does not lock, and says plainly that those picks do not count", async () => {
  const w = await world();
  await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = w.f.football.kickoff - TOO_LATE;
  const late = await w.tick();
  assert.deepEqual(late.did, []);
  assert.match(late.problems[0], /Arsenal v Chelsea: there was not enough time left to lock 1 sealed pick before kickoff\. They do not count\./);
  assert.deepEqual(late.missed, [{ id: w.f.football.id, label: "Premier League: Arsenal v Chelsea", kickoff: w.f.football.kickoff, count: 1 }]);
  assert.equal(w.inbox.length, 0);
  // It is said once, not on every round. And no result is ever written for a match that was not locked.
  w.clock.now = w.f.football.kickoff + 2 * HOUR;
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  assert.equal(w.inbox.length, 0);
  // One second earlier, there was still time.
  const w2 = await world();
  await phone(w2, "football", { home: 2, away: 1 });
  w2.clock.now = w2.f.football.kickoff - TOO_LATE - 1;
  assert.equal((await w2.tick()).did.length, 2);
});

test("a robot that slept through kickoff says which match's picks were never locked, once, and not for a match nobody picked", async () => {
  const w = await world();
  await phone(w, "football", { home: 2, away: 1 });
  await phone(w, "football", { home: 0, away: 0 });
  // Nobody was awake when picks closed. The robot wakes an hour after kickoff.
  w.clock.now = w.f.football.kickoff + HOUR;
  const woke = await w.tick();
  assert.deepEqual(woke.did, []);
  assert.deepEqual(woke.missed, [{ id: w.f.football.id, label: "Premier League: Arsenal v Chelsea", kickoff: w.f.football.kickoff, count: 2 }]);
  assert.deepEqual(woke.problems, ["Premier League: Arsenal v Chelsea: its 2 sealed picks were never locked on X Layer before kickoff. They cannot be checked there."]);
  assert.equal(w.inbox.length, 0, "nothing is written for it afterwards: a late lock would never count");
  assert.deepEqual(w.server.reports, ["Arsenal missed"], "and Kickoff's server is told, so nobody is given points for it");
  // The match nobody picked, which started at the same time, is not a missed lock.
  assert.ok(!woke.missed.some((m) => m.id === w.f.nobody.id));
  // Said once.
  w.clock.now += 600;
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  // And its result is never written, since there is nothing on X Layer to score.
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  assert.equal(w.inbox.length, 0);
});

test("nobody comes back after predicting: the robot opens every prediction itself, and everyone is scored", async () => {
  const w = await world();
  w.opener = createOpener(ROBOT_KEY);
  const picks = [{ home: 2, away: 1 }, { home: 1, away: 0 }, { home: 0, away: 3 }]; // spot on, right winner, wrong
  const players = [];
  for (const pick of picks) players.push(await phone(w, "football", pick, { copyFor: ROBOT_KEY }));

  // Before kickoff the locked copies are handed to nobody, whatever key they hold.
  w.clock.now = lockTime(w.f.football);
  await w.tick();
  await assert.rejects(w.server.envelopes(w.f.football.id), /Predictions are not opened before the match starts/);
  assert.equal((await w.handle({ method: "GET", path: `/api/admin/envelopes/${w.f.football.id}`, headers: {}, body: null })).status, 403, "and never without the robot's key");

  // The match starts. No phone does anything. On its next round the robot opens all three and publishes them.
  w.clock.now = w.f.football.kickoff + 60;
  const started = await w.tick();
  assert.deepEqual(started.problems, []);
  assert.deepEqual(started.did, ["Premier League: Arsenal v Chelsea: opened 3 sealed picks", "Premier League: Arsenal v Chelsea: published 3 opened picks"]);
  assert.deepEqual(await w.server.envelopes(w.f.football.id), [], "nothing is left to open");

  // The result comes in. Everyone has their points, on Kickoff and rebuilt from X Layer alone.
  w.clock.now = w.f.football.kickoff + 2 * HOUR;
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  const ended = await w.tick();
  assert.deepEqual(ended.did, ["Premier League: Arsenal v Chelsea: result recorded (2 – 1)"]);
  const onKickoff = [];
  for (const p of players) onKickoff.push((await w.kickoff.table({ player: p.id, now: w.clock.now })).you.points);
  assert.deepEqual(onKickoff, [3, 1, 0]);
  const circuit = (name) => readFileSync(new URL(`../../circuits/out/${name}.hex`, import.meta.url), "utf8");
  const circuits = loadCircuits({ football: circuit("football"), basketball: circuit("basketball"), tennis: circuit("tennis") });
  const { table } = await tableFromChain({ league: fromHex(LEAGUE), account: ACCOUNT, messages: w.inbox, openingsFiles: w.files, circuits });
  const fromChain = new Map(table.map((row) => [toHex(row.player), row.points]));
  assert.deepEqual(players.map((p) => fromChain.get(p.id)), [3, 1, 0]);

  // It is done once. A phone that does come back and hands its own over changes nothing.
  await players[0].open();
  w.clock.now += 600;
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
});

test("a prediction with no locked copy, or one locked to another key, still waits for its own phone, and the robot says so once", async () => {
  const w = await world();
  w.opener = createOpener(ROBOT_KEY);
  const withCopy = await phone(w, "football", { home: 2, away: 1 }, { copyFor: ROBOT_KEY });
  const oldWay = await phone(w, "football", { home: 1, away: 1 });
  const wrongKey = await phone(w, "football", { home: 0, away: 0 }, { copyFor: "cd".repeat(32) });
  w.clock.now = lockTime(w.f.football);
  await w.tick();
  w.clock.now = w.f.football.kickoff + 60;
  const started = await w.tick();
  assert.deepEqual(started.did, ["Premier League: Arsenal v Chelsea: opened 1 sealed pick", "Premier League: Arsenal v Chelsea: published 1 opened pick"]);
  assert.deepEqual(started.problems, ["Premier League: Arsenal v Chelsea: 1 locked copy could not be opened. Only the phone that made it can open it now."]);
  w.clock.now += 600;
  assert.deepEqual((await w.tick()).problems, [], "said once");
  // Their own phones can still open them, and then they are published too.
  await oldWay.open();
  await wrongKey.open();
  w.clock.now += 600;
  assert.deepEqual((await w.tick()).did, ["Premier League: Arsenal v Chelsea: published 3 opened picks"]);
  assert.ok(withCopy.id);
});

test("if the locked copies cannot be fetched, nothing is marked as done and the robot tries again", async () => {
  const w = await world();
  w.opener = createOpener(ROBOT_KEY);
  await phone(w, "football", { home: 2, away: 1 }, { copyFor: ROBOT_KEY });
  w.clock.now = lockTime(w.f.football);
  await w.tick();
  w.clock.now = w.f.football.kickoff + 60;
  const envelopes = w.server.envelopes;
  w.server.envelopes = async () => {
    throw new Error("status 503: no answer");
  };
  const first = await w.tick();
  assert.deepEqual(first.did, []);
  assert.match(first.problems[0], /its sealed picks could not be opened this time \(status 503: no answer\)\. It will be tried again\./);
  w.server.envelopes = envelopes;
  w.clock.now += 300;
  assert.deepEqual((await w.tick()).did, ["Premier League: Arsenal v Chelsea: opened 1 sealed pick", "Premier League: Arsenal v Chelsea: published 1 opened pick"]);
});

test("without the unlocking key the robot opens nothing, and phones open their own as before", async () => {
  const w = await world();
  const p = await phone(w, "football", { home: 2, away: 1 }, { copyFor: ROBOT_KEY });
  w.clock.now = lockTime(w.f.football);
  await w.tick();
  w.clock.now = w.f.football.kickoff + 60;
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] });
  await p.open();
  assert.deepEqual((await w.tick()).did, ["Premier League: Arsenal v Chelsea: published 1 opened pick"]);
});

test("Kickoff's server is told how each lock went, and only gives points for a match it was told was locked", async () => {
  const w = await world();
  const ada = await phone(w, "football", { home: 2, away: 1 });
  const adaB = await phone(w, "basketball", { winner: "home", band: "A" });
  const lockOf = async (which) => (await w.kickoff.fixtures()).find((x) => x.id === w.f[which].id).lock;
  const pointsOf = async (p) => (await w.kickoff.table({ player: p.id, now: w.clock.now })).you.points;

  // The football is locked in good time, and the server is told at once, before kickoff.
  w.clock.now = lockTime(w.f.football);
  await w.tick();
  assert.deepEqual(w.server.reports, ["Arsenal locked"]);
  assert.equal(await lockOf("football"), "locked");

  // The robot is too late for the basketball. The server is told that too.
  w.clock.now = w.f.basketball.kickoff - TOO_LATE;
  await w.tick();
  assert.deepEqual(w.server.reports, ["Arsenal locked", "Knicks missed"]);
  assert.equal(await lockOf("basketball"), "missed");

  // Both finish and both picks are opened. Only the locked match gives points on Kickoff.
  w.clock.now = w.f.basketball.kickoff + 3 * HOUR;
  await ada.open();
  await adaB.open();
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  await finish(w, "basketball", basketballResult({ home: 104, away: 101 }), "104 – 101");
  await w.tick();
  assert.equal(await pointsOf(ada), 3);
  assert.equal(await pointsOf(adaB), 0, "spot on, but never locked on X Layer, so it gives nothing");
  // Each is said once, however many rounds follow.
  await w.tick();
  assert.equal(w.server.reports.length, 2);
});

test("a robot that starts afresh tells the server about locks it finds on X Layer, and not what the server already knows", async () => {
  const w = await world();
  const ada = await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = lockTime(w.f.football);
  w.server.deaf = true; // the lock goes on X Layer, but the server cannot be reached to be told
  const locked = await w.tick();
  assert.equal(locked.did.length, 2);
  assert.match(locked.problems[0], /Kickoff's server could not be told how a lock went \(status 503: no answer\)\. It will be told again\./);
  assert.deepEqual(w.server.reports, []);

  // The result comes in and the pick is opened: no points yet, because the server has not been told.
  w.clock.now = w.f.football.kickoff + 2 * HOUR;
  await ada.open();
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  const points = async () => (await w.kickoff.table({ player: ada.id, now: w.clock.now })).you.points;
  assert.equal(await points(), 0);

  // A new robot, with no memory, finds the lock on X Layer and tells the server. The points follow.
  w.server.deaf = false;
  w.memory = newMemory();
  await w.tick();
  assert.deepEqual(w.server.reports, ["Arsenal locked"]);
  assert.equal(await points(), 3);

  // Another new robot has nothing to tell: the server's own list already says locked.
  w.memory = newMemory();
  await w.tick();
  assert.deepEqual(w.server.reports, ["Arsenal locked"]);
});

test("a match from before Kickoff was on X Layer is never called a missed lock, and its points are left alone", async () => {
  const w = await world();
  await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = w.f.football.kickoff + HOUR;
  // Kickoff went live on X Layer half an hour after this match started.
  const out = await chainTick({ now: w.clock.now, league: LEAGUE, fixtures: await w.kickoff.fixtures(), server: w.server, chain: w.chain, memory: w.memory, since: w.f.football.kickoff + 1800 });
  assert.deepEqual(out, { did: [], problems: [], missed: [] });
  assert.deepEqual(w.server.reports, []);
});

test("if Kickoff's server cannot say whether anyone picked a match, the robot asks again instead of guessing", async () => {
  const w = await world();
  await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = w.f.football.kickoff + HOUR;
  const bundle = w.server.bundle;
  w.server.bundle = async () => {
    throw new Error("no answer");
  };
  const first = await w.tick();
  assert.deepEqual(first.missed, []);
  assert.ok(first.problems.some((p) => /could not say whether anyone picked it \(no answer\)/.test(p)));
  w.server.bundle = bundle;
  assert.equal((await w.tick()).missed.length, 1);
});

test("if X Layer cannot be reached, nothing is marked as done and it is tried again", async () => {
  const w = await world();
  await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = lockTime(w.f.football);
  w.chain.down = true;
  const first = await w.tick();
  assert.match(first.problems[0], /could not be locked this time \(the node did not answer\)\. It will be tried again\./);
  assert.equal(w.inbox.length, 0);
  w.chain.down = false;
  w.clock.now += 20;
  assert.equal((await w.tick()).did.length, 2);
  assert.deepEqual(w.kinds(), ["match", "lock"]);
});

test("if the announcement went through but the lock did not, the next round only sends the lock", async () => {
  const w = await world();
  await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = lockTime(w.f.football);
  const send = w.chain.send;
  let n = 0;
  w.chain.send = async (m) => (++n === 2 ? Promise.reject(new Error("the node did not answer")) : send(m));
  assert.equal((await w.tick()).problems.length, 1);
  assert.deepEqual(w.kinds(), ["match"]);
  w.chain.send = send;
  w.clock.now += 20;
  assert.deepEqual((await w.tick()).did, [`Premier League: Arsenal v Chelsea: locked 1 sealed pick, ${CLOSES_BEFORE - SETTLE - 20} seconds before kickoff`]);
  assert.deepEqual(w.kinds(), ["match", "lock"]);
});

test("CHEAT: the robot will not lock a bundle that does not add up to the fingerprint the server gave", async () => {
  const w = await world();
  await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = lockTime(w.f.football);
  const honest = w.server.bundle;
  // The server hands over the right fingerprint with an extra pick slipped into the list.
  w.server.bundle = async (match) => {
    const b = await honest(match);
    return { ...b, entries: [...b.entries, { player: "ee".repeat(32), fingerprint: "dd".repeat(32) }] };
  };
  const tried = await w.tick();
  assert.match(tried.problems[0], /does not add up to the fingerprint it gave/);
  assert.deepEqual(w.kinds(), ["match"], "the match was announced, but nothing was locked");
});

test("CHEAT: a lock written after kickoff, by anyone, is not what the robot or a reader goes by", async () => {
  const w = await world();
  const ada = await phone(w, "football", { home: 0, away: 0 });
  w.clock.now = lockTime(w.f.football);
  await w.tick();
  // After the match, a changed bundle is locked: Ada's prediction swapped for the real score.
  w.clock.now = w.f.football.kickoff + 2 * HOUR;
  const forged = await sealPick({ league: LEAGUE, match: w.f.football.id, sport: FOOTBALL, pick: { home: 2, away: 1 }, player: ada.id });
  const changed = await buildBundle({ league: LEAGUE, match: w.f.football.id, entries: [{ player: ada.id, fingerprint: toHex(forged.fingerprint) }] });
  await w.chain.send(await lockMessage(changed));
  const record = await w.chain.read();
  const honest = await w.kickoff.freeze({ now: w.clock.now, match: w.f.football.id });
  assert.equal(toHex(record.get(w.f.football.id).lock.root), honest.root, "the lock in force is still the one made before kickoff");
});

test("picks opened later are published too, and a postponed match is recorded as off", async () => {
  const w = await world();
  const ada = await phone(w, "football", { home: 2, away: 1 });
  const bola = await phone(w, "football", { home: 1, away: 1 });
  const adaB = await phone(w, "basketball", { winner: "away", band: "C" });
  w.clock.now = lockTime(w.f.football);
  await w.tick();
  w.clock.now = lockTime(w.f.basketball);
  await w.tick();
  w.clock.now = w.f.football.kickoff + 60;
  await ada.open();
  assert.deepEqual((await w.tick()).did, ["Premier League: Arsenal v Chelsea: published 1 opened pick"]);
  assert.deepEqual(await w.tick(), { did: [], problems: [], missed: [] }, "not published again while nothing has changed");
  w.clock.now += HOUR;
  await bola.open();
  assert.deepEqual((await w.tick()).did, ["Premier League: Arsenal v Chelsea: published 2 opened picks"]);
  // The basketball match is called off after it was locked.
  w.clock.now = w.f.basketball.kickoff + 60;
  await w.kickoff.putFixtures({ fixtures: [{ ...w.f.basketball, state: "void", note: "postponed" }] });
  assert.deepEqual((await w.tick()).did, ["NBA: Knicks v Bucks: recorded as off. Nobody scores."]);
  assert.equal(adaB.id.length, 64);
});

test("the robot knows when it next has to be awake", async () => {
  const w = await world();
  const fixtures = await w.kickoff.fixtures();
  assert.equal(nextLock(fixtures, START, w.memory), lockTime(w.f.football));
  assert.equal(nextLock(fixtures, lockTime(w.f.football), w.memory), lockTime(w.f.basketball));
  assert.equal(nextLock(fixtures, w.f.basketball.kickoff, w.memory), null);
});

test("the robot does not keep asking: X Layer is read only when needed, and opened picks are looked for every ten minutes", async () => {
  const w = await world();
  const ada = await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = lockTime(w.f.football);
  await w.tick({ patient: true });
  const afterLock = w.reads;
  let asked = 0;
  const openings = w.server.openings;
  w.server.openings = (m) => (asked++, openings(m));
  // Twenty rounds, twenty seconds apart, after kickoff. The match is not finished yet.
  w.clock.now = w.f.football.kickoff + 60;
  await ada.open();
  for (let i = 0; i < 20; i++) {
    await w.tick({ patient: true });
    w.clock.now += 20;
  }
  assert.equal(w.reads, afterLock, "X Layer was not read again: the robot already knew the match was locked");
  assert.equal(asked, 1, "the server was asked for opened picks once in those seven minutes");
  assert.equal(Object.keys(w.files).length, 1);
});
