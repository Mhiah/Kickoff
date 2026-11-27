// A card of a finished match, to save as a picture.
//
// After a match, a player can save one picture that says how they called it: the match and its
// final score, what they predicted, the points each prediction gave, and where that leaves them.
// It is drawn in the browser, from what the leaderboard already shows this player. Nothing is
// sent anywhere: the picture is saved to the phone, and the player posts it wherever they like.
//
// Three steps, so the first two can be checked without a screen:
//   cardFacts()    what the card says, from this player's finished predictions
//   cardLayout()   where each word and line goes, on a square of 1080 by 1080
//   saveCard()     draw that with the page's own typeface and save it as a PNG (browser only)

import { BASKETBALL, FOOTBALL, GOAL_GOAL, RESULT, SCORE, decodePick } from "../engine/picks.js";
import { bandWords } from "./picks.js";
import { ordinal } from "./standings.js";
import { dayLabel } from "./time.js";

const SIZE = 1080;
const EDGE = 84;
const INK = "#121216";
const MUTED = "#66666f";
const HAIR = "#e2e2e7";
/** The competitions' colours, as in styles.css. */
const COLOURS = { pl: "#e3127e", cl: "#2343d9", ll: "#7b3fe4", sa: "#0e9f6e", nba: "#f0b400", wnba: "#f26a1b" };
/** The order a football match's three predictions are listed in, and what each is called. */
const ORDER = [RESULT, GOAL_GOAL, SCORE, FOOTBALL, BASKETBALL];
const KIND = { [RESULT]: "Result", [GOAL_GOAL]: "Goal Goal", [SCORE]: "Exact score", [FOOTBALL]: "Exact score", [BASKETBALL]: "Winner and margin" };

/** What one finished prediction said, in a few words. Null if it cannot be read. */
function said(row) {
  try {
    const pick = decodePick(row.sport, row.pickByte);
    if (row.sport === RESULT) return pick.result === "draw" ? "Draw" : `${pick.result === "home" ? row.home : row.away} win`;
    if (row.sport === GOAL_GOAL) return pick.both ? "Yes" : "No";
    if (row.sport === SCORE || row.sport === FOOTBALL) return `${pick.home} – ${pick.away}`;
    return `${pick.winner === "home" ? row.home : row.away} by ${bandWords(pick.band)}`;
  } catch {
    return null;
  }
}

/**
 * What the card says.
 * @param played        this player's finished predictions, as the leaderboard gives them (newest first)
 * @param standings     { you, group } from the same leaderboard
 * @param name          the player's name, or ""
 * @param groupName     the name of the group being looked at, or null
 * @param competitions  from data/sample.js
 * @param site          where this copy of Kickoff is open
 * @returns null if no match of theirs has finished with points to show; otherwise
 *   { comp, compName, colour, home, away, homeScore, awayScore, day, name, lines: [{ kind, said, points }],
 *     points, place, total, site, file }
 */
export function cardFacts({ played = [], standings = null, name = "", groupName = null, competitions = {}, site = "" }) {
  // A match that was not locked on X Layer in time gave nobody points, so there is no card of it.
  const counted = played.filter((r) => !r.missed && typeof r.score === "string" && /\d/.test(r.score));
  if (counted.length === 0) return null;
  const newest = counted.reduce((a, b) => (b.kickoff > a.kickoff ? b : a));
  const same = (r) => r.kickoff === newest.kickoff && r.home === newest.home && r.away === newest.away;
  const lines = counted
    .filter(same)
    .sort((a, b) => ORDER.indexOf(a.sport) - ORDER.indexOf(b.sport))
    .map((r) => ({ kind: KIND[r.sport] ?? "Prediction", said: said(r), points: r.points }))
    .filter((line) => line.said !== null);
  if (lines.length === 0) return null;
  const [homeScore = "", awayScore = ""] = newest.score.split(/\s*[–-]\s*/);
  const mine = standings?.group?.rows?.find((r) => r.you);
  const place = mine && groupName ? `${ordinal(mine.place)} in ${groupName}` : standings?.you?.place ? `${ordinal(standings.you.place)} on Kickoff` : null;
  const slug = (words) => words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    comp: newest.comp,
    compName: competitions[newest.comp]?.name ?? "",
    colour: COLOURS[newest.comp] ?? INK,
    home: newest.home,
    away: newest.away,
    homeScore,
    awayScore,
    day: dayLabel(newest.kickoff),
    name,
    lines,
    points: lines.reduce((sum, line) => sum + line.points, 0),
    place,
    total: standings?.you?.points ?? null,
    site: site.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    file: `kickoff-${slug(newest.home)}-${slug(newest.away)}.png`,
  };
}

/**
 * Where everything goes. Each item is one of
 *   { kind: "text", text, x, y, size, weight, colour, align, fit }   `fit` is the widest it may be
 *   { kind: "rule", x1, x2, y, colour }                              a thin line across
 *   { kind: "dot", x, y, r, colour }
 *   { kind: "mark", x, y, size, colour }                             Kickoff's mark
 * `y` is the line the words sit on.
 */
export function cardLayout(facts) {
  const left = EDGE;
  const right = SIZE - EDGE;
  const wide = right - left;
  const items = [];
  const text = (words, x, y, size, more = {}) => items.push({ kind: "text", text: String(words), x, y, size, weight: 400, colour: INK, align: "left", ...more });

  // Top: Kickoff on the left, the competition on the right.
  items.push({ kind: "mark", x: left, y: 82, size: 46, colour: INK });
  text("Kickoff", left + 62, 120, 44, { weight: 700 });
  if (facts.compName) {
    text(facts.compName, right, 118, 34, { weight: 700, align: "right", fit: 420, dotBefore: facts.colour });
  }

  // The match: each team on its own line, with its score at the far side.
  text(facts.home, left, 292, 92, { weight: 700, fit: wide - 190 });
  text(facts.homeScore, right, 292, 92, { weight: 700, align: "right" });
  text(facts.away, left, 404, 92, { weight: 700, fit: wide - 190 });
  text(facts.awayScore, right, 404, 92, { weight: 700, align: "right" });
  text(`Final score. ${facts.day}.`, left, 466, 32, { colour: MUTED });

  // What they predicted, and what each prediction gave.
  items.push({ kind: "rule", x1: left, x2: right, y: 528, colour: HAIR });
  text(facts.name ? `${facts.name} predicted` : "My predictions", left, 594, 36, { weight: 700, fit: wide });
  let y = 668;
  for (const line of facts.lines) {
    text(line.kind, left, y, 34, { colour: MUTED });
    text(line.said, left + 330, y, 38, { weight: 700, fit: wide - 330 - 120 });
    text(line.points > 0 ? `+${line.points}` : "0", right, y, 38, { weight: 700, align: "right", colour: line.points > 0 ? INK : MUTED });
    y += 68;
  }

  // The sum, and where it leaves them.
  items.push({ kind: "rule", x1: left, x2: right, y: 880, colour: HAIR });
  text(`${facts.points} ${facts.points === 1 ? "point" : "points"} from this match`, left, 948, 44, { weight: 700 });
  if (facts.place) text(facts.place, right, 948, 34, { align: "right", fit: 440 });
  text("Sealed before kickoff. Locked on X Layer.", left, 1010, 28, { colour: MUTED });
  if (facts.site) text(facts.site, right, 1010, 28, { colour: MUTED, align: "right", fit: 420 });

  return { width: SIZE, height: SIZE, background: "#ffffff", items };
}

/** Draw a layout on a canvas, in the page's own typeface. Browser only. */
export async function paintCard(layout, doc = document) {
  const family = getComputedStyle(doc.body).fontFamily || 'Georgia, "Gelasio", serif';
  // The typeface may not have been needed at these weights yet: ask for it before drawing.
  await Promise.all([400, 700].map((weight) => doc.fonts?.load(`${weight} 40px ${family}`).catch(() => null)));
  const canvas = doc.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const c = canvas.getContext("2d");
  c.fillStyle = layout.background;
  c.fillRect(0, 0, layout.width, layout.height);
  for (const item of layout.items) {
    if (item.kind === "rule") {
      c.fillStyle = item.colour;
      c.fillRect(item.x1, item.y, item.x2 - item.x1, 2);
    } else if (item.kind === "dot") {
      c.fillStyle = item.colour;
      c.beginPath();
      c.arc(item.x, item.y, item.r, 0, Math.PI * 2);
      c.fill();
    } else if (item.kind === "mark") {
      // The same mark as the site's: a ring, a line through it, and a spot in the middle.
      const unit = item.size / 24;
      const cx = item.x + 12 * unit;
      const cy = item.y + 12 * unit;
      c.strokeStyle = item.colour;
      c.fillStyle = item.colour;
      c.lineWidth = 2.2 * unit;
      c.beginPath();
      c.arc(cx, cy, 8.6 * unit, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(cx, item.y + unit);
      c.lineTo(cx, item.y + 23 * unit);
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, 1.6 * unit, 0, Math.PI * 2);
      c.fill();
    } else {
      // Words too wide for their place are made smaller until they fit.
      let size = item.size;
      const set = () => (c.font = `${item.weight} ${size}px ${family}`);
      set();
      while (item.fit && c.measureText(item.text).width > item.fit && size > 16) {
        size -= 2;
        set();
      }
      c.fillStyle = item.colour;
      c.textAlign = item.align;
      c.textBaseline = "alphabetic";
      c.fillText(item.text, item.x, item.y);
      if (item.dotBefore) {
        const width = c.measureText(item.text).width;
        const start = item.align === "right" ? item.x - width : item.x;
        c.fillStyle = item.dotBefore;
        c.beginPath();
        c.arc(start - size * 0.55, item.y - size * 0.32, size * 0.26, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  return canvas;
}

/** Draw the card and save it as a picture. Browser only. */
export async function saveCard(facts, doc = document) {
  const canvas = await paintCard(cardLayout(facts), doc);
  const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
  if (!blob) throw new Error("The picture could not be made on this phone.");
  const link = doc.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = facts.file;
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
