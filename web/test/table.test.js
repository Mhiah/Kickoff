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
import { groupScreen, league, recordScreen } from "../screens.js";
import { createOpener, envelopeKeysFrom } from "../../robot/src/envelope.js";
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
  /** The robot says how locking a match's picks on X Layer went. */
  const lock = (fixture, state = "locked") => kickoff.putLocks({ locks: [{ match: fixture.id, state }] });
  /** The robot records a result from the sports feed, for a match it locked in time unless told otherwise. */
  const result = async (fixture, score, res, { locked = true } = {}) => {
    if (locked) await lock(fixture);
    return kickoff.putFixtures({ fixtures: [{ ...fixture, state: "final", score, resultByte: encodePick(fixture.sport, res) }] });
  };
  return { fetch, net, clock, kickoff, f, result, lock };
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
      await syncPicks({ store, client, player: c.mine.player, league: c.league, fixtures: c.fixtures, now: c.now, robotKey: online.robotKey ?? null });
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
  assert.deepEqual(tile(html, "Predicted this week"), ["0 of 2", "predict as many as you like"]);
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
  assert.deepEqual(tile(html, "Your place"), ["–", "after your first prediction"]);
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
  assert.deepEqual(box(record, "Total predictions"), ["1", "0 to play"]);
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
  assert.deepEqual(box(record, "Total predictions"), ["1", "1 to play"]);
  assert.deepEqual(box(record, "Win rate"), ["–", "of 0 played"]);
});

test("a match that was not locked on X Layer in time: the prediction says so plainly, gives nothing, and is not counted as lost", async () => {
  const online = await kickoffOnline();
  const mya = phone(online);
  await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl", "nba"] });
  await mya.carry();
  await mya.seal(online.f.football, { home: 2, away: 1 });
  await mya.carry(); // sent
  online.clock.now = KICKOFF - CLOSES_BEFORE + SETTLE;
  await mya.carry(); // Kickoff has it, and her phone has the receipt
  assert.match(await mya.record(), /<div class="state ">Locked in<\/div>/);

  // The robot was too late: nothing was locked on X Layer before kickoff. Then the match ends 2–1, just as she said.
  await online.lock(online.f.football, "missed");
  online.clock.now = KICKOFF + 2 * HOUR;
  await mya.carry(); // opened
  await online.result(online.f.football, "2 – 1", { home: 2, away: 1 }, { locked: false });
  await mya.carry();

  const said = '<div class="state bad">Not locked in time</div><div class="small muted state-line">Nobody scores for this match.</div>';
  let record = await mya.record();
  assert.ok(record.includes(`<div class="title">Arsenal 2 – 1 Chelsea</div><div class="sub">You said 2 – 1</div>${said}</div></div>`), "said plainly, with no points beside it");
  assert.ok(!record.includes("Locked in") && !record.includes("Revealed"));
  assert.match(record, /<b>0<\/b><span class="word">Points<\/span>/);
  const box = (html, label) => html.match(new RegExp(`<small>${label}</small><b>([^<]*)</b><span>([^<]*)</span>`))?.slice(1, 3);
  assert.deepEqual(box(record, "Total predictions"), ["1", "0 to play"], "a prediction she made, but not one still to play");
  assert.deepEqual(box(record, "Total won"), ["0", "0 spot on"]);
  assert.deepEqual(box(record, "Win rate"), ["–", "of 0 played"]);
  const html = await mya.league();
  assert.deepEqual(tile(html, "Your points"), ["0", "0 spot on, 0 right winner"]);
  assert.ok(html.includes(said), "the League screen's list of finished predictions says it too");

  // Later the match has dropped off the website's list of matches. It is still there, and still explained.
  online.clock.now = KICKOFF + 4 * HOUR;
  await mya.carry();
  assert.equal(Object.values((await mya.ctx()).fixtures).some((f) => f.home === "Arsenal"), false);
  record = await mya.record();
  assert.ok(record.includes(said));
  assert.ok(!/class="points/.test(record));
});

test("nobody comes back after predicting: the robot opens every prediction, and the leaderboard updates for everyone", async () => {
  const online = await kickoffOnline();
  // The website is given the robot's public key. The robot keeps the private half.
  const wallet = "ab".repeat(32);
  online.robotKey = envelopeKeysFrom(wallet).publicKey;
  const unlock = createOpener(wallet);
  const mya = phone(online);
  const jerkson = phone(online);
  const g = await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl", "nba"] });
  online.clock.now += 60;
  await jerkson.groups.join({ code: g.code, playerName: "Jerkson" });
  await mya.carry();
  await jerkson.carry();
  await mya.seal(online.f.football, { home: 2, away: 1 });
  await jerkson.seal(online.f.football, { home: 1, away: 0 });
  await mya.carry();
  await jerkson.carry();
  // What went to Kickoff is a fingerprint and a locked copy. The copy is not the prediction in the clear.
  const kept = Object.values((await mya.ctx()).picks)[0];
  assert.equal(kept.sent.copy, true);
  const before = JSON.stringify(await online.kickoff.match({ now: online.clock.now, match: online.f.football.id }));
  assert.ok(!before.includes(kept.salt) && !before.includes('"pickByte"'), "nothing about what anyone predicted can be seen before kickoff");

  // Predictions close and are locked. Then both phones are put away for good.
  online.clock.now = KICKOFF - CLOSES_BEFORE + SETTLE;
  await online.kickoff.freeze({ now: online.clock.now, match: online.f.football.id });
  await online.lock(online.f.football);

  // The match starts. The robot does what it does every round: fetches the locked copies, unlocks them, hands them over.
  online.clock.now = KICKOFF + 60;
  const copies = await online.kickoff.envelopes({ now: online.clock.now, match: online.f.football.id });
  assert.equal(copies.length, 2);
  const openings = [];
  for (const c of copies) openings.push({ player: c.player, ...(await unlock({ league: (await mya.ctx()).league, match: online.f.football.id, ...c })) });
  assert.deepEqual(await online.kickoff.openMany({ now: online.clock.now, match: online.f.football.id, openings }), { opened: 2, refused: [] });
  online.clock.now = KICKOFF + 2 * HOUR;
  await online.result(online.f.football, "2 – 1", { home: 2, away: 1 });

  // A third person who never predicted opens Kickoff. The leaderboard is already right, though neither phone came back.
  const visitor = phone(online);
  online.clock.now += 60;
  await visitor.groups.join({ code: g.code, playerName: "Tunde" });
  await visitor.carry();
  assert.deepEqual(rowsOf(await visitor.league(), "group"), ["1 mya 3", "2 Jerkson 1", "3 Tunde 0 (you)"]);

  // When mya does look, days later, her record shows it all, with nothing for her to do.
  online.clock.now = KICKOFF + 3 * HOUR - 60;
  await mya.carry();
  const record = await mya.record();
  assert.match(record, /<b>3<\/b><span class="word">Points<\/span>/);
  assert.match(record, /<div class="title">Arsenal 2 – 1 Chelsea<\/div><div class="sub">You said 2 – 1<\/div>/);
  assert.ok(!/Revealed|opened|Opened/.test(record), "nothing on her record talks about opening");
});

test("a prediction that went to Kickoff before locked copies were sent is sent again with one, while predictions are open", async () => {
  const online = await kickoffOnline();
  const mya = phone(online);
  await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl"] });
  await mya.carry();
  await mya.seal(online.f.football, { home: 2, away: 1 });
  await mya.carry();
  assert.equal(Object.values((await mya.ctx()).picks)[0].sent.copy, undefined);
  assert.deepEqual(await online.kickoff.envelopes({ now: KICKOFF, match: online.f.football.id }), []);

  // The website now knows the robot's key. The next time the phone is open, the copy goes too.
  online.robotKey = envelopeKeysFrom("ab".repeat(32)).publicKey;
  online.clock.now += 120;
  await mya.carry();
  assert.equal(Object.values((await mya.ctx()).picks)[0].sent.copy, true);
  const sentAt = Object.values((await mya.ctx()).picks)[0].sent.at;
  online.clock.now += 120;
  await mya.carry();
  assert.equal(Object.values((await mya.ctx()).picks)[0].sent.at, sentAt, "and it is not sent a third time");
  assert.equal((await online.kickoff.envelopes({ now: KICKOFF, match: online.f.football.id })).length, 1);
});

test("a group run by a brand: who runs it, the prize, how many play, and a leaderboard instead of a list of names", async () => {
  const online = await kickoffOnline();
  const made = await online.kickoff.createBrandGroup({ now: online.clock.now, name: "World Cup Predictions", brand: "OKX", prize: "100 USDT for 1st place", plays: ["pl", "nba"] });
  // Twenty-four fans join, then mya, one after another.
  const fans = [];
  for (let i = 0; i < 24; i++) {
    online.clock.now += 60;
    fans.push(phone(online));
    await fans[i].groups.join({ code: made.code, playerName: `Fan ${i + 1}` });
  }
  online.clock.now += 60;
  const mya = phone(online);
  await mya.groups.join({ code: made.code, playerName: "mya" });
  await mya.carry();

  const group = groupScreen(undefined, await mya.ctx()).html;
  assert.match(group, /<p class="sub">Run by OKX\. 25 players\.<\/p>/);
  assert.match(group, /<p class="sub prize"><b>Prize:<\/b> 100 USDT for 1st place<\/p>/);
  assert.match(group, /Anyone with this code can join\./);
  assert.match(group, /OKX chose these\./);
  assert.ok(!group.includes('role="switch"'), "nobody in it can change what it plays");
  // Only her own row is listed, with the wallet link. Nobody else's name is on the screen.
  assert.match(group, /<h2>You<\/h2>/);
  assert.match(group, /mya<span class="tag">you<\/span>/);
  assert.match(group, /data-link-wallet/);
  assert.ok(!group.includes("Fan 1") && !group.includes("started this group"));
  assert.match(group, /This group is too big to list\./);

  // The group's leaderboard: the top twenty, then her own row, 25th.
  const html = await mya.league();
  const rows = rowsOf(html, "group");
  assert.equal(rows.length, 21);
  assert.deepEqual([rows[0], rows[19], rows[20]], ["1 Fan 1 0", "20 Fan 20 0", "25 mya 0 (you)"]);
  assert.match(html, /<tr class="gap">/);

  // A group with no prize line shows none.
  const plain = await online.kickoff.createBrandGroup({ now: online.clock.now, name: "Derby Day", brand: "Blokyz" });
  await mya.groups.join({ code: plain.code, playerName: "mya" });
  await mya.carry();
  const second = groupScreen(undefined, await mya.ctx()).html;
  assert.match(second, /Run by Blokyz\. 1 player\./);
  assert.ok(!second.includes("Prize:"));
  assert.match(second, /World Cup Predictions<\/div><div class="sub">Run by OKX · 25 players<\/div>/, "her other group says who runs it too");
});

test("a name somebody already has is refused, in plain words, when starting or joining", async () => {
  const online = await kickoffOnline();
  const [mya, other] = [phone(online), phone(online)];
  const group = await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl"] });
  await assert.rejects(other.groups.join({ code: group.code, playerName: "MYA" }), /That name is taken\. Choose another\./);
  await assert.rejects(other.groups.start({ name: "Another", playerName: "Mya", plays: ["pl"] }), /That name is taken\. Choose another\./);
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
  assert.deepEqual(tile(html, "Predicted this week"), ["0 of 1", "predict as many as you like"]);
});

test("someone with no group sees the table of everyone, and is pointed to starting a group", async () => {
  const online = await kickoffOnline();
  const [mya, guest] = [phone(online), phone(online)];
  await mya.groups.start({ name: "Sunday Ballers", playerName: "mya", plays: ["pl"] });
  await guest.carry();
  const html = await guest.league();
  assert.deepEqual(rowsOf(html, "everyone"), ["1 mya 0"]);
  assert.deepEqual(tile(html, "Your place"), ["–", "after your first prediction"]);
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
