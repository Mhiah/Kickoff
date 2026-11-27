#!/usr/bin/env node
// Start a group run by a brand. Only Kickoff can: it needs Kickoff's own key.
//
//   node robot/bin/brand.js --name "World Cup Picks" --brand "OKX" [--prize "100 USDT for 1st place"] [--plays "pl, cl"] [--ends 2026-12-06]
//
// --ends is the group's last day. The group ends at midnight UTC after it, its top player is the
// winner, and the brand pays the prize to the wallet the winner linked (see bin/prize.js).
//
// A brand's group can hold up to 5,000 players, where a group of friends holds 30. It starts with
// nobody in it. What comes back is its code, which the brand gives to its audience.
//
// Settings:
//   KICKOFF_SERVER      where Kickoff's server is
//   KICKOFF_ADMIN_KEY   Kickoff's key (a secret). Sent only to Kickoff's server, and never printed.

import { appendFileSync } from "node:fs";

import { createServer } from "../src/server.js";

const COMPETITIONS = { pl: "Premier League", cl: "Champions League", nba: "NBA", wnba: "WNBA" };

const flags = process.argv.slice(2);
const flag = (name) => (flags.includes(name) ? (flags[flags.indexOf(name) + 1] ?? "").trim() : "");
const lines = [];
const say = (line = "") => (lines.push(line), console.log(line));
const finish = (code) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n\n")}\n`);
  process.exit(code);
};

try {
  const name = flag("--name");
  const brand = flag("--brand");
  const prize = flag("--prize");
  if (!name) throw new Error("The group needs a name.");
  if (!brand) throw new Error("Say which brand runs the group.");
  // Which competitions: their short names, with commas or spaces between. Left empty, all of them.
  const asked = flag("--plays").toLowerCase().split(/[\s,]+/).filter(Boolean);
  const unknown = asked.filter((key) => !(key in COMPETITIONS));
  if (unknown.length > 0) throw new Error(`"${unknown[0]}" is not a competition. Use any of: ${Object.keys(COMPETITIONS).join(", ")}.`);
  // The last day, written 2026-12-06. The group ends at midnight UTC after it.
  const lastDay = flag("--ends");
  let ends = null;
  if (lastDay) {
    const [, y, m, d] = lastDay.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
    ends = y ? Date.UTC(Number(y), Number(m) - 1, Number(d) + 1) / 1000 : NaN;
    if (!Number.isFinite(ends) || new Date((ends - 86400) * 1000).toISOString().slice(0, 10) !== lastDay) throw new Error(`"${lastDay}" is not a day. Write the last day like 2026-12-06.`);
  }
  const server = process.env.KICKOFF_SERVER;
  const adminKey = process.env.KICKOFF_ADMIN_KEY;
  if (!server) throw new Error("It is not set where Kickoff's server is (KICKOFF_SERVER).");
  if (!adminKey) throw new Error("Kickoff's key is not set (KICKOFF_ADMIN_KEY).");

  const made = await createServer({ server, adminKey }).brandGroup({ name, brand, ...(prize ? { prize } : {}), ...(asked.length > 0 ? { plays: [...new Set(asked)] } : {}), ...(ends !== null ? { ends } : {}) });
  say(`The group is made: **${made.name}**, run by ${made.brand}.`);
  say(`Its code is **${made.code}**`);
  say(`It plays: ${made.plays.map((key) => COMPETITIONS[key] ?? key).join(", ")}.`);
  say(made.prize ? `Prize: ${made.prize}` : "No prize line.");
  say(made.ends ? `It ends ${new Date(made.ends * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC. Its top player then is the winner, and the prize is paid to the wallet they link.` : "It has no end: it runs on, with no winner to pay.");
  say('Give the code to the brand. Their players choose "Join with a code" on Kickoff and type it in. Up to 5,000 can join.');
  finish(0);
} catch (error) {
  say(`PROBLEM: ${error.message}`);
  finish(1);
}
