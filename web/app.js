// Kickoff's website. No build step and nothing to install: plain files a browser runs as they are.

import { COMPETITIONS, SAMPLE_LEAGUE, sampleFixtures } from "./data/sample.js";
import { createStore, matchIdOf, seal } from "./lib/picks.js";
import { checkScreen, frame, groupScreen, home, league, matchScreen, pick, recordScreen } from "./screens.js";

const routes = { "": home, league, pick, match: matchScreen, record: recordScreen, check: checkScreen, group: groupScreen };

let storage = null;
try {
  storage = window.localStorage;
} catch {
  // Some browsers refuse storage altogether. Picks are then kept for this visit only.
}
const store = createStore(storage);

document.body.insertAdjacentHTML("afterbegin", frame());
const view = document.getElementById("view");
let editing = null; // the fixture whose pick is being changed, if any
let drawing = 0;

/** What is true right now: the time, the matches, and the picks kept on this device. */
async function context() {
  const now = Math.floor(Date.now() / 1000);
  const fixtures = sampleFixtures(now);
  const matchIds = {};
  for (const [id, fixture] of Object.entries(fixtures)) matchIds[id] = await matchIdOf(SAMPLE_LEAGUE, fixture, COMPETITIONS);
  return { now, fixtures, matchIds, picks: store.all(), lasting: store.lasting, editing };
}

async function draw({ keepPlace = false } = {}) {
  const mine = ++drawing;
  const [name = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  const ctx = await context();
  if (mine !== drawing) return; // a newer draw has started
  const screen = (routes[name] ?? home)(arg, ctx);
  document.body.classList.toggle("public", Boolean(screen.public));
  view.className = screen.wide ? "wide" : "";
  view.innerHTML = screen.html;
  document.title = screen.title;
  for (const link of document.querySelectorAll("[data-tab]")) {
    if (link.dataset.tab === screen.tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const where = document.querySelector("[data-where]");
  where.textContent = screen.public ? "See a sample group" : where.dataset.name ?? where.textContent;
  where.setAttribute("href", screen.public ? "#/league" : "#/group");
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

// Remember the group's name before the home screen swaps the link's words.
const whereLink = document.querySelector("[data-where]");
whereLink.dataset.name = whereLink.textContent;

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
      await seal({ store, league: SAMPLE_LEAGUE, fixture, competitions: COMPETITIONS, pick: chosen, now: ctx.now });
      editing = null;
      await draw();
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

  // The group screen: a competition's on and off switch.
  if (target.matches(".switch")) {
    target.setAttribute("aria-checked", String(target.getAttribute("aria-checked") !== "true"));
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

window.addEventListener("hashchange", () => {
  editing = null;
  draw();
});
draw();
