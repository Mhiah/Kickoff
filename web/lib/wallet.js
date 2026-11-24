// Linking a wallet to this player. Nobody has to.
//
// A player is this device's own key (lib/device.js). Someone who has a wallet can link it: the
// wallet signs a short note naming this player, and Kickoff's server checks the signature. Signing
// is free. Nothing is paid and nothing is sent to any chain. The wallet is never asked for anything
// else.
//
// What linking gives: on a new phone, linking the same wallet brings the player's groups back.
//
// The wallet is whatever the browser offers: OKX Wallet first, then any other. On a phone that
// means opening Kickoff inside the wallet app's own browser.

import { text, toHex } from "../engine/bytes.js";
import { walletLinkText } from "../engine/identity.js";

export const NO_WALLET = "No wallet found here. Open Kickoff inside your wallet app.";
export const CANCELLED = "Not linked. You cancelled in your wallet.";
const UNCLEAR = "The wallet did not sign. Try again.";

/**
 * @param provider  a function giving the browser's wallet, or nothing if there is none
 * @param device    from createDevice()
 * @param client    from createClient()
 * @param now       a function giving the time in seconds
 */
export function createWallet({ provider = () => globalThis.okxwallet ?? globalThis.ethereum ?? null, device, client, now = () => Math.floor(Date.now() / 1000) }) {
  return {
    /** Whether this browser has a wallet to ask. */
    available: () => Boolean(provider()),
    /**
     * Ask the wallet to sign the link, and send it to Kickoff.
     * @returns what the server says: { wallet, linkedAt, carried, groups }
     * Throws with words to show the player if there is no wallet, they cancel, or it is refused.
     */
    async link() {
      const wallet = provider();
      if (!wallet || typeof wallet.request !== "function") throw new Error(NO_WALLET);
      let address;
      let signature;
      const at = now();
      try {
        [address] = await wallet.request({ method: "eth_requestAccounts" });
        if (typeof address !== "string") throw new Error("no account");
        const note = walletLinkText({ player: await device.player(), wallet: address, at });
        // Wallets take the note as the hex of its bytes, and show it to the person as text.
        signature = await wallet.request({ method: "personal_sign", params: [`0x${toHex(text(note))}`, address] });
      } catch (error) {
        // 4001 is every wallet's code for "the person said no".
        throw new Error(error?.code === 4001 ? CANCELLED : UNCLEAR);
      }
      return client.linkWallet({ wallet: address, linkAt: at, signature });
    },
  };
}
