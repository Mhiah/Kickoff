// Solo predictions: playing with no group, under a name of your own.
import { test } from "node:test";
import assert from "node:assert/strict";

import { sealPick, toHex } from "../../engine/src/index.js";
import { device, serverWithFixtures } from "./helpers.js";

const names = (board) => board.rows.map((r) => r.name);
async function seal(s, who) {
  const p = await sealPick({ league: s.kickoff.league, match: s.f.basketball.id, sport: s.f.basketball.sport, pick: { winner: "home", band: "B" }, player: who.player });
  return s.post(who, "/api/picks", { match: s.f.basketball.id, fingerprint: toHex(p.fingerprint) });
}
const board = async (s, who) => (await s.post(who, "/api/me/table", {})).body.everyone;

test("a player in no group can choose a name, and it is the name the leaderboard shows", async () => {
  const s = await serverWithFixtures();
  const solo = await device();
  const named = await s.post(solo, "/api/me/name", { name: "  Tolu  " });
  assert.deepEqual([named.status, named.body], [200, { name: "Tolu" }]);
  assert.equal((await seal(s, solo)).status, 200);
  assert.deepEqual(names(await board(s, solo)), ["Tolu"]);
  // They are in no group, and need none.
  assert.deepEqual((await s.post(solo, "/api/me/groups", {})).body.groups, []);
});

test("someone who predicted before choosing a name gets the name they choose, in place of the stand-in", async () => {
  const s = await serverWithFixtures();
  const solo = await device();
  await seal(s, solo);
  assert.deepEqual(names(await board(s, solo)), [`Player ${solo.player.slice(0, 4).toUpperCase()}`]);
  assert.equal((await s.post(solo, "/api/me/name", { name: "Tolu" })).status, 200);
  assert.deepEqual(names(await board(s, solo)), ["Tolu"]);
  // The same name carries into a group started later, and can be changed there like anyone's.
  const g = (await s.post(solo, "/api/groups", { name: "Late Club", playerName: "Tolu" })).body;
  assert.equal(g.members[0].name, "Tolu");
});

test("CHEAT: a solo player cannot take a name somebody has, and nobody can take theirs", async () => {
  const s = await serverWithFixtures();
  const [ada, solo, other] = [await device(), await device(), await device()];
  await s.post(ada, "/api/groups", { name: "Ballers", playerName: "Ada" });
  // Ada's name is taken, however it is typed.
  for (const name of ["Ada", "ada", " ADA "]) {
    const r = await s.post(solo, "/api/me/name", { name });
    assert.deepEqual([r.status, r.body.error], [409, "That name is taken. Choose another."]);
  }
  assert.equal((await s.post(solo, "/api/me/name", { name: "Tolu" })).status, 200);
  // Nobody can now join or start a group as Tolu, or choose it solo.
  assert.equal((await s.post(other, "/api/me/name", { name: "tolu" })).status, 409);
  assert.equal((await s.post(other, "/api/groups", { name: "Copycats", playerName: "Tolu" })).status, 409);
  // Choosing the name you already have is fine, and so is changing it. The old one is then free.
  assert.equal((await s.post(solo, "/api/me/name", { name: "Tolu" })).status, 200);
  assert.equal((await s.post(solo, "/api/me/name", { name: "Tolu B" })).status, 200);
  assert.equal((await s.post(other, "/api/me/name", { name: "Tolu" })).status, 200);
});

test("CHEAT: a name has to be a real one, and the request has to be signed by the phone", async () => {
  const s = await serverWithFixtures();
  const solo = await device();
  for (const name of ["", "   ", null, 7, "x".repeat(25)]) assert.equal((await s.post(solo, "/api/me/name", { name })).status, 400, JSON.stringify(name));
  // Unsigned, or signed for another address: refused.
  assert.ok([400, 401, 403].includes((await s.handle({ method: "POST", path: "/api/me/name", headers: {}, body: { name: "Tolu", player: solo.player } })).status));
  const elsewhere = await solo.sign("POST", "/api/me/groups", { name: "Tolu" }, s.clock.now);
  assert.ok([400, 401, 403].includes((await s.handle({ method: "POST", path: "/api/me/name", headers: {}, body: elsewhere })).status));
  assert.deepEqual(names(await board(s, solo)), []);
});
