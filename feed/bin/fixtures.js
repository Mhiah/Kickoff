#!/usr/bin/env node
// Print the real fixtures and results for a stretch of days, as the two feeds give them.
//
//   FOOTBALL_DATA_KEY=... BALLDONTLIE_KEY=... node feed/bin/fixtures.js
//
// Options:
//   --from 2026-11-23    first day (default: today)
//   --to 2026-11-30      last day (default: seven days on)
//   --json               print everything as JSON instead
//   --save-raw <folder>  also save each feed's answer exactly as it came, for the tests
//
// The keys are read from the environment and are only ever sent to the feed they belong to. They
// are never printed or saved.

import { mkdir, writeFile } from "node:fs/promises";

import { COMPETITIONS, day, fetchWeek } from "../src/index.js";

function options(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--from" || a === "--to" || a === "--save-raw") out[a.slice(2)] = argv[++i];
    else throw new Error(`there is no option ${a}`);
  }
  return out;
}

const when = (seconds) => new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 16);

function resultWords(match) {
  if (match.state === "scheduled") return "not started";
  if (match.state === "live") return match.note ?? "being played";
  if (match.state === "void") return `void: ${match.note}`;
  if (match.state === "unknown") return `NOT SURE: ${match.note}`;
  if (match.sport === 1) return match.score;
  const margin = { A: "1 to 5", B: "6 to 10", C: "11 to 15", D: "16 or more" }[match.result.band];
  return `${match.score}, the ${match.result.winner} side by ${margin}`;
}

async function main() {
  const opt = options(process.argv.slice(2));
  const now = Math.floor(Date.now() / 1000);
  const from = opt.from ?? day(now);
  const to = opt.to ?? day(now, 7);
  const keys = { football: process.env.FOOTBALL_DATA_KEY, basketball: process.env.BALLDONTLIE_KEY };

  let fetchIt = globalThis.fetch;
  if (opt["save-raw"]) {
    await mkdir(opt["save-raw"], { recursive: true });
    let n = 0;
    fetchIt = async (url, init) => {
      const response = await globalThis.fetch(url, init);
      const text = await response.text();
      const name = new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
      await writeFile(`${opt["save-raw"]}/${String(++n).padStart(2, "0")}-${name}.json`, text);
      return { ok: response.ok, status: response.status, json: async () => JSON.parse(text) };
    };
  }

  const week = await fetchWeek({ keys, from, to, fetch: fetchIt });

  if (opt.json) {
    console.log(JSON.stringify({ from, to, ...week }, null, 2));
  } else {
    console.log(`Fixtures from ${from} to ${to}. Times are UTC.`);
    for (const [comp, { name }] of Object.entries(COMPETITIONS)) {
      const list = week.matches.filter((m) => m.comp === comp);
      const n = week.fetched[comp];
      console.log(`\n${name}: ${n === null ? "not fetched" : `${n} match${n === 1 ? "" : "es"}`}`);
      for (const m of list) console.log(`  ${when(m.kickoff)}  ${`${m.home} v ${m.away}`.padEnd(34)}  ${resultWords(m)}`);
    }
    if (week.problems.length) {
      console.log("\nPROBLEMS");
      for (const p of week.problems) console.log(`  ${p}`);
    }
  }
  // Nothing at all could be fetched: say so with a failing exit, so a scheduled run is noticed.
  if (Object.values(week.fetched).every((n) => n === null)) process.exit(1);
}

main().catch((error) => {
  console.error(`Could not fetch the fixtures: ${error.message}`);
  process.exit(1);
});
