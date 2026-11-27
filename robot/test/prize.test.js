// Reading a prize payment on X Layer: what was paid and to whom is taken from the chain, and a
// payment that cannot be relied on is refused with a plain reason.
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEEP_ENOUGH, WAIT_FOR_TX, checkClaim, inUnits, prizeRound, readPayment } from "../src/prize.js";

const WINNER = `0x${"11".repeat(20)}`;
const BRAND = `0x${"22".repeat(20)}`;
const USDT = `0x${"aa".repeat(20)}`;
const TX = `0x${"ab".repeat(32)}`;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const text = (words) => `0x${word("20")}${word(words.length.toString(16))}${Buffer.from(words).toString("hex").padEnd(64, "0")}`;
const moved = (token, to, raw) => ({ address: token, topics: [TRANSFER, `0x${word(BRAND)}`, `0x${word(to)}`], data: `0x${word(raw.toString(16))}` });

/** A node that knows one transaction. `over` changes what it says. */
function node({ status = "0x1", to = USDT, value = "0x0", logs = [moved(USDT, WINNER, 100_000_000n)], block = 1000, head = 1000 + DEEP_ENOUGH, symbol = "USDT", decimals = 6, time = 5000, known = true, down = false } = {}) {
  return async (method, params = []) => {
    if (down) throw new Error("no answer");
    if (method === "eth_blockNumber") return `0x${head.toString(16)}`;
    if (method === "eth_getTransactionReceipt") return known && params[0] === TX ? { status, blockNumber: `0x${block.toString(16)}`, logs } : null;
    if (method === "eth_getBlockByNumber") return { timestamp: `0x${time.toString(16)}` };
    if (method === "eth_getTransactionByHash") return known && params[0] === TX ? { from: BRAND, to, value } : null;
    if (method === "eth_call" && params[0].data === "0x95d89b41") return symbol === null ? "0x" : text(symbol);
    if (method === "eth_call" && params[0].data === "0x313ce567") return `0x${word(decimals.toString(16))}`;
    throw new Error(`unexpected ${method}`);
  };
}
const read = (nodes, extra = {}) => readPayment({ tx: TX, wallet: WINNER, nodes, ...extra });

test("amounts are written the way people write them", () => {
  assert.equal(inUnits(100_000_000n, 6), "100");
  assert.equal(inUnits(1_250_750_000n, 6), "1,250.75");
  assert.equal(inUnits(500_000_000_000_000_000n, 18), "0.5");
  assert.equal(inUnits(1n, 18), "0.000000000000000001");
  assert.equal(inUnits(42n, 0), "42");
});

test("a token paid to the winner's wallet is read from the chain: how much, of what, and which token", async () => {
  const payment = await read([node(), node()]);
  assert.deepEqual(payment, {
    tx: TX, to: WINNER, from: BRAND, block: 1000, time: 5000, what: "100 USDT",
    paid: [{ amount: "100", symbol: "USDT", token: USDT, raw: "100000000", what: "100 USDT" }],
    nodes: { asked: 2, agreed: 2 },
  });
  // Typed in capitals, with the wallet in capitals: the same payment.
  assert.equal((await readPayment({ tx: TX.toUpperCase().replace("0X", "0x"), wallet: WINNER.toUpperCase().replace("0X", "0x"), nodes: [node()] })).what, "100 USDT");
});

test("OKB sent straight to the winner's wallet is a payment too", async () => {
  const payment = await read([node({ to: WINNER, value: "0x6f05b59d3b20000", logs: [] })]); // 0.5 OKB
  assert.deepEqual([payment.what, payment.paid[0].token], ["0.5 OKB", null]);
});

test("CHEAT: a payment to any other wallet is not the winner's prize", async () => {
  const other = `0x${"33".repeat(20)}`;
  await assert.rejects(read([node({ logs: [moved(USDT, other, 100_000_000n)] })]), /did not pay the winner's wallet/);
  await assert.rejects(read([node({ to: other, value: "0x6f05b59d3b20000", logs: [] })]), /did not pay the winner's wallet/);
  // Nothing at all, or an amount of nothing, is no payment either.
  await assert.rejects(read([node({ logs: [] })]), /did not pay the winner's wallet/);
  await assert.rejects(read([node({ logs: [moved(USDT, WINNER, 0n)] })]), /did not pay the winner's wallet/);
});

test("CHEAT: a transaction that failed, does not exist, or is not a transaction is refused", async () => {
  await assert.rejects(read([node({ status: "0x0" })]), /failed on X Layer, so nothing was paid/);
  await assert.rejects(read([node({ known: false })]), /X Layer has no such transaction/);
  for (const tx of ["", "0x1234", "100 USDT", null]) await assert.rejects(readPayment({ tx, wallet: WINNER, nodes: [node()] }), /not a transaction on X Layer/);
  await assert.rejects(readPayment({ tx: TX, wallet: null, nodes: [node()] }), /no linked wallet/);
});

test("CHEAT: if two nodes give different accounts of the payment, it is not recorded", async () => {
  const lying = node({ logs: [moved(USDT, WINNER, 100_000_000_000n)] }); // says a thousand times as much
  await assert.rejects(read([node(), lying]), /two X Layer nodes gave different accounts/);
  await assert.rejects(read([node({ status: "0x0" }), node()]), /different accounts/);
});

test("one node not answering does not stop the read, and no node answering does", async () => {
  const payment = await read([node({ down: true }), node()]);
  assert.deepEqual([payment.what, payment.nodes], ["100 USDT", { asked: 2, agreed: 1 }]);
  await assert.rejects(read([node({ down: true }), node({ down: true })]), /no X Layer node answered/);
});

test("a payment only just made is read a moment later, once it is deep enough", async () => {
  await assert.rejects(read([node({ head: 1000 + DEEP_ENOUGH - 1 })]), /only just in/);
  assert.equal((await read([node({ head: 1000 + DEEP_ENOUGH })])).what, "100 USDT");
});

test("a token that does not say what it is cannot be given an amount", async () => {
  await assert.rejects(read([node({ symbol: null })]), /does not say what it is/);
});

test("two payments in one transaction are both read", async () => {
  const other = `0x${"bb".repeat(20)}`;
  const payment = await read([node({ logs: [moved(USDT, WINNER, 60_000_000n), moved(USDT, WINNER, 40_000_000n), moved(other, BRAND, 5n)] })]);
  assert.equal(payment.what, "100 USDT");
});

// ---- Payments whoever started a brand's group says they made

/** What Kickoff's server hands the robot: Bola is owed 100 USDT, at the real token, for a group decided at 4000. */
const claim = (over = {}) => ({ code: "HOOPS-0001", place: 1, tx: TX, at: 4500, decidedAt: 4000, name: "Bola", wallet: WINNER, token: USDT, raw: "100000000", what: "100 USDT", ...over });
const check = (nodes, over = {}, now = 4600) => checkClaim({ claim: claim(over), now, read: (ask) => readPayment({ ...ask, nodes }) });

test("a payment of the right token, of at least the share, to the winner's wallet, is paid", async () => {
  assert.deepEqual(await check([node(), node()]), { verdict: "paid", to: WINNER, token: USDT, raw: "100000000", what: "100 USDT" });
  // More than the share is still paid, and is recorded as what really arrived.
  assert.deepEqual(await check([node({ logs: [moved(USDT, WINNER, 120_500_000n)] })]), { verdict: "paid", to: WINNER, token: USDT, raw: "120500000", what: "120.5 USDT" });
});

test("CHEAT: a token that only calls itself USDT, too little, or the wrong coin is refused with the reason", async () => {
  const FAKE = `0x${"fa".repeat(20)}`;
  const fake = await check([node({ logs: [moved(FAKE, WINNER, 100_000_000n)] })]);
  assert.deepEqual([fake.verdict, fake.reason], ["refuse", "That payment was not in USDT. It paid 100 USDT, and a token that only calls itself USDT does not count."]);
  const short = await check([node({ logs: [moved(USDT, WINNER, 15_000_000n)] })]);
  assert.deepEqual([short.verdict, short.reason], ["refuse", "It paid 15 USDT, less than the 100 USDT share."]);
  const okb = await check([node({ to: WINNER, value: "0x6f05b59d3b20000", logs: [] })]);
  assert.match(okb.reason, /was not in USDT\. It paid 0\.5 OKB/);
  // The real token beside a fake one: only the real one is counted.
  const both = await check([node({ logs: [moved(FAKE, WINNER, 900_000_000n), moved(USDT, WINNER, 100_000_000n)] })]);
  assert.deepEqual([both.verdict, both.what], ["paid", "100 USDT"]);
});

test("CHEAT: an old payment, a payment to somebody else, and a failed one are refused", async () => {
  // Bola was sent 100 USDT before this group even had its winners: it is not this prize.
  const old = await check([node({ time: 3999 })]);
  assert.deepEqual([old.verdict, old.reason], ["refuse", "That payment was made before this group had its winners, so it is not this prize."]);
  const other = await check([node({ logs: [moved(USDT, `0x${"33".repeat(20)}`, 100_000_000n)] })]);
  assert.deepEqual([other.verdict, other.reason], ["refuse", "That transaction did not pay Bola's wallet."]);
  assert.deepEqual((await check([node({ status: "0x0" })])).reason, "That transaction failed on X Layer, so nothing was paid.");
  assert.equal((await check([node()], { wallet: null })).verdict, "refuse");
});

test("a payment that cannot be read yet is left waiting, and one X Layer never gets is refused after a while", async () => {
  assert.equal((await check([node({ head: 1000 })])).verdict, "wait");
  assert.equal((await check([node({ down: true })])).verdict, "wait");
  assert.equal((await check([node(), node({ status: "0x0" })])).verdict, "wait");
  // Not on X Layer yet: waited for, then refused.
  assert.equal((await check([node({ known: false })], {}, 4500 + WAIT_FOR_TX - 1)).verdict, "wait");
  const gone = await check([node({ known: false })], {}, 4500 + WAIT_FOR_TX);
  assert.deepEqual([gone.verdict, gone.reason], ["refuse", "X Layer has no such transaction. Check it was copied whole, and that it was sent on X Layer."]);
});

test("a prize that is only a line of words takes whatever reached the winner's wallet", async () => {
  assert.deepEqual(await check([node()], { token: null, raw: null, what: null }), { verdict: "paid", to: WINNER, token: null, raw: null, what: "100 USDT" });
});

test("a round reads every waiting payment and tells Kickoff what it found, one at a time", async () => {
  const told = [];
  const TX2 = `0x${"cd".repeat(32)}`;
  const TX3 = `0x${"ef".repeat(32)}`;
  const kickoff = {
    prizeClaims: async () => [claim(), claim({ place: 2, tx: TX2, name: "Ada" }), claim({ place: 3, tx: TX3, name: "Chidi" })],
    recordPrize: async (p) => told.push(["paid", p]),
    refusePrize: async (r) => told.push(["refused", r]),
  };
  // The first is right, the second short, and the third only just in.
  const read = async ({ tx, wallet }) => readPayment({ tx: TX, wallet, nodes: [node(tx === TX2 ? { logs: [moved(USDT, WINNER, 1_000_000n)] } : tx === TX3 ? { head: 1000 } : {})] }).then((p) => ({ ...p, tx }));
  const out = await prizeRound({ kickoff, now: 4600, read });
  assert.deepEqual(told, [
    ["paid", { code: "HOOPS-0001", place: 1, tx: TX, to: WINNER, token: USDT, raw: "100000000", what: "100 USDT" }],
    ["refused", { code: "HOOPS-0001", place: 2, tx: TX2, reason: "It paid 1 USDT, less than the 100 USDT share." }],
  ]);
  assert.deepEqual(out.problems, []);
  assert.equal(out.did.length, 2);
  // The server being away is a problem to say, not a crash. One payment going wrong does not stop the others.
  assert.match((await prizeRound({ kickoff: { prizeClaims: async () => { throw new Error("status 502"); } }, now: 4600, read })).problems[0], /could not be fetched \(status 502\)/);
  const stuck = await prizeRound({ kickoff: { ...kickoff, recordPrize: async () => { throw new Error("status 500"); } }, now: 4600, read });
  assert.equal(stuck.problems.length, 1);
  assert.equal(stuck.did.length, 1);
});
