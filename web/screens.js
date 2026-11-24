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
import { sits } from "./lib/groups.js";
import { MARK, REAL_MATCHES_NOTE, SAMPLE_NOTE, TOGGLE, comp, esc, stamp, titlebar } from "./lib/html.js";
import { BAND_KEYS, bandWords, pickWords } from "./lib/picks.js";
import { standing } from "./lib/sync.js";
import { ordinal, placeName, standings } from "./lib/standings.js";
import { clock, closesAt, dayLabel, hasClosed, howLong, todayLabel } from "./lib/time.js";

const table = standings(scores);
const you = table.find((row) => row.name === group.you);
const startWord = (f) => (COMPETITIONS[f.comp].sport === "basketball" ? "tip-off" : "kickoff");
const yourPick = (ctx, id) => ctx.picks[ctx.matchIds[id]] ?? null;
const inOrder = (ctx) => Object.keys(ctx.fixtures).sort((a, b) => ctx.fixtures[a].kickoff - ctx.fixtures[b].kickoff);
const teams = (f) => `${esc(f.home)} v ${esc(f.away)}`;
const pointsCell = (points) => `<div class="points ${points === 0 ? "zero" : ""}">${points}</div>`;

// ------------------------------------------------------------------------------------ home

export function home() {
  const html = `
<div class="hero">
  <div class="say">
    <h1>Say the score before kickoff. Prove it after.</h1>
    <p class="lede">Pick the results of real matches with your friends. Every pick is sealed before the match starts, so nobody can change theirs once the result is in.</p>
  </div>
  <div class="slip glass demo">
    <div class="body">
      ${comp("pl")}
      <div class="teams">Arsenal v Chelsea</div>
      <div class="when">Ada's pick</div>
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
    <div class="glass" style="margin-top:14px">
      <div class="row"><div class="grow"><div class="title" style="margin:0">Football</div>
        <div class="comps">${comp("pl")}${comp("cl")}</div>
        <div class="sub">The exact score gets 3 points. The right winner or a draw gets 1.</div></div></div>
      <div class="row"><div class="grow"><div class="title" style="margin:0">Basketball</div>
        <div class="comps">${comp("nba")}${comp("wnba")}</div>
        <div class="sub">The winner gets 1 point. Add 2 if you also get how much they win by.</div></div></div>
      <div class="row"><div class="grow"><div class="title" style="margin:0">Tennis</div><div class="sub"><i>Coming later.</i></div></div></div>
    </div>
  </section>
  <section>
    <h2>How a match goes</h2>
    <ol class="steps">
      <li><b>Before kickoff, you pick.</b> Your pick is sealed on your phone. Nobody can see it, not even Kickoff.</li>
      <li><b>Ten minutes before kickoff, picks close.</b> X Layer stamps the time. A pick that turns up later does not count.</li>
      <li><b>After the match, every pick opens.</b> Everyone sees what everyone said, and your group's table updates.</li>
    </ol>
  </section>
  <section>
    <h2>You don't have to trust us</h2>
    <p>Every pick's seal and every result is kept on X Layer through TapeOut. Anyone can read the record and rebuild the table themselves.</p>
    <a class="btn quiet" href="#/check" style="margin-top:14px">See how to check it</a>
  </section>
</div>
${SAMPLE_NOTE}`;
  return { html, title: "Kickoff", public: true, wide: true };
}

// ------------------------------------------------------------------------------------ league

function fixtureRow(ctx, id) {
  const f = ctx.fixtures[id];
  let action;
  const mine = yourPick(ctx, id);
  const stands = mine ? standing(mine, f, ctx.now) : null;
  if (stands === "waiting" || stands === "missed" || stands === "problem") action = `<a class="sealed-box unsent" href="#/pick/${id}" aria-label="Your pick is sealed but has not reached Kickoff. See why.">Not entered</a>`;
  else if (mine) action = `<a class="sealed-box" href="#/pick/${id}" aria-label="Your pick is sealed. See it or change it.">Sealed</a>`;
  else if (hasClosed(ctx.now, f.kickoff)) action = `<span class="small muted">Closed</span>`;
  else action = `<a class="btn small go" href="#/pick/${id}">Pick</a>`;
  return `<div class="row" data-comp="${f.comp}"><div class="grow">${comp(f.comp)}<div class="title">${teams(f)}</div><div class="sub">${clock(f.kickoff)}. Picks close ${clock(closesAt(f.kickoff))}.</div></div>${action}</div>`;
}

function weekHtml(ctx) {
  const ids = inOrder(ctx);
  const picked = ids.filter((id) => yourPick(ctx, id)).length;
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
  <p class="small muted" style="margin:10px 0 0">You have picked ${picked} of ${total} matches. Pick as many as you like.</p>
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
  return `<div class="glass clip"><table class="table"><thead><tr><th><span hidden>Place</span></th><th>Player</th><th>3-pt picks</th><th>1-pt picks</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table></div>${shared}`;
}

function playedHtml(limit) {
  const rows = record
    .slice(0, limit)
    .map((r) => `<div class="row"><div class="grow">${comp(r.comp)}<div class="title"><a href="#/match/${r.id}">${esc(r.title)}</a></div><div class="sub">${esc(r.said)}</div></div>${pointsCell(r.points)}</div>`)
    .join("");
  return `<div class="glass">${rows}</div>`;
}

/** The next match to pick: the one closing soonest that you have not picked, or failing that any still open. */
export function nextUp(ctx) {
  const open = inOrder(ctx).filter((id) => !hasClosed(ctx.now, ctx.fixtures[id].kickoff));
  return open.find((id) => !yourPick(ctx, id)) ?? open[0] ?? null;
}

export function league(_, ctx) {
  const ids = inOrder(ctx);
  const picked = ids.filter((id) => yourPick(ctx, id)).length;
  const nextId = nextUp(ctx);
  const next = nextId ? ctx.fixtures[nextId] : null;
  const closesIn = next ? howLong(ctx.now, closesAt(next.kickoff)) : "";
  const html = `
${titlebar({
  eyebrow: esc(todayLabel(ctx.now)),
  heading: esc(group.name),
  actions: `<a class="btn small quiet" href="#/group">Invite a friend</a>${next ? `<a class="btn small go" href="#/pick/${nextId}">Make a pick</a>` : ""}`,
})}
<p class="sub phone-only">${group.players.length} players. You are ${ordinal(you.position)}.</p>

<div class="tiles">
  <div class="glass tile"><small>Your place</small><b>${ordinal(you.position)}</b><span>${you.sharedWith.length ? `shared with ${esc(you.sharedWith.join(" and "))}` : `of ${group.players.length}`}</span></div>
  <div class="glass tile"><small>Your points</small><b>${you.points}</b><span>${you.threes} spot on, ${you.ones} right winner</span></div>
  <div class="glass tile"><small>Picked this week</small><b>${picked} of ${ctx.real ? ids.length : week.total}</b><span>pick as many as you like</span></div>
  <div class="glass tile"><small>Next to close</small><b>${next ? esc(closesIn) : "Nothing open"}</b><span>${next ? teams(next) : "new matches arrive each week"}</span></div>
</div>

${
  next
    ? `<div class="slip glass edge ${next.comp} phone-only" style="margin-top:18px">
  <div class="body">
    ${comp(next.comp)}
    <div class="teams">${teams(next)}</div>
    <div class="when">${esc(dayLabel(next.kickoff))}, ${clock(next.kickoff)}.</div>
    <span class="clock">Picks close in ${esc(closesIn)}</span>
  </div>
  <div class="stub"><a class="btn go" href="#/pick/${nextId}">${yourPick(ctx, nextId) ? "See your pick" : "Make your pick"}</a></div>
</div>`
    : ""
}

<div class="cols">
  <section>${weekHtml(ctx)}</section>
  <section>
    <h2>Table</h2>
    ${tableHtml()}
    <h2>Played</h2>
    ${playedHtml(3)}
    <p class="say-so"><a class="link" href="#/record">Every match you picked</a></p>
  </section>
</div>
${ctx.real ? REAL_MATCHES_NOTE : SAMPLE_NOTE}`;
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
    case "locked":
      return mark("", "Locked in");
    case "opened":
      return mark("", "Revealed");
    case "missed":
      return mark("bad", "Not entered in time", "It does not count for this match.");
    default:
      return mark("bad", "Problem", esc(entry.problem));
  }
}

export function pick(id, ctx) {
  const f = ctx.fixtures[id];
  if (!f) return league(null, ctx);
  const start = startWord(f);
  const football = COMPETITIONS[f.comp].sport === "football";
  const entry = yourPick(ctx, id);
  const closed = hasClosed(ctx.now, f.kickoff);
  const editing = !closed && (!entry || ctx.editing === id);
  const rules = football
    ? ["The exact score gets 3 points.", "The right winner, or calling a draw, gets 1 point.", "It is the score after 90 minutes. Extra time and penalties do not count."]
    : ["The right winner gets 1 point.", "Add 2 points if you also get how much they win by.", "Overtime counts."];
  // The one thing said out loud: a private window keeps nothing, so the pick would be lost.
  const notKept = ctx.lasting ? "" : `<div class="note warn" style="margin-top:14px"><b>Private window.</b> This pick will be lost when you close it.</div>`;

  let body;
  if (editing) {
    body = `
<div class="glass picker" data-picker="${football ? "football" : "basketball"}">${pickControls(f, entry)}</div>
<ul class="rules">${rules.map((r) => `<li>${r}</li>`).join("")}</ul>
<button type="button" class="btn go" data-seal="${id}">${entry ? "Seal my new pick" : "Seal my pick"}</button>
<p class="after" data-note-out role="status">Nobody can see it before ${start}. You can change it until picks close.</p>`;
  } else if (entry) {
    body = `
<div class="glass sealed" role="status">
  <div class="small muted">Your pick</div>
  <div class="yours${football ? "" : " words"}">${esc(pickWords(entry, f))}</div>
  <div class="small muted">Sealed at ${clock(entry.sealedAt)} on ${esc(dayLabel(entry.sealedAt))}. Only you can see it.</div>
  ${standingMark(entry, f, ctx)}
</div>
${closed ? "" : `<button type="button" class="btn quiet" data-change="${id}" style="margin-top:14px">Change my pick</button>`}
${entry.replaced ? `<p class="after">Your later pick was not sent in time, so this one counts.</p>` : ""}
${notKept}`;
  } else {
    body = `<div class="note" style="margin-top:6px">Picks for this match have closed.</div>`;
  }

  const html = `
<a class="back" href="#/league">Back to the league</a>
<div class="head">
  ${titlebar({ before: comp(f.comp), heading: teams(f), headingClass: "under" })}
  <div class="muted" style="margin-top:6px">${esc(dayLabel(f.kickoff))}, ${start} ${clock(f.kickoff)}</div>
  <span class="clock">${closed ? "Picks have closed" : `Picks close at ${clock(closesAt(f.kickoff))}, in ${esc(howLong(ctx.now, closesAt(f.kickoff)))}`}</span>
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
    .map((name) => `<div class="row"><div class="grow"><div class="title" style="margin:0">${esc(name)}</div><div class="sub">Not opened yet. It opens the next time ${esc(name)} comes back.</div></div><span class="sealed-box">Sealed</span></div>`)
    .join("");
  const html = `
<a class="back" href="#/league">Back to the league</a>
<div class="final">
  ${titlebar({ before: comp(m.comp), heading: `<span>${esc(m.home)}</span><b>${esc(m.score)}</b><span>${esc(m.away)}</span>`, headingClass: "scoreline" })}
  <div class="muted small">${esc(m.when)}</div>
</div>

<div class="glass proof">
  ${stamp(m.sealedAt, m.sealedDate, 92)}
  <div><b>All ${m.sealedCount} picks were sealed at ${m.sealedAt},</b> ten minutes before kickoff. X Layer stamped the time.<br><a class="link" href="#/check">See the proof</a></div>
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

export function recordScreen() {
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
<h2>Every pick</h2>
<div class="glass">${rows}${voids}</div>
<button type="button" class="btn quiet" style="margin-top:18px" data-preview-note="Sharing is not switched on in this preview.">Share my record</button>
<p class="say-so muted" data-note-out role="status"></p>
${SAMPLE_NOTE}`;
  return { html, title: `${group.you}'s record on Kickoff`, tab: "record" };
}

// ------------------------------------------------------------------------------------ check it yourself

function timeline({ lock, kickoff, late }) {
  const lateHtml = late ? `<div class="dot late" style="left:86%"></div><div class="lab late" style="left:86%">${late.time}<small>refused</small></div>` : "";
  return `<div class="tl" role="img" aria-label="Picks sealed at ${lock}. Kickoff at ${kickoff}.${late ? ` A set sent at ${late.time} was refused.` : ""}"><div class="bar"></div><div class="bar after"></div>
  <div class="dot" style="left:22%"></div><div class="lab" style="left:22%">${lock}<small>picks sealed</small></div>
  <div class="tick" style="left:62%"></div><div class="lab" style="left:62%">${kickoff}<small>kickoff</small></div>${lateHtml}</div>`;
}

export function checkScreen() {
  const shortId = `${check.id.slice(0, 6)}…${check.id.slice(-8)}`;
  const sealed = check.sealed
    .map((s) => `<div class="glass match">${comp(s.comp)}<div class="title">${esc(s.title)}</div>${timeline(s)}${s.late ? `<div class="note red plain">${esc(s.late.note)}</div>` : ""}</div>`)
    .join("");
  const html = `
${titlebar({ heading: "Check it yourself" })}
<p style="margin-top:8px">Nobody can change a pick after kickoff. Not a player, not the person who started the group, not Kickoff. You don't have to take that on trust. This is what X Layer has on record.</p>

<h2>When the picks were sealed</h2>
${sealed}

<h2>What was not believed</h2>
${check.notBelieved.map((n) => `<div class="note red"><b>${esc(n.title)}</b> ${esc(n.text)}</div>`).join("")}

<h2>Disputes</h2>
${check.disputes.map((d) => `<div class="note warn"><b>${esc(d.title)}</b> ${esc(d.text)}</div>`).join("")}

<h2>Rebuild the table without us</h2>
<p class="small">Everything above was read straight from X Layer. Anyone can do the same with one command and get the same table.</p>
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

function startForm(mine) {
  return `<form class="glass form" data-form="start" novalidate>
  <h2>Start a group</h2>
  <p class="sub">You get a code to share. Anyone with the code can join.</p>
  ${field({ label: "Group name", name: "name", max: 40 })}
  ${field({ label: "Your name", name: "playerName", value: mine.name, max: 24, hint: "What your friends will see on the table." })}
  <fieldset class="plays">
    <legend>What this group plays</legend>
    ${Object.keys(COMPETITIONS).map((key) => `<label class="tick"><input type="checkbox" name="plays" value="${key}" checked>${comp(key)}<span class="muted">${SPORT_WORDS[COMPETITIONS[key].sport]}</span></label>`).join("")}
    <span class="hint">You can change this later.</span>
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
const DEVICE_NOTE = `<div class="note" style="margin-top:16px"><b>No sign-up and no wallet.</b> This phone and browser become your player. Use the same ones each time, and do not clear the browser's saved data, or Kickoff will not know it is you.</div>`;

/** For someone on a new phone: linking the wallet they linked before brings their groups back. */
const WALLET_BACK = `<div class="wallet-row"><span class="muted">Linked a wallet before?</span><button type="button" class="btn small quiet" data-link-wallet>Bring my groups back</button></div>
<p class="say-so muted" data-wallet-out role="status"></p>`;

/** A wallet's address, shortened to its two ends. */
const shortWallet = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * The group screen. `arg` is "start" or "join" to show just that form.
 * With no group yet, both forms are shown.
 */
export function groupScreen(arg, ctx) {
  const mine = ctx.mine;
  const g = mine.group;

  if (!g || arg === "start" || arg === "join") {
    const forms = arg === "start" ? startForm(mine) : arg === "join" ? joinForm(mine) : `<div class="pair">${startForm(mine)}${joinForm(mine)}</div>`;
    const heading = arg === "start" ? "Start a group" : arg === "join" ? "Join a group" : "Your group";
    const html = `
${titlebar({ heading })}
<p class="sub">${g ? `<a href="#/group">Back to ${esc(g.name)}</a>` : arg === "start" ? 'Have a code already? <a href="#/group/join">Join with a code</a>.' : arg === "join" ? 'No code yet? <a href="#/group/start">Start a group</a>.' : "Play with your friends. Start a group and share its code, or join one with a code."}</p>
${mine.offline ? OFFLINE_NOTE : ""}
${forms}
${g || mine.wallet ? "" : WALLET_BACK}
${DEVICE_NOTE}`;
    return { html, title: `${heading} on Kickoff`, tab: "group", real: true };
  }

  const starter = g.members.find((m) => sits(m, g.startedBy));
  const isStarter = starter ? sits(starter, mine.player) : g.startedBy === mine.player;
  const count = `${g.members.length} ${g.members.length === 1 ? "player" : "players"}`;
  const plays = Object.keys(COMPETITIONS)
    .map((key) => {
      const on = g.plays.includes(key);
      const control = isStarter
        ? `<button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${esc(COMPETITIONS[key].name)}" data-plays="${key}"><i></i></button>`
        : `<span class="muted small">${on ? "On" : "Off"}</span>`;
      return `<div class="row"><div class="grow">${comp(key, "big")}<div class="sub">${SPORT_WORDS[COMPETITIONS[key].sport]}</div></div>${control}</div>`;
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
<div class="glass">${others.map((o) => `<div class="row"><div class="grow"><div class="title" style="margin:0">${esc(o.name)}</div><div class="sub">${o.members.length} ${o.members.length === 1 ? "player" : "players"}</div></div><button type="button" class="btn small quiet" data-choose="${esc(o.code)}">Open</button></div>`).join("")}</div>`
    : "";
  const html = `
${titlebar({ heading: esc(g.name) })}
<p class="sub">${isStarter ? "You started this group" : starter ? `${esc(starter.name)} started this group` : "Your group"}. ${count}.</p>
${mine.offline ? OFFLINE_NOTE : ""}

<div class="glass invite"><div><small class="muted">Invite code</small><b>${esc(g.code)}</b></div><button type="button" class="btn small go" data-copy="${esc(g.code)}">Copy</button></div>
<p class="sub">Send this code to your friends. They choose "Join with a code" on Kickoff.</p>

<h2>What this group plays</h2>
<div class="glass">${plays}</div>
<p class="say-so muted" data-note-out role="status">${isStarter ? "" : `Only ${starter ? esc(starter.name) : "whoever started the group"} can change this.`}</p>
<div class="note" style="margin-top:12px">Fixtures and results come in by themselves from live sports data. Nobody in the group adds a match or enters a score, so nobody can get one wrong on purpose.</div>

<h2>Players</h2>
<div class="glass">${players}</div>
<p class="say-so muted" data-wallet-out role="status"></p>
${switcher}

<div class="more"><a href="#/group/start">Start another group</a><a href="#/group/join">Join another group</a></div>`;
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
