// Small pieces every screen uses. Each returns a piece of HTML as text, so the screens can be
// tested without a browser.
import { COMPETITIONS } from "../data/sample.js";

/** Make text safe to put inside HTML. */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** The kickoff mark: a centre circle with the halfway line through it. */
export const MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M12 1v22"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>`;

/** The light and dark switch. */
export const TOGGLE = `<button class="toggle" type="button" data-theme-toggle aria-label="Switch between light and dark"><span class="sun"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></svg></span><span class="moon"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 14.6A8.6 8.6 0 0 1 9.4 3.7a8.6 8.6 0 1 0 10.9 10.9z"/></svg></span></button>`;

/** A competition's name with its dot of colour. */
export function comp(key, extra = "") {
  return `<span class="comp ${key} ${extra}">${esc(COMPETITIONS[key].name)}</span>`;
}

let stampCount = 0;
/** The time stamp: when a set of picks was sealed, as X Layer recorded it. */
export function stamp(time, date, size = 98) {
  const n = stampCount++;
  return `<svg class="stamp" width="${size}" height="${size}" viewBox="0 0 120 120" fill="currentColor" font-family="Georgia, Gelasio, serif" role="img" aria-label="Sealed at ${esc(time)}, before kickoff. Stamped by X Layer.">
  <defs><path id="st${n}" d="M 20.1 78.6 A 44 44 0 1 1 99.9 78.6"/><path id="sb${n}" d="M 11 60 a 49 49 0 0 0 98 0"/></defs>
  <circle cx="60" cy="60" r="56.5" fill="none" stroke="currentColor" stroke-width="2.4"/>
  <circle cx="60" cy="60" r="31" fill="none" stroke="currentColor" stroke-width="1.1"/>
  <text font-size="8.8" font-weight="700" letter-spacing="1.5"><textPath href="#st${n}" startOffset="50%" text-anchor="middle">SEALED BEFORE KICKOFF</textPath></text>
  <text font-size="8.8" font-weight="700" letter-spacing="2.6"><textPath href="#sb${n}" startOffset="50%" text-anchor="middle">X LAYER</textPath></text>
  <text x="60" y="62.5" text-anchor="middle" font-size="17.5" font-weight="700">${esc(time)}</text>
  <text x="60" y="75" text-anchor="middle" font-size="8" font-weight="600">${esc(date)}</text>
</svg>`;
}

/**
 * The top of a screen: its heading, and on a computer the buttons and the switch at the end.
 * `before` goes above the heading (a competition's label, say).
 */
export function titlebar({ eyebrow = "", before = "", heading, headingClass = "", actions = "" }) {
  return `<div class="titlebar"><div>${eyebrow ? `<div class="eyebrow muted small">${eyebrow}</div>` : ""}${before}<h1${headingClass ? ` class="${headingClass}"` : ""}>${heading}</h1></div><div class="actions">${actions}${TOGGLE}</div></div>`;
}

/** The line at the foot of every screen until Kickoff is live. */
/** The same line once the matches are real but the table is not yet. */
export const SAMPLE_NOTE = `<p class="sample">A preview with made-up names and matches. Nothing here is live yet.</p>`;
/** The foot of the home page. Kickoff is live; only the card at its top is made up, to show what a prediction looks like. */
export const HOME_NOTE = `<p class="sample">The prediction card at the top is an example.</p>`;
