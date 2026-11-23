// The screens. Each one is a plain function that takes nothing from the browser and returns
// { html, title, tab, wide, public }, so every screen can be drawn and checked without a browser.

import { COMPETITIONS, check, fixtures, group, match, record, scores, today, voided, week } from "./data/sample.js";
import { MARK, SAMPLE_NOTE, TOGGLE, comp, esc, stamp, titlebar } from "./lib/html.js";
import { ordinal, placeName, standings } from "./lib/standings.js";

const table = standings(scores);
const you = table.find((row) => row.name === group.you);
const sealedCount = Object.values(fixtures).filter((f) => f.state === "sealed").length;
const startWord = (f) => (COMPETITIONS[f.comp].sport === "basketball" ? "tip-off" : "kickoff");
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
      <a class="btn go" href="#/group">Start a group</a>
      <a class="btn quiet" href="#/league">Join with a code</a>
    </div>
    <p class="nobet">No betting. No money. Just who got it right.</p>
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

function fixtureRow(id) {
  const f = fixtures[id];
  const action =
    f.state === "sealed"
      ? `<a class="sealed-box" href="#/pick/${id}" aria-label="Your pick is sealed. Change it.">Sealed</a>`
      : `<a class="btn small go" href="#/pick/${id}">Pick</a>`;
  return `<div class="row" data-comp="${f.comp}"><div class="grow">${comp(f.comp)}<div class="title">${teams(f)}</div><div class="sub">${f.time}. Picks close ${f.closes}.</div></div>${action}</div>`;
}

function weekHtml() {
  const days = week.days
    .map((day) => {
      const ids = Object.keys(fixtures).filter((id) => fixtures[id].day === day);
      return `<div data-day><div class="day">${esc(day)}</div><div class="glass">${ids.map(fixtureRow).join("")}</div></div>`;
    })
    .join("");
  const chips = Object.keys(COMPETITIONS)
    .map((key) => `<button type="button" data-filter="${key}" aria-pressed="false">${comp(key)}</button>`)
    .join("");
  return `
  <h2>This week</h2>
  <div class="chips" role="group" aria-label="Show one competition"><button type="button" data-filter="all" aria-pressed="true">All</button>${chips}</div>
  <p class="small muted" style="margin:10px 0 0">You have picked ${sealedCount} of ${week.total} matches. Pick as many as you like.</p>
  ${days}
  <p class="small muted" data-empty hidden style="margin-top:14px">No matches in this competition this week.</p>
  <p class="say-so"><a class="link" href="#/league" data-preview-note="In this preview only five of the week's matches are shown.">Show all ${week.total} matches this week</a></p>`;
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

export function league() {
  const next = fixtures[week.nextUp];
  const html = `
${titlebar({
  eyebrow: esc(today),
  heading: esc(group.name),
  actions: `<a class="btn small quiet" href="#/group">Invite a friend</a><a class="btn small go" href="#/pick/${week.nextUp}">Make a pick</a>`,
})}
<p class="sub phone-only">${group.players.length} players. You are ${ordinal(you.position)}.</p>

<div class="tiles">
  <div class="glass tile"><small>Your place</small><b>${ordinal(you.position)}</b><span>${you.sharedWith.length ? `shared with ${esc(you.sharedWith.join(" and "))}` : `of ${group.players.length}`}</span></div>
  <div class="glass tile"><small>Your points</small><b>${you.points}</b><span>${you.threes} spot on, ${you.ones} right winner</span></div>
  <div class="glass tile"><small>Picked this week</small><b>${sealedCount} of ${week.total}</b><span>pick as many as you like</span></div>
  <div class="glass tile"><small>Next to close</small><b>${esc(week.nextUpCloses)}</b><span>${teams(next)}</span></div>
</div>

<div class="slip glass edge ${next.comp} phone-only" style="margin-top:18px">
  <div class="body">
    ${comp(next.comp)}
    <div class="teams">${teams(next)}</div>
    <div class="when">${esc(week.nextUpWhen)}</div>
    <span class="clock">Picks close in ${esc(week.nextUpCloses)}</span>
  </div>
  <div class="stub"><a class="btn go" href="#/pick/${week.nextUp}">Make your pick</a></div>
</div>

<div class="cols">
  <section>${weekHtml()}</section>
  <section>
    <h2>Table</h2>
    ${tableHtml()}
    <h2>Played</h2>
    ${playedHtml(3)}
    <p class="say-so"><a class="link" href="#/record">Every match you picked</a></p>
  </section>
</div>
${SAMPLE_NOTE}`;
  return { html, title: `${group.name} on Kickoff`, tab: "league", wide: true };
}

// ------------------------------------------------------------------------------------ make a pick

export function pick(id) {
  const f = fixtures[id];
  if (!f) return league();
  const start = startWord(f);
  const football = COMPETITIONS[f.comp].sport === "football";
  const picker = football
    ? `<h3>What will the score be?</h3>
      ${[f.home, f.away]
        .map(
          (team, i) => `<div class="score"><span class="team">${esc(team)}</span>
        <div class="stepper"><button type="button" data-step="-1" aria-label="One fewer for ${esc(team)}">−</button><output aria-label="${esc(team)}'s goals">${i === 0 ? 2 : 1}</output><button type="button" data-step="1" aria-label="One more for ${esc(team)}">+</button></div></div>`,
        )
        .join("")}`
    : `<h3>Who wins?</h3>
      <div class="choices" role="group" aria-label="Who wins">
        <button type="button" class="choice" aria-pressed="true">${esc(f.home)}<small>home</small></button>
        <button type="button" class="choice" aria-pressed="false">${esc(f.away)}<small>away</small></button>
      </div>
      <h3>By how many points?</h3>
      <div class="choices" role="group" aria-label="By how many points">
        ${["1 to 5", "6 to 10", "11 to 15", "16 or more"].map((band, i) => `<button type="button" class="choice" aria-pressed="${i === 1}">${band}</button>`).join("")}
      </div>`;
  const rules = football
    ? ["The exact score gets 3 points.", "The right winner, or calling a draw, gets 1 point.", "It is the score after 90 minutes. Extra time and penalties do not count."]
    : ["The right winner gets 1 point.", "Add 2 points if you also get how much they win by.", "Overtime counts."];
  const html = `
<a class="back" href="#/league">Back to the league</a>
<div class="head">
  ${titlebar({ before: comp(f.comp), heading: teams(f), headingClass: "under" })}
  <div class="muted" style="margin-top:6px">${esc(f.day)}, ${start} ${f.time}</div>
  <span class="clock">Picks close at ${f.closes}, ${esc(f.closesIn)}</span>
</div>
<div class="glass picker">${picker}</div>
<ul class="rules">${rules.map((r) => `<li>${r}</li>`).join("")}</ul>
<button type="button" class="btn go" data-seal>Seal my pick</button>
<p class="after" data-seal-note role="status">Nobody can see a sealed pick, not even Kickoff. You can change yours until picks close. It is kept on this phone, so come back on this phone after ${start} and it opens by itself.</p>
${SAMPLE_NOTE}`;
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

export function groupScreen() {
  const plays = group.plays
    .map(
      (p) => `<div class="row"><div class="grow">${comp(p.comp, "big")}<div class="sub">${esc(p.note)}</div></div>
      <button type="button" class="switch" role="switch" aria-checked="${p.on}" aria-label="${esc(COMPETITIONS[p.comp].name)}"><i></i></button></div>`,
    )
    .join("");
  const players = group.players
    .map((name) => `<div class="row"><div class="grow"><div class="title" style="margin:0">${esc(name)}${name === group.you ? '<span class="tag">you</span>' : ""}</div></div>${name === group.you ? "" : `<button type="button" class="small muted" data-preview-note="Removing a player is not switched on in this preview.">Remove</button>`}</div>`)
    .join("");
  const html = `
${titlebar({ heading: "Your group" })}
<p class="sub">You started ${esc(group.name)}. ${group.players.length} players.</p>

<div class="glass invite"><div><small class="muted">Invite code</small><b>${esc(group.code)}</b></div><button type="button" class="btn small go" data-copy="${esc(group.code)}">Copy</button></div>

<h2>What this group plays</h2>
<div class="glass">${plays}</div>
<div class="note" style="margin-top:12px">Fixtures and results come in by themselves from live sports data. Nobody in the group adds a match or enters a score, so nobody can get one wrong on purpose.</div>

<h2>Players</h2>
<div class="glass">${players}</div>
<p class="say-so muted" data-note-out role="status"></p>
${SAMPLE_NOTE}`;
  return { html, title: `${group.name} on Kickoff`, tab: "group" };
}

/** The frame around every screen: the side menu, the top bar, and the bottom menu. */
export function frame() {
  const items = [["league", "League"], ["record", "My record"], ["check", "Check"], ["group", "Group"]];
  const links = items.map(([key, label]) => `<a href="#/${key}" data-tab="${key}">${label}</a>`).join("");
  return `
<aside class="side">
  <a class="mark" href="#/">${MARK}Kickoff</a>
  <nav aria-label="Kickoff">${links}</nav>
  <div class="me glass"><small class="muted">Signed in as</small><br><b>${esc(group.you)}</b></div>
</aside>
<header class="top">
  <a class="mark" href="#/">${MARK}Kickoff</a>
  <div class="right"><a class="where" href="#/group" data-where>${esc(group.name)}</a>${TOGGLE}</div>
</header>
<main id="view" tabindex="-1"></main>
<nav class="tabs" aria-label="Kickoff">${links}</nav>`;
}
