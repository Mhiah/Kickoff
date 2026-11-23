// The file of opened picks.
//
// After kickoff a league publishes, for each match, the list of sealed picks that went into the
// bundle and the picks that have been opened. This does not go in the mailbox, because it would not
// fit and does not need to: every opened pick proves itself against the lock that is already on
// chain. The file can live anywhere. Kickoff keeps it on the league's on-chain site.
//
// The file is JSON:
//
//   {
//     "v": 1,
//     "match": "0x…",
//     "entries":  [ { "player": "0x…", "fingerprint": "0x…" }, … ],
//     "openings": [ { "player": "0x…", "pickByte": 18, "salt": "0x…", "index": 1, "path": ["0x…", …] }, … ]
//   }
//
// Nothing in the file is taken on trust. The entries are only used if they produce the root on
// chain, and each opening is checked by open.js.

import { equal, fromHex, id32, toHex } from "./bytes.js";
import { fingerprintOf } from "./seal.js";

const hex = (bytes) => `0x${toHex(bytes)}`;
const id = (value, name) => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be 0x and 64 hex digits`);
  return fromHex(value);
};

/** Write the file. `openings` are { pickByte, player, salt, receipt } as the engine makes them. */
export function writeOpenings({ match, entries, openings }) {
  return JSON.stringify({
    v: 1,
    match: hex(id32(match, "match")),
    entries: entries.map((e) => ({ player: hex(e.player), fingerprint: hex(e.fingerprint) })),
    openings: openings.map((o) => ({
      player: hex(o.player),
      pickByte: o.pickByte,
      salt: hex(o.salt),
      index: o.receipt.index,
      path: o.receipt.path.map(hex),
    })),
  });
}

/** Read the file. Throws if it is not shaped as above. */
export function parseOpenings(fileText) {
  const d = JSON.parse(fileText);
  if (d === null || typeof d !== "object" || d.v !== 1 || !Array.isArray(d.entries) || !Array.isArray(d.openings)) {
    throw new Error("not an openings file");
  }
  return {
    match: id(d.match, "match"),
    entries: d.entries.map((e) => ({ player: id(e.player, "player"), fingerprint: id(e.fingerprint, "fingerprint") })),
    openings: d.openings.map((o) => {
      if (!Number.isInteger(o.pickByte) || o.pickByte < 0 || o.pickByte > 255) throw new Error("pickByte must be one byte");
      if (!Number.isInteger(o.index) || o.index < 0 || !Array.isArray(o.path)) throw new Error("bad receipt");
      return {
        player: id(o.player, "player"),
        pickByte: o.pickByte,
        salt: id(o.salt, "salt"),
        index: o.index,
        path: o.path.map((p) => id(p, "path step")),
      };
    }),
  };
}

/**
 * Join a match read from the chain with its openings file, ready for the table builder.
 * The receipt for each opening is rebuilt against the lock ON CHAIN, not against anything the file
 * says about the bundle.
 */
export async function withOpenings(league, match, file) {
  if (!equal(file.match, match.id)) throw new Error("this openings file is for a different match");
  const sealedBy = new Map(file.entries.map((e) => [toHex(e.player), e.fingerprint]));
  const openings = [];
  for (const o of file.openings) {
    const fingerprint =
      sealedBy.get(toHex(o.player)) ??
      (await fingerprintOf({ league, match: match.id, sport: match.sport, pickByte: o.pickByte, player: o.player, salt: o.salt }));
    openings.push({
      pickByte: o.pickByte,
      player: o.player,
      salt: o.salt,
      receipt: {
        league: id32(league, "league"),
        match: match.id,
        player: o.player,
        fingerprint,
        index: o.index,
        count: match.lock ? match.lock.count : 0,
        path: o.path,
        root: match.lock ? match.lock.root : new Uint8Array(32),
      },
    });
  }
  return { ...match, entries: file.entries, openings };
}
