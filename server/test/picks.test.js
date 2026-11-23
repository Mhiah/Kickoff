import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FOOTBALL, BASKETBALL, basketballResult, buildBundle, encodePick, fromHex, loadCircuits, lockMessage, lockRef, matchMessage,
  resultMessage, sealPick, tableFromChain, toHex, verifyReceipt,
} from "../../engine/src/index.js";
import { CLOSES_BEFORE } from "../src/kickoff.js";
import { HOUR, LEAGUE, device, serverWithFixtures } from "./helpers.js";

/** A device seals a pick the way the website does: the pick stays on the device, only the fingerprint is returned to send. */
async function seal(who, fixture, pick) {
  const sealed = await sealPick({ league: LEAGUE, match: fixture.id, sport: fixture.sport, pick, player: who.player });
  return { fingerprint: toHex(sealed.fingerprint), salt: toHex(sealed.salt), pickByte: sealed.pickByte };
}

test("a sealed pick is taken in, and the server is told only its fingerprint", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  const mine = await seal(ada, s.f.football, { home: 2, away: 1 });
  const sent = await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: mine.fingerprint });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.fingerprint, mine.fingerprint);
  assert.equal(sent.body.closesAt, s.f.football.kickoff - CLOSES_BEFORE);
  // Everything the server holds about this pick: no score, no secret.
  const held = JSON.stringify([...s.store.tables].map(([name, table]) => [name, [...table]]));
  assert.ok(held.includes(mine.fingerprint));
  assert.ok(!held.includes(mine.salt), "the secret never reaches the server before kickoff");
  // Anyone looking at the match before kickoff sees a count and nothing else.
  const seen = await s.get(`/api/matches/${s.f.football.id}`);
  assert.equal(seen.body.sealedCount, 1);
  assert.deepEqual(seen.body.opened, []);
  assert.equal(seen.body.sealedBy, undefined, "who has picked is not shown before kickoff");
  assert.ok(!JSON.stringify(seen.body).includes(ada.player));
});

test("a pick can be changed until picks close, and the last one sent is the one that counts", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  const first = await seal(ada, s.f.football, { home: 2, away: 1 });
  const second = await seal(ada, s.f.football, { home: 0, away: 0 });
  await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: first.fingerprint });
  s.clock.now += 60;
  await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: second.fingerprint });
  const held = await s.post(ada, "/api/picks/mine", { match: s.f.football.id });
  assert.deepEqual(held.body.sealed, { fingerprint: second.fingerprint, locked: false });
  assert.equal((await s.get(`/api/matches/${s.f.football.id}`)).body.sealedCount, 1, "still one pick, not two");
});

test("picks close ten minutes before the start, to the second", async () => {
  const s = await serverWithFixtures();
  const [ada, bola] = [await device(), await device()];
  const closes = s.f.football.kickoff - CLOSES_BEFORE;
  s.clock.now = closes - 1;
  const inTime = await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: (await seal(ada, s.f.football, { home: 1, away: 0 })).fingerprint });
  assert.equal(inTime.status, 200);
  s.clock.now = closes;
  const late = await s.post(bola, "/api/picks", { match: s.f.football.id, fingerprint: (await seal(bola, s.f.football, { home: 1, away: 0 })).fingerprint });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /Picks for this match have closed/);
  // Nor can the one who was in time change theirs now.
  const change = await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: (await seal(ada, s.f.football, { home: 3, away: 3 })).fingerprint });
  assert.equal(change.status, 409);
});

test("CHEAT: nobody can send or change a pick in another player's name", async () => {
  const s = await serverWithFixtures();
  const [ada, mallory] = [await device(), await device()];
  const adas = await seal(ada, s.f.football, { home: 2, away: 1 });
  await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: adas.fingerprint });
  // Mallory signs with her own key but writes Ada's id inside what she sends.
  const forged = await s.post(mallory, "/api/picks", { match: s.f.football.id, fingerprint: "ee".repeat(32), player: ada.player });
  assert.equal(forged.status, 200, "it is taken in, but as Mallory's own pick");
  assert.equal((await s.post(ada, "/api/picks/mine", { match: s.f.football.id })).body.sealed.fingerprint, adas.fingerprint, "Ada's is untouched");
  assert.equal((await s.post(mallory, "/api/picks/mine", { match: s.f.football.id })).body.sealed.fingerprint, "ee".repeat(32));
  // Mallory takes Ada's signed request and swaps the fingerprint in it.
  const real = await ada.sign("POST", "/api/picks", { match: s.f.football.id, fingerprint: adas.fingerprint }, s.clock.now + 5);
  s.clock.now += 5;
  const swapped = { ...real, payload: JSON.stringify({ match: s.f.football.id, fingerprint: "ee".repeat(32) }) };
  const answer = await s.handle({ method: "POST", path: "/api/picks", headers: {}, body: swapped });
  assert.equal(answer.status, 401);
  assert.match(answer.body.error, /signature does not match/);
  // With no signature at all.
  const bare = await s.handle({ method: "POST", path: "/api/picks", headers: {}, body: { match: s.f.football.id, fingerprint: "ee".repeat(32), player: ada.player } });
  assert.equal(bare.status, 401);
});

test("CHEAT: an earlier pick cannot be played back over a later one", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  const first = await seal(ada, s.f.football, { home: 2, away: 1 });
  const second = await seal(ada, s.f.football, { home: 0, away: 0 });
  const firstRequest = await ada.sign("POST", "/api/picks", { match: s.f.football.id, fingerprint: first.fingerprint }, s.clock.now);
  assert.equal((await s.handle({ method: "POST", path: "/api/picks", headers: {}, body: firstRequest })).status, 200);
  s.clock.now += 30;
  await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: second.fingerprint });
  // Someone who overheard the first request sends it again, still inside the five minutes it is good for.
  s.clock.now += 30;
  const replay = await s.handle({ method: "POST", path: "/api/picks", headers: {}, body: firstRequest });
  assert.equal(replay.status, 409);
  assert.match(replay.body.error, /newer pick from this device is already in/);
  assert.equal((await s.post(ada, "/api/picks/mine", { match: s.f.football.id })).body.sealed.fingerprint, second.fingerprint);
});

test("things that are not picks, or not matches, are refused", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  const send = (payload) => s.post(ada, "/api/picks", payload);
  assert.equal((await send({ match: "ab".repeat(32), fingerprint: "cd".repeat(32) })).status, 404);
  assert.equal((await send({ match: "nope", fingerprint: "cd".repeat(32) })).status, 400);
  assert.equal((await send({ match: s.f.football.id, fingerprint: "CD".repeat(32) })).status, 400);
  assert.equal((await send({ match: s.f.football.id })).status, 400);
  assert.equal((await send({ match: s.f.football.id, fingerprint: { home: 2, away: 1 } })).status, 400, "a pick in the clear is not accepted");
});

test("a match that is called off stops taking picks", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  await s.robot("/api/admin/fixtures", { fixtures: [{ ...s.f.football, state: "void", note: "postponed" }] });
  const sent = await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: "cd".repeat(32) });
  assert.equal(sent.status, 409);
  assert.match(sent.body.error, /no longer open for picks/);
});

test("freezing bundles the picks exactly as the engine does, and after it nothing changes", async () => {
  const s = await serverWithFixtures();
  const players = [await device(), await device(), await device()];
  const sealed = [];
  for (const [i, who] of players.entries()) {
    sealed.push(await seal(who, s.f.football, { home: i, away: 1 }));
    await s.post(who, "/api/picks", { match: s.f.football.id, fingerprint: sealed[i].fingerprint });
  }
  s.clock.now = s.f.football.kickoff - CLOSES_BEFORE;
  const frozen = await s.robot(`/api/admin/freeze/${s.f.football.id}`);
  assert.equal(frozen.status, 200);
  assert.equal(frozen.body.count, 3);
  const expected = await buildBundle({ league: LEAGUE, match: s.f.football.id, entries: players.map((p, i) => ({ player: p.player, fingerprint: sealed[i].fingerprint })) });
  assert.equal(frozen.body.root, toHex(expected.root));
  // Freezing again gives the same bundle; it is never rebuilt.
  s.clock.now += 60;
  const again = await s.robot(`/api/admin/freeze/${s.f.football.id}`);
  assert.equal(again.body.root, frozen.body.root);
  assert.equal(again.body.frozenAt, frozen.body.frozenAt);
  // A pick slipped into storage afterwards changes nothing.
  await s.store.tableSet(`sealed:${s.f.football.id}`, "ff".repeat(32), { fingerprint: "aa".repeat(32), signedAt: 1, receivedAt: 1 });
  assert.equal((await s.robot(`/api/admin/freeze/${s.f.football.id}`)).body.count, 3);
  assert.equal((await s.get(`/api/matches/${s.f.football.id}`)).body.locked.root, frozen.body.root);
});

test("a match can be frozen with no picks in it", async () => {
  const s = await serverWithFixtures();
  const frozen = await s.robot(`/api/admin/freeze/${s.f.basketball.id}`);
  assert.equal(frozen.body.count, 0);
  assert.equal(frozen.body.root, toHex((await buildBundle({ league: LEAGUE, match: s.f.basketball.id, entries: [] })).root));
});

test("a bundle made after kickoff is refused, because it could never count", async () => {
  const s = await serverWithFixtures();
  s.clock.now = s.f.football.kickoff;
  const frozen = await s.robot(`/api/admin/freeze/${s.f.football.id}`);
  assert.equal(frozen.status, 409);
  assert.match(frozen.body.error, /has kicked off/);
});

test("every player gets a receipt that proves their pick is in the locked bundle", async () => {
  const s = await serverWithFixtures();
  const players = [await device(), await device(), await device(), await device(), await device()];
  for (const [i, who] of players.entries()) {
    await s.post(who, "/api/picks", { match: s.f.football.id, fingerprint: (await seal(who, s.f.football, { home: i, away: 0 })).fingerprint });
  }
  const early = await s.get(`/api/matches/${s.f.football.id}/receipt/${players[0].player}`);
  assert.equal(early.status, 409);
  assert.match(early.body.error, /not been locked yet/);
  const { body: frozen } = await s.robot(`/api/admin/freeze/${s.f.football.id}`);
  for (const who of players) {
    const { status, body: r } = await s.get(`/api/matches/${s.f.football.id}/receipt/${who.player}`);
    assert.equal(status, 200);
    assert.equal(r.root, frozen.root);
    assert.equal(r.count, 5);
    const receipt = { league: LEAGUE, match: r.match, player: r.player, fingerprint: r.fingerprint, index: r.index, count: r.count, path: r.path.map(fromHex), root: r.root };
    assert.equal(await verifyReceipt(receipt), true);
    // The same receipt does not prove a different fingerprint.
    assert.equal(await verifyReceipt({ ...receipt, fingerprint: "ee".repeat(32) }), false);
  }
  const outsider = await s.get(`/api/matches/${s.f.football.id}/receipt/${(await device()).player}`);
  assert.equal(outsider.status, 404);
});

test("a pick is opened only after the start, and only by the pick and secret that were sealed", async () => {
  const s = await serverWithFixtures();
  const [ada, bola] = [await device(), await device()];
  const adas = await seal(ada, s.f.football, { home: 2, away: 1 });
  const bolas = await seal(bola, s.f.football, { home: 1, away: 1 });
  await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: adas.fingerprint });
  await s.post(bola, "/api/picks", { match: s.f.football.id, fingerprint: bolas.fingerprint });
  await s.robot(`/api/admin/freeze/${s.f.football.id}`);
  const open = (who, mine) => s.post(who, "/api/opened", { match: s.f.football.id, pickByte: mine.pickByte, salt: mine.salt });

  s.clock.now = s.f.football.kickoff - 1;
  const early = await open(ada, adas);
  assert.equal(early.status, 409);
  assert.match(early.body.error, /cannot be opened before the match starts/);

  s.clock.now = s.f.football.kickoff;
  // CHEAT: Ada has seen the score and claims a different pick.
  const changed = await open(ada, { ...adas, pickByte: encodePick(FOOTBALL, { home: 3, away: 0 }) });
  assert.equal(changed.status, 409);
  assert.match(changed.body.error, /do not produce the fingerprint you sealed/);
  // CHEAT: Bola tries to open with Ada's pick and secret.
  assert.equal((await open(bola, adas)).status, 409);
  // CHEAT: someone with no pick in the bundle tries to open one.
  assert.equal((await open(await device(), adas)).status, 404);

  assert.equal((await open(ada, adas)).status, 200);
  const seen = await s.get(`/api/matches/${s.f.football.id}`);
  assert.deepEqual(seen.body.opened, [{ player: ada.player, pickByte: adas.pickByte }]);
  assert.equal(seen.body.sealedBy.length, 2, "after the start, everyone can see who sealed a pick");
  assert.ok(!JSON.stringify(seen.body).includes(adas.salt), "the secret is in the openings file, not the summary");
});

test("a pick that was never locked cannot be opened", async () => {
  const s = await serverWithFixtures();
  const ada = await device();
  const adas = await seal(ada, s.f.football, { home: 2, away: 1 });
  await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: adas.fingerprint });
  s.clock.now = s.f.football.kickoff + 60; // the robot never froze this match
  const opened = await s.post(ada, "/api/opened", { match: s.f.football.id, pickByte: adas.pickByte, salt: adas.salt });
  assert.equal(opened.status, 409);
  assert.match(opened.body.error, /No picks were locked for this match/);
});

test("the whole way through: from phones, through the server, to the table the engine builds from the chain", async () => {
  const s = await serverWithFixtures();
  const names = ["ada", "bola", "chidi"];
  const phones = {};
  for (const name of names) phones[name] = await device();
  const picks = {
    football: { ada: { home: 2, away: 1 }, bola: { home: 1, away: 0 }, chidi: { home: 0, away: 0 } },
    basketball: { ada: { winner: "home", band: "A" }, bola: { winner: "home", band: "B" }, chidi: { winner: "away", band: "B" } },
  };
  const results = { football: { home: 2, away: 1 }, basketball: basketballResult({ home: 104, away: 101 }) };
  const sports = { football: FOOTBALL, basketball: BASKETBALL };

  // The league's inbox on X Layer, as a list. The robot's messages are made with the engine.
  const account = `0x${LEAGUE.slice(24)}`;
  const inbox = [];
  const post = (timestamp, { ref, payload }) => inbox.push({ index: inbox.length, from: account, timestamp, ref, payload });
  for (const f of Object.values(s.f)) post(s.clock.now, await matchMessage(LEAGUE, { sport: f.sport, kickoff: f.kickoff, bestOf: 0, label: f.label }));

  const secrets = {};
  for (const key of ["football", "basketball"]) {
    secrets[key] = {};
    for (const name of names) {
      secrets[key][name] = await seal(phones[name], s.f[key], picks[key][name]);
      assert.equal((await s.post(phones[name], "/api/picks", { match: s.f[key].id, fingerprint: secrets[key][name].fingerprint })).status, 200);
    }
  }
  const files = {};
  for (const key of ["football", "basketball"]) {
    const f = s.f[key];
    // Ten minutes before the start the robot freezes the bundle and locks it on chain.
    s.clock.now = f.kickoff - CLOSES_BEFORE;
    const { body: frozen } = await s.robot(`/api/admin/freeze/${f.id}`);
    const bundle = await buildBundle({ league: LEAGUE, match: f.id, entries: frozen.entries });
    assert.equal(toHex(bundle.root), frozen.root);
    post(s.clock.now, await lockMessage(bundle));
    // After the start the phones open their picks. Chidi never opens his football pick.
    s.clock.now = f.kickoff + 60;
    for (const name of names) {
      if (key === "football" && name === "chidi") continue;
      const mine = secrets[key][name];
      assert.equal((await s.post(phones[name], "/api/opened", { match: f.id, pickByte: mine.pickByte, salt: mine.salt })).status, 200);
    }
    const file = await s.get(`/api/matches/${f.id}/openings`);
    assert.equal(file.status, 200);
    files[f.id] = JSON.stringify(file.body);
    post(f.kickoff + 2 * HOUR, resultMessage(fromHex(f.id), encodePick(sports[key], results[key])));
  }

  const circuit = (name) => readFileSync(new URL(`../../circuits/out/${name}.hex`, import.meta.url), "utf8");
  const circuits = loadCircuits({ football: circuit("football"), basketball: circuit("basketball"), tennis: circuit("tennis") });
  const { table, ignored } = await tableFromChain({ league: fromHex(LEAGUE), account, messages: inbox, openingsFiles: files, circuits });
  assert.deepEqual(ignored, []);
  const points = Object.fromEntries(table.map((row) => [names.find((n) => phones[n].player === toHex(row.player)) ?? "?", row.points]));
  // Football 2-1: Ada exact (3), Bola right winner (1), Chidi never opened (0).
  // Basketball, home by 3 (the "1 to 5" band, A): Ada winner and band (3), Bola winner only (1), Chidi wrong (0).
  assert.deepEqual(points, { ada: 6, bola: 2, chidi: 0 });
  // What the server says it locked is what is on the chain.
  const locked = (await s.get(`/api/matches/${s.f.football.id}`)).body.locked;
  const onChain = toHex(await lockRef({ league: LEAGUE, match: s.f.football.id, count: locked.count, root: locked.root }));
  assert.ok(inbox.some((m) => toHex(m.ref) === onChain), "the lock on chain covers the bundle the server froze");
});
