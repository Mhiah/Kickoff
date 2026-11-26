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

import { FOOTBALL, fromHex, openingsPath, toHex, writeOpenings } from "../../engine/src/index.js";
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

test("the browser keeps the joining times X Layer holds, and the Check screen checks the order with them", async () => {
  // The league publishes when each player joined, with the opened picks: Chidi first, then Ada, then Bola.
  const { inbox, files, parts } = await honestSeason();
  const joinedAt = { [ada]: 2000, [bola]: 3000, [chidi]: 1000 };
  for (const part of Object.values(parts)) {
    files[toHex(part.match)] = writeOpenings({ match: part.match, openings: part.openings, entries: part.entries.map((e) => ({ ...e, joined: joinedAt[toHex(e.player)] })) });
  }
  const site = Object.fromEntries(Object.entries(files).map(([match, file]) => [openingsPath(fromHex(match)), file]));
  const node = new FakeNode({ league: LEAGUE, messages: inbox.messages, files: site });
  const chain = createChain({ store: createStore(new FakeStorage()), node: node.ask, now: () => NOW });
  await chain.refresh({ league, players: [ada, bola, chidi] });
  const seen = chain.view(league);
  assert.deepEqual(seen.joined, joinedAt);

  // Points decide first: Ada 7, Bola 4, Chidi 1, and Kickoff says the same.
  assert.match(checkScreen(undefined, ctxWith(seen)).html, /The order is the same on X Layer\. ✓/);

  // Level on points, whoever joined first is ahead. Here all three are level on X Layer.
  const level = { ...seen, points: Object.fromEntries([ada, bola, chidi].map((p) => [p, { points: 3, threes: 1, ones: 0 }])) };
  assert.match(checkScreen(undefined, ctxWith(level, { rows: [["Chidi", 3], ["Ada", 3], ["Bola", 3]] })).html, /The order is the same on X Layer\. ✓/);
  // If Kickoff put them in another order, the screen says so.
  const wrong = checkScreen(undefined, ctxWith(level, { rows: [["Ada", 3], ["Chidi", 3], ["Bola", 3]] })).html;
  assert.match(wrong, /The order on X Layer is different just now\./);
  assert.ok(!wrong.includes("The order is the same"));

  // While the points do not agree yet, nothing is said about the order.
  assert.ok(!checkScreen(undefined, ctxWith(seen, { rows: [["Ada", 9], ["Bola", 4], ["Chidi", 1]] })).html.includes("The order"));
  // And nothing is said when X Layer holds no joining times, as in a read kept from before they were published.
  assert.ok(!checkScreen(undefined, ctxWith({ ...seen, joined: {} })).html.includes("The order"));
  const { joined: _, ...older } = seen;
  assert.ok(!checkScreen(undefined, ctxWith(older)).html.includes("The order"));
});

test("a brand's group is checked from the top of its leaderboard and your own row, since it is too big to list", async () => {
  const { node } = await seasonOnANode();
  const chain = createChain({ store: createStore(new FakeStorage()), node: node.ask, now: () => NOW });
  await chain.refresh({ league, players: [ada, bola, chidi] });
  const c = ctxWith(chain.view(league), { me: chidi });
  // The group lists only Chidi's own seat. The ids to look up come with the leaderboard's rows.
  c.mine.group = { code: "WORLDCU-4821", name: "World Cup Predictions", plays: ["pl"], startedBy: null, brand: "OKX", players: 3, members: [{ player: chidi, name: "Chidi" }] };
  c.standings.group.rows = [["Ada", ada, 7], ["Bola", bola, 4], ["Chidi", chidi, 1]].map(([name, id, points], i) => ({ place: i + 1, name, threes: 0, ones: 0, points, you: id === chidi, players: [id] }));
  const html = checkScreen(undefined, c).html;
  assert.match(html, /<td>Ada<\/td><td>7<\/td><td>7<\/td><td class="pts">✓<\/td>/);
  assert.match(html, /<td>Bola<\/td><td>4<\/td><td>4<\/td><td class="pts">✓<\/td>/);
  assert.match(html, /<tr class="you"><td><\/td><td>Chidi<\/td><td>1<\/td><td>1<\/td><td class="pts">✓<\/td>/);
  assert.match(html, /The top of the group's leaderboard, and you\./);
  // Kickoff saying something X Layer does not is still caught.
  c.standings.group.rows[1].points = 5;
  assert.match(checkScreen(undefined, c).html, /<td>Bola<\/td><td>4<\/td><td>5<\/td><td class="pts"><span class="muted">Not yet<\/span><\/td>/);
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

test("the Check screen shows, for each of your predictions, when X Layer locked it and that the prediction is inside", () => {
  const match = "ab".repeat(32);
  const kickoff = NOW + 3600;
  const fixtures = { [match]: { id: match, real: true, comp: "cl", sport: FOOTBALL, home: "Sabah FK", away: "Barça", kickoff, label: "x" } };
  const entry = { sport: FOOTBALL, pick: { home: 1, away: 2 }, pickByte: 33, salt: "00", fingerprint: "11", sealedAt: NOW - 100, sent: { fingerprint: "11", at: NOW - 90 }, receipt: { index: 0, count: 1, path: [], root: "cd".repeat(32) } };
  const chain = { league, at: NOW, block: 1, points: {}, matches: { [match]: { kickoff, state: "pending", lock: { at: kickoff - 540, count: 1, root: "cd".repeat(32), tx: `0x${"ef".repeat(32)}` } } } };

  let html = checkScreen(undefined, ctxWith(chain, { picks: { [match]: entry }, fixtures })).html;
  assert.match(html, /<h2>Your predictions on X Layer<\/h2>/);
  assert.match(html, /Sabah FK v Barça/);
  assert.match(html, /Locked on X Layer at \d\d:\d\d, 9 minutes before kickoff\. Your prediction is in it\./);
  assert.ok(html.includes(`href="${ON_CHAIN.explorer}/tx/0x${"ef".repeat(32)}"`));
  assert.ok(!html.includes("You said"), "what you predicted is on My record, not here");

  // A lock that does not hold this pick does not say it does.
  const other = { ...chain, matches: { [match]: { ...chain.matches[match], lock: { ...chain.matches[match].lock, root: "00".repeat(32) } } } };
  html = checkScreen(undefined, ctxWith(other, { picks: { [match]: entry }, fixtures })).html;
  assert.match(html, /Locked on X Layer at/);
  assert.ok(!html.includes("Your prediction is in it."));

  // A pick whose match is not locked yet is not listed.
  const none = { ...chain, matches: {} };
  assert.ok(!checkScreen(undefined, ctxWith(none, { picks: { [match]: entry }, fixtures })).html.includes("Your predictions on X Layer"));
});

test("My record is each prediction, what you said, its stage and its points, and nothing about X Layer", () => {
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
  assert.match(recordScreen(undefined, ctxWith(null)).html, /No predictions yet\./);
});

// ---- asking more than one node

/** The same honest season held by two nodes, as two honest nodes of one chain would hold it. */
async function twoNodes() {
  const { inbox, files } = await honestSeason();
  const site = Object.fromEntries(Object.entries(files).map(([match, file]) => [openingsPath(fromHex(match)), file]));
  return [0, 1].map(() => new FakeNode({ league: LEAGUE, messages: inbox.messages, files: site }));
}

test("the browser asks two X Layer nodes, and the Check screen reads as it always has", async () => {
  const [a, b] = await twoNodes();
  const chain = createChain({ store: createStore(new FakeStorage()), nodes: [a.ask, b.ask], now: () => NOW });
  await chain.refresh({ league, players: [ada, bola, chidi] });
  assert.deepEqual(chain.view(league).nodes, { asked: 2, agreed: 2, down: [] });
  const html = checkScreen(undefined, ctxWith(chain.view(league))).html;
  assert.match(html, /Read at \d\d:\d\d, block [\d,]+\. 3 matches locked\./);
  assert.ok(!/nodes?\b/.test(html.replace(/<[^>]+>/g, " ")), "how many nodes were asked is not put on the screen");
});

test("if the second node does not answer, the record is still read from the first", async () => {
  const [a, b] = await twoNodes();
  b.failOn = "eth_blockNumber";
  const chain = createChain({ store: createStore(new FakeStorage()), nodes: [a.ask, b.ask], now: () => NOW });
  await chain.refresh({ league, players: [ada] });
  assert.equal(chain.unreachable, false);
  assert.equal(chain.view(league).points[ada].points, 7);
  assert.deepEqual(chain.view(league).nodes, { asked: 2, agreed: 1, down: ["node 2"] });
});

test("if two nodes disagree, nothing new is taken from either", async () => {
  const [a, b] = await twoNodes();
  const chain = createChain({ store: createStore(new FakeStorage()), nodes: [a.ask, b.ask], now: () => NOW });
  await chain.refresh({ league, players: [ada] });
  const before = JSON.stringify(chain.view(league));

  a.entries.pop(); // one node now hides the last thing the league said
  assert.equal(await chain.refresh({ league, players: [ada] }), false);
  assert.deepEqual(chain.disagree, ["node 1", "node 2"]);
  assert.equal(chain.unreachable, true, "the screen treats it as a read that did not work");
  assert.equal(JSON.stringify(chain.view(league)), before, "what was read while they agreed is kept as it was");

  // A phone that has never read the record, and meets two nodes that disagree, shows nothing at all.
  const fresh = createChain({ store: createStore(new FakeStorage()), nodes: [a.ask, b.ask], now: () => NOW });
  await fresh.refresh({ league, players: [ada] });
  assert.equal(fresh.view(league), null);
  assert.equal(fresh.unreachable, true);

  // Once they agree again, reading carries on.
  b.entries.pop();
  await chain.refresh({ league, players: [ada] });
  assert.equal(chain.disagree, null);
  assert.equal(chain.unreachable, false);
});
