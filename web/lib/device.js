// This device's own key.
//
// A player has no account and no wallet. The first time they play, their device makes a key with
// two halves. The private half is kept in this browser and never sent anywhere. The player's id is
// worked out from the public half, and everything the device sends to Kickoff is signed with the
// private half, so nobody else can send, change or open a pick in this player's name.
//
// If this browser's storage is cleared the key is gone, and with it this player. A way to back it
// up is still to do.

import { fromHex, toHex } from "../engine/bytes.js";
import { newDeviceKey, playerIdOf, signRequest } from "../engine/identity.js";

const DEVICE_KEY = "kickoff-device";

/** @param store  from createStore() in picks.js */
export function createDevice(store) {
  let loading = null;

  async function load() {
    let kept = null;
    try {
      kept = JSON.parse(store.read(DEVICE_KEY) ?? "null");
      const publicKey = fromHex(kept.publicKey);
      const player = toHex(await playerIdOf(publicKey));
      if (!kept.privateJwk || typeof kept.privateJwk !== "object") throw new Error("no private half");
      return { privateJwk: kept.privateJwk, publicKey, player };
    } catch {
      // Nothing kept yet, or what was kept is damaged: make a new key.
    }
    const made = await newDeviceKey();
    store.write(DEVICE_KEY, JSON.stringify({ privateJwk: made.privateJwk, publicKey: toHex(made.publicKey) }));
    return { ...made, player: toHex(await playerIdOf(made.publicKey)) };
  }
  const device = () => (loading ??= load());

  return {
    /** This device's player id, as hex. Made the first time it is asked for. */
    async player() {
      return (await device()).player;
    },
    /** Sign something to send to Kickoff. Returns exactly what to send. */
    async sign(method, path, payload, at) {
      const { privateJwk, publicKey } = await device();
      return signRequest({ privateJwk, publicKey, method, path, payload, at });
    },
  };
}
