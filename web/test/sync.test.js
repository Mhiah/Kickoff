// A sealed pick's whole journey from a phone: sent, locked, receipt checked, opened after kickoff.
// The server here is the real server's code, run in memory, so both sides are checked together.
import { test } from "node:test";
import assert from "node:assert/strict";

import { COMPETITIONS, SAMPLE_LEAGUE, sampleFixtures } from "../data/sample.js";
import { createDevice } from "../lib/device.js";
import { createFixtures } from "../lib/fixtures.js";
import { createStore, pickWords, seal } from "../lib/picks.js";
import { createClient } from "../lib/server.js";
import { BOX_MAX, finishMove, isShared, newCode, readCode, showCode, startMove } from "../lib/move.js";
import { RETRY_AFTER, UNSIGNED, standing, syncPicks } from "../lib/sync.js";
import { league, matchScreen, pick } from "../screens.js";
import { FakeStorage, NOW, noGroup } from "./helpers.js";

import { FOOTBALL, BASKETBALL, fromHex, isServerKey, matchId, parseOpenings, playerIdOf, toHex, verifyTaken } from "../../engine/src/index.js";
import { createHandler } from "../../server/src/http.js";
import { CLOSES_BEFORE, SETTLE, createKickoff } from "../../server/src/kickoff.js";
import { createSigner } from "../../server/src/signing.js";
import { MemoryStore } from "../../server/src/store.js";

const LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
const HOUR = 3600;
const KICKOFF = NOW + 24 * HOUR;
const CLOSES = KICKOFF - CLOSES_BEFORE;

/** Kickoff's server with two real matches on its list. `net.down = true` cuts the connection. */
async function kickoffOnline({ withMatches = true, signer = null } = {}) {
  const clock = { now: NOW };
  // `signs.with` can be swapped mid-test, to stand for a server that stops or starts signing.
  const signs = { with: signer };
  const kept = new MemoryStore();
  const kickoff = createKickoff({ store: kept, league: LEAGUE, signer: signer ? { publicKey: signer.publicKey, sign: (facts) => signs.with.sign(facts) } : null });
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
  return { fetch, net, clock, kickoff, kept, ids, signs, serverKey: signer?.publicKey ?? null, football: ids.Arsenal, basketball: ids.Knicks, robotFreezes: (match) => kickoff.freeze({ now: clock.now, match }) };
}

/** A phone. `at(time)` moves the clock, fetches the matches and carries every pick as far as it can go. */
async function phone(online, storage = new FakeStorage()) {
  const store = createStore(storage);
  const device = createDevice(store);
  const client = createClient({ device, fetch: online.fetch, now: () => online.clock.now });
  const matches = createFixtures({ store, client, competitions: COMPETITIONS, sample: { league: SAMPLE_LEAGUE, fixtures: sampleFixtures } });
  const player = await device.player();
  const self = {
    storage, store, player, matches, client, device,
    /** The key this phone checks the server's signed notes against, as the website's settings give it. */
    serverKey: online.serverKey,
    async ctx() {
      const v = await matches.view(online.clock.now);
      return { now: online.clock.now, ...v, picks: store.all(player), lasting: store.lasting, editing: null, mine: noGroup(player) };
    },
    async carry() {
      await matches.refresh();
      const c = await self.ctx();
      return c.real ? syncPicks({ store, client, player, league: c.league, fixtures: c.fixtures, now: c.now, serverKey: self.serverKey, shared: isShared(store) }) : false;
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
  // Each made-up match is there, and a football one as its three predictions.
  assert.deepEqual(Object.keys(c.fixtures).filter((id) => c.fixtures[id].lead).sort(), Object.keys(sampleFixtures(NOW)).sort());
  assert.deepEqual(c.fixtures["ars-che"].group, ["ars-che", "ars-che.5", "ars-che.6"]);
  await ada.seal("ars-che", { result: "home" });
  assert.equal(await ada.carry(), false, "a prediction for a made-up match is not sent anywhere");
  assert.ok(!online.net.sent.some((s) => s.url === "/api/picks"));
  assert.ok(!(await ada.screen("ars-che")).includes('class="state'), "a made-up prediction has no sent or locked mark");
  assert.match(await ada.screen("ars-che"), /Nothing here is live yet/);
});

test("a solo prediction: someone with no name is asked for one beside the Seal button, and only then", async () => {
  const online = await kickoffOnline();
  const solo = await phone(online);
  await solo.carry();
  const c = await solo.ctx();
  const match = Object.keys(c.fixtures).find((id) => c.fixtures[id].lead);
  // No group and no name: the screen asks for a name, right above the button.
  const asks = pick(match, { ...c, mine: { ...c.mine, name: "" } }).html;
  assert.match(asks, /<label class="solo-name">Your name<input name="soloName" data-solo-name maxlength="24" autocomplete="nickname"><\/label>\n<button type="button" class="btn go" data-seal=/);
  // Someone who has a name, from a group or from an earlier solo prediction, is not asked again.
  assert.ok(!pick(match, { ...c, mine: { ...c.mine, name: "Tolu" } }).html.includes("data-solo-name"));
  // The made-up matches of a never-launched copy do not ask either: nothing there is sent.
  const preview = await phone(await kickoffOnline({ withMatches: false }));
  await preview.carry();
  const p = await preview.ctx();
  assert.ok(!pick("ars-che", { ...p, mine: { ...p.mine, name: "" } }).html.includes("data-solo-name"));
});

test("once real matches have been on the list, a week with none shows nothing made up", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  assert.equal((await ada.ctx()).real, true);
  // Nine days on, both matches are long over and no new one is listed.
  online.clock.now = KICKOFF + 9 * 24 * HOUR;
  await ada.carry();
  const c = await ada.ctx();
  assert.deepEqual([c.real, c.league, Object.keys(c.fixtures)], [true, LEAGUE, []]);
  // The League screen is the real one, with no match to predict and nobody made up on it.
  const html = league(null, { ...c, standings: null }).html;
  assert.match(html, /Nothing open/);
  assert.match(html, /No matches on the list right now\. New ones arrive by themselves\./);
  assert.ok(!html.includes("0 of 0 matches") && !html.includes("data-filter"), "nothing to count or to filter");
  for (const made of ["Sunday Ballers", "Funke", "Inter v Barcelona", "Nothing here is live yet"]) assert.ok(!html.includes(made), made);
  // The sample match page is not shown either: its address shows the League.
  assert.equal(matchScreen("anything", { ...c, standings: null }).title, league(null, { ...c, standings: null }).title);
  assert.ok(!matchScreen("anything", { ...c, standings: null }).html.includes("Man City"));
});

test("a player who is in a real group is never shown the made-up matches", async () => {
  // Kickoff's list has no match on it at all, and this phone has never been sent one.
  const online = await kickoffOnline({ withMatches: false });
  const ada = await phone(online);
  await ada.carry();
  const guest = await ada.matches.view(online.clock.now);
  assert.equal(guest.real, false, "a visitor in no group still sees the preview, which says it is one");
  const member = await ada.matches.view(online.clock.now, { member: true });
  assert.deepEqual([member.real, Object.keys(member.fixtures)], [true, []]);
  // Even a phone whose copy of the list is gone.
  const bare = await phone(online);
  const lost = await bare.matches.view(online.clock.now, { member: true });
  assert.deepEqual([lost.real, lost.league, Object.keys(lost.fixtures)], [true, null, []]);
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
  assert.match(html, /You have predicted 0 of 2 matches/);
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
  assert.equal(await ada.carry(), false, "nothing more to do until predictions close");

  await bola.seal(online.football, { home: 0, away: 0 });
  await bola.carry();

  // Picks close. Until the bundle is made there is no receipt yet.
  online.clock.now = CLOSES + 1;
  await ada.carry();
  assert.equal(await ada.stands(online.football), "closed");
  assert.match(await ada.screen(online.football), /<div class="state ">Entered<\/div>/);
  assert.match(await ada.screen(online.football), /Predictions have closed/);
  assert.ok(!(await ada.screen(online.football)).includes("Change my prediction"));

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
  assert.match(await ada.screen(online.football), /<div class="state ">Locked in<\/div>/);
  // Bola never comes back, so his stays sealed.
  const file = parseOpenings(await online.kickoff.openingsFile({ now: online.clock.now, match: online.football }));
  assert.equal(file.entries.length, 2);
  assert.deepEqual(file.openings.map((o) => [toHex(o.player), o.pickByte]), [[ada.player, sealed.pickByte]]);
  assert.equal(await ada.carry(), false, "and then there is nothing left to do");
});

test("a prediction changed before predictions close is the one that gets locked", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  online.clock.now += 600;
  const second = await ada.seal(online.football, { home: 0, away: 3 });
  assert.equal(await ada.stands(online.football), "waiting", "the new prediction has not been sent yet");
  await ada.carry();
  assert.equal(await ada.stands(online.football), "sent");
  assert.equal(ada.store.get(online.football).fallback, undefined, "the earlier prediction is let go once the new one is in");
  online.clock.now = CLOSES + SETTLE;
  const frozen = await online.robotFreezes(online.football);
  assert.deepEqual(frozen.entries, [{ player: ada.player, fingerprint: second.fingerprint }]);
  await ada.carry();
  assert.equal(await ada.stands(online.football), "locked");
  assert.match(await ada.screen(online.football), /<div class="state ">Locked in<\/div>/);
});

test("offline, a prediction waits and says so; back online in time, it is sent", async () => {
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

test("a prediction that never got through before predictions closed does not count, and the screen says so", async () => {
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

test("if a changed prediction never gets through, the earlier one that did is kept and can still be opened", async () => {
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
  assert.equal(ada.store.get(online.football).fallback.fingerprint, first.fingerprint, "the prediction Kickoff holds is not thrown away");
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
  assert.match(html, /Your later prediction was not sent in time, so this one counts\./);
  assert.match(html, /<div class="yours">2 – 1<\/div>/);
  online.clock.now = KICKOFF + 5;
  await ada.carry();
  assert.equal(await ada.stands(online.football), "opened", "and it opens, because its secret was kept");
});

test("CHEAT: if Kickoff leaves a prediction out of the bundle, the phone finds out and says so", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  // The server bundles without her pick, so it has no receipt for her.
  online.clock.now = CLOSES + SETTLE;
  ada.client.receipt = async () => {
    throw Object.assign(new Error("There is no sealed prediction from this player in the bundle."), { status: 404 });
  };
  await online.robotFreezes(online.football);
  await ada.carry();
  assert.equal(await ada.stands(online.football), "problem");
  assert.match(await ada.screen(online.football), /<div class="state bad">Problem<\/div><div class="small muted state-line">Kickoff left this prediction out of the locked bundle\.</);
});

test("CHEAT: a receipt that does not prove the prediction is not accepted", async () => {
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
    assert.match(await ada.screen(online.football), /receipt does not prove this prediction was locked/);
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

test("a prediction is never opened before the match starts, even if the phone's clock runs fast", async () => {
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

test("a basketball prediction reads back in words at every step", async () => {
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

test("the robot's key written into the website is either not set yet or a real public key", async () => {
  const { ROBOT_KEY } = await import("../config.js");
  const { isEnvelopeKey } = await import("../engine/envelope.js");
  assert.ok(ROBOT_KEY === null || isEnvelopeKey(ROBOT_KEY), "ROBOT_KEY in web/config.js is not a key a copy can be locked to");
});

// ---- Kickoff's signed word that it took a prediction

const SERVER = createSigner("the server's secret, long enough to use");
const SOMEBODY = createSigner("somebody else's secret, just as long");

test("the phone keeps Kickoff's signed note for each prediction it sends, whole, so anyone can check it", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  await ada.carry();
  const sealed = await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  assert.equal(await ada.stands(online.football), "sent");
  const { taken } = ada.store.get(online.football);
  assert.deepEqual(Object.keys(taken).sort(), ["closesAt", "fingerprint", "key", "league", "match", "player", "receivedAt", "sig"]);
  assert.deepEqual({ ...taken, sig: null }, { league: LEAGUE, match: online.football, player: ada.player, fingerprint: sealed.fingerprint, receivedAt: NOW, closesAt: CLOSES, key: SERVER.publicKey, sig: null });
  // It needs nothing else to be checked: not this phone, and not Kickoff.
  assert.equal(await verifyTaken(taken), true);
  // With the note in hand, the prediction is not sent again.
  const before = online.net.sent.length;
  await ada.carry();
  assert.equal(online.net.sent.filter((x) => x.url === "/api/picks").length, online.net.sent.slice(0, before).filter((x) => x.url === "/api/picks").length);
});

test("a changed prediction gets its own note, and the earlier one is not passed off as covering it", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  await ada.carry();
  const first = await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  online.clock.now += 60;
  const second = await ada.seal(online.football, { home: 1, away: 1 });
  assert.equal(ada.store.get(online.football).taken, undefined, "a new prediction starts with no note");
  await ada.carry();
  const { taken } = ada.store.get(online.football);
  assert.equal(taken.fingerprint, second.fingerprint);
  assert.notEqual(taken.fingerprint, first.fingerprint);
  assert.equal(await verifyTaken(taken), true);
});

test("CHEAT: a server that takes a prediction without signing for it is found out, and asked again", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  await ada.carry();
  online.signs.with = { sign: async () => undefined }; // it answers, with no signature
  await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  const kept = ada.store.get(online.football);
  assert.equal(kept.sent.fingerprint, kept.fingerprint, "Kickoff does hold it");
  assert.equal(kept.taken, undefined);
  assert.equal(await ada.stands(online.football), "problem");
  assert.match(await ada.screen(online.football), /<div class="state bad">Problem<\/div><div class="small muted state-line">Kickoff has this prediction but did not sign for it\. It will be asked again\.</);
  assert.equal(kept.problem, UNSIGNED);

  // It is not asked again straight away, and is once a few minutes have passed.
  const sends = () => online.net.sent.filter((x) => x.url === "/api/picks").length;
  const once = sends();
  online.clock.now += 60;
  await ada.carry();
  assert.equal(sends(), once);
  online.signs.with = SERVER;
  online.clock.now += RETRY_AFTER;
  await ada.carry();
  assert.equal(sends(), once + 1);
  assert.equal(await ada.stands(online.football), "sent");
  assert.equal(await verifyTaken(ada.store.get(online.football).taken), true);
  assert.equal(ada.store.get(online.football).problem, undefined);
});

test("CHEAT: a note signed with any key but Kickoff's, or for other facts, is not kept", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  await ada.carry();
  const tries = [
    // somebody else's key
    (facts) => SOMEBODY.sign(facts),
    // Kickoff's key, but for another player, another prediction, or an earlier time
    (facts) => SERVER.sign({ ...facts, player: "ab".repeat(32) }),
    (facts) => SERVER.sign({ ...facts, fingerprint: "cd".repeat(32) }),
    (facts) => SERVER.sign({ ...facts, receivedAt: facts.receivedAt - 1 }),
    // nonsense
    async () => "00".repeat(64),
    async () => 7,
  ];
  for (const sign of tries) {
    online.signs.with = { sign };
    online.clock.now += RETRY_AFTER;
    await ada.seal(online.football, { home: 2, away: 1 });
    await ada.carry();
    assert.equal(ada.store.get(online.football).taken, undefined);
    assert.equal(ada.store.get(online.football).problem, UNSIGNED);
  }
});

test("CHEAT: a note that gives the wrong closing time, or a time after predictions closed, is not kept", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  await ada.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  // The server truly signs, but says predictions close an hour later than they do.
  const real = ada.client.sendPick;
  ada.client.sendPick = async (sending) => {
    const answer = await real(sending);
    const closesAt = answer.closesAt + HOUR;
    return { ...answer, closesAt, taken: { key: SERVER.publicKey, sig: await SERVER.sign({ league: LEAGUE, match: sending.match, player: ada.player, fingerprint: sending.fingerprint, receivedAt: answer.receivedAt, closesAt }) } };
  };
  await ada.carry();
  assert.equal(ada.store.get(online.football).taken, undefined);
  assert.equal(ada.store.get(online.football).problem, UNSIGNED);
  // Or signs a time that is not before the close.
  ada.client.sendPick = async (sending) => {
    const answer = await real(sending);
    const receivedAt = CLOSES;
    return { ...answer, receivedAt, taken: { key: SERVER.publicKey, sig: await SERVER.sign({ league: LEAGUE, match: sending.match, player: ada.player, fingerprint: sending.fingerprint, receivedAt, closesAt: answer.closesAt }) } };
  };
  online.clock.now += RETRY_AFTER;
  await ada.carry();
  assert.equal(ada.store.get(online.football).taken, undefined);
});

test("CHEAT: left out of the locked bundle, the player now holds Kickoff's own signature that it took the prediction in time", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  const bola = await phone(online);
  await ada.carry();
  await bola.carry();
  const sealed = await ada.seal(online.football, { home: 2, away: 1 });
  await bola.seal(online.football, { home: 0, away: 0 });
  await ada.carry();
  await bola.carry();
  // Kickoff drops Ada's prediction before bundling.
  await online.kept.tableDelete(`sealed:${online.football}`, ada.player);
  online.clock.now = CLOSES + SETTLE;
  const bundle = await online.robotFreezes(online.football);
  assert.deepEqual(bundle.entries.map((e) => e.player), [bola.player]);
  await ada.carry();
  await bola.carry();
  assert.equal(await bola.stands(online.football), "locked");
  assert.equal(await ada.stands(online.football), "problem");
  assert.match(await ada.screen(online.football), /Kickoff left this prediction out of the locked bundle\./);

  // What Ada holds: signed by Kickoff's key, for her prediction, taken before predictions closed.
  const { taken } = ada.store.get(online.football);
  assert.equal(await verifyTaken(taken), true);
  assert.equal(taken.key, SERVER.publicKey);
  assert.equal(taken.fingerprint, sealed.fingerprint);
  assert.ok(taken.receivedAt < taken.closesAt);
  // And the bundle that was locked does not hold it.
  assert.ok(!bundle.entries.some((e) => e.fingerprint === taken.fingerprint));
});

test("a prediction sent before notes existed gets one the next time the phone is open, while predictions are open", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  ada.serverKey = null; // the website as it was: it asks for no note
  await ada.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  assert.equal(ada.store.get(online.football).taken, undefined);
  assert.equal(await ada.stands(online.football), "sent");
  ada.serverKey = SERVER.publicKey; // the website now
  online.clock.now += 60;
  await ada.carry();
  assert.equal(await verifyTaken(ada.store.get(online.football).taken), true);
  assert.equal(await ada.stands(online.football), "sent");
});

test("the server's key written into the website is either not set yet or a real public key", async () => {
  const { SERVER_KEY } = await import("../config.js");
  assert.ok(SERVER_KEY === null || isServerKey(SERVER_KEY), "SERVER_KEY in web/config.js is not a key a note can be checked against");
});

// ---- Moving to another phone with a one-time code

const movesSent = (online) => online.net.sent.filter((x) => x.url.startsWith("/api/move"));
const leftAt = (online) => movesSent(online).filter((x) => x.url === "/api/move").at(-1).body.match(/id\\?":\\?"([0-9a-f]{64})/)[1];

test("a one-time code carries a player to another phone: the same player, with the predictions the first phone holds", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  await ada.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  ada.store.write("kickoff-name", "Ada");

  const moving = await startMove({ store: ada.store, client: ada.client, device: ada.device });
  assert.match(moving.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(moving.until, NOW + 600);
  assert.equal(moving.left, 0);

  // The other phone is somebody else until the code is typed in. Typed in small letters, with the dash, is fine.
  const other = await phone(online);
  assert.notEqual(other.player, ada.player);
  const now = await finishMove({ store: other.store, client: other.client, typed: ` ${showCode(moving.code).toLowerCase()} ` });
  assert.deepEqual(now, { player: ada.player, name: "Ada" });

  // Opened again, that phone is Ada: her key, her name, and her prediction exactly as the first phone holds it.
  const second = await phone(online, other.storage);
  assert.equal(second.player, ada.player);
  assert.equal(second.store.read("kickoff-name"), "Ada");
  assert.deepEqual(second.store.get(online.football), ada.store.get(online.football));
  assert.equal(await verifyTaken(second.store.get(online.football).taken), true, "the signed note came along");
  // It has nothing to send again.
  const sends = online.net.sent.filter((x) => x.url === "/api/picks").length;
  await second.carry();
  assert.equal(online.net.sent.filter((x) => x.url === "/api/picks").length, sends);
  assert.equal(await second.stands(online.football), "sent");
  // Both phones know the key is on two phones now. What the other phone was before is put aside, not thrown away.
  assert.ok(isShared(ada.store) && isShared(second.store));
  assert.equal(toHex(await playerIdOf(fromHex(JSON.parse(other.store.read("kickoff-before-move")).device.publicKey))), other.player);
});

test("the server is never given the code, cannot read the copy it holds, and keeps nothing once it is collected", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  await ada.carry();
  const sealed = await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  const moving = await startMove({ store: ada.store, client: ada.client, device: ada.device });
  const everything = online.net.sent.map((x) => `${x.url} ${x.body}`).join("\n");
  assert.ok(!everything.includes(moving.code) && !everything.includes(showCode(moving.code)), "the code was sent to the server");
  // What the server holds is locked: the key's private half and the prediction's secret are not readable in it.
  const held = await online.kept.get(`move:${leftAt(online)}`);
  const secret = JSON.parse(ada.store.read("kickoff-device")).privateJwk.d;
  const readable = Buffer.from(held.box, "base64").toString("latin1");
  for (const hidden of [secret, sealed.salt, ada.player, "privateJwk"]) assert.ok(!readable.includes(hidden) && !held.box.includes(hidden));
  assert.ok(held.box.length <= BOX_MAX);

  const other = await phone(online);
  await finishMove({ store: other.store, client: other.client, typed: moving.code });
  assert.equal(await online.kept.get(`move:${leftAt(online)}`), null);
  assert.equal(await online.kept.get(`move-of:${ada.player}`), null);
});

test("CHEAT: a code works once, and not at all after ten minutes", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  const first = await startMove({ store: ada.store, client: ada.client, device: ada.device });
  const one = await phone(online);
  const two = await phone(online);
  await finishMove({ store: one.store, client: one.client, typed: first.code });
  await assert.rejects(finishMove({ store: two.store, client: two.client, typed: first.code }), /That code is not right, or it has run out\./);
  assert.equal((await phone(online, two.storage)).player, two.player, "the second phone is still itself");

  const late = await startMove({ store: ada.store, client: ada.client, device: ada.device });
  online.clock.now += 600;
  await assert.rejects(finishMove({ store: two.store, client: two.client, typed: late.code }), /That code is not right, or it has run out\./);
  assert.equal(await online.kept.get(`move:${leftAt(online)}`), null, "a copy that has run out is thrown away when asked for");

  // Asking for a new code ends the one before it.
  const older = await startMove({ store: ada.store, client: ada.client, device: ada.device });
  const newer = await startMove({ store: ada.store, client: ada.client, device: ada.device });
  const three = await phone(online);
  await assert.rejects(finishMove({ store: three.store, client: three.client, typed: older.code }), /not right/);
  assert.equal((await finishMove({ store: three.store, client: three.client, typed: newer.code })).player, ada.player);
});

test("CHEAT: codes cannot be guessed at: a phone gets five wrong tries, then has to wait", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  const moving = await startMove({ store: ada.store, client: ada.client, device: ada.device });
  const guesser = await phone(online);
  for (let i = 0; i < 5; i++) {
    let guess = newCode();
    while (guess === moving.code) guess = newCode();
    await assert.rejects(finishMove({ store: guesser.store, client: guesser.client, typed: guess }), /That code is not right, or it has run out\./);
  }
  // Now even the right code is refused from that phone, until the ten minutes have passed.
  await assert.rejects(finishMove({ store: guesser.store, client: guesser.client, typed: moving.code }), /Too many tries\. Wait ten minutes, then get a new code\./);
  assert.equal((await phone(online, guesser.storage)).player, guesser.player);
  // The copy is still there for the phone it was meant for.
  const other = await phone(online);
  assert.equal((await finishMove({ store: other.store, client: other.client, typed: moving.code })).player, ada.player);
  // Something that could not be a code is not sent anywhere.
  const asked = movesSent(online).length;
  for (const typed of ["", "ABCD", "ABCD-EFG0", "ABCDEFGHI", "abcd efgh ijkl", null]) {
    assert.equal(readCode(typed), null);
    await assert.rejects(finishMove({ store: other.store, client: other.client, typed }), /A code is 8 letters and numbers, like ABCD-EFGH\./);
  }
  assert.equal(movesSent(online).length, asked);
});

test("CHEAT: a copy that was swapped or damaged on the way is not taken on, and the phone stays as it was", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  const eve = await phone(online);
  const moving = await startMove({ store: ada.store, client: ada.client, device: ada.device });
  const place = `move:${leftAt(online)}`;
  const held = await online.kept.get(place);
  // The server swaps in a copy locked with another code (somebody else's player).
  const evil = await startMove({ store: eve.store, client: eve.client, device: eve.device });
  const swapped = (await online.kept.get(`move:${leftAt(online)}`)).box;
  assert.ok(evil.code !== moving.code);
  await online.kept.set(place, { ...held, box: swapped });
  const other = await phone(online);
  await assert.rejects(finishMove({ store: other.store, client: other.client, typed: moving.code }), /That copy could not be unlocked\. Get a new code on your other phone\./);
  assert.equal((await phone(online, other.storage)).player, other.player);
  assert.equal(other.store.read("kickoff-before-move"), null);
  assert.ok(!isShared(other.store));
});

test("a prediction changed on the other phone is said to be, on the first, and is not raised as a problem", async () => {
  const online = await kickoffOnline({ signer: SERVER });
  const ada = await phone(online);
  await ada.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  const moving = await startMove({ store: ada.store, client: ada.client, device: ada.device });
  const blank = await phone(online);
  await finishMove({ store: blank.store, client: blank.client, typed: moving.code });
  const second = await phone(online, blank.storage);
  await second.carry();

  // On the second phone she changes her mind. The first phone is not opened again until after the lock.
  online.clock.now += 60;
  const changed = await second.seal(online.football, { home: 0, away: 0 });
  await second.carry();
  online.clock.now = CLOSES + SETTLE;
  const bundle = await online.robotFreezes(online.football);
  assert.deepEqual(bundle.entries.map((e) => e.fingerprint), [changed.fingerprint]);
  await second.carry();
  await ada.carry();
  assert.equal(await second.stands(online.football), "locked");
  assert.equal(await ada.stands(online.football), "elsewhere");
  assert.deepEqual(ada.store.get(online.football).elsewhere, { fingerprint: changed.fingerprint });
  assert.equal(ada.store.get(online.football).problem, undefined);
  assert.match(await ada.screen(online.football), /<div class="state ">Changed on your other phone<\/div>/);
  // It is settled: the first phone does not keep asking.
  const asks = online.net.sent.length;
  online.clock.now += RETRY_AFTER;
  await ada.carry();
  assert.equal(online.net.sent.filter((x) => x.url.includes("/receipt/")).length, online.net.sent.slice(0, asks).filter((x) => x.url.includes("/receipt/")).length);
});

test("CHEAT: for a player on one phone, a receipt for a different prediction is still a problem", async () => {
  const online = await kickoffOnline();
  const ada = await phone(online);
  await ada.carry();
  await ada.seal(online.football, { home: 2, away: 1 });
  await ada.carry();
  // Kickoff swaps her fingerprint for another before bundling.
  const held = await online.kept.tableGet(`sealed:${online.football}`, ada.player);
  await online.kept.tableSet(`sealed:${online.football}`, ada.player, { ...held, fingerprint: "ab".repeat(32) });
  online.clock.now = CLOSES + SETTLE;
  await online.robotFreezes(online.football);
  await ada.carry();
  assert.equal(await ada.stands(online.football), "problem");
  assert.equal(ada.store.get(online.football).problem, "Kickoff's receipt does not prove this prediction was locked.");
  assert.equal(ada.store.get(online.football).elsewhere, undefined);
});
