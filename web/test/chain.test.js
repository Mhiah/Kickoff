// Reading X Layer from the browser, and the screens that show it. The node here is the stand-in
// the picks engine's own tests use, holding a whole honest season, and the reading is done by the
// website's own copies of the engine's code.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ON_CHAIN } from "../config.js";
import { createChain } from "../lib/chain.js";
import { createStore } from "../lib/picks.js";
import { EMPTY } from "../lib/table.js";
import { checkScreen, recordScreen } from "../screens.js";
import { FakeStorage, NOW } from "./helpers.js";

import { FOOTBALL, fromHex, openingsPath, toHex } from "../../engine/src/index.js";
import { FIXTURES, LEAGUE, START, honestSeason } from "../../engine/test/chain.js";
import { FakeNode } from "../../engine/test/fake-node.js";
import { id } from "../../engine/test/helpers.js";

const league = toHex(LEAGUE);
const [ada, bola, chidi] = ["ada", "bola", "chidi"].map((n) => toHex(id(n)));

async function seasonOnANode() {
  const { inbox, files, parts } = await honestSeason();
  const site = Object.fromEntries(Object.entries(files).map(([match, file]) => [openingsPath(fromHex(match)), file]));
  return { node: new FakeNode({ league: LEAGUE, messages: inbox.messages, files: site }), parts };
}

/** What a screen is given, for a player in a group of the three. `rows` is what Kickoff's server says. */
function ctxWith(chain, { me = ada, rows = [["Ada", 7], ["Bola", 4], ["Chidi", 1]], picks = {}, fixtures = {}, unreachable = false } = {}) {
  const group = { code: "SUNDAYB-4821", name: "Sunday Ballers", plays: ["pl"], startedBy: ada, members: [{ player: ada, name: "Ada" }, { player: bola, name: "Bola" }, { player: chidi, name: "Chidi" }] };
  const board = { players: rows.length, rows: rows.map(([name, points], i) => ({ place: i + 1, name, threes: 0, ones: 0, points, you: false })) };
  return {
    now: NOW, real: true, league, fixtures, matchIds: {}, picks, lasting: true, editing: null,
    mine: { player: me, groups: [group], group, name: "Ada", offline: false, wallet: null },
    standings: { ...EMPTY, everyone: board, group: board }, chain, chainUnreachable: unreachable,
  };
}

test("the browser reads the league from X Layer: every lock, and the points that follow from it", async () => {
  const { node, parts } = await seasonOnANode();
  const chain = createChain({ store: createStore(new FakeStorage()), node: node.ask, now: () => NOW });
  assert.equal(chain.view(league), null, "nothing read yet");
  assert.equal(await chain.refresh({ league, players: [ada, bola, chidi] }), true);
  const seen = chain.view(league);
  assert.deepEqual(Object.fromEntries([ada, bola, chidi].map((p) => [p, seen.points[p].points])), { [ada]: 7, [bola]: 4, [chidi]: 1 });
  assert.equal(Object.keys(seen.matches).length, Object.keys(FIXTURES).length);
  for (const [key, fixture] of Object.entries(FIXTURES)) {
    const m = seen.matches[toHex(parts[key].match)];
    assert.equal(m.state, "final");
    assert.equal(m.lock.at, fixture.kickoff - 600, "locked ten minutes before kickoff");
    assert.equal(m.lock.root, toHex(parts[key].bundle.root));
  }
  assert.equal(seen.at, NOW);
  assert.ok(seen.block > 0);
  assert.equal(await chain.refresh({ league, players: [ada, bola, chidi] }), false, "nothing new, nothing changed");
  assert.equal(chain.view("ab".repeat(32)), null, "what is kept is for this league only");
});

test("a node that cannot be reached leaves what was read before, and says so", async () => {
  const { node } = await seasonOnANode();
  const chain = createChain({ store: createStore(new FakeStorage()), node: node.ask, now: () => NOW });
  await chain.refresh({ league, players: [ada] });
  node.failOn = "eth_blockNumber";
  assert.equal(await chain.refresh({ league, players: [ada] }), false);
  assert.equal(chain.unreachable, true);
  assert.equal(chain.view(league).points[ada].points, 7);
  node.failOn = null;
  await chain.refresh({ league, players: [ada] });
  assert.equal(chain.unreachable, false);
});

test("the Check screen puts the group's points from X Layer beside Kickoff's own", async () => {
  const { node } = await seasonOnANode();
  const chain = createChain({ store: createStore(new FakeStorage()), node: node.ask, now: () => NOW });
  await chain.refresh({ league, players: [ada, bola, chidi] });
  let html = checkScreen(undefined, ctxWith(chain.view(league))).html;
  const rows = (h) => [...h.matchAll(/<tr class="(you)?"><td><\/td><td>([^<]+)<\/td><td>(\d+)<\/td><td>([^<]+)<\/td><td class="pts">(.*?)<\/td><\/tr>/g)].map((m) => `${m[2]}: ${m[3]} on X Layer, ${m[4]} on Kickoff, ${m[5] === "✓" ? "same" : "not yet"}${m[1] ? " (you)" : ""}`);
  assert.deepEqual(rows(html), ["Ada: 7 on X Layer, 7 on Kickoff, same (you)", "Bola: 4 on X Layer, 4 on Kickoff, same", "Chidi: 1 on X Layer, 1 on Kickoff, same"]);
  assert.match(html, /Read from X Layer by your browser, not from Kickoff\./);
  assert.match(html, /3 matches locked\./);
  // Kickoff's addresses, each with a Copy button holding the whole value.
  assert.ok(html.includes(`data-copy="0x${league.slice(-40)}"`));
  assert.ok(html.includes(`data-copy="${ON_CHAIN.processor}"`));
  assert.match(html, /league 5, football 6, basketball 7, tennis 8/);
  for (const made of ["made up", "Nothing here is live yet", "Funke"]) assert.ok(!html.includes(made));

  // If Kickoff's server said something X Layer does not bear out, the row is not ticked.
  html = checkScreen(undefined, ctxWith(chain.view(league), { rows: [["Ada", 9], ["Bola", 4], ["Chidi", 1]] })).html;
  assert.deepEqual(rows(html)[0], "Ada: 7 on X Layer, 9 on Kickoff, not yet (you)");
});

test("the Check screen is plain about having nothing to show", () => {
  const empty = { league, at: NOW, block: 76_900_000, matches: {}, points: {} };
  assert.match(checkScreen(undefined, ctxWith(empty)).html, /Nothing locked on X Layer yet\./);
  assert.match(checkScreen(undefined, ctxWith(null)).html, /Reading X Layer…/);
  assert.match(checkScreen(undefined, ctxWith(null, { unreachable: true })).html, /X Layer could not be reached just now\./);
  const noGroup = ctxWith({ ...empty, matches: { ab: { kickoff: START, state: "pending", lock: { at: START - 600, count: 1, root: "cd", tx: null } } } });
  noGroup.mine = { ...noGroup.mine, group: null, groups: [] };
  assert.match(checkScreen(undefined, noGroup).html, /Start or join a group<\/a> to check its points\./);
});

test("the Check screen shows, for each of your picks, when X Layer locked it and that the pick is inside", () => {
  const match = "ab".repeat(32);
  const kickoff = NOW + 3600;
  const fixtures = { [match]: { id: match, real: true, comp: "cl", sport: FOOTBALL, home: "Sabah FK", away: "Barça", kickoff, label: "x" } };
  const entry = { sport: FOOTBALL, pick: { home: 1, away: 2 }, pickByte: 33, salt: "00", fingerprint: "11", sealedAt: NOW - 100, sent: { fingerprint: "11", at: NOW - 90 }, receipt: { index: 0, count: 1, path: [], root: "cd".repeat(32) } };
  const chain = { league, at: NOW, block: 1, points: {}, matches: { [match]: { kickoff, state: "pending", lock: { at: kickoff - 540, count: 1, root: "cd".repeat(32), tx: `0x${"ef".repeat(32)}` } } } };

  let html = checkScreen(undefined, ctxWith(chain, { picks: { [match]: entry }, fixtures })).html;
  assert.match(html, /<h2>Your picks on X Layer<\/h2>/);
  assert.match(html, /Sabah FK v Barça/);
  assert.match(html, /Locked on X Layer at \d\d:\d\d, 9 minutes before kickoff\. Your pick is in it\./);
  assert.ok(html.includes(`href="${ON_CHAIN.explorer}/tx/0x${"ef".repeat(32)}"`));
  assert.ok(!html.includes("You said"), "what you picked is on My record, not here");

  // A lock that does not hold this pick does not say it does.
  const other = { ...chain, matches: { [match]: { ...chain.matches[match], lock: { ...chain.matches[match].lock, root: "00".repeat(32) } } } };
  html = checkScreen(undefined, ctxWith(other, { picks: { [match]: entry }, fixtures })).html;
  assert.match(html, /Locked on X Layer at/);
  assert.ok(!html.includes("Your pick is in it."));

  // A pick whose match is not locked yet is not listed.
  const none = { ...chain, matches: {} };
  assert.ok(!checkScreen(undefined, ctxWith(none, { picks: { [match]: entry }, fixtures })).html.includes("Your picks on X Layer"));
});

test("My record is each pick, what you said, its stage and its points, and nothing about X Layer", () => {
  const match = "ab".repeat(32);
  const kickoff = NOW + 3600;
  const fixtures = { [match]: { id: match, real: true, comp: "cl", sport: FOOTBALL, home: "Sabah FK", away: "Barça", kickoff, label: "x" } };
  const entry = { sport: FOOTBALL, pick: { home: 1, away: 2 }, pickByte: 33, salt: "00", fingerprint: "11", sealedAt: NOW - 100, sent: { fingerprint: "11", at: NOW - 90 }, receipt: { index: 0, count: 1, path: [], root: "cd".repeat(32) } };
  const chain = { league, at: NOW, block: 1, points: {}, matches: { [match]: { kickoff, state: "pending", lock: { at: kickoff - 540, count: 1, root: "cd".repeat(32), tx: `0x${"ef".repeat(32)}` } } } };

  let html = recordScreen(undefined, ctxWith(chain, { picks: { [match]: entry }, fixtures })).html;
  assert.match(html, /Sabah FK v Barça/);
  assert.match(html, /You said 1 – 2/);
  assert.match(html, /<div class="state ">Locked in<\/div>/);
  assert.ok(!html.includes("X Layer") && !html.includes("See it"));
  html = recordScreen(undefined, ctxWith(null, { picks: { [match]: { ...entry, receipt: undefined } }, fixtures })).html;
  assert.match(html, /<div class="state ">Entered<\/div>/);
  assert.match(recordScreen(undefined, ctxWith(null)).html, /No picks yet\./);
});
