// Shared bits for the tests.
import { createHash } from "node:crypto";

/** A 32-byte id made from a label, so tests can use readable names. */
export function id(label) {
  return new Uint8Array(createHash("sha256").update(`test id: ${label}`).digest());
}

/** SHA-256 done with Node's own library, separately from the engine's. */
export function nodeSha256(...parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

export const LEAGUE = id("league");
export const MATCH = id("match 1");
export const OTHER_MATCH = id("match 2");
export const KICKOFF = 1_800_000_000;
