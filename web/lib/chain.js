// What X Layer itself holds about Kickoff, read by this browser.
//
// This does not ask Kickoff's server anything. It asks an X Layer node for the league's records
// (which matches were announced, when each was locked, what results were given, which picks were
// opened) and works out the points from them with the published scoring circuits. That is what
// lets a player check Kickoff instead of trusting it.
//
// The last answer is kept on the device so a screen can be drawn at once.

import { toHex } from "../engine/bytes.js";
import { BASKETBALL_HEX, FOOTBALL_HEX, TENNIS_HEX } from "../engine/published.js";
import { loadCircuits } from "../engine/score.js";
import { XLAYER, tableFromXLayer } from "../engine/xlayer.js";

const CHAIN_KEY = "kickoff-chain";
const hex = (x) => (typeof x === "string" ? x.toLowerCase().replace(/^0x/, "") : toHex(x));

/**
 * @param store  from createStore() in picks.js
 * @param node   the X Layer node to ask
 * @param read   what does the reading. Only tests give another.
 * @param now    a function giving the time in seconds
 */
export function createChain({ store, node = XLAYER.node, read = tableFromXLayer, now = () => Math.floor(Date.now() / 1000) }) {
  let circuits = null;
  const kept = () => {
    try {
      const d = JSON.parse(store.read(CHAIN_KEY) ?? "null");
      if (d && typeof d.league === "string" && d.matches && d.points) return d;
    } catch {
      // what was kept is damaged: start again
    }
    return null;
  };
  const self = {
    /** True if the last try could not reach X Layer. What is kept is then from an earlier read. */
    unreachable: false,
    /**
     * What X Layer held when last read, or null if it has not been read for this league.
     * @returns {
     *   at, block   when it was read (seconds), and X Layer's block number then
     *   matches     { "<match id>": { kickoff, state, lock: { at, count, root, tx } or null } }
     *               `lock` is the lock in force: the last one stamped before kickoff
     *   points      { "<player id>": { points, threes, ones } }, from opened picks and results
     * }
     */
    view(league) {
      const d = kept();
      return d && d.league === league ? d : null;
    },
    /**
     * Read X Layer again.
     * @param league   Kickoff's id, 64 hex digits
     * @param players  player ids to work out points for, even if they have none
     * @returns true if what is kept changed
     */
    async refresh({ league, players = [] }) {
      const before = store.read(CHAIN_KEY);
      try {
        circuits ??= loadCircuits({ football: FOOTBALL_HEX, basketball: BASKETBALL_HEX, tennis: TENNIS_HEX });
        const built = await read({ node, league, circuits, players });
        const txOf = new Map(built.messages.map((m) => [m.index, m.tx ?? null]));
        const matches = {};
        for (const m of built.matches) {
          const inForce = m.locks.filter((l) => l.inTime).at(-1);
          matches[hex(m.id)] = {
            kickoff: m.kickoff,
            state: m.state,
            lock: inForce ? { at: inForce.lockedAt, count: inForce.count, root: hex(inForce.root), tx: txOf.get(inForce.index) ?? null } : null,
          };
        }
        const points = {};
        for (const row of built.table) points[hex(row.player)] = { points: row.points, threes: row.threes, ones: row.ones };
        store.write(CHAIN_KEY, JSON.stringify({ league, at: now(), block: built.block, matches, points }));
        self.unreachable = false;
      } catch {
        self.unreachable = true;
      }
      return store.read(CHAIN_KEY) !== before;
    },
  };
  return self;
}
