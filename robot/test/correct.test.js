// Putting a wrong result right, by hand: checked against the real server's code and a stand-in feed.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchWeek } from "../../feed/src/index.js";
import { createHandler } from "../../server/src/http.js";
import { createKickoff } from "../../server/src/kickoff.js";
import { MemoryStore } from "../../server/src/store.js";
import { correctResult } from "../src/correct.js";
import { withIds } from "../src/fixtures.js";
import { syncFixtures } from "../src/sync.js";

const LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
const SERVER = "https://kickoff.example";
const ADMIN = "the-robots-key-of-enough-length";
const KEYS = { football: "football-feed-key", basketball: "basketball-feed-key" };
const at = (iso) => Date.parse(iso) / 1000;
const NOW = at("2026-11-24T09:00:00Z");

const side = (shortName) => ({ id: shortName.length, name: `${shortName} FC`, shortName, tla: shortName.slice(0, 3).toUpperCase() });
const footballMatch = (id, utcDate, status, home, away, score = {}) => ({
  id, utcDate, status, matchday: 5, stage: "LEAGUE_STAGE", group: null, homeTeam: side(home), awayTeam: side(away),
  score: { winner: null, duration: "REGULAR", fullTime: { home: null, away: null }, halfTime: { home: null, away: null }, ...score },
});
const finished = (home, away, h, a) => footballMatch(home.length * 7 + away.length, "2026-11-25T20:00:00Z", "FINISHED", home, away, { winner: h > a ? "HOME_TEAM" : h < a ? "AWAY_TEAM" : "DRAW", fullTime: { home: h, away: a } });

/** Kickoff's server and the football feed, as one web. The feed gives only the days it is asked for. */
function world() {
  const clock = { now: NOW };
  const kickoff = createKickoff({ store: new MemoryStore(), league: LEAGUE });
  const handle = createHandler({ kickoff, now: () => clock.now, adminKey: ADMIN });
  const w = { clock, kickoff, cl: [footballMatch(31, "2026-11-25T20:00:00Z", "TIMED", "Sporting CP", "Man United"), footballMatch(32, "2026-11-25T20:00:00Z", "TIMED", "Sabah FK", "Barça")], asked: [] };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    w.asked.push({ url, method: init.method ?? "GET" });
    const reply = (status, body) => new Response(JSON.stringify(body), { status });
    if (u.origin === SERVER) {
      const answer = await handle({ method: init.method ?? "GET", path: u.pathname, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
      return reply(answer.status, answer.body);
    }
    if (u.hostname === "api.football-data.org") {
      const from = u.searchParams.get("dateFrom"), to = u.searchParams.get("dateTo");
      const inDays = (m) => (!from || m.utcDate.slice(0, 10) >= from) && (!to || m.utcDate.slice(0, 10) <= to);
      return reply(200, { competition: { code: u.pathname.includes("/PL/") ? "PL" : "CL" }, matches: u.pathname.includes("/CL/") ? w.cl.filter(inDays) : [] });
    }
    if (u.hostname === "api.balldontlie.io") return reply(200, { data: [], meta: {} });
    return reply(404, {});
  };
  w.robot = () => syncFixtures({ server: SERVER, adminKey: ADMIN, keys: KEYS, now: clock.now, fetch: w.fetch, pending: null });
  w.correct = (words, extra = {}) => correctResult({ server: SERVER, adminKey: ADMIN, keys: KEYS, words, now: clock.now, fetch: w.fetch, ...extra });
  w.lines = async (word) => (await kickoff.fixtures()).filter((f) => f.label.includes(word));
  return w;
}

/** The week is listed, both matches finish, and the feed then takes a Man United goal back: 2 – 3 becomes 2 – 2. */
async function wrongResult() {
  const w = world();
  await w.robot();
  w.clock.now = at("2026-11-25T22:10:00Z");
  w.cl = [finished("Sporting CP", "Man United", 2, 3), finished("Sabah FK", "Barça", 1, 4)];
  await w.robot();
  w.clock.now = at("2026-11-25T22:40:00Z");
  w.cl = [finished("Sporting CP", "Man United", 2, 2), finished("Sabah FK", "Barça", 1, 4)];
  return w;
}

test("looking says what Kickoff has and what the feed says now, and changes nothing", async () => {
  const w = await wrongResult();
  const report = await w.robot();
  assert.match(report.problems.join("\n"), /Sporting CP v Man United: the feed now says "final 2 – 2" for a match already finished as "final 2 – 3"\. Left as it was\./);
  const found = await w.correct("sporting cp v man united");
  assert.deepEqual(found, { label: "Champions League: Sporting CP v Man United", kickoff: at("2026-11-25T20:00:00Z"), recorded: "final 2 – 3", feed: "final 2 – 2", done: false });
  assert.deepEqual((await w.lines("Sporting")).map((f) => f.score), ["2 – 3", "2 – 3", "2 – 3"]);
  assert.ok(!w.asked.some((a) => a.method === "POST" && a.url.includes("/api/admin/fixtures") && w.asked.indexOf(a) > w.asked.length - 6), "looking sends nothing to the server");
});

test("correcting puts every line of the match right, and keeps what it was first recorded as", async () => {
  const w = await wrongResult();
  // It still works days later, when the match is out of the robot's own weekly look.
  w.clock.now = at("2026-12-03T12:00:00Z");
  const found = await w.correct("Sporting", { go: true });
  assert.equal(found.done, true);
  const lines = await w.lines("Sporting");
  assert.equal(lines.length, 3, "a football match is three lines: the result, goal goal and the exact score");
  for (const f of lines) {
    assert.deepEqual([f.state, f.score, f.resultByte], ["final", "2 – 2", 2 | (2 << 4)]);
    assert.deepEqual(f.corrected, { from: "2 – 3", at: w.clock.now });
  }
  // Anyone can see it was corrected: it is on the list Kickoff's server gives out.
  const open = await (await w.fetch(`${SERVER}/api/fixtures`)).json();
  assert.equal(open.fixtures.filter((f) => f.corrected?.from === "2 – 3").length, 3);
  // The other match is untouched, and the robot has nothing left to flag.
  assert.deepEqual((await w.lines("Sabah")).map((f) => [f.score, f.corrected]), [["1 – 4", undefined], ["1 – 4", undefined], ["1 – 4", undefined]]);
  w.clock.now = at("2026-11-25T23:10:00Z");
  assert.deepEqual((await w.robot()).problems, []);
  // There is nothing to correct a second time.
  await assert.rejects(w.correct("Sporting", { go: true }), /The feed does not disagree with what Kickoff has/);
});

test("a match first listed as one prediction is corrected the same way", async () => {
  // Kickoff's first football matches were one line each. The wrong result on the live list was one of them.
  const w = world();
  const feed = await fetchWeek({ keys: KEYS, from: "2026-11-25", to: "2026-11-25", fetch: w.fetch });
  const single = (await withIds(LEAGUE, feed.matches.filter((m) => m.label.includes("Sporting"))))[0];
  await w.kickoff.putFixtures({ fixtures: [{ ...single, state: "final", score: "2 – 3", resultByte: 2 | (3 << 4) }] });
  w.clock.now = at("2026-11-27T13:00:00Z");
  w.cl = [finished("Sporting CP", "Man United", 2, 2)];
  assert.deepEqual([(await w.correct("Sporting CP v Man United")).recorded, (await w.correct("Sporting CP v Man United")).feed], ["final 2 – 3", "final 2 – 2"]);
  assert.equal((await w.correct("Sporting CP v Man United", { go: true })).done, true);
  const lines = await w.lines("Sporting");
  assert.deepEqual(lines.map((f) => [f.score, f.resultByte, f.corrected.from]), [["2 – 2", 2 | (2 << 4), "2 – 3"]]);
});

test("CHEAT: a match whose predictions were locked on X Layer cannot be corrected this way", async () => {
  const w = await wrongResult();
  const [line] = await w.lines("Sporting");
  await w.kickoff.putLocks({ locks: [{ match: line.id, state: "locked" }] });
  await assert.rejects(w.correct("Sporting", { go: true }), /were locked on X Layer, so points were worked out from its result .* That cannot be corrected here/);
  await assert.rejects(w.correct("Sporting"), /cannot be corrected here/);
  assert.deepEqual((await w.lines("Sporting")).map((f) => f.score), ["2 – 3", "2 – 3", "2 – 3"]);
});

test("CHEAT: nobody types a score in: it is corrected only to what the feed says, and only with Kickoff's key", async () => {
  const w = await wrongResult();
  // A match the feed agrees with has nothing to correct.
  await assert.rejects(w.correct("Sabah", { go: true }), /The feed does not disagree with what Kickoff has for Champions League: Sabah FK v Barça \(final 1 – 4\)/);
  // The wrong key, or none.
  await assert.rejects(w.correct("Sporting", { go: true, adminKey: "not-the-key-at-all-not-at-all" }), /refused the correction \(status 403\)/);
  await assert.rejects(w.correct("Sporting", { go: true, adminKey: "" }), /Kickoff's key is not set/);
  // The match has to be named, and to be one match.
  await assert.rejects(w.correct(""), /Say which match/);
  await assert.rejects(w.correct("v"), /Say which match/);
  await assert.rejects(w.correct("Arsenal v Chelsea"), /No finished match on Kickoff's list has "Arsenal v Chelsea" in its name/);
  await assert.rejects(w.correct("Champions League"), /More than one finished match has "Champions League" in its name/);
  // A feed that now gives no final score at all is not something to correct to.
  w.cl = [footballMatch(31, "2026-11-25T20:00:00Z", "POSTPONED", "Sporting CP", "Man United"), finished("Sabah FK", "Barça", 1, 4)];
  await assert.rejects(w.correct("Sporting", { go: true }), /The feed does not give a final score for Champions League: Sporting CP v Man United now/);
  assert.deepEqual((await w.lines("Sporting")).map((f) => f.score), ["2 – 3", "2 – 3", "2 – 3"]);
});
