#!/usr/bin/env node
// Check a signed note: Kickoff's word that it took a sealed prediction (see src/taken.js).
//
//   node engine/bin/taken.js note.json --key <Kickoff's public key>
//
// note.json is the note as a phone keeps it: { league, match, player, fingerprint, receivedAt,
// closesAt, key, sig }. Kickoff's public key is SERVER_KEY in web/config.js. Without --key the note
// is checked against the key it names itself, which shows only that somebody signed it.

import { readFile } from "node:fs/promises";

import { verifyTaken } from "../src/index.js";

const args = process.argv.slice(2);
const at = args.indexOf("--key");
const given = at >= 0 ? args[at + 1] : null;
const file = args.find((a, i) => !a.startsWith("--") && i !== at + 1);
const when = (seconds) => `${new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC`;

try {
  if (!file) throw new Error("say which file holds the note: node engine/bin/taken.js note.json --key <Kickoff's public key>");
  const note = JSON.parse(await readFile(file, "utf8"));
  const key = (given ?? note.key ?? "").toLowerCase().replace(/^0x/, "");
  const signed = await verifyTaken({ ...note, key });
  console.log(`League       ${note.league}`);
  console.log(`Match        ${note.match}`);
  console.log(`Player       ${note.player}`);
  console.log(`Fingerprint  ${note.fingerprint}`);
  console.log(`Taken at     ${Number.isSafeInteger(note.receivedAt) ? when(note.receivedAt) : "?"}`);
  console.log(`Closes at    ${Number.isSafeInteger(note.closesAt) ? when(note.closesAt) : "?"}`);
  console.log(`Checked against key ${key || "(none)"}${given ? "" : " (the one the note names itself)"}`);
  console.log(signed ? "SIGNED: that key signed exactly this." : "NOT SIGNED: that key did not sign this.");
  process.exit(signed ? 0 : 1);
} catch (error) {
  console.log(`PROBLEM: ${error.message}`);
  process.exit(2);
}
