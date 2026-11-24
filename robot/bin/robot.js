#!/usr/bin/env node
// Kickoff's robot.
//
//   node robot/bin/robot.js fixtures            make Kickoff's list match this week's real matches
//   node robot/bin/robot.js fixtures --dry-run  say what would change, and change nothing
//
// It reads four settings and prints none of them:
//   KICKOFF_SERVER       Kickoff's server address
//   KICKOFF_ADMIN_KEY    the robot's key (not needed for a dry run)
//   FOOTBALL_DATA_KEY    the football feed's key
//   BALLDONTLIE_KEY      the basketball feed's key

import { appendFileSync } from "node:fs";

import { inWords, syncFixtures } from "../src/sync.js";

const [command, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
const server = (process.env.KICKOFF_SERVER ?? "").replace(/\/+$/, "");
const adminKey = process.env.KICKOFF_ADMIN_KEY ?? "";

if (command !== "fixtures") {
  console.error("Say what to do: node robot/bin/robot.js fixtures [--dry-run]");
  process.exit(2);
}
if (!/^https:\/\//.test(server)) {
  console.error("KICKOFF_SERVER is not set to an https address.");
  process.exit(2);
}
if (!dryRun && adminKey.length < 24) {
  console.error("KICKOFF_ADMIN_KEY is not set, or is too short to be safe (it needs at least 24 characters). Use --dry-run to look without changing anything.");
  process.exit(2);
}

const report = await syncFixtures({
  server, adminKey, dryRun,
  keys: { football: process.env.FOOTBALL_DATA_KEY, basketball: process.env.BALLDONTLIE_KEY },
  now: Math.floor(Date.now() / 1000),
});
const words = inWords(report);
console.log(words);
// On GitHub, also put the report on the run's own page.
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Kickoff's robot: fixtures\n\n\`\`\`\n${words}\n\`\`\`\n`);
process.exit(report.ok ? 0 : 1);
