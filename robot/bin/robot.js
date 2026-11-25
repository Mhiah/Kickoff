#!/usr/bin/env node
// Kickoff's robot.
//
//   node robot/bin/robot.js fixtures            make Kickoff's list match this week's real matches
//   node robot/bin/robot.js fixtures --dry-run  say what would change, and change nothing
//   node robot/bin/robot.js fixtures --quiet    the same as the first, but on GitHub the report only
//                                               goes on the run's page if something changed or went wrong
//
// It reads four settings and prints none of them:
//   KICKOFF_SERVER       Kickoff's server address
//   KICKOFF_ADMIN_KEY    the robot's key (not needed for a dry run)
//   FOOTBALL_DATA_KEY    the football feed's key
//   BALLDONTLIE_KEY      the basketball feed's key

import { appendFileSync } from "node:fs";

import { XLAYER, connect, leagueOfCircuit, toHex } from "../../engine/src/index.js";
import { chainTick, newMemory } from "../src/chain.js";
import { createNotes, noteMissed, walletWatch } from "../src/notes.js";
import { createServer } from "../src/server.js";
import { inWords, syncFixtures } from "../src/sync.js";
import { watch } from "../src/watch.js";
import { castSender, createChain } from "../src/xlayer.js";

const [command, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
const quiet = flags.includes("--quiet");
const server = (process.env.KICKOFF_SERVER ?? "").replace(/\/+$/, "");
const adminKey = process.env.KICKOFF_ADMIN_KEY ?? "";
const keys = { football: process.env.FOOTBALL_DATA_KEY, basketball: process.env.BALLDONTLIE_KEY };
const clock = () => Math.floor(Date.now() / 1000);
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const onGitHub = (text) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);

if (command !== "fixtures" && command !== "watch") {
  console.error("Say what to do: node robot/bin/robot.js fixtures [--dry-run], or node robot/bin/robot.js watch [--minutes 320]");
  process.exit(2);
}
if (!/^https:\/\//.test(server)) {
  console.error("KICKOFF_SERVER is not set to an https address.");
  process.exit(2);
}
const canChange = adminKey.length >= 24;
if (command === "fixtures" && !dryRun && !canChange) {
  console.error("KICKOFF_ADMIN_KEY is not set, or is too short to be safe (it needs at least 24 characters). Use --dry-run to look without changing anything.");
  process.exit(2);
}

/** One fixtures round. Prints its report, and on GitHub puts it on the run's page when there is news. */
async function fixturesRound({ dry, hush }) {
  const report = await syncFixtures({ server, adminKey, dryRun: dry, keys, now: clock() });
  const words = inWords(report);
  console.log(words);
  const news = report.added.length + report.updated.length + report.calledOff.length + report.problems.length > 0;
  if (news || !hush) onGitHub(`### Matches, ${stamp()} UTC\n\n\`\`\`\n${words}\n\`\`\`\n`);
  return report;
}

if (command === "fixtures") {
  const report = await fixturesRound({ dry: dryRun, hush: quiet });
  process.exit(report.ok ? 0 : 1);
}

// ---------------------------------------------------------------------------------- watch
//
// Stay awake for a number of minutes: keep the list of matches up to date every half hour, and,
// if the robot has a wallet, do its work on X Layer on time.
//
// The wallet is three settings. Without all three the robot only keeps the list up to date.
//   KICKOFF_WALLET_KEY   the private key of the robot's wallet (a secret). Handed to `cast` only.
//   KICKOFF_PROCESSOR    the TapeOut processor the league's circuit is on
//   KICKOFF_CIRCUIT      the league's circuit number
//   XLAYER_RPC_URL       the X Layer node to use (optional)
//
// On GitHub the robot can also leave a note for the person who runs Kickoff (see notes.js): when
// its wallet runs low, and when a match's picks were not locked in time. That uses the token
// GitHub hands the workflow (GH_TOKEN) and the repository's name (GITHUB_REPOSITORY).

const minutesAt = flags.indexOf("--minutes");
const minutes = minutesAt >= 0 ? Number(flags[minutesAt + 1]) : 320;
if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error("--minutes needs a number.");
  process.exit(2);
}
const say = (line) => {
  console.log(`${stamp()}  ${line}`);
  onGitHub(`- ${stamp()} UTC: ${line}\n`);
};
if (!canChange) say("The robot's key is not set, so it only looks at the list of matches and changes nothing.");

/** When Kickoff went live on X Layer: 24 November 2026, 22:34 UTC. Matches from before then were never there to be locked. */
const LIVE_SINCE = Number(process.env.KICKOFF_LIVE_SINCE || 1795559640);

const kickoff = createServer({ server, adminKey });
const memory = newMemory();
const notes = createNotes({ repo: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
let chainRound = null;
let walletLook = null;
let unnoted = []; // missed locks whose note could not be written yet
const { KICKOFF_WALLET_KEY: walletKey, KICKOFF_PROCESSOR: processor, KICKOFF_CIRCUIT: circuit } = process.env;
if (walletKey && processor && circuit) {
  try {
    const node = process.env.XLAYER_RPC_URL || XLAYER.node;
    const league = toHex(await leagueOfCircuit({ node, processor, circuit: BigInt(circuit) }));
    const listed = await kickoff.list();
    // Every match id and every sealed pick is made with the league's id. If the server and the
    // wallet disagree about which league this is, nothing the robot locked could ever be matched
    // to a pick, so it does not write at all.
    if (listed.league !== league) throw new Error("Kickoff's server is set up for a different league from the one this wallet holds");
    const sender = await castSender({ node, key: walletKey });
    const chain = createChain({ node, league, processor, circuit, sender });
    chainRound = async (fixtures) => {
      const out = await chainTick({ now: clock(), league, fixtures, server: kickoff, chain, memory, since: LIVE_SINCE });
      unnoted = await noteMissed({ missed: [...unnoted, ...out.missed], notes, say });
      return out;
    };
    const rpc = connect(node);
    walletLook = walletWatch({ balance: async () => BigInt(await rpc("eth_getBalance", [sender.address, "latest"])), wallet: sender.address, notes, say });
    say(`Working on X Layer as league 0x${league}.`);
  } catch (error) {
    say(`PROBLEM: the X Layer work is switched off for this run (${error.message}). The list of matches is still kept up to date.`);
  }
} else {
  console.log("No wallet is set, so nothing is written to X Layer. The list of matches is kept up to date.");
}

const tally = await watch({
  until: clock() + minutes * 60,
  now: clock,
  sleep: (seconds) => new Promise((done) => setTimeout(done, seconds * 1000)),
  // Every half hour, after the list of matches: is the wallet still holding enough?
  sync: async () => {
    const report = await fixturesRound({ dry: !canChange, hush: true });
    if (walletLook) await walletLook();
    return report;
  },
  list: async () => (await kickoff.list()).fixtures,
  chain: chainRound,
  memory,
  say,
});
console.log(`Done for now: ${tally.syncs} rounds on the list of matches, ${tally.looks} on X Layer, ${tally.problems} with a problem.`);
// A run only counts as failed if nothing at all went right, so one bad round does not raise an alarm.
process.exit(tally.problems >= tally.syncs + tally.looks ? 1 : 0);
