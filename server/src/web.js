// Kickoff's server as a web host runs it.
//
// A web host hands over a standard web request and wants a standard web answer. This file sits
// between that and the server's own code (http.js), and builds the server from the host's settings.
//
// Settings, all optional except the database:
//   KV_REST_API_URL, KV_REST_API_TOKEN   the database (the names Vercel gives a Redis store)
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN   the same, under the database's own names
//   KICKOFF_ADMIN_KEY                    the robot's key. Without it the robot's addresses are off.
//   KICKOFF_LEAGUE                       Kickoff's id on X Layer. Until Kickoff is live, a stand-in.

import { createHandler } from "./http.js";
import { createKickoff } from "./kickoff.js";
import { RedisStore } from "./redis-store.js";

/** The stand-in league id used until Kickoff has its own account on X Layer. */
export const PREVIEW_LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
/** The most a request may carry, in bytes. Everything the website sends is far smaller. */
export const MAX_BODY = 64 * 1024;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/**
 * Work out which address was asked for. Some hosts pass every /api/... request to one function
 * and put the rest of the path in a "path" setting on the end of the address; both are understood.
 */
export function pathOf(requestUrl) {
  const url = new URL(requestUrl);
  const passed = url.searchParams.get("path");
  if ((url.pathname === "/api" || url.pathname === "/api/" || url.pathname === "/api/index") && passed !== null) {
    return `/api/${passed.replace(/^\/+/, "")}`;
  }
  return url.pathname;
}

/**
 * @param handle  from createHandler() in http.js
 * @param log     where an unexpected fault is noted (never shown to the person asking)
 */
export function createFetchHandler({ handle, log = console.error }) {
  return async function fetchHandler(request) {
    let body = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const declared = Number(request.headers.get("content-length") ?? 0);
      if (declared > MAX_BODY) return json(413, { error: "That request is too big." });
      const text = await request.text();
      if (text.length > MAX_BODY) return json(413, { error: "That request is too big." });
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          return json(400, { error: "The request could not be read." });
        }
      }
    }
    const answer = await handle({ method: request.method, path: pathOf(request.url), headers: Object.fromEntries(request.headers), body });
    if (answer.cause) log(answer.cause);
    return json(answer.status, answer.body);
  };
}

/**
 * Build the whole server from a host's settings.
 * If no database is set, every address answers that it is not connected, instead of pretending
 * to keep things it would forget.
 */
export function fromEnv(env, { fetch = globalThis.fetch, log = console.error } = {}) {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return async () => json(503, { error: "Kickoff's database is not connected yet." });
  const store = new RedisStore({ url, token, fetch });
  const kickoff = createKickoff({ store, league: env.KICKOFF_LEAGUE ?? PREVIEW_LEAGUE });
  const handle = createHandler({ kickoff, now: () => Math.floor(Date.now() / 1000), adminKey: env.KICKOFF_ADMIN_KEY || null });
  return createFetchHandler({ handle, log });
}
