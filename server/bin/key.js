#!/usr/bin/env node
// Print the public key Kickoff's server signs with (see engine/src/taken.js).
//
// It is worked out from the server's key and is safe to show to anyone. It is the value of
// SERVER_KEY in web/config.js: the website checks every signed note against it.
//
//   KICKOFF_ADMIN_KEY   the server's key (a secret). Never printed.

import { appendFileSync } from "node:fs";

import { signingKeysFrom } from "../src/signing.js";

try {
  const { publicKey } = signingKeysFrom(process.env.KICKOFF_ADMIN_KEY);
  console.log(`SERVER_KEY ${publicKey}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `The public key Kickoff's server signs with. It is safe to show to anyone.\n\n\`${publicKey}\`\n`);
} catch (error) {
  console.log(`PROBLEM: ${error.message}`);
  process.exit(1);
}
