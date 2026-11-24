// Linking a wallet from the website. The wallet here signs as a real one does, and the server is
// the real server's code, so the browser's side and the server's side are checked together.
import { test } from "node:test";
import assert from "node:assert/strict";

import { walletLinkText } from "../engine/identity.js";
import { createDevice } from "../lib/device.js";
import { createGroups } from "../lib/groups.js";
import { createStore } from "../lib/picks.js";
import { createClient } from "../lib/server.js";
import { CANCELLED, NO_WALLET, createWallet } from "../lib/wallet.js";
import { groupScreen } from "../screens.js";
import { FakeStorage, NOW, contextAt } from "./helpers.js";

import { testWallet } from "../../engine/test/test-wallet.js";
import { createHandler } from "../../server/src/http.js";
import { createKickoff } from "../../server/src/kickoff.js";
import { MemoryStore } from "../../server/src/store.js";

const LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";

function kickoffOnline() {
  let n = 0;
  const clock = { now: NOW };
  const handle = createHandler({ kickoff: createKickoff({ store: new MemoryStore(), league: LEAGUE, random: () => 4821 + n++ }), now: () => clock.now });
  const sent = [];
  const fetch = async (url, init = {}) => {
    sent.push(url);
    const answer = await handle({ method: init.method ?? "GET", path: url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { fetch, clock, sent };
}

/** A browser's wallet. It shows the person the note (kept in `shown`) and signs it, unless they say no. */
function browserWallet(wallet, { says = "yes" } = {}) {
  const shown = [];
  return {
    shown,
    // Wallets hand the address back in mixed capitals.
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts") return [`0x${wallet.address.slice(2).toUpperCase()}`];
      if (method === "personal_sign") {
        const note = Buffer.from(params[0].slice(2), "hex").toString("utf8");
        shown.push(note);
        if (says === "no") throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        return wallet.sign(note);
      }
      throw new Error(`the wallet does not do ${method}`);
    },
  };
}

/** A phone: its own storage, key and groups, and whatever wallet its browser has. */
function phone(online, inBrowser = null) {
  const store = createStore(new FakeStorage());
  const device = createDevice(store);
  const client = createClient({ device, fetch: online.fetch, now: () => online.clock.now });
  const groups = createGroups({ store, device, client });
  const wallet = createWallet({ provider: () => inBrowser, device, client, now: () => online.clock.now });
  const screen = async (arg) => groupScreen(arg, await contextAt(online.clock.now, store, { mine: await groups.view() })).html;
  return { store, device, client, groups, wallet, screen };
}

test("with no wallet in the browser, the player is told where to open Kickoff, and nothing is sent", async () => {
  const online = kickoffOnline();
  const ada = phone(online);
  assert.equal(ada.wallet.available(), false);
  await assert.rejects(ada.wallet.link(), new RegExp(NO_WALLET));
  assert.deepEqual(online.sent, []);
});

test("the wallet shows a note a person can read, and saying no links nothing", async () => {
  const online = kickoffOnline();
  const inBrowser = browserWallet(testWallet("ada"), { says: "no" });
  const ada = phone(online, inBrowser);
  await assert.rejects(ada.wallet.link(), new RegExp(CANCELLED));
  assert.deepEqual(inBrowser.shown, [walletLinkText({ player: await ada.device.player(), wallet: testWallet("ada").address, at: NOW })]);
  assert.match(inBrowser.shown[0], /^Kickoff: link this wallet to my player\.\nSigning is free and sends nothing\./);
  assert.deepEqual(online.sent, []);
  await ada.groups.refresh();
  assert.equal((await ada.groups.view()).wallet, null);
});

test("a player links a wallet from their own row on the group screen", async () => {
  const online = kickoffOnline();
  const wallet = testWallet("ada");
  const ada = phone(online, browserWallet(wallet));
  const bola = phone(online);
  const group = await ada.groups.start({ name: "Sunday Ballers", playerName: "Ada", plays: ["pl"] });
  await bola.groups.join({ code: group.code, playerName: "Bola" });
  await ada.groups.refresh();

  // Before: the link is offered on your own row, and nowhere else.
  let html = await ada.screen();
  assert.equal(html.match(/data-link-wallet/g).length, 1);
  assert.match(html, /Ada<span class="tag">you<\/span>.*?<button type="button" class="btn small quiet" data-link-wallet>Link a wallet<\/button>/s);
  assert.doesNotMatch(html, /Wallet linked/);

  const result = await ada.wallet.link();
  assert.equal(result.wallet, wallet.address);
  ada.groups.linked(result);
  assert.equal((await ada.groups.view()).wallet, wallet.address);

  // After: it says so, with the two ends of the address, and the offer is gone.
  html = await ada.screen();
  assert.doesNotMatch(html, /data-link-wallet/);
  assert.match(html, /Wallet linked/);
  assert.ok(html.includes(`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`));
  assert.ok(html.includes("you</span>"), "Ada's row is still marked as hers");

  // Bola sees that Ada's seat has a wallet, and not which wallet.
  await bola.groups.refresh();
  html = await bola.screen();
  assert.equal(html.match(/Wallet linked/g).length, 1);
  assert.ok(!html.includes(wallet.address.slice(2, 8)));
  assert.equal(html.match(/data-link-wallet/g).length, 1, "and is offered the link on her own row");
});

test("on a new phone, linking the same wallet brings the groups back", async () => {
  const online = kickoffOnline();
  const wallet = testWallet("ada");
  const oldPhone = phone(online, browserWallet(wallet));
  const group = await oldPhone.groups.start({ name: "Sunday Ballers", playerName: "Ada", plays: ["pl", "nba"] });
  oldPhone.groups.linked(await oldPhone.wallet.link());

  online.clock.now += 86400;
  const newPhone = phone(online, browserWallet(wallet));
  await newPhone.groups.refresh();
  let html = await newPhone.screen();
  assert.match(html, /Linked a wallet before\?/);
  assert.match(html, /data-link-wallet>Bring my groups back</);

  const result = await newPhone.wallet.link();
  assert.equal(result.carried, 1);
  newPhone.groups.linked(result);
  const mine = await newPhone.groups.view();
  assert.equal(mine.group.code, group.code);
  assert.equal(mine.name, "Ada");
  html = await newPhone.screen();
  assert.match(html, /Sunday Ballers/);
  assert.match(html, /You started this group/);
  assert.match(html, /Ada<span class="tag">you<\/span>/);
  assert.match(html, /role="switch"/, "and it can still change what the group plays");
  assert.equal(html.match(/<div class="row"><div class="grow"><div class="title" style="margin:0">/g).length, 1, "one seat, not two");

  // The linked wallet is remembered by the phone, and confirmed by the server on the next refresh.
  await newPhone.groups.refresh();
  assert.equal((await newPhone.groups.view()).wallet, wallet.address);
});

test("the offer to bring groups back is only for someone with no group and no wallet", async () => {
  const online = kickoffOnline();
  const ada = phone(online, browserWallet(testWallet("ada")));
  assert.match(await ada.screen(), /Bring my groups back/);
  await ada.groups.start({ name: "Sunday Ballers", playerName: "Ada", plays: ["pl"] });
  assert.doesNotMatch(await ada.screen("start"), /Bring my groups back/);
  assert.doesNotMatch(await ada.screen(), /Bring my groups back/);
});
