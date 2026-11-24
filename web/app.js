// Kickoff's website. No build step and nothing to install: plain files a browser runs as they are.

import { SERVER } from "./config.js";
import { COMPETITIONS, SAMPLE_LEAGUE, sampleFixtures } from "./data/sample.js";
import { createDevice } from "./lib/device.js";
import { createFixtures } from "./lib/fixtures.js";
import { createGroups } from "./lib/groups.js";
import { createStore, seal } from "./lib/picks.js";
import { createClient } from "./lib/server.js";
import { syncPicks } from "./lib/sync.js";
import { hasClosed } from "./lib/time.js";
import { createWallet } from "./lib/wallet.js";
import { checkScreen, frame, groupScreen, home, league, matchScreen, pick, recordScreen } from "./screens.js";

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
  const { real, league, fixtures, matchIds } = await matches.view(now);
  const mine = await groups.view();
  return { now, real, league, fixtures, matchIds, picks: store.all(mine.player), lasting: store.lasting, editing, mine };
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
    const output = target.parentElement.querySelector("output");
    output.textContent = Math.min(15, Math.max(0, Number(output.textContent) + Number(target.dataset.step)));
    return;
  }
  if (target.matches(".choice")) {
    for (const other of target.parentElement.querySelectorAll(".choice")) other.setAttribute("aria-pressed", String(other === target));
    return;
  }
  if (target.matches("[data-seal]")) {
    const chosen = pickOnScreen();
    if (!chosen) {
      say(target, "Choose who wins and by how many points first.");
      return;
    }
    const ctx = await context();
    const fixture = ctx.fixtures[target.dataset.seal];
    try {
      await seal({ store, league: ctx.league, fixture, competitions: COMPETITIONS, pick: chosen, now: ctx.now, player: ctx.mine.player });
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
    return;
  }

  if (target.matches("[data-copy]")) {
    const before = target.textContent;
    try {
      await navigator.clipboard.writeText(target.dataset.copy);
      target.textContent = "Copied";
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
    if (form.dataset.form === "start") await groups.start({ name: typed.name, playerName: typed.playerName, plays: new FormData(form).getAll("plays") });
    else await groups.join({ code: typed.code, playerName: typed.playerName });
    if (location.hash === "#/group") await draw();
    else location.hash = "#/group";
  } catch (error) {
    out.textContent = error.message;
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
    if (ctx.real) changed = (await syncPicks({ store, client, player: ctx.mine.player, league: ctx.league, fixtures: ctx.fixtures, now: ctx.now })) || changed;
    // Draw again if something changed, or if picks have closed or a match has started since the
    // screen was drawn. A pick being made is left alone, unless its match has just closed.
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
