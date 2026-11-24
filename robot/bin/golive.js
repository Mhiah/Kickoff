#!/usr/bin/env node
// Going live on X Layer: the one-off work that makes the robot's wallet a league and publishes
// Kickoff's three scoring circuits.
//
//   node robot/bin/golive.js look                    read X Layer and say what is still to do and
//                                                    what it costs. Sends nothing, pays nothing.
//   node robot/bin/golive.js go --confirm "GO LIVE"  do it. What is already done is left alone, so
//                                                    it is safe to run again after a failure.
//   ... go --confirm "GO LIVE" --new-league          go ahead even if the league would not be the
//                                                    one Kickoff's server is set up for
//
// Settings, none of which is printed except the wallet's public address:
//   KICKOFF_WALLET_KEY   the private key of the robot's wallet (a secret). Handed to `cast` only.
//   KICKOFF_SERVER       Kickoff's server, to check which league it is set up for (optional)
//   KICKOFF_PROCESSOR    the TapeOut processor to publish on (optional: the shared one by default)
//   XLAYER_RPC_URL       the X Layer node to use (optional)

import { appendFileSync, readFileSync } from "node:fs";

import { XLAYER } from "../../engine/src/index.js";
import { goLive, inOkb, lookAtGoingLive, lookInWords } from "../src/golive.js";
import { castSender } from "../src/xlayer.js";

/** TapeOut on X Layer: a processor anyone may publish on, with free transistors, and the contract that opens accounts. */
const SHARED_PROCESSOR = "0x39e44dba62811e87fde122ca4d6c082568a384d0";
const OPENER = "0x536add8f30f03b69f6fbf29d425a816a0dc50106";

const [command, ...flags] = process.argv.slice(2);
const flag = (name) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
const lines = [];
const say = (line = "") => (lines.push(line), console.log(line));
const finish = (code) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  process.exit(code);
};

if (command !== "look" && command !== "go") {
  console.error('Say what to do: node robot/bin/golive.js look, or node robot/bin/golive.js go --confirm "GO LIVE"');
  process.exit(2);
}
if (command === "go" && flag("--confirm") !== "GO LIVE") {
  console.error('Going live spends real OKB, so it has to be asked for in so many words: --confirm "GO LIVE". Nothing was sent.');
  process.exit(2);
}

const node = process.env.XLAYER_RPC_URL || XLAYER.node;
const processor = (process.env.KICKOFF_PROCESSOR || SHARED_PROCESSOR).toLowerCase();
const server = (process.env.KICKOFF_SERVER ?? "").replace(/\/+$/, "");
const manifest = JSON.parse(readFileSync(new URL("../../circuits/out/manifest.json", import.meta.url), "utf8"));
const circuits = Object.fromEntries(
  ["football", "basketball", "tennis"].map((name) => [
    name,
    { netlist: readFileSync(new URL(`../../circuits/out/${name}.hex`, import.meta.url), "utf8").trim(), inputs: manifest[name].inputs, outputs: manifest[name].outputs },
  ]),
);

try {
  const sender = await castSender({ node, key: process.env.KICKOFF_WALLET_KEY });
  const settings = { node, processor, opener: OPENER, circuits };

  // Which league Kickoff's server is set up for. Every match id and sealed pick is made with it.
  let serverLeague = null;
  if (server) {
    const response = await fetch(`${server}/api/fixtures`);
    if (!response.ok) throw new Error(`Kickoff's server did not answer (${response.status}), so its league could not be checked`);
    serverLeague = (await response.json()).league;
  }

  if (command === "look") {
    say("GOING LIVE ON X LAYER: A LOOK. Nothing is sent and nothing is paid.");
    say();
    say(lookInWords(await lookAtGoingLive({ ...settings, wallet: sender.address }), { serverLeague }));
    finish(0);
  }

  say("GOING LIVE ON X LAYER. This spends real OKB from the robot's wallet.");
  say();
  const done = await goLive({ ...settings, sender, serverLeague, newLeague: flags.includes("--new-league"), say });
  say();
  say(done.did.length === 0 ? "There was nothing left to do, so nothing was sent." : `Done. It cost ${inOkb(done.spent)} in all, fees and gas.`);
  say();
  say(lookInWords(done, { serverLeague }));
  say();
  say("For the robot's settings and the hackathon form:");
  say(`  KICKOFF_PROCESSOR   ${done.processor}`);
  say(`  KICKOFF_CIRCUIT     ${done.have.league}`);
  say(`  scoring circuits    football ${done.have.football}, basketball ${done.have.basketball}, tennis ${done.have.tennis}`);
  finish(0);
} catch (error) {
  say(`PROBLEM: ${error.message}`);
  finish(1);
}
