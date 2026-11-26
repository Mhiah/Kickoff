// A football match as three predictions on one screen: the result, goal goal and the exact score.
import { test } from "node:test";
import assert from "node:assert/strict";

import { COMPETITIONS, SAMPLE_LEAGUE, sampleFixtures } from "../data/sample.js";
import { FOOTBALL_MARKETS, GOAL_GOAL, RESULT, SCORE } from "../engine/picks.js";
import { createDevice } from "../lib/device.js";
import { createFixtures, together } from "../lib/fixtures.js";
import { createStore, matchIdOf, pickWords, seal } from "../lib/picks.js";
import { CLOSES_BEFORE } from "../lib/time.js";
import { league, nextUp, pick } from "../screens.js";
import { FakeStorage, NOW, noGroup } from "./helpers.js";

/** The made-up matches as the site shows them: a football one is its three predictions. */
async function ctxAt(now, store = createStore(new FakeStorage()), extra = {}) {
  const fixtures = createFixtures({ store, client: null, competitions: COMPETITIONS, sample: { league: SAMPLE_LEAGUE, fixtures: () => sampleFixtures(NOW) } });
  const view = await fixtures.view(NOW);
  const player = await createDevice(store).player();
  return { now, ...view, picks: store.all(player), lasting: store.lasting, editing: null, store, mine: noGroup(player), ...extra };
}
async function sealOn(ctx, id, what, extra = {}) {
  await seal({ store: ctx.store, league: SAMPLE_LEAGUE, fixture: ctx.fixtures[id], competitions: COMPETITIONS, pick: what, now: ctx.now, player: ctx.mine.player });
  return ctxAt(ctx.now, ctx.store, extra);
}

test("a football match's three predictions are tied together, and a list shows the match once", async () => {
  const ctx = await ctxAt(NOW);
  const arsenal = Object.keys(ctx.fixtures).filter((id) => ctx.fixtures[id].home === "Arsenal");
  assert.equal(arsenal.length, 3);
  assert.deepEqual(arsenal.map((id) => ctx.fixtures[id].sport).sort(), [RESULT, GOAL_GOAL, SCORE]);
  assert.deepEqual(ctx.fixtures["ars-che"].group.map((id) => ctx.fixtures[id].sport), FOOTBALL_MARKETS);
  assert.deepEqual(arsenal.map((id) => ctx.fixtures[id].lead), [true, false, false]);
  assert.equal(new Set(arsenal.map((id) => ctx.matchIds[id])).size, 3, "each is a match of its own, with its own id");
  // Basketball is one prediction, as before.
  assert.deepEqual(ctx.fixtures["nyk-mil"].group, ["nyk-mil"]);
  // The league lists Arsenal v Chelsea once.
  const html = league(null, ctx).html;
  assert.equal(html.split("Arsenal v Chelsea").length - 1, html.includes('class="teams">Arsenal v Chelsea') ? 2 : 1);
  assert.equal((html.match(/href="#\/pick\/ars-che[^"]*"/g) ?? []).filter((h) => h.includes(".")).length, 0, "no link goes to the second or third prediction");
});

test("matches that only share a team or a time are not tied together", () => {
  const f = (sport, home, kickoff) => ({ comp: "pl", home, away: "Chelsea", kickoff, sport });
  const fixtures = together({ a: f(RESULT, "Arsenal", 100), b: f(SCORE, "Arsenal", 200), c: f(GOAL_GOAL, "Spurs", 100), d: f(SCORE, "Arsenal", 100) });
  assert.deepEqual(fixtures.a.group, ["a", "d"]);
  assert.deepEqual([fixtures.b.group, fixtures.c.group], [["b"], ["c"]]);
});

test("the prediction screen asks the three things, with what each is worth", async () => {
  const ctx = await ctxAt(NOW);
  const html = pick("ars-che", ctx).html;
  assert.match(html, /data-picker="markets"/);
  assert.match(html, /<h3>Result<small>1 point<\/small><\/h3><p class="ask">How does it end\?<\/p>/);
  assert.match(html, /<h3>Goal Goal<small>1 point<\/small><\/h3><p class="ask">Do both teams score\?<\/p>/);
  assert.match(html, /<h3>Exact score<small>3 points<\/small><\/h3><p class="ask">What will the score be\?<\/p>/);
  assert.match(html, /data-result="home" aria-pressed="false">Arsenal<small>win<\/small>/);
  assert.match(html, /data-result="draw" aria-pressed="false">Draw/);
  assert.match(html, /data-both="yes" aria-pressed="false">Yes/);
  assert.equal((html.match(/<output[^>]*>–<\/output>/g) ?? []).length, 2, "no exact score is filled in until the player starts one");
  assert.match(html, /Make one, two or all three\. Each is scored by itself\./);
  assert.match(html, /<button type="button" class="btn go" data-seal="ars-che">Seal my predictions<\/button>/);
  // Whichever of the three the link names, the same screen opens.
  assert.equal(pick("ars-che.6", ctx).html, html);
});

test("a player can make one, two or all three, and sees each back in words", async () => {
  let ctx = await ctxAt(NOW);
  ctx = await sealOn(ctx, "ars-che", { result: "home" });
  let html = pick("ars-che", ctx).html;
  assert.match(html, /Your predictions/);
  assert.match(html, /<span class="what">Result<\/span><b class="">Arsenal win<\/b>/);
  assert.match(html, /<span class="what">Goal Goal<\/span><b class="none">No prediction<\/b>/);
  assert.match(html, /<span class="what">Exact score<\/span><b class="none">No prediction<\/b>/);
  assert.match(html, /Change my predictions/);

  ctx = await sealOn(ctx, "ars-che.5", { both: true });
  ctx = await sealOn(ctx, "ars-che.6", { home: 2, away: 1 });
  html = pick("ars-che", ctx).html;
  assert.match(html, /<span class="what">Goal Goal<\/span><b class="">Yes<\/b>/);
  assert.match(html, /<span class="what">Exact score<\/span><b class="">2 – 1<\/b>/);
  assert.equal(Object.keys(ctx.picks).length, 3, "three sealed predictions, each with its own fingerprint");
  assert.equal(new Set(Object.values(ctx.picks).map((e) => e.fingerprint)).size, 3);
  assert.deepEqual(Object.values(ctx.picks).map((e) => e.pickByte).sort(), [0, 1, 18]);
});

test("changing brings the three back, set to what was said", async () => {
  let ctx = await ctxAt(NOW);
  ctx = await sealOn(ctx, "ars-che", { result: "draw" });
  ctx = await sealOn(ctx, "ars-che.6", { home: 1, away: 1 }, { editing: "ars-che" });
  const html = pick("ars-che", ctx).html;
  assert.match(html, /data-result="draw" aria-pressed="true"/);
  assert.match(html, /data-both="yes" aria-pressed="false"/);
  assert.equal((html.match(/<output[^>]*>1<\/output>/g) ?? []).length, 2);
  assert.match(html, /Seal my new predictions/);
});

test("the words for each kind of prediction", () => {
  const f = { home: "Arsenal", away: "Chelsea" };
  assert.equal(pickWords({ sport: RESULT, pick: { result: "home" } }, f), "Arsenal win");
  assert.equal(pickWords({ sport: RESULT, pick: { result: "away" } }, f), "Chelsea win");
  assert.equal(pickWords({ sport: RESULT, pick: { result: "draw" } }, f), "Draw");
  assert.equal(pickWords({ sport: GOAL_GOAL, pick: { both: false } }, f), "Goal Goal: no");
  assert.equal(pickWords({ sport: SCORE, pick: { home: 0, away: 0 } }, f), "0 – 0");
});

test("a match with any of the three made counts as predicted, and is not offered as the next one", async () => {
  let ctx = await ctxAt(NOW);
  const first = nextUp(ctx);
  assert.equal(ctx.fixtures[first].lead, true);
  const sibling = ctx.fixtures[first].group?.[1];
  if (sibling) {
    ctx = await sealOn(ctx, sibling, ctx.fixtures[sibling].sport === GOAL_GOAL ? { both: true } : { home: 1, away: 0 });
    assert.notEqual(nextUp(ctx), first);
    assert.match(league(null, ctx).html, /You have predicted 1 of/);
  }
});

test("once predictions have closed, the three can be seen and not changed", async () => {
  let ctx = await ctxAt(NOW);
  ctx = await sealOn(ctx, "ars-che", { result: "home" });
  const late = await ctxAt(ctx.fixtures["ars-che"].kickoff - CLOSES_BEFORE, ctx.store);
  const html = pick("ars-che", late).html;
  assert.match(html, /Predictions have closed/);
  assert.match(html, /Arsenal win/);
  assert.ok(!html.includes("data-change") && !html.includes("data-seal"));
  // Someone who made none sees only that it has closed.
  const other = await ctxAt(ctx.fixtures["ars-che"].kickoff - CLOSES_BEFORE);
  assert.match(pick("ars-che", other).html, /Predictions for this match have closed\./);
  assert.equal(await matchIdOf(SAMPLE_LEAGUE, late.fixtures["ars-che"], COMPETITIONS), late.matchIds["ars-che"]);
});
