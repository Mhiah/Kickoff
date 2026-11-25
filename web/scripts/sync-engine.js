#!/usr/bin/env node
// Copies the parts of the picks engine the website needs into web/engine/.
//
// The site has to stand on its own, with every file inside the web folder, so it can be published
// as it is. So it carries its own copy of the sealing code, of the code that makes a device's key,
// signs what it sends and checks a receipt, and of the code that reads Kickoff's league from
// X Layer and scores picks with the published circuits. The copy is never edited by hand: run
// this after changing the engine, and a test fails if the two ever differ.
//
//   node web/scripts/sync-engine.js

import { copyFile, mkdir } from "node:fs/promises";

export const ENGINE_FILES = [
  // sealing a pick, a device's key, and checking a receipt
  "bytes.js", "picks.js", "seal.js", "match.js", "identity.js", "bundle.js",
  // reading Kickoff's league straight from X Layer, and working out points from what is there
  "abi.js", "keccak.js", "messages.js", "reader.js", "open.js", "openings.js", "circuit.js", "score.js", "table.js", "league.js", "xlayer.js", "published.js",
];

const from = new URL("../../engine/src/", import.meta.url);
const to = new URL("../engine/", import.meta.url);

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(to, { recursive: true });
  for (const name of ENGINE_FILES) {
    await copyFile(new URL(name, from), new URL(name, to));
    console.log(`copied ${name}`);
  }
}
