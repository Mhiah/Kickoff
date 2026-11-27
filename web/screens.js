// The screens. Each one is a plain function that takes nothing from the browser and returns
// { html, title, tab, wide, public }, so every screen can be drawn and checked without a browser.

// A screen that shows matches to pick is also handed `ctx`, what is true right now:
//
//   now        the time, in seconds
//   real       true once the matches come from Kickoff's server; false while they are made up
//   fixtures   the matches still to be played, by id
//   matchIds   each fixture's match id, by fixture id
//   picks      the picks kept on this device, by match id
//   lasting    false if this browser will not keep picks after it is closed
//   editing    the id of a fixture whose pick is being changed, if any
//   mine       this player and their groups, as lib/groups.js gives them:
//              { player, groups, group (the one being looked at, or null), name, offline }

import { COMPETITIONS, check, group, match, record, scores, voided, week } from "./data/sample.js";
import { ON_CHAIN } from "./config.js";
import { sits } from "./lib/groups.js";
import { HOME_NOTE, MARK, SAMPLE_NOTE, TOGGLE, comp, esc, stamp, titlebar } from "./lib/html.js";
import { GOAL_GOAL, RESULT, SCORE, decodePick } from "./engine/picks.js";
import { cardFacts } from "./lib/card.js";
import { BAND_KEYS, MARKETS, bandWords, pickWords, pointsFor } from "./lib/picks.js";
import { standing } from "./lib/sync.js";
import { PAID_IN } from "./lib/prize.js";
import { ordinal, placeName, standings } from "./lib/standings.js";
import { EMPTY } from "./lib/table.js";
import { clock, closesAt, dayLabel, hasClosed, howLong, todayLabel } from "./lib/time.js";

const table = standings(scores);
const you = table.find((row) => row.name === group.you);
const startWord = (f) => (COMPETITIONS[f.comp].sport === "basketball" ? "tip-off" : "kickoff");
const yourPick = (ctx, id) => ctx.picks[ctx.matchIds[id]] ?? null;
// A football match is three predictions (result, goal goal, exact score), each a match of its own
// on the list. `group` is their ids and the first is the `lead`: the one a list of matches shows.
const groupOf = (ctx, id) => ctx.fixtures[id]?.group ?? [id];
/** Every prediction this player has made on a match: up to three for football, one otherwise. */
const yourPicks = (ctx, id) => groupOf(ctx, id).map((m) => ({ id: m, entry: yourPick(ctx, m), f: ctx.fixtures[m] ?? ctx.fixtures[id] })).filter((p) => p.entry);
const inOrder = (ctx) => Object.keys(ctx.fixtures).filter((id) => ctx.fixtures[id].lead !== false).sort((a, b) => ctx.fixtures[a].kickoff - ctx.fixtures[b].kickoff);
const teams = (f) => `${esc(f.home)} v ${esc(f.away)}`;
const pointsCell = (points) => `<div class="points ${points === 0 ? "zero" : ""}">${points}</div>`;

// ------------------------------------------------------------------------------------ home

export function home() {
  const html = `
<div class="hero">
  <div class="say">
    <h1>Say the score before kickoff. Prove it after.</h1>
    <p class="lede">Predict the results of real matches with your friends. Every prediction is sealed before the match starts, so nobody can change theirs once the result is in.</p>
  </div>
  <div class="slip glass demo">
    <div class="body">
      ${comp("pl")}
      <div class="teams">Arsenal v Chelsea</div>
      <div class="when">Ada's prediction</div>
      <div class="pick">2 – 1</div>
    </div>
    <div class="stub small"><b>Sealed 18:20.</b> Kickoff 18:30.<br><span class="muted">The time is stamped by X Layer, not by us.</span></div>
    ${stamp("18:20", "SAT 28 NOV")}
  </div>
  <div class="do">
    <div class="cta">
      <a class="btn go" href="#/group/start">Start a group</a>
      <a class="btn quiet" href="#/group/join">Join with a code</a>
    </div>
    <p class="tagline">Free to play. Predict with your friends.</p>
  </div>
</div>

<div class="trio">
  <section>
    <h2>Real games, every week</h2>
    <p>This week's fixtures are already here, and next week's arrive by themselves. Results come in after the final whistle. Nobody types them in.</p>
    <div class="glass">
      <div class="row"><div class="grow"><div class="title" style="margin:0">Football</div>
        <div class="comps">${comp("pl")}${comp("cl")}</div>
        <div class="sub">Three predictions a match: the result and goal goal for 1 point each, the exact score for 3.</div></div></div>
      <div class="row"><div class="grow"><div class="title" style="margin:0">Basketball</div>
        <div class="comps">${comp("nba")}${comp("wnba")}</div>
        <div class="sub">The winner gets 1 point. Add 2 if you also get how much they win by.</div></div></div>
      <div class="row"><div class="grow"><div class="title" style="margin:0">Tennis</div><div class="sub"><i>Coming later.</i></div></div></div>
    </div>
  </section>
  <section>
    <h2>How a match goes</h2>
    <ol class="steps">
      <li><b>Before kickoff, you predict.</b> Your prediction is sealed on your phone. No other player can see it.</li>
      <li><b>Ten minutes before kickoff, predictions close.</b> X Layer stamps the time. A prediction that turns up later does not count.</li>
      <li><b>After the match, the leaderboard updates.</b> Everyone sees what everyone predicted.</li>
    </ol>
  </section>
  <section>
    <h2>You don't have to trust us</h2>
    <p>Every prediction's seal and every result is kept on X Layer through TapeOut. Anyone can read the record and rebuild the leaderboard themselves.</p>
    <a class="btn quiet" href="#/check">See how to check it</a>
  </section>
</div>
${HOME_NOTE}`;
  return { html, title: "Kickoff", public: true, wide: true };
}

// ------------------------------------------------------------------------------------ league

function fixtureRow(ctx, id) {
  const f = ctx.fixtures[id];
  let action;
  const all = yourPicks(ctx, id);
  const mine = all.length > 0;
  const stuck = all.some((p) => ["waiting", "missed", "problem"].includes(standing(p.entry, p.f, ctx.now)));
  if (stuck) action = `<a class="sealed-box unsent" href="#/pick/${id}" aria-label="Your prediction is sealed but has not reached Kickoff. See why.">Not entered</a>`;
  else if (mine) action = `<a class="sealed-box" href="#/pick/${id}" aria-label="Your prediction is sealed. See it or change it.">Sealed</a>`;
  else if (hasClosed(ctx.now, f.kickoff)) action = `<span class="small muted">Closed</span>`;
  else action = `<a class="btn small go" href="#/pick/${id}">Predict</a>`;
  return `<div class="row" data-comp="${f.comp}"><div class="grow">${comp(f.comp)}<div class="title">${teams(f)}</div><div class="sub">${clock(f.kickoff)}. Predictions close ${clock(closesAt(f.kickoff))}.</div></div>${action}</div>`;
}

function weekHtml(ctx) {
  const ids = inOrder(ctx);
  const picked = ids.filter((id) => yourPicks(ctx, id).length).length;
  const total = ctx.real ? ids.length : week.total;
  const dayNames = [...new Set(ids.map((id) => dayLabel(ctx.fixtures[id].kickoff)))];
  const days = dayNames
    .map((day) => {
      const rows = ids.filter((id) => dayLabel(ctx.fixtures[id].kickoff) === day).map((id) => fixtureRow(ctx, id));
      return `<div data-day><div class="day">${esc(day)}</div><div class="glass">${rows.join("")}</div></div>`;
    })
    .join("");
  const chips = Object.keys(COMPETITIONS)
    .map((key) => `<button type="button" data-filter="${key}" aria-pressed="false">${comp(key)}</button>`)
    .join("");
  return `
  <h2>This week</h2>
  <div class="chips" role="group" aria-label="Show one competition"><button type="button" data-filter="all" aria-pressed="true">All</button>${chips}</div>
  <p class="small muted" style="margin:10px 0 0">You have predicted ${picked} of ${total} matches. Predict as many as you like.</p>
  ${days}
  <p class="small muted" data-empty hidden style="margin-top:14px">No matches in this competition this week.</p>
  ${ctx.real ? "" : `<p class="say-so"><button type="button" class="link" data-preview-note="In this preview only five of the week's matches are shown.">Show all ${week.total} matches this week</button></p>`}
  <p class="say-so muted" data-note-out role="status"></p>`;
}

export function tableHtml() {
  const rows = table
    .map(
      (row) =>
        `<tr class="${row.name === group.you ? "you" : ""}"><td>${row.position}</td><td>${esc(row.name)}${row.name === group.you ? '<span class="tag">you</span>' : ""}</td><td>${row.threes}</td><td>${row.ones}</td><td class="pts">${row.points}</td></tr>`,
    )
    .join("");
  const shared = you.sharedWith.length
    ? `<p class="small muted" style="margin-top:8px">${esc(group.you)} and ${esc(you.sharedWith.join(" and "))} are level on everything, so they share ${placeName(you.position)} place.</p>`
    : "";
  return `<div class="glass clip"><table class="table"><thead><tr><th><span hidden>Place</span></th><th>Player</th><th>3-pt<span class="long"> predictions</span></th><th>1-pt<span class="long"> predictions</span></th><th>Points</th></tr></thead><tbody>${rows}</tbody></table></div>${shared}`;
}

function playedHtml(limit) {
  const rows = record
    .slice(0, limit)
    .map((r) => `<div class="row"><div class="grow">${comp(r.comp)}<div class="title"><a href="#/match/${r.id}">${esc(r.title)}</a></div><div class="sub">${esc(r.said)}</div></div>${pointsCell(r.points)}</div>`)
    .join("");
  return `<div class="glass">${rows}</div>`;
}

/**
 * The next match to pick: the one closing soonest that you have not picked, or failing that any
 * still open. `plays` narrows it to the competitions a group plays.
 */
export function nextUp(ctx, plays = null) {
  const open = inOrder(ctx).filter((id) => !hasClosed(ctx.now, ctx.fixtures[id].kickoff) && (!plays || plays.includes(ctx.fixtures[id].comp)));
  return open.find((id) => !yourPicks(ctx, id).length) ?? open[0] ?? null;
}

/**
 * The words "Remind my group" copies, for pasting into the group's own chat: the group's next
 * match, when its predictions close, the group's code and where to play. Kickoff sends nothing
 * itself. Null if no match the group plays is open.
 */
export function reminderFor(ctx, g) {
  const id = inOrder(ctx).find((id) => !hasClosed(ctx.now, ctx.fixtures[id].kickoff) && g.plays.includes(ctx.fixtures[id].comp));
  if (!id) return null;
  const f = ctx.fixtures[id];
  return `${f.home} v ${f.away} kicks off ${dayLabel(f.kickoff)} at ${clock(f.kickoff)}. Predictions close at ${clock(closesAt(f.kickoff))}. Our group's code is ${g.code}. Make yours on Kickoff${ctx.site ? `: ${ctx.site}` : "."}`;
}

/** The card that says what to do next: the next match, when its picks close, and a button to pick it. */
function nextCard(ctx, nextId) {
  const next = ctx.fixtures[nextId];
  return `<div class="slip glass edge ${next.comp}" style="margin-top:18px">
  <div class="body">
    ${comp(next.comp)}
    <div class="teams">${teams(next)}</div>
    <div class="when">${esc(dayLabel(next.kickoff))}, ${clock(next.kickoff)}.</div>
    <span class="clock">Predictions close in ${esc(howLong(ctx.now, closesAt(next.kickoff)))}</span>
  </div>
  <div class="stub"><a class="btn go" href="#/pick/${nextId}">${yourPicks(ctx, nextId).length ? "See your prediction" : "Make your prediction"}</a></div>
</div>`;
}

/**
 * One leaderboard. `board` is { players, rows } where a row is
 * { place (null until a pick of theirs has been scored), name, threes, ones, points, you }.
 * Only the top of a long board is sent, with your own row added if it is further down.
 */
const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>`;

/**
 * A leaderboard. `best` is its player of the week ({ name, points }), or null: whoever gained the
 * most points in the last finished week, Monday to Sunday. They get a star after their
 * name, and pressing the star says why. `open` is whether that is showing.
 */
function boardHtml(board, empty, best = null, open = false) {
  if (board.rows.length === 0) return `<p class="small muted" style="margin-top:10px">${empty}</p>`;
  const top = board.rows.filter((row) => !row.below);
  const below = board.rows.filter((row) => row.below);
  const line = (row) => {
    const starred = best && row.name === best.name;
    const star = starred ? `<button type="button" class="star" data-week-star aria-expanded="${open}" aria-label="Player of the week">${STAR}</button>` : "";
    // Why, on a line of its own under the row, the full width of the leaderboard.
    const why = starred ? `<tr class="week-note${row.you ? " you" : ""}"${open ? "" : " hidden"}><td></td><td colspan="4">Player of the week: ${esc(best.name)}, ${best.points} ${best.points === 1 ? "point" : "points"}</td></tr>` : "";
    return `<tr class="${row.you ? "you" : ""}"><td>${row.place ?? "–"}</td><td>${starred ? `<span class="starred">${esc(row.name)}${star}</span>` : esc(row.name)}${row.you ? '<span class="tag">you</span>' : ""}</td><td>${row.threes}</td><td>${row.ones}</td><td class="pts">${row.points}</td></tr>${why}`;
  };
  const gap = below.length ? `<tr class="gap"><td colspan="5">…</td></tr>` : "";
  return `<div class="glass clip"><table class="table"><thead><tr><th><span hidden>Place</span></th><th>Player</th><th>3-pt<span class="long"> predictions</span></th><th>1-pt<span class="long"> predictions</span></th><th>Points</th></tr></thead><tbody>${top.map(line).join("")}${gap}${below.map(line).join("")}</tbody></table></div>`;
}

/**
 * The League screen with real numbers. `ctx.standings` is what Kickoff's server worked out:
 *   everyone  the leaderboard of everybody who has played
 *   group     the leaderboard of this player's group, or null if they are in none
 *   you       { place (null at first), points, threes, ones }, among everyone
 *   played    this player's finished matches, newest first: { id, comp, title, said, points }
 */
/** One finished match of this player's: the score, what they said, and what it scored. */
function playedRow(r, under = "") {
  let said = "";
  try {
    said = `You said ${pickWords({ sport: r.sport, pick: decodePick(r.sport, r.pickByte) }, r)}`;
  } catch {
    // a pick this screen cannot put in words: the points still show
  }
  // A match that was not locked on X Layer in time: no points to show, only why.
  if (r.missed) return `<div class="row"><div class="grow">${comp(r.comp)}<div class="title">${r.score ? `${esc(r.home)} ${esc(r.score)} ${esc(r.away)}` : teams(r)}</div>${NOT_LOCKED}</div></div>`;
  return `<div class="row"><div class="grow">${comp(r.comp)}<div class="title">${esc(r.home)} ${esc(r.score)} ${esc(r.away)}</div><div class="sub">${esc(said)}</div>${under}</div>${pointsCell(r.points)}</div>`;
}

function leagueReal(ctx) {
  const s = ctx.standings ?? EMPTY;
  const g = ctx.mine.group;
  const ids = inOrder(ctx).filter((id) => !g || g.plays.includes(ctx.fixtures[id].comp));
  const picked = ids.filter((id) => yourPicks(ctx, id).length).length;
  const nextId = nextUp(ctx, g?.plays ?? null);
  const next = nextId ? ctx.fixtures[nextId] : null;
  const closesIn = next ? howLong(ctx.now, closesAt(next.kickoff)) : "";
  const people = (n) => `${n} ${n === 1 ? "player" : "players"}`;
  // What the player last chose to look at, so the screen keeps it when it is drawn again. On a
  // phone the matches and the table take turns; on a wide screen they sit side by side.
  const part = ctx.looking?.part === "table" ? "table" : "matches";
  const board = ctx.looking?.board === "group" ? "group" : "everyone";
  const played = s.played.length
    ? `<div class="glass">${s.played.slice(0, 3).map((r) => playedRow(r)).join("")}</div>
    <p class="say-so"><a class="link" href="#/record">Every match you predicted</a></p>`
    : `<p class="small muted" style="margin-top:10px">Nothing played yet.</p>`;
  const html = `
${titlebar({
  eyebrow: esc(todayLabel(ctx.now)),
  heading: "League",
  actions: `<a class="btn small quiet" href="#/group">${g ? "Invite a friend" : "Start a group"}</a>${next ? `<a class="btn small go" href="#/pick/${nextId}">Make a prediction</a>` : ""}`,
})}
<p class="sub phone-only">${people(s.everyone.players)}.${s.you.place ? ` You are ${ordinal(s.you.place)}.` : ""}</p>

<div class="tiles">
  <div class="glass tile"><small>Your place</small><b>${s.you.place ? ordinal(s.you.place) : "–"}</b><span>${s.you.place ? `of ${people(s.everyone.players)}` : "after your first prediction"}</span></div>
  <div class="glass tile"><small>Your points</small><b>${s.you.points}</b><span>${s.you.threes} for 3 points, ${s.you.ones} for 1</span></div>
  <div class="glass tile"><small>Predicted this week</small><b>${picked} of ${ids.length}</b><span>predict as many as you like</span></div>
  <div class="glass tile"><small>Next to close</small><b>${next ? esc(closesIn) : "Nothing open"}</b><span>${next ? teams(next) : "new matches arrive each week"}</span></div>
</div>

${next ? `<div class="phone-only">${nextCard(ctx, nextId)}</div>` : ""}

<div class="chips parts phone-only" role="group" aria-label="What to show"><button type="button" data-part="matches" aria-pressed="${part === "matches"}">Matches</button><button type="button" data-part="table" aria-pressed="${part === "table"}">Leaderboard</button></div>

<div class="cols" data-show="${part}">
  <section data-part-of="matches">${weekHtml({ ...ctx, fixtures: Object.fromEntries(ids.flatMap((id) => groupOf(ctx, id)).map((id) => [id, ctx.fixtures[id]])) })}</section>
  <section data-part-of="table">
    <h2>Leaderboard</h2>
    <div class="chips" role="group" aria-label="Which leaderboard"><button type="button" data-board="everyone" aria-pressed="${board === "everyone"}">Everyone</button><button type="button" data-board="group" aria-pressed="${board === "group"}">My group</button></div>
    <div data-board-of="everyone" style="margin-top:12px"${board === "everyone" ? "" : " hidden"}>${boardHtml(s.everyone, "Nobody has played yet.", s.week?.everyone, Boolean(ctx.looking?.week))}</div>
    <div data-board-of="group" style="margin-top:12px"${board === "group" ? "" : " hidden"}>${s.group ? boardHtml(s.group, "Nobody has played yet.", s.week?.group, Boolean(ctx.looking?.week)) : `<p class="small muted" style="margin-top:10px">You are not in a group yet. <a class="link" href="#/group">Start or join one</a>.</p>`}</div>
    <h2>Played</h2>
    ${played}
  </section>
</div>`;
  return { html, title: "League on Kickoff", tab: "league", wide: true };
}

export function league(_, ctx) {
  if (ctx.real) return leagueReal(ctx);
  const ids = inOrder(ctx);
  const picked = ids.filter((id) => yourPicks(ctx, id).length).length;
  const nextId = nextUp(ctx);
  const next = nextId ? ctx.fixtures[nextId] : null;
  const closesIn = next ? howLong(ctx.now, closesAt(next.kickoff)) : "";
  const html = `
${titlebar({
  eyebrow: esc(todayLabel(ctx.now)),
  heading: esc(group.name),
  actions: `<a class="btn small quiet" href="#/group">Invite a friend</a>${next ? `<a class="btn small go" href="#/pick/${nextId}">Make a prediction</a>` : ""}`,
})}
<p class="sub phone-only">${group.players.length} players. You are ${ordinal(you.position)}.</p>

<div class="tiles">
  <div class="glass tile"><small>Your place</small><b>${ordinal(you.position)}</b><span>${you.sharedWith.length ? `shared with ${esc(you.sharedWith.join(" and "))}` : `of ${group.players.length}`}</span></div>
  <div class="glass tile"><small>Your points</small><b>${you.points}</b><span>${you.threes} spot on, ${you.ones} right winner</span></div>
  <div class="glass tile"><small>Predicted this week</small><b>${picked} of ${ctx.real ? ids.length : week.total}</b><span>predict as many as you like</span></div>
  <div class="glass tile"><small>Next to close</small><b>${next ? esc(closesIn) : "Nothing open"}</b><span>${next ? teams(next) : "new matches arrive each week"}</span></div>
</div>

${
  next
    ? `<div class="slip glass edge ${next.comp} phone-only" style="margin-top:18px">
  <div class="body">
    ${comp(next.comp)}
    <div class="teams">${teams(next)}</div>
    <div class="when">${esc(dayLabel(next.kickoff))}, ${clock(next.kickoff)}.</div>
    <span class="clock">Predictions close in ${esc(closesIn)}</span>
  </div>
  <div class="stub"><a class="btn go" href="#/pick/${nextId}">${yourPicks(ctx, nextId).length ? "See your prediction" : "Make your prediction"}</a></div>
</div>`
    : ""
}

<div class="cols">
  <section>${weekHtml(ctx)}</section>
  <section>
    <h2>Leaderboard</h2>
    ${tableHtml()}
    <h2>Played</h2>
    ${playedHtml(3)}
    <p class="say-so"><a class="link" href="#/record">Every match you predicted</a></p>
  </section>
</div>
${SAMPLE_NOTE}`;
  return { html, title: `${group.name} on Kickoff`, tab: "league", wide: true };
}

// ------------------------------------------------------------------------------------ make a pick

function pickControls(f, entry) {
  if (COMPETITIONS[f.comp].sport === "football") {
    const goals = entry ? [entry.pick.home, entry.pick.away] : [0, 0];
    return `<h3>What will the score be?</h3>
      ${[f.home, f.away]
        .map(
          (team, i) => `<div class="score"><span class="team">${esc(team)}</span>
        <div class="stepper"><button type="button" data-step="-1" aria-label="One fewer for ${esc(team)}">−</button><output aria-label="${esc(team)}'s goals">${goals[i]}</output><button type="button" data-step="1" aria-label="One more for ${esc(team)}">+</button></div></div>`,
        )
        .join("")}`;
  }
  const winner = entry?.pick.winner;
  const band = entry?.pick.band;
  return `<h3>Who wins?</h3>
      <div class="choices" role="group" aria-label="Who wins">
        <button type="button" class="choice" data-winner="home" aria-pressed="${winner === "home"}">${esc(f.home)}<small>home</small></button>
        <button type="button" class="choice" data-winner="away" aria-pressed="${winner === "away"}">${esc(f.away)}<small>away</small></button>
      </div>
      <h3>By how many points?</h3>
      <div class="choices" role="group" aria-label="By how many points">
        ${BAND_KEYS.map((key) => `<button type="button" class="choice" data-band="${key}" aria-pressed="${band === key}">${bandWords(key)}</button>`).join("")}
      </div>`;
}

/**
 * Where a sealed pick stands: one or two words on the card, and a short line only when something
 * needs the player's attention. A made-up match gets nothing; the foot of the page covers it.
 */
const NOT_LOCKED = `<div class="state bad">Not locked in time</div><div class="small muted state-line">Nobody scores for this match.</div>`;

function standingMark(entry, f, ctx) {
  const mark = (kind, words, line = "") => `<div class="state ${kind}">${words}</div>${line ? `<div class="small muted state-line">${line}</div>` : ""}`;
  switch (standing(entry, f, ctx.now)) {
    case "made-up":
      return "";
    case "waiting":
      return mark("warn", "Not entered yet", "No connection. It will try again.");
    case "sent":
    case "closed":
      return mark("", "Entered");
    // Once the match has started the prediction is opened for scoring, by Kickoff's robot or by
    // this device. A player has nothing to do and nothing to watch for: it stays "Locked in" until
    // the result gives it its points.
    case "locked":
    case "opened":
      return mark("", "Locked in");
    case "missed":
      return mark("bad", "Not entered in time", "It does not count for this match.");
    case "unlocked":
      return NOT_LOCKED;
    case "elsewhere":
      return mark("", "Changed on your other phone");
    default:
      return mark("bad", "Problem", esc(entry.problem));
  }
}

/** The three predictions of a football match, each with the question it asks. */
const QUESTIONS = { [RESULT]: "How does it end?", [GOAL_GOAL]: "Do both teams score?", [SCORE]: "What will the score be?" };
const pointWords = (sport) => `${pointsFor(sport)} ${pointsFor(sport) === 1 ? "point" : "points"}`;

/** The controls for one of a football match's three predictions. `entry` is what was sealed before, if anything. */
function marketControls(sport, f, entry) {
  const head = `<h3>${MARKETS[sport]}<small>${pointWords(sport)}</small></h3><p class="ask">${QUESTIONS[sport]}</p>`;
  if (sport === RESULT) {
    const said = entry?.pick.result;
    const one = (value, words, small) => `<button type="button" class="choice" data-result="${value}" aria-pressed="${said === value}">${words}<small>${small}</small></button>`;
    return `${head}<div class="choices three" role="group" aria-label="How does it end" data-optional>${one("home", esc(f.home), "win")}${one("draw", "Draw", "level")}${one("away", esc(f.away), "win")}</div>`;
  }
  if (sport === GOAL_GOAL) {
    const said = entry ? (entry.pick.both ? "yes" : "no") : null;
    const one = (value, words, small) => `<button type="button" class="choice" data-both="${value}" aria-pressed="${said === value}">${words}<small>${small}</small></button>`;
    return `${head}<div class="choices" role="group" aria-label="Do both teams score" data-optional>${one("yes", "Yes", "Goal Goal")}${one("no", "No", "one side or neither")}</div>`;
  }
  const goals = entry ? [entry.pick.home, entry.pick.away] : ["–", "–"];
  return `${head}<div data-score>
      ${[f.home, f.away]
        .map(
          (team, i) => `<div class="score"><span class="team">${esc(team)}</span>
        <div class="stepper"><button type="button" data-step="-1" aria-label="One fewer for ${esc(team)}">−</button><output aria-label="${esc(team)}'s goals">${goals[i]}</output><button type="button" data-step="1" aria-label="One more for ${esc(team)}">+</button></div></div>`,
        )
        .join("")}
      <button type="button" class="link small" data-clear-score>No exact score</button></div>`;
}

/** A football match: its three predictions on one screen. Make one, two or all three. */
function markets(id, ctx) {
  const f = ctx.fixtures[id];
  const group = groupOf(ctx, id).map((m) => ({ id: m, f: ctx.fixtures[m], entry: yourPick(ctx, m) }));
  const mine = group.filter((g) => g.entry);
  const closed = hasClosed(ctx.now, f.kickoff);
  const editing = !closed && (mine.length === 0 || ctx.editing === id);
  const notKept = ctx.lasting ? "" : `<div class="note warn" style="margin-top:14px"><b>Private window.</b> These predictions will be lost when you close it.</div>`;

  let body;
  if (editing) {
    body = `
<div class="glass picker" data-picker="markets">${group.map((g) => `<div class="market" data-market="${g.f.sport}">${marketControls(g.f.sport, f, g.entry)}</div>`).join("")}</div>
<ul class="rules"><li>Make one, two or all three. Each is scored by itself.</li><li>It is the score after 90 minutes. Extra time and penalties do not count.</li></ul>
<button type="button" class="btn go" data-seal="${id}">${mine.length ? "Seal my new predictions" : "Seal my predictions"}</button>
<p class="after" data-note-out role="status">No other player can see them before kickoff. You can change them until predictions close.</p>`;
  } else if (mine.length) {
    // Where each one stands. They are sent and locked together, so one word usually covers all three.
    const marks = mine.map((g) => standingMark(g.entry, g.f, ctx));
    const together = marks.every((m) => m === marks[0]);
    const last = Math.max(...mine.map((g) => g.entry.sealedAt));
    const line = (g) =>
      `<div class="said-row"><span class="what">${MARKETS[g.f.sport]}</span><b class="${g.entry ? "" : "none"}">${g.entry ? esc(g.f.sport === GOAL_GOAL ? (g.entry.pick.both ? "Yes" : "No") : pickWords(g.entry, f)) : "No prediction"}</b></div>${g.entry && !together ? marks[mine.indexOf(g)] : ""}`;
    body = `
<div class="glass sealed" role="status">
  <div class="small muted">Your predictions</div>
  ${group.map(line).join("")}
  <div class="small muted" style="margin-top:10px">Sealed at ${clock(last)} on ${esc(dayLabel(last))}. No other player can see them.</div>
  ${together ? marks[0] : ""}
</div>
${closed ? "" : `<button type="button" class="btn quiet" data-change="${id}" style="margin-top:14px">Change my predictions</button>`}
${notKept}`;
  } else {
    body = `<div class="note" style="margin-top:6px">Predictions for this match have closed.</div>`;
  }

  const html = `
<a class="back" href="#/league">Back to the league</a>
<div class="head">
  ${titlebar({ before: comp(f.comp), heading: teams(f), headingClass: "under" })}
  <div class="muted" style="margin-top:6px">${esc(dayLabel(f.kickoff))}, kickoff ${clock(f.kickoff)}</div>
  <span class="clock">${closed ? "Predictions have closed" : `Predictions close at ${clock(closesAt(f.kickoff))}, in ${esc(howLong(ctx.now, closesAt(f.kickoff)))}`}</span>
</div>
${body}
${f.real ? "" : SAMPLE_NOTE}`;
  return { html, title: `${f.home} v ${f.away} on Kickoff`, tab: "league" };
}

export function pick(id, ctx) {
  let f = ctx.fixtures[id];
  if (!f) return league(null, ctx);
  // One of a football match's three predictions: they share a screen, reached by the first.
  if (f.group?.length > 1) return markets(f.group[0], ctx);
  const start = startWord(f);
  const football = COMPETITIONS[f.comp].sport === "football";
  const entry = yourPick(ctx, id);
  const closed = hasClosed(ctx.now, f.kickoff);
  const editing = !closed && (!entry || ctx.editing === id);
  const rules = football
    ? ["The exact score gets 3 points.", "The right winner, or calling a draw, gets 1 point.", "It is the score after 90 minutes. Extra time and penalties do not count."]
    : ["The right winner gets 1 point.", "Add 2 points if you also get how much they win by.", "Overtime counts."];
  // The one thing said out loud: a private window keeps nothing, so the pick would be lost.
  const notKept = ctx.lasting ? "" : `<div class="note warn" style="margin-top:14px"><b>Private window.</b> This prediction will be lost when you close it.</div>`;

  let body;
  if (editing) {
    body = `
<div class="glass picker" data-picker="${football ? "football" : "basketball"}">${pickControls(f, entry)}</div>
<ul class="rules">${rules.map((r) => `<li>${r}</li>`).join("")}</ul>
<button type="button" class="btn go" data-seal="${id}">${entry ? "Seal my new prediction" : "Seal my prediction"}</button>
<p class="after" data-note-out role="status">No other player can see it before ${start}. You can change it until predictions close.</p>`;
  } else if (entry) {
    body = `
<div class="glass sealed" role="status">
  <div class="small muted">Your prediction</div>
  <div class="yours${football ? "" : " words"}">${esc(pickWords(entry, f))}</div>
  <div class="small muted">Sealed at ${clock(entry.sealedAt)} on ${esc(dayLabel(entry.sealedAt))}. No other player can see it.</div>
  ${standingMark(entry, f, ctx)}
</div>
${closed ? "" : `<button type="button" class="btn quiet" data-change="${id}" style="margin-top:14px">Change my prediction</button>`}
${entry.replaced ? `<p class="after">Your later prediction was not sent in time, so this one counts.</p>` : ""}
${notKept}`;
  } else {
    body = `<div class="note" style="margin-top:6px">Predictions for this match have closed.</div>`;
  }

  const html = `
<a class="back" href="#/league">Back to the league</a>
<div class="head">
  ${titlebar({ before: comp(f.comp), heading: teams(f), headingClass: "under" })}
  <div class="muted" style="margin-top:6px">${esc(dayLabel(f.kickoff))}, ${start} ${clock(f.kickoff)}</div>
  <span class="clock">${closed ? "Predictions have closed" : `Predictions close at ${clock(closesAt(f.kickoff))}, in ${esc(howLong(ctx.now, closesAt(f.kickoff)))}`}</span>
</div>
${body}
${f.real ? "" : SAMPLE_NOTE}`;
  return { html, title: `${f.home} v ${f.away} on Kickoff`, tab: "league" };
}

// ------------------------------------------------------------------------------------ match

export function matchScreen() {
  const m = match;
  const opened = m.opened
    .map(
      (o) => `<div class="row"><div class="grow"><div class="title" style="margin:0">${esc(o.name)}${o.name === group.you ? '<span class="tag">you</span>' : ""}</div><div class="sub">${esc(o.why)}</div></div>
      <div class="said">${esc(o.said)}</div>${pointsCell(o.points)}</div>`,
    )
    .join("");
  const waiting = m.notOpened
    .map((name) => `<div class="row"><div class="grow"><div class="title" style="margin:0">${esc(name)}</div><div class="sub">Still sealed.</div></div><span class="sealed-box">Sealed</span></div>`)
    .join("");
  const html = `
<a class="back" href="#/league">Back to the league</a>
<div class="final">
  ${titlebar({ before: comp(m.comp), heading: `<span>${esc(m.home)}</span><b>${esc(m.score)}</b><span>${esc(m.away)}</span>`, headingClass: "scoreline" })}
  <div class="muted small">${esc(m.when)}</div>
</div>

<div class="glass proof">
  ${stamp(m.sealedAt, m.sealedDate, 92)}
  <div><b>All ${m.sealedCount} predictions were sealed at ${m.sealedAt},</b> ten minutes before kickoff. X Layer stamped the time.<br><a class="link" href="#/check">See the proof</a></div>
</div>

<h2>What everyone said</h2>
<div class="glass">${opened}${waiting}</div>

<h2>The result</h2>
<div class="note">${esc(m.resultFrom)}</div>
${m.dispute ? `<div class="note warn" style="margin-top:8px"><b>${esc(m.dispute.by)} disputes this</b> and says it finished ${esc(m.dispute.says)}. Kickoff has not answered yet.</div>` : ""}
<p class="small muted" style="margin:12px 0">Think the result is wrong? You can dispute it until ${esc(m.disputeUntil)}. A dispute stays on the record for everyone to see.</p>
<button type="button" class="btn danger" data-preview-note="Disputing a result is not switched on in this preview.">Dispute this result</button>
<p class="say-so muted" data-note-out role="status"></p>
${SAMPLE_NOTE}`;
  return { html, title: `${m.home} ${m.score} ${m.away} on Kickoff`, tab: "league" };
}

// ------------------------------------------------------------------------------------ my record

/**
 * What X Layer shows for one of this player's picks: when its match was locked, and whether this
 * pick is inside that lock. Empty until the match has been locked.
 */
function lockLine(lock, kickoff, entry) {
  if (!lock) return "";
  const early = Math.max(1, Math.round((kickoff - lock.at) / 60));
  const inside = entry?.receipt?.root === lock.root ? " Your prediction is in it." : "";
  const see = lock.tx ? ` <a class="link" href="${ON_CHAIN.explorer}/tx/${esc(lock.tx)}" target="_blank" rel="noopener">See it</a>` : "";
  return `<div class="small muted state-line">Locked on X Layer at ${clock(lock.at)}, ${early} ${early === 1 ? "minute" : "minutes"} before kickoff.${inside}${see}</div>`;
}

/**
 * Every pick of this player's, newest first: the ones made on this device, whatever stage they are
 * at, and the finished ones Kickoff's server knows of from their other devices. Each is the match,
 * what they said, its stage, and its points once it has finished. The proof from X Layer is on the
 * Check screen.
 */
function everyPick(ctx, s) {
  const scored = new Map(s.played.map((r) => [r.match, r]));
  const rows = [];
  for (const [match, entry] of Object.entries(ctx.picks)) {
    const f = ctx.fixtures[match];
    const done = scored.get(match);
    if (!f && !done) continue;
    scored.delete(match);
    const about = f ?? done;
    // Not locked on X Layer in time: said plainly, with no points beside it.
    const lost = done?.missed || (f && standing(entry, f, ctx.now) === "unlocked");
    const under = lost ? NOT_LOCKED : f ? standingMark(entry, f, ctx) : "";
    rows.push({
      kickoff: about.kickoff,
      lost: Boolean(lost),
      html: `<div class="row"><div class="grow">${comp(about.comp)}<div class="title">${done?.score ? `${esc(done.home)} ${esc(done.score)} ${esc(done.away)}` : teams(about)}</div><div class="sub">You said ${esc(pickWords(entry, about))}</div>${under}</div>${done && !lost ? pointsCell(done.points) : ""}</div>`,
    });
  }
  for (const r of scored.values()) rows.push({ kickoff: r.kickoff, lost: Boolean(r.missed), html: playedRow(r) });
  return rows.sort((a, b) => b.kickoff - a.kickoff);
}

/** What a card of this player's last finished match would say (lib/card.js), or null if there is none yet. */
export const cardOf = (ctx) =>
  cardFacts({ played: ctx.standings?.played ?? [], standings: ctx.standings, name: ctx.mine.name, groupName: ctx.mine.group?.name ?? null, competitions: COMPETITIONS, site: ctx.site ?? "" });

/** My record, with real numbers: this player's points and place, and every pick. */
function recordReal(ctx) {
  const s = ctx.standings ?? EMPTY;
  const name = ctx.mine.name;
  const every = everyPick(ctx, s);
  const picks = every.map((r) => r.html);
  // The totals: every pick made, the ones that scored, and how often a finished pick scored. A
  // pick whose match was not locked in time is a pick made, but is neither played nor still to play.
  const won = s.you.threes + s.you.ones;
  const finished = won + s.you.wrong;
  const lost = every.filter((r) => r.lost).length;
  const total = Math.max(picks.length, finished + lost);
  const rate = finished > 0 ? `${Math.round((100 * won) / finished)}%` : "–";
  const html = `
${titlebar({ heading: name ? `${esc(name)}'s record` : "My record" })}
<div class="glass sum">
  <div class="big"><b>${s.you.points}</b><span class="word">Points</span></div>
</div>
<div class="boxes">
  <div class="glass box"><small>Total predictions</small><b>${total}</b><span>${total - finished - lost} to play</span></div>
  <div class="glass box"><small>Total won</small><b>${won}</b><span>${s.you.threes} spot on</span></div>
  <div class="glass box"><small>Win rate</small><b>${rate}</b><span>of ${finished} played</span></div>
</div>
${cardOf(ctx) ? `<p class="wallet-row"><button type="button" class="link" data-save-card>Save a card of your last match</button></p>
<p class="say-so muted" data-card-out role="status"></p>` : ""}
<h2>Every prediction</h2>
${picks.length ? `<div class="glass">${picks.join("")}</div>` : `<p class="small muted" style="margin-top:10px">No predictions yet.</p>`}`;
  return { html, title: "My record on Kickoff", tab: "record" };
}

export function recordScreen(_, ctx) {
  if (ctx?.real) return recordReal(ctx);
  const wrong = record.filter((r) => r.points === 0).length;
  const rows = record
    .map((r) => `<div class="row"><div class="grow">${comp(r.comp)}<div class="title"><a href="#/match/${r.id}">${esc(r.title)}</a></div><div class="sub">${esc(r.said)}</div></div>${pointsCell(r.points)}</div>`)
    .join("");
  const voids = voided.map((v) => `<div class="row"><div class="grow">${comp(v.comp)}<div class="title">${esc(v.title)}</div><div class="sub">${esc(v.said)}</div></div><div class="points zero word">void</div></div>`).join("");
  const html = `
${titlebar({ heading: `${esc(group.you)}'s record` })}
<p class="sub">${esc(group.name)}. Every line was sealed before kickoff and cannot be edited.</p>
<div class="glass sum">
  <div class="big"><b>${you.points}</b><span>points<br><span class="muted">${ordinal(you.position)} place${you.sharedWith.length ? ", shared" : ""}</span></span></div>
  <div class="split">
    <div><b>${you.threes}</b> spot on<small>3 points each</small></div>
    <div><b>${you.ones}</b> right winner<small>1 point each</small></div>
    <div><b>${wrong}</b> wrong<small>no points</small></div>
  </div>
</div>
<h2>Every prediction</h2>
<div class="glass">${rows}${voids}</div>
<button type="button" class="btn quiet" style="margin-top:18px" data-preview-note="Sharing is not switched on in this preview.">Share my record</button>
<p class="say-so muted" data-note-out role="status"></p>
${SAMPLE_NOTE}`;
  return { html, title: `${group.you}'s record on Kickoff`, tab: "record" };
}

// ------------------------------------------------------------------------------------ check it yourself

function timeline({ lock, kickoff, late }) {
  const lateHtml = late ? `<div class="dot late" style="left:86%"></div><div class="lab late" style="left:86%">${late.time}<small>refused</small></div>` : "";
  return `<div class="tl" role="img" aria-label="Predictions sealed at ${lock}. Kickoff at ${kickoff}.${late ? ` A set sent at ${late.time} was refused.` : ""}"><div class="bar"></div><div class="bar after"></div>
  <div class="dot" style="left:22%"></div><div class="lab" style="left:22%">${lock}<small>predictions sealed</small></div>
  <div class="tick" style="left:62%"></div><div class="lab" style="left:62%">${kickoff}<small>kickoff</small></div>${lateHtml}</div>`;
}

/** A value with a name and a Copy button. */
const copyRow = (label, value, shown = value) => `<div class="idrow"><div><small class="muted">${label}</small><br><b>${esc(shown)}</b></div><button type="button" class="btn small quiet" data-copy="${esc(value)}">Copy</button></div>`;
const shortHex = (h) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/**
 * The Check screen with real records. Everything on it was read from X Layer by this browser
 * (lib/chain.js), not from Kickoff's server, apart from the "On Kickoff" column it is compared with.
 */
function checkReal(ctx) {
  const chain = ctx.chain;
  const g = ctx.mine.group;
  const account = `0x${ctx.league.slice(-40)}`;
  const locked = chain ? Object.values(chain.matches).filter((m) => m.lock).length : 0;
  let group;
  if (!chain) group = `<p class="small muted" style="margin-top:10px">${ctx.chainUnreachable ? "X Layer could not be reached just now." : "Reading X Layer…"}</p>`;
  else if (locked === 0) group = `<p class="small muted" style="margin-top:10px">Nothing locked on X Layer yet.</p>`;
  else if (!g) group = `<p class="small muted" style="margin-top:10px"><a class="link" href="#/group">Start or join a group</a> to check its points.</p>`;
  else {
    const rows = ctx.standings?.group?.rows ?? [];
    const onKickoff = new Map(rows.map((r) => [r.name, r]));
    // A group of friends is checked member by member. A brand's group is too big to list, so what
    // is checked is the top of its leaderboard, and your own row, as Kickoff sent them.
    const listed = g.brand ? rows.map((r) => ({ name: r.name, players: r.players ?? [], you: r.you })) : g.members;
    const seats = listed.map((m) => {
      const ids = m.players ?? [m.player];
      return {
        m,
        fromChain: ids.reduce((sum, id) => sum + (chain.points[id]?.points ?? 0), 0),
        joined: Math.min(...ids.map((id) => chain.joined?.[id] ?? Infinity)),
        here: onKickoff.get(m.name),
      };
    });
    const lines = seats.map(({ m, fromChain, here }) => {
      const same = here?.points === fromChain;
      return `<tr class="${(g.brand ? m.you : sits(m, ctx.mine.player)) ? "you" : ""}"><td></td><td>${esc(m.name)}</td><td>${fromChain}</td><td>${here?.points ?? "–"}</td><td class="pts">${same ? "✓" : '<span class="muted">Not yet</span>'}</td></tr>`;
    });
    // The order too. X Layer knows the players whose picks it holds: taken in Kickoff's order,
    // each must have more points than the next, or the same points and have joined no later.
    const known = seats.filter((x) => x.here && Number.isFinite(x.joined)).sort((a, b) => a.here.place - b.here.place);
    const pointsSame = seats.every((x) => x.here?.points === x.fromChain);
    const orderSame = known.every((x, i) => i === 0 || known[i - 1].fromChain > x.fromChain || (known[i - 1].fromChain === x.fromChain && known[i - 1].joined <= x.joined));
    const order = !pointsSame || known.length < 2 ? "" : `<p class="fine muted">${orderSame ? "The order is the same on X Layer. ✓" : "The order on X Layer is different just now."}</p>`;
    group = `<div class="glass clip" style="margin-top:12px"><table class="table"><thead><tr><th></th><th>Player</th><th>On X Layer</th><th>On Kickoff</th><th>Same</th></tr></thead><tbody>${lines.join("")}</tbody></table></div>${order}${g.brand ? '<p class="fine muted">The top of the group\'s leaderboard, and you.</p>' : ""}`;
  }
  // This device's picks whose match X Layer has locked, newest first.
  const mine = chain
    ? Object.entries(ctx.picks)
        .map(([match, entry]) => ({ entry, f: ctx.fixtures[match], lock: chain.matches[match]?.lock }))
        .filter((p) => p.f && p.lock)
        .sort((a, b) => b.f.kickoff - a.f.kickoff)
        .map((p) => `<div class="row"><div class="grow">${comp(p.f.comp)}<div class="title">${teams(p.f)}</div>${MARKETS[p.f.sport] ? `<div class="sub">${MARKETS[p.f.sport]}</div>` : ""}${lockLine(p.lock, p.f.kickoff, p.entry)}</div></div>`)
    : [];
  const read = chain ? `<p class="fine muted">Read at ${clock(chain.at)}, block ${chain.block.toLocaleString("en-GB")}. ${locked} ${locked === 1 ? "match" : "matches"} locked.${ctx.chainUnreachable ? " X Layer could not be reached just now." : ""}</p>` : "";
  const html = `
${titlebar({ heading: "Check it yourself" })}
<p class="sub">Read from X Layer by your browser, not from Kickoff.</p>

${mine.length ? `<h2>Your predictions on X Layer</h2>
<div class="glass">${mine.join("")}</div>` : ""}

<h2>Your group's points</h2>
${group}
${read}

<h2>Kickoff on X Layer</h2>
${copyRow("The league's account", account, shortHex(account))}
${copyRow("TapeOut processor", ON_CHAIN.processor, shortHex(ON_CHAIN.processor))}
${copyRow("Circuits on it", `league ${ON_CHAIN.circuits.league}, football ${ON_CHAIN.circuits.football}, basketball ${ON_CHAIN.circuits.basketball}, tennis ${ON_CHAIN.circuits.tennis}, football result ${ON_CHAIN.circuits.result}, goal goal ${ON_CHAIN.circuits.goalgoal}, exact score ${ON_CHAIN.circuits.score}`)}
<p class="say-so"><a class="link" href="${ON_CHAIN.explorer}/address/${account}" target="_blank" rel="noopener">See the league's account on X Layer</a></p>`;
  return { html, title: "Check it yourself on Kickoff", tab: "check" };
}

export function checkScreen(_, ctx) {
  if (ctx?.real) return checkReal(ctx);
  const shortId = `${check.id.slice(0, 6)}…${check.id.slice(-8)}`;
  const sealed = check.sealed
    .map((s) => `<div class="glass match">${comp(s.comp)}<div class="title">${esc(s.title)}</div>${timeline(s)}${s.late ? `<div class="note red plain">${esc(s.late.note)}</div>` : ""}</div>`)
    .join("");
  const html = `
${titlebar({ heading: "Check it yourself" })}
<p style="margin-top:8px">Nobody can change a prediction after kickoff. Not a player, not the person who started the group, not Kickoff. You don't have to take that on trust. This is what X Layer has on record.</p>

<h2>When the predictions were sealed</h2>
${sealed}

<h2>What was not believed</h2>
${check.notBelieved.map((n) => `<div class="note red"><b>${esc(n.title)}</b> ${esc(n.text)}</div>`).join("")}

<h2>Disputes</h2>
${check.disputes.map((d) => `<div class="note warn"><b>${esc(d.title)}</b> ${esc(d.text)}</div>`).join("")}

<h2>Rebuild the leaderboard without us</h2>
<p class="small">Everything above was read straight from X Layer. Anyone can do the same with one command and get the same leaderboard.</p>
<pre class="cmd">node engine/bin/table.js ${shortId}</pre>
<div class="idrow"><div><small class="muted">Kickoff's id on X Layer</small><br><b>${shortId}</b></div><button type="button" class="btn small quiet" data-copy="${check.id}">Copy</button></div>

<h2>What this cannot prove</h2>
<p class="small">The result of a match comes from a live scores feed. X Layer proves what was recorded and when, not that the feed was right. That is why any player can dispute a result, and why a dispute can never be hidden.</p>
${SAMPLE_NOTE}`;
  return { html, title: "Check it yourself on Kickoff", tab: "check" };
}

// ------------------------------------------------------------------------------------ group

const SPORT_WORDS = { football: "Football", basketball: "Basketball" };

/** A box to type in, with its label. */
function field({ label, name, value = "", max, hint = "", extra = "" }) {
  return `<label>${label}<input name="${name}" value="${esc(value)}" maxlength="${max}" autocomplete="off" autocapitalize="words" spellcheck="false" ${extra}>${hint ? `<span class="hint">${hint}</span>` : ""}</label>`;
}

/** A choice between a few things, shown side by side. The first is chosen. */
function choice({ name, label, options }) {
  return `<div class="either" role="radiogroup" aria-label="${label}">${options.map(([value, words], i) => `<label><input type="radio" name="${name}" value="${value}"${i === 0 ? " checked" : ""}><span>${words}</span></label>`).join("")}</div>`;
}

/**
 * Start a group: for friends, or for a brand. Choosing Brand shows what a brand's group needs:
 * who runs it, the prize, how many winners share it, what it is paid in, and its last day.
 */
function startForm(mine) {
  return `<form class="glass form" data-form="start" data-kind="friends" novalidate>
  <h2>Start a group</h2>
  ${choice({ name: "kind", label: "Who the group is for", options: [["friends", "Friends"], ["brand", "Brand"]] })}
  <p class="sub for-friends">You get a code to share. Anyone with the code can join.</p>
  <p class="sub for-brand">For a brand or a community. Up to 5,000 players, and a prize for the top of the leaderboard.</p>
  ${field({ label: "Group name", name: "name", max: 40 })}
  ${field({ label: "Your name", name: "playerName", value: mine.name, max: 24, hint: "What everyone sees on the leaderboard." })}
  <div class="for-brand">
    ${field({ label: "Brand name", name: "brand", max: 40, hint: "Players see: Run by this name." })}
    <div class="duo">
      ${field({ label: "Prize", name: "amount", max: 9, extra: 'inputmode="numeric" placeholder="300"' })}
      <div class="lab">Paid in${choice({ name: "token", label: "What the prize is paid in", options: PAID_IN.map((t) => [t, t]) })}</div>
    </div>
    <div class="duo days">
      ${field({ label: "Winners", name: "winners", value: "1", max: 2, extra: 'inputmode="numeric"' })}
      <label>Last day<input type="date" name="lastDay"></label>
    </div>
    <span class="hint" data-share></span>
    <span class="hint">You pay the winners yourself, on X Layer, when the group ends. Kickoff never holds the prize.</span>
  </div>
  <fieldset class="plays">
    <legend>What this group plays</legend>
    ${Object.keys(COMPETITIONS).map((key) => `<label class="tick"><input type="checkbox" name="plays" value="${key}" checked>${comp(key)}<span class="muted">${SPORT_WORDS[COMPETITIONS[key].sport]}</span></label>`).join("")}
    <span class="hint for-friends">You can change this later.</span>
  </fieldset>
  <button class="btn go" type="submit">Start group</button>
  <p class="say-so" data-form-out role="status"></p>
</form>`;
}

function joinForm(mine) {
  return `<form class="glass form" data-form="join" novalidate>
  <h2>Join with a code</h2>
  <p class="sub">Ask whoever started the group for its code.</p>
  ${field({ label: "Invite code", name: "code", max: 12, hint: "It looks like BALLERS-4821.", extra: 'autocapitalize="characters"' })}
  ${field({ label: "Your name", name: "playerName", value: mine.name, max: 24 })}
  <button class="btn go" type="submit">Join group</button>
  <p class="say-so" data-form-out role="status"></p>
</form>`;
}

const OFFLINE_NOTE = `<div class="note warn" style="margin-top:14px"><b>Kickoff could not be reached.</b> This is what this phone last saw. It will catch up when you are back online.</div>`;
const DEVICE_NOTE = `<div class="note" style="margin-top:16px"><b>No sign-up.</b> A wallet is optional: you can link one. This phone and browser become your player. Use the same ones each time, and do not clear the browser's saved data, or Kickoff will not know it is you.</div>`;

/** For someone on a new phone: linking the wallet they linked before brings their groups back. */
const WALLET_BACK = `<p class="wallet-row"><span class="muted">Linked a wallet before?</span> <button type="button" class="link" data-link-wallet>Bring my groups back</button></p>`;
/** Where what happened when a wallet was asked for is said. */
const WALLET_OUT = `<p class="say-so muted" data-wallet-out role="status"></p>`;

/** A wallet's address, shortened to its two ends. */
const shortWallet = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * The group screen. `arg` is "start" or "join" to show just that form.
 * With no group yet, both forms are shown.
 */
const playersWord = (n) => `${n.toLocaleString("en-GB")} ${n === 1 ? "player" : "players"}`;

const PLACES = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const pointsWord = (n) => `${n} ${n === 1 ? "point" : "points"}`;

/**
 * Where a brand group's prize stands, under its prize line: when the group ends, who won, and
 * whether each winner has been paid. Kickoff never holds the prize: whoever runs the group pays
 * each winner's linked wallet, and a payment shown is one read from X Layer. Nothing for a group
 * with no end.
 */
function prizeLines(g, ctx) {
  if (!g.ends) return "";
  const when = `${esc(dayLabel(g.ends))}, ${clock(g.ends)}`;
  if (ctx.now < g.ends) return `<p class="sub">Ends ${when}.</p>`;
  if (!g.decided) return `<p class="sub">Ended ${when}. The ${g.share ? "winners are" : "winner is"} named when the last result is in.</p>`;
  const winners = g.winners ?? [];
  if (winners.length === 0) return `<p class="sub">Ended ${when}. Nobody scored, so there is no winner.</p>`;
  const rows = winners
    .map((w) => {
      const state = w.paid
        ? `<a class="link" href="${ON_CHAIN.explorer}/tx/${esc(w.paid.tx)}" target="_blank" rel="noopener">Paid ${esc(w.paid.what)}</a>`
        : '<span class="muted small">Not paid yet</span>';
      return `<div class="row"><div class="grow"><div class="title" style="margin:0">${esc(w.name)}${w.you ? '<span class="tag">you</span>' : ""}</div><div class="sub">${PLACES[w.place - 1] ?? w.place} · ${pointsWord(w.points)}</div></div>${state}</div>`;
    })
    .join("");
  const mine = winners.find((w) => w.you && !w.paid);
  const note = !mine ? "" : mine.linked
    ? '<p class="sub">Your prize is paid to the wallet you linked.</p>'
    : '<div class="note warn" style="margin-top:12px"><b>You won.</b> Link a wallet below, so your prize can be paid to it.</div>';
  return `<p class="sub">Ended ${when}.</p>
<h2>${winners.length === 1 ? "Winner" : "Winners"}</h2>
<div class="glass">${rows}</div>
${note}`;
}

/**
 * For whoever started a brand's group, once it has winners: who to pay, how much, and where.
 * They pay from their own wallet and paste the payment's transaction. It counts only after
 * Kickoff's robot has read it on X Layer.
 */
function payLines(g) {
  if (!g.organiser || !g.decided || !g.toPay?.length) return "";
  const rows = g.toPay
    .map((w) => {
      const who = `<div class="row"><div class="grow"><div class="title" style="margin:0">${esc(w.name)}</div><div class="sub">${PLACES[w.place - 1] ?? w.place}${w.what ? ` · ${esc(w.what)}` : ""}</div></div>${w.wallet ? `<button type="button" class="btn small quiet" data-copy="${esc(w.wallet)}">Copy wallet</button>` : ""}</div>`;
      if (!w.wallet) return `${who}<p class="sub pay-say">Has not linked a wallet yet. Their Group screen asks them to.</p>`;
      if (w.checking) return `${who}<p class="sub pay-say"><b>${esc(shortWallet(w.wallet))}</b></p><p class="sub pay-say">Checking your payment on X Layer. This takes a few minutes.</p>`;
      return `${who}<p class="sub pay-say"><b>${esc(shortWallet(w.wallet))}</b></p>
<form class="paid" data-form="paid" novalidate>
  <input type="hidden" name="code" value="${esc(g.code)}"><input type="hidden" name="place" value="${w.place}">
  <input name="tx" aria-label="The payment's transaction, for ${esc(w.name)}" placeholder="Payment's transaction, 0x…" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="80">
  <button class="btn small go" type="submit">Mark as paid</button>
  <p class="say-so${w.refused ? " warn" : ""}" data-form-out role="status">${w.refused ? esc(w.refused) : ""}</p>
</form>`;
    })
    .join("");
  const token = g.payIn ? `<p class="fine muted">${esc(g.payIn.symbol)} on X Layer is the token ${esc(shortWallet(g.payIn.address))}. <button type="button" class="link" data-copy="${esc(g.payIn.address)}">Copy its address</button></p>` : "";
  return `<h2>Pay the winners</h2>
<p class="sub">Send each winner their share on X Layer, from your own wallet. Then paste the payment's transaction here. Kickoff reads it on X Layer and shows everyone it was paid.</p>
<div class="glass pay">${rows}</div>
${token}`;
}

/** A link back to the Group screen, in the words that fit whether this phone is in a group. */
const backToGroup = (g) => `<a href="#/group">${g ? `Back to ${esc(g.name)}` : "Back"}</a>`;

/** The first phone: get a one-time code that carries this player to another phone (lib/move.js). */
function moveScreen(ctx) {
  const m = ctx.moving;
  const html = `
${titlebar({ heading: "Move to another phone" })}
<p class="sub">${backToGroup(ctx.mine.group)}</p>
<div class="glass form">
  <h2>Play on another phone</h2>
  <p class="sub">Get a code here and type it on your other phone. That phone becomes you: same name, same groups, same points. This one keeps working.</p>
  ${m
    ? `<div class="glass invite"><div><small class="muted">One-time code</small><b>${esc(m.code)}</b></div></div>
  <p class="sub">It works once and runs out at ${clock(m.until)}. Anyone who has it becomes you, so keep it to yourself.</p>${m.left > 0 ? `
  <p class="sub">${m.left} of your predictions did not fit and stay on this phone. They still count.</p>` : ""}`
    : `<button class="btn go" type="button" data-move-start>Get a code</button>`}
  <p class="say-so" data-move-out role="status"></p>
</div>
<p class="wallet-row"><span class="muted">Holding the other phone?</span> <a class="link" href="#/group/code">Enter a code</a></p>`;
  return { html, title: "Move to another phone on Kickoff", tab: "group", real: true };
}

/** The other phone: type the code, and this phone becomes that player. */
function codeScreen(ctx) {
  const mine = ctx.mine;
  const html = `
${titlebar({ heading: "Enter a code" })}
<p class="sub">${backToGroup(mine.group)}</p>
<form class="glass form" data-form="code" novalidate>
  <h2>Bring your player here</h2>
  <p class="sub">Type the code showing on your other phone.</p>
  ${field({ label: "One-time code", name: "code", max: 9, hint: "It looks like ABCD-EFGH.", extra: 'autocapitalize="characters"' })}
  ${mine.group ? `<p class="sub">This phone is playing as <b>${esc(mine.name)}</b> now. The code replaces that.</p>` : ""}
  <button class="btn go" type="submit">Bring my player here</button>
  <p class="say-so" data-form-out role="status"></p>
</form>
<p class="sub">No code yet? On your other phone, open Group and choose "Move to another phone".</p>`;
  return { html, title: "Enter a code on Kickoff", tab: "group", real: true };
}

/** Under the start and join forms: a way in for someone who already plays on another phone. */
const MOVE_HERE = `<p class="wallet-row"><span class="muted">Playing on another phone?</span> <a class="link" href="#/group/code">Bring my player here</a></p>`;

export function groupScreen(arg, ctx) {
  const mine = ctx.mine;
  const g = mine.group;
  if (arg === "move") return moveScreen(ctx);
  if (arg === "code") return codeScreen(ctx);

  if (!g || arg === "start" || arg === "join") {
    const forms = arg === "start" ? startForm(mine) : arg === "join" ? joinForm(mine) : `<div class="pair">${startForm(mine)}${joinForm(mine)}</div>`;
    const heading = arg === "start" ? "Start a group" : arg === "join" ? "Join a group" : "Your group";
    const html = `
${titlebar({ heading })}
<p class="sub">${g ? `<a href="#/group">Back to ${esc(g.name)}</a>` : arg === "start" ? 'Have a code already? <a href="#/group/join">Join with a code</a>.' : arg === "join" ? 'No code yet? <a href="#/group/start">Start a group</a>.' : "Play with your friends. Start a group and share its code, or join one with a code."}</p>
${mine.offline ? OFFLINE_NOTE : ""}
${forms}
${g ? "" : `<div class="ways-in">${mine.wallet ? "" : WALLET_BACK}${MOVE_HERE}</div>${mine.wallet ? "" : `
${WALLET_OUT}`}`}
${DEVICE_NOTE}`;
    return { html, title: `${heading} on Kickoff`, tab: "group", real: true };
  }

  // A group run by a brand: nobody in it started it, and it is too big to list.
  const brand = typeof g.brand === "string" ? g.brand : null;
  const starter = brand ? null : g.members.find((m) => sits(m, g.startedBy));
  const isStarter = brand ? false : starter ? sits(starter, mine.player) : g.startedBy === mine.player;
  const count = playersWord(brand ? (g.players ?? g.members.length) : g.members.length);
  const nextId = nextUp(ctx, g.plays);
  // In a group of friends, anyone can copy a reminder to paste into the group's chat.
  const reminder = brand ? null : reminderFor(ctx, g);
  // A brand's group that has ended takes nobody new, so its code is no longer offered.
  const over = Boolean(brand && g.ends && ctx.now >= g.ends);
  const plays = Object.keys(COMPETITIONS)
    .map((key) => {
      const on = g.plays.includes(key);
      const control = isStarter
        ? `<button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${esc(COMPETITIONS[key].name)}" data-plays="${key}"><i></i></button>`
        : `<span class="muted small">${on ? "On" : "Off"}</span>`;
      // A competition that is out of season has nothing to pick, and says so.
      const any = Object.values(ctx.fixtures).some((f) => f.comp === key && !hasClosed(ctx.now, f.kickoff));
      return `<div class="row"><div class="grow">${comp(key, "big")}<div class="sub">${SPORT_WORDS[COMPETITIONS[key].sport]}${any ? "" : " · No matches right now"}</div></div>${control}</div>`;
    })
    .join("");
  // A wallet is optional. Your own row offers the link, and any seat with one says so.
  const players = g.members
    .map((m) => {
      const me = sits(m, mine.player);
      const linked = m.linked || (me && Boolean(mine.wallet));
      const under = [m === starter ? "Started the group" : "", me && mine.wallet ? esc(shortWallet(mine.wallet)) : ""].filter(Boolean).join(" · ");
      const side = linked ? '<span class="state plain">Wallet linked</span>' : me ? '<button type="button" class="btn small quiet" data-link-wallet>Link a wallet</button>' : "";
      return `<div class="row"><div class="grow"><div class="title" style="margin:0">${esc(m.name)}${me ? '<span class="tag">you</span>' : ""}</div>${under ? `<div class="sub">${under}</div>` : ""}</div>${side}</div>`;
    })
    .join("");
  const others = mine.groups.filter((other) => other.code !== g.code);
  const switcher = others.length
    ? `<h2>Your other groups</h2>
<div class="glass">${others.map((o) => `<div class="row"><div class="grow"><div class="title" style="margin:0">${esc(o.name)}</div><div class="sub">${o.brand ? `Run by ${esc(o.brand)} · ` : ""}${playersWord(o.brand ? (o.players ?? o.members.length) : o.members.length)}</div></div><button type="button" class="btn small quiet" data-choose="${esc(o.code)}">Open</button></div>`).join("")}</div>`
    : "";
  const html = `
${titlebar({ heading: esc(g.name) })}
<p class="sub">${brand ? `Run by ${esc(brand)}${g.organiser ? ". You started this group" : ""}` : isStarter ? "You started this group" : starter ? `${esc(starter.name)} started this group` : "Your group"}. ${count}.</p>
${brand && g.prize ? `<p class="sub prize"><b>Prize:</b> ${esc(g.prize)}</p>` : ""}
${brand ? prizeLines(g, ctx) : ""}
${brand ? payLines(g) : ""}
${mine.offline ? OFFLINE_NOTE : ""}

${nextId ? `${nextCard(ctx, nextId)}
${reminder ? `<div class="remind"><a class="link" href="#/league">See every match</a><button type="button" class="btn small quiet" data-copy="${esc(reminder)}" data-then="Reminder copied. Paste it in your group chat.">Remind my group</button></div>
<p class="say-so muted" data-copy-out role="status"></p>` : `<p class="say-so"><a class="link" href="#/league">See every match</a></p>`}` : `<div class="note" style="margin-top:14px">No matches are open for this group right now. New ones arrive by themselves.</div>`}

${over ? "" : `<div class="glass invite"><div><small class="muted">Invite code</small><b>${esc(g.code)}</b></div><button type="button" class="btn small go" data-copy="${esc(g.code)}">Copy</button></div>
<p class="sub">${brand ? 'Anyone with this code can join. They choose "Join with a code" on Kickoff.' : 'Send this code to your friends. They choose "Join with a code" on Kickoff.'}</p>`}

<h2>What this group plays</h2>
<div class="glass">${plays}</div>
<p class="say-so muted" data-note-out role="status">${isStarter ? "" : brand ? `${esc(brand)} chose these.` : `Only ${starter ? esc(starter.name) : "whoever started the group"} can change this.`}</p>
<p class="fine muted">Fixtures and results come in by themselves from live sports data.</p>

<h2>${brand ? "You" : "Players"}</h2>
<div class="glass">${players}</div>
${brand ? '<p class="fine muted">This group is too big to list. Its leaderboard is on the <a href="#/league">League</a> tab.</p>' : ""}
<p class="say-so muted" data-wallet-out role="status"></p>
${switcher}

<div class="more"><a href="#/group/start">Start another group</a><a href="#/group/join">Join another group</a><a href="#/group/move">Move to another phone</a></div>`;
  return { html, title: `${g.name} on Kickoff`, tab: "group", real: true };
}

/** The frame around every screen: the side menu, the top bar, and the bottom menu. */
export function frame() {
  const items = [["league", "League"], ["record", "My record"], ["check", "Check"], ["group", "Group"]];
  const links = items.map(([key, label]) => `<a href="#/${key}" data-tab="${key}">${label}</a>`).join("");
  return `
<aside class="side">
  <a class="mark" href="#/">${MARK}Kickoff</a>
  <nav aria-label="Kickoff">${links}</nav>
  <div class="me glass" data-me hidden><small class="muted">Playing as</small><br><b data-me-name></b></div>
</aside>
<header class="top">
  <a class="mark" href="#/">${MARK}Kickoff</a>
  <div class="right"><a class="where" href="#/group" data-where>Your group</a>${TOGGLE}</div>
</header>
<main id="view" tabindex="-1"></main>
<nav class="tabs" aria-label="Kickoff">${links}</nav>`;
}
