#!/usr/bin/env node
// Print a league's table, built from nothing but what X Layer holds.
//
//   node bin/table.js <league id>
//   node bin/table.js --circuit <processor address> <circuit number>
//
// Options:
//   --node <address>      an X Layer node to ask. Give it more than once to ask several, which
//                         then have to agree. Default: https://rpc.xlayer.tech and
//                         https://xlayer.drpc.org, run by different people.
//   --mailbox <address>   TapeOut's mailbox (default: the one on X Layer)
//   --sites <address>     TapeOut's site store (default: the one on X Layer)
//   --json                print everything as JSON instead
//
// Nothing is sent and no wallet is needed. It only reads.

import { readFile } from "node:fs/promises";

import { BASKETBALL, SPORT_NAMES, XLAYER, isFootball, leagueOfCircuit, loadCircuits, tableFromXLayer, toHex } from "../src/index.js";

const SPORT = SPORT_NAMES;

function options(argv) {
  const out = { nodes: [], mailbox: XLAYER.mailbox, sites: XLAYER.sites, json: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--circuit") out.circuit = [argv[++i], argv[++i]];
    else if (a === "--node") out.nodes.push(argv[++i]);
    else if (a === "--mailbox" || a === "--sites") out[a.slice(2)] = argv[++i];
    else if (a.startsWith("--")) throw new Error(`there is no option ${a}`);
    else out.rest.push(a);
  }
  return out;
}

const short = (bytes) => `0x${toHex(bytes).slice(0, 8)}…`;
const when = (seconds) => new Date(seconds * 1000).toISOString().replace("T", " ").replace(":00.000Z", " UTC").replace(".000Z", " UTC");

function resultText(match) {
  if (match.state === "void") return "void: nobody scores";
  if (match.state !== "final") return "no result yet";
  const r = match.result;
  if (isFootball(match.sport)) return `${r.home}-${r.away}`;
  if (match.sport === BASKETBALL) {
    const margin = { A: "1 to 5", B: "6 to 10", C: "11 to 15", D: "16 or more" }[r.band];
    return `${r.winner} win by ${margin}`;
  }
  return `player ${r.winner} in ${r.sets} sets`;
}

function lockText(match) {
  if (!match.lock) return "NO BUNDLE LOCKED BEFORE KICKOFF: no pick counts";
  const early = match.kickoff - match.lock.lockedAt;
  const ago = early >= 3600 ? `${Math.floor(early / 3600)} h ${Math.floor((early % 3600) / 60)} min` : `${Math.floor(early / 60)} min`;
  return `${match.lock.count} sealed picks locked ${ago} before kickoff`;
}

/** How many nodes were asked, and whether the record could be checked between them. */
function nodesInWords(n) {
  const down = n.down.length ? ` Not answering: ${n.down.join(", ")}.` : "";
  if (n.asked === 1) return "1 X Layer node asked. Its answers were not checked against another.";
  if (n.agreed === 1) return `${n.asked} X Layer nodes asked, but only 1 answered, so its answers could not be checked against another.${down}`;
  return `${n.asked} X Layer nodes asked. ${n.agreed} answered, and they agree.${down}`;
}

async function main() {
  const opt = options(process.argv.slice(2));
  if (opt.nodes.length === 0) opt.nodes = [...XLAYER.nodes];
  let league = opt.rest[0];
  if (opt.circuit) {
    league = `0x${toHex(await leagueOfCircuit({ node: opt.nodes[0], mailbox: opt.mailbox, processor: opt.circuit[0], circuit: BigInt(opt.circuit[1]) }))}`;
  }
  if (!league) {
    console.error("Give a league's id, or --circuit <processor address> <circuit number>.");
    process.exit(2);
  }

  const dir = new URL("../../circuits/out/", import.meta.url);
  const circuits = loadCircuits({
    football: await readFile(new URL("football.hex", dir), "utf8"),
    basketball: await readFile(new URL("basketball.hex", dir), "utf8"),
    tennis: await readFile(new URL("tennis.hex", dir), "utf8"),
    result: await readFile(new URL("result.hex", dir), "utf8"),
    goalgoal: await readFile(new URL("goalgoal.hex", dir), "utf8"),
    score: await readFile(new URL("score.hex", dir), "utf8"),
  });
  const got = await tableFromXLayer({ nodes: opt.nodes, mailbox: opt.mailbox, sites: opt.sites, league, circuits });

  if (opt.json) {
    const plain = (key, value) => (value instanceof Uint8Array ? `0x${toHex(value)}` : typeof value === "bigint" ? value.toString() : value);
    console.log(JSON.stringify({ league, ...got, messages: got.messages.length }, plain, 2));
    return;
  }

  console.log(`League ${league}`);
  console.log(`on chain ${got.chainId}, read at block ${got.block}. Its account is ${got.account}.`);
  console.log(nodesInWords(got.nodes));
  console.log(`${got.messages.length} messages in its inbox, ${got.ignored.length} not believed.`);

  console.log("\nMATCHES");
  for (const match of got.matches) {
    console.log(`  ${match.label}  (${SPORT[match.sport]}, kickoff ${when(match.kickoff)})`);
    console.log(`    result: ${resultText(match)}`);
    console.log(`    ${lockText(match)}`);
    const late = match.locks.filter((lock) => !lock.inTime).length;
    if (late) console.log(`    ${late} bundle${late === 1 ? "" : "s"} locked at or after kickoff: not in force`);
    if (match.results.length > 1) console.log(`    the league gave ${match.results.length} results; the last one is in force`);
    for (const c of match.challenges) {
      console.log(`    disputed by ${c.from} ${c.inWindow ? "within 24 hours of the result" : "outside the 24 hours"}`);
    }
    const file = got.files.find((f) => f.match === toHex(match.id));
    if (file && !file.found) console.log(`    opened picks not published yet${file.why ? ` (${file.why})` : ""}`);
  }

  console.log("\nTABLE");
  if (got.table.length === 0) console.log("  nobody has a pick yet");
  for (const row of got.table) {
    console.log(
      `  ${String(row.position).padStart(2)}  ${short(row.player)}  ${String(row.points).padStart(3)} ${row.points === 1 ? "point " : "points"}  (3-point picks: ${row.threes}, 1-point picks: ${row.ones})`,
    );
  }

  if (got.ignored.length) {
    console.log("\nNOT BELIEVED");
    for (const entry of got.ignored) {
      console.log(`  ${entry.index !== undefined ? `message ${entry.index}` : `match ${entry.match.slice(0, 8)}…`}: ${entry.why}`);
    }
  }
}

main().catch((error) => {
  console.error(`Could not build the table: ${error.message}`);
  process.exit(1);
});
