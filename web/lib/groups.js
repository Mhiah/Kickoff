// The groups this device plays in.
//
// The server holds the groups. This keeps a copy on the device so the screens can be drawn at
// once, and so a group can still be seen when the phone is offline. The copy is refreshed from the
// server whenever it can be reached.

const GROUPS_KEY = "kickoff-groups";
const NAME_KEY = "kickoff-name";

/**
 * Whether a seat in a group is this player's. A player who linked a wallet shares one seat between
 * their devices, and the seat lists all of them.
 */
export const sits = (member, player) => member.player === player || (member.players ?? []).includes(player);

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
      if (d && Array.isArray(d.groups)) {
        return { groups: d.groups.filter((g) => g && typeof g.code === "string" && Array.isArray(g.members)), current: d.current ?? null, wallet: typeof d.wallet === "string" ? d.wallet : null };
      }
    } catch {
      // what was kept is damaged: start again
    }
    return { groups: [], current: null, wallet: null };
  };
  const keep = (groups, current, wallet = kept().wallet) => {
    const chosen = groups.some((g) => g.code === current) ? current : (groups[0]?.code ?? null);
    store.write(GROUPS_KEY, JSON.stringify({ groups, current: chosen, wallet }));
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
      const { groups, current, wallet } = kept();
      const player = await device.player();
      const group = groups.find((g) => g.code === current) ?? null;
      const me = group?.members.find((m) => sits(m, player)) ?? null;
      return { player, groups, group, name: me?.name ?? store.read(NAME_KEY) ?? "", offline, wallet };
    },
    /** Ask the server which groups this device is in. Returns true if what is kept changed. */
    async refresh() {
      const before = store.read(GROUPS_KEY);
      const wasOffline = offline;
      try {
        const { groups, wallet } = await client.mine();
        keep(groups, kept().current, wallet ?? null);
        offline = false;
      } catch (error) {
        if (!error.unreachable) throw error;
        offline = true;
      }
      return store.read(GROUPS_KEY) !== before || offline !== wasOffline;
    },
    async start({ name, playerName, plays, brand = null }) {
      const group = put(await client.startGroup({ name, playerName, plays, brand }));
      rememberName(playerName);
      return group;
    },
    async join({ code, playerName }) {
      const group = put(await client.joinGroup({ code, playerName }));
      rememberName(playerName);
      return group;
    },
    /** Whoever started a brand's group says they paid a winner. Kickoff's robot reads the payment before it counts. */
    async paid({ code, place, tx }) {
      return put(await client.claimPaid({ code, place, tx }));
    },
    async setPlays({ code, plays }) {
      return put(await client.setPlays({ code, plays }));
    },
    /** Keep what the server said after a wallet was linked (lib/wallet.js): the wallet, and the groups it brought back. */
    linked({ wallet, groups }) {
      keep(groups, kept().current, wallet);
    },
    /** Look at another of this device's groups. */
    choose(code) {
      const { groups } = kept();
      keep(groups, code);
    },
  };
}
