import { test } from "node:test";
import assert from "node:assert/strict";

import { BASKETBALL, FOOTBALL, decodePick, loadCircuits, matchId, scorePick } from "../../engine/src/index.js";
import { readFileSync } from "node:fs";
import { COMPETITIONS, basketballGame, basketballGames, day, fetchWeek, footballMatch, footballMatches } from "../src/index.js";
import { championsLeague, fakeWeb, nbaFromTheDocs, nbaPages, premierLeague, wnbaFromTheDocs } from "./examples.js";

const byId = (list, id) => list.find((m) => m.feedId.endsWith(String(id)));
const KEYS = { football: "football-key", basketball: "basketball-key" };
const nbaAnswer = (url) => (url.includes("cursor=") ? nbaPages[1] : nbaPages[0]);
const web = () =>
  fakeWeb([
    ["/competitions/PL/matches", premierLeague],
    ["/competitions/CL/matches", championsLeague],
    ["/wnba/v1/games", wnbaFromTheDocs],
    ["/v1/games", nbaAnswer],
  ]);

// ---- football

test("a football match that has not started comes through with its sides, start time and label", async () => {
  const { fetch } = web();
  const { matches } = await footballMatches({ key: "k", comp: "pl", from: "2026-11-21", to: "2026-11-30", fetch });
  const m = byId(matches, 538002);
  assert.deepEqual(m, {
    feedId: "football-data:538002", comp: "pl", sport: FOOTBALL, home: "Arsenal", away: "Chelsea",
    kickoff: Date.UTC(2026, 10, 28, 17, 30) / 1000, label: "Premier League: Arsenal v Chelsea", state: "scheduled",
  });
  assert.equal(byId(matches, 538003).state, "scheduled", "a match with only a rough date is still a fixture");
});

test("a finished football match gives the score, and the result as the scoring circuit takes it", async () => {
  const { fetch } = web();
  const { matches } = await footballMatches({ key: "k", comp: "pl", from: "2026-11-21", to: "2026-11-30", fetch });
  const m = byId(matches, 538001);
  assert.equal(m.state, "final");
  assert.equal(m.score, "2 – 1");
  assert.deepEqual(m.result, { home: 2, away: 1 });
  assert.equal(m.resultByte, 18);
  assert.deepEqual(decodePick(FOOTBALL, m.resultByte), { home: 2, away: 1 });
});

test("a match that went to extra time is scored on the 90 minutes, not the 120", async () => {
  const { fetch } = web();
  const { matches } = await footballMatches({ key: "k", comp: "cl", from: "2026-11-21", to: "2026-11-30", fetch });
  const m = byId(matches, 551002);
  assert.deepEqual(m.result, { home: 2, away: 2 }, "2 – 2 after 90 minutes, though it ended 3 – 2");
  assert.match(m.score, /2 – 2 after 90 minutes \(it went to extra time\)/);
});

test("a match that went to penalties is scored on the 90 minutes (the documentation's own example)", async () => {
  const { fetch } = web();
  const { matches } = await footballMatches({ key: "k", comp: "cl", from: "2026-11-21", to: "2026-11-30", fetch });
  const m = byId(matches, 551003);
  assert.deepEqual(m.result, { home: 1, away: 1 }, "1 – 1 after 90 minutes, though the feed's full-time line reads 7 – 6");
  assert.match(m.score, /it went to penalties/);
});

test("extra time with no 90-minute score is not guessed at", async () => {
  const { fetch } = web();
  const { matches } = await footballMatches({ key: "k", comp: "cl", from: "2026-11-21", to: "2026-11-30", fetch });
  const m = byId(matches, 551004);
  assert.equal(m.state, "unknown");
  assert.match(m.note, /did not give the 90-minute score/);
  assert.equal(m.result, undefined);
  assert.equal(m.resultByte, undefined);
});

test("postponed, called-off and awarded matches are void; a suspended one waits", async () => {
  const { fetch } = web();
  const { matches } = await footballMatches({ key: "k", comp: "pl", from: "2026-11-21", to: "2026-11-30", fetch });
  assert.deepEqual([538005, 538006, 538008].map((id) => [byId(matches, id).state, byId(matches, id).note]), [
    ["void", "Postponed"], ["void", "Called off"], ["void", "The result was awarded, not played out"],
  ]);
  assert.equal(byId(matches, 538008).result, undefined, "an awarded 3 – 0 is not a result anybody scores on");
  assert.equal(byId(matches, 538007).state, "live");
  assert.match(byId(matches, 538007).note, /Stopped part way/);
  assert.equal(byId(matches, 538004).state, "live");
  assert.equal(byId(matches, 538004).result, undefined, "a running score is not a result");
});

test("a side that scores more than 15 is recorded as 15", async () => {
  const { fetch } = web();
  const { matches } = await footballMatches({ key: "k", comp: "pl", from: "2026-11-21", to: "2026-11-30", fetch });
  const m = byId(matches, 538009);
  assert.equal(m.score, "17 – 0");
  assert.deepEqual(m.result, { home: 15, away: 0 });
});

test("odd things from the football feed are reported, never guessed", () => {
  const good = premierLeague.matches[1];
  assert.match(footballMatch("pl", { ...good, id: undefined }).problem, /no id/);
  assert.match(footballMatch("pl", { ...good, utcDate: "soon" }).problem, /no start time/);
  assert.match(footballMatch("pl", { ...good, awayTeam: { id: 1 } }).problem, /did not name both sides/);
  assert.match(footballMatch("pl", { ...good, homeTeam: { shortName: 'The "Reds"' } }).problem, /characters that are not allowed/);
  assert.match(footballMatch("pl", { ...good, homeTeam: { shortName: "A".repeat(90) } }).problem, /longer than 80 bytes/);
  const strange = footballMatch("pl", { ...good, status: "TELEPORTED" }).match;
  assert.equal(strange.state, "unknown");
  const noScore = footballMatch("pl", { ...good, status: "FINISHED" }).match;
  assert.equal(noScore.state, "unknown");
  assert.match(noScore.note, /gave no score/);
  // A team with no short name falls back to its full name.
  assert.equal(footballMatch("pl", { ...good, homeTeam: { name: "Arsenal FC" } }).match.home, "Arsenal FC");
});

test("the football request goes to the right place, with the key only in the header", async () => {
  const { fetch, asked } = web();
  await footballMatches({ key: "secret-key", comp: "cl", from: "2026-11-23", to: "2026-11-30", fetch });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, "https://api.football-data.org/v4/competitions/CL/matches?dateFrom=2026-11-23&dateTo=2026-11-30");
  assert.equal(asked[0].headers["X-Auth-Token"], "secret-key");
  assert.ok(!asked[0].url.includes("secret-key"));
});

test("a refusal from the football feed says why", async () => {
  for (const [status, why] of [[401, /key was refused/], [403, /not in the plan/], [429, /too many requests/], [500, /answered 500/]]) {
    const { fetch } = fakeWeb([["/competitions/", status]]);
    await assert.rejects(footballMatches({ key: "k", comp: "pl", from: "2026-11-23", to: "2026-11-30", fetch }), why);
  }
  const { fetch } = fakeWeb([["/competitions/", { message: "something else" }]]);
  await assert.rejects(footballMatches({ key: "k", comp: "pl", from: "2026-11-23", to: "2026-11-30", fetch }), /no list of matches/);
});

// ---- basketball

test("the NBA example from the documentation reads as a home win by 10", () => {
  const { match } = basketballGame("nba", nbaFromTheDocs);
  assert.equal(match.feedId, "balldontlie:nba:15907925");
  assert.equal(match.label, "NBA: Cavaliers v Hornets");
  assert.equal(match.kickoff, Date.UTC(2025, 0, 5, 23, 0) / 1000);
  assert.equal(match.state, "final");
  assert.equal(match.score, "115 – 105");
  assert.deepEqual(match.result, { winner: "home", band: "B" });
  assert.deepEqual(decodePick(BASKETBALL, match.resultByte), { winner: "home", band: "B" });
});

test("the WNBA example from the documentation reads as a home win by 13, though it names things differently", async () => {
  const { fetch } = web();
  const { matches } = await basketballGames({ key: "k", comp: "wnba", from: "2025-10-05", to: "2025-10-05", fetch });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].label, "WNBA: Aces v Mercury");
  assert.equal(matches[0].kickoff, Date.UTC(2025, 9, 5, 19, 0) / 1000);
  assert.equal(matches[0].score, "91 – 78");
  assert.deepEqual(matches[0].result, { winner: "home", band: "C" });
});

test("NBA games come from every page, kept by their real start time", async () => {
  const { fetch, asked } = web();
  const { matches, problems } = await basketballGames({ key: "secret-key", comp: "nba", from: "2026-11-22", to: "2026-11-30", fetch });
  assert.equal(asked.length, 2, "two pages");
  assert.match(asked[0].url, /^https:\/\/api\.balldontlie\.io\/v1\/games\?start_date=2026-11-21&end_date=2026-11-30&per_page=100$/);
  assert.match(asked[1].url, /&cursor=18000004$/);
  assert.ok(asked.every((a) => a.headers.Authorization === "secret-key" && !a.url.includes("secret-key")));
  assert.equal(byId(matches, 18000012), undefined, "a game before the first day asked for is left out");
  assert.equal(byId(matches, 18000011), undefined);
  assert.deepEqual(problems, ["balldontlie:nba:18000011 (Celtics v Bucks): the feed gave no start time"]);
  assert.equal(matches.length, 10);
});

test("basketball results: the margin band, overtime included", async () => {
  const { fetch } = web();
  const { matches } = await basketballGames({ key: "k", comp: "nba", from: "2026-11-22", to: "2026-11-30", fetch });
  assert.deepEqual(byId(matches, 18000001).result, { winner: "home", band: "B" }, "104 – 97 is the home side by 7");
  assert.deepEqual(byId(matches, 18000002).result, { winner: "home", band: "A" }, "121 – 118 after overtime is the home side by 3");
  const bands = [[100, 99, "home", "A"], [100, 95, "home", "A"], [94, 100, "away", "B"], [90, 100, "away", "B"], [111, 100, "home", "C"], [100, 115, "away", "C"], [116, 100, "home", "D"], [80, 130, "away", "D"]];
  for (const [home, away, winner, band] of bands) {
    const { match } = basketballGame("nba", { ...nbaFromTheDocs, home_team_score: home, visitor_team_score: away });
    assert.deepEqual(match.result, { winner, band }, `${home} – ${away}`);
  }
});

test("basketball: postponed, called-off and held-up games, and things the feed cannot be sure of", async () => {
  const { fetch } = web();
  const { matches } = await basketballGames({ key: "k", comp: "nba", from: "2026-11-22", to: "2026-11-30", fetch });
  assert.deepEqual([byId(matches, 18000006).state, byId(matches, 18000006).note], ["void", "Postponed"]);
  assert.deepEqual([byId(matches, 18000007).state, byId(matches, 18000007).note], ["void", "Called off"]);
  assert.equal(byId(matches, 18000005).state, "live");
  assert.equal(byId(matches, 18000008).state, "live");
  assert.match(byId(matches, 18000008).note, /Held up/);
  assert.equal(byId(matches, 18000009).state, "unknown");
  assert.match(byId(matches, 18000009).note, /finished level at 99/);
  assert.equal(byId(matches, 18000010).state, "unknown");
  assert.equal(byId(matches, 18000003).state, "scheduled");
  // A game marked postponed is void even if its other status has not caught up.
  assert.equal(basketballGame("nba", { ...nbaFromTheDocs, postponed: true }).match.state, "void");
});

test("an endless run of pages is cut off and reported", async () => {
  const { fetch } = fakeWeb([["/v1/games", { data: [], meta: { next_cursor: 1 } }]]);
  const { problems } = await basketballGames({ key: "k", comp: "nba", from: "2026-11-22", to: "2026-11-30", fetch });
  assert.match(problems[0], /cut short/);
});

// ---- the whole week

test("the week brings all four competitions together, soonest first", async () => {
  const { fetch, asked } = web();
  const week = await fetchWeek({ keys: KEYS, from: "2026-11-21", to: "2026-11-30", fetch });
  assert.deepEqual(week.fetched, { pl: 9, cl: 4, nba: 10, wnba: 0 });
  assert.equal(week.matches.length, 23);
  assert.deepEqual(week.matches.map((m) => m.kickoff), [...week.matches.map((m) => m.kickoff)].sort((a, b) => a - b));
  assert.equal(asked.filter((a) => a.url.includes("football-data")).every((a) => a.headers["X-Auth-Token"] === "football-key"), true);
  assert.equal(asked.filter((a) => a.url.includes("balldontlie")).every((a) => a.headers.Authorization === "basketball-key"), true);
  assert.equal(week.problems.length, 1);
});

test("one feed failing does not stop the other, and is never hidden", async () => {
  const { fetch } = fakeWeb([["/competitions/PL/matches", premierLeague], ["/competitions/CL/matches", 403], ["/wnba/v1/games", wnbaFromTheDocs], ["/v1/games", 429]]);
  const week = await fetchWeek({ keys: KEYS, from: "2026-11-21", to: "2026-11-30", fetch });
  assert.deepEqual(week.fetched, { pl: 9, cl: null, nba: null, wnba: 0 });
  assert.ok(week.problems.some((p) => /Champions League: could not be fetched .*not in the plan/.test(p)));
  assert.ok(week.problems.some((p) => /NBA: could not be fetched .*too many requests/.test(p)));
});

test("a missing key skips that feed and says so, without asking the feed anything", async () => {
  const { fetch, asked } = web();
  const week = await fetchWeek({ keys: { football: "football-key" }, from: "2026-11-21", to: "2026-11-30", fetch });
  assert.deepEqual(week.fetched, { pl: 9, cl: 4, nba: null, wnba: null });
  assert.ok(asked.every((a) => a.url.includes("football-data")));
  assert.equal(week.problems.filter((p) => /no key was given for the basketball feed/.test(p)).length, 2);
});

// ---- joined up with the engine

test("a feed result goes straight into the scoring circuits", async () => {
  const dir = new URL("../../circuits/out/", import.meta.url);
  const circuits = loadCircuits(Object.fromEntries(["football", "basketball", "tennis"].map((n) => [n, readFileSync(new URL(`${n}.hex`, dir), "utf8")])));
  const { fetch } = web();
  const week = await fetchWeek({ keys: KEYS, from: "2026-11-21", to: "2026-11-30", fetch });

  const city = byId(week.matches, 538001); // Man City 2 – 1 Liverpool
  const points = (pick) => scorePick({ circuits, sport: FOOTBALL, pickByte: pick.home | (pick.away << 4), result: city.result });
  assert.deepEqual([points({ home: 2, away: 1 }), points({ home: 1, away: 0 }), points({ home: 0, away: 0 })], [3, 1, 0]);

  const lakers = byId(week.matches, 18000001); // 104 – 97
  const hoops = (winner, band) => scorePick({ circuits, sport: BASKETBALL, pickByte: (winner === "away" ? 1 : 0) | ("ABCD".indexOf(band) << 1), result: lakers.result });
  assert.deepEqual([hoops("home", "B"), hoops("home", "A"), hoops("away", "B")], [3, 1, 0]);
});

test("every match from the feed can be given a Kickoff match id, and a moved match gets a new one", async () => {
  const league = `00000000${"00000000000000c4"}${"24ad6fe8a46a34fa9b0610959beaba8a2c6b6982"}`;
  const { fetch } = web();
  const week = await fetchWeek({ keys: KEYS, from: "2026-11-21", to: "2026-11-30", fetch });
  const ids = new Set();
  for (const m of week.matches) {
    const id = Buffer.from(await matchId(league, { sport: m.sport, kickoff: m.kickoff, bestOf: 0, label: m.label })).toString("hex");
    ids.add(id);
  }
  assert.equal(ids.size, week.matches.length, "no two matches share an id");
  const arsenal = byId(week.matches, 538002);
  const facts = { sport: arsenal.sport, bestOf: 0, label: arsenal.label };
  const before = await matchId(league, { ...facts, kickoff: arsenal.kickoff });
  const after = await matchId(league, { ...facts, kickoff: arsenal.kickoff + 3600 });
  assert.notDeepEqual(before, after);
  assert.equal(arsenal.feedId, "football-data:538002", "the feed's own id is what ties the two together");
});

test("days are written the way the feeds want them", () => {
  const now = Date.UTC(2026, 10, 23, 23, 30) / 1000;
  assert.equal(day(now), "2026-11-23");
  assert.equal(day(now, 7), "2026-11-30");
  assert.equal(day(now, 8), "2026-12-01");
  assert.deepEqual(Object.keys(COMPETITIONS), ["pl", "cl", "nba", "wnba"]);
});
