// Sealing a pick on the device, and keeping it there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { COMPETITIONS, SAMPLE_LEAGUE } from "../data/sample.js";
import { createDevice } from "../lib/device.js";
import { createStore, fixtureFacts, matchIdOf, pickWords, seal } from "../lib/picks.js";
import { CLOSES_BEFORE, clock, closesAt, dayLabel, hasClosed, howLong, todayLabel } from "../lib/time.js";
import { ENGINE_FILES } from "../scripts/sync-engine.js";
import { league, nextUp, pick } from "../screens.js";
import { FakeStorage, NOW, contextAt, sealOn } from "./helpers.js";

// The engine itself, not the site's copy, to check the copy against.
import { fingerprintOf, matchId } from "../../engine/src/index.js";

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const bytes = (h) => new Uint8Array(Buffer.from(h, "hex"));

test("the site's copy of the engine is the engine, byte for byte", () => {
  assert.ok(ENGINE_FILES.length >= 4);
  for (const name of ENGINE_FILES) {
    const copy = readFileSync(new URL(`../engine/${name}`, import.meta.url), "utf8");
    const original = readFileSync(new URL(`../../engine/src/${name}`, import.meta.url), "utf8");
    assert.equal(copy, original, `${name} differs. Run: node web/scripts/sync-engine.js`);
  }
});

test("a sealed pick's fingerprint is the one the engine works out from the same facts", async () => {
  const ctx = await contextAt(NOW);
  const fixture = ctx.fixtures["ars-che"];
  const entry = await seal({ store: ctx.store, league: SAMPLE_LEAGUE, fixture, competitions: COMPETITIONS, pick: { home: 2, away: 1 }, now: NOW, player: ctx.mine.player });

  const facts = fixtureFacts(fixture, COMPETITIONS);
  assert.deepEqual(facts, { sport: 1, kickoff: fixture.kickoff, bestOf: 0, label: "Premier League: Arsenal v Chelsea" });
  const match = await matchId(SAMPLE_LEAGUE, facts);
  assert.equal(entry.match, hex(match));
  assert.equal(entry.match, await matchIdOf(SAMPLE_LEAGUE, fixture, COMPETITIONS));
  assert.equal(entry.pickByte, 18, "2 – 1 is written as the byte 18, as the football circuit expects");

  const expected = await fingerprintOf({ league: SAMPLE_LEAGUE, match, sport: 1, pickByte: 18, player: bytes(ctx.mine.player), salt: bytes(entry.salt) });
  assert.equal(entry.fingerprint, hex(expected));
  assert.equal(entry.salt.length, 64, "the secret is 32 bytes");
  assert.equal(entry.sealedAt, NOW);
});

test("a basketball pick seals as a winner and a margin", async () => {
  const ctx = await contextAt(NOW);
  const fixture = ctx.fixtures["nyk-mil"];
  const entry = await seal({ store: ctx.store, league: SAMPLE_LEAGUE, fixture, competitions: COMPETITIONS, pick: { winner: "away", band: "C" }, now: NOW, player: ctx.mine.player });
  assert.equal(entry.sport, 2);
  assert.equal(entry.pickByte, 1 | (2 << 1));
  assert.equal(pickWords(entry, fixture), "Bucks by 11 to 15");
  assert.equal(fixtureFacts(fixture, COMPETITIONS).label, "NBA: Knicks v Bucks");
});

test("a pick that cannot happen is refused, and nothing is kept", async () => {
  const ctx = await contextAt(NOW);
  const football = { store: ctx.store, league: SAMPLE_LEAGUE, fixture: ctx.fixtures["ars-che"], competitions: COMPETITIONS, now: NOW, player: ctx.mine.player };
  await assert.rejects(seal({ ...football, pick: { home: 16, away: 0 } }), /0 to 15/);
  await assert.rejects(seal({ ...football, pick: { home: 1.5, away: 0 } }), /whole number/);
  await assert.rejects(seal({ ...football, fixture: ctx.fixtures["nyk-mil"], pick: { winner: "home", band: "E" } }), /margin band/);
  assert.deepEqual(ctx.store.all(), {});
});

test("picks close ten minutes before the start, to the second", async () => {
  assert.equal(CLOSES_BEFORE, 600);
  const ctx = await contextAt(NOW);
  const fixture = ctx.fixtures["rma-bay"];
  const sealAt = (now) => seal({ store: ctx.store, league: SAMPLE_LEAGUE, fixture, competitions: COMPETITIONS, pick: { home: 1, away: 0 }, now, player: ctx.mine.player });
  await sealAt(closesAt(fixture.kickoff) - 1); // one second before closing: fine
  await assert.rejects(sealAt(closesAt(fixture.kickoff)), /have closed/);
  await assert.rejects(sealAt(fixture.kickoff + 60), /have closed/);
  assert.equal(hasClosed(fixture.kickoff - 601, fixture.kickoff), false);
  assert.equal(hasClosed(fixture.kickoff - 600, fixture.kickoff), true);
});

test("changing a pick replaces it, with a new secret and a new fingerprint", async () => {
  const ctx = await contextAt(NOW);
  const args = { store: ctx.store, league: SAMPLE_LEAGUE, fixture: ctx.fixtures["ars-che"], competitions: COMPETITIONS, now: NOW, player: ctx.mine.player };
  const first = await seal({ ...args, pick: { home: 2, away: 1 } });
  const second = await seal({ ...args, pick: { home: 2, away: 1 }, now: NOW + 60 });
  assert.equal(second.match, first.match);
  assert.notEqual(second.salt, first.salt);
  assert.notEqual(second.fingerprint, first.fingerprint, "the same pick sealed twice does not look the same from outside");
  assert.equal(Object.keys(ctx.store.all()).length, 1);
  assert.equal(ctx.store.get(first.match).sealedAt, NOW + 60);
});

test("picks and the device's key are still there when the browser is opened again", async () => {
  const storage = new FakeStorage();
  const before = createStore(storage);
  const ctx = await contextAt(NOW, before);
  const entry = await seal({ store: before, league: SAMPLE_LEAGUE, fixture: ctx.fixtures["int-bar"], competitions: COMPETITIONS, pick: { home: 0, away: 0 }, now: NOW, player: ctx.mine.player });
  assert.equal(entry.player, ctx.mine.player);

  const after = createStore(storage); // the page loaded again
  const again = await createDevice(after).player();
  assert.equal(again, ctx.mine.player, "the same key, so the same player");
  assert.match(again, /^[0-9a-f]{64}$/);
  assert.deepEqual(after.get(entry.match), entry);
  assert.deepEqual(after.all(again), { [entry.match]: entry });
  assert.equal(after.lasting, true);
  // Two devices do not share an id.
  assert.notEqual(await createDevice(createStore(new FakeStorage())).player(), again);
});

test("a pick sealed for another player id is not shown as yours", async () => {
  const ctx = await contextAt(NOW);
  const entry = await seal({ store: ctx.store, league: SAMPLE_LEAGUE, fixture: ctx.fixtures["ars-che"], competitions: COMPETITIONS, pick: { home: 1, away: 1 }, now: NOW, player: ctx.mine.player });
  // A pick left over from before this device had its own key: no player, or someone else's.
  ctx.store.save({ ...entry, match: "ab".repeat(32), player: undefined });
  ctx.store.save({ ...entry, match: "cd".repeat(32), player: "ee".repeat(32) });
  assert.deepEqual(Object.keys(ctx.store.all(ctx.mine.player)), [entry.match]);
  assert.equal(Object.keys(ctx.store.all()).length, 3, "nothing is thrown away");
  await assert.rejects(seal({ store: ctx.store, league: SAMPLE_LEAGUE, fixture: ctx.fixtures["ars-che"], competitions: COMPETITIONS, pick: { home: 1, away: 1 }, now: NOW }), /no player id yet/);
});

test("a browser that refuses to store anything still works for the visit, and says so", async () => {
  const refusing = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
  for (const storage of [refusing, null]) {
    const store = createStore(storage);
    const ctx = await contextAt(NOW, store);
    const entry = await seal({ store, league: SAMPLE_LEAGUE, fixture: ctx.fixtures["ars-che"], competitions: COMPETITIONS, pick: { home: 3, away: 3 }, now: NOW, player: ctx.mine.player });
    assert.deepEqual(store.get(entry.match), entry);
    assert.equal(store.lasting, false);
    const screen = pick("ars-che", await contextAt(NOW, store));
    assert.match(screen.html, /will be gone when you close it/);
  }
});

test("damaged storage is treated as empty, not as a crash", async () => {
  for (const junk of ["not json", "[1,2]", "null", '"text"']) {
    const storage = new FakeStorage();
    storage.setItem("kickoff-picks", junk);
    storage.setItem("kickoff-device", junk);
    const store = createStore(storage);
    assert.deepEqual(store.all(), {});
    assert.match(await createDevice(store).player(), /^[0-9a-f]{64}$/, "a new key is made in place of the damaged one");
  }
});

test("the pick screen shows your own pick back to you once it is sealed", async () => {
  const ctx = await contextAt(NOW);
  const before = pick("ars-che", ctx).html;
  assert.match(before, /data-seal="ars-che"/);
  assert.match(before, />Seal my pick</);
  assert.ok(!before.includes("sealed on this phone"));

  const after = await sealOn(ctx, "ars-che", { home: 2, away: 1 });
  const html = pick("ars-che", after).html;
  assert.match(html, /Your pick, sealed on this phone/);
  assert.match(html, /<div class="yours">2 – 1<\/div>/);
  assert.match(html, /Change my pick/);
  assert.match(html, /Not sent anywhere yet/);
  assert.ok(!html.includes("data-seal="), "the seal button is gone until you choose to change the pick");
  const kept = after.picks[after.matchIds["ars-che"]];
  assert.ok(html.includes(`0x${kept.fingerprint.slice(0, 8)}`), "it shows the start of the fingerprint");
  assert.ok(!html.includes(kept.salt), "the secret is never put on the page");
});

test("changing a pick brings the controls back, set to what you had", async () => {
  const ctx = await contextAt(NOW);
  const sealed = await sealOn(ctx, "ars-che", { home: 3, away: 2 });
  const editing = pick("ars-che", { ...sealed, editing: "ars-che" }).html;
  assert.match(editing, /Seal my new pick/);
  assert.deepEqual([...editing.matchAll(/<output[^>]*>(\d+)<\/output>/g)].map((m) => m[1]), ["3", "2"]);

  const hoops = await sealOn(ctx, "nyk-mil", { winner: "away", band: "D" });
  const again = pick("nyk-mil", { ...hoops, editing: "nyk-mil" }).html;
  assert.match(again, /data-winner="away" aria-pressed="true"/);
  assert.match(again, /data-band="D" aria-pressed="true"/);
  assert.match(again, /data-winner="home" aria-pressed="false"/);
});

test("once picks have closed, a match cannot be picked and a sealed pick cannot be changed", async () => {
  const ctx = await contextAt(NOW);
  const sealed = await sealOn(ctx, "rma-bay", { home: 1, away: 1 });
  const late = closesAt(ctx.fixtures["rma-bay"].kickoff) + 1;
  const after = await contextAt(late, sealed.store);

  const yours = pick("rma-bay", after).html;
  assert.match(yours, /can no longer be changed/);
  assert.ok(!yours.includes("data-change"));
  assert.ok(!yours.includes("data-seal="));

  const other = pick("int-bar", after).html; // same kickoff, never picked
  assert.match(other, /Picks for this match have closed/);
  assert.ok(!other.includes("data-seal="));

  const list = league(null, after).html;
  assert.match(list, />Closed</);
  assert.equal(nextUp(after), "nyk-mil", "the next match to pick skips the ones that have closed");
});

test("the next match to pick is the soonest one you have not picked", async () => {
  const ctx = await contextAt(NOW);
  assert.equal(nextUp(ctx), "rma-bay"); // two matches start together; they keep the order they were listed in
  const one = await sealOn(ctx, "rma-bay", { home: 1, away: 0 });
  assert.equal(nextUp(one), "int-bar");
  let all = one;
  for (const id of ["int-bar", "ars-che"]) all = await sealOn(all, id, { home: 0, away: 0 });
  for (const id of ["nyk-mil", "gsw-den"]) all = await sealOn(all, id, { winner: "home", band: "A" });
  assert.ok(nextUp(all), "with everything picked, it still points at a match that is open");
  assert.match(league(null, all).html, /You have picked 5 of 80 matches/);
});

test("a pick sealed for a match that has since moved is not counted for the new one", async () => {
  const ctx = await contextAt(NOW);
  const sealed = await sealOn(ctx, "ars-che", { home: 2, away: 1 });
  // The same teams, kicking off an hour later: a different match, with a different id.
  const moved = { ...sealed.fixtures, "ars-che": { ...sealed.fixtures["ars-che"], kickoff: sealed.fixtures["ars-che"].kickoff + 3600 } };
  const matchIds = { ...sealed.matchIds, "ars-che": await matchIdOf(SAMPLE_LEAGUE, moved["ars-che"], COMPETITIONS) };
  const html = pick("ars-che", { ...sealed, fixtures: moved, matchIds }).html;
  assert.match(html, />Seal my pick</);
  assert.ok(!html.includes("sealed on this phone"));
});

test("times read the way the screens show them", () => {
  const lagos = "Africa/Lagos";
  assert.equal(todayLabel(NOW, lagos), "Monday, 23 November");
  assert.equal(dayLabel(NOW + 86400, lagos), "Tuesday 24 Nov");
  assert.equal(clock(NOW, lagos), "18:00");
  assert.equal(clock(NOW + 6 * 3600 + 1800, lagos), "00:30", "half past midnight is 00:30, not 24:30");
  const cases = [[30, "under a minute"], [60, "1 minute"], [25 * 60, "25 minutes"], [3600, "1 hour"], [3600 + 20 * 60, "1 hour 20 minutes"], [3 * 3600 + 20 * 60, "3 hours"],
    [86400, "1 day"], [86400 + 3600, "1 day 1 hour"], [86400 + 5 * 3600, "1 day 5 hours"], [4 * 86400 + 7200, "4 days"], [-50, "under a minute"]];
  for (const [seconds, words] of cases) assert.equal(howLong(NOW, NOW + seconds), words);
});
