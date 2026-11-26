// Going live, checked against a stand-in for X Layer that keeps circuits, transistors, accounts
// and money the way TapeOut's contracts do, and charges for every step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { decode, encode, selector } from "../../engine/src/abi.js";
import { fromHex, leagueId, toHex } from "../../engine/src/index.js";
import { GAS_FLOOR, OKB, SCORING, goLive, inOkb, lookAtGoingLive, lookInWords } from "../src/golive.js";
import { ONE_GATE, TRANSFER } from "../src/xlayer.js";

const PROCESSOR = "0x39e44dba62811e87fde122ca4d6c082568a384d0";
const TRANSISTORS = "0x5d7e99c4d1b71f4d24c9d53f41aed8196064a61f";
const OPENER = "0x536add8f30f03b69f6fbf29d425a816a0dc50106";
const MAILBOX = "0xe61a9c7213a6aa616c246a2b569e555b417b25ee";
const WALLET = "0x00000000000000000000000000000000000a11ce";
const SOMEONE = "0x000000000000000000000000000000000000beef";
const FLAT = 660_000_000_000_000n; // 0.00066 OKB for each purchase of transistors
const TAPEOUT = 1_300_000_000_000_000n; // 0.0013 OKB to publish a circuit
const OPEN = 80_000_000_000_000_000n; // 0.08 OKB to open an account
const GAS = 10_000_000_000_000n; // what the stand-in charges for each transaction

const manifest = JSON.parse(readFileSync(new URL("../../circuits/out/manifest.json", import.meta.url), "utf8"));
const CIRCUITS = Object.fromEntries(
  SCORING.map((name) => [
    name,
    { netlist: readFileSync(new URL(`../../circuits/out/${name}.hex`, import.meta.url), "utf8").trim(), inputs: manifest[name].inputs, outputs: manifest[name].outputs },
  ]),
);
const GATES = 1 + SCORING.reduce((sum, name) => sum + manifest[name].gates, 0);

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const accountFor = (id) => `0x${createHash("sha256").update(`${PROCESSOR}/${id}`).digest("hex").slice(0, 40)}`;

/** A stand-in for X Layer with a processor that already has `existing` circuits on it. */
function standIn({ existing = 4, holds = OKB, price = 0n } = {}) {
  const s = {
    circuits: new Map(), // number -> { owner, netlist (hex) }
    held: 0n, // NAND transistors the wallet holds
    opened: new Set(),
    balance: holds,
    sent: [], // every transaction, in order
    paid: 0n, // TapeOut fees paid
    failAt: null, // make this transaction (counted from 1) fail
    down: false, // the node stops answering
  };
  for (let id = 1; id <= existing; id++) s.circuits.set(id, { owner: SOMEONE, netlist: "00000002000003" });

  const questions = {
    "transistors()": [PROCESSOR, [], () => encode(["address"], [TRANSISTORS])],
    "TAPEOUT_FEE()": [PROCESSOR, [], () => encode(["uint256"], [TAPEOUT])],
    "ownerOf(uint256)": [PROCESSOR, ["uint256"], ([id]) => encode(["address"], [s.circuits.get(Number(id)).owner])],
    "netlist(uint256)": [PROCESSOR, ["uint256"], ([id]) => encode(["bytes"], [fromHex(s.circuits.get(Number(id)).netlist)])],
    "mintPrice()": [TRANSISTORS, [], () => encode(["uint256"], [price])],
    "protocolFee()": [TRANSISTORS, [], () => encode(["uint256"], [FLAT])],
    "balanceOf(address,uint256)": [TRANSISTORS, ["address", "uint256"], ([who]) => encode(["uint256"], [who === WALLET ? s.held : 0n])],
    "FEE()": [OPENER, [], () => encode(["uint256"], [OPEN])],
    "isOpened(address,uint256)": [OPENER, ["address", "uint256"], ([, id]) => encode(["bool"], [s.opened.has(Number(id))])],
    "accountOf(address,uint256)": [MAILBOX, ["address", "uint256"], ([, id]) => encode(["address"], [accountFor(Number(id))])],
  };
  const bySelector = new Map(Object.entries(questions).map(([sig, q]) => [`${q[0]}/${toHex(selector(sig))}`, q]));

  s.node = async (method, params) => {
    if (s.down) throw new Error("the node answered with error 503");
    if (method === "eth_chainId") return "0xc4";
    if (method === "eth_gasPrice") return "0x1312d00";
    if (method === "eth_getBalance") return `0x${(params[0].toLowerCase() === WALLET ? s.balance : 0n).toString(16)}`;
    if (method === "eth_call") {
      const data = params[0].data.slice(2);
      const q = bySelector.get(`${params[0].to.toLowerCase()}/${data.slice(0, 8)}`);
      try {
        return `0x${toHex(q[2](decode(q[1], fromHex(data.slice(8)))))}`;
      } catch {
        throw Object.assign(new Error("the node refused eth_call: execution reverted"), { code: 3 });
      }
    }
    throw new Error(`the stand-in does not answer ${method}`);
  };

  s.sender = {
    address: WALLET,
    async transact({ to, signature, values, value = 0n }) {
      s.sent.push(signature);
      if (s.failAt === s.sent.length) throw new Error("cast could not send it: the connection dropped");
      if (s.balance < value + GAS) throw new Error("cast could not send it: insufficient funds");
      const logs = [];
      if (signature === "mint(uint256,uint256)") {
        assert.equal(to, TRANSISTORS);
        assert.equal(value, BigInt(values[1]) * price + FLAT, "the right money for the transistors");
        s.held += BigInt(values[1]);
      } else if (signature === "tapeout(bytes,uint32,uint32)") {
        assert.equal(to, PROCESSOR);
        assert.equal(value, TAPEOUT);
        const netlist = values[0].replace(/^0x/, "");
        const gates = BigInt(netlist.length / 14);
        if (s.held < gates) throw new Error("cast could not send it: not enough transistors");
        s.held -= gates;
        const id = s.circuits.size + 1;
        s.circuits.set(id, { owner: WALLET, netlist });
        logs.push({ address: PROCESSOR, topics: [TRANSFER, `0x${word(0)}`, `0x${word(WALLET)}`, `0x${word(id)}`] });
      } else if (signature === "open(address,uint256)") {
        assert.equal(to, OPENER);
        assert.equal(value, OPEN);
        assert.equal(s.circuits.get(Number(values[1])).owner, WALLET, "only the holder opens the account");
        assert.ok(!s.opened.has(Number(values[1])), "an account is opened once");
        s.opened.add(Number(values[1]));
      } else {
        throw new Error(`the stand-in does not take ${signature}`);
      }
      s.balance -= value + GAS;
      s.paid += value;
      return { status: "0x1", logs };
    },
  };
  s.settings = { node: s.node, processor: PROCESSOR, opener: OPENER, mailbox: MAILBOX, circuits: CIRCUITS };
  return s;
}

const ALL_FEES = 7n * (FLAT + TAPEOUT) + OPEN; // 0.09372 OKB: the league, the six scoring circuits, and opening the account

test("a look says what is still to do and what it costs, and sends nothing", async () => {
  const x = standIn();
  const look = await lookAtGoingLive({ ...x.settings, wallet: WALLET });
  assert.deepEqual(look.steps.map((s) => `${s.does} ${s.name}`), ["publish league", "open account", "publish football", "publish basketball", "publish tennis", "publish result", "publish goalgoal", "publish score"]);
  assert.equal(look.fee, ALL_FEES);
  assert.equal(inOkb(look.fee), "0.093720 OKB");
  assert.equal(look.gas, GAS_FLOOR);
  assert.equal(look.need, ALL_FEES + GAS_FLOOR);
  assert.equal(look.short, 0n);
  assert.equal(look.next, 5);
  assert.deepEqual(look.league, { circuit: 5, account: accountFor(5), id: toHex(leagueId(196, accountFor(5))) });
  assert.deepEqual(x.sent, []);

  const words = lookInWords(look, { serverLeague: look.league.id });
  assert.match(words, /TapeOut's fees in all: +0\.093720 OKB/);
  assert.match(words, /The wallet holds enough\./);
  assert.match(words, /That is the league Kickoff's server is already set up for\./);
  assert.match(lookInWords(look, { serverLeague: "ab".repeat(32) }), /NOT THE LEAGUE KICKOFF'S SERVER IS SET UP FOR/);
});

test("going live publishes the league first, opens its account, then the scoring circuits", async () => {
  const x = standIn();
  const said = [];
  const done = await goLive({ ...x.settings, sender: x.sender, say: (line) => said.push(line) });
  assert.deepEqual(done.did, ["league", "account", "football", "basketball", "tennis", "result", "goalgoal", "score"]);
  assert.deepEqual(done.have, { league: 5, football: 6, basketball: 7, tennis: 8, result: 9, goalgoal: 10, score: 11 });
  assert.equal(done.opened, true);
  assert.deepEqual(done.steps, []);
  assert.equal(x.paid, ALL_FEES, "TapeOut was paid exactly what the look said");
  assert.equal(done.spent, ALL_FEES + 15n * GAS);
  assert.equal(x.held, 0n, "no transistors bought and left over");
  assert.equal(x.circuits.get(6).netlist, CIRCUITS.football.netlist);
  assert.equal(said.length, 8);
  assert.match(lookInWords(done), /Kickoff is live\. There is nothing left to do and nothing to pay\./);
});

test("football's three predictions are published beside what is already live, and nothing else is touched", async () => {
  // Kickoff as it went live: the league (circuit 5) with its account open, and football,
  // basketball and tennis as circuits 6, 7 and 8.
  const x = standIn();
  for (const [id, netlist] of [[5, "00000002000002"], [6, CIRCUITS.football.netlist], [7, CIRCUITS.basketball.netlist], [8, CIRCUITS.tennis.netlist]]) x.circuits.set(id, { owner: WALLET, netlist });
  x.opened.add(5);

  const look = await lookAtGoingLive({ ...x.settings, wallet: WALLET });
  assert.deepEqual(look.steps.map((s) => `${s.does} ${s.name}`), ["publish result", "publish goalgoal", "publish score"]);
  assert.equal(look.fee, 3n * (FLAT + TAPEOUT));
  assert.equal(inOkb(look.fee), "0.005880 OKB");
  assert.equal(look.league.circuit, 5, "the league is still circuit 5");

  const done = await goLive({ ...x.settings, sender: x.sender });
  assert.deepEqual(done.did, ["result", "goalgoal", "score"]);
  assert.deepEqual(done.have, { league: 5, football: 6, basketball: 7, tennis: 8, result: 9, goalgoal: 10, score: 11 });
  assert.equal(x.paid, 3n * (FLAT + TAPEOUT), "only the three new circuits were paid for");
  assert.equal(x.opened.size, 1, "no second account was opened");
  assert.equal(x.circuits.get(9).netlist, CIRCUITS.result.netlist);
  assert.equal(x.circuits.get(10).netlist, CIRCUITS.goalgoal.netlist);
  assert.equal(x.circuits.get(11).netlist, CIRCUITS.score.netlist);
});

test("going live a second time sends nothing and pays nothing", async () => {
  const x = standIn();
  await goLive({ ...x.settings, sender: x.sender });
  const sent = x.sent.length;
  const again = await goLive({ ...x.settings, sender: x.sender });
  assert.deepEqual(again.did, []);
  assert.equal(again.spent, 0n);
  assert.equal(x.sent.length, sent);
  assert.equal(x.paid, ALL_FEES);
});

test("a wallet that is short sends nothing at all", async () => {
  const x = standIn({ holds: ALL_FEES }); // the fees, but nothing for gas
  const look = await lookAtGoingLive({ ...x.settings, wallet: WALLET });
  assert.equal(look.short, GAS_FLOOR);
  assert.match(lookInWords(look), /THE WALLET IS SHORT BY 0\.002000 OKB\./);
  await assert.rejects(goLive({ ...x.settings, sender: x.sender }), /short by 0\.002000 OKB, so nothing was sent/);
  assert.deepEqual(x.sent, []);
});

test("after a failure half way, running it again finishes the job and nothing is paid for twice", async () => {
  // Fail at every transaction in turn. Whichever one fails, a second run has to finish the job
  // having paid TapeOut exactly once for each thing.
  for (let failAt = 1; failAt <= 9; failAt++) {
    const x = standIn();
    x.failAt = failAt;
    await assert.rejects(goLive({ ...x.settings, sender: x.sender }), /connection dropped/);
    x.failAt = null;
    const done = await goLive({ ...x.settings, sender: x.sender });
    assert.deepEqual(done.steps, [], `finished after failing at transaction ${failAt}`);
    assert.deepEqual(done.have, { league: 5, football: 6, basketball: 7, tennis: 8, result: 9, goalgoal: 10, score: 11 });
    assert.equal(x.paid, ALL_FEES, `paid once for each thing after failing at transaction ${failAt}`);
    assert.equal(x.held, 0n);
    assert.equal(x.opened.size, 1);
  }
});

test("nothing is sent if the league would not be the one Kickoff's server is set up for", async () => {
  const x = standIn({ existing: 5 }); // somebody else published a circuit first, so the league would be circuit 6
  const serverLeague = toHex(leagueId(196, accountFor(5)));
  await assert.rejects(goLive({ ...x.settings, sender: x.sender, serverLeague }), /not the one Kickoff's server is set up for, so nothing was sent/);
  assert.deepEqual(x.sent, []);
  const done = await goLive({ ...x.settings, sender: x.sender, serverLeague, newLeague: true });
  assert.equal(done.have.league, 6);
  assert.equal(done.league.id, toHex(leagueId(196, accountFor(6))));
});

test("a node that stops answering is an error, never 'nothing is published yet'", async () => {
  const x = standIn();
  await goLive({ ...x.settings, sender: x.sender });
  const sent = x.sent.length;
  x.down = true;
  await assert.rejects(lookAtGoingLive({ ...x.settings, wallet: WALLET }), /error 503/);
  await assert.rejects(goLive({ ...x.settings, sender: x.sender }), /error 503/);
  assert.equal(x.sent.length, sent);
});

test("a processor that charges for transistors is priced correctly", async () => {
  const price = 500_000_000_000_000n; // 0.0005 OKB each
  const x = standIn({ price });
  const look = await lookAtGoingLive({ ...x.settings, wallet: WALLET });
  assert.equal(look.fee, ALL_FEES + BigInt(GATES) * price);
  const done = await goLive({ ...x.settings, sender: x.sender });
  assert.equal(x.paid, look.fee);
  assert.deepEqual(done.steps, []);
});

test("another chain is refused", async () => {
  const x = standIn();
  const node = async (method, params) => (method === "eth_chainId" ? "0x1" : x.node(method, params));
  await assert.rejects(goLive({ ...x.settings, node, sender: x.sender }), /not X Layer/);
  assert.deepEqual(x.sent, []);
});

test("the league's circuit is the smallest there is", () => {
  assert.equal(ONE_GATE, "0x00000002000002");
});
