// Reading a prize payment on X Layer.
//
// Kickoff never holds a prize. A brand pays its group's winner from its own wallet, to the wallet
// the winner linked. Before that is recorded, the payment is read here, from X Layer itself: the
// transaction has to have gone through, and it has to have paid that wallet. What it paid, and
// how much, is taken from the chain, never from what anybody typed.
//
// Two kinds of payment are recognised:
//   OKB itself      the transaction is sent to the winner's wallet with an amount
//   a token         the transaction moves a token to the winner's wallet (a "Transfer" in its log)
//
// A token says its own name. Anyone can make a token and call it USDT, so a name is never trusted.
// A prize that is an amount of USDT or USDC is checked against the real token's address, which
// Kickoff's server holds. For any other prize the address is given beside the name, for a person
// to check before the payment is recorded.
//
// Whoever started a brand's group can say on its Group screen that they paid a winner. Those
// payments wait in a list. On each round the robot reads every one of them here (prizeRound) and
// tells the server what it found: paid, or not, and why.

import { connect, XLAYER } from "../../engine/src/index.js";

/** How a token's log says "moved from one wallet to another". */
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** A payment is read only once this many newer blocks have been built on top of it. */
export const DEEP_ENOUGH = 3;
/** How long a payment X Layer has not got yet is waited for, before it is refused. */
export const WAIT_FOR_TX = 30 * 60;

/** A reason the payment cannot be read yet, though it may be in a minute. */
const later = (words) => Object.assign(new Error(words), { later: true });
/** A reason the payment is missing: it may still arrive, for a while. */
const missing = (words) => Object.assign(new Error(words), { missing: true });

const lower = (hex) => String(hex ?? "").toLowerCase();
const isTx = (tx) => /^0x[0-9a-f]{64}$/.test(lower(tx));
const isWallet = (wallet) => /^0x[0-9a-f]{40}$/.test(lower(wallet));

/** An amount in a token's smallest unit, written the way people write it: 100, 0.5, 1,250.75. */
export function inUnits(raw, decimals) {
  const whole = raw / 10n ** BigInt(decimals);
  const rest = (raw % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest ? `${grouped}.${rest}` : grouped;
}

/** The text a contract gave back for a question like symbol(), or null if it is not text. */
function textFrom(hex) {
  try {
    const bytes = Buffer.from(lower(hex).replace(/^0x/, ""), "hex");
    if (bytes.length >= 96) {
      const length = Number(BigInt(`0x${bytes.subarray(32, 64).toString("hex")}`));
      const words = bytes.subarray(64, 64 + length).toString("utf8");
      if (length > 0 && length <= 32 && /^[\x20-\x7e]+$/.test(words)) return words;
    }
    // Some older tokens answer with 32 plain bytes.
    const plain = bytes.subarray(0, 32).toString("utf8").replace(/\0+$/, "");
    return plain && /^[\x20-\x7e]+$/.test(plain) ? plain : null;
  } catch {
    return null;
  }
}

/** What one node says about the transaction: the facts that matter, in one shape, or null if it has not seen it. */
async function seenBy(rpc, tx) {
  const [receipt, sent] = await Promise.all([rpc("eth_getTransactionReceipt", [tx]), rpc("eth_getTransactionByHash", [tx])]);
  if (!receipt || !sent) return null;
  const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  if (!block) return null;
  return {
    worked: receipt.status === "0x1",
    block: Number(BigInt(receipt.blockNumber)),
    time: Number(BigInt(block.timestamp)),
    from: lower(sent.from),
    to: lower(sent.to),
    value: BigInt(sent.value ?? "0x0").toString(),
    moves: (receipt.logs ?? [])
      .filter((log) => lower(log.topics?.[0]) === TRANSFER && log.topics.length === 3)
      .map((log) => ({ token: lower(log.address), to: `0x${lower(log.topics[2]).slice(-40)}`, raw: BigInt(log.data === "0x" ? "0x0" : log.data).toString() })),
  };
}

/**
 * Read a payment.
 * @param tx      the transaction, as the brand gives it
 * @param wallet  the wallet the winner linked
 * @param nodes   X Layer nodes to ask. With more than one, they have to tell the same story.
 * @returns { tx, to, from, block, time, what, paid: [{ what, amount, symbol, token, raw }], nodes: { asked, agreed } }
 *          `what` is every amount that reached the wallet, in words: "100 USDT". `time` is when
 *          it was made, in seconds, and `raw` an amount in the token's smallest unit.
 *          Throws, with a plain reason, if the payment cannot be relied on. The error says
 *          `later` if trying again in a minute may work, and `missing` if X Layer has not got it.
 */
export async function readPayment({ tx, wallet, nodes = XLAYER.nodes }) {
  const hash = lower(tx);
  const paidTo = lower(wallet);
  if (!isTx(hash)) throw new Error("that is not a transaction on X Layer: it should be 0x and 64 more letters and numbers");
  if (!isWallet(paidTo)) throw new Error("the winner has no linked wallet to compare the payment with");
  const asked = nodes.map((node) => connect(node));
  const answers = [];
  for (const rpc of asked) {
    try {
      answers.push({ rpc, seen: await seenBy(rpc, hash), head: Number(BigInt(await rpc("eth_blockNumber"))) });
    } catch {
      // A node that does not answer is left out. At least one has to.
    }
  }
  if (answers.length === 0) throw later("no X Layer node answered, so the payment could not be read");
  const first = answers[0];
  if (!first.seen) throw missing("X Layer has no such transaction. Check it was copied whole, and that it was sent on X Layer");
  for (const other of answers.slice(1)) {
    if (JSON.stringify(other.seen) !== JSON.stringify(first.seen)) throw later("two X Layer nodes gave different accounts of that transaction, so it is not recorded");
  }
  const seen = first.seen;
  if (!seen.worked) throw new Error("that transaction failed on X Layer, so nothing was paid");
  if (first.head - seen.block < DEEP_ENOUGH) throw later("that transaction is only just in. Try again in a minute");

  const paid = [];
  if (seen.to === paidTo && BigInt(seen.value) > 0n) paid.push({ amount: inUnits(BigInt(seen.value), 18), symbol: "OKB", token: null, raw: BigInt(seen.value).toString() });
  const byToken = new Map();
  for (const move of seen.moves) if (move.to === paidTo && BigInt(move.raw) > 0n) byToken.set(move.token, (byToken.get(move.token) ?? 0n) + BigInt(move.raw));
  for (const [token, raw] of byToken) {
    // The token is asked what it is called and how its amounts are written.
    const symbol = textFrom(await first.rpc("eth_call", [{ to: token, data: "0x95d89b41" }, "latest"]).catch(() => null));
    const decimals = await first.rpc("eth_call", [{ to: token, data: "0x313ce567" }, "latest"]).then((hex) => Number(BigInt(hex)), () => null);
    if (!symbol || decimals === null || decimals > 36) throw new Error(`that transaction moved a token (${token}) that does not say what it is, so the amount cannot be read`);
    paid.push({ amount: inUnits(raw, decimals), symbol, token, raw: raw.toString() });
  }
  if (paid.length === 0) throw new Error(`that transaction did not pay the winner's wallet (${paidTo})`);
  for (const p of paid) p.what = `${p.amount} ${p.symbol}`;
  return { tx: hash, to: paidTo, from: seen.from, block: seen.block, time: seen.time, what: paid.map((p) => p.what).join(" and "), paid, nodes: { asked: asked.length, agreed: answers.length } };
}

const sentence = (words) => `${words[0].toUpperCase()}${words.slice(1)}${/[.!?]$/.test(words) ? "" : "."}`;

/**
 * Decide one payment somebody says they made.
 * @param claim  from Kickoff's server: { tx, at, decidedAt, name, wallet, token, raw, what }
 * @param now    the time, in seconds
 * @param read   reads a payment on X Layer: readPayment
 * @returns { verdict: "paid", to, token, raw, what } | { verdict: "wait", why } | { verdict: "refuse", reason }
 */
export async function checkClaim({ claim, now, read = readPayment }) {
  if (!claim.wallet) return { verdict: "refuse", reason: `${claim.name ?? "The winner"} has no wallet linked now, so there is nowhere to have paid them.` };
  let payment;
  try {
    payment = await read({ tx: claim.tx, wallet: claim.wallet });
  } catch (error) {
    if (error.later || (error.missing && now - claim.at < WAIT_FOR_TX)) return { verdict: "wait", why: error.message };
    return { verdict: "refuse", reason: sentence(error.message.replace(/the winner's wallet \(0x[0-9a-f]{40}\)/, `${claim.name ?? "the winner"}'s wallet`)) };
  }
  // A payment made before the group had its winners was for something else.
  if (claim.decidedAt !== null && payment.time < claim.decidedAt) return { verdict: "refuse", reason: "That payment was made before this group had its winners, so it is not this prize." };
  // A prize that is only a line of words: anything that reached the wallet is what was paid.
  if (!claim.token) return { verdict: "paid", to: payment.to, token: null, raw: null, what: payment.what };
  const symbol = claim.what.split(" ").pop();
  const inToken = payment.paid.find((p) => p.token === claim.token);
  if (!inToken) return { verdict: "refuse", reason: `That payment was not in ${symbol}. It paid ${payment.what}, and a token that only calls itself ${symbol} does not count.` };
  if (BigInt(inToken.raw) < BigInt(claim.raw)) return { verdict: "refuse", reason: `It paid ${inToken.amount} ${symbol}, less than the ${claim.what} share.` };
  return { verdict: "paid", to: payment.to, token: inToken.token, raw: inToken.raw, what: `${inToken.amount} ${symbol}` };
}

/**
 * One round on the payments waiting to be read. Each is read on X Layer and Kickoff's server is
 * told what was found.
 * @param kickoff  Kickoff's server (server.js): prizeClaims, recordPrize, refusePrize
 * @returns { did, problems }: lines about what happened
 */
export async function prizeRound({ kickoff, now, read = readPayment }) {
  const did = [];
  const problems = [];
  let claims;
  try {
    claims = await kickoff.prizeClaims();
  } catch (error) {
    return { did, problems: [`The list of prize payments to read could not be fetched (${error.message}).`] };
  }
  for (const claim of claims) {
    const where = `${claim.code}, place ${claim.place}`;
    try {
      const found = await checkClaim({ claim, now, read });
      if (found.verdict === "wait") continue;
      if (found.verdict === "refuse") {
        await kickoff.refusePrize({ code: claim.code, place: claim.place, tx: claim.tx, reason: found.reason });
        did.push(`Prize payment not accepted (${where}): ${found.reason}`);
        continue;
      }
      await kickoff.recordPrize({ code: claim.code, place: claim.place, tx: claim.tx, to: found.to, token: found.token, raw: found.raw, what: found.what });
      did.push(`Prize payment read on X Layer and recorded (${where}): ${found.what} to ${claim.name}.`);
    } catch (error) {
      problems.push(`A prize payment could not be dealt with (${where}): ${error.message}`);
    }
  }
  return { did, problems };
}
