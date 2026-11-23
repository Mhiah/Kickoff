// Fetching a league from X Layer.
//
// reader.js works a league out from its inbox's messages. This file goes and gets those messages
// from an X Layer node, and the published files of opened picks from the league's on-chain site.
// Give it a league's id and it returns the table, using nothing but what the chain holds.
//
// How a league's inbox is read (this is the way TapeOut's mailbox is designed to be read):
//
//   1. Ask the mailbox how many messages the inbox holds, and for its list of them. For each
//      message the mailbox itself stores who sent it, the block it is in, the time, and a
//      fingerprint of the message.
//   2. The text of a message is not stored. It is in the log of the block the message is in. So
//      fetch that block's log, and check the text against the fingerprint the mailbox stored.
//      (TAP-10 section 13 sets this out. Only the text and its reference are taken from the log.)
//
// If one message cannot be fetched, or does not match its fingerprint, nothing is returned. A table
// built from an inbox with a hole in it could be wrong, so no table is built at all.
//
// A "node" here is the address of any X Layer node, such as https://rpc.xlayer.tech. Everything is
// read with plain questions any node answers. Nothing is sent and no wallet is needed.
//
// One honest limit: this asks one node and believes its answers about what the mailbox stores. A
// node that lied could hide messages by claiming the inbox is shorter than it is. TapeOut's own
// rule is to ask several independent nodes and require them to agree. That is still to do here.
// Until then, use a node you trust, or run your own.

import { callData, decode, decodeRecords, eventTopic } from "./abi.js";
import { concat, equal, fromHex, id32, sha256, toHex } from "./bytes.js";
import { keccak256 } from "./keccak.js";
import { tableFromChain } from "./league.js";
import { openingsPath } from "./openings.js";
import { readLeague } from "./reader.js";

/** TapeOut on X Layer. */
export const XLAYER = Object.freeze({
  chainId: 196,
  node: "https://rpc.xlayer.tech",
  mailbox: "0xe61a9c7213a6aa616c246a2b569e555b417b25ee",
  sites: "0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6",
});

const SENT = `0x${toHex(eventTopic("Sent(bytes32,address,bytes32,uint256,uint256,bytes)"))}`;
const ENTRY = ["address", "uint256", "uint256", "bytes32"]; // who sent it, block, time, fingerprint
const PAGE = 200; // the most the mailbox hands over in one go
const PIECE = 20000; // bytes of a site file read in one go

const quantity = (n) => `0x${BigInt(n).toString(16)}`;

/**
 * Something to ask a node questions with. Pass a node's web address, or a function
 * (method, params) => answer, which is how the tests stand in for a node.
 */
export function connect(node) {
  if (typeof node === "function") return node;
  let nextId = 1;
  return async (method, params = []) => {
    const response = await fetch(node, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    if (!response.ok) throw new Error(`the node answered with error ${response.status}`);
    const answer = await response.json();
    if (answer.error) {
      throw Object.assign(new Error(`the node refused ${method}: ${answer.error.message}`), { code: answer.error.code });
    }
    return answer.result;
  };
}

/** True when a node says a contract refused a question, as opposed to the node itself failing. */
const refused = (error) => error?.code === 3 || /revert/i.test(String(error?.message));

async function ask(rpc, contract, signature, values, block = "latest") {
  return fromHex(await rpc("eth_call", [{ to: contract, data: callData(signature, values) }, block]));
}

/** A league's id is its inbox's address in the mailbox: 4 zero bytes, the chain's number, the account. */
export function leagueId(chainId, account) {
  const clean = String(account).toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error("not an address");
  return fromHex(`00000000${BigInt(chainId).toString(16).padStart(16, "0")}${clean}`);
}

/** The chain and the account inside a league's id. */
export function parseLeagueId(league) {
  const id = id32(league, "league");
  const hex = toHex(id);
  const chainId = Number(BigInt(`0x${hex.slice(8, 24)}`));
  if (hex.slice(0, 8) !== "00000000" || chainId === 0 || /^0+$/.test(hex.slice(24))) {
    throw new Error("this is not a league id");
  }
  return { chainId, account: `0x${hex.slice(24)}` };
}

/** The id of the league that a TapeOut circuit owns: the processor's address and the circuit's number. */
export async function leagueOfCircuit({ node, mailbox = XLAYER.mailbox, processor, circuit }) {
  const rpc = connect(node);
  const chainId = Number(BigInt(await rpc("eth_chainId", [])));
  const [account] = decode(["address"], await ask(rpc, mailbox, "accountOf(address,uint256)", [processor, circuit]));
  return leagueId(chainId, account);
}

async function inboxEntries(rpc, mailbox, league, count, block) {
  const entries = [];
  try {
    while (entries.length < count) {
      const page = decodeRecords(
        ENTRY,
        await ask(rpc, mailbox, "inboxPage(bytes32,uint256,uint256)", [league, entries.length, PAGE], block),
      );
      if (page.length === 0) throw new Error("the mailbox handed over an empty page");
      entries.push(...page);
    }
    return entries.slice(0, count);
  } catch (error) {
    if (!refused(error)) throw error;
    // A mailbox that does not hand over whole pages: ask for the messages one by one.
    const oneByOne = [];
    for (let i = 0; i < count; i++) {
      oneByOne.push(decode(ENTRY, await ask(rpc, mailbox, "inboxAt(bytes32,uint256)", [league, i], block)));
    }
    return oneByOne;
  }
}

/** The mailbox's logs in one block. Some nodes do not serve logs, so the block's receipts are the fallback. */
async function mailboxLogs(rpc, mailbox, leagueTopic, blockNumber) {
  const at = quantity(blockNumber);
  try {
    return await rpc("eth_getLogs", [{ address: mailbox, fromBlock: at, toBlock: at, topics: [SENT, leagueTopic] }]);
  } catch {
    const receipts = await rpc("eth_getBlockReceipts", [at]);
    return (receipts ?? []).flatMap((receipt) => receipt.logs ?? []);
  }
}

/**
 * Fetch a league's whole inbox.
 *
 * @returns { league, account, chainId, block, messages }
 *   account    the league's own account, the only one whose word counts
 *   block      the block everything was read at
 *   messages   the inbox, in the form reader.js takes
 */
export async function fetchLeague({ node, mailbox = XLAYER.mailbox, league }) {
  const rpc = connect(node);
  const id = id32(league, "league");
  const { chainId, account } = parseLeagueId(id);
  const nodeChain = Number(BigInt(await rpc("eth_chainId", [])));
  if (nodeChain !== chainId) {
    throw new Error(`this league is on chain ${chainId}, but the node is for chain ${nodeChain}`);
  }

  // Everything is read as it stood at one block, so the list and the messages cannot disagree.
  const block = Number(BigInt(await rpc("eth_blockNumber", [])));
  const at = quantity(block);
  const [counted] = decode(["uint256"], await ask(rpc, mailbox, "inboxCount(bytes32)", [id], at));
  const count = Number(counted);
  const entries = await inboxEntries(rpc, mailbox, id, count, at);

  const leagueTopic = `0x${toHex(id)}`;
  const logsOfBlock = new Map();
  const messages = [];
  for (let index = 0; index < count; index++) {
    const [from, inBlock, timestamp, fingerprint] = entries[index];
    const blockNumber = Number(inBlock);
    if (!logsOfBlock.has(blockNumber)) logsOfBlock.set(blockNumber, await mailboxLogs(rpc, mailbox, leagueTopic, blockNumber));
    let found = null;
    for (const log of logsOfBlock.get(blockNumber)) {
      // A log is believed only if it is the mailbox's, for this inbox, from the sender the mailbox
      // recorded, at this place in the inbox, and its text matches the mailbox's fingerprint.
      if (String(log.address).toLowerCase() !== mailbox.toLowerCase()) continue;
      const topics = (log.topics ?? []).map((t) => String(t).toLowerCase());
      if (topics.length !== 4 || topics[0] !== SENT || topics[1] !== leagueTopic) continue;
      if (`0x${topics[2].slice(26)}` !== from) continue;
      let inboxIndex;
      let payload;
      try {
        [inboxIndex, , payload] = decode(["uint256", "uint256", "bytes"], log.data);
      } catch {
        continue;
      }
      if (inboxIndex !== BigInt(index)) continue;
      const ref = fromHex(topics[3]);
      // The mailbox's own fingerprint of a message: keccak256(reference, then keccak256(the text)).
      if (equal(keccak256(concat(ref, keccak256(payload))), fingerprint)) found = { ref, payload };
    }
    if (!found) {
      throw new Error(
        `message ${index} of this inbox could not be fetched in a form that matches the mailbox's fingerprint of it, so no table is built`,
      );
    }
    messages.push({ index, from, timestamp: Number(timestamp), block: blockNumber, ...found });
  }
  return { league: id, account, chainId, block, messages };
}

/**
 * Fetch one file from an account's on-chain site. Returns its bytes, or null if there is no such
 * file. Throws an error marked `damaged` if the file is half uploaded or does not match the
 * fingerprint stored with it.
 */
export async function fetchSiteFile({ node, sites = XLAYER.sites, account, path, block = "latest" }) {
  const rpc = connect(node);
  let info;
  try {
    info = decode(
      ["uint256", "string", "bytes32", "uint256", "uint256"],
      await ask(rpc, sites, "fileInfo(address,string)", [account, path], block),
    );
  } catch (error) {
    if (!refused(error)) throw error;
    return null;
  }
  const [size, , declared, , pieces] = info;
  if (pieces === 0n) return null;

  const parts = [];
  for (let offset = 0; offset < Number(size); offset += PIECE) {
    const length = Math.min(PIECE, Number(size) - offset);
    const [piece] = decode(
      ["bytes"],
      await ask(rpc, sites, "readRange(address,string,uint256,uint256)", [account, path, offset, length], block),
    );
    parts.push(piece);
  }
  const file = concat(...parts);
  if (file.length !== Number(size) || !equal(await sha256(file), declared)) {
    throw Object.assign(new Error("the file is half uploaded or damaged: it does not match the fingerprint stored with it"), {
      damaged: true,
    });
  }
  return file;
}

/**
 * From a league's id to its table, using only what an X Layer node holds.
 *
 * @param node      a node's web address
 * @param league    the league's 32-byte id
 * @param circuits  from loadCircuits()
 * @returns what tableFromChain() returns, plus { account, chainId, block, messages, files }
 *   files   for each match with a result: { match, path, found } and, if the file could not be
 *           used, why
 */
export async function tableFromXLayer({ node = XLAYER.node, mailbox = XLAYER.mailbox, sites = XLAYER.sites, league, circuits, players = [] }) {
  const rpc = connect(node);
  const inbox = await fetchLeague({ node: rpc, mailbox, league });
  const { matches } = await readLeague({ league: inbox.league, account: inbox.account, messages: inbox.messages });

  const openingsFiles = {};
  const files = [];
  for (const match of matches) {
    if (match.state !== "final") continue;
    const path = openingsPath(match.id);
    const entry = { match: toHex(match.id), path, found: false };
    try {
      const file = await fetchSiteFile({ node: rpc, sites, account: inbox.account, path, block: quantity(inbox.block) });
      if (file) {
        openingsFiles[toHex(match.id)] = new TextDecoder().decode(file);
        entry.found = true;
      }
    } catch (error) {
      if (!error.damaged) throw error;
      entry.why = error.message;
    }
    files.push(entry);
  }

  const built = await tableFromChain({
    league: inbox.league,
    account: inbox.account,
    messages: inbox.messages,
    openingsFiles,
    circuits,
    players,
  });
  return { ...built, account: inbox.account, chainId: inbox.chainId, block: inbox.block, messages: inbox.messages, files };
}
