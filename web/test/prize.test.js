// A brand's group, on the phone: what the "Start a group" form sends, and what each winner gets.
import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_WINNERS, PAID_IN, brandFrom, shareWords } from "../lib/prize.js";

const NOW = Math.floor(new Date(2026, 10, 27, 15, 0).getTime() / 1000);
const good = { brand: " OKX ", amount: "300", winners: "3", token: "USDT", lastDay: "2026-12-06" };

test("the brand's boxes become what Kickoff's server is sent, ending at midnight after the last day", () => {
  assert.deepEqual(brandFrom(good, NOW), { name: "OKX", amount: 300, winners: 3, token: "USDT", ends: Math.floor(new Date(2026, 11, 7).getTime() / 1000) });
  // A prize typed with commas or spaces is the same number.
  assert.equal(brandFrom({ ...good, amount: "25,000" }, NOW).amount, 25000);
  assert.equal(brandFrom({ ...good, amount: " 1 000 " }, NOW).amount, 1000);
  // Today can be the last day: the group then ends at midnight tonight.
  assert.equal(brandFrom({ ...good, lastDay: "2026-11-27" }, NOW).ends, Math.floor(new Date(2026, 10, 28).getTime() / 1000));
  assert.deepEqual(PAID_IN, ["USDT", "USDC"]);
});

test("a slip in the form is said in plain words, before anything is sent", () => {
  const says = (change, words) => assert.throws(() => brandFrom({ ...good, ...change }, NOW), words, JSON.stringify(change));
  says({ brand: "  " }, /Type the brand's name\./);
  for (const amount of ["", "0", "-5", "1.5", "lots", "3e5", "1000001"]) says({ amount }, /Type the prize as a whole number, like 300\./);
  says({ token: "DOGE" }, /Choose USDT or USDC\./);
  says({ token: undefined }, /Choose USDT or USDC\./);
  for (const winners of ["", "0", String(MAX_WINNERS + 1), "two"]) says({ winners }, /how many winners share the prize: 1 to 10\./);
  for (const lastDay of ["", "soon", "06/12/2026"]) says({ lastDay }, /Choose the group's last day\./);
  says({ lastDay: "2026-11-26" }, /The last day has to be today or later\./);
});

test("each winner's share is worked out as it is typed, cut to the token's last place", () => {
  assert.equal(shareWords({ amount: "300", winners: "3", token: "USDT" }), "100 USDT");
  assert.equal(shareWords({ amount: "100", winners: "3", token: "USDC" }), "33.333333 USDC");
  assert.equal(shareWords({ amount: "25,000", winners: "2", token: "USDT" }), "12,500 USDT");
  assert.equal(shareWords({ amount: "5", winners: "10", token: "USDT" }), "0.5 USDT");
  // Not filled in yet, or not possible: nothing is said.
  for (const typed of [{ amount: "", winners: "3", token: "USDT" }, { amount: "300", winners: "", token: "USDT" }, { amount: "300", winners: "0", token: "USDT" }, { amount: "300", winners: "11", token: "USDT" }, { amount: "300", winners: "3" }]) assert.equal(shareWords(typed), "");
});
