#!/usr/bin/env node
// Copies the parts of the picks engine the website needs into web/engine/.
//
// The site has to stand on its own, with every file inside the web folder, so it can be published
// as it is. So it carries its own copy of the sealing code, and of the code that makes a device's key, signs what
// it sends, and checks a receipt. The copy is never edited by hand: run
// this after changing the engine, and a test fails if the two ever differ.
//
//   node web/scripts/sync-engine.js

import { copyFile, mkdir } from "node:fs/promises";

export const ENGINE_FILES = ["bytes.js", "picks.js", "seal.js", "match.js", "identity.js", "bundle.js"];

const from = new URL("../../engine/src/", import.meta.url);
const to = new URL("../engine/", import.meta.url);

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(to, { recursive: true });
  for (const name of ENGINE_FILES) {
    await copyFile(new URL(name, from), new URL(name, to));
    console.log(`copied ${name}`);
  }
}
