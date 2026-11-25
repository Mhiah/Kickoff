// Putting the website on X Layer, checked with a stand-in for TapeOut's site store that keeps its
// rules: 24,000 bytes a piece, pieces in order, one fingerprint for the whole file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { MONTHS, NAME_FEE_LIMIT, checkSite, lookAtSite, publishSite, siteAddress, siteFiles, siteInWords, siteName } from "../src/site.js";
import { PIECE } from "../src/xlayer.js";

const WEB = fileURLToPath(new URL("../../web/", import.meta.url));
const SERVER = "https://kickoff-two-xi.vercel.app";
const WALLET = "0x37ffd5b3e27dd5ce04945559def00b66d5841fc1";
const ACCOUNT = "0x24ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (words) => new TextEncoder().encode(words);
const noWait = async () => {};

/** A small site: a page, a script too big for one piece, and a stylesheet. */
const site = () => [
  { path: "app.js", contentType: "text/javascript; charset=utf-8", bytes: new Uint8Array(2 * PIECE + 500).fill(47) },
  { path: "index.html", contentType: "text/html; charset=utf-8", bytes: text("<!doctype html><title>Kickoff</title>") },
  { path: "styles.css", contentType: "text/css; charset=utf-8", bytes: text("body{font-family:Georgia}") },
];

function standIn({ wallet = WALLET, holder = WALLET, monthlyFee = 0n, balance = 10n ** 17n, numberOk = true } = {}) {
  const kept = new Map();
  const chain = {
    kept, sent: [], paid: 0n, fallback: "", live: false, failNext: 0,
    async facts() {
      return {
        chainId: 196, name: siteName({ circuit: 5, number: 409 }), address: siteAddress({ circuit: 5, number: 409 }), account: ACCOUNT,
        wallet, holder, numberOk, fallback: chain.fallback, monthlyFee, live: chain.live, gasPrice: 20_000_000n, balance: balance - chain.paid - BigInt(chain.sent.length) * 1000n,
      };
    },
    async fileInfo(path) {
      const f = kept.get(path);
      return f ? { size: f.pieces.reduce((sum, p) => sum + p.length, 0), contentType: f.contentType, sha: f.sha, pieces: f.pieces.length } : null;
    },
    async readFile(path) {
      const f = kept.get(path);
      if (!f) return null;
      const whole = Buffer.concat(f.pieces);
      if (sha(whole) !== f.sha) throw new Error("the file is half uploaded or damaged");
      return new Uint8Array(whole);
    },
    async transact({ to, signature, values, value = 0n }) {
      if (chain.failNext > 0) {
        chain.failNext--;
        throw new Error("the node did not answer");
      }
      const what = signature.split("(")[0];
      chain.sent.push(what === "putFile" || what === "appendChunk" ? `${what} ${values[1]}` : what);
      if (what === "putFile") {
        assert.ok(values[4].length <= PIECE);
        kept.set(values[1], { contentType: values[2], sha: Buffer.from(values[3]).toString("hex"), pieces: [Uint8Array.from(values[4])] });
      } else if (what === "appendChunk") {
        const f = kept.get(values[1]);
        assert.equal(Number(values[2]), f.pieces.length, "pieces go in order");
        f.pieces.push(Uint8Array.from(values[3]));
      } else if (what === "setFallback") {
        assert.equal(values[0], ACCOUNT);
        chain.fallback = values[1];
      } else if (what === "bind") {
        assert.equal(to, "names");
        assert.deepEqual(values, [siteName({ circuit: 5, number: 409 }), ACCOUNT, BigInt(MONTHS)]);
        assert.equal(value, monthlyFee * BigInt(MONTHS), "the name's fee is sent with it");
        chain.paid += value;
        chain.live = true;
      } else assert.fail(`nothing takes ${signature}`);
    },
  };
  return chain;
}

test("the site's name is the circuit, X Layer's area code and the processor's number", () => {
  assert.equal(siteName({ circuit: 5, number: 409 }), "5.2.409.tape");
  assert.equal(siteAddress({ circuit: 5, number: 409 }), "https://5-2-409.tapekit.org/");
});

test("the files that go on chain are the website's own, with the server's address written in", () => {
  const files = siteFiles({ dir: WEB, server: SERVER });
  const paths = files.map((f) => f.path);
  for (const needed of ["index.html", "app.js", "screens.js", "styles.css", "config.js", "theme.js", "favicon.svg", "lib/server.js", "engine/xlayer.js", "fonts/gelasio-latin-400-normal.woff2"]) {
    assert.ok(paths.includes(needed), `${needed} is part of the site`);
  }
  assert.deepEqual(paths, [...paths].sort(), "in a fixed order");
  assert.ok(!paths.some((p) => p.startsWith("test/") || p.startsWith("scripts/") || p.endsWith("README.md")), "tests, scripts and notes are not");
  const of = (path) => files.find((f) => f.path === path);
  assert.equal(of("index.html").contentType, "text/html; charset=utf-8");
  assert.equal(of("app.js").contentType, "text/javascript; charset=utf-8");
  assert.equal(of("styles.css").contentType, "text/css; charset=utf-8");
  assert.equal(of("favicon.svg").contentType, "image/svg+xml");
  assert.equal(of("fonts/gelasio-latin-400-normal.woff2").contentType, "font/woff2");
  // Every file is byte for byte the website's, except the one line of config.js.
  for (const f of files) {
    if (f.path !== "config.js") assert.equal(sha(f.bytes), sha(readFileSync(join(WEB, f.path))), f.path);
  }
  const config = new TextDecoder().decode(of("config.js").bytes);
  assert.ok(config.includes(`export const SERVER = "${SERVER}";`));
  assert.equal(config.replace(`export const SERVER = "${SERVER}";`, 'export const SERVER = "";'), readFileSync(join(WEB, "config.js"), "utf8"));
  // The page refers to nothing off the site, which is what lets a gateway show it.
  assert.ok(!/(src|href)="(https?:)?\/\//.test(new TextDecoder().decode(of("index.html").bytes)));
});

test("a site that could not work on chain is not published", () => {
  for (const bad of ["", "kickoff-two-xi.vercel.app", "http://kickoff-two-xi.vercel.app", `${SERVER}/`, `${SERVER}/api`]) {
    assert.throws(() => siteFiles({ dir: WEB, server: bad }), /server's address/);
  }
  const folder = (make) => {
    const dir = mkdtempSync(join(tmpdir(), "kickoff-site-"));
    make(dir);
    return dir;
  };
  const config = 'export const SERVER = "";\n';
  assert.throws(() => siteFiles({ dir: folder((d) => writeFileSync(join(d, "config.js"), config)), server: SERVER }), /no index\.html/);
  assert.throws(() => siteFiles({ dir: folder((d) => (writeFileSync(join(d, "index.html"), "x"), writeFileSync(join(d, "config.js"), "export const SERVER = 'x';"))), server: SERVER }), /where the server is/);
  assert.throws(() => siteFiles({ dir: folder((d) => (writeFileSync(join(d, "index.html"), "x"), writeFileSync(join(d, "film.mov"), "x"))), server: SERVER }), /what kind of file/);
  assert.throws(() => siteFiles({ dir: folder((d) => (writeFileSync(join(d, "index.html"), "x"), writeFileSync(join(d, "sw.js"), "x"))), server: SERVER }), /kept for something else/);
  assert.throws(() => siteFiles({ dir: folder((d) => (writeFileSync(join(d, "index.html"), "x"), mkdirSync(join(d, "openings")), writeFileSync(join(d, "openings", "a.json"), "{}"))), server: SERVER }), /kept for something else/);
  // Hidden files and the folders left out are simply not there.
  const fine = siteFiles({ dir: folder((d) => (writeFileSync(join(d, "index.html"), "x"), writeFileSync(join(d, ".env"), "x"), mkdirSync(join(d, "test")), writeFileSync(join(d, "test", "a.js"), "x"))), server: SERVER });
  assert.deepEqual(fine.map((f) => f.path), ["index.html"]);
});

test("the first time, everything is sent: the page last, then the fallback, then the name. The second time, nothing", async () => {
  const chain = standIn();
  const files = site();
  const look = await lookAtSite({ files, chain });
  assert.deepEqual(look.files.map((f) => `${f.path} ${f.state} ${f.pieces}`), ["app.js new 3", "index.html new 1", "styles.css new 1"]);
  assert.deepEqual([look.fallback, look.bind, look.short, look.problems], [true, { fee: 0n }, 0n, []]);
  const words = siteInWords(look);
  assert.match(words, /5\.2\.409\.tape/);
  assert.match(words, /https:\/\/5-2-409\.tapekit\.org\//);
  assert.match(words, /about 7 transactions/);
  assert.match(words, /fee for that today: nothing/);
  assert.match(words, /The wallet holds enough\./);
  assert.deepEqual(chain.sent, [], "a look sends nothing");

  const said = [];
  const done = await publishSite({ files, chain, say: (line) => said.push(line), pause: noWait });
  assert.deepEqual(chain.sent, ["putFile app.js", "appendChunk app.js", "appendChunk app.js", "putFile styles.css", "putFile index.html", "setFallback", "bind"]);
  assert.deepEqual(said, ["app.js: sent in 3 pieces", "styles.css: sent", "index.html: sent", "The page to fall back to is index.html.", "The name 5.2.409.tape is switched on for 12 months."]);
  assert.equal(done.spent, 7000n);
  assert.match(siteInWords(done), /Nothing is left to do: the site on X Layer is these files\./);
  assert.deepEqual((await checkSite({ files, chain })).map((f) => f.ok), [true, true, true]);

  const again = await publishSite({ files, chain, pause: noWait });
  assert.deepEqual([again.did, again.spent], [[], 0n]);
  assert.equal(chain.sent.length, 7, "nothing more was sent");
});

test("after a change, only what changed is sent. A file only part there is sent again", async () => {
  const chain = standIn();
  const files = site();
  await publishSite({ files, chain, pause: noWait });
  chain.sent.length = 0;

  files[2] = { ...files[2], bytes: text("body{font-family:Georgia;color:#000}") };
  assert.deepEqual((await lookAtSite({ files, chain })).send.map((f) => `${f.path} ${f.state}`), ["styles.css changed"]);
  await publishSite({ files, chain, pause: noWait });
  assert.deepEqual(chain.sent, ["putFile styles.css"]);

  // The last piece of the script goes missing, as if the robot had been cut off.
  chain.kept.get("app.js").pieces.pop();
  assert.deepEqual((await checkSite({ files, chain })).filter((f) => !f.ok).map((f) => f.path), ["app.js"]);
  assert.deepEqual((await lookAtSite({ files, chain })).send.map((f) => `${f.path} ${f.state}`), ["app.js half"]);
  chain.sent.length = 0;
  await publishSite({ files, chain, pause: noWait });
  assert.deepEqual(chain.sent, ["putFile app.js", "appendChunk app.js", "appendChunk app.js"]);
  assert.deepEqual((await checkSite({ files, chain })).filter((f) => !f.ok), []);

  // The same words served as another kind of file is a change too.
  files[1] = { ...files[1], contentType: "text/plain; charset=utf-8" };
  assert.deepEqual((await lookAtSite({ files, chain })).send.map((f) => `${f.path} ${f.state}`), ["index.html changed"]);
});

test("a file that fails part way is started again from its first piece, and after three tries it stops and says so", async () => {
  const chain = standIn();
  const files = site();
  chain.failNext = 1; // the very first thing sent fails
  const done = await publishSite({ files, chain, pause: noWait });
  assert.equal(done.did.length, 5);
  assert.deepEqual((await checkSite({ files, chain })).filter((f) => !f.ok), []);

  const stuck = standIn();
  stuck.failNext = 3;
  await assert.rejects(publishSite({ files, chain: stuck, pause: noWait }), /app\.js could not be sent after three tries.*Run it again/);
  // Running it again picks up where it stopped.
  await publishSite({ files, chain: stuck, pause: noWait });
  assert.deepEqual((await checkSite({ files, chain: stuck })).filter((f) => !f.ok), []);
});

test("nothing is sent by the wrong wallet, by a wallet that is short, or under the wrong name", async () => {
  const files = site();
  const cases = [
    [standIn({ holder: "0x00000000000000000000000000000000000000aa" }), /does not hold the league's circuit, and only its holder may write to the league's site\. Nothing was sent/],
    [standIn({ balance: 1000n }), /the wallet is short by .* OKB\. Nothing was sent/],
    [standIn({ numberOk: false }), /the site's name would be wrong\. Nothing was sent/],
  ];
  for (const [chain, why] of cases) {
    await assert.rejects(publishSite({ files, chain, pause: noWait }), why);
    assert.deepEqual(chain.sent, []);
  }
  assert.match(siteInWords(await lookAtSite({ files, chain: cases[1][0] })), /THE WALLET IS SHORT BY/);
  assert.match(siteInWords(await lookAtSite({ files, chain: cases[0][0] })), /IT CANNOT BE DONE: this wallet does not hold the league's circuit/);
});

test("the name's fee is paid if it is small, and publishing stops if it has become dear", async () => {
  const files = site();
  const small = standIn({ monthlyFee: 10n ** 12n });
  assert.match(siteInWords(await lookAtSite({ files, chain: small })), /fee for that today: 0\.000012 OKB/);
  await publishSite({ files, chain: small, pause: noWait });
  assert.equal(small.paid, 12n * 10n ** 12n);

  const dear = standIn({ monthlyFee: NAME_FEE_LIMIT, balance: 10n ** 19n });
  await assert.rejects(publishSite({ files, chain: dear, pause: noWait }), /switching the name on now costs 0\.120000 OKB, which is more than was agreed\. Nothing was sent/);
  assert.deepEqual(dear.sent, []);
});

test("this is only done on X Layer", async () => {
  const chain = standIn();
  const facts = chain.facts;
  chain.facts = async () => ({ ...(await facts()), chainId: 1 });
  await assert.rejects(publishSite({ files: site(), chain, pause: noWait }), /this node is not X Layer/);
  assert.deepEqual(chain.sent, []);
});
