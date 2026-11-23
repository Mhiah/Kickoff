// Times, written the way the screens show them. Every time is kept as seconds, the way X Layer
// stamps it, and shown in the visitor's own time zone.

/** Picks close this many seconds before a match starts. */
export const CLOSES_BEFORE = 10 * 60;

const part = (seconds, options, timeZone) => new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(new Date(seconds * 1000));

/** "Tuesday 24 Nov" */
export function dayLabel(seconds, timeZone) {
  return `${part(seconds, { weekday: "long" }, timeZone)} ${part(seconds, { day: "numeric" }, timeZone)} ${part(seconds, { month: "short" }, timeZone)}`;
}

/** "Monday, 23 November" */
export function todayLabel(seconds, timeZone) {
  return `${part(seconds, { weekday: "long" }, timeZone)}, ${part(seconds, { day: "numeric" }, timeZone)} ${part(seconds, { month: "long" }, timeZone)}`;
}

/** "21:00" */
export function clock(seconds, timeZone) {
  return part(seconds, { hour: "2-digit", minute: "2-digit", hour12: false }, timeZone);
}

/** When picks close for a match that starts at `kickoff`. */
export const closesAt = (kickoff) => kickoff - CLOSES_BEFORE;

/** Whether picks have closed. */
export const hasClosed = (now, kickoff) => now >= closesAt(kickoff);

/** How long from `now` until `then`: "4 days", "1 day 1 hour", "3 hours", "25 minutes", "under a minute". */
export function howLong(now, then) {
  const left = Math.max(0, then - now);
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const say = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (days >= 2) return say(days, "day");
  if (days === 1) return hours ? `1 day ${say(hours, "hour")}` : "1 day";
  if (hours >= 1) return minutes && hours < 3 ? `${say(hours, "hour")} ${say(minutes, "minute")}` : say(hours, "hour");
  if (minutes >= 1) return say(minutes, "minute");
  return "under a minute";
}
