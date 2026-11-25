import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { callData, decode, decodeRecords, encode, eventTopic, selector } from "../src/abi.js";
import {
  XLAYER, fetchLeague, fetchSiteFile, fromHex, keccak256, leagueId, leagueOfCircuit, openingsPath, parseLeagueId,
  tableFromXLayer, toHex,
} from "../src/index.js";
import { id } from "./helpers.js";
import { CIRCUITS } from "./league.js";
import { FakeNode } from "./fake-node.js";
import { LEAGUE, LEAGUE_ACCOUNT, STRANGER, honestSeason } from "./chain.js";

const text = (s) => new TextEncoder().encode(s);
const name = (player) => ["ada", "bola", "chidi"].find((n) => toHex(id(n)) === toHex(player)) ?? "?";
const lines = (table) => table.map((row) => `${row.position} ${name(row.player)} ${row.points}`);

/** An honest season held by a stand-in node: the inbox in the mailbox, the opened picks on the site. */
async function seasonOnANode(options = {}) {
  const { inbox, files, parts } = await honestSeason();
  const site = Object.fromEntries(Object.entries(files).map(([match, file]) => [openingsPath(fromHex(match)), file]));
  const node = new FakeNode({ league: LEAGUE, messages: inbox.messages, files: site, ...options });
  return { node, inbox, parts, site };
}
const table = (node) => tableFromXLayer({ node: node.ask, league: LEAGUE, circuits: CIRCUITS });

// ---- Keccak-256, written out by hand, against published values

test("Keccak-256 gives the published values", () => {
  assert.equal(toHex(keccak256(new Uint8Array(0))), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(toHex(keccak256(text("abc"))), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  // An input longer than one round takes in. The value was worked out with a widely used library.
  assert.equal(
    toHex(keccak256(new Uint8Array(300).map((_, i) => (i * 7) & 255))),
    "e8d0c605aa90a1fe3feb493ad761f5313ddd79b377b06ed215e8c883341c33ae",
  );
  assert.equal(
    toHex(keccak256(text("The quick brown fox jumps over the lazy dog"))),
    "4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15",
  );
});

test("the mailbox's function codes and event name come out as TAP-10 publishes them", () => {
  const code = (signature) => `0x${toHex(selector(signature))}`;
  assert.equal(code("inboxCount(bytes32)"), "0x9343ecd9");
  assert.equal(code("inboxAt(bytes32,uint256)"), "0x3e605450");
  assert.equal(code("inboxPage(bytes32,uint256,uint256)"), "0x2eec4913");
  assert.equal(code("digestOf(bytes32,bytes)"), "0x120950e3");
  assert.equal(code("accountOf(address,uint256)"), "0x0c1905e5");
  assert.equal(
    `0x${toHex(eventTopic("Sent(bytes32,address,bytes32,uint256,uint256,bytes)"))}`,
    "0xd75bb8082dd3ae8bb88682115ee1412a8e8051cc81d0e4c01dc3b06c0cf61020",
  );
});

// ---- the calling format

test("a call is written out the way the Solidity handbook's example shows", () => {
  // baz(uint32,bool) with 69 and true.
  assert.equal(
    callData("baz(uint32,bool)", [69, true]),
    "0xcdcd77c0" +
      "0000000000000000000000000000000000000000000000000000000000000045" +
      "0000000000000000000000000000000000000000000000000000000000000001",
  );
  // A value of no fixed size is written after the fixed ones, with a pointer to it.
  assert.equal(
    toHex(encode(["bytes", "uint256"], [text("dave"), 7])),
    "0000000000000000000000000000000000000000000000000000000000000040" +
      "0000000000000000000000000000000000000000000000000000000000000007" +
      "0000000000000000000000000000000000000000000000000000000000000004" +
      "6461766500000000000000000000000000000000000000000000000000000000",
  );
});

test("what is written out reads back the same", () => {
  const types = ["address", "uint256", "string", "bytes32", "bytes", "bool"];
  const values = [LEAGUE_ACCOUNT, 12345678901234567890n, "openings/abc.json", id("x"), Uint8Array.of(1, 2, 3), true];
  const back = decode(types, encode(types, values));
  assert.equal(back[0], LEAGUE_ACCOUNT);
  assert.equal(back[1], 12345678901234567890n);
  assert.equal(back[2], "openings/abc.json");
  assert.equal(toHex(back[3]), toHex(id("x")));
  assert.deepEqual([...back[4]], [1, 2, 3]);
  assert.equal(back[5], true);
});

test("an answer that is cut short is refused, not half read", () => {
  const whole = encode(["bytes"], [new Uint8Array(100)]);
  assert.throws(() => decode(["bytes"], whole.subarray(0, 90)), /shorter/);
  assert.throws(() => decode(["uint256"], new Uint8Array(10)), /shorter/);
  assert.throws(() => decodeRecords(["uint256"], encode(["uint256", "uint256"], [32, 5])), /shorter/);
});

// ---- a league's id

test("a league's id holds its chain and its account", () => {
  const league = leagueId(196, LEAGUE_ACCOUNT);
  assert.equal(toHex(league), `0000000000000000000000c4${LEAGUE_ACCOUNT.slice(2)}`);
  assert.deepEqual(parseLeagueId(league), { chainId: 196, account: LEAGUE_ACCOUNT });
  assert.throws(() => parseLeagueId(id("not a league")), /not a league id/);
  assert.throws(() => parseLeagueId(new Uint8Array(32)), /not a league id/);
});

test("a league can be found from the circuit that owns it", async () => {
  const { node } = await seasonOnANode();
  const league = await leagueOfCircuit({ node: node.ask, processor: STRANGER, circuit: 7n });
  assert.equal(toHex(league), toHex(LEAGUE));
});

// ---- fetching an inbox

test("fetching an inbox gives back every message exactly as it was sent", async () => {
  const { node, inbox } = await seasonOnANode();
  const got = await fetchLeague({ node: node.ask, league: LEAGUE });
  assert.equal(got.account, LEAGUE_ACCOUNT);
  assert.equal(got.chainId, 196);
  assert.equal(got.messages.length, inbox.messages.length);
  got.messages.forEach((m, i) => {
    const sent = inbox.messages[i];
    assert.equal(m.index, i);
    assert.equal(m.from, sent.from);
    assert.equal(m.timestamp, sent.timestamp);
    assert.equal(toHex(m.ref), toHex(sent.ref));
    assert.equal(toHex(m.payload), toHex(sent.payload));
  });
});

test("the table built from a node is the table: ada 7, bola 4, chidi 1", async () => {
  const { node } = await seasonOnANode();
  const got = await table(node);
  assert.deepEqual(lines(got.table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
  assert.equal(got.files.length, 3);
  assert.ok(got.files.every((f) => f.found));
  assert.deepEqual(got.ignored, []);
});

test("it works with a mailbox that hands messages over one at a time", async () => {
  const { node } = await seasonOnANode();
  node.servesPages = false;
  assert.deepEqual(lines((await table(node)).table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
});

test("it works with a node that does not serve logs, by reading the block's receipts", async () => {
  const { node } = await seasonOnANode();
  node.servesLogs = false;
  assert.deepEqual(lines((await table(node)).table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
  assert.ok(node.asked.includes("eth_getBlockReceipts"));
});

test("an inbox longer than one page is fetched whole", async () => {
  const { inbox, files } = await honestSeason();
  // 450 messages from a stranger land in the inbox after the season.
  for (let i = 0; i < 450; i++) inbox.send(STRANGER, { ref: id(`noise ${i}`), payload: text(`noise ${i}`) });
  const site = Object.fromEntries(Object.entries(files).map(([match, file]) => [openingsPath(fromHex(match)), file]));
  const node = new FakeNode({ league: LEAGUE, messages: inbox.messages, files: site, perBlock: 7 });
  const got = await table(node);
  assert.equal(got.messages.length, 459);
  assert.deepEqual(lines(got.table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
  assert.equal(got.ignored.length, 450, "the stranger's messages are fetched, and then not believed");
});

// ---- a node that lies or fails

test("LIE: a node that changes one message's text is caught, and no table is built", async () => {
  const { node } = await seasonOnANode();
  node.changeLogs = (logs) =>
    logs.map((log) => {
      const [index, outbox, payload] = decode(["uint256", "uint256", "bytes"], log.data);
      if (index !== 6n) return log;
      const changed = payload.slice();
      changed[changed.length - 3] ^= 1; // one bit of the first result
      return { ...log, data: `0x${toHex(encode(["uint256", "uint256", "bytes"], [index, outbox, changed]))}` };
    });
  await assert.rejects(table(node), /message 6 .* no table is built/);
});

test("LIE: a node that leaves a message out is caught, and no table is built", async () => {
  const { node } = await seasonOnANode();
  node.changeLogs = (logs) => logs.filter((log) => decode(["uint256"], log.data)[0] !== 3n);
  await assert.rejects(table(node), /message 3 .* no table is built/);
});

test("LIE: a node that swaps a message's reference is caught", async () => {
  const { node } = await seasonOnANode();
  node.changeLogs = (logs) =>
    logs.map((log) => (decode(["uint256"], log.data)[0] === 4n ? { ...log, topics: [...log.topics.slice(0, 3), `0x${toHex(id("other"))}`] } : log));
  await assert.rejects(table(node), /message 4 /);
});

test("LIE: the right text in a log from some other contract is not believed", async () => {
  const { node } = await seasonOnANode();
  node.changeLogs = (logs) => logs.map((log) => ({ ...log, address: STRANGER }));
  await assert.rejects(table(node), /message 0 /);
});

test("LIE: the right text under another sender's name is not believed", async () => {
  const { node } = await seasonOnANode();
  node.changeLogs = (logs) =>
    logs.map((log) => ({ ...log, topics: [log.topics[0], log.topics[1], `0x${STRANGER.slice(2).padStart(64, "0")}`, log.topics[3]] }));
  await assert.rejects(table(node), /message 0 /);
});

test("a league on another chain is not read from this node", async () => {
  const { node } = await seasonOnANode({ chainId: 8453 });
  await assert.rejects(table(node), /this league is on chain 196, but the node is for chain 8453/);
});

test("a node that stops answering part way gives no table, not a wrong one", async () => {
  for (const method of ["eth_blockNumber", "eth_call"]) {
    const { node } = await seasonOnANode();
    node.failOn = method;
    await assert.rejects(table(node), /did not answer/);
  }
});

// ---- the opened picks on the league's site

test("a file on the site is fetched and checked against the fingerprint stored with it", async () => {
  const { node, site } = await seasonOnANode();
  const [path, file] = Object.entries(site)[0];
  const got = await fetchSiteFile({ node: node.ask, account: LEAGUE_ACCOUNT, path });
  assert.equal(new TextDecoder().decode(got), file);
  assert.equal(await fetchSiteFile({ node: node.ask, account: LEAGUE_ACCOUNT, path: "openings/none.json" }), null);
});

test("a long file is fetched in pieces and comes out whole", async () => {
  const long = new Uint8Array(50_001).map((_, i) => (i * 7) & 255);
  const node = new FakeNode({ league: LEAGUE, messages: [], files: { "big.bin": long } });
  const got = await fetchSiteFile({ node: node.ask, account: LEAGUE_ACCOUNT, path: "big.bin" });
  assert.equal(toHex(got), toHex(long));
  assert.equal(node.asked.filter((m) => m === "eth_call").length, 4, "one question about the file, then three pieces");
});

test("a half-uploaded file of opened picks is not used, and the table says so", async () => {
  const { node, site, parts } = await seasonOnANode();
  const path = openingsPath(parts.football.match);
  node.files[path].bytes = node.files[path].bytes.slice(0, 200); // only part of it arrived
  const got = await table(node);
  // Nobody's football pick is opened. Basketball and tennis still count.
  assert.deepEqual(lines(got.table), ["1 ada 4", "2 bola 3", "3 chidi 1"]);
  const file = got.files.find((f) => f.path === path);
  assert.equal(file.found, false);
  assert.match(file.why, /half uploaded or damaged/);
  assert.equal(Object.keys(site).length, 3);
});

test("opened picks that are not published yet show as not opened", async () => {
  const { node, parts } = await seasonOnANode();
  delete node.files[openingsPath(parts.tennis.match)];
  const got = await table(node);
  assert.deepEqual(lines(got.table).map((l) => l.replace(/^\d+ /, "")).sort(), ["ada 4", "bola 4", "chidi 0"]);
  assert.deepEqual(got.table.map((row) => row.position), [1, 2, 3]);
  assert.equal(got.files.find((f) => f.path === openingsPath(parts.tennis.match)).found, false);
});

// ---- over the wire

test("the same answers come back when the node is asked over the web", async () => {
  const { node } = await seasonOnANode();
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", async () => {
      const { id: callId, method, params } = JSON.parse(body);
      let answer;
      try {
        answer = { jsonrpc: "2.0", id: callId, result: await node.ask(method, params) };
      } catch (error) {
        answer = { jsonrpc: "2.0", id: callId, error: { code: error.code ?? -32000, message: error.message } };
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(answer));
    });
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  try {
    const address = `http://127.0.0.1:${server.address().port}`;
    const got = await tableFromXLayer({ node: address, league: LEAGUE, circuits: CIRCUITS });
    assert.deepEqual(lines(got.table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
    node.servesPages = false; // the mailbox's refusal has to survive the trip over the web
    const again = await tableFromXLayer({ node: address, league: LEAGUE, circuits: CIRCUITS });
    assert.deepEqual(lines(again.table), ["1 ada 7", "2 bola 4", "3 chidi 1"]);
  } finally {
    server.close();
  }
});

test("the addresses built in are TapeOut's on X Layer", () => {
  assert.equal(XLAYER.chainId, 196);
  assert.equal(XLAYER.mailbox, "0xe61A9C7213a6Aa616C246a2B569e555B417b25ee".toLowerCase());
  assert.equal(XLAYER.sites, "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6".toLowerCase());
});
