// Kickoff's website. No build step and nothing to install: plain files a browser runs as they are.

import { ROBOT_KEY, SERVER, SERVER_KEY } from "./config.js";
import { GOAL_GOAL, RESULT, SCORE } from "./engine/picks.js";
import { COMPETITIONS, SAMPLE_LEAGUE, sampleFixtures } from "./data/sample.js";
import { createDevice } from "./lib/device.js";
import { createChain } from "./lib/chain.js";
import { createFixtures } from "./lib/fixtures.js";
import { saveCard } from "./lib/card.js";
import { createGroups } from "./lib/groups.js";
import { brandFrom, shareWords } from "./lib/prize.js";
import { finishMove, isShared, showCode, startMove } from "./lib/move.js";
import { createStore, seal } from "./lib/picks.js";
import { createClient } from "./lib/server.js";
import { syncPicks } from "./lib/sync.js";
import { createTable } from "./lib/table.js";
import { hasClosed } from "./lib/time.js";
import { createWallet } from "./lib/wallet.js";
import { cardOf, checkScreen, frame, groupScreen, home, league, matchScreen, pick, recordScreen } from "./screens.js";

const routes = { "": home, league, pick, match: matchScreen, record: recordScreen, check: checkScreen, group: groupScreen };

let storage = null;
try {
  storage = window.localStorage;
} catch {
  // Some browsers refuse storage altogether. Picks are then kept for this visit only.
}
const store = createStore(storage);
const device = createDevice(store);
const client = createClient({ base: SERVER, device });
const groups = createGroups({ store, device, client });
const wallet = createWallet({ device, client });
// A one-time code this phone is showing, to carry its player to another phone: { code, until, left }.
let moving = null;
const table = createTable({ store, client });
const chain = createChain({ store });
// What the player last chose on the League screen, kept while the screen is drawn again.
const looking = { part: "matches", board: "everyone", week: false };
const matches = createFixtures({ store, client, competitions: COMPETITIONS, sample: { league: SAMPLE_LEAGUE, fixtures: sampleFixtures } });

document.body.insertAdjacentHTML("afterbegin", frame());
const view = document.getElementById("view");
let editing = null; // the fixture whose pick is being changed, if any
let drawing = 0;
let drawnAt = ""; // which matches had closed or started when the screen was last drawn

/** Which matches have closed and which have started: when this changes, the screen is out of date. */
const stage = (ctx) => Object.entries(ctx.fixtures).map(([id, f]) => `${id}:${hasClosed(ctx.now, f.kickoff) ? 1 : 0}${ctx.now >= f.kickoff ? 1 : 0}`).join(",");

/** What is true right now: the time, the matches, this player's groups, and the picks kept on this device. */
async function context() {
  const now = Math.floor(Date.now() / 1000);
  const mine = await groups.view();
  const { real, league, fixtures, matchIds } = await matches.view(now, { member: Boolean(mine.group) });
  // Where this copy of Kickoff is open, for the reminder a player copies to their group.
  const site = `${location.origin}${location.pathname.replace(/index\.html$/, "")}`;
  if (moving && moving.until <= now) moving = null;
  return { now, site, moving: moving ? { ...moving, code: showCode(moving.code) } : null, real, league, fixtures, matchIds, picks: store.all(mine.player), lasting: store.lasting, editing, mine, standings: real ? table.view(mine.group?.code ?? null) : null, chain: real ? chain.view(league) : null, chainUnreachable: chain.unreachable, looking };
}

async function draw({ keepPlace = false } = {}) {
  const mine = ++drawing;
  const [name = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  const ctx = await context();
  if (mine !== drawing) return; // a newer draw has started
  const screen = (routes[name] ?? home)(arg, ctx);
  drawnAt = stage(ctx);
  document.body.classList.toggle("public", Boolean(screen.public));
  view.className = screen.wide ? "wide" : "";
  view.innerHTML = screen.html;
  document.title = screen.title;
  for (const link of document.querySelectorAll("[data-tab]")) {
    if (link.dataset.tab === screen.tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  // The frame's own words: which group this is, and who is playing.
  const where = document.querySelector("[data-where]");
  where.textContent = ctx.mine.group?.name ?? (screen.public ? "See a sample group" : "Start a group");
  where.setAttribute("href", ctx.mine.group || !screen.public ? "#/group" : "#/league");
  const me = document.querySelector("[data-me]");
  me.hidden = !ctx.mine.group;
  me.querySelector("[data-me-name]").textContent = ctx.mine.name;
  if (!keepPlace) window.scrollTo(0, 0);
}

/** The pick as the controls on the screen now show it, or null if it is not finished. */
function pickOnScreen() {
  const picker = view.querySelector("[data-picker]");
  // A football match: up to three predictions, by their kind. One left empty is not made.
  if (picker.dataset.picker === "markets") {
    const chosen = {};
    const result = picker.querySelector('[data-result][aria-pressed="true"]')?.dataset.result;
    if (result) chosen[RESULT] = { result };
    const both = picker.querySelector('[data-both][aria-pressed="true"]')?.dataset.both;
    if (both) chosen[GOAL_GOAL] = { both: both === "yes" };
    const goals = [...picker.querySelectorAll("[data-score] output")].map((o) => o.textContent);
    if (goals.length === 2 && goals.every((g) => /^\d+$/.test(g))) chosen[SCORE] = { home: Number(goals[0]), away: Number(goals[1]) };
    return Object.keys(chosen).length ? chosen : null;
  }
  if (picker.dataset.picker === "football") {
    const [home, away] = [...picker.querySelectorAll("output")].map((o) => Number(o.textContent));
    return { home, away };
  }
  const winner = picker.querySelector('[data-winner][aria-pressed="true"]')?.dataset.winner;
  const band = picker.querySelector('[data-band][aria-pressed="true"]')?.dataset.band;
  return winner && band ? { winner, band } : null;
}

/** Say something short near whatever was pressed, where a screen reader will read it out. */
function say(from, words) {
  const outs = [...view.querySelectorAll("[data-note-out]")];
  const out = outs.find((o) => from.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING) ?? outs.at(-1) ?? from.parentElement;
  out.textContent = words;
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;

  if (target.matches("[data-theme-toggle]")) {
    window.kickoffTheme.flip();
    return;
  }

  // Making a pick: the score steppers and the one-of-several choices.
  if (target.matches("[data-step]")) {
    // An exact score that has not been started shows "–" for both sides: the first press starts it at 0 – 0.
    const block = target.closest("[data-score]");
    for (const o of block?.querySelectorAll("output") ?? []) if (!/^\d+$/.test(o.textContent)) o.textContent = "0";
    const output = target.parentElement.querySelector("output");
    output.textContent = Math.min(15, Math.max(0, Number(output.textContent) + Number(target.dataset.step)));
    return;
  }
  if (target.matches("[data-clear-score]")) {
    for (const o of target.closest("[data-score]").querySelectorAll("output")) o.textContent = "–";
    return;
  }
  if (target.matches(".choice")) {
    // Where a choice may be left unmade, pressing the chosen one again takes it back.
    const undo = target.parentElement.matches("[data-optional]") && target.getAttribute("aria-pressed") === "true";
    for (const other of target.parentElement.querySelectorAll(".choice")) other.setAttribute("aria-pressed", String(other === target && !undo));
    return;
  }
  if (target.matches("[data-seal]")) {
    const several = view.querySelector("[data-picker]").dataset.picker === "markets";
    const chosen = pickOnScreen();
    if (!chosen) {
      say(target, several ? "Make at least one of the three first." : "Choose who wins and by how many points first.");
      return;
    }
    const ctx = await context();
    const fixture = ctx.fixtures[target.dataset.seal];
    try {
      if (several) {
        // Each prediction is sealed by itself. One that has not changed is left exactly as it was.
        for (const id of fixture.group) {
          const one = ctx.fixtures[id];
          const pick = chosen[one.sport];
          const before = ctx.picks[ctx.matchIds[id]];
          if (!pick || (before && JSON.stringify(before.pick) === JSON.stringify(pick))) continue;
          await seal({ store, league: ctx.league, fixture: one, competitions: COMPETITIONS, pick, now: ctx.now, player: ctx.mine.player });
        }
      } else await seal({ store, league: ctx.league, fixture, competitions: COMPETITIONS, pick: chosen, now: ctx.now, player: ctx.mine.player });
      editing = null;
      await draw();
      carry(); // send it, without making the player wait
    } catch (error) {
      say(target, error.message);
    }
    return;
  }
  if (target.matches("[data-change]")) {
    editing = target.dataset.change;
    await draw({ keepPlace: true });
    return;
  }

  // The league screen: show one competition, or all of them.
  if (target.matches("[data-filter]")) {
    const which = target.dataset.filter;
    for (const chip of target.parentElement.children) chip.setAttribute("aria-pressed", String(chip === target));
    let shown = 0;
    for (const day of view.querySelectorAll("[data-day]")) {
      let inDay = 0;
      for (const row of day.querySelectorAll("[data-comp]")) {
        const keep = which === "all" || row.dataset.comp === which;
        row.hidden = !keep;
        if (keep) inDay++;
      }
      day.hidden = inDay === 0;
      shown += inDay;
    }
    view.querySelector("[data-empty]").hidden = shown !== 0;
    return;
  }

  // The league screen: the table of everyone, or of your group.
  if (target.matches("[data-board]")) {
    looking.board = target.dataset.board;
    for (const chip of target.parentElement.children) chip.setAttribute("aria-pressed", String(chip === target));
    for (const board of view.querySelectorAll("[data-board-of]")) board.hidden = board.dataset.boardOf !== target.dataset.board;
    return;
  }
  // The league screen: the star after the player of the week's name says why it is there.
  if (target.matches("[data-week-star]")) {
    looking.week = !looking.week;
    for (const star of view.querySelectorAll("[data-week-star]")) star.setAttribute("aria-expanded", String(looking.week));
    for (const note of view.querySelectorAll(".week-note")) note.hidden = !looking.week;
    return;
  }
  // The league screen on a phone: the matches, or the table.
  if (target.matches("[data-part]")) {
    looking.part = target.dataset.part;
    for (const chip of target.parentElement.children) chip.setAttribute("aria-pressed", String(chip === target));
    view.querySelector(".cols[data-show]")?.setAttribute("data-show", looking.part);
    return;
  }

  // The group screen: whoever started the group turns a competition on or off.
  if (target.matches("[data-plays]")) {
    const { mine } = await context();
    const on = target.getAttribute("aria-checked") !== "true";
    const plays = Object.keys(COMPETITIONS).filter((key) => (key === target.dataset.plays ? on : mine.group.plays.includes(key)));
    target.setAttribute("aria-checked", String(on));
    try {
      await groups.setPlays({ code: mine.group.code, plays });
      await draw({ keepPlace: true });
    } catch (error) {
      target.setAttribute("aria-checked", String(!on));
      say(target, error.message);
    }
    return;
  }
  // Linking a wallet: the wallet signs a note, which costs nothing, and Kickoff's server checks it.
  if (target.matches("[data-link-wallet]")) {
    const out = () => view.querySelector("[data-wallet-out]");
    target.disabled = true;
    if (out()) out().textContent = "";
    try {
      const result = await wallet.link();
      groups.linked(result);
      await draw({ keepPlace: true });
      carry();
      if (out()) out().textContent = result.carried > 0 ? `Wallet linked. ${result.carried === 1 ? "Your group is back." : "Your groups are back."}` : "Wallet linked.";
    } catch (error) {
      if (out()) out().textContent = error.message;
      target.disabled = false;
    }
    return;
  }
  if (target.matches("[data-choose]")) {
    groups.choose(target.dataset.choose);
    await draw();
    carry();
    return;
  }

  // My record: save a picture of the last finished match.
  if (target.matches("[data-save-card]")) {
    const out = view.querySelector("[data-card-out]");
    try {
      const facts = cardOf(await context());
      if (!facts) throw new Error("There is no finished match to make a card of yet.");
      await saveCard(facts);
      out.textContent = "Card saved.";
    } catch (error) {
      out.textContent = error.message;
    }
    return;
  }

  // Moving to another phone: make a one-time code and show it.
  if (target.matches("[data-move-start]")) {
    const out = view.querySelector("[data-move-out]");
    target.disabled = true;
    out.textContent = "";
    try {
      moving = await startMove({ store, client, device });
      await draw({ keepPlace: true });
    } catch (error) {
      out.textContent = error.unreachable ? "Kickoff could not be reached. Try again when you are online." : error.message;
      target.disabled = false;
    }
    return;
  }

  if (target.matches("[data-copy]")) {
    const before = target.textContent;
    try {
      await navigator.clipboard.writeText(target.dataset.copy);
      target.textContent = "Copied";
      // A copy that needs a word on what to do with it says so on the line beneath.
      const out = target.dataset.then ? target.parentElement.nextElementSibling : null;
      if (out?.matches("[data-copy-out]")) out.textContent = target.dataset.then;
    } catch {
      target.textContent = "Could not copy";
    }
    setTimeout(() => (target.textContent = before), 1600);
    return;
  }

  if (target.matches("[data-preview-note]")) {
    event.preventDefault();
    say(target, target.dataset.previewNote);
  }
});

// "Start a group": choosing Friends or Brand shows the boxes that go with it, and the brand's boxes
// say what each winner would get as they are filled in.
function startChoice(event) {
  const form = event.target.closest('[data-form="start"]');
  if (!form) return;
  const typed = Object.fromEntries(new FormData(form));
  form.dataset.kind = typed.kind === "brand" ? "brand" : "friends";
  const each = shareWords(typed);
  const out = form.querySelector("[data-share]");
  if (out) out.textContent = each && Number(String(typed.winners).trim()) > 1 ? `Each winner gets ${each}.` : "";
}
document.addEventListener("change", startChoice);
document.addEventListener("input", startChoice);

// The group screen's forms: start a group, or join one with a code.
document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const out = form.querySelector("[data-form-out]");
  const button = form.querySelector("button[type=submit]");
  const typed = Object.fromEntries(new FormData(form));
  out.textContent = "";
  button.disabled = true;
  try {
    if (form.dataset.form === "code") {
      // This phone becomes the player the code belongs to. Everything is read again from the start.
      await finishMove({ store, client, typed: typed.code });
      location.hash = "#/group";
      location.reload();
      return;
    }
    if (form.dataset.form === "paid") {
      // Whoever started a brand's group gives a payment. It shows as being checked until the robot has read it on X Layer.
      const tx = String(typed.tx ?? "").trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new Error("Paste the payment's transaction. It starts 0x and has 64 more letters and numbers.");
      await groups.paid({ code: typed.code, place: Number(typed.place), tx });
      await draw({ keepPlace: true });
      return;
    }
    if (form.dataset.form === "join" && !String(typed.code ?? "").trim()) throw new Error("Type the group's code.");
    if (form.dataset.form === "start") {
      const brand = typed.kind === "brand" ? brandFrom(typed, Math.floor(Date.now() / 1000)) : null;
      await groups.start({ name: typed.name, playerName: typed.playerName, plays: new FormData(form).getAll("plays"), brand });
    } else await groups.join({ code: typed.code, playerName: typed.playerName });
    if (location.hash === "#/group") await draw();
    else location.hash = "#/group";
    carry();
  } catch (error) {
    out.textContent = error.unreachable ? "Kickoff could not be reached. Try again when you are online." : error.message;
    button.disabled = false;
  }
});

/** Ask the server for this device's groups, and draw again if anything changed. */
async function catchUp() {
  try {
    if (await groups.refresh()) await draw({ keepPlace: true });
  } catch {
    // The server answered but would not say. What is kept on the device stays as it is.
  }
}

/**
 * Fetch the matches, then carry each sealed pick as far as it can go now: sent, receipt, opened.
 * Draws again if anything changed, unless a pick is being made on the screen at this moment.
 */
let carrying = false;
let matchesAskedAt = 0;
let tableAskedAt = 0;
let chainAskedAt = 0;
let tableFor; // the group the tables were last asked for. Not set yet, so the first round asks.
async function carry() {
  if (carrying) return;
  carrying = true;
  try {
    // The list of matches changes a few times a day, so it is asked for at most every five minutes.
    let changed = false;
    if (Date.now() - matchesAskedAt >= 5 * 60_000) {
      matchesAskedAt = Date.now();
      changed = await matches.refresh();
    }
    const ctx = await context();
    if (ctx.real && ctx.league) changed = (await syncPicks({ store, client, player: ctx.mine.player, league: ctx.league, fixtures: ctx.fixtures, now: ctx.now, robotKey: ROBOT_KEY, serverKey: SERVER_KEY, shared: isShared(store) })) || changed;
    // The tables are asked for when something of this player's has changed, when what is kept is
    // for another group, and otherwise at most every five minutes while a screen that shows them
    // is open. Not more often: every look costs the server work.
    const showsTables = /^#\/(league|record)?$/.test(location.hash || "#/league");
    const group = ctx.mine.group?.code ?? null;
    if (ctx.real && !document.hidden && (changed || tableFor !== group || (showsTables && Date.now() - tableAskedAt >= 5 * 60_000))) {
      tableAskedAt = Date.now();
      tableFor = group;
      changed = (await table.refresh(group)) || changed;
    }
    // X Layer is read by this browser when a screen that shows it is open, at most every two minutes.
    if (ctx.real && !document.hidden && /^#\/(record|check)/.test(location.hash) && Date.now() - chainAskedAt >= 2 * 60_000) {
      chainAskedAt = Date.now();
      // A group of friends lists its members. A brand's group is too big to: the ids to look up
      // are the ones on the top of its leaderboard.
      const g = ctx.mine.group;
      const players = g?.brand ? (ctx.standings?.group?.rows ?? []).flatMap((r) => r.players ?? []) : (g?.members ?? []).flatMap((m) => m.players ?? [m.player]);
      const was = chain.unreachable;
      changed = (await chain.refresh({ league: ctx.league, players: [...new Set([ctx.mine.player, ...players])] })) || chain.unreachable !== was || changed;
    }
    // Draw again if something changed, or if picks have closed or a match has started since the
    // screen was drawn. A pick being made is left alone, unless its match has just closed.
    // A one-time code that has run out is taken off the screen.
    if (moving && moving.until <= Math.floor(Date.now() / 1000) && location.hash === "#/group/move") changed = true;
    const moved = stage(ctx) !== drawnAt;
    if (moved || (changed && !view.querySelector("[data-picker]"))) await draw({ keepPlace: true });
  } catch {
    // Tried again on the next round.
  } finally {
    carrying = false;
  }
}

window.addEventListener("hashchange", () => {
  editing = null;
  draw();
  if (location.hash.startsWith("#/group")) catchUp();
  carry();
});
window.addEventListener("online", () => {
  catchUp();
  carry();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) carry();
});
setInterval(carry, 20_000);
draw().then(() => {
  catchUp();
  carry();
});
