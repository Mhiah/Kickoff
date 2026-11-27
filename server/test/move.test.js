// Moving a player to another phone: the server holds a locked copy of the phone's key for ten
// minutes and hands it over once, to whoever knows where it was left.
import { test } from "node:test";
import assert from "node:assert/strict";

import { MOVE_LASTS, MOVE_MAX, MOVE_TRIES } from "../src/kickoff.js";
import { device, server } from "./helpers.js";

const PLACE = "ab".repeat(32);
const BOX = Buffer.from("a locked copy of a phone's key, which the server cannot read").toString("base64");

test("a locked copy is left, handed over once to whoever knows where it is, and then it is gone", async () => {
  const s = server();
  const [first, other, third] = [await device(), await device(), await device()];
  const left = await s.post(first, "/api/move", { id: PLACE, box: BOX });
  assert.equal(left.status, 200);
  assert.deepEqual(left.body, { until: s.clock.now + MOVE_LASTS });
  const got = await s.post(other, "/api/move/take", { id: PLACE });
  assert.deepEqual(got.body, { box: BOX });
  const again = await s.post(third, "/api/move/take", { id: PLACE });
  assert.equal(again.status, 404);
  assert.equal(again.body.error, "That code is not right, or it has run out.");
});

test("it runs out after ten minutes", async () => {
  const s = server();
  const [first, other] = [await device(), await device()];
  await s.post(first, "/api/move", { id: PLACE, box: BOX });
  s.clock.now += MOVE_LASTS - 1;
  await s.post(first, "/api/move", { id: PLACE, box: BOX }); // asked for again: ten minutes from now
  s.clock.now += MOVE_LASTS;
  assert.equal((await s.post(other, "/api/move/take", { id: PLACE })).status, 404);
});

test("a phone has one copy waiting at a time: a new one ends the one before", async () => {
  const s = server();
  const [first, other] = [await device(), await device()];
  await s.post(first, "/api/move", { id: PLACE, box: BOX });
  await s.post(first, "/api/move", { id: "cd".repeat(32), box: BOX });
  assert.equal((await s.post(other, "/api/move/take", { id: PLACE })).status, 404);
  assert.equal((await s.post(other, "/api/move/take", { id: "cd".repeat(32) })).status, 200);
});

test("CHEAT: a phone that keeps guessing is stopped after five wrong tries, for ten minutes", async () => {
  const s = server();
  const [first, guesser, other] = [await device(), await device(), await device()];
  await s.post(first, "/api/move", { id: PLACE, box: BOX });
  for (let i = 0; i < MOVE_TRIES; i++) {
    const wrong = await s.post(guesser, "/api/move/take", { id: i.toString(16).padStart(64, "0") });
    assert.equal(wrong.status, 404);
  }
  const stopped = await s.post(guesser, "/api/move/take", { id: PLACE });
  assert.equal(stopped.status, 429);
  assert.equal(stopped.body.error, "Too many tries. Wait ten minutes, then get a new code.");
  // Another phone is not held up by it, and the copy is still there.
  assert.equal((await s.post(other, "/api/move/take", { id: PLACE })).status, 200);
  // Ten minutes on, the guesser may try again.
  s.clock.now += MOVE_LASTS;
  assert.equal((await s.post(guesser, "/api/move/take", { id: PLACE })).status, 404);
});

test("a right code wipes the count of wrong tries", async () => {
  const s = server();
  const [first, other] = [await device(), await device()];
  for (let i = 0; i < MOVE_TRIES - 1; i++) await s.post(other, "/api/move/take", { id: i.toString(16).padStart(64, "0") });
  await s.post(first, "/api/move", { id: PLACE, box: BOX });
  assert.equal((await s.post(other, "/api/move/take", { id: PLACE })).status, 200);
  for (let i = 0; i < MOVE_TRIES; i++) assert.equal((await s.post(other, "/api/move/take", { id: i.toString(16).padStart(64, "0") })).status, 404);
});

test("only something shaped like a locked copy is held, and only a signed request leaves or collects one", async () => {
  const s = server();
  const first = await device();
  for (const bad of [{ id: "short", box: BOX }, { id: PLACE.toUpperCase(), box: BOX }, { id: PLACE }, { id: PLACE, box: "" }, { id: PLACE, box: "not base64 !!!".repeat(8) }, { id: PLACE, box: 7 }, { id: PLACE, box: "A".repeat(MOVE_MAX + 4) }]) {
    assert.equal((await s.post(first, "/api/move", bad)).status, 400);
  }
  assert.equal((await s.post(first, "/api/move/take", { id: "nothing like a place" })).status, 404);
  for (const path of ["/api/move", "/api/move/take"]) {
    const unsigned = await s.handle({ method: "POST", path, headers: {}, body: { id: PLACE, box: BOX } });
    assert.equal(unsigned.status, 401);
  }
  assert.equal((await s.get("/api/move")).status, 405);
});
