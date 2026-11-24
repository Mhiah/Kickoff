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
// Times are in seconds. Ids, fingerprints and secrets are 64 hex digits.

import {
  buildBundle, fingerprintOf, fromHex, receiptFor, toHex, writeOpenings, decodePick,
} from "../../engine/src/index.js";

/** Picks close this many seconds before a match starts. */
export const CLOSES_BEFORE = 10 * 60;
/**
 * A bundle is frozen no sooner than this many seconds after picks close, so a pick that was
 * accepted in the last instant has been written down before the bundle is made.
 */
export const SETTLE = 5;
export const MAX_GROUP_NAME = 40;
export const MAX_PLAYER_NAME = 24;
export const MAX_MEMBERS = 200;
export const COMPETITIONS = ["pl", "cl", "nba", "wnba"];

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
      return this.group({ code });
    },

    /** Join a group with its code. Joining again just changes your name in it. */
    async joinGroup({ player, now, code, playerName }) {
      const group = await this.group({ code });
      const who = tidyName(playerName, MAX_PLAYER_NAME, "Your name");
      const already = group.members.some((m) => m.player === player);
      if (!already && group.members.length >= MAX_MEMBERS) refuse(409, `This group is full. A group can have ${MAX_MEMBERS} players.`);
      if (group.members.some((m) => m.player !== player && m.name.toLowerCase() === who.toLowerCase())) {
        refuse(409, `Someone in this group is already called ${who}. Pick another name.`);
      }
      const before = await store.tableGet(`members:${group.code}`, player);
      await store.tableSet(`members:${group.code}`, player, { name: who, joinedAt: before?.joinedAt ?? now });
      await store.tableSet(`groups-of:${player}`, group.code, { joinedAt: before?.joinedAt ?? now });
      return this.group({ code: group.code });
    },

    /** A group and its members: whoever started it, then the rest in the order they joined. Anyone with the code can see this. */
    async group({ code }) {
      if (typeof code !== "string") refuse(400, "That is not a group code.");
      const tidy = code.trim().toUpperCase();
      if (!/^[A-Z]{1,7}-\d{4}$/.test(tidy)) refuse(400, "That is not a group code. A code looks like BALLERS-4821.");
      const group = (await store.get(`group:${tidy}`)) ?? refuse(404, "There is no group with that code.");
      const members = Object.entries(await store.tableAll(`members:${tidy}`))
        .map(([player, m]) => ({ player, name: m.name, joinedAt: m.joinedAt }))
        .sort((a, b) => (b.player === group.startedBy) - (a.player === group.startedBy) || a.joinedAt - b.joinedAt || a.player.localeCompare(b.player));
      return { ...group, members };
    },

    /** The groups a player is in. */
    async groupsOf({ player }) {
      const codes = Object.keys(await store.tableAll(`groups-of:${player}`));
      const groups = [];
      for (const code of codes) groups.push(await this.group({ code }));
      return groups.sort((a, b) => a.startedAt - b.startedAt);
    },

    /** Choose which competitions a group plays. Only the player who started it may. */
    async setPlays({ player, code, plays }) {
      const group = await this.group({ code });
      if (group.startedBy !== player) refuse(403, "Only the person who started the group can change what it plays.");
      const chosen = tidyPlays(plays);
      const { members, ...kept } = group;
      await store.set(`group:${group.code}`, { ...kept, plays: chosen });
      return this.group({ code: group.code });
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
      if (await store.get(`frozen:${match}`)) refuse(409, "Picks for this match have closed.");
      const before = await store.tableGet(`sealed:${match}`, player);
      if (before && at <= before.signedAt) refuse(409, "A newer pick from this device is already in.");
      await store.tableSet(`sealed:${match}`, player, { fingerprint, signedAt: at, receivedAt: now });
      return { match, fingerprint, receivedAt: now, closesAt: f.kickoff - CLOSES_BEFORE };
    },

    /** What a player has sealed for a match, as the server holds it. */
    async sealedBy({ player, match }) {
      await fixture(match);
      const frozen = await store.get(`frozen:${match}`);
      if (frozen) {
        const entry = frozen.entries.find((e) => e.player === player);
        return entry ? { fingerprint: entry.fingerprint, locked: true } : null;
      }
      const sealed = await store.tableGet(`sealed:${match}`, player);
      return sealed ? { fingerprint: sealed.fingerprint, locked: false } : null;
    },

    /**
     * Bundle a match's picks for good. Done once, a few seconds after picks close, just before the
     * bundle's fingerprint is written to X Layer. After this nothing can be added or changed.
     * @returns { match, count, root, entries }
     */
    async freeze({ now, match }) {
      const f = await fixture(match);
      const already = await store.get(`frozen:${match}`);
      if (already) return { match, count: already.entries.length, root: already.root, entries: already.entries, frozenAt: already.frozenAt };
      if (now >= f.kickoff) refuse(409, "This match has kicked off. A bundle made now would never count.");
      if (now < f.kickoff - CLOSES_BEFORE + SETTLE) refuse(409, "Picks for this match are still open, or closed a moment ago. A bundle is made a few seconds after they close.");
      const sealed = await store.tableAll(`sealed:${match}`);
      const entries = Object.entries(sealed)
        .map(([player, s]) => ({ player, fingerprint: s.fingerprint }))
        .sort((a, b) => a.player.localeCompare(b.player));
      const bundle = await buildBundle({ league, match, entries: entries.map((e) => ({ player: fromHex(e.player), fingerprint: fromHex(e.fingerprint) })) });
      const frozen = { entries, root: toHex(bundle.root), frozenAt: now };
      await store.set(`frozen:${match}`, frozen);
      return { match, count: entries.length, root: frozen.root, entries, frozenAt: now };
    },

    /** A player's receipt: the proof their sealed pick is in the bundle. Available once picks are frozen. */
    async receipt({ player, match }) {
      await fixture(match);
      const frozen = (await store.get(`frozen:${match}`)) ?? refuse(409, "Picks for this match have not been locked yet.");
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
      const frozen = (await store.get(`frozen:${match}`)) ?? refuse(409, "No picks were locked for this match, so there is nothing to open.");
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
      return { match, pickByte };
    },

    /**
     * A match as anyone may see it. Before kickoff: how many picks are in, and nothing about who
     * picked what. After kickoff: the picks that have been opened.
     */
    async match({ now, match }) {
      const f = await fixture(match);
      const frozen = await store.get(`frozen:${match}`);
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
      const frozen = (await store.get(`frozen:${match}`)) ?? refuse(404, "No picks were locked for this match.");
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
        await store.tableSet("fixtures", f.id, { ...before, ...f });
        if (before) updated++;
        else added++;
      }
      return { added, updated };
    },
  };
}
