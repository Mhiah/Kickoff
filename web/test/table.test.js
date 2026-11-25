// The League and My record screens with real numbers. The phones here seal, send and open picks
// as the website does, and the server is the real server's code, so both sides are checked together.
import { test } from "node:test";
import assert from "node:assert/strict";

import { COMPETITIONS, SAMPLE_LEAGUE, sampleFixtures } from "../data/sample.js";
import { createDevice } from "../lib/device.js";
import { createFixtures } from "../lib/fixtures.js";
import { createGroups } from "../lib/groups.js";
import { createStore, seal } from "../lib/picks.js";
import { createClient } from "../lib/server.js";
import { syncPicks } from "../lib/sync.js";
import { EMPTY, createTable } from "../lib/table.js";
import { league, recordScreen } from "../screens.js";
import { FakeStorage, NOW } from "./helpers.js";

import { BASKETBALL, FOOTBALL, encodePick, matchId, toHex } from "../../engine/src/index.js";
import { createHandler } from "../../server/src/http.js";
import { CLOSES_BEFORE, SETTLE, createKickoff } from "../../server/src/kickoff.js";
import { MemoryStore } from "../../server/src/store.js";

const LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
const HOUR = 3600;
const KICKOFF = NOW + 24 * HOUR;

/** Kickoff's server with a football and a basketball match on its list. */
async function kickoffOnline() {
  const clock = { now: NOW };
  let n = 0;
  const kickoff = createKickoff({ store: new MemoryStore(), league: LEAGUE, random: () => 4821 + n++ });
  const handle = createHandler({ kickoff, now: () => clock.now });
  const net = { down: false };
  const fetch = async (url, init = {}) => {
    if (net.down) throw new TypeError("Failed to fetch");
    const answer = await handle({ method: init.method ?? "GET", path: url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  const facts = {
    football: { comp: "pl", sport: FOOTBALL, home: "Arsenal", away: "Chelsea", kickoff: KICKOFF, label: "Premier League: Arsenal v Chelsea" },
    basketball: { comp: "nba", sport: BASKETBALL, home: "Knicks", away: "Bucks", kickoff: KICKOFF + 6 * HOUR, label: "NBA: Knicks v Bucks" },
  };
  const f = {};
  for (const [name, x] of Object.entries(facts)) f[name] = { id: toHex(await matchId(LEAGUE, { sport: x.sport, kickoff: x.kickoff, bestOf: 0, label: x.label })), feedId: `test:${name}`, state: "scheduled", ...x };
  await kickoff.putFixtures({ fixtures: Object.values(f) });
  /** The robot records a result from the sports feed. */
  const result = (fixture, score, res) => kickoff.putFixtures({ fixtures: [{ ...fixture, state: "final", score, resultByte: encodePick(fixture.sport, res) }] });
  return { fetch, net, clock, kickoff, f, result };
}

/** A phone. `carry()` does what the website does every few seconds: matches, picks, then the tables. */
function phone(online) {
  const store = createStore(new FakeStorage());
  const device = createDevice(store);
  const client = createClient({ device, fetch: online.fetch, now: () => online.clock.now });
  const groups = createGroups({ store, device, client });
  const table = createTable({ store, client });
  const matches = createFixtures({ store, client, competitions: COMPETITIONS, sample: { league: SAMPLE_LEAGUE, fixtures: sampleFixtures } });
  const self = {
    groups, table,
    async ctx() {
      const v = await matches.view(online.clock.now);
      const mine = await groups.view();
      return { now: online.clock.now, ...v, picks: store.all(mine.player), lasting: store.lasting, editing: null, mine, standings: v.real ? table.view(mine.group?.code ?? null) : null };
    },
    async carry() {
      await matches.refresh();
      const c = await self.ctx();
      await syncPicks({ store, client, player: c.mine.player, league: c.league, fixtures: c.fixtures, now: c.now });
      return table.refresh(c.mine.group?.code ?? null);
    },
    async seal(fixture, chosen) {
      const c = await self.ctx();
      await seal({ store, league: c.league, fixture: c.fixtures[fixture.id], competitions: COMPETITIONS, pick: chosen, now: c.now, player: c.mine.player });
    },
    league: async () => league(null, await self.ctx()).html,
    record: async () => recordScreen(undefined, await self.ctx()).html,
  };
  return self;
}

/** The rows of a table on the screen, as "place name points". `which` is "everyone" or "group". */
function rowsOf(html, which) {
  const board = html.match(new RegExp(`data-board-of="${which}"[^>]*>(.*?)</div>\\s*(<div data-board-of|<h2>Played)`, "s"))?.[1] ?? "";
  return [...board.matchAll(/<tr class="(you)?"><td>(\d+)<\/td><td>([^<]+)(?:<span class="tag">you<\/span>)?<\/td><td>\d+<\/td><td>\d+<\/td><td class="pts">(\d+)<\/td>/g)].map((m) => `${m[2]} ${m[3]} ${m[4]}${m[1] ? " (you)" : ""}`);
}
const tile = (html, label) => html.match(new RegExp(`<small>${label}</small><b>([^<]*)</b><span>([^<]*)</span>`))?.slice(1, 3);

test("the first person on Kickoff is 1st, with no points, and nothing on the screen is made up", async () => {
  const online = await kickoffOnline();
  const mya = phone(online);
  await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl", "cl", "nba", "wnba"] });
  await mya.carry();
  const html = await mya.league();
  assert.deepEqual(rowsOf(html, "everyone"), ["1 mya 0 (you)"]);
  assert.deepEqual(rowsOf(html, "group"), ["1 mya 0 (you)"]);
  assert.deepEqual(tile(html, "Your place"), ["1st", "of 1 player"]);
  assert.deepEqual(tile(html, "Your points"), ["0", "0 spot on, 0 right winner"]);
  assert.deepEqual(tile(html, "Picked this week"), ["0 of 2", "pick as many as you like"]);
  assert.match(html, /Nothing played yet\./);
  assert.match(html, /<h1[^>]*>League<\/h1>/);
  for (const made of ["made up", "Funke", "Tunde", "Real Madrid", "Nothing here is live yet"]) assert.ok(!html.includes(made), `no "${made}"`);
  // Everyone opens first; My group is there to switch to.
  assert.match(html, /data-board="everyone" aria-pressed="true">Everyone<.*data-board="group" aria-pressed="false">My group</s);
  assert.match(html, /data-board-of="group"[^>]* hidden>/);
  // On a phone the matches and the table take turns, chosen at the top of the screen.
  assert.match(html, /class="chips parts phone-only"[^>]*><button type="button" data-part="matches" aria-pressed="true">Matches<\/button><button type="button" data-part="table" aria-pressed="false">Leaderboard</);
  assert.ok(html.indexOf('data-part="table"') < html.indexOf("This week"), "the switch comes before the list of matches");
  assert.match(html, /<div class="cols" data-show="matches">/);
  // What was chosen is kept when the screen is drawn again.
  const again = league(null, { ...(await mya.ctx()), looking: { part: "table", board: "group" } }).html;
  assert.match(again, /<div class="cols" data-show="table">/);
  assert.match(again, /data-part="table" aria-pressed="true"/);
  assert.match(again, /data-board="group" aria-pressed="true"/);
  assert.match(again, /data-board-of="everyone"[^>]* hidden>/);
});

test("before the server has answered, the League screen shows an empty table, not a made-up one", async () => {
  const online = await kickoffOnline();
  const mya = phone(online);
  await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl"] });
  // The matches are in, but the tables have not been asked for yet.
  const c = { ...(await mya.ctx()), real: true, standings: null };
  const html = league(null, c).html;
  assert.deepEqual(rowsOf(html, "everyone"), []);
  assert.match(html, /Nobody has played yet\./);
  assert.deepEqual(tile(html, "Your place"), ["–", "after your first pick"]);
  assert.ok(!html.includes("Funke") && !html.includes("made up"));
  assert.deepEqual(EMPTY.you, { place: null, points: 0, threes: 0, ones: 0, wrong: 0 });
});

test("whoever joins next is 2nd; whoever scores more goes above; My group is only the group", async () => {
  const online = await kickoffOnline();
  const [mya, jerkson, kemi] = [phone(online), phone(online), phone(online)];
  const group = await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl", "nba"] });
  online.clock.now += 60;
  await jerkson.groups.join({ code: group.code, playerName: "Jerkson" });
  online.clock.now += 60;
  await kemi.groups.start({ name: "Work lot", playerName: "Kemi", plays: ["pl"] });
  for (const p of [mya, jerkson, kemi]) await p.carry();
  let html = await jerkson.league();
  assert.deepEqual(rowsOf(html, "everyone"), ["1 mya 0", "2 Jerkson 0 (you)", "3 Kemi 0"]);
  assert.deepEqual(rowsOf(html, "group"), ["1 mya 0", "2 Jerkson 0 (you)"]);
  assert.deepEqual(tile(html, "Your place"), ["2nd", "of 3 players"]);

  // Arsenal v Chelsea: mya says 0–0, Jerkson 2–1, Kemi 1–0. It ends 2–1.
  await mya.seal(online.f.football, { home: 0, away: 0 });
  await jerkson.seal(online.f.football, { home: 2, away: 1 });
  await kemi.seal(online.f.football, { home: 1, away: 0 });
  for (const p of [mya, jerkson, kemi]) await p.carry(); // sent
  online.clock.now = KICKOFF - CLOSES_BEFORE + SETTLE;
  for (const p of [mya, jerkson, kemi]) await p.carry(); // locked
  online.clock.now = KICKOFF + 2 * HOUR;
  for (const p of [mya, jerkson, kemi]) await p.carry(); // opened
  await online.result(online.f.football, "2 – 1", { home: 2, away: 1 });
  for (const p of [mya, jerkson, kemi]) await p.carry();

  html = await mya.league();
  assert.deepEqual(rowsOf(html, "everyone"), ["1 Jerkson 3", "2 Kemi 1", "3 mya 0 (you)"]);
  assert.deepEqual(rowsOf(html, "group"), ["1 Jerkson 3", "2 mya 0 (you)"]);
  assert.deepEqual(tile(html, "Your place"), ["3rd", "of 3 players"]);
  assert.match(html, /<div class="title">Arsenal 2 – 1 Chelsea<\/div><div class="sub">You said 0 – 0<\/div><\/div><div class="points zero">0<\/div>/);
  html = await jerkson.league();
  assert.deepEqual(tile(html, "Your place"), ["1st", "of 3 players"]);
  assert.deepEqual(tile(html, "Your points"), ["3", "1 spot on, 0 right winner"]);
  assert.match(html, /You said 2 – 1<\/div><\/div><div class="points ">3<\/div>/);

  // My record says the same, in full.
  let record = await mya.record();
  assert.match(record, /mya's record/);
  assert.match(record, /<b>0<\/b><span class="word">Points<\/span>/);
  assert.ok(!record.includes("3rd of 3"), "the place is on the League screen, not here");
  const box = (html, label) => html.match(new RegExp(`<small>${label}</small><b>([^<]*)</b><span>([^<]*)</span>`))?.slice(1, 3);
  assert.deepEqual(box(record, "Total picks"), ["1", "0 to play"]);
  assert.deepEqual(box(record, "Total won"), ["0", "0 spot on"]);
  assert.deepEqual(box(record, "Win rate"), ["0%", "of 1 played"]);
  assert.ok(!record.includes("right winner") && !record.includes("no points"), "the old breakdown is gone");
  assert.match(record, /Arsenal 2 – 1 Chelsea/);
  assert.ok(!record.includes("made-up") && !record.includes("Bola"), "nothing made up on My record");
  record = await kemi.record();
  assert.deepEqual(box(record, "Total won"), ["1", "0 spot on"]);
  assert.deepEqual(box(record, "Win rate"), ["100%", "of 1 played"]);
  assert.match(record, /You said 1 – 0/);
  // Someone with nothing finished has no rate yet, and a pick still to play counts as a pick.
  const fresh = phone(online);
  await fresh.groups.start({ name: "Late lot", playerName: "Late", plays: ["nba"] });
  await fresh.carry();
  await fresh.seal(online.f.basketball, { winner: "home", band: "A" });
  await fresh.carry();
  record = await fresh.record();
  assert.deepEqual(box(record, "Total picks"), ["1", "1 to play"]);
  assert.deepEqual(box(record, "Win rate"), ["–", "of 0 played"]);
});

test("a name somebody already has is refused, in plain words, when starting or joining", async () => {
  const online = await kickoffOnline();
  const [mya, other] = [phone(online), phone(online)];
  const group = await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl"] });
  await assert.rejects(other.groups.join({ code: group.code, playerName: "MYA" }), /That name is taken\. Pick another\./);
  await assert.rejects(other.groups.start({ name: "Another", playerName: "Mya", plays: ["pl"] }), /That name is taken\. Pick another\./);
  assert.equal((await other.groups.view()).group, null);
  await other.groups.join({ code: group.code, playerName: "mya 2" });
});

test("the League screen lists only matches from competitions the group plays", async () => {
  const online = await kickoffOnline();
  const mya = phone(online);
  await mya.groups.start({ name: "Football only", playerName: "mya", plays: ["pl"] });
  await mya.carry();
  const html = await mya.league();
  assert.match(html, /Arsenal v Chelsea/);
  assert.ok(!html.includes("Knicks"));
  assert.deepEqual(tile(html, "Picked this week"), ["0 of 1", "pick as many as you like"]);
});

test("someone with no group sees the table of everyone, and is pointed to starting a group", async () => {
  const online = await kickoffOnline();
  const [mya, guest] = [phone(online), phone(online)];
  await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl"] });
  await guest.carry();
  const html = await guest.league();
  assert.deepEqual(rowsOf(html, "everyone"), ["1 mya 0"]);
  assert.deepEqual(tile(html, "Your place"), ["–", "after your first pick"]);
  assert.match(html, /You are not in a group yet\. <a class="link" href="#\/group">Start or join one<\/a>\./);
  assert.match(html, /href="#\/group">Start a group</);
});

test("offline, the tables are what the phone last saw", async () => {
  const online = await kickoffOnline();
  const [mya, jerkson] = [phone(online), phone(online)];
  const group = await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl"] });
  await mya.carry();
  online.clock.now += 60;
  await jerkson.groups.join({ code: group.code, playerName: "Jerkson" });
  online.net.down = true;
  assert.equal(await mya.table.refresh(group.code), false);
  assert.deepEqual(rowsOf(await mya.league(), "everyone"), ["1 mya 0 (you)"]);
  online.net.down = false;
  assert.equal(await mya.table.refresh(group.code), true);
  assert.deepEqual(rowsOf(await mya.league(), "everyone"), ["1 mya 0 (you)", "2 Jerkson 0"]);
  // Looking at another group, the table of everyone is still good and the group's is not shown as this one's.
  assert.equal(mya.table.view("OTHER-0001").group, null);
  assert.equal(mya.table.view("OTHER-0001").everyone.players, 2);
});
