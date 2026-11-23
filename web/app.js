// Kickoff's website. No build step and nothing to install: plain files a browser runs as they are.

import { checkScreen, frame, groupScreen, home, league, matchScreen, pick, recordScreen } from "./screens.js";

const routes = { "": home, league, pick, match: matchScreen, record: recordScreen, check: checkScreen, group: groupScreen };

document.body.insertAdjacentHTML("afterbegin", frame());
const view = document.getElementById("view");

function draw() {
  const [name = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  const screen = (routes[name] ?? home)(arg);
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
  window.scrollTo(0, 0);
}

// Remember the group's name before the home screen swaps the link's words.
const whereLink = document.querySelector("[data-where]");
whereLink.dataset.name = whereLink.textContent;

/** Say something short next to whatever was pressed, where a screen reader will read it out. */
function say(from, words) {
  const out = from.closest("main").querySelector("[data-note-out], [data-seal-note]") ?? from.parentElement;
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
    say(target, "This is a preview, so nothing was sealed. Sealing a pick for real is the next thing being built.");
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

window.addEventListener("hashchange", draw);
draw();
