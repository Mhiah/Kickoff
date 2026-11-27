// The card of a finished match: what it says comes only from this player's finished, counted
// predictions, and it is offered only when there is one to make.
import { test } from "node:test";
import assert from "node:assert/strict";

import { COMPETITIONS } from "../data/sample.js";
import { cardFacts, cardLayout } from "../lib/card.js";
import { recordScreen } from "../screens.js";
import { NOW, contextAt } from "./helpers.js";
import { BASKETBALL, GOAL_GOAL, RESULT, SCORE, encodePick } from "../../engine/src/index.js";

const SATURDAY = Math.floor(Date.UTC(2026, 10, 28, 17, 30) / 1000);
const football = { comp: "pl", home: "Arsenal", away: "Chelsea", score: "2 – 1", kickoff: SATURDAY };
// As the leaderboard gives them: newest first, and a football match as its three predictions.
const played = [
  { match: "c".repeat(64), ...football, sport: SCORE, pickByte: encodePick(SCORE, { home: 2, away: 1 }), points: 3 },
  { match: "a".repeat(64), ...football, sport: RESULT, pickByte: encodePick(RESULT, { result: "home" }), points: 1 },
  { match: "b".repeat(64), ...football, sport: GOAL_GOAL, pickByte: encodePick(GOAL_GOAL, { both: false }), points: 0 },
  { match: "d".repeat(64), comp: "nba", sport: BASKETBALL, home: "Knicks", away: "Bucks", score: "112 – 104", kickoff: SATURDAY - 86400, pickByte: encodePick(BASKETBALL, { winner: "home", band: "B" }), points: 3 },
];
const standings = { you: { place: 7, points: 23, threes: 4, ones: 11, wrong: 6 }, group: { players: 5, rows: [{ place: 1, name: "Ada" }, { place: 2, name: "mya", you: true }] }, played };
const facts = () => cardFacts({ played, standings, name: "mya", groupName: "Sunday Ballers", competitions: COMPETITIONS, site: "https://kickoff.example/" });

test("the card is of the last finished match: its score, each prediction in order with its points, the sum, and the place", () => {
  const f = facts();
  assert.deepEqual(
    { ...f, day: null },
    {
      comp: "pl", compName: "Premier League", colour: "#e3127e", home: "Arsenal", away: "Chelsea", homeScore: "2", awayScore: "1", day: null, name: "mya",
      lines: [
        { kind: "Result", said: "Arsenal win", points: 1 },
        { kind: "Goal Goal", said: "No", points: 0 },
        { kind: "Exact score", said: "2 – 1", points: 3 },
      ],
      points: 4, place: "2nd in Sunday Ballers", total: 23, site: "kickoff.example", file: "kickoff-arsenal-chelsea.png",
    },
  );
  assert.match(f.day, /^Saturday 28 Nov$/);
});

test("every word on the card comes from those facts, and none of them is one Kickoff does not use", () => {
  const layout = cardLayout(facts());
  assert.deepEqual([layout.width, layout.height, layout.background], [1080, 1080, "#ffffff"]);
  const words = layout.items.filter((i) => i.kind === "text").map((i) => i.text);
  for (const expected of ["Kickoff", "Premier League", "Arsenal", "2", "Chelsea", "1", "Final score. Saturday 28 Nov.", "mya predicted", "Result", "Arsenal win", "+1", "Goal Goal", "No", "0", "Exact score", "2 – 1", "+3", "4 points from this match", "2nd in Sunday Ballers", "Sealed before kickoff. Locked on X Layer.", "kickoff.example"]) {
    assert.ok(words.includes(expected), `"${expected}" is not on the card`);
  }
  assert.ok(!/\bpick|\bbet|\bstake|\btable\b|\bwager/i.test(words.join(" ")));
  // Nothing is drawn off the edge, and no colour fades into another.
  for (const item of layout.items) {
    assert.ok((item.x ?? item.x1) >= 0 && (item.x ?? item.x2) <= 1080 && item.y > 0 && item.y < 1080);
    assert.ok(!/gradient/i.test(JSON.stringify(item)));
  }
  // The competition's own colour is its dot.
  assert.ok(layout.items.some((i) => i.dotBefore === "#e3127e"));
});

test("a basketball match is one prediction; one point is 'point'; with no group the place is among everyone", () => {
  const f = cardFacts({ played: played.slice(3), standings: { ...standings, group: null }, name: "", competitions: COMPETITIONS });
  assert.deepEqual(f.lines, [{ kind: "Winner and margin", said: "Knicks by 6 to 10", points: 3 }]);
  assert.deepEqual([f.homeScore, f.awayScore, f.place, f.site, f.file], ["112", "104", "7th on Kickoff", "", "kickoff-knicks-bucks.png"]);
  const words = cardLayout(f).items.filter((i) => i.kind === "text").map((i) => i.text);
  assert.ok(words.includes("My predictions") && words.includes("3 points from this match"));
  const one = cardFacts({ played: [played[1]], standings, name: "mya", groupName: "Sunday Ballers", competitions: COMPETITIONS });
  assert.ok(cardLayout(one).items.some((i) => i.text === "1 point from this match"));
});

test("there is no card of a match that was not locked in time, of one with no result, or when nothing has been played", () => {
  assert.equal(cardFacts({ played: [], standings, competitions: COMPETITIONS }), null);
  assert.equal(cardFacts({ standings: null }), null);
  const missed = { match: "e".repeat(64), ...football, kickoff: SATURDAY + 86400, sport: SCORE, missed: true, points: 0 };
  // The missed match is newer, but the card is still of the last one that counted.
  assert.equal(cardFacts({ played: [missed, ...played], standings, competitions: COMPETITIONS }).home, "Arsenal");
  assert.equal(cardFacts({ played: [missed], standings, competitions: COMPETITIONS }), null);
  assert.equal(cardFacts({ played: [{ ...played[0], score: "" }], standings, competitions: COMPETITIONS }), null);
  // A prediction that cannot be read is left off; if none can be read there is no card.
  assert.equal(cardFacts({ played: [{ ...played[1], pickByte: 9 }], standings, competitions: COMPETITIONS }), null);
});

test("My record offers the card only once there is one to save", async () => {
  const ctx = await contextAt(NOW);
  const real = { ...ctx, real: true, mine: { ...ctx.mine, name: "mya" } };
  const without = recordScreen(null, { ...real, standings: { ...standings, played: [] } }).html;
  assert.ok(!without.includes("data-save-card"));
  const withOne = recordScreen(null, { ...real, standings }).html;
  assert.match(withOne, /<button type="button" class="link" data-save-card>Save a card of your last match<\/button>/);
  assert.match(withOne, /<p class="say-so muted" data-card-out role="status"><\/p>/);
});
