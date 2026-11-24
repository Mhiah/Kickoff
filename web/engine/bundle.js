// Bundling sealed picks.
//
// Guests do not each write to the chain. Before kickoff the league gathers everyone's sealed picks
// for a match and works out ONE fingerprint that covers all of them (the "root"). Only the root is
// put on chain. Afterwards:
//
//   - each player holds a short receipt that proves their sealed pick is covered by that root;
//   - the league cannot change, add or drop a pick without the root changing.
//
// The root is a Merkle tree, built the standard way (RFC 6962, the scheme Certificate Transparency
// uses). Each sealed pick is one leaf: the player's id followed by the pick's fingerprint, 64 bytes.
// Leaves are put in order of player id, and a player may appear only once.
//
//   leaf hash   SHA-256( 0x00 | leaf )
//   node hash   SHA-256( 0x01 | left | right )
//
// The two different first bytes stop a leaf from ever being passed off as a node.
//
// One thing a receipt cannot prove on its own is how many picks the bundle holds: the same proof can
// fit two different sizes. So the size is not taken from the receipt. It is part of the value put on
// chain (see lockRef), and a pick is only opened if the receipt's size is the size on chain.

import { compare, concat, equal, id32, sha256, text, u64 } from "./bytes.js";

const LEAF = Uint8Array.of(0);
const NODE = Uint8Array.of(1);
const LOCK_TAG = text("kickoff/lock/v1");

const leafHash = (data) => sha256(concat(LEAF, data));
const nodeHash = (left, right) => sha256(concat(NODE, left, right));

/** The largest power of two that is smaller than n (n must be 2 or more). */
function split(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

async function rootOfHashes(hashes) {
  if (hashes.length === 0) return sha256(new Uint8Array(0));
  if (hashes.length === 1) return hashes[0];
  const k = split(hashes.length);
  return nodeHash(await rootOfHashes(hashes.slice(0, k)), await rootOfHashes(hashes.slice(k)));
}

async function pathInHashes(index, hashes) {
  if (hashes.length <= 1) return [];
  const k = split(hashes.length);
  if (index < k) return [...(await pathInHashes(index, hashes.slice(0, k))), await rootOfHashes(hashes.slice(k))];
  return [...(await pathInHashes(index - k, hashes.slice(k))), await rootOfHashes(hashes.slice(0, k))];
}

/** The Merkle root of a list of raw leaves (RFC 6962). */
export async function merkleRoot(leaves) {
  return rootOfHashes(await Promise.all(leaves.map(leafHash)));
}

/** The proof that the leaf at `index` is in the tree: the hashes needed to climb to the root. */
export async function merklePath(index, leaves) {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new RangeError("no such leaf");
  return pathInHashes(index, await Promise.all(leaves.map(leafHash)));
}

/**
 * Check a proof: is `leaf`, at place `index` of a tree of `size` leaves, covered by `root`?
 * This is the checking procedure from RFC 9162 section 2.1.3.2.
 */
export async function merkleVerify({ leaf, index, size, path, root }) {
  if (!Number.isInteger(index) || !Number.isInteger(size) || index < 0 || index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r = await leafHash(leaf);
  for (const p of path) {
    if (!(p instanceof Uint8Array) || p.length !== 32) return false;
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = await nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      r = await nodeHash(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && equal(r, root);
}

const leafOf = (player, fingerprint) => concat(player, fingerprint);

/**
 * Bundle everyone's sealed picks for one match.
 * `entries` is a list of { player, fingerprint }, in any order. A player may appear only once.
 */
export async function buildBundle({ league, match, entries }) {
  const sorted = entries
    .map((e) => ({ player: id32(e.player, "player"), fingerprint: id32(e.fingerprint, "fingerprint") }))
    .sort((a, b) => compare(a.player, b.player));
  for (let i = 1; i < sorted.length; i++) {
    if (equal(sorted[i - 1].player, sorted[i].player)) throw new Error("a player may appear only once in a bundle");
  }
  const leaves = sorted.map((e) => leafOf(e.player, e.fingerprint));
  return {
    league: id32(league, "league"),
    match: id32(match, "match"),
    count: sorted.length,
    root: await merkleRoot(leaves),
    entries: sorted,
  };
}

/**
 * The one value that goes on chain before kickoff. It covers the league, the match, how many
 * picks there are, and the root, so none of them can be changed afterwards.
 */
export async function lockRef({ league, match, count, root }) {
  return sha256(concat(LOCK_TAG, id32(league, "league"), id32(match, "match"), u64(count), id32(root, "root")));
}

/** The receipt a player keeps: proof that their sealed pick is in the bundle. */
export async function receiptFor(bundle, player) {
  const who = id32(player, "player");
  const index = bundle.entries.findIndex((e) => equal(e.player, who));
  if (index < 0) throw new Error("that player has no pick in this bundle");
  const leaves = bundle.entries.map((e) => leafOf(e.player, e.fingerprint));
  return {
    league: bundle.league,
    match: bundle.match,
    player: who,
    fingerprint: bundle.entries[index].fingerprint,
    index,
    count: bundle.count,
    path: await merklePath(index, leaves),
    root: bundle.root,
  };
}

/** Does this receipt really prove its sealed pick is covered by its root? */
export async function verifyReceipt(receipt) {
  try {
    return await merkleVerify({
      leaf: leafOf(id32(receipt.player, "player"), id32(receipt.fingerprint, "fingerprint")),
      index: receipt.index,
      size: receipt.count,
      path: receipt.path,
      root: id32(receipt.root, "root"),
    });
  } catch {
    return false;
  }
}
