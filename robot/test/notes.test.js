// The notes the robot leaves for the person who runs Kickoff, checked against a stand-in for GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";

import { A_FULL_MATCH, LOW_WALLET, WALLET_TITLE, changedNote, createNotes, inOkb, matchesLeft, missedNote, noteChanged, noteMissed, walletNote, walletWatch } from "../src/notes.js";

const REPO = "Mhiah/Kickoff";
const WALLET = "0x37ffd5b3e27dd5ce04945559def00b66d5841fc1";

/** GitHub's issues, as far as the robot uses them. */
function github({ down = false } = {}) {
  const issues = [];
  const calls = [];
  const hub = {
    issues, calls, down,
    async fetch(url, { method, headers, body }) {
      calls.push(`${method} ${url.replace("https://api.github.com/repos/Mhiah/Kickoff", "")}`);
      assert.equal(headers.authorization, "Bearer the-token");
      if (hub.down) return new Response("{}", { status: 503 });
      const sent = body ? JSON.parse(body) : null;
      const path = url.replace("https://api.github.com/repos/Mhiah/Kickoff", "");
      if (method === "GET" && path.startsWith("/issues?state=all")) return Response.json([...issues].reverse().map((i) => ({ ...i })));
      if (method === "POST" && path === "/issues") {
        issues.push({ number: issues.length + 1, title: sent.title, body: sent.body, state: "open", comments: [] });
        return Response.json(issues.at(-1), { status: 201 });
      }
      const one = path.match(/^\/issues\/(\d+)(\/comments)?$/);
      if (one && method === "POST") return (issues[one[1] - 1].comments.push(sent.body), Response.json({}, { status: 201 }));
      if (one && method === "PATCH") return (Object.assign(issues[one[1] - 1], sent), Response.json(issues[one[1] - 1]));
      return new Response("{}", { status: 404 });
    },
  };
  return hub;
}
const notesOn = (hub) => createNotes({ repo: REPO, token: "the-token", fetch: hub.fetch });

test("how far a balance goes is counted in full matches", () => {
  assert.equal(inOkb(34_318_000_000_000_000n), "0.0343 OKB");
  assert.equal(matchesLeft(LOW_WALLET), Number(LOW_WALLET / A_FULL_MATCH));
  assert.equal(matchesLeft(LOW_WALLET), 27);
  assert.equal(matchesLeft(0n), 0);
});

test("the note about the wallet says how much is left, what it covers, and exactly where to send more", () => {
  const note = walletNote({ balance: 8_000_000_000_000_000n, wallet: WALLET, owner: "Mhiah" });
  assert.equal(note.title, WALLET_TITLE);
  assert.match(note.body, /^@Mhiah the robot's wallet on X Layer is down to \*\*0\.0080 OKB\*\*\./);
  assert.match(note.body, /about \*\*21 more matches\*\*/);
  assert.ok(note.body.includes(`\`${WALLET}\``));
  assert.match(note.body, /Send it from your own wallet yourself/);
  assert.ok(!/private key|seed|phrase/i.test(note.body), "it never asks for anything secret");
});

test("with no token, or no repository, there are no notes and nothing breaks", async () => {
  assert.equal(createNotes({ repo: REPO, token: "" }), null);
  assert.equal(createNotes({ repo: "", token: "x" }), null);
  const said = [];
  const look = walletWatch({ balance: async () => 1n, wallet: WALLET, notes: null, say: (line) => said.push(line) });
  assert.equal(await look(), "low");
  assert.equal(said.length, 1);
  assert.match(said[0], /^PROBLEM: the robot's wallet is down to/);
  assert.deepEqual(await noteMissed({ missed: [{ label: "A v B", kickoff: 1, count: 2 }], notes: null }), []);
});

test("a low wallet opens one note, however often it is looked at, and a top-up closes it", async () => {
  const hub = github();
  let balance = 30_000_000_000_000_000n;
  const said = [];
  const look = walletWatch({ balance: async () => balance, wallet: WALLET, notes: notesOn(hub), say: (line) => said.push(line) });

  assert.equal(await look(), "fine");
  assert.deepEqual([hub.issues.length, said], [0, []], "a healthy wallet says nothing");
  const quiet = hub.calls.length;
  await look();
  assert.equal(hub.calls.length, quiet, "and GitHub is not asked again while nothing changes");

  balance = 9_000_000_000_000_000n;
  assert.equal(await look(), "low");
  assert.equal(hub.issues.length, 1);
  assert.deepEqual([hub.issues[0].title, hub.issues[0].state], [WALLET_TITLE, "open"]);
  assert.match(hub.issues[0].body, /0\.0090 OKB/);
  assert.deepEqual(said, ["PROBLEM: the robot's wallet is down to 0.0090 OKB, enough for about 24 more full matches. It needs topping up.", "A note about the wallet was opened on GitHub."]);
  balance = 8_000_000_000_000_000n;
  await look();
  await look();
  assert.equal(hub.issues.length, 1, "still one note");
  assert.equal(said.length, 2, "and it is not said again every round");

  // A robot that starts afresh while the note is open does not open a second one.
  const fresh = walletWatch({ balance: async () => balance, wallet: WALLET, notes: notesOn(hub) });
  await fresh();
  assert.equal(hub.issues.length, 1);

  balance = 58_000_000_000_000_000n;
  assert.equal(await look(), "fine");
  assert.equal(hub.issues[0].state, "closed");
  assert.deepEqual(hub.issues[0].comments, ["The wallet holds 0.0580 OKB again, so the robot closed this note."]);
  assert.equal(said.at(-1), "The wallet holds 0.0580 OKB again. The note about it was closed.");

  // Low a second time is a new note.
  balance = 1n;
  await look();
  assert.deepEqual(hub.issues.map((i) => i.state), ["closed", "open"]);
});

test("if GitHub or X Layer cannot be reached, the robot says so, carries on, and tries again", async () => {
  const hub = github({ down: true });
  const said = [];
  let reachable = false;
  const look = walletWatch({ balance: async () => (reachable ? 1n : Promise.reject(new Error("no answer"))), wallet: WALLET, notes: notesOn(hub), say: (line) => said.push(line) });
  assert.equal(await look(), null, "X Layer could not be read: nothing is said, nothing is assumed");
  assert.deepEqual(said, []);
  reachable = true;
  assert.equal(await look(), "low");
  assert.match(said.at(-1), /The note about the wallet could not be written \(GitHub answered 503\)\. It will be tried again\./);
  hub.down = false;
  await look();
  assert.equal(hub.issues.length, 1, "the next look writes it");
});

test("a missed lock gets one note for its match, and never a second, even after the first is closed", async () => {
  const hub = github();
  const notes = notesOn(hub);
  const m = { id: "ab", label: "Champions League: Inter v Barcelona", kickoff: 1_764_092_700, count: 3 };
  const note = missedNote({ ...m, owner: "Mhiah" });
  assert.equal(note.title, "Not locked in time: Champions League: Inter v Barcelona, 2025-11-25");
  assert.match(note.body, /\*\*3 sealed picks were affected\.\*\*/);
  assert.match(missedNote({ ...m, count: 1 }).body, /\*\*1 sealed pick was affected\.\*\*/);

  const said = [];
  assert.deepEqual(await noteMissed({ missed: [m], notes, say: (line) => said.push(line) }), []);
  assert.equal(hub.issues.length, 1);
  assert.deepEqual(said, ["A note about Champions League: Inter v Barcelona not being locked in time was opened on GitHub."]);
  hub.issues[0].state = "closed";
  await noteMissed({ missed: [m], notes });
  assert.equal(hub.issues.length, 1);
  // Another match is another note.
  await noteMissed({ missed: [{ ...m, label: "NBA: Knicks v Bucks" }], notes });
  assert.equal(hub.issues.length, 2);

  // If the note cannot be written, the match is handed back to be tried again.
  hub.down = true;
  const later = { ...m, label: "WNBA: Liberty v Aces" };
  assert.deepEqual(await noteMissed({ missed: [later], notes, say: (line) => said.push(line) }), [later]);
  assert.match(said.at(-1), /could not be written \(GitHub answered 503\)/);
});

test("a result the feed changed after it was recorded gets one note, and Kickoff keeps the first", async () => {
  const hub = github();
  const notes = notesOn(hub);
  const c = { label: "Champions League: Sporting CP v Man United", from: "final 2 – 3", to: "final 2 – 2" };
  const note = changedNote({ ...c, owner: "Mhiah" });
  assert.equal(note.title, "The feed changed a result: Champions League: Sporting CP v Man United, final 2 – 3 to final 2 – 2");
  assert.match(note.body, /Kickoff recorded \*\*final 2 – 3\*\*\. The feed now says \*\*final 2 – 2\*\*\./);
  assert.match(note.body, /\*\*Kickoff has kept the first result\.\*\*/);

  const said = [];
  assert.deepEqual(await noteChanged({ changed: [c], notes, say: (line) => said.push(line) }), []);
  assert.equal(hub.issues.length, 1);
  assert.deepEqual(said, ["A note about the feed changing the result of Champions League: Sporting CP v Man United was opened on GitHub."]);
  // The robot sees the same change on every round. It is still one note, even once closed.
  hub.issues[0].state = "closed";
  await noteChanged({ changed: [c], notes });
  assert.equal(hub.issues.length, 1);
  // The feed changing it again is news.
  await noteChanged({ changed: [{ ...c, to: "final 3 – 3" }], notes });
  assert.equal(hub.issues.length, 2);
  // With nowhere to write, or GitHub down, nothing is lost.
  assert.deepEqual(await noteChanged({ changed: [c], notes: null }), []);
  hub.down = true;
  const again = { ...c, label: "NBA: Knicks v Bucks" };
  assert.deepEqual(await noteChanged({ changed: [again], notes }), [again]);
});
