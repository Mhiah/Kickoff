// The robot's first job, checked against the real server's code and stand-ins for the two feeds.
import { test } from "node:test";
import assert from "node:assert/strict";

import { FOOTBALL, GOAL_GOAL, RESULT, SCORE, newDeviceKey, signRequest } from "../../engine/src/index.js";
import { createHandler } from "../../server/src/http.js";
import { createKickoff } from "../../server/src/kickoff.js";
import { MemoryStore } from "../../server/src/store.js";
import { COMPETITIONS } from "../../web/data/sample.js";
import { matchIdOf } from "../../web/lib/picks.js";
import { CONFIRM_AFTER, holdResults, plan, withIds } from "../src/fixtures.js";
import { inWords, syncFixtures } from "../src/sync.js";

const LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
const SERVER = "https://kickoff.example";
const ADMIN = "the-robots-key-of-enough-length";
const KEYS = { football: "football-feed-key", basketball: "basketball-feed-key" };
const NOW = Date.UTC(2026, 10, 24, 9, 0, 0) / 1000; // Tuesday 24 Nov 2026, 09:00 UTC
const at = (iso) => Date.parse(iso) / 1000;

const side = (shortName) => ({ id: shortName.length, name: `${shortName} FC`, shortName, tla: shortName.slice(0, 3).toUpperCase() });
/** A match as the football feed sends it. */
const footballMatch = (id, utcDate, status, home, away, score = {}) => ({
  id, utcDate, status, matchday: 13, stage: "REGULAR_SEASON", group: null, homeTeam: side(home), awayTeam: side(away),
  score: { winner: null, duration: "REGULAR", fullTime: { home: null, away: null }, halfTime: { home: null, away: null }, ...score },
});
const week = () => ({
  pl: [
    footballMatch(1, "2026-11-28T17:30:00Z", "TIMED", "Arsenal", "Chelsea"),
    footballMatch(2, "2026-11-29T14:00:00Z", "TIMED", "Man City", "Liverpool"),
  ],
  cl: [footballMatch(3, "2026-11-25T20:00:00Z", "TIMED", "Real Madrid", "Bayern")],
});

/** Kickoff's server, and the two feeds, as one web. */
function world(matches = week()) {
  const clock = { now: NOW };
  const kickoff = createKickoff({ store: new MemoryStore(), league: LEAGUE });
  const handle = createHandler({ kickoff, now: () => clock.now, adminKey: ADMIN });
  const w = { clock, kickoff, handle, matches, asked: [], down: [] };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url);
    w.asked.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? "" });
    const reply = (status, body) => new Response(JSON.stringify(body), { status });
    if (u.origin === SERVER) {
      const answer = await handle({ method: init.method ?? "GET", path: u.pathname, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
      return reply(answer.status, answer.body);
    }
    if (u.hostname === "api.football-data.org") {
      const comp = { PL: "pl", CL: "cl", PD: "ll", SA: "sa" }[u.pathname.split("/")[3]];
      if (w.down.includes(comp)) return reply(500, { message: "down" });
      return reply(200, { competition: { code: comp.toUpperCase() }, matches: w.matches[comp] ?? [] });
    }
    if (u.hostname === "api.balldontlie.io") {
      if (w.down.includes("basketball")) return reply(500, {});
      return reply(200, { data: [], meta: {} });
    }
    return reply(404, {});
  };
  // Most checks here are about the list itself, so a final score is acted on at once (pending: null).
  // The waiting has its own checks further down.
  w.run = (extra = {}) => syncFixtures({ server: SERVER, adminKey: ADMIN, keys: KEYS, now: clock.now, fetch: w.fetch, pending: null, ...extra });
  // A football match is three lines on the list (result, goal goal, exact score): one match here.
  w.listed = async () => [...new Set((await kickoff.fixtures()).map((f) => `${f.label} | ${f.state}${f.score ? ` ${f.score}` : ""}`))];
  w.sent = () => w.asked.filter((a) => a.url.startsWith(SERVER) && a.method === "POST");
  return w;
}

test("the first run puts the week's real matches on Kickoff's list", async () => {
  const w = world();
  const report = await w.run();
  assert.equal(report.ok, true);
  assert.deepEqual(report.fetched, { pl: 2, cl: 1, ll: 0, sa: 0, nba: 0, wnba: 0 });
  assert.deepEqual(report.added.sort(), ["Champions League: Real Madrid v Bayern", "Premier League: Arsenal v Chelsea", "Premier League: Man City v Liverpool"]);
  assert.deepEqual(await w.listed(), [
    "Champions League: Real Madrid v Bayern | scheduled",
    "Premier League: Arsenal v Chelsea | scheduled",
    "Premier League: Man City v Liverpool | scheduled",
  ]);
  assert.deepEqual(report.problems, []);
  // Each football match is there three times over: its result, goal goal and exact score.
  const listed = await w.kickoff.fixtures();
  assert.equal(listed.length, 9);
  assert.deepEqual(listed.filter((f) => f.home === "Arsenal").map((f) => f.sport).sort(), [RESULT, GOAL_GOAL, SCORE]);
  assert.equal(new Set(listed.map((f) => f.id)).size, 9);
});

test("each match gets exactly the id a phone works out for it, so the website will show it", async () => {
  const w = world();
  await w.run();
  for (const f of await w.kickoff.fixtures()) {
    assert.equal(f.id, await matchIdOf(LEAGUE, { comp: f.comp, home: f.home, away: f.away, kickoff: f.kickoff, sport: f.sport }, COMPETITIONS), f.label);
  }
  // And a phone can enter a pick for one of them straight away.
  const [first] = await w.kickoff.fixtures();
  const key = await newDeviceKey();
  const body = await signRequest({ ...key, method: "POST", path: "/api/picks", payload: { match: first.id, fingerprint: "cd".repeat(32) }, at: NOW });
  assert.equal((await w.handle({ method: "POST", path: "/api/picks", headers: {}, body })).status, 200);
});

test("run again with nothing new, it changes nothing and sends nothing", async () => {
  const w = world();
  await w.run();
  const before = w.sent().length;
  w.clock.now += 1800;
  const report = await w.run();
  assert.equal(report.unchanged, 3);
  assert.deepEqual([report.added, report.updated, report.calledOff], [[], [], []]);
  assert.equal(w.sent().length, before, "no update was sent to the server");
});

test("a finished match gets its score, and a postponed one is called off", async () => {
  const w = world();
  await w.run();
  w.clock.now = at("2026-11-25T22:30:00Z");
  w.matches.cl = [footballMatch(3, "2026-11-25T20:00:00Z", "FINISHED", "Real Madrid", "Bayern", { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } })];
  w.matches.pl[1] = footballMatch(2, "2026-11-29T14:00:00Z", "POSTPONED", "Man City", "Liverpool");
  const report = await w.run();
  assert.equal(report.ok, true);
  assert.deepEqual(report.updated.map((u) => `${u.label}: ${u.from} -> ${u.to}`).sort(), [
    "Champions League: Real Madrid v Bayern: scheduled -> final 2 – 1",
    "Premier League: Man City v Liverpool: scheduled -> void",
  ]);
  const listed = await w.kickoff.fixtures();
  const madrid = listed.find((f) => f.home === "Real Madrid");
  assert.equal(madrid.state, "final");
  assert.equal(madrid.resultByte, 18, "2-1, written the way the scoring circuit takes it");
  // Nobody can enter a pick for a match that is called off.
  const off = listed.find((f) => f.home === "Man City");
  const key = await newDeviceKey();
  const body = await signRequest({ ...key, method: "POST", path: "/api/picks", payload: { match: off.id, fingerprint: "cd".repeat(32) }, at: w.clock.now });
  assert.equal((await w.handle({ method: "POST", path: "/api/picks", headers: {}, body })).status, 409);
});

test("a match moved to another time becomes a new match, and the old one is called off", async () => {
  const w = world();
  await w.run();
  const before = (await w.kickoff.fixtures()).find((f) => f.home === "Arsenal" && f.sport === SCORE);
  w.matches.pl[0] = footballMatch(1, "2026-11-29T16:30:00Z", "TIMED", "Arsenal", "Chelsea"); // moved to Sunday
  const report = await w.run();
  assert.deepEqual(report.added, ["Premier League: Arsenal v Chelsea"]);
  assert.deepEqual(report.calledOff, ["Premier League: Arsenal v Chelsea"]);
  assert.equal((await w.kickoff.fixtures()).filter((f) => f.home === "Arsenal").length, 6, "three predictions at the old time, three at the new");
  const both = (await w.kickoff.fixtures()).filter((f) => f.home === "Arsenal" && f.sport === SCORE);
  assert.equal(both.length, 2);
  const old = both.find((f) => f.id === before.id);
  const moved = both.find((f) => f.id !== before.id);
  assert.equal(old.state, "void");
  assert.equal(old.note, "moved to another time");
  assert.equal(old.kickoff, before.kickoff, "the old match's facts are untouched");
  assert.equal(moved.state, "scheduled");
  assert.equal(moved.kickoff, at("2026-11-29T16:30:00Z"));
  // Run again: nothing more to do.
  const again = await w.run();
  assert.deepEqual([again.added, again.calledOff], [[], []]);
});

test("a match that has already started is not put on the list for the first time", async () => {
  const w = world({ pl: [footballMatch(9, "2026-11-24T08:00:00Z", "IN_PLAY", "Spurs", "Newcastle"), footballMatch(1, "2026-11-28T17:30:00Z", "TIMED", "Arsenal", "Chelsea")], cl: [] });
  const report = await w.run();
  assert.deepEqual(report.added, ["Premier League: Arsenal v Chelsea"]);
  assert.deepEqual(await w.listed(), ["Premier League: Arsenal v Chelsea | scheduled"]);
});

test("a feed that goes back on a finished result is flagged, not obeyed", async () => {
  const w = world();
  await w.run();
  w.clock.now = at("2026-11-25T22:30:00Z");
  w.matches.cl = [footballMatch(3, "2026-11-25T20:00:00Z", "FINISHED", "Real Madrid", "Bayern", { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } })];
  await w.run();
  w.matches.cl = [footballMatch(3, "2026-11-25T20:00:00Z", "FINISHED", "Real Madrid", "Bayern", { winner: "AWAY_TEAM", fullTime: { home: 2, away: 3 } })];
  const report = await w.run();
  assert.match(report.problems.join("\n"), /Real Madrid v Bayern: the feed now says "final 2 – 3" for a match already finished as "final 2 – 1"\. Left as it was\./);
  assert.equal((await w.kickoff.fixtures()).find((f) => f.home === "Real Madrid").score, "2 – 1");
});

test("one feed failing does not stop the others, and what it could not fetch is left alone", async () => {
  const w = world();
  await w.run();
  w.down = ["pl"];
  w.matches.cl.push(footballMatch(4, "2026-11-26T20:00:00Z", "TIMED", "Inter", "Barcelona"));
  const report = await w.run();
  assert.equal(report.ok, true);
  assert.equal(report.fetched.pl, null);
  assert.deepEqual(report.added, ["Champions League: Inter v Barcelona"]);
  assert.match(report.problems.join("\n"), /Premier League: could not be fetched/);
  assert.equal((await w.listed()).filter((l) => l.startsWith("Premier League")).length, 2, "the Premier League matches are still there, untouched");
  // With every feed down the run is marked as failed, and still nothing is removed.
  w.down = ["pl", "cl", "ll", "sa", "basketball"];
  const none = await w.run();
  assert.equal(none.ok, false);
  assert.equal((await w.listed()).length, 4);
});

test("a dry run reports what would change and changes nothing", async () => {
  const w = world();
  const report = await w.run({ dryRun: true, adminKey: "" });
  assert.equal(report.added.length, 3);
  assert.deepEqual(await w.listed(), []);
  assert.equal(w.sent().length, 0);
  assert.match(inWords(report), /a dry run: nothing was changed/);
});

test("with the wrong key the server refuses, and the report says so without showing any key", async () => {
  const w = world();
  const report = await w.run({ adminKey: "a-wrong-key-of-enough-length" });
  assert.equal(report.ok, false);
  assert.match(report.problems.join("\n"), /refused an update \(status 403\): This address is for Kickoff's robot only\./);
  assert.deepEqual(await w.listed(), []);
  const words = inWords(report) + JSON.stringify(report);
  for (const secret of ["a-wrong-key-of-enough-length", ADMIN, KEYS.football, KEYS.basketball]) assert.ok(!words.includes(secret));
});

test("each key goes only where it belongs, in a header, and never into an address", async () => {
  const w = world();
  await w.run();
  for (const a of w.asked) {
    const host = new URL(a.url).hostname;
    const everything = a.url + JSON.stringify(a.headers) + a.body;
    for (const secret of [ADMIN, KEYS.football, KEYS.basketball]) assert.ok(!a.url.includes(secret) && !a.body.includes(secret), `a key is in an address or a body sent to ${host}`);
    if (host === "kickoff.example") assert.ok(!everything.includes(KEYS.football) && !everything.includes(KEYS.basketball), "a feed's key went to Kickoff's server");
    if (host === "api.football-data.org") assert.ok(!everything.includes(ADMIN) && !everything.includes(KEYS.basketball), "the wrong key went to the football feed");
    if (host === "api.balldontlie.io") assert.ok(!everything.includes(ADMIN) && !everything.includes(KEYS.football), "the wrong key went to the basketball feed");
  }
  assert.ok(w.asked.some((a) => new URL(a.url).hostname === "kickoff.example" && a.headers["x-kickoff-admin"] === ADMIN));
});

test("if Kickoff's server is down, the run stops before touching anything and says so", async () => {
  const w = world();
  const real = w.fetch;
  w.fetch = async (url, init) => (url.startsWith(SERVER) ? Promise.reject(new TypeError("fetch failed")) : real(url, init));
  const report = await w.run();
  assert.equal(report.ok, false);
  assert.match(report.problems[0], /Kickoff's server did not give its list of matches/);
});

test("the plan is worked out without any web request, from the feed and the list alone", async () => {
  const feed = [{ feedId: "football-data:1", comp: "pl", sport: FOOTBALL, home: "Arsenal", away: "Chelsea", kickoff: NOW + 86400, label: "Premier League: Arsenal v Chelsea", state: "scheduled" }];
  const first = await plan({ league: LEAGUE, feed, listed: [], now: NOW });
  assert.equal(first.put.length, 3);
  assert.deepEqual(first.put.map((f) => f.sport), [RESULT, GOAL_GOAL, SCORE]);
  assert.deepEqual(first.added, ["Premier League: Arsenal v Chelsea"]);
  assert.match(first.put[0].id, /^[0-9a-f]{64}$/);
  const second = await plan({ league: LEAGUE, feed, listed: first.put, now: NOW });
  assert.deepEqual([second.put.length, second.unchanged], [0, 1]);
});

test("a football match listed the older way, as one prediction, is replaced by the three while it is still open", async () => {
  const facts = { feedId: "football-data:1", comp: "pl", home: "Arsenal", away: "Chelsea", kickoff: NOW + 86400, label: "Premier League: Arsenal v Chelsea", state: "scheduled" };
  const [old] = await withIds(LEAGUE, [{ ...facts, sport: FOOTBALL }]);
  const changes = await plan({ league: LEAGUE, feed: [{ ...facts, sport: FOOTBALL }], listed: [old], now: NOW });
  assert.deepEqual(changes.put.map((f) => `${f.sport} ${f.state}`), [`${RESULT} scheduled`, `${GOAL_GOAL} scheduled`, `${SCORE} scheduled`, `${FOOTBALL} void`]);
  assert.equal(changes.put[3].id, old.id);
  assert.equal(changes.put[3].note, "now three predictions");
  assert.deepEqual(changes.replaced, ["Premier League: Arsenal v Chelsea"]);
  // Once that is done there is nothing more to do.
  const again = await plan({ league: LEAGUE, feed: [{ ...facts, sport: FOOTBALL }], listed: changes.put, now: NOW });
  assert.deepEqual([again.put.length, again.unchanged, again.replaced], [0, 1, []]);
});

test("a football match listed the older way that has closed or finished plays out as it was", async () => {
  const facts = { feedId: "football-data:1", comp: "pl", home: "Arsenal", away: "Chelsea", kickoff: NOW + 300, label: "Premier League: Arsenal v Chelsea", state: "scheduled" };
  const [old] = await withIds(LEAGUE, [{ ...facts, sport: FOOTBALL }]);
  // Predictions closed five minutes ago: people may have predicted it the old way, so it stays.
  const closed = await plan({ league: LEAGUE, feed: [{ ...facts, sport: FOOTBALL }], listed: [old], now: NOW });
  assert.deepEqual([closed.put.length, closed.unchanged, closed.replaced], [0, 1, []]);
  // It finishes, and its result goes on the one old line.
  const done = { ...facts, sport: FOOTBALL, state: "final", score: "2 – 1", result: { home: 2, away: 1 }, resultByte: 18 };
  const finished = await plan({ league: LEAGUE, feed: [done], listed: [old], now: NOW + 3 * 3600 });
  assert.deepEqual(finished.put.map((f) => `${f.sport} ${f.state} ${f.resultByte}`), [`${FOOTBALL} final 18`]);
  // And long after, it is still one finished match, not three new ones.
  const later = await plan({ league: LEAGUE, feed: [done], listed: finished.put, now: NOW + 86400 });
  assert.deepEqual([later.put.length, later.unchanged], [0, 1]);
});

test("the three predictions of a football match all get the same result", async () => {
  const w = world();
  await w.run();
  w.clock.now = at("2026-11-25T22:30:00Z");
  w.matches.cl = [footballMatch(3, "2026-11-25T20:00:00Z", "FINISHED", "Real Madrid", "Bayern", { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } })];
  await w.run();
  const three = (await w.kickoff.fixtures()).filter((f) => f.home === "Real Madrid");
  assert.deepEqual(three.map((f) => `${f.sport} ${f.state} ${f.score} ${f.resultByte}`).sort(), [`${RESULT} final 2 – 1 18`, `${GOAL_GOAL} final 2 – 1 18`, `${SCORE} final 2 – 1 18`]);
});

test("a final score is not recorded until the feed has said it twice, five minutes apart", async () => {
  const w = world();
  await w.run();
  const pending = new Map();
  const real = () => w.kickoff.fixtures().then((all) => all.filter((f) => f.home === "Real Madrid").map((f) => `${f.state} ${f.score ?? ""}`.trim()));

  // The feed says it finished 2 – 3. That is only noted: on Kickoff the match is still being played.
  w.clock.now = at("2026-11-25T22:10:00Z");
  w.matches.cl = [footballMatch(3, "2026-11-25T20:00:00Z", "FINISHED", "Real Madrid", "Bayern", { winner: "AWAY_TEAM", fullTime: { home: 2, away: 3 } })];
  const first = await w.run({ pending });
  assert.deepEqual(first.waiting.map((x) => `${x.label} ${x.score}`), ["Champions League: Real Madrid v Bayern 2 – 3"]);
  assert.equal(first.lookAgainAt, w.clock.now + CONFIRM_AFTER);
  assert.deepEqual(await real(), ["live", "live", "live"]);
  assert.match(inWords(first), /… Champions League: Real Madrid v Bayern: the feed says it finished 2 – 3\. Not recorded until the feed says so again\./);

  // Four minutes on it is too soon to believe it, even though the feed says the same.
  w.clock.now += 240;
  assert.equal((await w.run({ pending })).waiting.length, 1);
  assert.deepEqual(await real(), ["live", "live", "live"]);

  // Then the feed corrects itself to 2 – 2. The wait starts again, from now, with the new score.
  w.clock.now += 60;
  w.matches.cl = [footballMatch(3, "2026-11-25T20:00:00Z", "FINISHED", "Real Madrid", "Bayern", { winner: "DRAW", fullTime: { home: 2, away: 2 } })];
  const corrected = await w.run({ pending });
  assert.deepEqual(corrected.waiting.map((x) => `${x.score} was ${x.changedFrom}`), ["2 – 2 was 2 – 3"]);
  assert.equal(corrected.lookAgainAt, w.clock.now + CONFIRM_AFTER);
  assert.deepEqual(await real(), ["live", "live", "live"]);

  // Five minutes later the feed still says 2 – 2. Now it is recorded, for all three predictions.
  w.clock.now += CONFIRM_AFTER;
  const settled = await w.run({ pending });
  assert.deepEqual([settled.waiting, settled.lookAgainAt, settled.problems], [[], null, []]);
  assert.deepEqual(await real(), ["final 2 – 2", "final 2 – 2", "final 2 – 2"]);
  assert.equal(pending.size, 0);

  // After that it is a finished match like any other: nothing is waited for and nothing is sent.
  w.clock.now += 1800;
  const later = await w.run({ pending });
  assert.deepEqual([later.waiting.length, later.updated.length], [0, 0]);
});

test("a round with no memory of its own never records a final score, and a match called off is not waited for", async () => {
  const w = world();
  await w.run();
  w.clock.now = at("2026-11-25T22:30:00Z");
  w.matches.cl = [footballMatch(3, "2026-11-25T20:00:00Z", "FINISHED", "Real Madrid", "Bayern", { winner: "HOME_TEAM", fullTime: { home: 2, away: 1 } })];
  w.matches.pl[1] = footballMatch(2, "2026-11-29T14:00:00Z", "POSTPONED", "Man City", "Liverpool");
  for (let i = 0; i < 3; i++) {
    const report = await syncFixtures({ server: SERVER, adminKey: ADMIN, keys: KEYS, now: w.clock.now, fetch: w.fetch });
    assert.equal(report.waiting.length, 1, "each such round only starts the wait");
    w.clock.now += 600;
  }
  const listed = await w.kickoff.fixtures();
  assert.ok(listed.filter((f) => f.home === "Real Madrid").every((f) => f.state === "live"));
  assert.ok(listed.filter((f) => f.home === "Man City").every((f) => f.state === "void"), "a postponement is acted on at once");
});

test("holding a score: only an unfinished match is held, and what is passed on carries no score", () => {
  const feed = [
    { feedId: "a", label: "A", state: "final", score: "1 – 0", result: { home: 1, away: 0 }, resultByte: 1 },
    { feedId: "b", label: "B", state: "final", score: "0 – 0", result: { home: 0, away: 0 }, resultByte: 0 },
    { feedId: "c", label: "C", state: "void" },
    { feedId: "d", label: "D", state: "scheduled" },
  ];
  // B is already finished on the list, as one of a football match's three predictions.
  const listed = [{ feedId: "b:score", state: "final" }, { feedId: "a:result", state: "live" }];
  const pending = new Map([["d", { resultByte: 5, score: "5 – 0", since: 0 }]]);
  const out = holdResults({ feed, listed, pending, now: 1000 });
  assert.deepEqual(out.feed[0], { feedId: "a", label: "A", state: "live" });
  assert.deepEqual(out.feed.slice(1), feed.slice(1));
  assert.deepEqual(out.waiting, [{ label: "A", score: "1 – 0", since: 1000, changedFrom: undefined }]);
  assert.equal(out.lookAgainAt, 1000 + CONFIRM_AFTER);
  assert.deepEqual([...pending.keys()], ["a"], "a match the feed no longer calls finished is forgotten");
  // The same again five minutes on: passed through whole.
  assert.deepEqual(holdResults({ feed, listed, pending, now: 1000 + CONFIRM_AFTER }).feed[0], feed[0]);
});

test("the report reads plainly", async () => {
  const w = world();
  const words = inWords(await w.run());
  assert.match(words, /Matches from 2026-11-22 to 2026-12-01/);
  assert.match(words, /Premier League: 2 in the feed/);
  assert.match(words, /Added: 3\. Updated: 0\. Called off: 0\. Unchanged: 0\./);
  assert.match(words, /\+ Premier League: Arsenal v Chelsea/);
});

test("La Liga and Serie A come in like the rest of the football: three predictions a match, with their own names", async () => {
  const w = world({
    ...week(),
    ll: [footballMatch(21, "2026-11-29T20:00:00Z", "TIMED", "Real Madrid", "Barça")],
    sa: [footballMatch(22, "2026-11-28T19:45:00Z", "TIMED", "Inter", "Juventus")],
  });
  const report = await w.run();
  assert.equal(report.ok, true);
  assert.deepEqual(report.fetched, { pl: 2, cl: 1, ll: 1, sa: 1, nba: 0, wnba: 0 });
  assert.ok(report.added.includes("La Liga: Real Madrid v Barça") && report.added.includes("Serie A: Inter v Juventus"));
  const listed = await w.kickoff.fixtures();
  for (const [comp, label] of [["ll", "La Liga: Real Madrid v Barça"], ["sa", "Serie A: Inter v Juventus"]]) {
    const three = listed.filter((f) => f.label === label);
    assert.deepEqual(three.map((f) => f.comp), [comp, comp, comp]);
    assert.deepEqual(three.map((f) => f.sport).sort(), [RESULT, GOAL_GOAL, SCORE].sort());
  }
  // The feed is asked for them by its own codes.
  assert.ok(w.asked.some((a) => a.url.includes("/competitions/PD/matches")) && w.asked.some((a) => a.url.includes("/competitions/SA/matches")));
  assert.match(inWords(report), /La Liga: 1 in the feed\n\s*Serie A: 1 in the feed/);
});
