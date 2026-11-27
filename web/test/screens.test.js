// Checks on the website that need no browser: every screen draws, the made-up data agrees with
// itself, and the look keeps to what was asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

import { COMPETITIONS, group, match, record, scores, week } from "../data/sample.js";
import { NOW, contextAt, sealOn } from "./helpers.js";
import { ordinal, placeName, standings } from "../lib/standings.js";
import { checkScreen, frame, groupScreen, home, league, matchScreen, pick, recordScreen, reminderFor } from "../screens.js";

const file = (name) => new URL(`../${name}`, import.meta.url);
// The styles with the comments taken out, so a word in a comment cannot fail or pass a check.
const css = readFileSync(file("styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const table = standings(scores);
const you = table.find((row) => row.name === group.you);
const ctx = await contextAt(NOW);
const fixtures = ctx.fixtures;

// The same player once they are in a real group that someone else started.
const realGroup = {
  code: "SUNDAYB-4821",
  name: "Sunday Ballers",
  startedBy: "aa".repeat(32),
  startedAt: NOW,
  plays: ["pl", "nba"],
  members: [
    { player: "aa".repeat(32), name: "Ada", joinedAt: NOW },
    { player: ctx.mine.player, name: "Bola", joinedAt: NOW + 60 },
  ],
};
const inGroup = { ...ctx, mine: { ...ctx.mine, groups: [realGroup], group: realGroup, name: "Bola" } };
const asStarter = { ...ctx, mine: { ...ctx.mine, groups: [{ ...realGroup, startedBy: ctx.mine.player }], group: { ...realGroup, startedBy: ctx.mine.player }, name: "Bola" } };

test("every screen draws, with nothing missing in it", () => {
  const screens = { home: home(), league: league(null, ctx), record: recordScreen(), check: checkScreen(), group: groupScreen(undefined, ctx), "group start": groupScreen("start", ctx), "group join": groupScreen("join", ctx), "group, in one": groupScreen(undefined, inGroup), match: matchScreen(), frame: { html: frame(), title: "frame" } };
  for (const id of Object.keys(fixtures)) screens[`prediction ${id}`] = pick(id, ctx);
  for (const [name, screen] of Object.entries(screens)) {
    assert.ok(screen.html.length > 200, `${name} is empty`);
    assert.ok(screen.title, `${name} has no title`);
    for (const slip of ["undefined", "NaN", "[object", "null"]) assert.ok(!screen.html.includes(slip), `${name} shows "${slip}"`);
    assert.ok(!/gradient/i.test(screen.html), `${name} has a gradient in it`);
  }
});

test("a prediction for a match that does not exist falls back to the league", () => {
  assert.equal(pick("no-such-match", ctx).tab, "league");
  assert.match(pick("no-such-match", ctx).html, /This week/);
});

test("football matches get a score to set, basketball games get a winner and a margin", () => {
  for (const [id, f] of Object.entries(fixtures)) {
    const html = pick(id, ctx).html;
    if (COMPETITIONS[f.comp].sport === "football") {
      assert.match(html, /What will the score be\?/);
      assert.match(html, /90 minutes/);
    } else {
      assert.match(html, /Who wins\?/);
      assert.match(html, /Overtime counts/);
      assert.match(html, /tip-off/);
    }
  }
});

test("the table is in order, and players level on everything share a place", () => {
  assert.deepEqual(table.map((r) => `${r.position} ${r.name} ${r.points}`), [
    "1 Ada 11", "2 Bola 9", "2 Funke 9", "4 Chidi 7", "5 Tunde 6", "6 Halima 5", "7 Emeka 4", "8 Dayo 2",
  ]);
  assert.deepEqual(you.sharedWith, ["Funke"]);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
  assert.equal(placeName(2), "second");
  assert.equal(placeName(5), "5th");
});

test("the table's tie-breaks: more 3-point predictions first, then more 1-point picks", () => {
  const t = standings([{ name: "A", threes: 1, ones: 3 }, { name: "B", threes: 2, ones: 0 }, { name: "C", threes: 2, ones: 0 }, { name: "D", threes: 0, ones: 6 }]);
  assert.deepEqual(t.map((r) => `${r.position} ${r.name}`), ["1 B", "1 C", "3 A", "4 D"]);
});

test("the made-up data agrees with itself", () => {
  // Your record adds up to your line in the table.
  assert.equal(record.reduce((sum, r) => sum + r.points, 0), you.points);
  assert.equal(record.filter((r) => r.points === 3).length, you.threes);
  assert.equal(record.filter((r) => r.points === 1).length, you.ones);
  // The match shown in full is one of the matches in your record, with the same points for you.
  const yours = match.opened.find((o) => o.name === group.you);
  assert.equal(record.find((r) => r.id === match.id).points, yours.points);
  // Everyone in the group is accounted for in that match.
  assert.equal(match.opened.length + match.notOpened.length, match.sealedCount);
  assert.deepEqual([...match.opened.map((o) => o.name), ...match.notOpened].sort(), [...group.players].sort());
  // Every fixture belongs to a competition and is still ahead.
  for (const f of Object.values(fixtures)) {
    assert.ok(COMPETITIONS[f.comp]);
    assert.ok(f.kickoff > NOW);
  }
  assert.equal(scores.length, group.players.length);
});

test("the league screen counts the predictions sealed on this device", async () => {
  assert.match(league(null, ctx).html, new RegExp(`You have predicted 0 of ${week.total} matches`));
  const after = await sealOn(ctx, "ars-che", { home: 2, away: 1 });
  assert.match(league(null, after).html, new RegExp(`You have predicted 1 of ${week.total} matches`));
});

test("names are made safe before they go on the page", () => {
  const before = group.name;
  group.name = `<img src=x onerror=alert(1)>`;
  try {
    for (const screen of [league(null, ctx), recordScreen()]) assert.ok(!screen.html.includes("<img src=x"));
    assert.ok(!frame().includes("<img src=x"));
  } finally {
    group.name = before;
  }
});

test("the look keeps to what was asked for: no gradients, Georgia first, a colour for each competition", () => {
  assert.ok(!/gradient/i.test(css), "there is a gradient in the styles");
  assert.match(css, /--serif: Georgia, "Gelasio", serif/);
  for (const key of Object.keys(COMPETITIONS)) assert.match(css, new RegExp(`--${key}: #`));
  assert.match(css, /:root\[data-theme="dark"\]/);
});

test("every screen carries the light and dark switch", () => {
  assert.match(frame(), /data-theme-toggle/); // the top bar, on a phone
  for (const screen of [league(null, ctx), recordScreen(), checkScreen(), groupScreen(undefined, ctx), groupScreen("join", ctx), groupScreen(undefined, inGroup), matchScreen(), pick("ars-che", ctx)]) {
    assert.match(screen.html, /data-theme-toggle/); // the end of the title row, on a computer
  }
});

test("each typeface file is small enough to go on chain in one piece", () => {
  for (const weight of ["400-normal", "400-italic", "600-normal", "700-normal"]) {
    assert.ok(statSync(file(`fonts/gelasio-latin-${weight}.woff2`)).size <= 24000);
  }
});

test("the home page says its card is an example, and does not say Kickoff is not live", () => {
  const { html } = home();
  assert.match(html, /<p class="sample">The prediction card at the top is an example\.<\/p>/);
  // The football feed's terms ask for this credit, in these words, somewhere anyone can see it.
  assert.match(html, /<p class="sample credit">Football data provided by the Football-Data\.org API\.<\/p>/);
  assert.ok(!/Nothing here is live yet|made-up/.test(html));
});

test("every screen showing made-up matches says so, and the group screen does not", () => {
  for (const screen of [league(null, ctx), recordScreen(), checkScreen(), matchScreen(), pick("ars-che", ctx)]) {
    assert.match(screen.html, /Nothing here is live yet/);
  }
  // The group screen is real now, so it must not claim to be made up, or show the made-up group.
  for (const screen of [groupScreen(undefined, ctx), groupScreen("start", ctx), groupScreen(undefined, inGroup), groupScreen(undefined, asStarter)]) {
    assert.ok(!/Nothing here is live yet/.test(screen.html));
    assert.ok(!screen.html.includes("BALLERS-4821") || screen.html.includes("It looks like BALLERS-4821"), "only as the example of what a code looks like");
    assert.ok(!screen.html.includes("Funke"));
  }
});

test("with no group yet, the group screen offers to start one or join one", () => {
  const both = groupScreen(undefined, ctx).html;
  assert.match(both, /data-form="start"/);
  assert.match(both, /data-form="join"/);
  assert.match(both, /<b>No sign-up\.<\/b> A wallet is optional: you can link one\./);
  assert.ok(!groupScreen("start", ctx).html.includes('data-form="join"'));
  assert.ok(!groupScreen("join", ctx).html.includes('data-form="start"'));
  // Someone already in a group can still start or join another, and get back.
  const another = groupScreen("join", inGroup).html;
  assert.match(another, /data-form="join"/);
  assert.match(another, /Back to Sunday Ballers/);
  assert.match(another, /name="playerName" value="Bola"/, "their name is filled in for them");
});

test("in a group, the screen shows its real code, members and competitions", () => {
  const html = groupScreen(undefined, inGroup).html;
  assert.match(html, /<h1>Sunday Ballers<\/h1>/);
  assert.match(html, /Ada started this group\. 2 players\./);
  assert.match(html, /data-copy="SUNDAYB-4821"/);
  assert.match(html, /Ada<\/div><div class="sub">Started the group/);
  assert.match(html, /Bola<span class="tag">you<\/span>/);
  assert.equal(html.match(/<span class="tag">you<\/span>/g).length, 1);
  // Someone who did not start the group sees what it plays but cannot change it.
  assert.ok(!html.includes("data-plays"));
  assert.match(html, /Only Ada can change this/);
  assert.equal(html.match(/>On</g).length, 2);
  assert.equal(html.match(/>Off</g).length, 2);
  // Whoever started it gets the switches, set as the group has them.
  const mine = groupScreen(undefined, asStarter).html;
  assert.match(mine, /You started this group/);
  assert.match(mine, /aria-checked="true" aria-label="Premier League" data-plays="pl"/);
  assert.match(mine, /aria-checked="false" aria-label="Champions League" data-plays="cl"/);
  assert.ok(!mine.includes("Only"));
  // One player is "1 player", not "1 players".
  const alone = { ...realGroup, members: [realGroup.members[1]], startedBy: ctx.mine.player };
  assert.match(groupScreen(undefined, { ...ctx, mine: { ...ctx.mine, groups: [alone], group: alone } }).html, /1 player\./);
});

test("a player in several groups can move between them", () => {
  const other = { ...realGroup, code: "OFFICE-0007", name: "Office", members: [realGroup.members[1]] };
  const html = groupScreen(undefined, { ...inGroup, mine: { ...inGroup.mine, groups: [realGroup, other] } }).html;
  assert.match(html, /Your other groups/);
  assert.match(html, /data-choose="OFFICE-0007"/);
  assert.ok(!html.includes('data-choose="SUNDAYB-4821"'), "the group being looked at is not listed as another");
  assert.ok(!groupScreen(undefined, inGroup).html.includes("Your other groups"));
});

test("names typed by other people are made safe on the group screen", () => {
  const nasty = `<img src=x onerror=alert(1)>`;
  const g = { ...realGroup, name: nasty, members: [{ ...realGroup.members[0], name: nasty }, realGroup.members[1]] };
  for (const arg of [undefined, "join"]) {
    const html = groupScreen(arg, { ...ctx, mine: { ...ctx.mine, groups: [g, { ...g, code: "X-0001" }], group: g, name: `"><script>` } }).html;
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes("<script>"));
  }
});

test("when Kickoff cannot be reached, the group screen says so and still shows what it last saw", () => {
  const html = groupScreen(undefined, { ...inGroup, mine: { ...inGroup.mine, offline: true } }).html;
  assert.match(html, /Kickoff could not be reached/);
  assert.match(html, /SUNDAYB-4821/);
  assert.ok(!groupScreen(undefined, inGroup).html.includes("could not be reached"));
});

// ---- "Remind my group"

test("in a group of friends, Remind my group copies a ready message: the next match, when predictions close, the code and the link", () => {
  const there = { ...inGroup, site: "https://kickoff.example/" };
  const words = reminderFor(there, realGroup);
  const next = Object.values(there.fixtures).filter((f) => there.now < f.kickoff - 600 && realGroup.plays.includes(f.comp)).sort((a, b) => a.kickoff - b.kickoff)[0];
  assert.ok(words.startsWith(`${next.home} v ${next.away} kicks off `));
  assert.match(words, /kicks off \w+day \d+ \w{3} at \d\d:\d\d\. Predictions close at \d\d:\d\d\. /);
  assert.ok(words.includes(`Our group's code is ${realGroup.code}.`));
  assert.ok(words.endsWith("Make yours on Kickoff: https://kickoff.example/"));
  assert.ok(!/\bpick|\bbet|\bstake|\btable\b/i.test(words), "the words Kickoff does not use");

  const html = groupScreen(undefined, there).html;
  const button = html.match(/<button type="button" class="btn small quiet" data-copy="([^"]*)" data-then="Reminder copied\. Paste it in your group chat\.">Remind my group<\/button>/);
  assert.ok(button, "the button is on the Group screen");
  // What the button holds, once the browser has read it back, is exactly the message.
  const unescaped = button[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.equal(unescaped, words);
  assert.match(html, /<p class="say-so muted" data-copy-out role="status"><\/p>/);
  assert.match(html, /See every match/);
});

test("Remind my group is not shown when nothing the group plays is open, or in a brand's group", () => {
  // Every match has closed.
  const late = { ...inGroup, now: Math.max(...Object.values(inGroup.fixtures).map((f) => f.kickoff)) };
  assert.equal(reminderFor(late, realGroup), null);
  assert.ok(!groupScreen(undefined, late).html.includes("Remind my group"));
  // The group plays nothing that is on.
  const none = { ...realGroup, plays: [] };
  assert.equal(reminderFor(inGroup, none), null);
  assert.ok(!groupScreen(undefined, { ...inGroup, mine: { ...inGroup.mine, group: none, groups: [none] } }).html.includes("Remind my group"));
  // A brand's group is too big to be anyone's to remind.
  const brand = { ...realGroup, brand: "A brand", players: 4000 };
  assert.ok(!groupScreen(undefined, { ...inGroup, mine: { ...inGroup.mine, group: brand, groups: [brand] } }).html.includes("Remind my group"));
  // Someone in no group has no button either.
  assert.ok(!groupScreen(undefined, ctx).html.includes("Remind my group"));
});

test("a group name or code cannot break out of the reminder button", () => {
  const odd = { ...realGroup, code: `X"><script>alert(1)</script>` };
  const html = groupScreen(undefined, { ...inGroup, mine: { ...inGroup.mine, group: odd, groups: [odd] } }).html;
  assert.ok(!html.includes("<script>alert(1)"));
});

// ---- Moving to another phone

test("the Group screen offers a move to another phone, and the screen for it shows a code only once one is made", () => {
  assert.match(groupScreen(undefined, inGroup).html, /<a href="#\/group\/move">Move to another phone<\/a>/);
  const before = groupScreen("move", inGroup).html;
  assert.match(before, /<button class="btn go" type="button" data-move-start>Get a code<\/button>/);
  assert.ok(!before.includes("One-time code"));
  assert.match(before, /That phone becomes you: same name, same groups, same points\. This one keeps working\./);
  assert.match(before, /<a class="link" href="#\/group\/code">Enter a code<\/a>/);

  const showing = groupScreen("move", { ...inGroup, moving: { code: "ABCD-EFGH", until: NOW + 600, left: 0 } }).html;
  assert.match(showing, /<small class="muted">One-time code<\/small><b>ABCD-EFGH<\/b>/);
  assert.match(showing, /It works once and runs out at \d\d:\d\d\. Anyone who has it becomes you, so keep it to yourself\./);
  assert.ok(!showing.includes("data-move-start") && !showing.includes("did not fit"));
  assert.match(groupScreen("move", { ...inGroup, moving: { code: "ABCD-EFGH", until: NOW + 600, left: 3 } }).html, /3 of your predictions did not fit and stay on this phone\. They still count\./);
});

test("the other phone has a place to type the code, and is told when the code will replace a player it already has", () => {
  // Someone with no group yet is offered it under the start and join forms.
  for (const arg of [undefined, "start", "join"]) assert.match(groupScreen(arg, ctx).html, /Playing on another phone\?<\/span> <a class="link" href="#\/group\/code">Bring my player here<\/a>/);
  assert.ok(!groupScreen(undefined, inGroup).html.includes("Bring my player here"));

  const fresh = groupScreen("code", ctx).html;
  assert.match(fresh, /<form class="glass form" data-form="code" novalidate>/);
  assert.match(fresh, /<input name="code"[^>]*maxlength="9"/);
  assert.match(fresh, /<button class="btn go" type="submit">Bring my player here<\/button>/);
  assert.ok(!fresh.includes("replaces that"));
  assert.match(groupScreen("code", inGroup).html, /This phone is playing as <b>Bola<\/b> now\. The code replaces that\./);
});

// ---- A brand group's prize

test("starting a group offers Friends or Brand, and Brand asks for the prize, the winners, what it is paid in and the last day", () => {
  const html = groupScreen("start", ctx).html;
  // Friends is chosen to begin with, and the brand's boxes are there for when Brand is.
  assert.match(html, /<form class="glass form" data-form="start" data-kind="friends" novalidate>/);
  assert.match(html, /<input type="radio" name="kind" value="friends" checked><span>Friends<\/span>/);
  assert.match(html, /<input type="radio" name="kind" value="brand"><span>Brand<\/span>/);
  for (const name of ["brand", "amount", "winners"]) assert.match(html, new RegExp(`<input name="${name}"`));
  assert.match(html, /<input type="radio" name="token" value="USDT" checked><span>USDT<\/span><\/label><label><input type="radio" name="token" value="USDC"><span>USDC<\/span>/);
  assert.match(html, /<label>Last day<input type="date" name="lastDay"><\/label>/);
  // Whoever starts it is told plainly that they pay, and that Kickoff holds nothing.
  assert.match(html, /You pay the winners yourself, on X Layer, when the group ends\. Kickoff never holds the prize\./);
  assert.ok(!/\b(bets?|betting|stakes?|picks?)\b/i.test(html.replace(/data-[a-z-]+|class="[^"]*"/g, "")));
});

test("a brand's group says when it ends, then who won, then whether each winner was paid", () => {
  const brandGroup = { ...realGroup, brand: "OKX", prize: "300 USDT shared by the top 3", startedBy: null, players: 812, members: [{ player: ctx.mine.player, name: "Bola", joinedAt: NOW }], ends: NOW + 3 * 86400, ended: false, decided: false, winners: [], share: "100 USDT" };
  const at = (now, more = {}) => groupScreen(undefined, { ...ctx, now, mine: { ...ctx.mine, groups: [{ ...brandGroup, ...more }], group: { ...brandGroup, ...more }, name: "Bola" } }).html;
  const after = brandGroup.ends + 3600;
  const won = (name, place, more = {}) => ({ place, name, points: 15 - place, you: false, linked: true, paid: null, ...more });
  const done = { ended: true, decided: true };

  // Still running.
  assert.match(at(NOW), /<p class="sub prize"><b>Prize:<\/b> 300 USDT shared by the top 3<\/p>\n<p class="sub">Ends \w+day \d+ \w{3}, \d\d:\d\d\.<\/p>/);
  assert.match(at(NOW), /Invite code/);
  assert.match(at(NOW), /Run by OKX\. 812 players\./);
  // Ended, with a result still to come. Nobody new can join now, so the code is no longer offered.
  assert.match(at(after, { ended: true }), /Ended \w+day \d+ \w{3}, \d\d:\d\d\. The winners are named when the last result is in\./);
  assert.ok(!at(after, { ended: true }).includes("Invite code") && !at(after, { ended: true }).includes("Anyone with this code can join"));
  // Decided, and nobody scored.
  assert.match(at(after, done), /Nobody scored, so there is no winner\./);
  // Three winners, in order. Each is not paid until a payment is recorded for them.
  const three = at(after, { ...done, winners: [won("Ada", 1), won("Chidi", 2), won("Dayo", 3)] });
  assert.match(three, /<h2>Winners<\/h2>/);
  assert.deepEqual([...three.matchAll(/<div class="sub">(\d\w\w) · (\d+ points?)<\/div>/g)].map((m) => `${m[1]} ${m[2]}`), ["1st 14 points", "2nd 13 points", "3rd 12 points"]);
  assert.equal(three.match(/Not paid yet/g).length, 3);
  assert.ok(!three.includes("You won") && !three.includes("Pay the winners"));
  // This player won and has no wallet linked: they are asked to link one.
  const mineNoWallet = at(after, { ...done, winners: [won("Ada", 1), won("Bola", 2, { you: true, linked: false })] });
  assert.match(mineNoWallet, /Bola<span class="tag">you<\/span>/);
  assert.match(mineNoWallet, /<b>You won\.<\/b> Link a wallet below, so your prize can be paid to it\./);
  assert.match(mineNoWallet, /data-link-wallet>Link a wallet</);
  assert.match(at(after, { ...done, winners: [won("Bola", 1, { you: true })] }), /<h2>Winner<\/h2>[\s\S]*Your prize is paid to the wallet you linked\./);
  // Paid: what was paid, as a link to the payment on X Layer. The others still wait.
  const paid = at(after, { ...done, winners: [won("Ada", 1, { paid: { tx: `0x${"ab".repeat(32)}`, what: "100 USDT" } }), won("Bola", 2, { you: true, paid: { tx: `0x${"cd".repeat(32)}`, what: "100 USDT" } }), won("Dayo", 3)] });
  assert.match(paid, new RegExp(`<a class="link" href="https://www\\.oklink\\.com/xlayer/tx/0x${"ab".repeat(32)}" target="_blank" rel="noopener">Paid 100 USDT</a>`));
  assert.equal(paid.match(/Not paid yet/g).length, 1);
  assert.ok(!paid.includes("Your prize is paid to"), "a winner who has been paid is not told where it will go");
  // A brand's group with no end, and a group of friends, say none of this.
  for (const html of [at(NOW, { ends: undefined }), groupScreen(undefined, inGroup).html]) assert.ok(!/Ends |Winner|Not paid|Pay the winners/.test(html));
});

test("whoever started a brand's group is shown who to pay, how much and where, and nobody else is", () => {
  const WALLET = `0x${"1a".repeat(20)}`;
  const TOKEN = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
  const winners = [{ place: 1, name: "Ada", points: 14, you: false, linked: true, paid: null }, { place: 2, name: "Chidi", points: 9, you: false, linked: false, paid: null }];
  const brandGroup = { ...realGroup, code: "HOOPS-0001", brand: "OKX", prize: "200 USDT shared by the top 2", startedBy: ctx.mine.player, players: 40, members: [{ player: ctx.mine.player, name: "Bola", joinedAt: NOW }], ends: NOW - 3600, ended: true, decided: true, winners, share: "100 USDT" };
  const pay = (name, place, more = {}) => ({ place, name, wallet: WALLET, what: "100 USDT", checking: null, refused: null, ...more });
  const as = (more = {}) => groupScreen(undefined, { ...ctx, now: NOW, mine: { ...ctx.mine, groups: [{ ...brandGroup, ...more }], group: { ...brandGroup, ...more }, name: "Bola" } }).html;

  // A player sees the winners and nothing about paying.
  assert.ok(!as().includes("Pay the winners") && !as().includes(WALLET));
  // Whoever started it: each winner, their share, their wallet to copy, and a box for the payment.
  const mine = as({ organiser: true, payIn: { symbol: "USDT", address: TOKEN }, toPay: [pay("Ada", 1), pay("Chidi", 2, { wallet: null })] });
  assert.match(mine, /Run by OKX\. You started this group\. 40 players\./);
  assert.match(mine, /<h2>Pay the winners<\/h2>/);
  assert.match(mine, new RegExp(`<div class="sub">1st · 100 USDT</div></div><button type="button" class="btn small quiet" data-copy="${WALLET}">Copy wallet</button>`));
  assert.match(mine, /<form class="paid" data-form="paid" novalidate>\s*<input type="hidden" name="code" value="HOOPS-0001"><input type="hidden" name="place" value="1">/);
  assert.match(mine, /<button class="btn small go" type="submit">Mark as paid<\/button>/);
  // A winner with no wallet cannot be paid yet, and has no box.
  assert.match(mine, /Has not linked a wallet yet\. Their Group screen asks them to\./);
  assert.equal(mine.match(/data-form="paid"/g).length, 1);
  // Which token exactly, by its address, so the real one is sent.
  assert.match(mine, new RegExp(`USDT on X Layer is the token 0x779d…3736\\. <button type="button" class="link" data-copy="${TOKEN}">Copy its address</button>`));
  // A payment being read says so and has no box. One that was not accepted says why, and can be given again.
  const checking = as({ organiser: true, toPay: [pay("Ada", 1, { checking: `0x${"ab".repeat(32)}` })] });
  assert.match(checking, /Checking your payment on X Layer\. This takes a few minutes\./);
  assert.ok(!checking.includes('data-form="paid"'));
  const refused = as({ organiser: true, toPay: [pay("Ada", 1, { refused: "It paid 15 USDT, less than the 100 USDT share." })] });
  assert.match(refused, /<p class="say-so warn" data-form-out role="status">It paid 15 USDT, less than the 100 USDT share\.<\/p>/);
  assert.match(refused, /data-form="paid"/);
  // Once everyone is paid there is nothing left to do, and the section goes.
  assert.ok(!as({ organiser: true, toPay: [] }).includes("Pay the winners"));
});
