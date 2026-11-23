// Checks on the website that need no browser: every screen draws, the made-up data agrees with
// itself, and the look keeps to what was asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

import { COMPETITIONS, fixtures, group, match, record, scores, week } from "../data/sample.js";
import { ordinal, placeName, standings } from "../lib/standings.js";
import { checkScreen, frame, groupScreen, home, league, matchScreen, pick, recordScreen } from "../screens.js";

const file = (name) => new URL(`../${name}`, import.meta.url);
// The styles with the comments taken out, so a word in a comment cannot fail or pass a check.
const css = readFileSync(file("styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const table = standings(scores);
const you = table.find((row) => row.name === group.you);

test("every screen draws, with nothing missing in it", () => {
  const screens = { home: home(), league: league(), record: recordScreen(), check: checkScreen(), group: groupScreen(), match: matchScreen(), frame: { html: frame(), title: "frame" } };
  for (const id of Object.keys(fixtures)) screens[`pick ${id}`] = pick(id);
  for (const [name, screen] of Object.entries(screens)) {
    assert.ok(screen.html.length > 200, `${name} is empty`);
    assert.ok(screen.title, `${name} has no title`);
    for (const slip of ["undefined", "NaN", "[object", "null"]) assert.ok(!screen.html.includes(slip), `${name} shows "${slip}"`);
  }
});

test("a pick for a match that does not exist falls back to the league", () => {
  assert.equal(pick("no-such-match").tab, "league");
  assert.match(pick("no-such-match").html, /This week/);
});

test("football matches get a score to set, basketball games get a winner and a margin", () => {
  for (const [id, f] of Object.entries(fixtures)) {
    const html = pick(id).html;
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

test("the table's tie-breaks: more 3-point picks first, then more 1-point picks", () => {
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
  // Every fixture belongs to a competition and a day that is listed.
  for (const f of Object.values(fixtures)) {
    assert.ok(COMPETITIONS[f.comp]);
    assert.ok(week.days.includes(f.day));
  }
  assert.ok(fixtures[week.nextUp]);
  assert.equal(scores.length, group.players.length);
});

test("the league screen counts the picks you have sealed", () => {
  const sealed = Object.values(fixtures).filter((f) => f.state === "sealed").length;
  assert.match(league().html, new RegExp(`You have picked ${sealed} of ${week.total} matches`));
});

test("names are made safe before they go on the page", () => {
  const before = group.name;
  group.name = `<img src=x onerror=alert(1)>`;
  try {
    for (const screen of [league(), recordScreen(), groupScreen()]) assert.ok(!screen.html.includes("<img src=x"));
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
  for (const screen of [league(), recordScreen(), checkScreen(), groupScreen(), matchScreen(), pick("ars-che")]) {
    assert.match(screen.html, /data-theme-toggle/); // the end of the title row, on a computer
  }
});

test("each typeface file is small enough to go on chain in one piece", () => {
  for (const weight of ["400-normal", "400-italic", "600-normal", "700-normal"]) {
    assert.ok(statSync(file(`fonts/gelasio-latin-${weight}.woff2`)).size <= 24000);
  }
});

test("until Kickoff is live, every screen says the data is made up", () => {
  for (const screen of [home(), league(), recordScreen(), checkScreen(), groupScreen(), matchScreen(), pick("ars-che")]) {
    assert.match(screen.html, /Nothing here is live yet/);
  }
});
