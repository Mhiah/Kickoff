// Linking a wallet: optional for everyone, a way back in for those who do it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { WALLET_LINK_WINDOW, walletLinkText } from "../../engine/src/index.js";
import { testWallet } from "../../engine/test/test-wallet.js";
import { CLOSES_BEFORE, SETTLE } from "../src/kickoff.js";
import { RedisStore } from "../src/redis-store.js";
import { FAKE_TOKEN, FAKE_URL, fakeRedis } from "./fake-redis.js";
import { device, server, serverWithFixtures } from "./helpers.js";

const FP = (n) => String(n).repeat(64).slice(0, 64);

/** A device links a wallet, the way the website does: the wallet signs the note, the device sends it. */
function link(s, who, wallet, { at = s.clock.now, as = who.player } = {}) {
  return s.post(who, "/api/wallet", { wallet: wallet.address, linkAt: at, signature: wallet.sign(walletLinkText({ player: as, wallet: wallet.address, at })) });
}
const mine = async (s, who) => (await s.post(who, "/api/me/groups")).body;

test("a player links a wallet, and other players are told only that one is linked", async () => {
  const s = server();
  const [ada, bola] = [await device(), await device()];
  const wallet = testWallet("ada");
  const { body: group } = await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  await s.post(bola, `/api/groups/${group.code}/join`, { playerName: "Bola" });
  assert.equal((await mine(s, ada)).wallet, null);

  const linked = await link(s, ada, wallet);
  assert.equal(linked.status, 200);
  assert.equal(linked.body.wallet, wallet.address);
  assert.equal(linked.body.carried, 0);
  assert.equal((await mine(s, ada)).wallet, wallet.address);
  assert.equal((await mine(s, bola)).wallet, null);

  const seen = await s.get(`/api/groups/${group.code}`);
  assert.deepEqual(seen.body.members.map((m) => [m.name, m.linked ?? false]), [["Ada", true], ["Bola", false]]);
  assert.deepEqual(seen.body.members[0].players, [ada.player]);
  assert.ok(!JSON.stringify(seen.body).includes(wallet.address.slice(2)), "the wallet's address is not shown to anyone else");
  assert.ok(!JSON.stringify(seen.body).includes("signature"));
});

test("only the wallet itself can link, and only to the player it named", async () => {
  const s = server();
  const [ada, mallory] = [await device(), await device()];
  const [wallet, other] = [testWallet("ada"), testWallet("mallory")];
  const at = s.clock.now;
  const note = (player, address) => walletLinkText({ player, wallet: address, at });
  const send = (who, body) => s.post(who, "/api/wallet", body);

  // Mallory names Ada's wallet but signs with her own.
  let r = await send(mallory, { wallet: wallet.address, linkAt: at, signature: other.sign(note(mallory.player, wallet.address)) });
  assert.deepEqual([r.status, r.body.error], [400, "That wallet did not sign this link."]);
  // Mallory sends the note Ada's wallet signed for Ada.
  r = await send(mallory, { wallet: wallet.address, linkAt: at, signature: wallet.sign(note(ada.player, wallet.address)) });
  assert.deepEqual([r.status, r.body.error], [400, "That wallet did not sign this link."]);
  // What a device sends cannot name another player: the player comes from the device's own signature.
  r = await send(mallory, { wallet: other.address, linkAt: at, signature: other.sign(note(mallory.player, other.address)), player: ada.player });
  assert.equal(r.status, 200);
  assert.equal((await mine(s, ada)).wallet, null);
  assert.equal((await mine(s, mallory)).wallet, other.address);

  r = await send(ada, { wallet: "ada.eth", linkAt: at, signature: "0x00" });
  assert.deepEqual([r.status, r.body.error], [400, "That is not a wallet address."]);
  r = await send(ada, { wallet: wallet.address, linkAt: at });
  assert.deepEqual([r.status, r.body.error], [400, "The wallet's signature is not in the right form."]);
  r = await send(ada, {});
  assert.equal(r.status, 400);
  assert.equal((await mine(s, ada)).wallet, null);
});

test("a link signed too long ago is refused", async () => {
  const s = server();
  const ada = await device();
  const wallet = testWallet("ada");
  const at = s.clock.now;
  s.clock.now += WALLET_LINK_WINDOW + 1;
  const late = await link(s, ada, wallet, { at });
  assert.deepEqual([late.status, late.body.error], [400, "The link was signed too long ago. Sign it again."]);
  assert.equal((await link(s, ada, wallet)).status, 200);
});

test("a device links one wallet. Linking it again is fine, another wallet is refused", async () => {
  const s = server();
  const ada = await device();
  const [wallet, second] = [testWallet("ada"), testWallet("ada's other wallet")];
  const first = await link(s, ada, wallet);
  s.clock.now += 3600;
  const again = await link(s, ada, wallet);
  assert.equal(again.status, 200);
  assert.equal(again.body.linkedAt, first.body.linkedAt);
  const other = await link(s, ada, second);
  assert.deepEqual([other.status, other.body.error], [409, "This device is already linked to another wallet."]);
  assert.equal((await mine(s, ada)).wallet, wallet.address);
});

test("a new phone that links the same wallet takes the same seat in the same groups", async () => {
  const s = server();
  const [oldPhone, newPhone, bola] = [await device(), await device(), await device()];
  const wallet = testWallet("ada");
  const { body: group } = await s.post(oldPhone, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  s.clock.now += 60;
  await s.post(bola, `/api/groups/${group.code}/join`, { playerName: "Bola" });
  const { body: second } = await s.post(oldPhone, "/api/groups", { name: "Work lot", playerName: "Ada O" });
  await link(s, oldPhone, wallet);

  // The old phone is lost. A new one has no groups until it links the wallet.
  s.clock.now += 86400;
  assert.deepEqual((await mine(s, newPhone)).groups, []);
  const linked = await link(s, newPhone, wallet);
  assert.equal(linked.status, 200);
  assert.equal(linked.body.carried, 2);
  assert.deepEqual(linked.body.groups.map((g) => g.code), [group.code, second.code]);

  const seen = (await s.get(`/api/groups/${group.code}`)).body;
  assert.deepEqual(seen.members.map((m) => m.name), ["Ada", "Bola"], "still two seats, and Ada is still listed first as the starter");
  assert.equal(seen.members[0].player, newPhone.player, "the seat is listed under the phone being used now");
  assert.deepEqual(seen.members[0].players, [oldPhone.player, newPhone.player].sort());
  assert.equal(seen.members[0].joinedAt, group.members[0].joinedAt, "and it joined when the old phone did");
  assert.equal((await s.get(`/api/groups/${second.code}`)).body.members[0].name, "Ada O");

  // The new phone has the starter's say over the group. So does the old one, if it turns up.
  assert.equal((await s.post(newPhone, `/api/groups/${group.code}/plays`, { plays: ["pl"] })).status, 200);
  assert.equal((await s.post(oldPhone, `/api/groups/${group.code}/plays`, { plays: ["pl", "nba"] })).status, 200);
  assert.equal((await s.post(bola, `/api/groups/${group.code}/plays`, { plays: ["cl"] })).status, 403);
});

test("a wallet's devices stay together: a group one joins, or a name one changes, is the same for all", async () => {
  const s = server();
  const [phone, laptop, bola] = [await device(), await device(), await device()];
  const wallet = testWallet("ada");
  await link(s, phone, wallet);
  await link(s, laptop, wallet);
  const { body: group } = await s.post(bola, "/api/groups", { name: "Sunday Ballers", playerName: "Bola" });

  s.clock.now += 60;
  const joined = await s.post(phone, `/api/groups/${group.code}/join`, { playerName: "Ada" });
  assert.deepEqual(joined.body.members.map((m) => m.name), ["Bola", "Ada"]);
  assert.deepEqual((await mine(s, laptop)).groups.map((g) => g.code), [group.code]);

  // The laptop changes the name. Its own seat's old name is not "someone else's".
  s.clock.now += 60;
  assert.equal((await s.post(laptop, `/api/groups/${group.code}/join`, { playerName: "Ada" })).status, 200);
  const renamed = await s.post(laptop, `/api/groups/${group.code}/join`, { playerName: "Ada the Great" });
  assert.deepEqual(renamed.body.members.map((m) => m.name), ["Bola", "Ada the Great"]);
  assert.deepEqual((await mine(s, phone)).groups[0].members.map((m) => m.name), ["Bola", "Ada the Great"]);
  // Somebody else's name is still taken.
  assert.equal((await s.post(laptop, `/api/groups/${group.code}/join`, { playerName: "bola" })).status, 409);

  // A group started on one device is on the other too.
  const { body: started } = await s.post(laptop, "/api/groups", { name: "Work lot", playerName: "Ada" });
  assert.deepEqual((await mine(s, phone)).groups.map((g) => g.code).sort(), [group.code, started.code].sort());
  assert.equal(started.members.length, 1);
});

test("two devices that were separate players in a group become one seat when they link the same wallet", async () => {
  const s = server();
  const [phone, laptop] = [await device(), await device()];
  const wallet = testWallet("ada");
  const { body: group } = await s.post(phone, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  s.clock.now += 60;
  await s.post(laptop, `/api/groups/${group.code}/join`, { playerName: "Ada laptop" });
  await link(s, phone, wallet);
  s.clock.now += 60;
  const linked = await link(s, laptop, wallet);
  assert.equal(linked.body.carried, 0);
  const seen = (await s.get(`/api/groups/${group.code}`)).body;
  assert.equal(seen.members.length, 1);
  assert.equal(seen.members[0].name, "Ada laptop", "the name chosen most recently");
});

test("one player, one pick: a pick from a wallet's other device is replaced, not added", async () => {
  const s = await serverWithFixtures();
  const [oldPhone, newPhone, bola] = [await device(), await device(), await device()];
  const wallet = testWallet("ada");
  const match = s.f.football.id;
  await link(s, oldPhone, wallet);
  assert.equal((await s.post(oldPhone, "/api/picks", { match, fingerprint: FP(1) })).status, 200);
  assert.equal((await s.post(bola, "/api/picks", { match, fingerprint: FP(2) })).status, 200);

  s.clock.now += 60;
  await link(s, newPhone, wallet);
  assert.equal((await s.get(`/api/matches/${match}`)).body.sealedCount, 2);
  s.clock.now += 60;
  assert.equal((await s.post(newPhone, "/api/picks", { match, fingerprint: FP(3) })).status, 200);
  assert.equal((await s.get(`/api/matches/${match}`)).body.sealedCount, 2, "still two picks: Ada's and Bola's");
  assert.equal((await s.post(oldPhone, "/api/picks/mine", { match })).body.sealed, null);
  assert.equal((await s.post(newPhone, "/api/picks/mine", { match })).body.sealed.fingerprint, FP(3));

  s.clock.now = s.f.football.kickoff - CLOSES_BEFORE + SETTLE;
  const frozen = await s.robot(`/api/admin/freeze/${match}`);
  assert.deepEqual(frozen.body.entries.map((e) => e.player).sort(), [newPhone.player, bola.player].sort());
});

test("a player with no wallet is untouched by any of this", async () => {
  const s = await serverWithFixtures();
  const [ada, bola] = [await device(), await device()];
  const { body: group } = await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  await s.post(bola, `/api/groups/${group.code}/join`, { playerName: "Bola" });
  await s.post(ada, "/api/picks", { match: s.f.football.id, fingerprint: FP(1) });
  await s.post(bola, "/api/picks", { match: s.f.football.id, fingerprint: FP(2) });
  const seen = (await s.get(`/api/groups/${group.code}`)).body;
  assert.deepEqual(seen.members.map((m) => Object.keys(m).sort()), [["joinedAt", "name", "player"], ["joinedAt", "name", "player"]]);
  assert.equal((await s.get(`/api/matches/${s.f.football.id}`)).body.sealedCount, 2);
});

test("it all works the same on the real kind of database", async () => {
  const redis = fakeRedis();
  const s = await serverWithFixtures({ store: new RedisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: redis.fetch }) });
  const [oldPhone, newPhone] = [await device(), await device()];
  const wallet = testWallet("ada");
  const { body: group } = await s.post(oldPhone, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  await link(s, oldPhone, wallet);
  await s.post(oldPhone, "/api/picks", { match: s.f.football.id, fingerprint: FP(1) });
  s.clock.now += 60;
  assert.equal((await link(s, newPhone, wallet)).body.carried, 1);
  await s.post(newPhone, "/api/picks", { match: s.f.football.id, fingerprint: FP(3) });
  assert.equal((await s.get(`/api/matches/${s.f.football.id}`)).body.sealedCount, 1);
  assert.equal((await s.get(`/api/groups/${group.code}`)).body.members.length, 1);
  assert.ok([...redis.strings.keys()].every((k) => k.startsWith("kickoff:")) && [...redis.hashes.keys()].every((k) => k.startsWith("kickoff:")));
});
