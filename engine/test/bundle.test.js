import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBundle, fromHex, lockRef, merklePath, merkleRoot, merkleVerify, receiptFor, toHex, verifyReceipt,
} from "../src/index.js";
import { LEAGUE, MATCH, OTHER_MATCH, id } from "./helpers.js";

// The reference tree from Certificate Transparency (RFC 6962): eight leaves and the root of the
// tree made from the first 1, 2, ... 8 of them. These values are not Kickoff's. They are the
// published test values every implementation of this tree must reproduce.
const REFERENCE_LEAVES = ["", "00", "10", "2021", "3031", "40414243", "5051525354555657", "606162636465666768696a6b6c6d6e6f"].map(fromHex);
const REFERENCE_ROOTS = [
  "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
  "fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125",
  "aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77",
  "d37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7",
  "4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4",
  "76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef",
  "ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c",
  "5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328",
];

test("the tree gives the published reference roots (RFC 6962)", async () => {
  for (let n = 1; n <= 8; n++) {
    assert.equal(toHex(await merkleRoot(REFERENCE_LEAVES.slice(0, n))), REFERENCE_ROOTS[n - 1], `${n} leaves`);
  }
  assert.equal(
    toHex(await merkleRoot([])),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "an empty tree is the SHA-256 of nothing",
  );
});

test("every leaf of every tree from 1 to 17 leaves has a proof that checks, and only for its own place", async () => {
  const leaves = Array.from({ length: 17 }, (_, i) => id(`leaf ${i}`));
  let proofs = 0;
  for (let size = 1; size <= 17; size++) {
    const tree = leaves.slice(0, size);
    const root = await merkleRoot(tree);
    for (let index = 0; index < size; index++) {
      const path = await merklePath(index, tree);
      assert.ok(await merkleVerify({ leaf: tree[index], index, size, path, root }), `size ${size}, leaf ${index}`);
      proofs++;
      // The same proof must not work for a different leaf, or for a different place in the tree.
      assert.equal(await merkleVerify({ leaf: id("not in the tree"), index, size, path, root }), false);
      if (size > 1) {
        assert.equal(await merkleVerify({ leaf: tree[index], index: (index + 1) % size, size, path, root }), false);
      }
    }
  }
  assert.equal(proofs, (17 * 18) / 2);
});

// ---- bundles of sealed picks

const players = ["ada", "bola", "chidi", "dayo", "efe", "femi", "gbenga"];
const entries = players.map((name) => ({ player: id(name), fingerprint: id(`${name}'s sealed pick`) }));

test("every player gets a receipt that proves their sealed pick is in the bundle", async () => {
  const bundle = await buildBundle({ league: LEAGUE, match: MATCH, entries });
  assert.equal(bundle.count, players.length);
  for (const name of players) {
    const receipt = await receiptFor(bundle, id(name));
    assert.ok(await verifyReceipt(receipt), name);
    assert.equal(toHex(receipt.root), toHex(bundle.root));
  }
});

test("the order the picks were gathered in does not change the bundle", async () => {
  const forward = await buildBundle({ league: LEAGUE, match: MATCH, entries });
  const backward = await buildBundle({ league: LEAGUE, match: MATCH, entries: [...entries].reverse() });
  assert.equal(toHex(forward.root), toHex(backward.root));
});

test("changing, adding or dropping any pick changes the bundle's root", async () => {
  const original = toHex((await buildBundle({ league: LEAGUE, match: MATCH, entries })).root);

  const changed = entries.map((e, i) => (i === 3 ? { ...e, fingerprint: id("a swapped pick") } : e));
  assert.notEqual(toHex((await buildBundle({ league: LEAGUE, match: MATCH, entries: changed })).root), original, "changed");

  const added = [...entries, { player: id("a late joiner"), fingerprint: id("their pick") }];
  assert.notEqual(toHex((await buildBundle({ league: LEAGUE, match: MATCH, entries: added })).root), original, "added");

  const dropped = entries.slice(1);
  assert.notEqual(toHex((await buildBundle({ league: LEAGUE, match: MATCH, entries: dropped })).root), original, "dropped");
});

test("a player cannot be in a bundle twice", async () => {
  const twice = [...entries, { player: id("ada"), fingerprint: id("ada's second pick") }];
  await assert.rejects(buildBundle({ league: LEAGUE, match: MATCH, entries: twice }), /only once/);
});

test("a receipt that has been tampered with does not check", async () => {
  const bundle = await buildBundle({ league: LEAGUE, match: MATCH, entries });
  const good = await receiptFor(bundle, id("chidi"));
  assert.ok(await verifyReceipt(good));

  const flipped = good.path.map((p, i) => (i === 0 ? Uint8Array.from(p, (b, j) => (j === 0 ? b ^ 1 : b)) : p));
  const tampered = {
    "a different sealed pick": { fingerprint: id("a different sealed pick") },
    "someone else's name on it": { player: id("bola") },
    "a different place in the bundle": { index: good.index + 1 },
    "one bit of the proof flipped": { path: flipped },
    "a step missing from the proof": { path: good.path.slice(1) },
    "an extra step in the proof": { path: [...good.path, id("extra")] },
    "a different root": { root: id("a different root") },
  };
  for (const [what, change] of Object.entries(tampered)) {
    assert.equal(await verifyReceipt({ ...good, ...change }), false, what);
  }
});

test("a proof does not by itself fix how many picks are in the bundle, which is why the count goes on chain", async () => {
  // In a bundle of 7, a pick in the first four has exactly the proof it would have in a bundle of
  // 8. So a receipt alone cannot be trusted to say how big the bundle was. The size is fixed by the
  // value put on chain (lockRef covers it), and opening a pick compares the receipt's size with
  // the size on chain. See "a receipt that claims a different bundle size" in open.test.js.
  const leaves = Array.from({ length: 7 }, (_, i) => id(`leaf ${i}`));
  const root = await merkleRoot(leaves);
  const path = await merklePath(0, leaves);
  assert.ok(await merkleVerify({ leaf: leaves[0], index: 0, size: 7, path, root }));
  assert.ok(await merkleVerify({ leaf: leaves[0], index: 0, size: 8, path, root }), "the same proof also fits a size of 8");
});

test("a player who was left out of the bundle cannot get a receipt", async () => {
  const bundle = await buildBundle({ league: LEAGUE, match: MATCH, entries: entries.slice(1) }); // ada left out
  await assert.rejects(receiptFor(bundle, id("ada")), /no pick in this bundle/);
});

test("a bundle with one pick, and a bundle with none, both work", async () => {
  const one = await buildBundle({ league: LEAGUE, match: MATCH, entries: entries.slice(0, 1) });
  const receipt = await receiptFor(one, id("ada"));
  assert.deepEqual(receipt.path, []);
  assert.ok(await verifyReceipt(receipt));

  const none = await buildBundle({ league: LEAGUE, match: MATCH, entries: [] });
  assert.equal(none.count, 0);
});

test("the value that goes on chain covers the league, the match, the number of picks and the root", async () => {
  const bundle = await buildBundle({ league: LEAGUE, match: MATCH, entries });
  const original = toHex(await lockRef(bundle));
  assert.equal(original.length, 64);
  assert.notEqual(toHex(await lockRef({ ...bundle, league: id("another league") })), original);
  assert.notEqual(toHex(await lockRef({ ...bundle, match: OTHER_MATCH })), original);
  assert.notEqual(toHex(await lockRef({ ...bundle, count: bundle.count + 1 })), original);
  assert.notEqual(toHex(await lockRef({ ...bundle, root: id("another root") })), original);
});
