import { test } from "node:test";
import assert from "node:assert/strict";

import { CLOSES_BEFORE, SETTLE, lockTime, newMemory } from "../src/chain.js";
import { LOOK_EVERY, RETRY_IN, SYNC_EVERY, watch } from "../src/watch.js";

const START = 1_800_000_000;
const HOUR = 3600;

/** A clock that only moves when the robot sleeps, and a record of what the robot did and when. */
function setup({ fixtures = [], withChain = true } = {}) {
  const clock = { now: START };
  const log = [];
  const memory = newMemory();
  const s = {
    clock, log, memory, fixtures,
    syncFails: false, chainFails: 0,
    run: (hours) =>
      watch({
        until: START + hours * HOUR,
        now: () => clock.now,
        sleep: async (seconds) => { clock.now += seconds; },
        sync: async () => {
          log.push(["sync", clock.now - START]);
          if (s.syncFails) throw new Error("the feed is down");
          return { ok: true };
        },
        list: async () => s.fixtures,
        chain: withChain
          ? async (list) => {
              log.push(["look", clock.now - START]);
              if (s.chainFails > 0) { s.chainFails--; return { did: [], problems: ["X Layer could not be read"] }; }
              // Behave as chain.js does: a match whose picks have closed is locked.
              for (const f of list) if (lockTime(f) <= clock.now && clock.now < f.kickoff) memory.locked.add(f.id);
              return { did: [], problems: [] };
            }
          : null,
        memory,
        say: (line) => log.push(["said", line]),
      }),
    at: (kind) => log.filter((l) => l[0] === kind).map((l) => l[1]),
  };
  return s;
}
const fixture = (id, minutesAhead) => ({ id, state: "scheduled", kickoff: START + minutesAhead * 60, label: id });

test("the list of matches is brought up to date straight away, then every half hour", async () => {
  const s = setup();
  const tally = await s.run(2);
  assert.deepEqual(s.at("sync"), [0, 1800, 3600, 5400]);
  assert.equal(tally.syncs, 4);
});

test("without a wallet the robot only keeps the list up to date", async () => {
  const s = setup({ withChain: false, fixtures: [fixture("a", 60)] });
  const tally = await s.run(2);
  assert.equal(tally.looks, 0);
  assert.equal(s.at("look").length, 0);
  assert.equal(tally.syncs, 4);
});

test("the robot is awake for every lock, within a second of the moment it becomes possible", async () => {
  // Three matches at awkward times, none on a five-minute mark.
  const fixtures = [fixture("a", 47), fixture("b", 83.5), fixture("c", 84)];
  const s = setup({ fixtures });
  await s.run(2);
  for (const f of fixtures) {
    const due = lockTime(f) - START;
    const looks = s.at("look").filter((t) => t >= due);
    assert.ok(looks.length > 0, `${f.id} was never looked at after its picks closed`);
    assert.ok(looks[0] - due <= 1, `${f.id}: first look came ${looks[0] - due}s after its lock was due`);
    assert.ok(looks[0] < f.kickoff - START - (CLOSES_BEFORE - SETTLE - 2), `${f.id} was looked at with almost the full ten minutes still to go`);
  }
});

test("between locks it looks every five minutes, not every few seconds", async () => {
  const s = setup({ fixtures: [fixture("a", 600)] });
  const tally = await s.run(2);
  assert.ok(tally.looks >= 24 && tally.looks <= 30, `looked ${tally.looks} times in two hours`);
  const times = s.at("look");
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] <= LOOK_EVERY + 1);
});

test("after a round with a problem it looks again in twenty seconds, and keeps trying until the lock is done", async () => {
  const f = fixture("a", 47);
  const s = setup({ fixtures: [f] });
  // X Layer cannot be reached for the first three tries after picks close.
  const original = s.run;
  const due = lockTime(f) - START;
  let armed = false;
  const tally = await watch({
    until: START + 1 * HOUR,
    now: () => s.clock.now,
    sleep: async (seconds) => { s.clock.now += seconds; if (!armed && s.clock.now - START >= due) { armed = true; s.chainFails = 3; } },
    sync: async () => ({ ok: true }),
    list: async () => s.fixtures,
    chain: async (list) => {
      s.log.push(["look", s.clock.now - START]);
      if (s.chainFails > 0) { s.chainFails--; return { did: [], problems: ["X Layer could not be read"] }; }
      for (const x of list) if (lockTime(x) <= s.clock.now && s.clock.now < x.kickoff) s.memory.locked.add(x.id);
      return { did: [], problems: [] };
    },
    memory: s.memory,
  });
  const after = s.at("look").filter((t) => t >= due);
  assert.ok(after.length >= 4);
  assert.ok(after[3] - after[0] <= 3 * (RETRY_IN + 1), `it took ${after[3] - after[0]}s to get through three failures`);
  assert.ok(s.memory.locked.has("a"), "the lock was made in the end");
  assert.ok(after[3] < f.kickoff - START - 500, "with most of the ten minutes still left");
  assert.equal(tally.problems, 3);
  assert.equal(typeof original, "function");
});

test("a failing feed does not stop the X Layer work, and is tried again next half hour", async () => {
  const s = setup({ fixtures: [fixture("a", 47)] });
  s.syncFails = true;
  const tally = await s.run(1);
  assert.equal(tally.syncs, 2);
  assert.ok(tally.problems >= 2);
  assert.ok(s.memory.locked.has("a"), "the lock was still made");
  assert.match(s.log.find((l) => l[0] === "said")[1], /could not be brought up to date this time \(the feed is down\)/);
  assert.equal(SYNC_EVERY, 1800);
});

test("it stops when its time is up", async () => {
  const s = setup();
  await s.run(5.5);
  assert.ok(s.clock.now - START >= 5.5 * HOUR && s.clock.now - START < 5.5 * HOUR + 31);
});
