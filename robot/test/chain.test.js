// The robot's work on X Layer, checked with the real server's code and a stand-in for the chain
// that keeps messages the way TapeOut's mailbox does. The record it leaves is then read with the
// picks engine's own reader, exactly as it would be read from X Layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BASKETBALL, FOOTBALL, basketballResult, buildBundle, encodePick, fromHex, loadCircuits, lockMessage, matchId, newDeviceKey, parseMessage, playerIdOf, readLeague,
  sealPick, signRequest, tableFromChain, toHex,
} from "../../engine/src/index.js";
import { createHandler } from "../../server/src/http.js";
import { createKickoff } from "../../server/src/kickoff.js";
import { MemoryStore } from "../../server/src/store.js";
import { CLOSES_BEFORE, SETTLE, TOO_LATE, chainTick, lockTime, newMemory, nextLock } from "../src/chain.js";

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
    async publish(match, text) {
      files[match] = text;
    },
    async publishedCount(match) {
      return files[match] ? JSON.parse(files[match]).openings.length : 0;
    },
  };
  const server = {
    bundle: (match) => kickoff.freeze({ now: clock.now, match }),
    openings: (match) => kickoff.openingsFile({ now: clock.now, match }).catch(() => null),
  };
  const w = { clock, kickoff, handle, f, inbox, files, sent, chain, server, memory: newMemory() };
  w.reads = 0;
  const read = chain.read;
  chain.read = async () => (w.reads++, read());
  w.tick = async ({ patient = false } = {}) => {
    if (!patient) w.memory.lookedAt.clear(); // most checks here do not wait ten minutes between looks
    return chainTick({ now: clock.now, league: LEAGUE, fixtures: await kickoff.fixtures(), server, chain, memory: w.memory });
  };
  w.kinds = () => inbox.map((m) => parseMessage(m.payload).kind);
  return w;
}

/** A phone seals a pick and enters it. `open()` hands it over after kickoff. */
async function phone(w, which, pick) {
  const key = await newDeviceKey();
  const id = toHex(await playerIdOf(key.publicKey));
  const f = w.f[which];
  const sealed = await sealPick({ league: LEAGUE, match: f.id, sport: f.sport, pick, player: id });
  const post = async (path, payload) => w.handle({ method: "POST", path, headers: {}, body: await signRequest({ ...key, method: "POST", path, payload, at: w.clock.now }) });
  assert.equal((await post("/api/picks", { match: f.id, fingerprint: toHex(sealed.fingerprint) })).status, 200);
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
  assert.deepEqual(await w.tick(), { did: [], problems: [] });
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
  assert.deepEqual(await w.tick(), { did: [], problems: [] });
});

test("a match nobody picked costs nothing: it is never announced or locked", async () => {
  const w = await world();
  w.clock.now = lockTime(w.f.nobody);
  assert.deepEqual(await w.tick(), { did: [], problems: [] });
  w.clock.now = w.f.nobody.kickoff + HOUR;
  await finish(w, "nobody", { home: 1, away: 1 }, "1 – 1");
  assert.deepEqual(await w.tick(), { did: [], problems: [] });
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
  assert.deepEqual(await w.tick(), { did: [], problems: [] });
  assert.deepEqual(w.kinds(), ["match", "lock"]);
  // The same after the result.
  w.clock.now = w.f.football.kickoff + 2 * HOUR;
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  await w.tick();
  w.memory = newMemory();
  assert.deepEqual(await w.tick(), { did: [], problems: [] });
  assert.deepEqual(w.kinds(), ["match", "lock", "result"]);
});

test("a robot that wakes too close to kickoff does not lock, and says plainly that those picks do not count", async () => {
  const w = await world();
  await phone(w, "football", { home: 2, away: 1 });
  w.clock.now = w.f.football.kickoff - TOO_LATE;
  const late = await w.tick();
  assert.deepEqual(late.did, []);
  assert.match(late.problems[0], /Arsenal v Chelsea: there was not enough time left to lock 1 sealed pick before kickoff\. They do not count\./);
  assert.equal(w.inbox.length, 0);
  // It is said once, not on every round. And no result is ever written for a match that was not locked.
  w.clock.now = w.f.football.kickoff + 2 * HOUR;
  await finish(w, "football", { home: 2, away: 1 }, "2 – 1");
  assert.deepEqual(await w.tick(), { did: [], problems: [] });
  assert.equal(w.inbox.length, 0);
  // One second earlier, there was still time.
  const w2 = await world();
  await phone(w2, "football", { home: 2, away: 1 });
  w2.clock.now = w2.f.football.kickoff - TOO_LATE - 1;
  assert.equal((await w2.tick()).did.length, 2);
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
  // After the match, a changed bundle is locked: Ada's pick swapped for the real score.
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
  assert.deepEqual(await w.tick(), { did: [], problems: [] }, "not published again while nothing has changed");
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
