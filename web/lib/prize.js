// A brand's group and its prize: what the "Start a group" form sends, checked on the phone first so
// a slip is said in plain words before anything is sent. Kickoff's server checks it all again.

/** What a prize can be paid in. The server holds each token's real address on X Layer. */
export const PAID_IN = ["USDT", "USDC"];
export const MAX_WINNERS = 10;
export const MAX_PRIZE = 1_000_000;

/** A whole number someone typed, allowing spaces and commas: "1,000" is 1000. Null if it is not one. */
function whole(typed) {
  const digits = String(typed ?? "").replace(/[\s,]/g, "");
  return /^\d{1,9}$/.test(digits) ? Number(digits) : null;
}

/** An amount of a token with six places, in its smallest unit, as people write it. */
function inWords(raw) {
  const whole = (raw / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : whole;
}

/** What each winner gets, in words: "100 USDT". Empty if the prize or the winners are not filled in yet. */
export function shareWords({ amount, winners, token }) {
  const prize = whole(amount);
  const people = whole(winners);
  if (!prize || !people || people > MAX_WINNERS || !PAID_IN.includes(token)) return "";
  return `${inWords((BigInt(prize) * 1_000_000n) / BigInt(people))} ${token}`;
}

/**
 * What the form's brand boxes come to: { name, amount, winners, token, ends }.
 * `ends` is midnight after the last day, by this phone's own clock, in seconds.
 * Throws, in plain words, at the first thing that is missing or wrong.
 * @param typed  the form's boxes: brand, amount, winners, token, lastDay ("2026-12-06")
 * @param now    the time, in seconds
 */
export function brandFrom(typed, now) {
  const name = String(typed.brand ?? "").trim();
  if (!name) throw new Error("Type the brand's name.");
  const amount = whole(typed.amount);
  if (!amount || amount > MAX_PRIZE) throw new Error("Type the prize as a whole number, like 300.");
  if (!PAID_IN.includes(typed.token)) throw new Error("Choose USDT or USDC.");
  const winners = whole(typed.winners);
  if (!winners || winners > MAX_WINNERS) throw new Error(`Type how many winners share the prize: 1 to ${MAX_WINNERS}.`);
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(typed.lastDay ?? ""));
  if (!day) throw new Error("Choose the group's last day.");
  const ends = Math.floor(new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + 1).getTime() / 1000);
  if (!(ends > now)) throw new Error("The last day has to be today or later.");
  return { name, amount, winners, token: typed.token, ends };
}
