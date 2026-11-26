// Going live: the one-off work that puts Kickoff on X Layer.
//
// It is done once, by the robot's wallet, on a TapeOut processor that already exists:
//
//   1. publish one small circuit, which becomes the league
//   2. open that circuit's account (the league's mailbox, site and id all hang off it)
//   3. publish Kickoff's three scoring circuits: football, basketball and tennis
//
// Two things here:
//   lookAtGoingLive()   reads X Layer and says what is still to do and what it costs. Sends nothing.
//   goLive()            does what is still to do, and nothing that is already done.
//
// It can be run again after a failure. Everything it decides comes from what X Layer already
// shows for this wallet, so a step that went through is never paid for twice.

import { XLAYER, connect, leagueId, toHex } from "../../engine/src/index.js";
import { ONE_GATE, TRANSFER, ask } from "./xlayer.js";

export const OKB = 10n ** 18n;
/** Kept aside for gas on top of TapeOut's fees. All of going live used about 0.0001 OKB of gas when it was measured. */
export const GAS_FLOOR = OKB / 500n; // 0.002 OKB
const GAS_FOR_EVERYTHING = 6_000_000n;
const NAND = 0;
const MOST_CIRCUITS = 5000;

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const clean = (hex) => String(hex).trim().toLowerCase().replace(/^0x/, "");
/** True when a contract refused a question, as opposed to the node failing to answer. */
const refused = (error) => error?.code === 3 || /revert/i.test(String(error?.message));
/** Ask, and take "the contract refused" as null. A node that fails to answer is still an error, so a bad connection is never mistaken for "not there". */
const orNull = async (work) => {
  try {
    return await work();
  } catch (error) {
    if (refused(error)) return null;
    throw error;
  }
};

/**
 * The scoring circuits, in the order they are published. The first three went up when Kickoff
 * went live. The last three are football's three predictions, added later: publishing again only
 * sends the ones that are not there yet.
 */
export const SCORING = ["football", "basketball", "tennis", "result", "goalgoal", "score"];
const WORDS = { result: "football result", goalgoal: "football goal goal", score: "football exact score" };

/** The league's circuit first, then the scoring circuits, in the order they are published. */
function wanted(circuits) {
  return [
    { name: "league", what: "the league's own circuit", netlist: clean(ONE_GATE), nIn: 1, nOut: 1 },
    ...SCORING.map((name) => {
      const c = circuits[name];
      if (!c) throw new Error(`the ${name} circuit is missing`);
      return { name, what: `the ${WORDS[name] ?? name} scoring circuit`, netlist: clean(c.netlist), nIn: c.inputs, nOut: c.outputs };
    }),
  ].map((c) => ({ ...c, gates: c.netlist.length / 14 }));
}

/** Every circuit on a processor: Map(number -> holder). Numbers start at 1 and have no gaps. */
async function holders(rpc, processor) {
  const out = new Map();
  for (let id = 1; id <= MOST_CIRCUITS; id++) {
    const got = await orNull(() => ask(rpc, processor, "ownerOf(uint256)", [id], ["address"]));
    if (!got || /^0x0{40}$/.test(got[0])) return out;
    out.set(id, got[0]);
  }
  throw new Error("this processor has more circuits than Kickoff can look through");
}

/**
 * What X Layer shows now, and what is still to do.
 * @param node      an X Layer node's address
 * @param wallet    the robot's wallet address
 * @param circuits  { football, basketball, tennis }, each { netlist (hex), inputs, outputs }
 * @returns {
 *   wallet, balance, processor, fees, next (the number the next new circuit will get),
 *   have { league, football, basketball, tennis } (circuit numbers, or null), opened,
 *   league { circuit, account, id } (as it is, or as it would be),
 *   steps [ { name, what, does, fee } ], fee (TapeOut's fees for those steps), gas, need, short
 * }
 */
export async function lookAtGoingLive({ node, wallet, processor, opener, mailbox = XLAYER.mailbox, circuits }) {
  const rpc = connect(node);
  const chainId = Number(BigInt(await rpc("eth_chainId", [])));
  const [transistors] = await ask(rpc, processor, "transistors()", [], ["address"]);
  const [price] = await ask(rpc, transistors, "mintPrice()", [], ["uint256"]);
  const [flat] = await ask(rpc, transistors, "protocolFee()", [], ["uint256"]);
  const [tapeoutFee] = await ask(rpc, processor, "TAPEOUT_FEE()", [], ["uint256"]);
  const [openFee] = await ask(rpc, opener, "FEE()", [], ["uint256"]);
  const fees = { transistors, price, flat, tapeoutFee, openFee };
  const balance = BigInt(await rpc("eth_getBalance", [wallet, "latest"]));
  const gasPrice = BigInt(await rpc("eth_gasPrice", []));
  let held = (await ask(rpc, transistors, "balanceOf(address,uint256)", [wallet, NAND], ["uint256"]))[0];

  // Which of Kickoff's circuits this wallet has already published here.
  const all = await holders(rpc, processor);
  const next = all.size + 1;
  const list = wanted(circuits);
  const have = Object.fromEntries(list.map((c) => [c.name, null]));
  for (const [id, holder] of all) {
    if (!same(holder, wallet)) continue;
    const [netlist] = await ask(rpc, processor, "netlist(uint256)", [id], ["bytes"]);
    const match = list.find((c) => have[c.name] === null && c.netlist === toHex(netlist));
    if (match) have[match.name] = id;
  }
  const opened = have.league !== null && (await ask(rpc, opener, "isOpened(address,uint256)", [processor, have.league], ["bool"]))[0];

  const steps = [];
  for (const c of list) {
    if (have[c.name] === null) {
      const buy = BigInt(c.gates) > held ? BigInt(c.gates) - held : 0n;
      held -= BigInt(c.gates) - buy;
      steps.push({ name: c.name, what: c.what, does: "publish", buy, fee: (buy > 0n ? buy * price + flat : 0n) + tapeoutFee, circuit: c });
    }
    if (c.name === "league" && !opened) steps.push({ name: "account", what: "the league's account", does: "open", fee: openFee });
  }
  const fee = steps.reduce((sum, s) => sum + s.fee, 0n);
  const gas = steps.length === 0 ? 0n : [GAS_FLOOR, GAS_FOR_EVERYTHING * gasPrice * 3n].reduce((a, b) => (a > b ? a : b));
  const need = fee + gas;

  const circuit = have.league ?? next;
  const account = (await orNull(() => ask(rpc, mailbox, "accountOf(address,uint256)", [processor, circuit], ["address"])))?.[0] ?? null;
  const league = { circuit, account, id: account ? toHex(leagueId(chainId, account)) : null };

  return { chainId, wallet: wallet.toLowerCase(), balance, processor, fees, next, have, opened, league, steps, fee, gas, need, short: need > balance ? need - balance : 0n };
}

/**
 * Do what is still to do.
 * @param sender        from castSender(): the robot's wallet
 * @param serverLeague  the league Kickoff's server is set up for (hex). If the league this would
 *                      make is a different one, nothing is sent unless `newLeague` is true.
 * @param anyChain      only for tests and rehearsals on a stand-in chain
 * @param say           called with a line for each thing done
 * @returns the look afterwards, with `spent` (what left the wallet, in wei) and `did` (steps done)
 */
export async function goLive({ node, sender, processor, opener, mailbox = XLAYER.mailbox, circuits, serverLeague = null, newLeague = false, anyChain = false, say = () => {} }) {
  const rpc = connect(node);
  const settings = { node, wallet: sender.address, processor, opener, mailbox, circuits };
  const before = await lookAtGoingLive(settings);
  if (before.chainId !== XLAYER.chainId && !anyChain) throw new Error(`this node is not X Layer (it is chain ${before.chainId})`);
  if (before.steps.length === 0) return { ...before, spent: 0n, did: [] };
  if (before.short > 0n) throw new Error(`the wallet is short by ${inOkb(before.short)}, so nothing was sent`);
  if (serverLeague && before.have.league === null && before.league.id !== clean(serverLeague) && !newLeague) {
    throw new Error("the league this would make is not the one Kickoff's server is set up for, so nothing was sent");
  }

  const did = [];
  let league = before.have.league;
  for (const step of before.steps) {
    if (step.does === "open") {
      await sender.transact({ to: opener, signature: "open(address,uint256)", values: [processor, BigInt(league)], value: before.fees.openFee });
      const [opened] = await ask(rpc, opener, "isOpened(address,uint256)", [processor, league], ["bool"]);
      if (!opened) throw new Error("the league's account did not open");
      say(`Opened the league's account.`);
    } else {
      const c = step.circuit;
      if (step.buy > 0n) {
        await sender.transact({ to: before.fees.transistors, signature: "mint(uint256,uint256)", values: [NAND, step.buy], value: step.buy * before.fees.price + before.fees.flat });
      }
      const receipt = await sender.transact({ to: processor, signature: "tapeout(bytes,uint32,uint32)", values: [`0x${c.netlist}`, c.nIn, c.nOut], value: before.fees.tapeoutFee });
      const made = receipt.logs.find(
        (log) => same(log.address, processor) && log.topics[0] === TRANSFER && log.topics.length === 4 && same(`0x${log.topics[2].slice(26)}`, sender.address),
      );
      if (!made) throw new Error(`the processor did not report the new circuit for ${step.what}`);
      const id = Number(BigInt(made.topics[3]));
      if (step.name === "league") league = id;
      say(`Published ${step.what}: circuit ${id}.`);
    }
    did.push(step.name);
  }

  const after = await lookAtGoingLive(settings);
  if (after.steps.length > 0) throw new Error("something is still not done. Run it again: what is done will not be paid for twice");
  return { ...after, spent: before.balance - after.balance, did };
}

/** An amount of OKB in words, to six places. */
export function inOkb(wei) {
  const millionths = (BigInt(wei) + 5n * 10n ** 11n) / 10n ** 12n;
  return `${millionths / 1_000_000n}.${String(millionths % 1_000_000n).padStart(6, "0")} OKB`;
}

/** A look, in words. */
export function lookInWords(look, { serverLeague = null } = {}) {
  const lines = [];
  const row = (label, value) => lines.push(`${label.padEnd(26)}${value}`);
  row("The robot's wallet:", look.wallet);
  row("It holds:", inOkb(look.balance));
  row("The processor:", look.processor);
  lines.push("");
  if (look.steps.length === 0) {
    lines.push("Kickoff is live. There is nothing left to do and nothing to pay.");
  } else {
    lines.push("Still to do:");
    look.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${`${s.does === "open" ? "Open" : "Publish"} ${s.what}`.padEnd(44)}${inOkb(s.fee)}`));
    lines.push("");
    row("TapeOut's fees in all:", inOkb(look.fee));
    row("Kept aside for gas:", inOkb(look.gas));
    row("Needed in the wallet:", inOkb(look.need));
    lines.push(look.short > 0n ? `THE WALLET IS SHORT BY ${inOkb(look.short)}.` : "The wallet holds enough.");
  }
  lines.push("");
  const done = Object.entries(look.have).filter(([, id]) => id !== null);
  if (done.length > 0) row("Already published:", done.map(([name, id]) => `${name} = circuit ${id}`).join(", "));
  row(look.have.league === null ? "The league would be:" : "The league is:", `circuit ${look.league.circuit}`);
  if (look.league.account) {
    row("Its account:", look.league.account);
    row("Its id:", `0x${look.league.id}`);
    if (serverLeague) {
      lines.push(
        look.league.id === clean(serverLeague)
          ? "That is the league Kickoff's server is already set up for."
          : "THAT IS NOT THE LEAGUE KICKOFF'S SERVER IS SET UP FOR. The server would have to be switched over.",
      );
    }
  }
  return lines.join("\n");
}
