import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOOTBALL, TENNIS, buildBundle, checkOpening, fingerprintOf, receiptFor, sealPick,
} from "../src/index.js";
import { KICKOFF, LEAGUE, MATCH, OTHER_MATCH, id } from "./helpers.js";

const ADA = id("ada");
const BOLA = id("bola");
const CHIDI = id("chidi");

/** Three players seal football picks, the league bundles them and locks the bundle before kickoff. */
async function aMatch({ lockedAt = KICKOFF - 600 } = {}) {
  const picks = {
    ada: { player: ADA, pick: { home: 2, away: 1 } },
    bola: { player: BOLA, pick: { home: 0, away: 0 } },
    chidi: { player: CHIDI, pick: { home: 1, away: 3 } },
  };
  const sealed = {};
  for (const [name, p] of Object.entries(picks)) {
    sealed[name] = await sealPick({ league: LEAGUE, match: MATCH, sport: FOOTBALL, pick: p.pick, player: p.player });
  }
  const bundle = await buildBundle({
    league: LEAGUE,
    match: MATCH,
    entries: Object.entries(picks).map(([name, p]) => ({ player: p.player, fingerprint: sealed[name].fingerprint })),
  });
  const lock = { root: bundle.root, count: bundle.count, lockedAt };
  const opening = (name) => ({
    league: LEAGUE,
    match: MATCH,
    sport: FOOTBALL,
    pickByte: sealed[name].pickByte,
    player: picks[name].player,
    salt: sealed[name].salt,
  });
  return { picks, sealed, bundle, lock, opening };
}

test("an honest pick, sealed before kickoff and opened after, is accepted", async () => {
  const m = await aMatch();
  for (const name of ["ada", "bola", "chidi"]) {
    const result = await checkOpening({
      opening: m.opening(name),
      receipt: await receiptFor(m.bundle, m.picks[name].player),
      lock: m.lock,
      kickoff: KICKOFF,
    });
    assert.equal(result.ok, true, name);
    assert.deepEqual(result.pick, m.picks[name].pick, name);
  }
});

test("CHEAT: changing your pick after kickoff. Refused, it no longer matches what was sealed", async () => {
  const m = await aMatch();
  const receipt = await receiptFor(m.bundle, ADA);
  const changed = { ...m.opening("ada"), pickByte: 0x13 }; // sealed 2-1, now claims 3-1
  assert.deepEqual(await checkOpening({ opening: changed, receipt, lock: m.lock, kickoff: KICKOFF }), {
    ok: false,
    reason: "does-not-match",
  });
});

test("CHEAT: opening with the wrong salt. Refused", async () => {
  const m = await aMatch();
  const receipt = await receiptFor(m.bundle, ADA);
  const wrongSalt = { ...m.opening("ada"), salt: id("a guess at the salt") };
  assert.equal((await checkOpening({ opening: wrongSalt, receipt, lock: m.lock, kickoff: KICKOFF })).reason, "does-not-match");
});

test("CHEAT: copying another player's sealed pick as your own. Refused when it is opened", async () => {
  // Bola cannot read Ada's pick, but copies Ada's fingerprint into the bundle under his own name,
  // hoping to open it once Ada has shown her pick and salt.
  const m = await aMatch();
  const copied = await buildBundle({
    league: LEAGUE,
    match: MATCH,
    entries: [
      { player: ADA, fingerprint: m.sealed.ada.fingerprint },
      { player: BOLA, fingerprint: m.sealed.ada.fingerprint },
    ],
  });
  const lock = { root: copied.root, count: copied.count, lockedAt: KICKOFF - 600 };

  // Ada opens hers. It is accepted.
  const adas = await checkOpening({ opening: m.opening("ada"), receipt: await receiptFor(copied, ADA), lock, kickoff: KICKOFF });
  assert.equal(adas.ok, true);

  // Bola now knows Ada's pick and salt and opens "his" with them. The fingerprint covers the
  // player, so Ada's fingerprint does not match a pick opened under Bola's name.
  const bolas = { ...m.opening("ada"), player: BOLA };
  assert.deepEqual(await checkOpening({ opening: bolas, receipt: await receiptFor(copied, BOLA), lock, kickoff: KICKOFF }), {
    ok: false,
    reason: "does-not-match",
  });
});

test("CHEAT: using someone else's receipt. Refused", async () => {
  const m = await aMatch();
  const adasReceipt = await receiptFor(m.bundle, ADA);
  const result = await checkOpening({ opening: m.opening("bola"), receipt: adasReceipt, lock: m.lock, kickoff: KICKOFF });
  assert.equal(result.reason, "wrong-player");
});

test("CHEAT: the league locks the bundle at or after kickoff. Nothing in it counts", async () => {
  for (const lockedAt of [KICKOFF, KICKOFF + 1, KICKOFF + 3600]) {
    const m = await aMatch({ lockedAt });
    const result = await checkOpening({
      opening: m.opening("ada"),
      receipt: await receiptFor(m.bundle, ADA),
      lock: m.lock,
      kickoff: KICKOFF,
    });
    assert.deepEqual(result, { ok: false, reason: "locked-late" }, `locked ${lockedAt - KICKOFF}s after kickoff`);
  }
  // One second before kickoff is in time.
  const justInTime = await aMatch({ lockedAt: KICKOFF - 1 });
  const ok = await checkOpening({
    opening: justInTime.opening("ada"),
    receipt: await receiptFor(justInTime.bundle, ADA),
    lock: justInTime.lock,
    kickoff: KICKOFF,
  });
  assert.equal(ok.ok, true);
});

test("CHEAT: the league slips a pick in after kickoff by making a new bundle. Refused, it is not the bundle on chain", async () => {
  const m = await aMatch();
  // After the match the league builds a second bundle that also holds a winning pick for a friend.
  const friend = id("the host's friend");
  const winning = await sealPick({ league: LEAGUE, match: MATCH, sport: FOOTBALL, pick: { home: 2, away: 1 }, player: friend });
  const second = await buildBundle({
    league: LEAGUE,
    match: MATCH,
    entries: [...m.bundle.entries, { player: friend, fingerprint: winning.fingerprint }],
  });
  const result = await checkOpening({
    opening: { league: LEAGUE, match: MATCH, sport: FOOTBALL, pickByte: winning.pickByte, player: friend, salt: winning.salt },
    receipt: await receiptFor(second, friend),
    lock: m.lock, // what is on chain is still the first bundle
    kickoff: KICKOFF,
  });
  assert.deepEqual(result, { ok: false, reason: "wrong-bundle" });
});

test("CHEAT: a pick left out of the bundle. The player can show their receipt is for a different bundle", async () => {
  // Ada sealed a pick and the league gave her a receipt, then put a bundle on chain without her.
  const m = await aMatch();
  const adasReceipt = await receiptFor(m.bundle, ADA);
  const without = await buildBundle({ league: LEAGUE, match: MATCH, entries: m.bundle.entries.filter((e) => !e.player.every((b, i) => b === ADA[i])) });
  const lock = { root: without.root, count: without.count, lockedAt: KICKOFF - 600 };
  const result = await checkOpening({ opening: m.opening("ada"), receipt: adasReceipt, lock, kickoff: KICKOFF });
  assert.deepEqual(result, { ok: false, reason: "wrong-bundle" });
  assert.equal(without.count, 2);
});

test("CHEAT: a receipt that claims a different bundle size from the one on chain. Refused", async () => {
  const m = await aMatch();
  const receipt = { ...(await receiptFor(m.bundle, ADA)), count: m.bundle.count + 1 };
  const result = await checkOpening({ opening: m.opening("ada"), receipt, lock: m.lock, kickoff: KICKOFF });
  assert.deepEqual(result, { ok: false, reason: "wrong-bundle" });
});

test("CHEAT: reusing a pick from another match. Refused", async () => {
  const m = await aMatch();
  const receipt = await receiptFor(m.bundle, ADA);
  const otherMatch = { ...m.opening("ada"), match: OTHER_MATCH };
  assert.equal((await checkOpening({ opening: otherMatch, receipt, lock: m.lock, kickoff: KICKOFF })).reason, "wrong-match");
});

test("CHEAT: a forged receipt. Refused, it does not prove the pick is in the bundle", async () => {
  const m = await aMatch();
  const receipt = await receiptFor(m.bundle, ADA);
  const forged = { ...receipt, fingerprint: id("a pick that was never sealed") };
  assert.equal((await checkOpening({ opening: m.opening("ada"), receipt: forged, lock: m.lock, kickoff: KICKOFF })).reason, "not-in-bundle");
});

test("a pick that cannot happen is refused even if it was sealed properly", async () => {
  // Someone seals "player A wins in 2 sets" for a best-of-5 match by skipping the app.
  const pickByte = 0; // A in 2 sets
  const salt = id("salt");
  const fingerprint = await fingerprintOf({ league: LEAGUE, match: MATCH, sport: TENNIS, pickByte, player: ADA, salt });
  const bundle = await buildBundle({ league: LEAGUE, match: MATCH, entries: [{ player: ADA, fingerprint }] });
  const lock = { root: bundle.root, count: bundle.count, lockedAt: KICKOFF - 600 };
  const opening = { league: LEAGUE, match: MATCH, sport: TENNIS, pickByte, player: ADA, salt };
  const receipt = await receiptFor(bundle, ADA);

  assert.deepEqual(await checkOpening({ opening, receipt, lock, kickoff: KICKOFF, matchInfo: { bestOf: 5 } }), {
    ok: false,
    reason: "impossible-pick",
  });
  // The same pick is fine in a best of 3.
  const inThree = await checkOpening({ opening, receipt, lock, kickoff: KICKOFF, matchInfo: { bestOf: 3 } });
  assert.deepEqual(inThree.pick, { winner: "A", sets: 2 });
});
