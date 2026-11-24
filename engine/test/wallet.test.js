// Reading a wallet's signature, and the link between a wallet and a player.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { WALLET_LINK_WINDOW, fromHex, keccak256, personalMessageHash, recoverAddress, signerOfText, toHex, verifyWalletLink, walletLinkText } from "../src/index.js";
import { testWallet } from "./test-wallet.js";

const PLAYER = "ab".repeat(32);
const AT = 1_800_000_000;

test("a signature published elsewhere gives the wallet that made it", () => {
  // The example in web3.js's own documentation for signing a message.
  const signature = "0xb91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c";
  assert.equal(toHex(personalMessageHash("Some data")), "1da44b586eb0729ff70a73c326926f6ed5a25f5b056e7f47fbc6e58d86871655");
  assert.equal(signerOfText("Some data", signature), "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23");
});

test("signatures made by Node's own cryptography are read back to the right wallet", () => {
  // OpenSSL makes the key and signs. Kickoff's arithmetic has to find the same wallet.
  for (let i = 0; i < 12; i++) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    const jwk = publicKey.export({ format: "jwk" });
    const address = `0x${toHex(keccak256(new Uint8Array(Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]))).subarray(12))}`;
    const data = Buffer.from(`something to sign ${i}`);
    const rs = sign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" });
    const hash = new Uint8Array(createHash("sha256").update(data).digest());
    const found = [27, 28].map((last) => {
      try {
        return recoverAddress(hash, new Uint8Array([...rs, last]));
      } catch {
        return null;
      }
    });
    assert.ok(found.includes(address), `signature ${i} was read back`);
  }
});

test("the note a wallet signs can be read by a person", () => {
  assert.equal(
    walletLinkText({ player: PLAYER, wallet: "0x37FFD5B3E27DD5CE04945559DEF00B66D5841FC1", at: AT }),
    `Kickoff: link this wallet to my player.\nSigning is free and sends nothing.\n\nPlayer: ${PLAYER}\nWallet: 0x37ffd5b3e27dd5ce04945559def00b66d5841fc1\nTime: ${AT}`,
  );
});

test("a link signed by the wallet is accepted, with or without 0x, in capitals or not", () => {
  const w = testWallet("ada");
  const signature = w.sign(walletLinkText({ player: PLAYER, wallet: w.address, at: AT }));
  assert.equal(verifyWalletLink({ player: PLAYER, wallet: w.address, at: AT, signature, now: AT + 60 }), w.address);
  assert.equal(verifyWalletLink({ player: PLAYER, wallet: w.address.toUpperCase().replace("0X", "0x"), at: AT, signature: signature.slice(2), now: AT }), w.address);
  assert.equal(verifyWalletLink({ player: PLAYER, wallet: w.address, at: AT, signature }), w.address, "an old link can still be checked later");
});

test("a link is refused if anything in it was changed", () => {
  const w = testWallet("ada");
  const other = testWallet("bola");
  const signature = w.sign(walletLinkText({ player: PLAYER, wallet: w.address, at: AT }));
  const ok = { player: PLAYER, wallet: w.address, at: AT, signature, now: AT };
  assert.throws(() => verifyWalletLink({ ...ok, player: "cd".repeat(32) }), /that wallet did not sign this link/);
  assert.throws(() => verifyWalletLink({ ...ok, wallet: other.address }), /that wallet did not sign this link/);
  assert.throws(() => verifyWalletLink({ ...ok, at: AT + 1 }), /that wallet did not sign this link/);
  assert.throws(() => verifyWalletLink({ ...ok, signature: other.sign(walletLinkText({ player: PLAYER, wallet: w.address, at: AT })) }), /that wallet did not sign this link/);
  assert.throws(() => verifyWalletLink({ ...ok, signature: w.sign("Kickoff: something else") }), /that wallet did not sign this link/);
});

test("a link that is too old, or from the future, is refused", () => {
  const w = testWallet("ada");
  const signature = w.sign(walletLinkText({ player: PLAYER, wallet: w.address, at: AT }));
  const ok = { player: PLAYER, wallet: w.address, at: AT, signature };
  assert.equal(verifyWalletLink({ ...ok, now: AT + WALLET_LINK_WINDOW }), w.address);
  assert.throws(() => verifyWalletLink({ ...ok, now: AT + WALLET_LINK_WINDOW + 1 }), /signed too long ago/);
  assert.throws(() => verifyWalletLink({ ...ok, now: AT - 301 }), /signed too long ago/);
});

test("things that are not a link are refused with a plain reason", () => {
  const w = testWallet("ada");
  const signature = w.sign(walletLinkText({ player: PLAYER, wallet: w.address, at: AT }));
  const ok = { player: PLAYER, wallet: w.address, at: AT, signature, now: AT };
  assert.throws(() => verifyWalletLink({ ...ok, wallet: "ada.eth" }), /not a wallet address/);
  assert.throws(() => verifyWalletLink({ ...ok, wallet: undefined }), /not a wallet address/);
  assert.throws(() => verifyWalletLink({ ...ok, player: "me" }), /not a player/);
  assert.throws(() => verifyWalletLink({ ...ok, at: "now" }), /no time on it/);
  assert.throws(() => verifyWalletLink({ ...ok, signature: "0x1234" }), /not in the right form/);
  assert.throws(() => verifyWalletLink({ ...ok, signature: `0x${"00".repeat(65)}` }), /could not be read/);
  assert.throws(() => verifyWalletLink({ ...ok, signature: `${signature.slice(0, -2)}05` }), /could not be read/);
  assert.throws(() => recoverAddress(fromHex("00".repeat(31)), fromHex(signature)), /32-byte/);
});
