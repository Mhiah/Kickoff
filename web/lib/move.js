// Moving a player to another phone, with a one-time code.
//
// A player is the key their phone made (device.js). There is no account to sign in to, so until
// now a player lived on one phone, unless they linked a wallet. This carries the key itself:
//
//   on the first phone   a code is made up here. The phone's key, and the predictions it is
//                        holding, are locked with the code and left with Kickoff's server.
//   on the other phone   the player types the code. That phone collects the locked copy,
//                        unlocks it with the code, and keeps the key as its own.
//
// From then on both phones are the same player. The server is never given the code: it is told
// only where the copy sits, which is worked out from the code in a way that cannot be turned
// back into it. It holds the copy for ten minutes and hands it over once.
//
//   code     8 characters from 32 (no 0, 1, I or O, which are easy to mix up), shown as ABCD-EFGH
//   from it  PBKDF2 with SHA-256, 200,000 rounds, gives 64 bytes: the first 32 are where the copy
//            sits, the last 32 are the AES-256-GCM key that locks it

import { fromHex, text, toHex } from "../engine/bytes.js";
import { playerIdOf } from "../engine/identity.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROUNDS = 200_000;
const DEVICE_KEY = "kickoff-device";
const NAME_KEY = "kickoff-name";
const BEFORE_KEY = "kickoff-before-move";
const SHARED_KEY = "kickoff-shared";
/** The server holds a locked copy no bigger than this many characters. */
export const BOX_MAX = 56_000;

const subtle = () => globalThis.crypto.subtle;
// In pieces: some browsers refuse a very long list of characters in one go.
const b64 = (bytes) => {
  let words = "";
  for (let i = 0; i < bytes.length; i += 8192) words += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(words);
};
const unb64 = (words) => Uint8Array.from(atob(words), (c) => c.charCodeAt(0));

/** A new code: 8 characters, chosen by the browser's own source of randomness. */
export function newCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ALPHABET[b % 32]).join("");
}

/** A code as it is shown: ABCD-EFGH. */
export const showCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** A code as typed, tidied: capitals, no spaces or dashes. Null if it could not be a code. */
export function readCode(typed) {
  const code = String(typed ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === 8 && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** From a code: where the copy sits (hex), and the key that locks it. */
async function fromCode(code) {
  const material = await subtle().importKey("raw", text(code), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: text("kickoff/move/v1"), iterations: ROUNDS }, material, 512));
  return { id: toHex(bits.slice(0, 32)), key: await subtle().importKey("raw", bits.slice(32), "AES-GCM", false, ["encrypt", "decrypt"]) };
}

/** Whether this phone's key is also on another phone, as far as this phone knows. */
export const isShared = (store) => store.read(SHARED_KEY) === "1";

/**
 * What goes to the other phone: the key, the name, and the predictions this phone is still
 * holding (ones that have not been opened yet), newest first, as many as fit.
 */
function pack(store, player) {
  const device = JSON.parse(store.read(DEVICE_KEY));
  const open = Object.values(store.all(player))
    .filter((e) => !e.opened)
    .sort((a, b) => (b.sealedAt ?? 0) - (a.sealedAt ?? 0))
    .map(({ fallback, ...entry }) => entry);
  const carried = { v: 1, device, name: store.read(NAME_KEY) ?? "", picks: [] };
  for (const entry of open) {
    carried.picks.push(entry);
    // Locked and written as base64, it grows by about a third.
    if (JSON.stringify(carried).length * 1.4 > BOX_MAX) {
      carried.picks.pop();
      break;
    }
  }
  return carried;
}

/**
 * On the first phone: make a code and leave the locked copy with the server.
 * @returns { code, until, left } where `left` counts predictions that did not fit and stay here
 */
export async function startMove({ store, client, device }) {
  const player = await device.player();
  const carried = pack(store, player);
  const code = newCode();
  const { id, key } = await fromCode(code);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const locked = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, text(JSON.stringify(carried))));
  const { until } = await client.leaveMove({ id, box: b64(new Uint8Array([...iv, ...locked])) });
  // From here this key may be on two phones, so a prediction can be changed from the other one.
  store.write(SHARED_KEY, "1");
  return { code, until, left: Object.values(store.all(player)).filter((e) => !e.opened).length - carried.picks.length };
}

/**
 * On the other phone: collect the copy with the code and become that player.
 * What this phone was before is kept aside, not thrown away.
 * @returns { player, name } of the player this phone now is
 */
export async function finishMove({ store, client, typed }) {
  const code = readCode(typed);
  if (!code) throw new Error("A code is 8 letters and numbers, like ABCD-EFGH.");
  const { id, key } = await fromCode(code);
  const { box } = await client.takeMove({ id });
  let carried;
  try {
    const bytes = unb64(box);
    carried = JSON.parse(new TextDecoder().decode(await subtle().decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12))));
  } catch {
    throw new Error("That copy could not be unlocked. Get a new code on your other phone.");
  }
  // Only a whole, well-formed key is taken on.
  const player = carried?.v === 1 && carried.device?.privateJwk && typeof carried.device.publicKey === "string" ? toHex(await playerIdOf(fromHex(carried.device.publicKey))) : null;
  if (!player || carried.device.privateJwk.kty !== "EC" || !Array.isArray(carried.picks)) throw new Error("That copy is not a Kickoff player. Get a new code on your other phone.");

  const before = store.read(DEVICE_KEY);
  if (before && before !== JSON.stringify(carried.device)) store.write(BEFORE_KEY, JSON.stringify({ device: JSON.parse(before), name: store.read(NAME_KEY) ?? "" }));
  store.write(DEVICE_KEY, JSON.stringify({ privateJwk: carried.device.privateJwk, publicKey: carried.device.publicKey }));
  if (typeof carried.name === "string" && carried.name) store.write(NAME_KEY, carried.name.slice(0, 24));
  for (const entry of carried.picks) if (entry?.player === player && typeof entry.match === "string") store.save(entry);
  store.write(SHARED_KEY, "1");
  return { player, name: typeof carried.name === "string" ? carried.name : "" };
}
