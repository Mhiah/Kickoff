import { test } from "node:test";
import assert from "node:assert/strict";

import { newDeviceKey, signRequest } from "../../engine/src/index.js";
import { MAX_BODY, PREVIEW_LEAGUE, fromEnv, pathOf } from "../src/web.js";
import { FAKE_TOKEN, FAKE_URL, fakeRedis } from "./fake-redis.js";
import { fixtures } from "./helpers.js";

const SITE = "https://kickoff.example";
const env = { KV_REST_API_URL: FAKE_URL, KV_REST_API_TOKEN: FAKE_TOKEN, KICKOFF_ADMIN_KEY: "the-robots-key" };
const hosted = (settings = env) => fromEnv(settings, { fetch: fakeRedis().fetch, log: () => {} });
const now = () => Math.floor(Date.now() / 1000);

async function signedPost(handler, key, path, payload, address = `${SITE}${path}`) {
  const body = JSON.stringify(await signRequest({ ...key, method: "POST", path, payload, at: now() }));
  return handler(new Request(address, { method: "POST", headers: { "content-type": "application/json" }, body }));
}

test("the hosted server answers real web requests, start to finish", async () => {
  const handler = hosted();
  const empty = await handler(new Request(`${SITE}/api/fixtures`));
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(empty.headers.get("cache-control"), "no-store");
  assert.deepEqual(await empty.json(), { league: PREVIEW_LEAGUE, fixtures: [] });

  const f = await fixtures();
  const put = await handler(new Request(`${SITE}/api/admin/fixtures`, { method: "POST", headers: { "x-kickoff-admin": "the-robots-key", "content-type": "application/json" }, body: JSON.stringify({ fixtures: Object.values(f) }) }));
  assert.deepEqual(await put.json(), { added: 2, updated: 0 });

  const key = await newDeviceKey();
  const made = await signedPost(handler, key, "/api/groups", { name: "Sunday Ballers", playerName: "Ada" });
  assert.equal(made.status, 200);
  const group = await made.json();
  assert.match(group.code, /^SUNDAYB-\d{4}$/);
  const seen = await handler(new Request(`${SITE}/api/groups/${group.code}`));
  assert.deepEqual((await seen.json()).members.map((m) => m.name), ["Ada"]);
});

test("it works whichever way the host passes the address along", async () => {
  assert.equal(pathOf(`${SITE}/api/fixtures`), "/api/fixtures");
  assert.equal(pathOf(`${SITE}/api/fixtures?week=2`), "/api/fixtures");
  assert.equal(pathOf(`${SITE}/api?path=fixtures`), "/api/fixtures");
  assert.equal(pathOf(`${SITE}/api?path=groups/SUNDAYB-4821/join`), "/api/groups/SUNDAYB-4821/join");
  assert.equal(pathOf(`${SITE}/api/index?path=picks`), "/api/picks");
  // A "path" on the end of a full address changes nothing: it cannot be used to reach another one.
  assert.equal(pathOf(`${SITE}/api/fixtures?path=admin/fixtures`), "/api/fixtures");
  const handler = hosted();
  const key = await newDeviceKey();
  // Signed for /api/groups, and delivered by the host as /api?path=groups.
  const made = await signedPost(handler, key, "/api/groups", { name: "Office", playerName: "Bola" }, `${SITE}/api?path=groups`);
  assert.equal(made.status, 200);
});

test("with no database set, every address says so instead of pretending to keep things", async () => {
  const handler = hosted({});
  const answer = await handler(new Request(`${SITE}/api/fixtures`));
  assert.equal(answer.status, 503);
  assert.deepEqual(await answer.json(), { error: "Kickoff's database is not connected yet." });
  assert.equal((await hosted({ KV_REST_API_URL: FAKE_URL })(new Request(`${SITE}/api/fixtures`))).status, 503);
});

test("the database's own setting names work too", async () => {
  const handler = hosted({ UPSTASH_REDIS_REST_URL: FAKE_URL, UPSTASH_REDIS_REST_TOKEN: FAKE_TOKEN });
  assert.equal((await handler(new Request(`${SITE}/api/fixtures`))).status, 200);
});

test("with no robot key set, the robot's addresses are off, even for an empty key", async () => {
  for (const settings of [{ ...env, KICKOFF_ADMIN_KEY: undefined }, { ...env, KICKOFF_ADMIN_KEY: "" }]) {
    const handler = hosted(settings);
    for (const sent of ["", "undefined", "null"]) {
      const answer = await handler(new Request(`${SITE}/api/admin/fixtures`, { method: "POST", headers: { "x-kickoff-admin": sent }, body: JSON.stringify({ fixtures: [] }) }));
      assert.equal(answer.status, 403);
    }
  }
});

test("rubbish and oversized requests are turned away before anything else happens", async () => {
  const fake = fakeRedis();
  const handler = fromEnv(env, { fetch: fake.fetch, log: () => {} });
  const rubbish = await handler(new Request(`${SITE}/api/picks`, { method: "POST", body: "not json" }));
  assert.equal(rubbish.status, 400);
  assert.deepEqual(await rubbish.json(), { error: "The request could not be read." });
  const huge = await handler(new Request(`${SITE}/api/picks`, { method: "POST", body: JSON.stringify({ payload: "x".repeat(MAX_BODY) }) }));
  assert.equal(huge.status, 413);
  const nothing = await handler(new Request(`${SITE}/api/picks`, { method: "POST" }));
  assert.equal(nothing.status, 401, "an empty request is simply not signed");
  assert.equal(fake.seen.length, 0, "none of these reached the database");
});

test("an unexpected fault is noted for Kickoff and hidden from the person asking", async () => {
  const noted = [];
  const handler = fromEnv(env, { fetch: async () => { throw new Error("secret detail"); }, log: (fault) => noted.push(fault) });
  const answer = await handler(new Request(`${SITE}/api/fixtures`));
  assert.equal(answer.status, 500);
  assert.ok(!(await answer.text()).includes("secret detail"));
  assert.equal(noted.length, 1);
  assert.equal(noted[0].message, "the database could not be reached");
});
