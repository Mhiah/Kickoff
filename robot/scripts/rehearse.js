#!/usr/bin/env node
// A rehearsal of the robot on a PRIVATE COPY of X Layer. Nothing here can reach the real network:
// it only runs against a test node that lets a script hand out test money, which no real node does.
//
// Everything real is used except the money and the clock:
//   - TapeOut's real mailbox and site store, on the copy
//   - Kickoff's real server code, the robot's real rules (chain.js) and real hands (xlayer.js)
//   - phones that seal, enter and open picks exactly as the website does
//
//   1. The robot's wallet becomes a league: it publishes one small circuit and opens its account.
//   2. Three matches go on Kickoff's list. Three phones enter sealed picks for two of them.
//   3. A few seconds after picks close, the robot announces and locks each match that has picks.
//   4. CHEAT: after kickoff, a changed bundle is locked with the league's own key.
//   5. The phones open their picks (one never does), the results come in, and the robot records
//      the results and publishes the opened picks.
//   5b. A CROWD: a hundred more phones pick a fourth match and are never seen again. Each sent a
//      locked copy of its pick with its fingerprint. Once the match starts the robot unlocks all
//      hundred itself. They are far too many for one piece of the league's site, so the robot
//      publishes the file in pieces.
//   6. A second robot starts with no memory. It must write nothing.
//   7. Everything is thrown away except the league's id. The table is rebuilt from the copy of
//      X Layer alone. It has to come out as ada 6, bola 2, chidi 0, with all hundred of the crowd
//      scored, and players level on points in the order they joined.
//
// Usage:
//   node robot/scripts/rehearse.js --node http://127.0.0.1:8545 [--cast-key <a throwaway key>]
//
// With --cast-key the robot signs with Foundry's `cast`, as it will for real. Without it, the test
// node is asked to send from a made-up account.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  BASKETBALL, FOOTBALL, XLAYER, basketballResult, buildBundle, connect, encodePick, fetchLeague, lockMessage, matchId, newDeviceKey, playerIdOf, sealPick,
  sealEnvelope, signRequest, tableFromXLayer, toHex, fromHex, loadCircuits, openingsPath,
} from "../../engine/src/index.js";
import { createHandler } from "../../server/src/http.js";
import { createKickoff } from "../../server/src/kickoff.js";
import { MemoryStore } from "../../server/src/store.js";
import { CLOSES_BEFORE, chainTick, lockTime, newMemory } from "../src/chain.js";
import { createOpener, envelopeKeysFrom } from "../src/envelope.js";
import { PIECE, ask, becomeALeague, castSender, createChain, nodeSender } from "../src/xlayer.js";

const DEFAULTS = {
  node: "http://127.0.0.1:8545",
  processor: "0x39e44dba62811e87fde122ca4d6c082568a384d0", // an existing TapeOut processor, somebody else's
  opener: "0x536add8f30f03b69f6fbf29d425a816a0dc50106",
  mailbox: XLAYER.mailbox,
  sites: XLAYER.sites,
};
const set = { ...DEFAULTS };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) set[argv[i].replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];

const lines = [];
const say = (line = "") => (lines.push(line), console.log(line));
const quantity = (n) => `0x${BigInt(n).toString(16)}`;
const HOUR = 3600;
const OKB = 10n ** 18n;
const rpc = connect(set.node);

async function control(name, params) {
  let last;
  for (const prefix of ["anvil_", "hardhat_"]) {
    try {
      return await rpc(prefix + name, params);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

// ------------------------------------------------------------------ the wallet, and the clock

const clock = { now: Number(BigInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp)) + 60 };
let plain;
let who;
try {
  if (set.castKey) {
    plain = await castSender({ node: set.node, key: set.castKey });
    who = plain.address;
  } else {
    who = `0x${createHash("sha256").update("kickoff robot rehearsal").digest("hex").slice(0, 40)}`;
    await control("impersonateAccount", [who]);
    plain = nodeSender({ node: set.node, from: who });
  }
  await control("setBalance", [who, quantity(10n * OKB)]);
} catch (error) {
  console.error(`This node is not a test copy, so the rehearsal will not run against it (${error.message}).`);
  process.exit(2);
}
// The rehearsal keeps its own clock and tells the copy what time to stamp on each block, so the
// times on chain are exactly the ones the server sees.
let stamped = 0;
const sender = {
  address: plain.address,
  async transact(tx) {
    stamped = Math.max(stamped + 1, clock.now);
    await rpc("evm_setNextBlockTimestamp", [quantity(stamped)]);
    return plain.transact(tx);
  },
};
const balance = async () => BigInt(await rpc("eth_getBalance", [who, "latest"]));
const okb = (wei) => `${(Number(wei / 10n ** 12n) / 1e6).toFixed(6)} OKB`;

say("A REHEARSAL OF KICKOFF'S ROBOT ON A PRIVATE COPY OF X LAYER. Nothing is sent to the real network.");
say(`chain ${Number(BigInt(await rpc("eth_chainId", [])))}. The robot signs ${set.castKey ? "with a throwaway key, using cast, as it will for real" : "through the test node"}.`);
say();

// ------------------------------------------------------------------ 1. become a league

const before = await balance();
const made = await becomeALeague({ node: set.node, sender, processor: set.processor, opener: set.opener, mailbox: set.mailbox });
const afterSetup = await balance();
const LEAGUE = made.league;
say(` 1. the robot's wallet became a league: circuit ${made.circuit} of processor ${set.processor}`);
say(`    its account is ${made.account}`);
say(`    its id is 0x${LEAGUE}`);
say(`    becoming a league cost ${okb(before - afterSetup)}`);

// ------------------------------------------------------------------ 2. Kickoff's server, the matches, the phones

const ADMIN = randomBytes(24).toString("hex");
const kickoff = createKickoff({ store: new MemoryStore(), league: LEAGUE });
const handle = createHandler({ kickoff, now: () => clock.now, adminKey: ADMIN });
const start = clock.now;
const facts = {
  football: { comp: "pl", sport: FOOTBALL, home: "Arsenal", away: "Chelsea", kickoff: start + 2 * HOUR, label: "Premier League: Arsenal v Chelsea" },
  basketball: { comp: "nba", sport: BASKETBALL, home: "Knicks", away: "Bucks", kickoff: start + 3 * HOUR, label: "NBA: Knicks v Bucks" },
  nobody: { comp: "cl", sport: FOOTBALL, home: "Inter", away: "Barcelona", kickoff: start + 2 * HOUR, label: "Champions League: Inter v Barcelona" },
  crowd: { comp: "wnba", sport: BASKETBALL, home: "Liberty", away: "Aces", kickoff: start + 6 * HOUR, label: "WNBA: Liberty v Aces" },
};
const f = {};
for (const [name, x] of Object.entries(facts)) f[name] = { id: toHex(await matchId(LEAGUE, { sport: x.sport, kickoff: x.kickoff, bestOf: 0, label: x.label })), feedId: `rehearsal:${name}`, state: "scheduled", ...x };
const admin = (path, body) => handle({ method: "POST", path, headers: { "x-kickoff-admin": ADMIN }, body });
await admin("/api/admin/fixtures", { fixtures: Object.values(f) });

const PICKS = {
  football: { ada: { home: 2, away: 1 }, bola: { home: 1, away: 0 }, chidi: { home: 0, away: 3 } },
  basketball: { ada: { winner: "home", band: "A" }, bola: { winner: "home", band: "B" }, chidi: { winner: "away", band: "B" } },
};
const RESULTS = { football: { home: 2, away: 1 }, basketball: basketballResult({ home: 104, away: 101 }), crowd: basketballResult({ home: 104, away: 101 }) };
// The crowd's picks, turn and turn about: 3 points, 1 point, none.
const CROWD = 100;
const CROWD_PICKS = [{ winner: "home", band: "A" }, { winner: "home", band: "B" }, { winner: "away", band: "B" }];
const CROWD_POINTS = [3, 1, 0];
// The robot's key for unlocking picks after kickoff. In real use it comes from the wallet's key.
const UNLOCKING = "c0".repeat(32);
const opener = createOpener(UNLOCKING);
const phones = {};
for (const name of ["ada", "bola", "chidi"]) {
  const key = await newDeviceKey();
  phones[name] = { key, id: toHex(await playerIdOf(key.publicKey)), sealed: {} };
}
const post = async (phone, path, payload) => handle({ method: "POST", path, headers: {}, body: await signRequest({ ...phone.key, method: "POST", path, payload, at: clock.now }) });
clock.now = start + 600;
for (const which of ["football", "basketball"]) {
  for (const [name, pick] of Object.entries(PICKS[which])) {
    const phone = phones[name];
    phone.sealed[which] = await sealPick({ league: LEAGUE, match: f[which].id, sport: f[which].sport, pick, player: phone.id });
    const answer = await post(phone, "/api/picks", { match: f[which].id, fingerprint: toHex(phone.sealed[which].fingerprint) });
    if (answer.status !== 200) throw new Error(`a sealed pick was refused: ${answer.body.error}`);
  }
}
const crowd = [];
for (let i = 0; i < CROWD; i++) {
  clock.now = start + 700 + i; // each joins Kickoff a second after the one before
  const key = await newDeviceKey();
  const phone = { key, id: toHex(await playerIdOf(key.publicKey)) };
  phone.sealed = await sealPick({ league: LEAGUE, match: f.crowd.id, sport: BASKETBALL, pick: CROWD_PICKS[i % 3], player: phone.id });
  // As the website does: the fingerprint, and a copy of the pick locked to the robot's key.
  const envelope = await sealEnvelope({ to: envelopeKeysFrom(UNLOCKING).publicKey, league: LEAGUE, match: f.crowd.id, player: phone.id, fingerprint: phone.sealed.fingerprint, pickByte: phone.sealed.pickByte, salt: phone.sealed.salt });
  const answer = await post(phone, "/api/picks", { match: f.crowd.id, fingerprint: toHex(phone.sealed.fingerprint), envelope });
  if (answer.status !== 200) throw new Error(`a sealed pick from the crowd was refused: ${answer.body.error}`);
  crowd.push(phone);
}
say(` 2. four matches are on Kickoff's list. Ada, Bola and Chidi entered sealed picks for two of them, and a crowd of ${CROWD} for a third.`);

// ------------------------------------------------------------------ the robot

const server = {
  bundle: async (match) => {
    const answer = await admin(`/api/admin/freeze/${match}`);
    if (answer.status !== 200) throw new Error(answer.body.error);
    return answer.body;
  },
  openings: async (match) => {
    const answer = await handle({ method: "GET", path: `/api/matches/${match}/openings`, headers: {}, body: null });
    return answer.status === 200 ? JSON.stringify(answer.body) : null;
  },
  envelopes: async (match) => {
    const answer = await handle({ method: "GET", path: `/api/admin/envelopes/${match}`, headers: { "x-kickoff-admin": ADMIN }, body: null });
    if (answer.status !== 200) throw new Error(answer.body.error);
    return answer.body.envelopes;
  },
  open: async (match, openings) => {
    const answer = await admin("/api/admin/opened", { match, openings });
    if (answer.status !== 200) throw new Error(answer.body.error);
    return answer.body;
  },
  report: async (locks) => {
    const answer = await admin("/api/admin/locks", { locks });
    if (answer.status !== 200) throw new Error(answer.body.error);
    return answer.body;
  },
};
const chain = createChain({ node: set.node, league: LEAGUE, processor: set.processor, circuit: made.circuit, sender, mailbox: set.mailbox, sites: set.sites });
let memory = newMemory();
const tick = async () => {
  memory.lookedAt.clear();
  const out = await chainTick({ now: clock.now, league: LEAGUE, fixtures: await kickoff.fixtures(), server, chain, memory, opener });
  for (const line of out.did) say(`      robot: ${line}`);
  for (const line of out.problems) say(`      robot, PROBLEM: ${line}`);
  return out;
};

const done = [];
clock.now = lockTime(f.football) - 60;
done.push((await tick()).did.length === 0);
say(` 3. while picks are open, the robot writes nothing`);

clock.now = lockTime(f.football);
say(`    five seconds after picks close for the football:`);
const lockedFootball = await tick();
clock.now = lockTime(f.basketball);
say(`    and for the basketball:`);
const lockedBasketball = await tick();
const afterLocks = await balance();
say(`    announcing and locking two matches cost ${okb(afterSetup - afterLocks)}`);

// ------------------------------------------------------------------ 4. the cheat

clock.now = f.football.kickoff + 2 * HOUR;
const forged = await sealPick({ league: LEAGUE, match: f.football.id, sport: FOOTBALL, pick: RESULTS.football, player: phones.chidi.id });
const honest = await server.bundle(f.football.id);
const changed = await buildBundle({
  league: LEAGUE,
  match: f.football.id,
  entries: honest.entries.map((e) => (e.player === phones.chidi.id ? { player: e.player, fingerprint: toHex(forged.fingerprint) } : e)),
});
await chain.send(await lockMessage(changed));
say(` 4. CHEAT: two hours after kickoff, the league's own key locked a changed bundle, with Chidi's 0-3 swapped for the real score`);

// ------------------------------------------------------------------ 5. opening, results, publishing

const open = async (name, which, sealed = phones[name].sealed[which]) =>
  post(phones[name], "/api/opened", { match: f[which].id, pickByte: sealed.pickByte, salt: toHex(sealed.salt) });
for (const name of ["ada", "bola"]) await open(name, "football");
const chidiCheats = await open("chidi", "football", forged);
say(` 5. Ada and Bola opened their football picks. Chidi tried to open the swapped one, and the server ${chidiCheats.status === 200 ? "ACCEPTED it" : "refused"}.`);
await admin("/api/admin/fixtures", { fixtures: [{ ...f.football, state: "final", score: "2 – 1", resultByte: encodePick(FOOTBALL, RESULTS.football) }] });
say(`    the feed says Arsenal 2 – 1 Chelsea:`);
const afterFootball = await tick();

clock.now = f.basketball.kickoff + 2 * HOUR;
for (const name of ["ada", "bola", "chidi"]) await open(name, "basketball");
await admin("/api/admin/fixtures", { fixtures: [{ ...f.basketball, state: "final", score: "104 – 101", resultByte: encodePick(BASKETBALL, RESULTS.basketball) }] });
say(`    all three opened their basketball picks, and the feed says Knicks 104 – 101 Bucks:`);
const afterBasketball = await tick();
const afterTwo = await balance();
say(`    recording two results and publishing two files cost ${okb(afterLocks - afterTwo)}`);

// ------------------------------------------------------------------ 5b. the crowd

say(` 5b. the crowd of ${CROWD}. None of their phones is ever seen again after sealing.`);
clock.now = lockTime(f.crowd);
say(`    five seconds after picks close for their match:`);
const lockedCrowd = await tick();
// Before kickoff the locked copies are handed to nobody, the robot included.
clock.now = f.crowd.kickoff - 1;
const tooEarly = await handle({ method: "GET", path: `/api/admin/envelopes/${f.crowd.id}`, headers: { "x-kickoff-admin": ADMIN }, body: null });
clock.now = f.crowd.kickoff + 60;
say(`    a minute after kickoff, with no phone doing anything:`);
const afterCrowd = await tick();
const crowdFile = await server.openings(f.crowd.id);
const crowdBytes = new TextEncoder().encode(crowdFile).length;
say(`    the file of their opened picks is ${crowdBytes.toLocaleString("en-GB")} bytes, and one piece of the site takes ${PIECE.toLocaleString("en-GB")}`);
clock.now = f.crowd.kickoff + 2 * HOUR;
await admin("/api/admin/fixtures", { fixtures: [{ ...f.crowd, state: "final", score: "104 – 101", resultByte: encodePick(BASKETBALL, RESULTS.crowd) }] });
say(`    the match ends:`);
const endedCrowd = await tick();
const afterAll = await balance();
const crowdOnChain = await ask(rpc, set.sites, "fileInfo(address,string)", [made.account, openingsPath(fromHex(f.crowd.id))], ["uint256", "string", "bytes32", "uint256", "uint256"]);
say(`    on the copy of X Layer the file is ${Number(crowdOnChain[0]).toLocaleString("en-GB")} bytes in ${crowdOnChain[4]} pieces`);
say(`    locking that match, publishing that file and recording its result cost ${okb(afterTwo - afterAll)}`);

// ------------------------------------------------------------------ 6. a second robot, with no memory

const countBefore = (await fetchLeague({ node: set.node, mailbox: set.mailbox, league: fromHex(LEAGUE) })).messages.length;
memory = newMemory();
clock.now += 600;
const second = await tick();
const countAfter = (await fetchLeague({ node: set.node, mailbox: set.mailbox, league: fromHex(LEAGUE) })).messages.length;
say(` 6. a second robot started with no memory and wrote ${countAfter - countBefore} messages (${countAfter} are in the league's inbox)`);

// ------------------------------------------------------------------ 7. read it all back from the chain alone

const circuit = (name) => readFileSync(new URL(`../../circuits/out/${name}.hex`, import.meta.url), "utf8");
const circuits = loadCircuits({ football: circuit("football"), basketball: circuit("basketball"), tennis: circuit("tennis") });
const read = await tableFromXLayer({ node: set.node, mailbox: set.mailbox, sites: set.sites, league: fromHex(LEAGUE), circuits });
const names = Object.fromEntries(Object.entries(phones).map(([name, p]) => [p.id, name]));
const points = Object.fromEntries(read.table.filter((row) => names[toHex(row.player)]).map((row) => [names[toHex(row.player)], row.points]));
say(` 7. the league was fetched back from the copy of X Layer, and the table rebuilt from that alone:`);
for (const [name, p] of Object.entries(points)) say(`      ${name.padEnd(6)} ${p}`);
const crowdIndex = new Map(crowd.map((p, i) => [p.id, i]));
const crowdRows = read.table.filter((row) => crowdIndex.has(toHex(row.player)));
const crowdScored = crowdRows.filter((row) => row.points === CROWD_POINTS[crowdIndex.get(toHex(row.player)) % 3]).length;
// Among the crowd: most points first, and between players level on points, whoever joined first.
const crowdOrder = crowdRows.map((row) => crowdIndex.get(toHex(row.player)));
const crowdExpected = crowd.map((_, i) => i).sort((a, b) => CROWD_POINTS[b % 3] - CROWD_POINTS[a % 3] || a - b);
say(`      and ${crowdScored} of the crowd of ${CROWD} with the points their picks earned`);
// Kickoff's own server: it was told how each lock went, and gives points only for locked matches.
const toldLocks = Object.fromEntries((await kickoff.fixtures()).map((x) => [x.label, x.lock ?? "nothing"]));
const onKickoff = {};
for (const name of ["ada", "bola", "chidi"]) onKickoff[name] = (await post(phones[name], "/api/me/table", { group: null })).body.you.points;
say(`    Kickoff's own server says: ${Object.entries(onKickoff).map(([name, p]) => `${name} ${p}`).join(", ")}`);
say(`    messages a reader did not believe: ${read.ignored.length}${read.ignored.length ? ` (${read.ignored.map((i) => i.why).join("; ")})` : ""}`);
say();

// ------------------------------------------------------------------ the checks

const checks = [
  ["the robot wrote nothing while picks were open", done[0]],
  ["the football was announced and locked before kickoff", lockedFootball.did.length === 2 && lockedFootball.problems.length === 0],
  ["the basketball was announced and locked before kickoff", lockedBasketball.did.length === 2 && lockedBasketball.problems.length === 0],
  [`the crowd's match was announced and locked before kickoff, with ${CROWD} sealed picks`, lockedCrowd.did.length === 2 && lockedCrowd.problems.length === 0 && lockedCrowd.did[1].includes(`locked ${CROWD} sealed picks`)],
  ["the match nobody picked was never written to X Layer", read.matches.every((m) => m.label !== facts.nobody.label)],
  ["the server refused Chidi's swapped pick", chidiCheats.status === 409],
  ["the football result and its opened picks were written", afterFootball.did.length === 2 && afterFootball.problems.length === 0],
  ["the basketball result and its opened picks were written", afterBasketball.did.length === 2 && afterBasketball.problems.length === 0],
  ["before kickoff the locked copies were handed to nobody, not even the robot", tooEarly.status === 409],
  [`after kickoff the robot opened all ${CROWD} picks itself, though no phone came back`, afterCrowd.problems.length === 0 && afterCrowd.did[0]?.endsWith(`opened ${CROWD} sealed picks`)],
  [`their file is too big for one piece (${crowdBytes.toLocaleString("en-GB")} bytes), and the robot published it in ${Math.ceil(crowdBytes / PIECE)} pieces`, crowdBytes > PIECE && afterCrowd.did.length === 2 && afterCrowd.did[1].endsWith(`published ${CROWD} opened picks, in ${Math.ceil(crowdBytes / PIECE)} pieces`)],
  ["the crowd's result was recorded when the match ended, and nothing else needed doing", endedCrowd.problems.length === 0 && endedCrowd.did.length === 1 && endedCrowd.did[0].includes("result recorded")],
  ["on X Layer that file is whole: every byte, in that many pieces", Number(crowdOnChain[0]) === crowdBytes && Number(crowdOnChain[4]) === Math.ceil(crowdBytes / PIECE)],
  ["a second robot with no memory wrote nothing", second.did.length === 0 && second.problems.length === 0 && countAfter === countBefore],
  ["the lock in force for the football is the one made before kickoff, not the changed one", (() => { const m = read.matches.find((x) => x.label === facts.football.label); return m && toHex(m.lock.root) === honest.root && m.locks.length === 2; })()],
  ["the table read back from X Layer is ada 6, bola 2, chidi 0", JSON.stringify(points) === JSON.stringify({ ada: 6, bola: 2, chidi: 0 })],
  [`all ${CROWD} of the crowd are on that table, each with the points their pick earned`, crowdRows.length === CROWD && crowdScored === CROWD],
  ["Kickoff's server was told the three matches with picks were locked, and nothing about the match nobody picked", toldLocks[facts.football.label] === "locked" && toldLocks[facts.basketball.label] === "locked" && toldLocks[facts.crowd.label] === "locked" && toldLocks[facts.nobody.label] === "nothing"],
  ["Kickoff's own points are the same as the ones rebuilt from X Layer", JSON.stringify(onKickoff) === JSON.stringify(points)],
  ["nobody on that table shares a place", read.table.every((row, i) => row.position === i + 1)],
  ["players level on points are in the order they joined Kickoff", JSON.stringify(crowdOrder) === JSON.stringify(crowdExpected)],
  ["the whole run cost less than 0.2 OKB", before - afterAll < OKB / 5n],
];
let failed = 0;
for (const [what, ok] of checks) {
  say(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failed++;
}
say();
say(`${checks.length - failed} of ${checks.length} checks passed. In all the robot's wallet spent ${okb(before - afterAll)} of test money.`);
if (set.summary) writeFileSync(set.summary, `${lines.join("\n")}\n`);
process.exit(failed ? 1 : 0);
