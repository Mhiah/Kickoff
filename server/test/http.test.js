import { test } from "node:test";
import assert from "node:assert/strict";

import { ADMIN_KEY, HOUR, LEAGUE, device, fixtures, server, serverWithFixtures } from "./helpers.js";

test("the list of matches is open to anyone, soonest first", async () => {
  const s = await serverWithFixtures();
  const { status, body } = await s.get("/api/fixtures");
  assert.equal(status, 200);
  assert.deepEqual(body.fixtures.map((f) => f.label), ["Premier League: Arsenal v Chelsea", "NBA: Knicks v Bucks"]);
  assert.equal(body.league, LEAGUE, "with the league they belong to, so a device can work out each match's id for itself");
  assert.equal(body.fixtures[0].id, s.f.football.id);
});

test("only the robot, with its key, can put matches on the list or freeze a bundle", async () => {
  const s = server();
  const f = await fixtures();
  const body = { fixtures: Object.values(f) };
  assert.equal((await s.handle({ method: "POST", path: "/api/admin/fixtures", headers: {}, body })).status, 403);
  assert.equal((await s.robot("/api/admin/fixtures", body, "a-guess")).status, 403);
  assert.equal((await s.robot("/api/admin/fixtures", body, ADMIN_KEY + "x")).status, 403);
  assert.equal((await s.robot(`/api/admin/freeze/${f.football.id}`, null, "a-guess")).status, 403);
  // A player's signature is not the robot's key.
  const ada = await device();
  assert.equal((await s.post(ada, "/api/admin/fixtures", body)).status, 403);
  assert.deepEqual((await s.get("/api/fixtures")).body.fixtures, []);
  assert.deepEqual((await s.robot("/api/admin/fixtures", body)).body, { added: 2, updated: 0 });
});

test("with no robot key set, the robot's addresses are switched off entirely", async () => {
  const s = server({ adminKey: null });
  const f = await fixtures();
  for (const key of ["", "null", "undefined", ADMIN_KEY]) {
    assert.equal((await s.robot("/api/admin/fixtures", { fixtures: Object.values(f) }, key)).status, 403);
  }
});

test("the robot can update a match's state and score, but never the facts that make its id", async () => {
  const s = await serverWithFixtures();
  const live = await s.robot("/api/admin/fixtures", { fixtures: [{ ...s.f.football, state: "final", score: { home: 2, away: 1 } }] });
  assert.deepEqual(live.body, { added: 0, updated: 1 });
  const seen = (await s.get("/api/fixtures")).body.fixtures.find((f) => f.id === s.f.football.id);
  assert.equal(seen.state, "final");
  assert.deepEqual(seen.score, { home: 2, away: 1 });
  const moved = await s.robot("/api/admin/fixtures", { fixtures: [{ ...s.f.football, kickoff: s.f.football.kickoff + HOUR }] });
  assert.equal(moved.status, 409);
  assert.match(moved.body.error, /cannot change. A moved match is a new match/);
  const junk = await s.robot("/api/admin/fixtures", { fixtures: [{ id: "nope" }] });
  assert.equal(junk.status, 400);
  assert.equal((await s.robot("/api/admin/fixtures", { fixtures: "all of them" })).status, 400);
  assert.equal((await s.robot("/api/admin/fixtures", null)).status, 400);
});

test("an address that does not exist, or the wrong kind of request, gets a plain answer", async () => {
  const s = server();
  assert.equal((await s.get("/api/nothing")).status, 404);
  assert.equal((await s.get("/api/picks")).status, 405);
  assert.equal((await s.handle({ method: "DELETE", path: "/api/fixtures", headers: {}, body: null })).status, 405);
  assert.equal((await s.get(`/api/matches/${"ab".repeat(32)}`)).status, 404);
  assert.equal((await s.get("/api/matches/not-a-match")).status, 404);
  assert.equal((await s.get("/api/fixtures?week=1")).status, 200, "anything after a ? is ignored");
});

test("a request signed for one address cannot be used at another", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  const forJoin = await ada.sign("POST", "/api/groups/BALLERS-4821/join", { playerName: "Ada", name: "Mine now" }, s.clock.now);
  const used = await s.handle({ method: "POST", path: "/api/groups", headers: {}, body: forJoin });
  assert.equal(used.status, 401);
});

test("nothing inside what a device sends can stand in for who it is or when it signed", async () => {
  const s = await serverWithFixtures();
  const [ada, mallory] = [await device(), await device()];
  const made = await s.post(mallory, "/api/groups", { name: "Mine", playerName: "Mallory", player: ada.player, at: 1 });
  assert.equal(made.body.startedBy, mallory.player);
  const groups = await s.post(mallory, "/api/me/groups", { player: ada.player });
  assert.deepEqual(groups.body.groups.map((g) => g.name), ["Mine"]);
});

test("a request signed with a clock that is far off is refused, with a hint", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  const answer = await s.post(ada, "/api/me/groups", {}, s.clock.now - HOUR);
  assert.equal(answer.status, 401);
  assert.match(answer.body.error, /Check the clock on your device\.$/);
});

test("if something breaks inside, the answer says so without saying what", async () => {
  const s = await serverWithFixtures();
  s.store.tableAll = async () => {
    throw new Error("database password is hunter2");
  };
  const answer = await s.get("/api/fixtures");
  assert.equal(answer.status, 500);
  assert.equal(answer.body.error, "Something went wrong on Kickoff's side. Try again.");
  assert.ok(!JSON.stringify(answer.body).includes("hunter2"));
});
