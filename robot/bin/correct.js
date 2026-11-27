#!/usr/bin/env node
// Put a wrong result right, by hand. Only Kickoff can: it needs Kickoff's own key.
//
//   node robot/bin/correct.js --match "Sporting CP v Man United"        what Kickoff has, and what the feed says now
//   node robot/bin/correct.js --match "Sporting CP v Man United" --go   correct it (CONFIRM has to say CORRECT RESULT)
//
// The robot never changes a recorded result by itself. This is for a result that really was wrong.
// It works only for a match whose predictions were never locked on X Layer, so nobody's points
// change, and only to what the feed says now: nobody types a score in. See src/correct.js.
//
// Settings:
//   KICKOFF_SERVER       where Kickoff's server is
//   KICKOFF_ADMIN_KEY    Kickoff's key (a secret). Sent only to Kickoff's server, and never printed.
//   FOOTBALL_DATA_KEY    the football feed's key
//   BALLDONTLIE_KEY      the basketball feed's key

import { appendFileSync } from "node:fs";

import { correctResult } from "../src/correct.js";

const flags = process.argv.slice(2);
const flag = (name) => (flags.includes(name) ? (flags[flags.indexOf(name) + 1] ?? "").trim() : "");
const lines = [];
const say = (line = "") => (lines.push(line), console.log(line));
const finish = (code) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n\n")}\n`);
  process.exit(code);
};

try {
  const go = flags.includes("--go");
  const server = process.env.KICKOFF_SERVER;
  if (!server) throw new Error("It is not set where Kickoff's server is (KICKOFF_SERVER).");
  if (go && (process.env.CONFIRM ?? "").trim() !== "CORRECT RESULT") throw new Error("To correct it, type CORRECT RESULT in the confirm box. Nothing was changed.");
  const found = await correctResult({
    server,
    adminKey: process.env.KICKOFF_ADMIN_KEY,
    keys: { football: process.env.FOOTBALL_DATA_KEY, basketball: process.env.BALLDONTLIE_KEY },
    words: flag("--match"),
    now: Math.floor(Date.now() / 1000),
    go,
  });
  say(`**${found.label}**`);
  say(`Kickoff recorded: **${found.recorded}**. The feed says now: **${found.feed}**.`);
  say("Its predictions were never locked on X Layer, so nobody's points came from this result.");
  if (found.done) say(`Corrected. Kickoff now has **${found.feed}**, and keeps that it first recorded ${found.recorded}.`);
  else say("Nothing is changed. Look up the real score. If the feed is right, run this again with the step set to go, and type CORRECT RESULT.");
  finish(0);
} catch (error) {
  say(`Not done: ${error.message}`);
  finish(1);
}
