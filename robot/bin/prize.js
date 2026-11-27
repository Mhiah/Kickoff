#!/usr/bin/env node
// Record, by hand, that a winner of a brand's group was paid. Only Kickoff can: it needs Kickoff's
// own key. Mostly this is not needed: whoever started the group gives the payment on its Group
// screen and the robot reads it on its next round. This is for a group Kickoff started itself.
//
//   node robot/bin/prize.js --code WORLDCU-4821                              where the prize stands
//   node robot/bin/prize.js --code WORLDCU-4821 --place 2 --tx 0x…           read the payment, record nothing
//   node robot/bin/prize.js --code WORLDCU-4821 --place 2 --tx 0x… --go      record it (CONFIRM has to say PRIZE PAID)
//
// `--place` is which winner: 1 for the top player, and 1 if left out.
//
// Kickoff never holds a prize and never sends one. Winners are paid to the wallets they linked,
// by whoever runs the group. This reads that payment on X Layer, and only if it really reached
// that wallet (in the right token, and enough of it, when the prize is an amount of USDT or USDC)
// does Kickoff's server record it, so the group can show everyone that the prize was paid.
//
// Settings:
//   KICKOFF_SERVER      where Kickoff's server is
//   KICKOFF_ADMIN_KEY   Kickoff's key (a secret). Sent only to Kickoff's server, and never printed.
//   CONFIRM             for --go: the words PRIZE PAID

import { appendFileSync } from "node:fs";

import { WAIT_FOR_TX, checkClaim } from "../src/prize.js";
import { createServer } from "../src/server.js";

const flags = process.argv.slice(2);
const flag = (name) => (flags.includes(name) ? (flags[flags.indexOf(name) + 1] ?? "").trim() : "");
const lines = [];
const say = (line = "") => (lines.push(line), console.log(line));
const finish = (code) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n\n")}\n`);
  process.exit(code);
};
const day = (seconds) => `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

try {
  const code = flag("--code").toUpperCase();
  const tx = flag("--tx");
  const go = flags.includes("--go");
  const place = flag("--place") ? Number(flag("--place")) : 1;
  if (!Number.isSafeInteger(place) || place < 1) throw new Error("The place is a number: 1 for the top player.");
  if (!code) throw new Error("Say which group, by its code.");
  const server = process.env.KICKOFF_SERVER;
  const adminKey = process.env.KICKOFF_ADMIN_KEY;
  if (!server) throw new Error("It is not set where Kickoff's server is (KICKOFF_SERVER).");
  if (!adminKey) throw new Error("Kickoff's key is not set (KICKOFF_ADMIN_KEY).");
  const kickoff = createServer({ server, adminKey });

  const look = await kickoff.prizeLook(code);
  say(`**${look.name}**, run by ${look.brand}. ${look.prize ? `Prize: ${look.prize}.` : "No prize line."}`);
  if (!look.ended) {
    say(`The group has not ended yet. It ends ${day(look.ends)}. There is no winner to pay until then.`);
    finish(tx ? 1 : 0);
  }
  if (!look.decided) {
    say("The group has ended, but some of its matches have no result yet. The winners are fixed when the last one comes in.");
    finish(tx ? 1 : 0);
  }
  if (look.winners.length === 0) {
    say("Nobody scored in this group, so it has no winner and no prize to pay.");
    finish(tx ? 1 : 0);
  }
  for (const w of look.winners) {
    const owed = look.share ? `, to be paid ${look.share.what}` : "";
    const state = w.paid ? `Paid: **${w.paid.what}**, in ${w.paid.tx}.` : w.wallet ? `Not paid yet. Their linked wallet: \`${w.wallet}\`` : "Not paid yet. They have not linked a wallet: their Group screen asks them to.";
    say(`${w.place}. **${w.name}**, ${w.points} ${w.points === 1 ? "point" : "points"}${owed}. ${state}`);
  }
  if (!tx) {
    say("Next: each winner is paid on X Layer, to the wallet they linked, by whoever runs the group. Whoever started the group can then give the payment on its Group screen, or it can be recorded here with its transaction.");
    finish(0);
  }

  const winner = look.winners.find((w) => w.place === place);
  if (!winner) throw new Error(`This group has no winner in place ${place}.`);
  if (winner.paid) {
    say(`${winner.name} is already recorded as paid.`);
    finish(0);
  }
  if (!winner.wallet) throw new Error(`${winner.name} has not linked a wallet yet, so there is nowhere to have paid them.`);
  const claim = { tx, at: Math.floor(Date.now() / 1000), decidedAt: look.decidedAt ?? null, name: winner.name, wallet: winner.wallet, token: look.share?.token ?? null, raw: look.share?.raw ?? null, what: look.share?.what ?? null };
  const found = await checkClaim({ claim, now: claim.at + WAIT_FOR_TX });
  if (found.verdict === "wait") throw new Error(found.why);
  if (found.verdict === "refuse") throw new Error(found.reason);
  say(`The payment to ${winner.name}, as read from X Layer: **${found.what}**, to \`${found.to}\`.`);
  if (!look.share) say("This prize is a line of words, so nothing checks which token that is. Anyone can make a token with any name: check it is the real one before recording it.");
  if (!go) {
    say("Nothing is recorded. If the payment is right, run this again with the step set to go, and type PRIZE PAID.");
    finish(0);
  }
  if ((process.env.CONFIRM ?? "").trim() !== "PRIZE PAID") throw new Error("To record it, type PRIZE PAID in the confirm box. Nothing was recorded.");
  const group = await kickoff.recordPrize({ code: look.code, place, tx: tx.toLowerCase(), to: found.to, token: found.token, raw: found.raw, what: found.what });
  say(`Recorded. ${group.name} now shows ${winner.name} as paid: ${group.winners.find((w) => w.place === place).paid.what}.`);
  finish(0);
} catch (error) {
  say(`PROBLEM: ${error.message[0].toUpperCase()}${error.message.slice(1)}${error.message.endsWith(".") ? "" : "."}`);
  finish(1);
}
