// Checks on the website that need no browser: every screen draws, the made-up data agrees with
// itself, and the look keeps to what was asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

import { COMPETITIONS, group, match, record, scores, week } from "../data/sample.js";
import { NOW, contextAt, sealOn } from "./helpers.js";
import { ordinal, placeName, standings } from "../lib/standings.js";
import { checkScreen, frame, groupScreen, home, league, matchScreen, pick, recordScreen } from "../screens.js";

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

test("until Kickoff is live, every screen with made-up data says so, and the group screen does not", () => {
  for (const screen of [home(), league(null, ctx), recordScreen(), checkScreen(), matchScreen(), pick("ars-che", ctx)]) {
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
  assert.match(both, /No sign-up and no wallet/);
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
