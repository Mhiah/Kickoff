// Kickoff's server: what it does, and what it refuses to do.
//
// The server exists because a player has no wallet. It gathers the fingerprints of sealed picks so
// they can be locked on X Layer together, and it keeps the groups friends play in. It is built to
// know as little as possible:
//
//   - Before kickoff it only ever receives a pick's fingerprint, never the pick.
//   - Everything a player sends is signed by their own device (see engine/src/identity.js), so
//     nobody can send, change or open a pick in someone else's name.
//   - It cannot change a pick or add one after picks close: the bundle is frozen, its fingerprint
//     goes on X Layer, and every player can hold a receipt.
//
// What it could still do is leave a pick out of a bundle. A player's receipt is the proof theirs
// was included.
//
// A player who has a wallet may link it (engine/src/wallet.js). Nobody has to. A linked wallet is a
// way back in: a new phone that links the same wallet takes the same seat in the same groups. The
// server never asks a wallet to pay or to send anything, and it tells other players only that a
// seat has a wallet linked, never which wallet.
//
// Everyone who plays has one name, and no two players have the same one. The table of everyone
// is numbered from 1: most points first, and between players level on points, whoever joined
// Kickoff first.
//
// Times are in seconds. Ids, fingerprints and secrets are 64 hex digits.

import {
  BASKETBALL_HEX, FOOTBALL_HEX, TENNIS_HEX,
  buildBundle, fingerprintOf, fromHex, loadCircuits, receiptFor, scorePick, toHex, verifyWalletLink, writeOpenings, decodePick,
} from "../../engine/src/index.js";

/** The scoring circuits, the same ones that are published on X Layer. Every point on a table comes from them. */
const CIRCUITS = loadCircuits({ football: FOOTBALL_HEX, basketball: BASKETBALL_HEX, tennis: TENNIS_HEX });

/** Picks close this many seconds before a match starts. */
export const CLOSES_BEFORE = 10 * 60;
/**
 * A bundle is frozen no sooner than this many seconds after picks close, so a pick that was
 * accepted in the last instant has been written down before the bundle is made.
 */
export const SETTLE = 5;
export const MAX_GROUP_NAME = 40;
export const MAX_PLAYER_NAME = 24;
/** A group is for friends, so it is kept small. When it is full, nobody else can join it. */
export const MAX_MEMBERS = 30;
export const COMPETITIONS = ["pl", "cl", "nba", "wnba"];
/** How many rows of the table of everyone are sent. A player further down is sent their own row as well. */
export const TABLE_TOP = 20;
/** How many of a player's finished matches are sent. */
export const PLAYED_SHOWN = 20;
export const NAME_TAKEN = "That name is taken. Pick another.";

/** Something the server will not do, with the reason to show the player. */
export class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const refuse = (status, message) => {
  throw new Refusal(status, message);
};

const HEX64 = /^[0-9a-f]{64}$/;
const isId = (value) => typeof value === "string" && HEX64.test(value);

/** Tidy a name someone typed. Refuses an empty one, an overlong one, or one with hidden characters. */
export function tidyName(value, max, what) {
  if (typeof value !== "string") refuse(400, `${what} is missing.`);
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length === 0) refuse(400, `${what} is missing.`);
  if ([...name].length > max) refuse(400, `${what} can be at most ${max} characters.`);
  if (/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/.test(name)) refuse(400, `${what} has characters that are not allowed.`);
  return name;
}

/** The competitions a group plays, checked and put in Kickoff's own order. A group plays at least one. */
function tidyPlays(plays) {
  if (!Array.isArray(plays) || plays.some((c) => !COMPETITIONS.includes(c))) refuse(400, "That is not a list of competitions.");
  const chosen = COMPETITIONS.filter((c) => plays.includes(c));
  if (chosen.length === 0) refuse(400, "A group has to play at least one competition.");
  return chosen;
}

/** A code for a group: letters from its name, a dash, four digits. "Sunday Ballers" gives SUNDAYB-4821. */
function codeFor(name, digits) {
  const letters = name.toUpperCase().normalize("NFD").replace(/[^A-Z]/g, "").slice(0, 7) || "GROUP";
  return `${letters}-${digits}`;
}

/**
 * @param store   somewhere to keep things (see store.js)
 * @param league  Kickoff's id on X Layer, as hex
 * @param random  a function giving a whole number from 0 up to (not including) its argument
 */
export function createKickoff({ store, league, random = (n) => Math.floor(Math.random() * n) }) {
  if (!isId(league)) throw new Error("the league id must be 64 hex digits");

  const fixture = async (match) => {
    if (!isId(match)) refuse(400, "That is not a match.");
    return (await store.tableGet("fixtures", match)) ?? refuse(404, "That match is not on Kickoff's list.");
  };

  /**
   * Bundle a match's picks, once, a few seconds after they close. After picks close nothing can be
   * added or changed, so the bundle comes out the same whenever it is made and whoever asks first.
   * That is why the server does this by itself, the first time anyone looks at the match after
   * picks have closed: it does not wait to be told, so a late robot cannot leave a match unbundled.
   * @returns the frozen bundle, or null if picks have not closed yet
   */
  const settle = async (f, now) => {
    const already = await store.get(`frozen:${f.id}`);
    if (already) return already;
    if (now < f.kickoff - CLOSES_BEFORE + SETTLE) return null;
    const sealed = await store.tableAll(`sealed:${f.id}`);
    const entries = Object.entries(sealed)
      .map(([player, s]) => ({ player, fingerprint: s.fingerprint }))
      .sort((a, b) => a.player.localeCompare(b.player));
    const bundle = await buildBundle({ league, match: f.id, entries: entries.map((e) => ({ player: fromHex(e.player), fingerprint: fromHex(e.fingerprint) })) });
    // Two requests arriving together both work out the same bundle. The first to write it wins.
    await store.setIfAbsent(`frozen:${f.id}`, { entries, root: toHex(bundle.root), frozenAt: now });
    return store.get(`frozen:${f.id}`);
  };

  /** Every device a wallet has linked. */
  const devicesOf = async (wallet) => Object.keys(await store.tableAll(`players-of:${wallet}`));

  // ------------------------------------------------------------------ people and their names
  //
  // A person is one device, or every device of one wallet. `people` holds each person's name and
  // when they joined Kickoff; `owner-of` says which person a device belongs to. A name is claimed
  // in one step, so two people asking for the same name at the same moment cannot both get it.

  // A device that linked a wallet before this list was kept is found by its wallet.
  const personOf = async (player) => (await store.tableGet("owner-of", player)) ?? (await store.get(`wallet-of:${player}`))?.wallet ?? player;
  const devicesOfPerson = async (person) => (person.startsWith("0x") ? devicesOf(person) : [person]);
  const nameKey = (name) => `name:${name.toLowerCase()}`;
  /** The tables are worked out again the next time anyone asks. */
  const stale = () => store.set("table-stamp", globalThis.crypto.randomUUID());

  const claim = async (person, name) => {
    await store.setIfAbsent(nameKey(name), person);
    if ((await store.get(nameKey(name))) !== person) refuse(409, NAME_TAKEN);
  };

  /**
   * Give the person behind a device their name, or change it. The name is the same in every group
   * they are in. Refused if somebody else has it.
   */
  const named = async (player, name, now) => {
    const person = await personOf(player);
    const before = await store.tableGet("people", person);
    if (before?.name === name) return person;
    await claim(person, name);
    if (before && before.name.toLowerCase() !== name.toLowerCase()) await store.remove(nameKey(before.name));
    await store.tableSet("people", person, { name, joinedAt: before?.joinedAt ?? now });
    await store.tableSet("owner-of", player, person);
    if (before) await writeName(person, name);
    await stale();
    return person;
  };

  /** Put a person's name on their seat in every group they are in. */
  const writeName = async (person, name) => {
    for (const device of await devicesOfPerson(person)) {
      for (const code of Object.keys(await store.tableAll(`groups-of:${device}`))) {
        const m = await store.tableGet(`members:${code}`, device);
        if (m && m.name !== name) await store.tableSet(`members:${code}`, device, { ...m, name });
      }
    }
  };

  /** A name nobody has, made from one that may be taken: "Ada", then "Ada 2", "Ada 3"… */
  const freeName = async (wanted, person) => {
    for (let n = 1; n < 1000; n++) {
      const name = n === 1 ? wanted : `${wanted.slice(0, MAX_PLAYER_NAME - String(n).length - 1)} ${n}`;
      const holder = await store.get(nameKey(name));
      if (!holder || holder === person) return name;
    }
    return refuse(503, "Could not find a free name. Try again.");
  };

  /**
   * Make sure the person behind a device is on Kickoff's list of people. Someone who joined a
   * group before names were shared keeps the name they had there, with a number added only if
   * somebody else took it first. `fallback` is the name for someone who has none at all.
   * @returns the person, or null if they have no name and no fallback was given
   */
  const ensurePerson = async (player, now, fallback = null) => {
    const person = await personOf(player);
    if (await store.tableGet("people", person)) {
      if (person !== player && !(await store.tableGet("owner-of", player))) await store.tableSet("owner-of", player, person);
      return person;
    }
    let first = null;
    for (const device of await devicesOfPerson(person)) {
      for (const code of Object.keys(await store.tableAll(`groups-of:${device}`))) {
        const m = await store.tableGet(`members:${code}`, device);
        if (m && (!first || m.joinedAt < first.joinedAt)) first = m;
      }
    }
    const wanted = first?.name ?? fallback;
    if (!wanted) return null;
    const name = await freeName(wanted, person);
    await claim(person, name);
    await store.tableSet("people", person, { name, joinedAt: first?.joinedAt ?? now });
    for (const device of new Set([player, ...(await devicesOfPerson(person))])) await store.tableSet("owner-of", device, person);
    await stale();
    if (first) await writeName(person, name);
    return person;
  };

  // ------------------------------------------------------------------ points
  //
  // A pick scores once its match is final and it has been opened. Whichever of those happens
  // second does the scoring. Scoring the same pick twice writes the same thing twice.

  const scoreOne = async (f, player, pickByte) => {
    const points = scorePick({ circuits: CIRCUITS, sport: f.sport, pickByte, result: decodePick(f.sport, f.resultByte) });
    await store.tableSet(`points:${f.id}`, player, points);
    await store.tableSet(`played:${player}`, f.id, { pickByte, points });
  };
  const isFinal = (f) => f.state === "final" && Number.isInteger(f.resultByte);
  /** Score every opened pick of a match that has just been given its result. */
  const scoreMatch = async (f) => {
    const frozen = await store.get(`frozen:${f.id}`);
    if (!frozen) return;
    const opened = await store.tableAll(`opened:${f.id}`);
    for (const e of frozen.entries) if (opened[e.player]) await scoreOne(f, e.player, opened[e.player].pickByte);
    await store.tableSet("scored", f.id, { kickoff: f.kickoff });
    await stale();
  };

  /**
   * Everyone on Kickoff, in order: most points first, and between players level on points, whoever
   * joined first. Kept until something changes it.
   * @returns [{ key, name, joinedAt, threes, ones, points, place }]
   */
  const everyone = async () => {
    const stamp = (await store.get("table-stamp")) ?? "start";
    const kept = await store.get("table-kept");
    if (kept?.stamp === stamp) return kept.rows;
    const people = await store.tableAll("people");
    const owner = await store.tableAll("owner-of");
    const tally = new Map(Object.keys(people).map((key) => [key, { threes: 0, ones: 0 }]));
    for (const match of Object.keys(await store.tableAll("scored"))) {
      for (const [player, points] of Object.entries(await store.tableAll(`points:${match}`))) {
        const t = tally.get(owner[player] ?? player);
        if (!t) continue;
        if (points === 3) t.threes++;
        else if (points === 1) t.ones++;
      }
    }
    const rows = [...tally]
      .map(([key, t]) => ({ key, name: people[key].name, joinedAt: people[key].joinedAt, ...t, points: 3 * t.threes + t.ones }))
      .sort((a, b) => b.points - a.points || a.joinedAt - b.joinedAt || a.key.localeCompare(b.key));
    rows.forEach((row, i) => (row.place = i + 1));
    await store.set("table-kept", { stamp, rows });
    return rows;
  };

  /**
   * One wallet has one seat in a group, whichever of its devices is being used. This gives every
   * device of the wallet the same seat: the person's name, joined at the same time.
   */
  const shareSeat = async (code, wallet, now) => {
    const records = [];
    for (const device of await devicesOf(wallet)) records.push([device, await store.tableGet(`members:${code}`, device)]);
    const seated = records.filter(([, m]) => m);
    if (seated.length === 0) return;
    const newest = seated.reduce((a, b) => ((b[1].since ?? b[1].joinedAt) > (a[1].since ?? a[1].joinedAt) ? b : a))[1];
    const name = (await store.tableGet("people", wallet))?.name ?? newest.name;
    const joinedAt = Math.min(...seated.map(([, m]) => m.joinedAt));
    for (const [device, m] of records) {
      // A device given the seat just now is the one being used, so it is the newest.
      const next = { name, joinedAt, wallet, since: m?.since ?? m?.joinedAt ?? now };
      if (!m || m.name !== next.name || m.joinedAt !== next.joinedAt || m.wallet !== wallet) await store.tableSet(`members:${code}`, device, next);
      if (!m) await store.tableSet(`groups-of:${device}`, code, { joinedAt });
    }
  };

  /** After a player with a linked wallet starts, joins or renames in a group: bring the wallet's other devices along. */
  const bringDevices = async (code, player, now) => {
    const link = await store.get(`wallet-of:${player}`);
    if (link) await shareSeat(code, link.wallet, now);
  };

  return {
    /** Kickoff's id on X Layer. Every match id and every sealed pick is made with it. */
    league,

    // ---------------------------------------------------------------- groups

    /**
     * Start a group. The player who starts it is its first member.
     * `plays` is which competitions it plays; left out, it plays all of them.
     */
    async createGroup({ player, now, name, playerName, plays }) {
      const groupName = tidyName(name, MAX_GROUP_NAME, "The group's name");
      const who = tidyName(playerName, MAX_PLAYER_NAME, "Your name");
      const chosen = plays === undefined ? [...COMPETITIONS] : tidyPlays(plays);
      await ensurePerson(player, now);
      await named(player, who, now);
      // The code is claimed and the group written in one step, so two groups started at the same
      // moment can never be given the same code.
      let code = null;
      for (let tries = 0; tries < 30 && code === null; tries++) {
        const candidate = codeFor(groupName, String(random(10000)).padStart(4, "0"));
        const claimed = await store.setIfAbsent(`group:${candidate}`, { code: candidate, name: groupName, startedBy: player, startedAt: now, plays: chosen });
        if (claimed) code = candidate;
      }
      if (code === null) refuse(503, "Could not make a code for the group. Try again.");
      await store.tableSet(`members:${code}`, player, { name: who, joinedAt: now });
      await store.tableSet(`groups-of:${player}`, code, { joinedAt: now });
      await bringDevices(code, player, now);
      return this.group({ code });
    },

    /** Join a group with its code. A player has one name everywhere: giving another one here changes it everywhere. */
    async joinGroup({ player, now, code, playerName }) {
      const group = await this.group({ code });
      const who = tidyName(playerName, MAX_PLAYER_NAME, "Your name");
      const sits = (m) => m.player === player || (m.players ?? []).includes(player);
      const already = group.members.some(sits);
      if (!already && group.members.length >= MAX_MEMBERS) refuse(409, `This group is full. A group can have ${MAX_MEMBERS} players.`);
      if (group.members.some((m) => !sits(m) && m.name.toLowerCase() === who.toLowerCase())) {
        refuse(409, NAME_TAKEN);
      }
      await ensurePerson(player, now);
      await named(player, who, now);
      const before = await store.tableGet(`members:${group.code}`, player);
      // `since` is when this device last sat down here, so the seat is listed under the one in use.
      await store.tableSet(`members:${group.code}`, player, { ...before, name: who, joinedAt: before?.joinedAt ?? now, since: now });
      await store.tableSet(`groups-of:${player}`, group.code, { joinedAt: before?.joinedAt ?? now });
      await bringDevices(group.code, player, now);
      return this.group({ code: group.code });
    },

    /** A group and its members: whoever started it, then the rest in the order they joined. Anyone with the code can see this. */
    async group({ code }) {
      if (typeof code !== "string") refuse(400, "That is not a group code.");
      const tidy = code.trim().toUpperCase();
      if (!/^[A-Z]{1,7}-\d{4}$/.test(tidy)) refuse(400, "That is not a group code. A code looks like BALLERS-4821.");
      const group = (await store.get(`group:${tidy}`)) ?? refuse(404, "There is no group with that code.");
      // One seat for each player. The devices of one wallet share a seat: it is listed once, under
      // the device used most recently, with `linked` and the ids of all its devices. Which wallet
      // it is stays out of what anyone else can see.
      const seats = new Map();
      for (const [player, m] of Object.entries(await store.tableAll(`members:${tidy}`))) {
        const key = m.wallet ?? player;
        seats.set(key, [...(seats.get(key) ?? []), { player, ...m }]);
      }
      const starts = (seat) => (seat.players ?? [seat.player]).includes(group.startedBy);
      const members = [...seats.values()]
        .map((devices) => {
          devices.sort((a, b) => (b.since ?? b.joinedAt) - (a.since ?? a.joinedAt) || a.player.localeCompare(b.player));
          const seat = { player: devices[0].player, name: devices[0].name, joinedAt: Math.min(...devices.map((d) => d.joinedAt)) };
          return devices[0].wallet ? { ...seat, linked: true, players: devices.map((d) => d.player).sort() } : seat;
        })
        .sort((a, b) => starts(b) - starts(a) || a.joinedAt - b.joinedAt || a.player.localeCompare(b.player));
      return { ...group, members };
    },

    /** The groups a player is in. */
    async groupsOf({ player, now = 0 }) {
      await ensurePerson(player, now);
      const codes = Object.keys(await store.tableAll(`groups-of:${player}`));
      const groups = [];
      for (const code of codes) groups.push(await this.group({ code }));
      return groups.sort((a, b) => a.startedAt - b.startedAt);
    },

    /** Choose which competitions a group plays. Only the player who started it may. */
    async setPlays({ player, code, plays }) {
      const group = await this.group({ code });
      const starter = group.members.find((m) => (m.players ?? [m.player]).includes(group.startedBy));
      if (!(starter?.players ?? [group.startedBy]).includes(player)) refuse(403, "Only the person who started the group can change what it plays.");
      const chosen = tidyPlays(plays);
      const { members, ...kept } = group;
      await store.set(`group:${group.code}`, { ...kept, plays: chosen });
      return this.group({ code: group.code });
    },

    // ---------------------------------------------------------------- wallets

    /**
     * Link a wallet to this player. The wallet proves itself by signing a note that names the
     * player (engine/src/wallet.js); nothing is paid and nothing goes on chain.
     *
     * A wallet may link more than one device. They then share one seat in every group any of them
     * is in, which is how a player gets back in on a new phone. A device links one wallet, once.
     * @returns { wallet, linkedAt, carried } where `carried` counts the groups this device was
     *          brought into because the wallet's other devices were already in them
     */
    async linkWallet({ player, now, wallet, at, signature }) {
      let address;
      try {
        address = verifyWalletLink({ player, wallet, at, signature, now });
      } catch (error) {
        refuse(400, `${error.message[0].toUpperCase()}${error.message.slice(1)}${error.message.endsWith(".") ? "" : "."}`);
      }
      await store.setIfAbsent(`wallet-of:${player}`, { wallet: address, at, signature: signature.toLowerCase().replace(/^0x/, ""), linkedAt: now });
      const link = await store.get(`wallet-of:${player}`);
      if (link.wallet !== address) refuse(409, "This device is already linked to another wallet.");
      const mineBefore = new Set(Object.keys(await store.tableAll(`groups-of:${player}`)));
      if (!(await store.tableGet(`players-of:${address}`, player))) await store.tableSet(`players-of:${address}`, player, { linkedAt: link.linkedAt });
      // The device and the wallet's other devices are one person from now on, with one name. If
      // the wallet already has a name, this device takes it and gives its own up. Whichever of
      // them joined Kickoff first is when the person joined.
      await ensurePerson(player, now);
      if ((await personOf(player)) !== address) {
        const mine = await store.tableGet("people", player);
        const theirs = await store.tableGet("people", address);
        if (mine && !theirs) {
          await store.tableSet("people", address, mine);
          await store.set(nameKey(mine.name), address);
        } else if (mine && theirs) {
          if (mine.name.toLowerCase() !== theirs.name.toLowerCase()) await store.remove(nameKey(mine.name));
          if (mine.joinedAt < theirs.joinedAt) await store.tableSet("people", address, { ...theirs, joinedAt: mine.joinedAt });
        }
        if (mine) await store.tableDelete("people", player);
        await store.tableSet("owner-of", player, address);
        await stale();
      }
      // Every group any device of this wallet is in now has one seat for all of them.
      const codes = new Set();
      for (const device of await devicesOf(address)) for (const code of Object.keys(await store.tableAll(`groups-of:${device}`))) codes.add(code);
      for (const code of codes) await shareSeat(code, address, now);
      return { wallet: address, linkedAt: link.linkedAt, carried: [...codes].filter((code) => !mineBefore.has(code)).length };
    },

    /**
     * The wallet this player has linked, with the signed note that proves it, or null. Only the
     * player's own device is told.
     */
    async walletOf({ player }) {
      const link = await store.get(`wallet-of:${player}`);
      return link ? { wallet: link.wallet, at: link.at, signature: link.signature, linkedAt: link.linkedAt } : null;
    },

    // ---------------------------------------------------------------- tables

    /**
     * What a player's League screen shows.
     * @param code  the group they are looking at, if any
     * @returns {
     *   everyone  { players, rows }: the top of the table of everybody, and this player's own row
     *             (marked `below`) if they are further down
     *   group     { players, rows }: the same for the group, in full, or null
     *   you       { place, points, threes, ones, wrong } among everybody. `place` is null for
     *             someone with no name yet, who is not on the table. `wrong` counts their picks
     *             that scored nothing.
     *   played    this player's finished matches, newest first:
     *             [{ match, comp, sport, home, away, score, kickoff, pickByte, points }]
     * }
     * A row is { place, name, threes, ones, points, you }. Nothing in it says who a player is
     * beyond their name.
     */
    async table({ player, now, code = null }) {
      const me = await ensurePerson(player, now);
      let all = await everyone();
      let members = null;
      if (code !== null && code !== undefined) {
        const group = await this.group({ code });
        const owner = await store.tableAll("owner-of");
        const known = new Set(all.map((row) => row.key));
        members = new Set();
        let added = false;
        for (const m of group.members) {
          let key = owner[m.player] ?? m.player;
          if (!known.has(key)) {
            // Someone who joined before names were shared is put on the list of people now.
            key = (await ensurePerson(m.player, now)) ?? key;
            added = true;
          }
          members.add(key);
        }
        if (added) all = await everyone();
      }
      const mine = me ? (all.find((row) => row.key === me) ?? null) : null;
      const show = (row, place, extra = {}) => ({ place, name: row.name, threes: row.threes, ones: row.ones, points: row.points, you: row.key === me, ...extra });
      const top = all.slice(0, TABLE_TOP).map((row) => show(row, row.place));
      if (mine && mine.place > TABLE_TOP) top.push(show(mine, mine.place, { below: true }));
      const inGroup = members ? all.filter((row) => members.has(row.key)) : null;

      const mineByMatch = new Map();
      if (me) for (const device of await devicesOfPerson(me)) for (const [match, p] of Object.entries(await store.tableAll(`played:${device}`))) mineByMatch.set(match, p);
      const played = [];
      const fixtures = mineByMatch.size > 0 ? await store.tableAll("fixtures") : {};
      for (const [match, p] of mineByMatch) {
        const f = fixtures[match];
        if (f && isFinal(f)) played.push({ match, comp: f.comp, sport: f.sport, home: f.home, away: f.away, score: f.score ?? "", kickoff: f.kickoff, pickByte: p.pickByte, points: p.points });
      }
      played.sort((a, b) => b.kickoff - a.kickoff || a.match.localeCompare(b.match));

      return {
        everyone: { players: all.length, rows: top },
        group: inGroup ? { players: inGroup.length, rows: inGroup.map((row, i) => show(row, i + 1)) } : null,
        you: { place: mine?.place ?? null, points: mine?.points ?? 0, threes: mine?.threes ?? 0, ones: mine?.ones ?? 0, wrong: played.filter((p) => p.points === 0).length },
        played: played.slice(0, PLAYED_SHOWN),
      };
    },

    // ---------------------------------------------------------------- fixtures

    /** Every match on Kickoff's list, soonest first. */
    async fixtures() {
      return Object.values(await store.tableAll("fixtures")).sort((a, b) => a.kickoff - b.kickoff || a.label.localeCompare(b.label));
    },

    // ---------------------------------------------------------------- sealed picks

    /**
     * Take in a sealed pick: its fingerprint only. Sending again before picks close replaces it.
     * `at` is the time the device signed the request; a request older than the last one accepted
     * for the same match is refused, so an earlier pick cannot be played back over a later one.
     */
    async sealPick({ player, now, at, match, fingerprint }) {
      const f = await fixture(match);
      if (!isId(fingerprint)) refuse(400, "That is not a sealed pick.");
      if (f.state !== "scheduled") refuse(409, "This match is no longer open for picks.");
      if (now >= f.kickoff - CLOSES_BEFORE) refuse(409, "Picks for this match have closed.");
      const before = await store.tableGet(`sealed:${match}`, player);
      if (before && at <= before.signedAt) refuse(409, "A newer pick from this device is already in.");
      // Everyone who plays is on the table, so everyone has a name. Someone who picks before
      // choosing one is called "Player" and four characters of their id until they do.
      await ensurePerson(player, now, `Player ${player.slice(0, 4).toUpperCase()}`);
      await store.tableSet(`sealed:${match}`, player, { fingerprint, signedAt: at, receivedAt: now });
      // One player, one pick. If this player's wallet has other devices, a pick one of them sent
      // for this match is replaced by this one, just as a device replaces its own.
      const link = await store.get(`wallet-of:${player}`);
      if (link) for (const device of await devicesOf(link.wallet)) if (device !== player) await store.tableDelete(`sealed:${match}`, device);
      return { match, fingerprint, receivedAt: now, closesAt: f.kickoff - CLOSES_BEFORE };
    },

    /** What a player has sealed for a match, as the server holds it. */
    async sealedBy({ player, now, match }) {
      const f = await fixture(match);
      const frozen = await settle(f, now);
      if (frozen) {
        const entry = frozen.entries.find((e) => e.player === player);
        return entry ? { fingerprint: entry.fingerprint, locked: true } : null;
      }
      const sealed = await store.tableGet(`sealed:${match}`, player);
      return sealed ? { fingerprint: sealed.fingerprint, locked: false } : null;
    },

    /**
     * A match's bundle: the picks that were in when picks closed. The server makes it by itself
     * (see settle above); this is how the robot asks for it, to write its fingerprint to X Layer.
     * Refused while picks are still open.
     * @returns { match, count, root, entries, frozenAt }
     */
    async freeze({ now, match }) {
      const f = await fixture(match);
      const frozen = (await settle(f, now)) ?? refuse(409, "Picks for this match are still open, or closed a moment ago. A bundle is made a few seconds after they close.");
      return { match, count: frozen.entries.length, root: frozen.root, entries: frozen.entries, frozenAt: frozen.frozenAt };
    },

    /** A player's receipt: the proof their sealed pick is in the bundle. Available once picks are frozen. */
    async receipt({ player, now, match }) {
      const f = await fixture(match);
      const frozen = (await settle(f, now)) ?? refuse(409, "Picks for this match have not been locked yet.");
      if (!frozen.entries.some((e) => e.player === player)) refuse(404, "There is no sealed pick from this player in the bundle.");
      const bundle = await buildBundle({ league, match, entries: frozen.entries.map((e) => ({ player: fromHex(e.player), fingerprint: fromHex(e.fingerprint) })) });
      const r = await receiptFor(bundle, fromHex(player));
      return { match, player, fingerprint: toHex(r.fingerprint), index: r.index, count: r.count, path: r.path.map(toHex), root: toHex(r.root) };
    },

    // ---------------------------------------------------------------- opening

    /**
     * Take in an opened pick: the pick and its secret. Only after kickoff, and only if they produce
     * exactly the fingerprint that was locked.
     */
    async openPick({ player, now, match, pickByte, salt }) {
      const f = await fixture(match);
      if (now < f.kickoff) refuse(409, "A pick cannot be opened before the match starts.");
      const frozen = await settle(f, now);
      const entry = frozen.entries.find((e) => e.player === player) ?? refuse(404, "You have no sealed pick in this match's bundle.");
      if (!Number.isInteger(pickByte) || pickByte < 0 || pickByte > 255 || !isId(salt)) refuse(400, "That is not an opened pick.");
      const fingerprint = await fingerprintOf({ league, match, sport: f.sport, pickByte, player: fromHex(player), salt: fromHex(salt) });
      if (toHex(fingerprint) !== entry.fingerprint) refuse(409, "That pick and secret do not produce the fingerprint you sealed.");
      try {
        decodePick(f.sport, pickByte);
      } catch {
        refuse(409, "That is not a pick that can happen in this kind of match.");
      }
      await store.tableSet(`opened:${match}`, player, { pickByte, salt, openedAt: now });
      if (isFinal(f)) {
        await scoreOne(f, player, pickByte);
        await store.tableSet("scored", f.id, { kickoff: f.kickoff });
        await stale();
      }
      return { match, pickByte };
    },

    /**
     * A match as anyone may see it. Before kickoff: how many picks are in, and nothing about who
     * picked what. After kickoff: the picks that have been opened.
     */
    async match({ now, match }) {
      const f = await fixture(match);
      const frozen = await settle(f, now);
      const sealedCount = frozen ? frozen.entries.length : Object.keys(await store.tableAll(`sealed:${match}`)).length;
      const out = { fixture: f, sealedCount, locked: frozen ? { root: frozen.root, count: frozen.entries.length, frozenAt: frozen.frozenAt } : null, opened: [] };
      if (now >= f.kickoff && frozen) {
        const opened = await store.tableAll(`opened:${match}`);
        out.sealedBy = frozen.entries.map((e) => e.player);
        out.opened = frozen.entries.filter((e) => opened[e.player]).map((e) => ({ player: e.player, pickByte: opened[e.player].pickByte }));
      }
      return out;
    },

    /**
     * The file of opened picks for a match, in the form the picks engine reads (docs/PROTOCOL.md).
     * Every opening in it proves itself against the lock on X Layer.
     */
    async openingsFile({ now, match }) {
      const f = await fixture(match);
      if (now < f.kickoff) refuse(409, "Picks are not opened before the match starts.");
      const frozen = await settle(f, now);
      const entries = frozen.entries.map((e) => ({ player: fromHex(e.player), fingerprint: fromHex(e.fingerprint) }));
      const bundle = await buildBundle({ league, match, entries });
      const opened = await store.tableAll(`opened:${match}`);
      const openings = [];
      for (const e of frozen.entries) {
        if (!opened[e.player]) continue;
        openings.push({ pickByte: opened[e.player].pickByte, player: fromHex(e.player), salt: fromHex(opened[e.player].salt), receipt: await receiptFor(bundle, fromHex(e.player)) });
      }
      return writeOpenings({ match: fromHex(match), entries, openings });
    },

    // ---------------------------------------------------------------- the robot's side

    /**
     * Put matches on Kickoff's list, or update ones already there. Only the robot does this.
     * A match's id never changes, and neither do the facts that make its id.
     */
    async putFixtures({ fixtures }) {
      if (!Array.isArray(fixtures)) refuse(400, "That is not a list of matches.");
      let added = 0;
      let updated = 0;
      for (const f of fixtures) {
        if (!isId(f?.id) || !Number.isSafeInteger(f.kickoff) || typeof f.label !== "string" || ![1, 2].includes(f.sport) || !COMPETITIONS.includes(f.comp)) {
          refuse(400, "One of the matches is not in the right form.");
        }
        const before = await store.tableGet("fixtures", f.id);
        if (before && (before.kickoff !== f.kickoff || before.label !== f.label || before.sport !== f.sport)) {
          refuse(409, `The facts of ${before.label} cannot change. A moved match is a new match.`);
        }
        const after = { ...before, ...f };
        await store.tableSet("fixtures", f.id, after);
        // The result has just come in, or has been put right: every opened pick is scored.
        if (isFinal(after) && !(before && isFinal(before) && before.resultByte === after.resultByte)) await scoreMatch(after);
        if (before) updated++;
        else added++;
      }
      return { added, updated };
    },
  };
}
