// The tables, as Kickoff's server last worked them out.
//
// Every point on them comes from the scoring circuits that are published on X Layer. This keeps
// the last answer on the device so the League screen can be drawn at once, and still shows
// something when the phone is offline.

const TABLE_KEY = "kickoff-table";

/** What the League screen shows before the server has answered for the first time. */
export const EMPTY = Object.freeze({ everyone: { players: 0, rows: [] }, group: null, you: { place: null, points: 0, threes: 0, ones: 0, wrong: 0 }, played: [] });

/**
 * @param store   from createStore() in picks.js
 * @param client  from createClient() in server.js
 */
export function createTable({ store, client }) {
  const kept = () => {
    try {
      const d = JSON.parse(store.read(TABLE_KEY) ?? "null");
      if (d && Array.isArray(d.table?.everyone?.rows) && Array.isArray(d.table.played) && d.table.you) return d;
    } catch {
      // what was kept is damaged: start again
    }
    return null;
  };
  return {
    /**
     * The tables as last heard, or null if the server has never been asked.
     * @param group  the code of the group being looked at. If what is kept is for another group,
     *               its table of everyone is still good and its group table is left out.
     */
    view(group = null) {
      const d = kept();
      if (!d) return null;
      return d.group === group ? d.table : { ...d.table, group: null };
    },
    /** Ask the server. Returns true if what is kept changed. Offline, what is kept stays. */
    async refresh(group = null) {
      const before = store.read(TABLE_KEY);
      try {
        store.write(TABLE_KEY, JSON.stringify({ group, table: await client.table({ group }) }));
      } catch (error) {
        if (!error.unreachable) throw error;
      }
      return store.read(TABLE_KEY) !== before;
    },
  };
}
