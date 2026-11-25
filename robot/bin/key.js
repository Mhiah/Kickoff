#!/usr/bin/env node
// Print the public key that predictions are locked to (see engine/src/envelope.js).
//
// It is worked out from the robot's wallet key and is safe to show to anyone. It is the value of
// ROBOT_KEY in web/config.js: the website locks a copy of every prediction to it, so the robot can
// open predictions after kickoff without any player coming back.
//
//   KICKOFF_WALLET_KEY   the private key of the robot's wallet (a secret). Never printed.

import { appendFileSync } from "node:fs";

import { envelopeKeysFrom } from "../src/envelope.js";

try {
  const { publicKey } = envelopeKeysFrom(process.env.KICKOFF_WALLET_KEY);
  const line = `ROBOT_KEY ${publicKey}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `The public key predictions are locked to. It is safe to show to anyone.\n\n\`${publicKey}\`\n`);
} catch (error) {
  console.log(`PROBLEM: ${error.message}`);
  process.exit(1);
}
