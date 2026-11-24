import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_MEMBERS } from "../src/kickoff.js";
import { device, server } from "./helpers.js";

test("starting a group gives a code, and the starter is its first member", async () => {
  const s = server();
  const ada = await device();
  const { status, body } = await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  assert.equal(status, 200);
  assert.equal(body.code, "SUNDAYB-4821");
  assert.equal(body.name, "Sunday Ballers");
  assert.equal(body.startedBy, ada.player);
  assert.deepEqual(body.plays, ["pl", "cl", "nba", "wnba"]);
  assert.deepEqual(body.members.map((m) => [m.name, m.player]), [["Ada", ada.player]]);
});

test("friends join with the code, however they type it", async () => {
  const s = server();
  const [ada, bola, chidi] = [await device(), await device(), await device()];
  const { body: group } = await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  s.clock.now += 60;
  assert.equal((await s.post(bola, `/api/groups/${group.code}/join`, { playerName: "Bola" })).status, 200);
  s.clock.now += 60;
  const joined = await s.post(chidi, "/api/groups/sundayb-4821/join", { playerName: "  Chidi  " });
  assert.equal(joined.status, 200);
  assert.deepEqual(joined.body.members.map((m) => m.name), ["Ada", "Bola", "Chidi"]);
  // Anyone with the code can see the group.
  const seen = await s.get("/api/groups/SUNDAYB-4821");
  assert.equal(seen.body.members.length, 3);
});

test("whoever started the group is listed first, even if someone joins in the same second", async () => {
  const s = server();
  for (let i = 0; i < 6; i++) {
    const [starter, friend] = [await device(), await device()];
    const { body: group } = await s.post(starter, "/api/groups", { name: "Same second", playerName: "Starter" });
    const joined = await s.post(friend, `/api/groups/${group.code}/join`, { playerName: "Friend" });
    assert.deepEqual(joined.body.members.map((m) => m.name), ["Starter", "Friend"]);
  }
});

test("a device can list the groups it is in", async () => {
  const s = server();
  const [ada, bola] = [await device(), await device()];
  const { body: one } = await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  s.clock.now += 10;
  const { body: two } = await s.post(bola, "/api/groups", { name: "Office", playerName: "Bola" });
  await s.post(ada, `/api/groups/${two.code}/join`, { playerName: "Ada O" });
  const mine = await s.post(ada, "/api/me/groups");
  assert.deepEqual(mine.body.groups.map((g) => g.code), [one.code, two.code]);
  const theirs = await s.post(bola, "/api/me/groups");
  assert.deepEqual(theirs.body.groups.map((g) => g.code), [two.code]);
});

test("two players in a group cannot have the same name, but one can change theirs", async () => {
  const s = server();
  const [ada, other] = [await device(), await device()];
  const { body: group } = await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  const clash = await s.post(other, `/api/groups/${group.code}/join`, { playerName: "ada" });
  assert.equal(clash.status, 409);
  assert.match(clash.body.error, /already called ada/);
  const renamed = await s.post(ada, `/api/groups/${group.code}/join`, { playerName: "Ada the Great" });
  assert.deepEqual(renamed.body.members.map((m) => m.name), ["Ada the Great"]);
  assert.equal(renamed.body.members.length, 1, "joining again does not add a second copy of you");
});

test("names are tidied, and bad ones are refused with a reason", async () => {
  const s = server();
  const ada = await device();
  const start = (name, playerName) => s.post(ada, "/api/groups", { name, playerName });
  assert.equal((await start("  Sunday    Ballers ", " Ada   Obi ")).body.name, "Sunday Ballers");
  assert.match((await start("", "Ada")).body.error, /The group's name is missing/);
  assert.match((await start("Ballers", "   ")).body.error, /Your name is missing/);
  assert.match((await start("x".repeat(41), "Ada")).body.error, /at most 40 characters/);
  assert.match((await start("Ballers", "y".repeat(25))).body.error, /at most 24 characters/);
  assert.match((await start("Ballers", "Ada‮evil")).body.error, /characters that are not allowed/);
  assert.match((await start("Ballers", 42)).body.error, /Your name is missing/);
  // A name is kept exactly as typed otherwise; the website makes it safe when it shows it.
  assert.equal((await start("<b>Ballers</b>", "Ada")).body.name, "<b>Ballers</b>");
  // A name with no letters still gets a code.
  assert.match((await start("123 !!!", "Ada")).body.code, /^GROUP-\d{4}$/);
});

test("a code that is taken is not handed out twice", async () => {
  const s = server();
  const ada = await device();
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" })).body.code);
  assert.equal(new Set(codes).size, 5);
  assert.ok(codes.every((c) => /^SUNDAYB-\d{4}$/.test(c)));
});

test("a wrong code and a code that is not a code are told apart", async () => {
  const s = server();
  const ada = await device();
  const missing = await s.post(ada, "/api/groups/NOBODY-0000/join", { playerName: "Ada" });
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /no group with that code/);
  const nonsense = await s.get("/api/groups/hello");
  assert.equal(nonsense.status, 400);
  assert.match(nonsense.body.error, /A code looks like BALLERS-4821/);
});

test("a group stops taking players when it is full", async () => {
  const s = server();
  const ada = await device();
  const { body: group } = await s.post(ada, "/api/groups", { name: "Big", playerName: "Ada" });
  // Fill it directly, to keep the test quick.
  for (let i = 1; i < MAX_MEMBERS; i++) await s.store.tableSet(`members:${group.code}`, String(i).padStart(64, "0"), { name: `Player ${i}`, joinedAt: s.clock.now });
  const late = await s.post(await device(), `/api/groups/${group.code}/join`, { playerName: "Late" });
  assert.equal(late.status, 409);
  assert.equal(MAX_MEMBERS, 30);
  assert.equal(late.body.error, "This group is full. A group can have 30 players.");
  assert.equal((await s.get(`/api/groups/${group.code}`)).body.members.length, 30);
  // Someone already in can still change their name.
  assert.equal((await s.post(ada, `/api/groups/${group.code}/join`, { playerName: "Ada B" })).status, 200);
});

test("a group can be started playing only some competitions, but never none", async () => {
  const s = server();
  const ada = await device();
  const some = await s.post(ada, "/api/groups", { name: "Hoops only", playerName: "Ada", plays: ["wnba", "nba"] });
  assert.deepEqual(some.body.plays, ["nba", "wnba"], "kept in Kickoff's own order");
  const none = await s.post(ada, "/api/groups", { name: "Nothing", playerName: "Ada", plays: [] });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /at least one competition/);
  assert.equal((await s.post(ada, "/api/groups", { name: "Tennis", playerName: "Ada", plays: ["tennis"] })).status, 400);
  assert.equal((await s.post(ada, "/api/groups", { name: "Odd", playerName: "Ada", plays: "pl" })).status, 400);
  // A refused group is not left half made.
  assert.deepEqual((await s.post(ada, "/api/me/groups")).body.groups.map((g) => g.name), ["Hoops only"]);
  // The last competition cannot be switched off afterwards either.
  const off = await s.post(ada, `/api/groups/${some.body.code}/plays`, { plays: [] });
  assert.equal(off.status, 400);
  assert.match(off.body.error, /at least one competition/);
});

test("only the person who started a group can change what it plays", async () => {
  const s = server();
  const [ada, bola] = [await device(), await device()];
  const { body: group } = await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  await s.post(bola, `/api/groups/${group.code}/join`, { playerName: "Bola" });
  const refused = await s.post(bola, `/api/groups/${group.code}/plays`, { plays: ["nba"] });
  assert.equal(refused.status, 403);
  const changed = await s.post(ada, `/api/groups/${group.code}/plays`, { plays: ["nba", "pl"] });
  assert.deepEqual(changed.body.plays, ["pl", "nba"], "kept in Kickoff's own order");
  assert.equal(changed.body.members.length, 2, "the members are untouched");
  assert.equal((await s.post(ada, `/api/groups/${group.code}/plays`, { plays: ["tennis"] })).status, 400);
});
