#!/usr/bin/env node
// Kickoff's server on your own computer, for trying things out. Everything is kept in memory and
// is gone when it stops. It also serves the website from ../web, so the two can be tried together.
//
//   node server/bin/dev.js            then open http://localhost:8787
//
// The league id is a stand-in, and the robot's key is "dev".

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { createHandler } from "../src/http.js";
import { createKickoff } from "../src/kickoff.js";
import { MemoryStore } from "../src/store.js";

const PORT = Number(process.env.PORT ?? 8787);
const LEAGUE = process.env.KICKOFF_LEAGUE ?? "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
const WEB = fileURLToPath(new URL("../../web/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

const handle = createHandler({ kickoff: createKickoff({ store: new MemoryStore(), league: LEAGUE }), now: () => Math.floor(Date.now() / 1000), adminKey: process.env.KICKOFF_ADMIN_KEY ?? "dev" });

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
    const file = await readFile(wanted);
    response.writeHead(200, { "content-type": TYPES[extname(wanted)] ?? "application/octet-stream" });
    response.end(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}).listen(PORT, () => console.log(`Kickoff is at http://localhost:${PORT} (kept in memory; gone when this stops)`));
