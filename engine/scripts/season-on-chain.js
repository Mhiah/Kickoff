#!/usr/bin/env node
// A rehearsal on a PRIVATE COPY of X Layer. Nothing here can reach the real network: it only works
// against a test node that lets a script act as any account, which no real node allows.
//
// A league plays three matches, one for each sport, through TapeOut's real contracts on the copy:
//
//   1. The host publishes a circuit to be the league and opens its account.
//   2. The league announces the matches, locks each bundle of sealed picks before kickoff, gives
//      each result afterwards, and publishes the opened picks on its on-chain site.
//   3. Two things are done that should not work: the host locks a changed bundle after kickoff,
//      and an outsider writes a result to the league's inbox.
//   4. A member disputes a result.
//
// Then everything is thrown away except the league's id. The league is fetched back from the node
// and the table is rebuilt from that alone. It has to come out as ada 7, bola 4, chidi 1.
//
// Usage:
//   node scripts/season-on-chain.js --node http://127.0.0.1:8545
//
// The node is expected to be a copy of X Layer (anvil --fork-url https://rpc.xlayer.tech). The
// rehearsal publishes on an existing TapeOut processor and pays in OKB only, with test money.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { callData, decode, eventTopic } from "../src/abi.js";
import {
  BASKETBALL, FOOTBALL, TENNIS, XLAYER,
  basketballResult, buildBundle, challengeMessage, connect, encodePick, leagueId, loadCircuits, lockMessage, matchId,
  matchInfoOf, matchMessage, openingsPath, receiptFor, resultMessage, sealPick, tableFromXLayer, toHex, writeOpenings,
} from "../src/index.js";

// ---------------------------------------------------------------------------------- settings

const DEFAULTS = {
  node: "http://127.0.0.1:8545",
  processor: "0x39e44dba62811e87fde122ca4d6c082568a384d0", // processor 409, somebody else's
  opener: "0x536add8f30f03b69f6fbf29d425a816a0dc50106",
  mailbox: XLAYER.mailbox,
  sites: XLAYER.sites,
};

function settings(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, "");
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) throw new Error(`could not read the option ${argv[i]}`);
    out[name] = argv[i + 1];
  }
  return out;
}

const ONE_GATE = "0x00000002000002"; // the smallest circuit: one gate that flips its one input
const TRANSFER = `0x${toHex(eventTopic("Transfer(address,address,uint256)"))}`;
const OKB = 10n ** 18n;

const quantity = (n) => `0x${BigInt(n).toString(16)}`;
const hex = (bytes) => `0x${toHex(bytes)}`;
const sha = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};
/** A made-up account for the rehearsal. Nobody holds its key. */
const account = (label) => hex(sha(`kickoff rehearsal account: ${label}`).subarray(12));
const player = (name) => sha(`kickoff rehearsal player: ${name}`);

// ---------------------------------------------------------------------------------- the season

const PLAYERS = ["ada", "bola", "chidi"];

const PICKS = {
  football: { ada: { home: 2, away: 1 }, bola: { home: 1, away: 0 }, chidi: { home: 0, away: 0 } },
  basketball: { ada: { winner: "home", band: "A" }, bola: { winner: "home", band: "B" }, chidi: { winner: "away", band: "B" } },
  tennis: { ada: { winner: "A", sets: 4 }, bola: { winner: "B", sets: 3 }, chidi: { winner: "A", sets: 5 } },
};

const RESULTS = {
  football: { home: 2, away: 1 },
  basketball: basketballResult({ home: 104, away: 97 }),
  tennis: { winner: "A", sets: 4 },
};

const EXPECTED = { ada: 7, bola: 4, chidi: 1 };

async function sealAndBundle(league, fixture, picks) {
  const match = await matchId(league, fixture);
  const entries = [];
  const sealed = {};
  for (const [name, pick] of Object.entries(picks)) {
    sealed[name] = await sealPick({ league, match, sport: fixture.sport, pick, player: player(name), matchInfo: matchInfoOf(fixture) });
    entries.push({ player: player(name), fingerprint: sealed[name].fingerprint });
  }
  const bundle = await buildBundle({ league, match, entries });
  const openings = [];
  for (const name of Object.keys(picks)) {
    openings.push({
      pickByte: sealed[name].pickByte,
      player: player(name),
      salt: sealed[name].salt,
      receipt: await receiptFor(bundle, player(name)),
    });
  }
  return { match, bundle, file: writeOpenings({ match, entries, openings }) };
}

// ---------------------------------------------------------------------------------- the rehearsal

async function main() {
  const set = settings(process.argv.slice(2));
  const rpc = connect(set.node);
  const lines = [];
  const say = (line = "") => {
    lines.push(line);
    console.log(line);
  };

  const read = async (to, signature, values, types) =>
    decode(types, await rpc("eth_call", [{ to, data: callData(signature, values) }, "latest"]));

  /** Test-node commands. anvil and Hardhat name them differently. */
  const control = async (name, params) => {
    let last;
    for (const prefix of ["anvil_", "hardhat_"]) {
      try {
        return await rpc(prefix + name, params);
      } catch (error) {
        last = error;
      }
    }
    throw last;
  };

  // The rehearsal keeps its own clock and tells the node what time to stamp on every block, so
  // the times on chain are exactly the ones written here.
  let clock = 0;
  let stamped = false;
  const stamp = async (time) => {
    if (time <= clock) throw new Error("the rehearsal's clock can only go forwards");
    clock = time;
    stamped = true;
    await rpc("evm_setNextBlockTimestamp", [quantity(time)]);
  };
  /** Set the time the chain will stamp on the next thing done. */
  const at = stamp;

  const transact = async (from, to, data, value = 0n) => {
    if (!stamped) await stamp(clock + 1);
    stamped = false;
    const hash = await rpc("eth_sendTransaction", [{ from, to, data, value: quantity(value) }]);
    for (let tries = 0; tries < 600; tries++) {
      const receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (receipt) {
        if (BigInt(receipt.status) !== 1n) throw new Error(`a transaction was turned down by the chain (${hash})`);
        return receipt;
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`a transaction never went through (${hash})`);
  };

  const chainId = Number(BigInt(await rpc("eth_chainId", [])));
  const start = Number(BigInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp));
  clock = start;

  say("A REHEARSAL ON A PRIVATE COPY OF X LAYER. Nothing is sent to the real network.");
  say(`chain ${chainId}, copied at ${new Date(start * 1000).toISOString()}`);
  say();

  // Two made-up accounts with test money: the league's host, and an outsider.
  const host = account("league host");
  const outsider = account("outsider");
  try {
    for (const who of [host, outsider]) {
      await control("impersonateAccount", [who]);
      await control("setBalance", [who, quantity(10n * OKB)]);
    }
  } catch (error) {
    throw new Error(`this node is not a test copy, so the rehearsal will not run against it (${error.message})`);
  }

  // Publishing a circuit on the existing processor and opening its account, paying in OKB.
  const [transistors] = await read(set.processor, "transistors()", [], ["address"]);
  const [price] = await read(transistors, "mintPrice()", [], ["uint256"]);
  const [flat] = await read(transistors, "protocolFee()", [], ["uint256"]);
  const [tapeoutFee] = await read(set.processor, "TAPEOUT_FEE()", [], ["uint256"]);
  const [openFee] = await read(set.opener, "FEE()", [], ["uint256"]);

  const becomeAnAccount = async (holder) => {
    await transact(holder, transistors, callData("mint(uint256,uint256)", [0, 1]), price + flat);
    const receipt = await transact(holder, set.processor, callData("tapeout(bytes,uint32,uint32)", [ONE_GATE, 1, 1]), tapeoutFee);
    const minted = receipt.logs.find(
      (log) =>
        log.address.toLowerCase() === set.processor.toLowerCase() &&
        log.topics[0] === TRANSFER &&
        log.topics.length === 4 &&
        `0x${log.topics[2].slice(26)}` === holder,
    );
    if (!minted) throw new Error("the processor did not report the new circuit");
    const circuit = BigInt(minted.topics[3]);
    await transact(holder, set.opener, callData("open(address,uint256)", [set.processor, circuit]), openFee);
    const [opened] = await read(set.opener, "isOpened(address,uint256)", [set.processor, circuit], ["bool"]);
    if (!opened) throw new Error("the account did not open");
    const [address] = await read(set.mailbox, "accountOf(address,uint256)", [set.processor, circuit], ["address"]);
    return { holder, circuit, address, inbox: leagueId(chainId, address) };
  };

  await at(start + 60);
  const leagueAccount = await becomeAnAccount(host);
  const outsiderAccount = await becomeAnAccount(outsider);
  const league = leagueAccount.inbox;
  say(`the league is circuit ${leagueAccount.circuit} of processor ${set.processor}`);
  say(`its account is ${leagueAccount.address}`);
  say(`its id is ${hex(league)}`);
  say();

  const send = (from, message) =>
    transact(
      from.holder,
      set.mailbox,
      callData("send(address,uint256,bytes32,bytes32,bytes)", [set.processor, from.circuit, league, message.ref, message.payload]),
    );
  const publish = (path, fileText) => {
    const bytes = new TextEncoder().encode(fileText);
    return transact(
      host,
      set.sites,
      callData("putFile(address,string,string,bytes32,bytes)", [leagueAccount.address, path, "application/json", sha(bytes), bytes]),
    );
  };

  // Three matches, an hour apart, the first kicking off an hour from now.
  const hour = 3600;
  const fixtures = {
    football: { sport: FOOTBALL, kickoff: start + hour, bestOf: 0, label: "Arsenal v Chelsea" },
    basketball: { sport: BASKETBALL, kickoff: start + 2 * hour, bestOf: 0, label: "Lakers v Celtics" },
    tennis: { sport: TENNIS, kickoff: start + 3 * hour, bestOf: 5, label: "Alcaraz v Sinner" },
  };
  const kickoff = fixtures.football.kickoff;

  const made = {};
  for (const [key, fixture] of Object.entries(fixtures)) made[key] = await sealAndBundle(league, fixture, PICKS[key]);
  // The bundle a cheating host would like to swap in: chidi's 0-0 changed to the real score.
  const changed = await sealAndBundle(league, fixtures.football, { ...PICKS.football, chidi: RESULTS.football });
  const resultByte = (key) => encodePick(fixtures[key].sport, RESULTS[key], matchInfoOf(fixtures[key]));

  let step = 0;
  const did = (what) => say(`${String(++step).padStart(2)}. ${what}`);

  await at(start + 600);
  for (const fixture of Object.values(fixtures)) await send(leagueAccount, await matchMessage(league, fixture));
  did("the league announced three matches");

  await at(kickoff - 600);
  await send(leagueAccount, await lockMessage(made.football.bundle));
  did("football: the league locked the bundle of sealed picks, 10 minutes before kickoff");

  await at(kickoff + 60);
  await send(leagueAccount, await lockMessage(changed.bundle));
  did("CHEAT: one minute after kickoff, the host locked a changed bundle with chidi's pick set to the real score");

  await at(kickoff + 120);
  await send(outsiderAccount, resultMessage(made.football.match, encodePick(FOOTBALL, { home: 0, away: 0 })));
  did("CHEAT: an outsider wrote a 0-0 result to the league's inbox");

  await at(fixtures.basketball.kickoff - 600);
  await send(leagueAccount, await lockMessage(made.basketball.bundle));
  did("basketball: the league locked the bundle, 10 minutes before tip-off");

  await at(fixtures.tennis.kickoff - 600);
  await send(leagueAccount, await lockMessage(made.tennis.bundle));
  did("tennis: the league locked the bundle, 10 minutes before the first serve");

  await at(kickoff + 2 * hour);
  await send(leagueAccount, resultMessage(made.football.match, resultByte("football")));
  await publish(openingsPath(made.football.match), made.football.file);
  did("football: the league gave the result, 2-1, and published the opened picks on its site");

  await at(kickoff + 2 * hour + 600);
  await send(outsiderAccount, challengeMessage(made.football.match, encodePick(FOOTBALL, { home: 0, away: 0 })));
  did("a member disputed the football result, saying it was 0-0");

  await at(fixtures.basketball.kickoff + 2 * hour);
  await send(leagueAccount, resultMessage(made.basketball.match, resultByte("basketball")));
  await publish(openingsPath(made.basketball.match), made.basketball.file);
  did("basketball: the league gave the result, home by 7, and published the opened picks");

  await at(fixtures.tennis.kickoff + 2 * hour);
  await send(leagueAccount, resultMessage(made.tennis.match, resultByte("tennis")));
  await publish(openingsPath(made.tennis.match), made.tennis.file);
  did("tennis: the league gave the result, A in 4 sets, and published the opened picks");
  say();

  // ------------------------------------------------------------------------------ reading it back
  //
  // From here on, nothing made above is used except the league's id. Everything else comes from
  // the node.

  const circuitsDir = new URL("../../circuits/out/", import.meta.url);
  const circuits = loadCircuits({
    football: await readFile(new URL("football.hex", circuitsDir), "utf8"),
    basketball: await readFile(new URL("basketball.hex", circuitsDir), "utf8"),
    tennis: await readFile(new URL("tennis.hex", circuitsDir), "utf8"),
  });
  const back = await tableFromXLayer({ node: set.node, mailbox: set.mailbox, sites: set.sites, league: hex(league), circuits });

  say(`READ BACK FROM THE NODE at block ${back.block}: ${back.messages.length} messages in the league's inbox`);
  say();

  const nameOf = new Map(PLAYERS.map((name) => [toHex(player(name)), name]));
  say("| Place | Player | Points | 3-point picks | 1-point picks |");
  say("| --- | --- | --- | --- | --- |");
  for (const row of back.table) {
    say(`| ${row.position} | ${nameOf.get(toHex(row.player)) ?? hex(row.player)} | ${row.points} | ${row.threes} | ${row.ones} |`);
  }
  say();

  const checks = [];
  const check = (what, ok) => checks.push({ what, ok: Boolean(ok) });
  const football = back.matches.find((m) => toHex(m.id) === toHex(made.football.match));
  const pointsOf = Object.fromEntries(back.table.map((row) => [nameOf.get(toHex(row.player)), row.points]));

  const [onChainCount] = await read(set.mailbox, "inboxCount(bytes32)", [league], ["uint256"]);
  check("every message the mailbox holds for the league was fetched (12)", back.messages.length === 12 && onChainCount === 12n);
  check("the account that speaks for the league is the one inside its id", back.account === leagueAccount.address);
  check("all three matches were found, each with a final result", back.matches.length === 3 && back.matches.every((m) => m.state === "final"));
  check("the opened picks for all three matches were fetched from the league's site", back.files.length === 3 && back.files.every((f) => f.found));
  check(
    "the table is ada 7, bola 4, chidi 1",
    back.table.length === 3 && PLAYERS.every((name) => pointsOf[name] === EXPECTED[name]),
  );
  check("places are 1, 2, 3 in that order", back.table.map((row) => `${row.position} ${nameOf.get(toHex(row.player))}`).join(", ") === "1 ada, 2 bola, 3 chidi");
  check(
    "CHEAT REFUSED: the bundle locked before kickoff is still the one in force",
    football && football.lock && toHex(football.lock.root) === toHex(made.football.bundle.root),
  );
  check(
    "CHEAT REFUSED: the changed bundle is on the record, marked as locked too late",
    football && football.locks.length === 2 && football.locks[1].inTime === false && toHex(football.locks[1].root) === toHex(changed.bundle.root),
  );
  check(
    "CHEAT REFUSED: the outsider's result was ignored, and the reason is recorded",
    back.ignored.length === 1 && back.ignored[0].index === 5 && back.ignored[0].why === "a result by someone other than the league",
  );
  check("the football result in force is the league's, 2-1", football && football.result.home === 2 && football.result.away === 1 && football.results.length === 1);
  check(
    "the dispute is listed with the match, from the member's account, inside the 24 hours",
    football && football.challenges.length === 1 && football.challenges[0].from === outsiderAccount.address && football.challenges[0].inWindow === true,
  );

  for (const { what, ok } of checks) say(`${ok ? "PASS" : "FAIL"}  ${what}`);
  const failed = checks.filter((c) => !c.ok).length;
  say();
  say(failed === 0 ? `REHEARSAL PASSED: ${checks.length} checks` : `REHEARSAL FAILED: ${failed} of ${checks.length} checks`);

  if (set["save-league"]) await writeFile(set["save-league"], `${hex(league)}\n`);
  if (set.summary) await writeFile(set.summary, `${lines.join("\n")}\n`);
  if (failed !== 0) {
    console.log(JSON.stringify({ ignored: back.ignored, files: back.files, football }, (k, v) => (v instanceof Uint8Array ? hex(v) : typeof v === "bigint" ? v.toString() : v), 1));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`REHEARSAL FAILED: ${error.message}`);
  process.exit(1);
});
