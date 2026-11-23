// Shared bits for the website's checks.
import { COMPETITIONS, SAMPLE_LEAGUE, sampleFixtures } from "../data/sample.js";
import { createStore, matchIdOf, seal } from "../lib/picks.js";

/** A fixed moment to run the checks at: Monday 23 November 2026, 18:00 in Lagos. */
export const NOW = Math.floor(Date.UTC(2026, 10, 23, 17, 0) / 1000);

/** Something shaped like the browser's storage, for the checks. */
export class FakeStorage {
  items = new Map();
  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null;
  }
  setItem(key, value) {
    this.items.set(key, String(value));
  }
}

/** What a screen is handed: the time, the matches, their ids, and the picks on the device. */
export async function contextAt(now, store = createStore(new FakeStorage()), extra = {}) {
  const fixtures = sampleFixtures(NOW); // the matches stay put while `now` moves
  const matchIds = {};
  for (const [id, fixture] of Object.entries(fixtures)) matchIds[id] = await matchIdOf(SAMPLE_LEAGUE, fixture, COMPETITIONS);
  return { now, fixtures, matchIds, picks: store.all(), lasting: store.lasting, editing: null, store, ...extra };
}

/** Seal a pick on the context's device and return the context as it is afterwards. */
export async function sealOn(ctx, fixtureId, pick, extra = {}) {
  await seal({ store: ctx.store, league: SAMPLE_LEAGUE, fixture: ctx.fixtures[fixtureId], competitions: COMPETITIONS, pick, now: ctx.now });
  return contextAt(ctx.now, ctx.store, extra);
}
