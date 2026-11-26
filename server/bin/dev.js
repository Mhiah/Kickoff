#!/usr/bin/env node
// Kickoff's server on your own computer, for trying things out. Everything is kept in memory and
// is gone when it stops. It also serves the website from ../web, so the two can be tried together.
//
//   node server/bin/dev.js            then open http://localhost:8787
//   node server/bin/dev.js --matches  the same, with a few made-up matches on the list, so sending
//                                     a sealed pick can be tried. The first closes in a few minutes.
//
// The league id is a stand-in, and the robot's key is "dev". This server signs for the predictions
// it takes with a key of its own, made here from a made-up secret, and hands the website that
// key in place of the real server's, so the two agree.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { BASKETBALL, FOOTBALL, FOOTBALL_MARKETS, matchId, toHex } from "../../engine/src/index.js";
import { createHandler } from "../src/http.js";
import { createKickoff } from "../src/kickoff.js";
import { createSigner } from "../src/signing.js";
import { MemoryStore } from "../src/store.js";

const PORT = Number(process.env.PORT ?? 8787);
const LEAGUE = process.env.KICKOFF_LEAGUE ?? "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
const WEB = fileURLToPath(new URL("../../web/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

const signer = createSigner("a made-up secret for trying things out, not a real one");
const kickoff = createKickoff({ store: new MemoryStore(), league: LEAGUE, signer });
const handle = createHandler({ kickoff, now: () => Math.floor(Date.now() / 1000), adminKey: process.env.KICKOFF_ADMIN_KEY ?? "dev" });

if (process.argv.includes("--matches")) {
  const now = Math.floor(Date.now() / 1000);
  const minutes = Number(process.env.FIRST_CLOSES_IN ?? 5);
  const made = [
    ["pl", FOOTBALL, "Premier League", "Arsenal", "Chelsea", now + (minutes + 10) * 60],
    ["cl", FOOTBALL, "Champions League", "Real Madrid", "Bayern", now + 26 * 3600],
    ["nba", BASKETBALL, "NBA", "Knicks", "Bucks", now + 30 * 3600],
    ["nba", BASKETBALL, "NBA", "Warriors", "Nuggets", now + 54 * 3600],
  ];
  const fixtures = [];
  for (const [comp, sport, competition, home, away, kickoffAt] of made) {
    const label = `${competition}: ${home} v ${away}`;
    // A football match goes on the list as its three predictions: result, goal goal, exact score.
    for (const kind of sport === FOOTBALL ? FOOTBALL_MARKETS : [sport]) {
      fixtures.push({ id: toHex(await matchId(LEAGUE, { sport: kind, kickoff: kickoffAt, bestOf: 0, label })), feedId: `dev:${home}:${kind}`, comp, sport: kind, kickoff: kickoffAt, label, home, away, state: "scheduled" });
    }
  }
  await kickoff.putFixtures({ fixtures });
  console.log(`${fixtures.length} made-up matches are on the list. Picks for the first close in ${minutes} minutes.`);
}

async function readBody(request, limit = 200_000) {
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > limit) throw new Error("too big");
    parts.push(part);
  }
  if (parts.length === 0) return null;
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    let answer;
    try {
      answer = await handle({ method: request.method, path: url.pathname, headers: request.headers, body: await readBody(request) });
    } catch {
      answer = { status: 400, body: { error: "The request could not be read." } };
    }
    if (answer.cause) console.error(answer.cause);
    response.writeHead(answer.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(answer.body));
    return;
  }
  // The website's own files.
  const wanted = normalize(join(WEB, url.pathname === "/" ? "index.html" : url.pathname));
  if (!wanted.startsWith(WEB)) {
    response.writeHead(403).end();
    return;
  }
  try {
    let file = await readFile(wanted);
    // The website checks signed notes against the real server's key. Here it is given this one's.
    if (wanted === join(WEB, "config.js")) file = file.toString("utf8").replace(/^export const SERVER_KEY = .*;$/m, `export const SERVER_KEY = "${signer.publicKey}";`);
    response.writeHead(200, { "content-type": TYPES[extname(wanted)] ?? "application/octet-stream" });
    response.end(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}).listen(PORT, () => console.log(`Kickoff is at http://localhost:${PORT} (kept in memory; gone when this stops)`));
