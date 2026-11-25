// Putting Kickoff's website on X Layer itself (TapeOut's DeWEB).
//
// The league's account already has a site on chain: it is where the robot publishes each match's
// opened picks. This puts the website's own files beside them, so the site people play on can be
// opened from X Layer without Kickoff's web host, and nobody can change it without the wallet that
// holds the league's circuit.
//
// Three things make a site on chain show up:
//   1. its files, in TapeOut's site store, each with the fingerprint of the whole file
//   2. a page to fall back to (index.html)
//   3. its name switched on. The name is not chosen: it is the circuit's number, X Layer's area
//      code (2) and the processor's number, as in 5.2.409.tape. A browser opens it through a
//      gateway, at https://5-2-409.tapekit.org/
//
// The copy on chain is the same files as the website, with one line changed: config.js is told
// the full address of Kickoff's server, because on chain there is no "same site" to ask.
//
// Like chain.js, the rules here are given a `chain` to read and write through, so every one of
// them can be checked with a stand-in. siteOnXLayer() at the bottom is the real one.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { XLAYER, connect, fetchSiteFile, toHex } from "../../engine/src/index.js";
import { PIECE, ask, publishCalls } from "./xlayer.js";

/** TapeOut on X Layer: the contract that switches a site's name on, and the list of processors. */
export const NAMES = "0x68809fd2fb343aa57d0aeb7f33defe477c9666f9";
export const FACTORY = "0x1f09daefa827f02cbb40967cc91b259763760761";
/** X Layer's area code in an on-chain name. */
export const AREA = 2;
/** How long the name is switched on for at a time. */
export const MONTHS = 12;
/** The most the site store keeps of one file: 350 pieces. */
export const MAX_PIECES = 350;
/** The name was free on X Layer when this was written. If it ever costs more than this, publishing stops and says so. */
export const NAME_FEE_LIMIT = 10n ** 16n; // 0.01 OKB

export const inOkb = (wei) => `${(Number(wei / 10n ** 10n) / 1e8).toFixed(6)} OKB`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** What each kind of file is served as. A kind that is not here is not published. */
const TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  json: "application/json",
  png: "image/png",
};
/** Folders and files of web/ that are not part of the site people open. */
const LEFT_OUT = [/^test\//, /^scripts\//, /(^|\/)README\.md$/, /(^|\/)\./];
/** Paths the gateway keeps for itself. */
const RESERVED = [/^\.tape\//, /^sw\.js$/, /^openings\//];

const SERVER_LINE = 'export const SERVER = "";';

/** The site's on-chain name and where a browser opens it. */
export const siteName = ({ circuit, number }) => `${circuit}.${AREA}.${number}.tape`;
export const siteAddress = ({ circuit, number }) => `https://${circuit}-${AREA}-${number}.tapekit.org/`;

/**
 * The files of the site as they go on chain.
 * @param dir     the website's folder (web/)
 * @param server  the full address of Kickoff's server, which the copy on chain is told to use
 * @returns [{ path, contentType, bytes }], in order of path
 */
export function siteFiles({ dir, server }) {
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(server ?? "")) throw new Error("the server's address must be a full https address with nothing after it");
  const found = [];
  const walk = (folder, prefix) => {
    for (const name of readdirSync(folder).sort()) {
      const path = prefix + name;
      const full = join(folder, name);
      if (statSync(full).isDirectory()) {
        if (!LEFT_OUT.some((rule) => rule.test(`${path}/`))) walk(full, `${path}/`);
        continue;
      }
      if (LEFT_OUT.some((rule) => rule.test(path))) continue;
      if (!/^[A-Za-z0-9._/-]+$/.test(path)) throw new Error(`${path}: a file's name may only have letters, digits, dots, dashes and underscores`);
      if (RESERVED.some((rule) => rule.test(path))) throw new Error(`${path}: that place on the site is kept for something else`);
      const contentType = TYPES[name.split(".").pop().toLowerCase()];
      if (!contentType) throw new Error(`${path}: it is not known what kind of file this is, so it was not published`);
      let bytes = new Uint8Array(readFileSync(full));
      if (path === "config.js") {
        const text = new TextDecoder().decode(bytes);
        if (text.split(SERVER_LINE).length !== 2) throw new Error("config.js no longer has the line that says where the server is, so the copy could not be told");
        bytes = new TextEncoder().encode(text.replace(SERVER_LINE, `export const SERVER = ${JSON.stringify(server)};`));
      }
      if (bytes.length === 0) throw new Error(`${path}: the file is empty`);
      if (Math.ceil(bytes.length / PIECE) > MAX_PIECES) throw new Error(`${path}: the file is too big for the site store`);
      found.push({ path, contentType, bytes });
    }
  };
  walk(dir, "");
  if (!found.some((f) => f.path === "index.html")) throw new Error("there is no index.html, so there is no site to publish");
  return found;
}

/** Roughly what sending one piece costs in gas: measured at 5,924,259 for a full piece (docs/FEES.md). */
const gasFor = (bytes) => 110_000n + 243n * BigInt(bytes);

/**
 * What is on X Layer already, and what is still to do. Sends nothing.
 * @param files   from siteFiles()
 * @param chain   from siteOnXLayer(), or a stand-in
 * @returns {
 *   name, address, account, wallet, chainId
 *   files      [{ path, size, pieces, state }]: state is "same", "new", "changed" or "half"
 *   send       the files still to send, index.html last
 *   fallback   true if the page to fall back to still has to be set
 *   bind       null, or { fee } if the name still has to be switched on
 *   gas, cost  an estimate of what sending it all costs, and with the name's fee
 *   balance, short
 *   problems   reasons it cannot be done at all, in words
 * }
 */
export async function lookAtSite({ files, chain }) {
  const facts = await chain.facts();
  const list = [];
  for (const file of files) {
    const there = await chain.fileInfo(file.path);
    const pieces = Math.ceil(file.bytes.length / PIECE);
    let state = "same";
    if (!there) state = "new";
    else if (there.sha !== sha256(file.bytes) || there.contentType !== file.contentType) state = "changed";
    else if (there.size !== file.bytes.length || there.pieces !== pieces) state = "half";
    list.push({ path: file.path, size: file.bytes.length, pieces, state });
  }
  const send = list.filter((f) => f.state !== "same").sort((a, b) => (a.path === "index.html") - (b.path === "index.html") || (a.path < b.path ? -1 : 1));
  const fallback = facts.fallback !== "index.html";
  const bind = facts.live ? null : { fee: facts.monthlyFee * BigInt(MONTHS) };

  let gas = 0n;
  for (const f of send) for (let at = 0; at < f.size; at += PIECE) gas += gasFor(Math.min(PIECE, f.size - at));
  if (fallback) gas += 80_000n;
  if (bind) gas += 220_000n;
  const cost = gas * facts.gasPrice + (bind ? bind.fee : 0n);
  // Gas prices move, so the wallet is asked to hold half as much again as the estimate.
  const need = cost + (gas * facts.gasPrice) / 2n;

  const problems = [];
  if (!facts.numberOk) problems.push("the processor's number does not match its address, so the site's name would be wrong");
  if (facts.holder !== facts.wallet) problems.push("this wallet does not hold the league's circuit, and only its holder may write to the league's site");
  if (bind && bind.fee > NAME_FEE_LIMIT) problems.push(`switching the name on now costs ${inOkb(bind.fee)}, which is more than was agreed`);
  return {
    name: facts.name, address: facts.address, account: facts.account, wallet: facts.wallet, chainId: facts.chainId,
    files: list, send, fallback, bind, gas, cost, balance: facts.balance, short: need > facts.balance ? need - facts.balance : 0n, problems,
  };
}

/** A look, in plain words. */
export function siteInWords(look) {
  const bytes = (n) => `${n.toLocaleString("en-GB")} bytes`;
  const out = [];
  out.push(`The site's name on X Layer:  ${look.name}`);
  out.push(`A browser opens it at:       ${look.address}`);
  out.push(`It lives in the league's account, ${look.account}`);
  out.push(`The wallet is ${look.wallet}, holding ${inOkb(look.balance)}.`);
  out.push("");
  const same = look.files.filter((f) => f.state === "same");
  out.push(`The site is ${look.files.length} files, ${bytes(look.files.reduce((sum, f) => sum + f.size, 0))}. Already on X Layer and the same: ${same.length}.`);
  if (look.send.length > 0) {
    out.push("Still to send:");
    const why = { new: "not there yet", changed: "different on X Layer", half: "only part of it is there" };
    for (const f of look.send) out.push(`  ${f.path.padEnd(40)} ${bytes(f.size).padStart(14)}  ${f.pieces} ${f.pieces === 1 ? "piece " : "pieces"}  (${why[f.state]})`);
  }
  if (look.fallback) out.push("The page to fall back to still has to be set.");
  if (look.bind) out.push(`The name still has to be switched on, for ${MONTHS} months. TapeOut's fee for that today: ${look.bind.fee === 0n ? "nothing" : inOkb(look.bind.fee)}.`);
  out.push("");
  if (look.send.length === 0 && !look.fallback && !look.bind) out.push("Nothing is left to do: the site on X Layer is these files.");
  else {
    out.push(`All of that is about ${look.send.reduce((sum, f) => sum + f.pieces, 0) + (look.fallback ? 1 : 0) + (look.bind ? 1 : 0)} transactions and, at today's gas price, about ${inOkb(look.cost)}.`);
    out.push(look.short > 0n ? `THE WALLET IS SHORT BY ${inOkb(look.short)}.` : "The wallet holds enough.");
  }
  for (const problem of look.problems) out.push(`IT CANNOT BE DONE: ${problem}.`);
  return out.join("\n");
}

/**
 * Send what is still to send. What is already on X Layer and the same is left alone, so this is
 * safe to run again after a failure, and running it twice pays for nothing twice.
 * @param anyChain  only for tests and rehearsals on a stand-in chain
 * @param say       called with a line for each thing done
 * @param pause     waits between tries; tests pass one that does not wait
 * @returns the look afterwards, with `spent` (what left the wallet, in wei) and `did` (lines)
 */
export async function publishSite({ files, chain, anyChain = false, say = () => {}, pause = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const before = await lookAtSite({ files, chain });
  if (before.chainId !== XLAYER.chainId && !anyChain) throw new Error(`this node is not X Layer (it is chain ${before.chainId})`);
  if (before.problems.length > 0) throw new Error(`${before.problems[0]}. Nothing was sent`);
  if (before.send.length === 0 && !before.fallback && !before.bind) return { ...before, spent: 0n, did: [] };
  if (before.short > 0n) throw new Error(`the wallet is short by ${inOkb(before.short)}. Nothing was sent`);

  const did = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const { path, pieces } of before.send) {
    const file = byPath.get(path);
    const calls = publishCalls({ account: before.account, path, bytes: file.bytes, contentType: file.contentType });
    // The robot uses this same wallet, and two things sent at the same moment can trip over each
    // other. A file that fails is started again from its first piece, which replaces what was there.
    for (let attempt = 1; ; attempt++) {
      try {
        for (const call of calls) await chain.transact(call);
        break;
      } catch (error) {
        if (attempt === 3) throw new Error(`${path} could not be sent after three tries (${error.message}). Run it again: what is already there will not be sent twice`);
        await pause(4000 * attempt);
      }
    }
    did.push(`${path}: sent${pieces > 1 ? ` in ${pieces} pieces` : ""}`);
    say(did.at(-1));
  }
  if (before.fallback) {
    await chain.transact({ signature: "setFallback(address,string)", values: [before.account, "index.html"] });
    did.push("The page to fall back to is index.html.");
    say(did.at(-1));
  }
  if (before.bind) {
    await chain.transact({ to: "names", signature: "bind(string,address,uint256)", values: [before.name, before.account, BigInt(MONTHS)], value: before.bind.fee });
    did.push(`The name ${before.name} is switched on for ${MONTHS} months.`);
    say(did.at(-1));
  }

  const after = await lookAtSite({ files, chain });
  if (after.send.length > 0 || after.fallback || after.bind) throw new Error("something is still not done. Run it again: what is done will not be sent twice");
  return { ...after, spent: before.balance - after.balance, did };
}

/**
 * Read every file of the site back from X Layer, whole, and compare it with the files here.
 * @returns [{ path, ok, why }]
 */
export async function checkSite({ files, chain }) {
  const out = [];
  for (const file of files) {
    try {
      const bytes = await chain.readFile(file.path);
      if (bytes === null) out.push({ path: file.path, ok: false, why: "it is not on X Layer" });
      else if (sha256(bytes) !== sha256(file.bytes)) out.push({ path: file.path, ok: false, why: "it is different on X Layer" });
      else out.push({ path: file.path, ok: true });
    } catch (error) {
      out.push({ path: file.path, ok: false, why: error.message });
    }
  }
  return out;
}

/**
 * The league's site on X Layer, as the rules above use it.
 * @param sender     from castSender() or nodeSender(): the holder of the league's circuit. For a
 *                   look, only its address is used.
 * @param processor  the TapeOut processor the league's circuit is on, and `number`, its number
 * @param circuit    the league's circuit number
 */
export function siteOnXLayer({ node, sender, processor, number, circuit, mailbox = XLAYER.mailbox, sites = XLAYER.sites, names = NAMES, factory = FACTORY }) {
  const rpc = connect(node);
  const name = siteName({ circuit, number });
  let account = null;
  const theAccount = async () => (account ??= (await ask(rpc, mailbox, "accountOf(address,uint256)", [processor, BigInt(circuit)], ["address"]))[0].toLowerCase());
  const refused = (error) => error?.code === 3 || /revert/i.test(String(error?.message));
  const orNull = async (question) => {
    try {
      return await question();
    } catch (error) {
      if (!refused(error)) throw error;
      return null;
    }
  };
  return {
    async facts() {
      const [numbered] = (await orNull(() => ask(rpc, factory, "cpuAt(uint256)", [BigInt(number)], ["address"]))) ?? [""];
      const [holder] = (await orNull(() => ask(rpc, processor, "ownerOf(uint256)", [BigInt(circuit)], ["address"]))) ?? [""];
      const [fallback] = (await orNull(async () => ask(rpc, sites, "fallbackPath(address)", [await theAccount()], ["string"]))) ?? [""];
      const [monthlyFee] = await ask(rpc, names, "monthlyFee()", [], ["uint256"]);
      // A gateway shows a site if its name is switched on, or if its account has paid for any name.
      const [byName] = (await orNull(async () => ask(rpc, names, "isLive(string,address)", [name, await theAccount()], ["bool"]))) ?? [false];
      const [byAccount] = (await orNull(async () => ask(rpc, names, "isContainerLive(address)", [await theAccount()], ["bool"]))) ?? [false];
      return {
        chainId: Number(BigInt(await rpc("eth_chainId", []))),
        name,
        address: siteAddress({ circuit, number }),
        account: await theAccount(),
        wallet: sender.address.toLowerCase(),
        holder: String(holder).toLowerCase(),
        numberOk: String(numbered).toLowerCase() === processor.toLowerCase(),
        fallback,
        monthlyFee,
        live: byName || byAccount,
        gasPrice: BigInt(await rpc("eth_gasPrice", [])),
        balance: BigInt(await rpc("eth_getBalance", [sender.address, "latest"])),
      };
    },
    async fileInfo(path) {
      const info = await orNull(async () => ask(rpc, sites, "fileInfo(address,string)", [await theAccount(), path], ["uint256", "string", "bytes32", "uint256", "uint256"]));
      if (!info || info[4] === 0n) return null;
      return { size: Number(info[0]), contentType: info[1], sha: toHex(info[2]), pieces: Number(info[4]) };
    },
    async readFile(path) {
      return fetchSiteFile({ node: rpc, sites, account: await theAccount(), path });
    },
    transact({ to, signature, values, value = 0n }) {
      return sender.transact({ to: to === "names" ? names : sites, signature, values, value });
    },
  };
}
