import { test } from "node:test";
import assert from "node:assert/strict";

import { fromHex, sealPick, toHex, verifyReceipt } from "../../engine/src/index.js";
import { RedisStore } from "../src/redis-store.js";
import { MemoryStore } from "../src/store.js";
import { FAKE_TOKEN, FAKE_URL, fakeRedis } from "./fake-redis.js";
import { LEAGUE, device, serverWithFixtures } from "./helpers.js";

const stores = {
  "in memory": () => new MemoryStore(),
  "the database": () => new RedisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: fakeRedis().fetch }),
};

for (const [name, make] of Object.entries(stores)) {
  test(`${name}: values and tables come back exactly as they went in`, async () => {
    const store = make();
    assert.equal(await store.get("nothing"), null);
    assert.equal(await store.tableGet("no-table", "nobody"), null);
    assert.deepEqual(await store.tableAll("no-table"), {});
    const value = { name: 'Ada "the Great" Obi ✨', n: 0, list: [1, null, "x"], nested: { ok: false } };
    await store.set("group:ADA-0001", value);
    assert.deepEqual(await store.get("group:ADA-0001"), value);
    await store.tableSet("members:ADA-0001", "aa".repeat(32), { name: "Ada" });
    await store.tableSet("members:ADA-0001", "bb".repeat(32), { name: "Bola" });
    await store.tableSet("members:ADA-0001", "aa".repeat(32), { name: "Ada O" });
    assert.deepEqual(await store.tableGet("members:ADA-0001", "aa".repeat(32)), { name: "Ada O" });
    assert.deepEqual(await store.tableAll("members:ADA-0001"), { ["aa".repeat(32)]: { name: "Ada O" }, ["bb".repeat(32)]: { name: "Bola" } });
  });

  test(`${name}: what is kept cannot be changed by changing what was handed over or back`, async () => {
    const store = make();
    const value = { list: [1, 2] };
    await store.set("k", value);
    value.list.push(3);
    const back = await store.get("k");
    back.list.push(4);
    assert.deepEqual(await store.get("k"), { list: [1, 2] });
  });

  test(`${name}: a value is only set if nothing is there, and says which happened`, async () => {
    const store = make();
    assert.equal(await store.setIfAbsent("group:X-0001", { first: true }), true);
    assert.equal(await store.setIfAbsent("group:X-0001", { first: false }), false);
    assert.deepEqual(await store.get("group:X-0001"), { first: true });
  });

  test(`${name}: a group, sealed predictions, a frozen bundle and receipts all work on it`, async () => {
    const s = await serverWithFixtures({ store: make() });
    const [ada, bola] = [await device(), await device()];
    const { body: group } = await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
    s.clock.now += 60;
    await s.post(bola, `/api/groups/${group.code}/join`, { playerName: "Bola" });
    assert.deepEqual((await s.get(`/api/groups/${group.code}`)).body.members.map((m) => m.name), ["Ada", "Bola"]);
    const secrets = {};
    for (const who of [ada, bola]) {
      const sealed = await sealPick({ league: LEAGUE, match: s.f.football.id, sport: s.f.football.sport, pick: { home: 2, away: 1 }, player: who.player });
      secrets[who.player] = sealed;
      assert.equal((await s.post(who, "/api/picks", { match: s.f.football.id, fingerprint: toHex(sealed.fingerprint) })).status, 200);
    }
    const { body: frozen } = await s.freeze(s.f.football);
    assert.equal(frozen.count, 2);
    const { body: r } = await s.get(`/api/matches/${s.f.football.id}/receipt/${ada.player}`);
    assert.equal(await verifyReceipt({ league: LEAGUE, match: r.match, player: r.player, fingerprint: r.fingerprint, index: r.index, count: r.count, path: r.path.map(fromHex), root: r.root }), true);
    s.clock.now = s.f.football.kickoff + 1;
    const mine = secrets[ada.player];
    assert.equal((await s.post(ada, "/api/opened", { match: s.f.football.id, pickByte: mine.pickByte, salt: toHex(mine.salt) })).status, 200);
    assert.equal((await s.get(`/api/matches/${s.f.football.id}`)).body.opened.length, 1);
    assert.equal((await s.get(`/api/matches/${s.f.football.id}/openings`)).body.openings.length, 1);
  });
}

test("the database's token goes only to the database, in a header, and never into an address", async () => {
  const fake = fakeRedis();
  const store = new RedisStore({ url: `${FAKE_URL}/`, token: FAKE_TOKEN, fetch: fake.fetch });
  await store.set("k", { secret: "pick" });
  await store.tableAll("t");
  assert.ok(fake.seen.length >= 2);
  for (const { url, options } of fake.seen) {
    assert.equal(url, FAKE_URL);
    assert.ok(!url.includes(FAKE_TOKEN));
    assert.equal(options.headers.authorization, `Bearer ${FAKE_TOKEN}`);
    assert.ok(!options.body.includes(FAKE_TOKEN));
  }
});

test("when the database fails, the fault says what failed and gives nothing away", async () => {
  const wrong = new RedisStore({ url: FAKE_URL, token: "a-wrong-token", fetch: fakeRedis().fetch });
  await assert.rejects(wrong.get("k"), (error) => {
    assert.match(error.message, /the database refused a GET \(status 401\)/);
    assert.ok(!error.message.includes("a-wrong-token") && !error.message.includes(FAKE_URL));
    return true;
  });
  const down = new RedisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: async () => { throw new Error(`connect ECONNREFUSED ${FAKE_URL}?_token=${FAKE_TOKEN}`); } });
  await assert.rejects(down.get("k"), (error) => {
    assert.equal(error.message, "the database could not be reached");
    return true;
  });
  const garbled = new RedisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: async () => new Response("<html>bad gateway</html>", { status: 502 }) });
  await assert.rejects(garbled.get("k"), /refused a GET \(status 502\)/);
  assert.throws(() => new RedisStore({ url: "http://plain.example", token: FAKE_TOKEN }), /must start with https/);
  assert.throws(() => new RedisStore({ url: FAKE_URL, token: "" }), /needs its token/);
});

test("a player is told plainly when the database is down, and nothing leaks", async () => {
  const fake = fakeRedis();
  let broken = false;
  const fetch = (...args) => (broken ? Promise.reject(new Error(`boom ${FAKE_TOKEN}`)) : fake.fetch(...args));
  const s = await serverWithFixtures({ store: new RedisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch }) });
  broken = true;
  const answer = await s.get("/api/fixtures");
  assert.equal(answer.status, 500);
  assert.equal(answer.body.error, "Something went wrong on Kickoff's side. Try again.");
  assert.ok(!JSON.stringify(answer.body).includes(FAKE_TOKEN));
});

test("Kickoff's records sit apart from anything else in the same database", async () => {
  const fake = fakeRedis();
  // Another project already keeps things here, under names Kickoff also uses.
  fake.strings.set("group:SUNDAYB-4821", "theirs");
  fake.hashes.set("fixtures", new Map([["x", "theirs"]]));
  const s = await serverWithFixtures({ store: new RedisStore({ url: FAKE_URL, token: FAKE_TOKEN, fetch: fake.fetch }) });
  const ada = await device();
  const made = await s.post(ada, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  assert.equal(made.body.code, "SUNDAYB-4821", "their record under the same name does not get in the way");
  assert.equal((await s.get("/api/fixtures")).body.fixtures.length, 2, "and theirs is not read as one of Kickoff's");
  // Theirs is untouched, and everything Kickoff wrote starts with its own name.
  assert.equal(fake.strings.get("group:SUNDAYB-4821"), "theirs");
  assert.deepEqual([...fake.hashes.get("fixtures")], [["x", "theirs"]]);
  const mine = [...fake.strings.keys(), ...fake.hashes.keys()].filter((k) => k !== "group:SUNDAYB-4821" && k !== "fixtures");
  assert.ok(mine.length > 3 && mine.every((k) => k.startsWith("kickoff:")));
});
