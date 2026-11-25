#!/usr/bin/env node
// Putting Kickoff's website on X Layer itself (TapeOut's DeWEB), in the league's own account.
//
//   node robot/bin/site.js look                         read X Layer and say what is still to send
//                                                       and what it costs. Sends nothing.
//   node robot/bin/site.js go --confirm "PUBLISH SITE"  send it. Files already on X Layer and the
//                                                       same are left alone, so it is safe to run
//                                                       again after a failure or after a change.
//   node robot/bin/site.js check                        read every file back from X Layer, whole,
//                                                       and compare it with the files here.
//
// Settings, none of which is printed except the wallet's public address:
//   KICKOFF_WALLET_KEY        the private key of the robot's wallet (a secret). Handed to `cast` only.
//   KICKOFF_CIRCUIT           the league's circuit number
//   KICKOFF_SERVER            the full address of Kickoff's server, which the copy on chain will use
//   KICKOFF_PROCESSOR         the TapeOut processor the league's circuit is on (optional: the shared one)
//   KICKOFF_PROCESSOR_NUMBER  that processor's number (needed only if it is not the shared one)
//   XLAYER_RPC_URL            the X Layer node to use (optional)

import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { XLAYER } from "../../engine/src/index.js";
import { checkSite, inOkb, lookAtSite, publishSite, siteFiles, siteInWords, siteOnXLayer } from "../src/site.js";
import { castSender } from "../src/xlayer.js";

/** TapeOut on X Layer: the processor Kickoff's circuits are on, and its number in TapeOut's list. */
const SHARED = { processor: "0x39e44dba62811e87fde122ca4d6c082568a384d0", number: 409 };

const [command, ...flags] = process.argv.slice(2);
const flag = (name) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
const lines = [];
const say = (line = "") => (lines.push(line), console.log(line));
const finish = (code) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  process.exit(code);
};

if (!["look", "go", "check"].includes(command)) {
  console.error('Say what to do: node robot/bin/site.js look, go --confirm "PUBLISH SITE", or check');
  process.exit(2);
}
if (command === "go" && flag("--confirm") !== "PUBLISH SITE") {
  console.error('Publishing spends real OKB on gas, so it has to be asked for in so many words: --confirm "PUBLISH SITE". Nothing was sent.');
  process.exit(2);
}

try {
  const node = process.env.XLAYER_RPC_URL || XLAYER.node;
  const processor = (process.env.KICKOFF_PROCESSOR || SHARED.processor).toLowerCase();
  const number = process.env.KICKOFF_PROCESSOR_NUMBER ? Number(process.env.KICKOFF_PROCESSOR_NUMBER) : processor === SHARED.processor ? SHARED.number : NaN;
  const circuit = Number(process.env.KICKOFF_CIRCUIT);
  if (!Number.isInteger(circuit) || circuit < 1) throw new Error("the league's circuit number is not set (KICKOFF_CIRCUIT)");
  if (!Number.isInteger(number) || number < 0) throw new Error("the processor's number is not set (KICKOFF_PROCESSOR_NUMBER)");

  const files = siteFiles({ dir: fileURLToPath(new URL("../../web/", import.meta.url)), server: (process.env.KICKOFF_SERVER ?? "").replace(/\/+$/, "") });
  const sender = await castSender({ node, key: process.env.KICKOFF_WALLET_KEY });
  const chain = siteOnXLayer({ node, sender, processor, number, circuit });

  if (command === "look") {
    say("KICKOFF'S WEBSITE ON X LAYER: A LOOK. Nothing is sent and nothing is paid.");
    say();
    say(siteInWords(await lookAtSite({ files, chain })));
    finish(0);
  }

  if (command === "check") {
    say("KICKOFF'S WEBSITE ON X LAYER: A CHECK. Every file is read back whole. Nothing is sent.");
    say();
    const checked = await checkSite({ files, chain });
    const wrong = checked.filter((f) => !f.ok);
    for (const f of wrong) say(`  ${f.path}: ${f.why}`);
    say(wrong.length === 0 ? `All ${checked.length} files on X Layer are the same as the files here.` : `${wrong.length} of ${checked.length} files are not right on X Layer.`);
    finish(wrong.length === 0 ? 0 : 1);
  }

  say("PUTTING KICKOFF'S WEBSITE ON X LAYER. This spends real OKB from the robot's wallet, on gas.");
  say();
  const done = await publishSite({ files, chain, say });
  say();
  say(done.did.length === 0 ? "There was nothing left to do, so nothing was sent." : `Done. It cost ${inOkb(done.spent)} in all.`);
  say();
  say(siteInWords(done));
  say();
  say(`The site is on X Layer. Open it at ${done.address}`);
  finish(0);
} catch (error) {
  say(`PROBLEM: ${error.message}`);
  finish(1);
}
