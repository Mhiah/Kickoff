// The robot's hands on X Layer: reading the league's record, and writing to it.
//
// chain.js decides what to write. This file does the writing, through TapeOut's own contracts:
//
//   the mailbox (TapeSend)   announcements, locks and results go to the league's own inbox, sent
//                            from the league's own account. Only the holder of the league's
//                            circuit can send as the league.
//   the site store (DeWEB)   the opened picks are published as a file on the league's site.
//
// Two ways of sending are offered:
//   castSender   signs with a private key, using Foundry's `cast`. This is the real one. The key is
//                handed to `cast` and to nothing else, and is never printed.
//   nodeSender   asks the node itself to send from an account it holds. Only test nodes do that.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

import { callData, decode, eventTopic } from "../../engine/src/abi.js";
import { XLAYER, connect, fetchLeague, fetchSiteFile, fromHex, leagueId, openingsPath, parseLeagueId, readLeague, toHex } from "../../engine/src/index.js";

const quantity = (n) => `0x${BigInt(n).toString(16)}`;
const TRANSFER = `0x${toHex(eventTopic("Transfer(address,address,uint256)"))}`;
/** The smallest circuit there is: one gate that flips its one input. Publishing it is what makes an account a league. */
const ONE_GATE = "0x00000002000002";

async function receiptOf(rpc, hash, tries = 300) {
  for (let i = 0; i < tries; i++) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) {
      if (BigInt(receipt.status) !== 1n) throw new Error(`the chain turned a transaction down (${hash})`);
      return receipt;
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`a transaction never went through (${hash})`);
}

/** Send from an account the node itself holds. For test nodes only. */
export function nodeSender({ node, from }) {
  const rpc = connect(node);
  return {
    address: from.toLowerCase(),
    async transact({ to, signature, values, value = 0n }) {
      const hash = await rpc("eth_sendTransaction", [{ from, to, data: callData(signature, values), value: quantity(value) }]);
      return receiptOf(rpc, hash);
    },
  };
}

/** A value written the way `cast` takes it on the command line. */
function forCast(value) {
  if (value instanceof Uint8Array) return `0x${toHex(value)}`;
  if (typeof value === "bigint" || typeof value === "number") return BigInt(value).toString();
  return String(value);
}

const run = (file, args) =>
  new Promise((done, fail) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Whatever went wrong is reported without the arguments, because the key is among them.
      if (error) fail(new Error(`cast could not send it: ${String(stderr || error.message).split("\n").find((l) => l.trim() && !l.includes("--private-key")) ?? "no reason given"}`.slice(0, 300)));
      else done(stdout);
    });
  });

/**
 * Sign with a private key and send, using Foundry's `cast`.
 * @param key  the private key. It is passed to `cast` and nowhere else.
 */
export async function castSender({ node, key, exec = run }) {
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error("the robot's wallet key is missing or is not a private key");
  const rpc = connect(node);
  const address = (await exec("cast", ["wallet", "address", "--private-key", key])).trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("cast did not give the wallet's address");
  return {
    address,
    async transact({ to, signature, values, value = 0n }) {
      const out = await exec("cast", ["send", "--rpc-url", node, "--private-key", key, "--value", BigInt(value).toString(), "--json", to, signature, ...values.map(forCast)]);
      const hash = JSON.parse(out).transactionHash;
      return receiptOf(rpc, hash);
    },
  };
}

/** Ask a contract a question. */
async function ask(rpc, to, signature, values, types) {
  return decode(types, fromHex(await rpc("eth_call", [{ to, data: callData(signature, values) }, "latest"])));
}

/**
 * Become a league: publish one small circuit on a TapeOut processor and open its account. Done
 * once. The account that comes out is the league, and its address is inside every match id and
 * every sealed pick from then on.
 * @returns { processor, circuit, account, league (hex), spent (in wei) }
 */
export async function becomeALeague({ node, sender, processor, opener, mailbox = XLAYER.mailbox }) {
  const rpc = connect(node);
  const chainId = Number(BigInt(await rpc("eth_chainId", [])));
  const [transistors] = await ask(rpc, processor, "transistors()", [], ["address"]);
  const [price] = await ask(rpc, transistors, "mintPrice()", [], ["uint256"]);
  const [flat] = await ask(rpc, transistors, "protocolFee()", [], ["uint256"]);
  const [tapeoutFee] = await ask(rpc, processor, "TAPEOUT_FEE()", [], ["uint256"]);
  const [openFee] = await ask(rpc, opener, "FEE()", [], ["uint256"]);

  await sender.transact({ to: transistors, signature: "mint(uint256,uint256)", values: [0, 1], value: price + flat });
  const receipt = await sender.transact({ to: processor, signature: "tapeout(bytes,uint32,uint32)", values: [ONE_GATE, 1, 1], value: tapeoutFee });
  const minted = receipt.logs.find(
    (log) => log.address.toLowerCase() === processor.toLowerCase() && log.topics[0] === TRANSFER && log.topics.length === 4 && `0x${log.topics[2].slice(26)}`.toLowerCase() === sender.address,
  );
  if (!minted) throw new Error("the processor did not report the new circuit");
  const circuit = BigInt(minted.topics[3]);
  await sender.transact({ to: opener, signature: "open(address,uint256)", values: [processor, circuit], value: openFee });
  const [opened] = await ask(rpc, opener, "isOpened(address,uint256)", [processor, circuit], ["bool"]);
  if (!opened) throw new Error("the league's account did not open");
  const [account] = await ask(rpc, mailbox, "accountOf(address,uint256)", [processor, circuit], ["address"]);
  return { processor, circuit: circuit.toString(), account, league: toHex(leagueId(chainId, account)), spent: price + flat + tapeoutFee + openFee };
}

/**
 * The league on X Layer, as chain.js uses it.
 * @param league     the league's id, as hex
 * @param processor  the TapeOut processor the league's circuit is on
 * @param circuit    the league's circuit number
 * @param sender     from castSender() or nodeSender(): the holder of that circuit
 */
export function createChain({ node, league, processor, circuit, sender, mailbox = XLAYER.mailbox, sites = XLAYER.sites }) {
  const id = fromHex(league);
  const { account } = parseLeagueId(id);
  return {
    account,
    /** What is on X Layer for each match: Map(match id -> { announced, lock, resulted }). */
    async read() {
      const got = await fetchLeague({ node, mailbox, league: id });
      const { matches } = await readLeague({ league: id, account: got.account, messages: got.messages });
      return new Map(matches.map((m) => [toHex(m.id), { announced: true, lock: m.lock, resulted: m.state !== "pending" }]));
    },
    /** Send a message to the league's own inbox, as the league. */
    send(message) {
      return sender.transact({ to: mailbox, signature: "send(address,uint256,bytes32,bytes32,bytes)", values: [processor, BigInt(circuit), id, message.ref, message.payload] });
    },
    /** Publish a match's file of opened picks on the league's site. */
    publish(match, fileText) {
      const bytes = new TextEncoder().encode(fileText);
      const sha = new Uint8Array(createHash("sha256").update(bytes).digest());
      return sender.transact({ to: sites, signature: "putFile(address,string,string,bytes32,bytes)", values: [account, openingsPath(fromHex(match)), "application/json", sha, bytes] });
    },
    /** How many opened picks are in the file already published for a match. */
    async publishedCount(match) {
      try {
        const file = await fetchSiteFile({ node, sites, account, path: openingsPath(fromHex(match)) });
        return file ? JSON.parse(new TextDecoder().decode(file)).openings.length : 0;
      } catch {
        return 0;
      }
    },
  };
}
