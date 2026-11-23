// The website talking to Kickoff's server: a device's key, signed requests, and groups.
// The server here is the real server's code, run in memory, so both sides are checked together.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createDevice } from "../lib/device.js";
import { createGroups } from "../lib/groups.js";
import { createStore } from "../lib/picks.js";
import { UNREACHABLE, createClient } from "../lib/server.js";
import { groupScreen } from "../screens.js";
import { FakeStorage, NOW, contextAt } from "./helpers.js";

import { createHandler } from "../../server/src/http.js";
import { createKickoff } from "../../server/src/kickoff.js";
import { MemoryStore } from "../../server/src/store.js";

const LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";

/** Kickoff's server, reached the way a browser reaches it. `net.down = true` cuts the connection. */
function kickoffOnline() {
  let n = 0;
  const clock = { now: NOW };
  const handle = createHandler({ kickoff: createKickoff({ store: new MemoryStore(), league: LEAGUE, random: () => 4821 + n++ }), now: () => clock.now });
  const net = { down: false, sent: [] };
  const fetch = async (url, init = {}) => {
    if (net.down) throw new TypeError("Failed to fetch");
    net.sent.push({ url, init });
    const answer = await handle({ method: init.method ?? "GET", path: url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { fetch, net, clock };
}

/** A phone: its own storage, its own key, and its own copy of its groups. */
function phone(online, storage = new FakeStorage()) {
  const store = createStore(storage);
  const device = createDevice(store);
  const client = createClient({ device, fetch: online.fetch, now: () => online.clock.now });
  return { storage, store, device, client, groups: createGroups({ store, device, client }) };
}

test("a device makes its key once, and keeps the private half to itself", async () => {
  const online = kickoffOnline();
  const ada = phone(online);
  const id = await ada.device.player();
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(await ada.device.player(), id);
  // Asked for twice at the same moment, it is still one key.
  const fresh = phone(online);
  const [a, b] = await Promise.all([fresh.device.player(), fresh.device.player()]);
  assert.equal(a, b);
  // Everything the device sends: the private half is never in it.
  await ada.groups.start({ name: "Sunday Ballers", playerName: "Ada" });
  const kept = JSON.parse(ada.storage.getItem("kickoff-device"));
  assert.ok(kept.privateJwk.d, "the private half is kept on the device");
  for (const { url, init } of online.net.sent) assert.ok(!`${url}${init.body ?? ""}`.includes(kept.privateJwk.d), "and is never sent");
});

test("start a group, share the code, and a friend joins from their own phone", async () => {
  const online = kickoffOnline();
  const [ada, bola] = [phone(online), phone(online)];
  const made = await ada.groups.start({ name: "Sunday Ballers", playerName: "Ada" });
  assert.equal(made.code, "SUNDAYB-4821");
  let view = await ada.groups.view();
  assert.equal(view.group.code, "SUNDAYB-4821");
  assert.equal(view.name, "Ada");

  online.clock.now += 60;
  await bola.groups.join({ code: "  sundayb-4821 ", playerName: "Bola" }); // typed loosely
  view = await bola.groups.view();
  assert.deepEqual(view.group.members.map((m) => m.name), ["Ada", "Bola"]);
  assert.equal(view.name, "Bola");

  // Ada's phone still shows one player until it asks again.
  assert.equal((await ada.groups.view()).group.members.length, 1);
  assert.equal(await ada.groups.refresh(), true, "something changed");
  assert.equal((await ada.groups.view()).group.members.length, 2);
  assert.equal(await ada.groups.refresh(), false, "nothing changed this time");

  // What each phone draws.
  const adaScreen = groupScreen(undefined, { ...(await contextAt(NOW, ada.store)), mine: await ada.groups.view() }).html;
  assert.match(adaScreen, /You started this group\. 2 players\./);
  assert.match(adaScreen, /data-plays="pl"/);
  const bolaScreen = groupScreen(undefined, { ...(await contextAt(NOW, bola.store)), mine: await bola.groups.view() }).html;
  assert.match(bolaScreen, /Ada started this group\. 2 players\./);
  assert.match(bolaScreen, /Bola<span class="tag">you<\/span>/);
  assert.ok(!bolaScreen.includes("data-plays"));
});

test("the group is still there when the browser is opened again, and on no other phone", async () => {
  const online = kickoffOnline();
  const ada = phone(online);
  await ada.groups.start({ name: "Sunday Ballers", playerName: "Ada" });
  const reopened = phone(online, ada.storage);
  assert.equal((await reopened.groups.view()).group.code, "SUNDAYB-4821");
  assert.equal((await reopened.groups.view()).player, (await ada.groups.view()).player);
  const stranger = phone(online);
  await stranger.groups.refresh();
  assert.equal((await stranger.groups.view()).group, null);
});

test("what the server refuses comes back in its own plain words", async () => {
  const online = kickoffOnline();
  const [ada, bola] = [phone(online), phone(online)];
  await ada.groups.start({ name: "Sunday Ballers", playerName: "Ada" });
  await assert.rejects(bola.groups.join({ code: "SUNDAYB-4821", playerName: "ada" }), /Someone in this group is already called ada/);
  await assert.rejects(bola.groups.join({ code: "NOBODY-0000", playerName: "Bola" }), /no group with that code/);
  await assert.rejects(bola.groups.join({ code: "hello", playerName: "Bola" }), /A code looks like BALLERS-4821/);
  await assert.rejects(bola.groups.join({ code: "SUNDAYB-4821", playerName: "" }), /Your name is missing/);
  await assert.rejects(ada.groups.start({ name: "", playerName: "Ada" }), /The group's name is missing/);
  assert.equal((await bola.groups.view()).group, null, "a refused join leaves nothing behind");
  // A code with odd characters is sent safely and simply not found.
  await assert.rejects(bola.groups.join({ code: "../admin/fixtures", playerName: "Bola" }), /not a group code/);
});

test("only whoever started the group can change what it plays", async () => {
  const online = kickoffOnline();
  const [ada, bola] = [phone(online), phone(online)];
  await ada.groups.start({ name: "Sunday Ballers", playerName: "Ada" });
  await bola.groups.join({ code: "SUNDAYB-4821", playerName: "Bola" });
  await assert.rejects(bola.groups.setPlays({ code: "SUNDAYB-4821", plays: ["nba"] }), /Only the person who started the group/);
  const changed = await ada.groups.setPlays({ code: "SUNDAYB-4821", plays: ["nba", "pl"] });
  assert.deepEqual(changed.plays, ["pl", "nba"]);
  assert.deepEqual((await ada.groups.view()).group.plays, ["pl", "nba"]);
  await bola.groups.refresh();
  assert.deepEqual((await bola.groups.view()).group.plays, ["pl", "nba"]);
});

test("a group is set up with the competitions ticked when it was started", async () => {
  const online = kickoffOnline();
  const ada = phone(online);
  const made = await ada.groups.start({ name: "Hoops only", playerName: "Ada", plays: ["nba", "wnba"] });
  assert.deepEqual(made.plays, ["nba", "wnba"]);
  const screen = groupScreen(undefined, { ...(await contextAt(NOW, ada.store)), mine: await ada.groups.view() }).html;
  assert.match(screen, /aria-checked="false" aria-label="Premier League"/);
  assert.match(screen, /aria-checked="true" aria-label="NBA"/);
  await assert.rejects(ada.groups.start({ name: "Nothing", playerName: "Ada", plays: [] }), /at least one competition/);
  // The form offers all four, ticked to begin with.
  const form = groupScreen("start", await contextAt(NOW, ada.store)).html;
  assert.equal(form.match(/type="checkbox" name="plays" value="(pl|cl|nba|wnba)" checked/g).length, 4);
});

test("a player in two groups can look at either", async () => {
  const online = kickoffOnline();
  const [ada, bola] = [phone(online), phone(online)];
  await ada.groups.start({ name: "Sunday Ballers", playerName: "Ada" });
  online.clock.now += 10;
  const office = await bola.groups.start({ name: "Office", playerName: "Bola" });
  await bola.groups.join({ code: "SUNDAYB-4821", playerName: "Bola B" });
  let view = await bola.groups.view();
  assert.equal(view.groups.length, 2);
  assert.equal(view.group.name, "Sunday Ballers", "the one just joined");
  assert.equal(view.name, "Bola B", "their name in this group");
  bola.groups.choose(office.code);
  view = await bola.groups.view();
  assert.equal(view.group.name, "Office");
  assert.equal(view.name, "Bola");
  // Refreshing keeps the one being looked at.
  await bola.groups.refresh();
  assert.equal((await bola.groups.view()).group.name, "Office");
});

test("offline, the phone shows what it last saw and says so; back online, it catches up", async () => {
  const online = kickoffOnline();
  const [ada, bola] = [phone(online), phone(online)];
  await ada.groups.start({ name: "Sunday Ballers", playerName: "Ada" });
  online.net.down = true;
  assert.equal(await ada.groups.refresh(), true, "going offline is a change worth drawing");
  let view = await ada.groups.view();
  assert.equal(view.offline, true);
  assert.equal(view.group.code, "SUNDAYB-4821");
  await assert.rejects(ada.groups.start({ name: "Another", playerName: "Ada" }), new RegExp(UNREACHABLE));
  online.net.down = false;
  await bola.groups.join({ code: "SUNDAYB-4821", playerName: "Bola" });
  assert.equal(await ada.groups.refresh(), true);
  view = await ada.groups.view();
  assert.equal(view.offline, false);
  assert.equal(view.group.members.length, 2);
});

test("if the server answers with something that is not an answer, the player is told to try again", async () => {
  const device = createDevice(createStore(new FakeStorage()));
  const broken = createClient({ device, fetch: async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }), now: () => NOW });
  await assert.rejects(broken.myGroups(), /could not do that just now/);
  const empty = createClient({ device, fetch: async () => new Response("", { status: 200 }), now: () => NOW });
  await assert.rejects(empty.group("SUNDAYB-4821"), /could not do that just now/);
});

test("damaged group records on the device are treated as none, not as a crash", async () => {
  const online = kickoffOnline();
  for (const junk of ["not json", "[1]", '{"groups":"x"}', '{"groups":[null,{"code":5}]}']) {
    const storage = new FakeStorage();
    storage.setItem("kickoff-groups", junk);
    const p = phone(online, storage);
    const view = await p.groups.view();
    assert.equal(view.group, null);
    assert.deepEqual(view.groups, []);
  }
});
