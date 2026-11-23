// The groups this device plays in.
//
// The server holds the groups. This keeps a copy on the device so the screens can be drawn at
// once, and so a group can still be seen when the phone is offline. The copy is refreshed from the
// server whenever it can be reached.

const GROUPS_KEY = "kickoff-groups";
const NAME_KEY = "kickoff-name";

/**
 * @param store   from createStore() in picks.js
 * @param client  from createClient() in server.js
 * @param device  from createDevice()
 */
export function createGroups({ store, client, device }) {
  let offline = false;

  const kept = () => {
    try {
      const d = JSON.parse(store.read(GROUPS_KEY) ?? "null");
      if (d && Array.isArray(d.groups)) return { groups: d.groups.filter((g) => g && typeof g.code === "string" && Array.isArray(g.members)), current: d.current ?? null };
    } catch {
      // what was kept is damaged: start again
    }
    return { groups: [], current: null };
  };
  const keep = (groups, current) => {
    const chosen = groups.some((g) => g.code === current) ? current : (groups[0]?.code ?? null);
    store.write(GROUPS_KEY, JSON.stringify({ groups, current: chosen }));
  };
  const put = (group) => {
    const { groups } = kept();
    keep([...groups.filter((g) => g.code !== group.code), group], group.code);
    return group;
  };
  const rememberName = (name) => store.write(NAME_KEY, String(name).trim().slice(0, 24));

  return {
    /** What the screens are handed: this player, their groups, and the one being looked at. */
    async view() {
      const { groups, current } = kept();
      const player = await device.player();
      const group = groups.find((g) => g.code === current) ?? null;
      const me = group?.members.find((m) => m.player === player) ?? null;
      return { player, groups, group, name: me?.name ?? store.read(NAME_KEY) ?? "", offline };
    },
    /** Ask the server which groups this device is in. Returns true if what is kept changed. */
    async refresh() {
      const before = store.read(GROUPS_KEY);
      const wasOffline = offline;
      try {
        keep(await client.myGroups(), kept().current);
        offline = false;
      } catch (error) {
        if (!error.unreachable) throw error;
        offline = true;
      }
      return store.read(GROUPS_KEY) !== before || offline !== wasOffline;
    },
    async start({ name, playerName, plays }) {
      const group = put(await client.startGroup({ name, playerName, plays }));
      rememberName(playerName);
      return group;
    },
    async join({ code, playerName }) {
      const group = put(await client.joinGroup({ code, playerName }));
      rememberName(playerName);
      return group;
    },
    async setPlays({ code, plays }) {
      return put(await client.setPlays({ code, plays }));
    },
    /** Look at another of this device's groups. */
    choose(code) {
      const { groups } = kept();
      keep(groups, code);
    },
  };
}
