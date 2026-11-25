// A sealed pick's whole journey from a phone: sent, locked, receipt checked, opened after kickoff.
// The server here is the real server's code, run in memory, so both sides are checked together.
import { test } from "node:test";
import assert from "node:assert/strict";

import { COMPETITIONS, SAMPLE_LEAGUE, sampleFixtures } from "../data/sample.js";
import { createDevice } from "../lib/device.js";
import { createFixtures } from "../lib/fixtures.js";
import { createStore, pickWords, seal } from "../lib/picks.js";
import { createClient } from "../lib/server.js";
import { RETRY_AFTER, standing, syncPicks } from "../lib/sync.js";
import { league, pick } from "../screens.js";
import { FakeStorage, NOW, noGroup } from "./helpers.js";

import { FOOTBALL, BASKETBALL, matchId, parseOpenings, toHex } from "../../engine/src/index.js";
import { createHandler } from "../../server/src/http.js";
import { CLOSES_BEFORE, SETTLE, createKickoff } from "../../server/src/kickoff.js";
import { MemoryStore } from "../../server/src/store.js";

const LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
const HOUR = 3600;
const KICKOFF = NOW + 24 * HOUR;
const CLOSES = KICKOFF - CLOSES_BEFORE;

/** Kickoff's server with two real matches on its list. `net.down = true` cuts the connection. */
async function kickoffOnline({ withMatches = true } = {}) {
  const clock = { now: NOW };
  const kickoff = createKickoff({ store: new MemoryStore(), league: LEAGUE });
  const handle = createHandler({ kickoff, now: () => clock.now, adminKey: "robot" });
  const net = { down: false, sent: [] };
  const fetch = async (url, init = {}) => {
    if (net.down) throw new TypeError("Failed to fetch");
    net.sent.push({ url, body: init.body ?? "" });
    const answer = await handle({ method: init.method ?? "GET", path: url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  const facts = [
    { comp: "pl", sport: FOOTBALL, home: "Arsenal", away: "Chelsea", kickoff: KICKOFF, label: "Premier League: Arsenal v Chelsea" },
    { comp: "nba", sport: BASKETBALL, home: "Knicks", away: "Bucks", kickoff: KICKOFF + 6 * HOUR, label: "NBA: Knicks v Bucks" },
  ];
  const ids = {};
  if (withMatches) {
    const fixtures = [];
    for (const f of facts) {
      const id = toHex(await matchId(LEAGUE, { sport: f.sport, kickoff: f.kickoff, bestOf: 0, label: f.label }));
      ids[f.home] = id;
      fixtures.push({ id, feedId: `test:${f.home}`, state: "scheduled", ...f });
    }
    await kickoff.putFixtures({ fixtures });
  }
  return { fetch, net, clock, kickoff, ids, football: ids.Arsenal, basketball: ids.Knicks, robotFreezes: (match) => kickoff.freeze({ now: clock.now, match }) };
}

/** A phone. `at(time)` moves the clock, fetches the matches and carries every pick as far as it can go. */
async function phone(online, storage = new FakeStorage()) {
  const store = createStore(storage);
  const device = createDevice(store);
  const client = createClient({ device, fetch: online.fetch, now: () => online.clock.now });
  const matches = createFixtures({ store, client, competitions: COMPETITIONS, sample: { league: SAMPLE_LEAGUE, fixtures: sampleFixtures } });
  const player = await device.player();
  const self = {
    storage, store, player, matches, client,
    async ctx() {
      const v = await matches.view(online.clock.now);
      return { now: online.clock.now, ...v, picks: store.all(player), lasting: store.lasting, editing: null, mine: noGroup(player) };
    },
    async carry() {
      await matches.refresh();
      const c = await self.ctx();
      return c.real ? syncPicks({ store, client, player, league: c.league, fixtures: c.fixtures, now: c.now }) : false;
    },
    async seal(match, chosen) {
      const c = await self.ctx();
      return seal({ store, league: c.league, fixture: c.fixtures[match], competitions: COMPETITIONS, pick: chosen, now: c.now, player });
    },
    async stands(match) {
      const c = await self.ctx();
      return standing(store.get(match), c.fixtures[match], c.now);
    },
    async screen(match) {
      return pick(match, await self.ctx()).html;
    },
  };
  return self;
}

test("until real matches are on Kickoff's list, the made-up ones are shown and say so", async () => {
  const online = await kickoffOnline({ withMatches: false });
  const ada = await phone(online);
  await ada.carry();
  const c = await ada.ctx();
  assert.equal(c.real, false);
  assert.deepEqual(Object.keys(c.fixtures).sort(), Object.keys(sampleFixtures(NOW)).sort());
  await ada.seal("ars-che", { home: 2, away: 1 });
  assert.equal(await ada.carry(), false, "a pick for a made-up match is not sent anywhere");
  assert.ok(!online.net.sent.some((s) => s.url === "/api/picks"));
  assert.ok(!(await ada.screen("ars-che")).includes('class="state'), "a made-up pick has no sent or locked mark");
  assert.match(await ada.screen("ars-che"), /Nothing here is live yet/);
});

test("real matches replace the made-up ones, and each is only shown if its id checks out", async () => {
  const online = await kickoffOnline();
  // The server also lists a match whose id does not fit its facts, and one in a competition Kickoff does not cover.
  await online.kickoff.putFixtures({
    fixtures: [
      { id: "ab".repeat(32), comp: "pl", sport: FOOTBALL, home: "Spurs", away: "Newcastle", kickoff: KICKOFF, label: "Premier League: Spurs v Newcastle", state: "scheduled" },
    ],
  });
  const ada = await phone(online);
  assert.equal((await ada.ctx()).real, false, "nothing fetched yet");
  await ada.carry();
  const c = await ada.ctx();
  assert.equal(c.real, true);
  assert.deepEqual(Object.keys(c.fixtures).sort(), [online.football, online.basketball].sort());
  assert.equal(c.league, LEAGUE);
  assert.ok(!JSON.stringify(c.fixtures).includes("Spurs"), "the match whose id does not fit is not shown");
  const html = league(null, c).html;
  assert.match(html, /Arsenal v Chelsea/);
  assert.match(html, /You have picked 0 of 2 matches/);
  assert.ok(!html.includes("Real Madrid"), "the made-up matches are gone");
  assert.ok(!html.includes("made up"), "nothing on the screen is made up any more");
  assert.ok(!html.includes("Nothing here is live yet"));
  for (const name of ["Funke", "Tunde", "Halima", "Emeka", "Dayo"]) assert.ok(!html.includes(name), "the made-up table is gone");
  // Still there when the phone is offline and the page is opened again.
  online.net.down = true;
  const again = await phone(online, ada.storage);
  assert.equal((await again.ctx()).real, true);
});

test("the whole journey: sealed, sent, locked, receipt checked, opened after kickoff", async () => {
  const online = await kickoffOnline();
  const [ada, bola] = [await phone(online), await phone(online)];
  for (const p of [ada, bola]) await p.carry();

  // Sealed on the phone: not sent yet.
  const sealed = await ada.seal(online.football, { home: 2, away: 1 });
  assert.equal(await ada.stands(online.football), "waiting");
  // Carried: the fingerprint goes, and only the fingerprint.
  assert.equal(await ada.carry(), true);
  assert.equal(await ada.stands(online.football), "sent");
  assert.match(await ada.screen(online.football), /<div class="state ">Entered<\/div>/);
  assert.ok(!(await ada.screen(online.football)).includes("Nothing here is live yet"), "a real match is not called made up");
  const everythingSent = online.net.sent.map((s) => s.body).join("\n");
  assert.ok(everythingSent.includes(sealed.fingerprint));
  assert.ok(!everythingSent.includes(sealed.salt), "the secret has not left the phone");
  assert.equal(await ada.carry(), false, "nothing more to do until picks close");

  await bola.seal(online.football, { home: 0, away: 0 });
  await bola.carry();

  // Picks close. Until the bundle is made there is no receipt yet.
  online.clock.now = CLOSES + 1;
  await ada.carry();
  assert.equal(await ada.stands(online.football), "closed");
  assert.match(await ada.screen(online.football), /<div class="state ">Entered<\/div>/);
  assert.match(await ada.screen(online.football), /Picks have closed/);
  assert.ok(!(await ada.screen(online.football)).includes("Change my pick"));

  // The robot freezes the bundle. Each phone fetches its receipt and checks it.
  online.clock.now = CLOSES + SETTLE;
  await online.robotFreezes(online.football);
  await ada.carry();
  assert.equal(await ada.stands(online.football), "locked");
  assert.equal(ada.store.get(online.football).receipt.count, 2);
  assert.match(await ada.screen(online.football), /<div class="state ">Locked in<\/div>/);
  assert.ok(!online.net.sent.some((s) => s.body.includes(sealed.salt)), "still nothing but the fingerprint has left");

  // Kickoff. The phone hands over the pick and its secret, and the server accepts them.
  online.clock.now = KICKOFF;
  await ada.carry();
  assert.equal(await ada.stands(online.football), "opened");
  assert.match(await ada.screen(online.football), /<div class="state ">Revealed<\/div>/);
  // Bola never comes back, so his stays sealed.
  const file = parseOpenings(await online.kickoff.openingsFile({ now: online.clock.now, match: online.football }));
  assert.equal(file.entries.length, 2);
  assert.deepEqual(file.openings.map((o) => [toHex(o.player), o.pickByte]), [[ada.player, sealed.pickByte]]);
  assert.equal(await ada.carry(), false, "and then there is nothing left to do");
});

test("a pick changed before picks close is the one that gets locked", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  online.clock.now += 600;
  const second = await ada.seal(online.football, { home: 0, away: 3 });
  assert.equal(await ada.stands(online.football), "waiting", "the new pick has not been sent yet");
  await ada.carry();
  assert.equal(await ada.stands(online.football), "sent");
  assert.equal(ada.store.get(online.football).fallback, undefined, "the earlier pick is let go once the new one is in");
  online.clock.now = CLOSES + SETTLE;
  const frozen = await online.robotFreezes(online.football);
  assert.deepEqual(frozen.entries, [{ player: ada.player, fingerprint: second.fingerprint }]);
  await ada.carry();
  assert.equal(await ada.stands(online.football), "locked");
  assert.match(await ada.screen(online.football), /<div class="state ">Locked in<\/div>/);
});

test("offline, a pick waits and says so; back online in time, it is sent", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  online.net.down = true;
  await ada.seal(online.basketball, { winner: "home", band: "B" });
  await ada.carry();
  assert.equal(await ada.stands(online.basketball), "waiting");
  assert.match(await ada.screen(online.basketball), /<div class="state warn">Not entered yet<\/div><div class="small muted state-line">No connection\. It will try again\.</);
  assert.match(league(null, await ada.ctx()).html, /class="sealed-box unsent"[^>]*>Not entered</);
  online.net.down = false;
  await ada.carry();
  assert.equal(await ada.stands(online.basketball), "sent");
  assert.match(league(null, await ada.ctx()).html, />Sealed</);
});

test("a pick that never got through before picks closed does not count, and the screen says so", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  online.net.down = true;
  await ada.seal(online.football, { home: 1, away: 1 });
  await ada.carry();
  online.clock.now = CLOSES;
  online.net.down = false;
  await ada.carry();
  assert.equal(await ada.stands(online.football), "missed");
  assert.match(await ada.screen(online.football), /<div class="state bad">Not entered in time<\/div><div class="small muted state-line">It does not count for this match\.</);
  assert.ok(!online.net.sent.some((s) => s.url === "/api/picks"), "it is not sent late");
});

test("if a changed pick never gets through, the earlier one that did is kept and can still be opened", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  const first = await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  // She changes her mind twice with no signal.
  online.net.down = true;
  await ada.seal(online.football, { home: 0, away: 0 });
  await ada.carry();
  await ada.seal(online.football, { home: 4, away: 4 });
  await ada.carry();
  assert.equal(await ada.stands(online.football), "waiting");
  assert.equal(ada.store.get(online.football).fallback.fingerprint, first.fingerprint, "the pick Kickoff holds is not thrown away");
  // Signal comes back only after picks have closed and the bundle is made.
  online.clock.now = CLOSES + SETTLE;
  online.net.down = false;
  await online.robotFreezes(online.football);
  await ada.carry();
  const kept = ada.store.get(online.football);
  assert.equal(kept.fingerprint, first.fingerprint);
  assert.deepEqual(kept.pick, { home: 2, away: 1 });
  assert.equal(await ada.stands(online.football), "locked");
  const html = await ada.screen(online.football);
  assert.match(html, /Your later pick was not sent in time, so this one counts\./);
  assert.match(html, /<div class="yours">2 – 1<\/div>/);
  online.clock.now = KICKOFF + 5;
  await ada.carry();
  assert.equal(await ada.stands(online.football), "opened", "and it opens, because its secret was kept");
});

test("CHEAT: if Kickoff leaves a pick out of the bundle, the phone finds out and says so", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  // The server bundles without her pick, so it has no receipt for her.
  online.clock.now = CLOSES + SETTLE;
  ada.client.receipt = async () => {
    throw Object.assign(new Error("There is no sealed pick from this player in the bundle."), { status: 404 });
  };
  await online.robotFreezes(online.football);
  await ada.carry();
  assert.equal(await ada.stands(online.football), "problem");
  assert.match(await ada.screen(online.football), /<div class="state bad">Problem<\/div><div class="small muted state-line">Kickoff left this pick out of the locked bundle\.</);
});

test("CHEAT: a receipt that does not prove the pick is not accepted", async () => {
  const online = await kickoffOnline();
  const [ada, bola] = [await phone(online), await phone(online)];
  for (const p of [ada, bola]) await p.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  await bola.seal(online.football, { home: 1, away: 1 });
  for (const p of [ada, bola]) await p.carry();
  online.clock.now = CLOSES + SETTLE;
  await online.robotFreezes(online.football);
  const honest = ada.client.receipt;
  // Bola's receipt handed to Ada; then her own with the root changed; then with the path changed.
  const lies = [
    async () => honest({ match: online.football, player: bola.player }),
    async (q) => ({ ...(await honest(q)), root: "ee".repeat(32) }),
    async (q) => ({ ...(await honest(q)), path: ["ee".repeat(32)] }),
    async (q) => ({ ...(await honest(q)), count: 3 }),
  ];
  let asked = 0;
  for (const lie of lies) {
    ada.client.receipt = (q) => (asked++, lie(q));
    online.clock.now += RETRY_AFTER; // a refused step is not asked again straight away
    await ada.carry();
    assert.equal(await ada.stands(online.football), "problem");
    assert.equal(ada.store.get(online.football).receipt, undefined);
    assert.match(await ada.screen(online.football), /receipt does not prove this pick was locked/);
  }
  // Asked again at once, the phone leaves the server alone for a few minutes.
  await ada.carry();
  await ada.carry();
  assert.equal(asked, lies.length);
  // The true receipt clears it.
  ada.client.receipt = honest;
  online.clock.now += RETRY_AFTER;
  await ada.carry();
  const cleared = ada.store.get(online.football);
  assert.equal(cleared.receipt.count, 2);
  assert.equal(cleared.problem, undefined);
  // By now the match has started, so the pick went on to be revealed as well.
  assert.equal(await ada.stands(online.football), "opened");
});

test("a pick is never opened before the match starts, even if the phone's clock runs fast", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  const sealed = await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  online.clock.now = CLOSES + SETTLE;
  await online.robotFreezes(online.football);
  await ada.carry();
  // The phone believes the match has started; the server knows it has not.
  const c = await ada.ctx();
  await syncPicks({ store: ada.store, client: ada.client, player: ada.player, league: c.league, fixtures: c.fixtures, now: KICKOFF + 60 });
  assert.equal(ada.store.get(online.football).opened, undefined);
  assert.match(ada.store.get(online.football).problem, /cannot be opened before the match starts/);
  const seen = await online.kickoff.match({ now: online.clock.now, match: online.football });
  assert.deepEqual(seen.opened, []);
  assert.ok(!JSON.stringify(seen).includes(sealed.salt));
  // At the real start it opens, and the earlier refusal is cleared.
  online.clock.now = KICKOFF;
  await ada.carry();
  assert.equal(await ada.stands(online.football), "opened");
  assert.equal(ada.store.get(online.football).problem, undefined);
});

test("a basketball pick reads back in words at every step", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  const entry = await ada.seal(online.basketball, { winner: "away", band: "C" });
  await ada.carry();
  const c = await ada.ctx();
  assert.equal(pickWords(entry, c.fixtures[online.basketball]), "Bucks by 11 to 15");
  assert.match(await ada.screen(online.basketball), /Bucks by 11 to 15/);
  assert.match(await ada.screen(online.basketball), /<div class="state ">Entered<\/div>/);
});
