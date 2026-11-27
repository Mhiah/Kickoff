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
  ENVELOPE_BYTES, PUBLISHED, SPORTS, TENNIS, decodeResult,
  buildBundle, fingerprintOf, fromHex, loadCircuits, receiptFor, scorePick, toHex, verifyWalletLink, writeOpenings, decodePick,
} from "../../engine/src/index.js";

/** The scoring circuits, the same ones that are published on X Layer. Every point on a table comes from them. */
const CIRCUITS = loadCircuits(PUBLISHED);

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
/** The most players in a group run by a brand. Only Kickoff's own key can start one. */
export const BRAND_MAX = 5000;
export const MAX_BRAND_NAME = 30;
export const MAX_PRIZE = 80;
export const COMPETITIONS = ["pl", "cl", "ll", "sa", "nba", "wnba"];
/** How many rows of the table of everyone are sent. A player further down is sent their own row as well. */
export const TABLE_TOP = 20;
/** How many of a player's finished matches are sent. */
export const PLAYED_SHOWN = 20;
export const NAME_TAKEN = "That name is taken. Choose another.";

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
/**
 * The tokens a brand's prize can be paid in, on X Layer. Each is the real one, by its address, so a
 * token that only calls itself USDT or USDC is not taken for it.
 *   USDT  USD₮0, Tether's token on X Layer (OKX's token list for X Layer)
 *   USDC  the USDC that Circle issues on X Layer (Circle's list of USDC addresses)
 */
export const PRIZE_TOKENS = {
  USDT: { address: "0x779ded0c9e1022225f8e0630b35a9b54be713736", decimals: 6 },
  USDC: { address: "0xb6ceceab302e2e4948951ee7843fc24e92933061", decimals: 6 },
};
/** The most winners a prize can be shared between, and the biggest prize, in whole tokens. */
export const MAX_WINNERS = 10;
export const MAX_PRIZE_AMOUNT = 1_000_000;
/** A group anyone starts for a brand has to end within this long. */
export const LONGEST_GROUP = 366 * 24 * 60 * 60;

/** An amount in a token's smallest unit, as people write it: 100, 33.333333, 1,250.5. */
const inUnits = (raw, decimals) => {
  const whole = (raw / 10n ** BigInt(decimals)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (raw % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : whole;
};

/** A week, in seconds. */
export const WEEK = 7 * 24 * 60 * 60;
/** The Monday, at midnight UTC, of the week a moment falls in. (The first day ever counted was a Thursday.) */
export const weekStart = (seconds) => {
  const day = Math.floor(seconds / 86400);
  return (day - ((day + 3) % 7)) * 86400;
};
/** How long a code for moving to another phone lasts, in seconds. */
export const MOVE_LASTS = 10 * 60;
/** How many wrong codes one phone may try in that time. */
export const MOVE_TRIES = 5;
/** The biggest locked copy the server will hold, in characters of base64. */
export const MOVE_MAX = 56_000;
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
 * @param signer  from createSigner() in signing.js: signs that a sealed prediction was taken.
 *                Without one, predictions are taken as before and nothing is signed.
 */
export function createKickoff({ store, league, random = (n) => Math.floor(Math.random() * n), brandMax = BRAND_MAX, signer = null }) {
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
  // A pick only counts if its match's sealed picks were locked on X Layer before kickoff. The robot
  // does the locking and tells this server how it went (putLocks below): "locked", or "missed".
  //
  // So a pick scores once three things are true: its match was locked, the match is final, and the
  // pick has been opened. Whichever happens last does the scoring. A match whose lock was missed
  // never scores for anyone. Scoring the same pick twice writes the same thing twice.

  const scoreOne = async (f, player, pickByte) => {
    const points = scorePick({ circuits: CIRCUITS, sport: f.sport, pickByte, result: decodeResult(f.sport, f.resultByte) });
    await store.tableSet(`points:${f.id}`, player, points);
    await store.tableSet(`played:${player}`, f.id, { pickByte, points });
  };
  const isFinal = (f) => f.state === "final" && Number.isInteger(f.resultByte);
  /** A match whose picks can be given points now. */
  const counts = (f) => isFinal(f) && f.lock === "locked";
  /** Score every opened pick of a match that has just been given its result, or just been confirmed as locked. */
  const scoreMatch = async (f) => {
    const frozen = await store.get(`frozen:${f.id}`);
    if (!frozen) return;
    const opened = await store.tableAll(`opened:${f.id}`);
    for (const e of frozen.entries) if (opened[e.player]) await scoreOne(f, e.player, opened[e.player].pickByte);
    await store.tableSet("scored", f.id, { kickoff: f.kickoff });
    await stale();
  };
  /**
   * A match whose lock was missed: nobody scores. Any points already given for it are taken back,
   * and each player with a sealed pick in it is left a line saying what happened.
   */
  const voidMatch = async (f) => {
    for (const player of Object.keys(await store.tableAll(`points:${f.id}`))) await store.tableDelete(`points:${f.id}`, player);
    await store.tableDelete("scored", f.id);
    const frozen = await store.get(`frozen:${f.id}`);
    for (const e of frozen?.entries ?? []) await store.tableSet(`played:${e.player}`, f.id, { missed: true });
    await stale();
  };

  /**
   * Everyone on Kickoff, in order: most points first, and between players level on points, whoever
   * joined first. Kept until something changes it.
   * @returns [{ key, name, joinedAt, threes, ones, points, place, brands }]: `brands` is the codes
   *          of the brand groups the person is in, if any
   */
  const tables = async () => {
    const stamp = (await store.get("table-stamp")) ?? "start";
    const kept = await store.get("table-kept");
    if (kept?.stamp === stamp && kept.weeks) return kept;
    const people = await store.tableAll("people");
    const owner = await store.tableAll("owner-of");
    const tally = new Map(Object.keys(people).map((key) => [key, { threes: 0, ones: 0 }]));
    // The same points, also added up by the week their match kicked off in, for the player of
    // the week. Only the two newest weeks with points are kept: nothing older is ever shown.
    const byWeek = new Map();
    for (const [match, about] of Object.entries(await store.tableAll("scored"))) {
      for (const [player, points] of Object.entries(await store.tableAll(`points:${match}`))) {
        const key = owner[player] ?? player;
        const t = tally.get(key);
        if (!t) continue;
        if (points === 3) t.threes++;
        else if (points === 1) t.ones++;
        if (points > 0 && Number.isSafeInteger(about?.kickoff)) {
          const week = weekStart(about.kickoff);
          const gained = byWeek.get(week) ?? byWeek.set(week, {}).get(week);
          gained[key] = (gained[key] ?? 0) + points;
        }
      }
    }
    const rows = [...tally]
      .map(([key, t]) => ({ key, name: people[key].name, joinedAt: people[key].joinedAt, ...t, points: 3 * t.threes + t.ones, ...(people[key].brands ? { brands: people[key].brands } : {}) }))
      .sort((a, b) => b.points - a.points || a.joinedAt - b.joinedAt || a.key.localeCompare(b.key));
    rows.forEach((row, i) => (row.place = i + 1));
    const weeks = Object.fromEntries([...byWeek].sort((a, b) => b[0] - a[0]).slice(0, 2));
    await store.set("table-kept", { stamp, rows, weeks });
    return { rows, weeks };
  };
  const everyone = async () => (await tables()).rows;

  // ------------------------------------------------------------------ a brand's group with a prize
  //
  // A brand's group may be given an end (`ends`). Its leaderboard then counts only the matches that
  // are the group's own: in the competitions it plays, kicked off from when the group started up
  // to its end. Once every one of those matches has a result, the leaderboard is final and its
  // top player is the winner. Kickoff never holds the prize: the brand pays the winner's linked
  // wallet itself, and what is recorded here is the payment anyone can look up on X Layer.

  /** Whether a match is one of the group's own. */
  const inWindow = (group, f) => group.plays.includes(f.comp) && f.kickoff >= group.startedAt && f.kickoff < group.ends;

  /** The group's own leaderboard: its members, by points from the group's own matches. */
  const prizeRows = async (group, all) => {
    const stamp = (await store.get("table-stamp")) ?? "start";
    let kept = await store.get(`prize-tally:${group.code}`);
    if (kept?.stamp !== stamp) {
      const fixtures = await store.tableAll("fixtures");
      const owner = await store.tableAll("owner-of");
      const tally = {};
      for (const match of Object.keys(await store.tableAll("scored"))) {
        const f = fixtures[match];
        if (!f || !inWindow(group, f)) continue;
        for (const [player, points] of Object.entries(await store.tableAll(`points:${match}`))) {
          if (points !== 3 && points !== 1) continue;
          const key = owner[player] ?? player;
          const t = (tally[key] ??= { threes: 0, ones: 0 });
          if (points === 3) t.threes++;
          else t.ones++;
        }
      }
      kept = { stamp, tally };
      await store.set(`prize-tally:${group.code}`, kept);
    }
    return all
      .filter((row) => row.brands?.includes(group.code))
      .map((row) => {
        const t = kept.tally[row.key] ?? { threes: 0, ones: 0 };
        return { ...row, threes: t.threes, ones: t.ones, points: 3 * t.threes + t.ones };
      })
      .sort((a, b) => b.points - a.points || a.joinedAt - b.joinedAt || a.key.localeCompare(b.key));
  };

  /**
   * Once a group's end has passed and every one of its matches has a result, fix its winners, once
   * and for good: its top players, as many as its prize is shared between. Only players who
   * scored can win, so there may be fewer, or none.
   */
  const settleGroup = async (group, now) => {
    if (!group.ends || group.final || now < group.ends) return group;
    const waiting = Object.values(await store.tableAll("fixtures")).some((f) => inWindow(group, f) && f.state !== "final" && f.state !== "void");
    if (waiting) return group;
    const top = (await prizeRows(group, await everyone())).filter((row) => row.points > 0).slice(0, group.money?.winners ?? 1);
    const winners = [];
    for (const [i, row] of top.entries()) {
      const players = (await devicesOfPerson(row.key)).sort();
      winners.push({ place: i + 1, players: players.length > 0 ? players : [row.key], name: row.name, points: row.points });
    }
    const settled = { ...group, final: { at: now, winners } };
    await store.set(`group:${group.code}`, settled);
    return settled;
  };

  /** The wallet a winner has linked, from whichever of their devices linked it, or null. */
  const walletOfWinner = async (winner) => {
    for (const device of winner?.players ?? []) {
      const link = await store.get(`wallet-of:${device}`);
      if (link) return link.wallet;
    }
    return null;
  };

  /** Whether a device belongs to the same person as any of some devices. */
  const samePerson = async (player, devices) => {
    if (!player || devices.length === 0) return false;
    return devices.includes(player) || (await personOf(player)) === (await personOf(devices[0]));
  };

  /** Each winner's share of a prize that is an amount of a token: { raw, what }, or null for a prize that is only a line of words. */
  const shareOf = (group) => {
    if (!group.money) return null;
    const token = PRIZE_TOKENS[group.money.token];
    const raw = (BigInt(group.money.amount) * 10n ** BigInt(token.decimals)) / BigInt(group.money.winners);
    return { raw, token: token.address, what: `${inUnits(raw, token.decimals)} ${group.money.token}` };
  };

  /**
   * What may be seen of a group's prize: when it ends, who won, and whether each winner was paid.
   * Whoever started the group is also told where to pay, and how their payments are getting on.
   * Nobody else is ever told a winner's wallet.
   */
  const prizeView = async (group, player, now) => {
    if (!group.ends) return {};
    const winners = [];
    const toPay = [];
    const organiser = Boolean(group.startedBy) && (await samePerson(player, [group.startedBy]));
    const share = shareOf(group);
    for (const w of group.final?.winners ?? []) {
      const wallet = await walletOfWinner(w);
      const paid = (group.paid ?? []).find((p) => p.place === w.place) ?? null;
      winners.push({ place: w.place, name: w.name, points: w.points, you: await samePerson(player, w.players), linked: Boolean(wallet), paid: paid ? { tx: paid.tx, what: paid.what } : null });
      if (organiser && !paid) {
        const claim = (group.claims ?? []).find((c) => c.place === w.place) ?? null;
        const refused = (group.refused ?? []).find((r) => r.place === w.place) ?? null;
        toPay.push({ place: w.place, name: w.name, wallet, what: share?.what ?? null, checking: claim ? claim.tx : null, refused: !claim && refused ? refused.reason : null });
      }
    }
    return {
      ends: group.ends,
      ended: now !== null && now >= group.ends,
      decided: Boolean(group.final),
      winners,
      ...(share ? { share: share.what } : {}),
      ...(organiser ? { organiser: true, toPay, ...(share ? { payIn: { symbol: group.money.token, address: share.token } } : {}) } : {}),
    };
  };

  /** A brand's prize, as an amount of a token shared between its winners, checked. */
  const tidyMoney = (money) => {
    const { amount, winners, token } = money ?? {};
    if (!Object.hasOwn(PRIZE_TOKENS, token ?? "")) refuse(400, `The prize is paid in ${Object.keys(PRIZE_TOKENS).join(" or ")}.`);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_PRIZE_AMOUNT) refuse(400, `The prize is a whole number, from 1 to ${MAX_PRIZE_AMOUNT.toLocaleString("en-GB")}.`);
    if (!Number.isSafeInteger(winners) || winners < 1 || winners > MAX_WINNERS) refuse(400, `The prize can go to between 1 and ${MAX_WINNERS} winners.`);
    return { amount, winners, token };
  };
  const prizeLineOf = (money) => `${money.amount.toLocaleString("en-GB")} ${money.token} ${money.winners === 1 ? "for 1st place" : `shared by the top ${money.winners}`}`;

  /** Write a new brand's group under a code nobody has. Returns the code. */
  const writeBrandGroup = async (record) => {
    for (let tries = 0; tries < 30; tries++) {
      const candidate = codeFor(record.name, String(random(10000)).padStart(4, "0"));
      if (await store.setIfAbsent(`group:${candidate}`, { code: candidate, ...record })) return candidate;
    }
    return refuse(503, "Could not make a code for the group. Try again.");
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
     * With `brand`, it is a group run by a brand (startBrandGroup).
     */
    async createGroup({ player, now, name, playerName, plays, brand = null }) {
      if (brand !== null && brand !== undefined) return this.startBrandGroup({ player, now, name, playerName, plays, brand });
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

    /**
     * Start a group for a brand, from the website. Anyone can. It holds up to 5,000 players, has a
     * prize that is an amount of USDT or USDC shared between its top players, and has to end.
     * Whoever starts it is the one who pays the winners, from their own wallet: Kickoff never
     * holds the prize. Kickoff does not check that the brand is who it says it is.
     * @param brand  { name, amount, winners, token, ends }: who runs it, the prize in whole tokens,
     *               how many winners share it, "USDT" or "USDC", and when it ends, in seconds
     */
    async startBrandGroup({ player, now, name, playerName, plays, brand }) {
      const groupName = tidyName(name, MAX_GROUP_NAME, "The group's name");
      const who = tidyName(playerName, MAX_PLAYER_NAME, "Your name");
      const runBy = tidyName(brand?.name, MAX_BRAND_NAME, "The brand's name");
      const money = tidyMoney(brand);
      if (!Number.isSafeInteger(brand.ends) || brand.ends <= now) refuse(400, "The group's last day has to be still to come.");
      if (brand.ends > now + LONGEST_GROUP) refuse(400, "The group's last day can be at most a year away.");
      const chosen = plays === undefined ? [...COMPETITIONS] : tidyPlays(plays);
      await ensurePerson(player, now);
      await named(player, who, now);
      const code = await writeBrandGroup({ name: groupName, startedBy: player, startedAt: now, plays: chosen, brand: runBy, prize: prizeLineOf(money), money, ends: brand.ends });
      return this.joinGroup({ player, now, code, playerName: who });
    },

    /**
     * Start a group run by a brand, with Kickoff's own key. Nobody is in it until they join with
     * its code, and its prize is a line of words, with one winner.
     * @param brand  who runs it, shown to players as "Run by …"
     * @param prize  one line about the prize, or nothing
     * @param ends   when the group ends and its prize is decided, in seconds, or nothing for a
     *               group that runs on with no end
     */
    async createBrandGroup({ now, name, brand, prize, plays, ends }) {
      const groupName = tidyName(name, MAX_GROUP_NAME, "The group's name");
      const runBy = tidyName(brand, MAX_BRAND_NAME, "The brand's name");
      const prizeLine = prize === undefined || prize === null || String(prize).trim() === "" ? null : tidyName(prize, MAX_PRIZE, "The prize");
      const chosen = plays === undefined || plays === null ? [...COMPETITIONS] : tidyPlays(plays);
      const until = ends === undefined || ends === null ? null : ends;
      if (until !== null && (!Number.isSafeInteger(until) || until <= now)) refuse(400, "The group has to end at a time that is still to come.");
      const code = await writeBrandGroup({ name: groupName, startedBy: null, startedAt: now, plays: chosen, brand: runBy, ...(prizeLine ? { prize: prizeLine } : {}), ...(until !== null ? { ends: until } : {}) });
      return this.group({ code });
    },

    /**
     * For Kickoff only: where a brand group's prize stands, with the wallet each winner has
     * linked, so whoever is paying can be told where to pay.
     */
    async prizeLook({ now, code }) {
      const shown = await this.group({ code, now });
      if (!shown.brand) refuse(400, "That is a group of friends. Only a group run by a brand has a prize to record.");
      if (!shown.ends) refuse(400, "That group has no end, so it has no winner to pay.");
      const kept = await store.get(`group:${shown.code}`);
      const share = shareOf(kept);
      const winners = [];
      for (const w of kept.final?.winners ?? []) {
        const paid = (kept.paid ?? []).find((p) => p.place === w.place) ?? null;
        winners.push({ place: w.place, name: w.name, points: w.points, wallet: await walletOfWinner(w), paid: paid ? { tx: paid.tx, what: paid.what, at: paid.at } : null });
      }
      return {
        code: shown.code, name: shown.name, brand: shown.brand, prize: shown.prize ?? null, ends: shown.ends, ended: shown.ended, decided: shown.decided, decidedAt: kept.final?.at ?? null,
        share: share ? { what: share.what, token: share.token, raw: share.raw.toString() } : null,
        winners,
      };
    },

    /**
     * Whoever started a brand's group says they have paid a winner, and gives the payment's
     * transaction. Nothing is believed yet: Kickoff's robot reads it on X Layer (robot/src/prize.js)
     * and it is recorded, or refused with the reason, within a few minutes.
     */
    async claimPaid({ player, now, code, place, tx }) {
      const shown = await this.group({ code, player, now });
      if (!shown.organiser) refuse(403, "Only whoever started this group can say its prize was paid.");
      if (!shown.decided) refuse(409, "This group has no winner yet.");
      const due = shown.toPay.find((w) => w.place === place) ?? refuse(409, "There is no winner in that place waiting to be paid.");
      if (!due.wallet) refuse(409, `${due.name} has not linked a wallet yet, so there is nowhere to have paid them.`);
      const hash = typeof tx === "string" ? tx.trim().toLowerCase() : "";
      if (!/^0x[0-9a-f]{64}$/.test(hash)) refuse(400, "That is not a transaction. It starts 0x and has 64 more letters and numbers.");
      const used = await store.tableGet("prize-txs", hash);
      if (used) refuse(409, "That payment is already recorded for a prize.");
      const kept = await store.get(`group:${shown.code}`);
      await store.set(`group:${shown.code}`, { ...kept, claims: [...(kept.claims ?? []).filter((c) => c.place !== place), { place, tx: hash, at: now }], refused: (kept.refused ?? []).filter((r) => r.place !== place) });
      await store.tableSet("prize-claims", `${shown.code}:${place}`, { code: shown.code, place, tx: hash, at: now });
      return this.group({ code: shown.code, player, now });
    },

    /**
     * For Kickoff's robot: every payment waiting to be read, with what it has to have been:
     * [{ code, place, tx, at, decidedAt, name, wallet, token, raw, what }]. `at` is when it was
     * given and `decidedAt` when the winners were fixed. `token` and `raw` are null for a prize
     * that is only a line of words, where any payment to the winner's wallet counts.
     */
    async prizeClaims({ now }) {
      const waiting = [];
      for (const claim of Object.values(await store.tableAll("prize-claims"))) {
        const look = await this.prizeLook({ now, code: claim.code });
        const winner = look.winners.find((w) => w.place === claim.place);
        const kept = await store.get(`group:${claim.code}`);
        waiting.push({ code: claim.code, place: claim.place, tx: claim.tx, at: claim.at, decidedAt: kept.final?.at ?? null, name: winner?.name ?? null, wallet: winner?.wallet ?? null, token: look.share?.token ?? null, raw: look.share?.raw ?? null, what: look.share?.what ?? null });
      }
      return waiting;
    },

    /**
     * For Kickoff only: record that a winner was paid. Kickoff's robot has already read the
     * payment on X Layer; what it read is checked again here against what was owed.
     * @param place  which winner: 1 for the top player. Left out, the only winner.
     * @param tx     the payment's transaction
     * @param to     the wallet the robot saw it reach, which has to be the one the winner linked
     * @param token  the token's address, and `raw` the amount in its smallest unit. For a prize
     *               that is an amount of USDT or USDC, these have to be that token and at least
     *               the winner's share
     * @param what   what was paid, in a few words, for a prize that is only a line of words
     */
    async recordPrize({ now, code, place = 1, tx, to, token = null, raw = null, what = null }) {
      const look = await this.prizeLook({ now, code });
      if (!look.decided) refuse(409, look.ended ? "This group has ended, but some of its matches have no result yet, so it has no winner yet." : "This group has not ended yet.");
      if (look.winners.length === 0) refuse(409, "Nobody scored in this group, so it has no winner.");
      const winner = look.winners.find((w) => w.place === place) ?? refuse(409, "This group has no winner in that place.");
      if (!winner.wallet) refuse(409, `${winner.name} has not linked a wallet yet, so there is nowhere the prize could have been paid.`);
      const hash = typeof tx === "string" ? tx.toLowerCase() : "";
      if (!/^0x[0-9a-f]{64}$/.test(hash)) refuse(400, "That is not a transaction on X Layer.");
      if (typeof to !== "string" || to.toLowerCase() !== winner.wallet) refuse(409, `That payment did not go to the wallet ${winner.name} linked.`);
      let paidWhat;
      if (look.share) {
        if (typeof token !== "string" || token.toLowerCase() !== look.share.token) refuse(409, `That payment was not in the token this prize is paid in (${look.share.what.split(" ").pop()}).`);
        let amount = null;
        try {
          amount = BigInt(raw);
        } catch {
          // not an amount
        }
        if (amount === null || amount < BigInt(look.share.raw)) refuse(409, `That payment is less than ${winner.name}'s share of ${look.share.what}.`);
        const symbol = look.share.what.split(" ").pop();
        paidWhat = `${inUnits(amount, PRIZE_TOKENS[symbol].decimals)} ${symbol}`;
      } else {
        paidWhat = tidyName(what, 40, "What was paid");
      }
      const kept = await store.get(`group:${look.code}`);
      const before = (kept.paid ?? []).find((p) => p.place === place);
      if (before && before.tx !== hash) refuse(409, "A payment is already recorded for that winner.");
      const used = await store.tableGet("prize-txs", hash);
      if (used && used !== `${look.code}:${place}`) refuse(409, "That payment is already recorded for another prize.");
      if (!before) {
        await store.tableSet("prize-txs", hash, `${look.code}:${place}`);
        await store.set(`group:${look.code}`, {
          ...kept,
          paid: [...(kept.paid ?? []), { place, tx: hash, to: winner.wallet, what: paidWhat, at: now }].sort((a, b) => a.place - b.place),
          claims: (kept.claims ?? []).filter((c) => c.place !== place),
          refused: (kept.refused ?? []).filter((r) => r.place !== place),
        });
      }
      await store.tableDelete("prize-claims", `${look.code}:${place}`);
      return this.group({ code: look.code, now });
    },

    /**
     * For Kickoff's robot: a payment it read was not what was owed. Whoever started the group is
     * told why, and can give another.
     */
    async refusePrize({ now, code, place, tx, reason }) {
      const shown = await this.group({ code, now });
      const kept = await store.get(`group:${shown.code}`);
      const claim = (kept.claims ?? []).find((c) => c.place === place && c.tx === String(tx).toLowerCase());
      if (!claim) refuse(409, "No such payment is waiting to be read.");
      await store.set(`group:${shown.code}`, { ...kept, claims: kept.claims.filter((c) => c !== claim), refused: [...(kept.refused ?? []).filter((r) => r.place !== place), { place, tx: claim.tx, reason: tidyName(reason, 160, "The reason"), at: now }] });
      await store.tableDelete("prize-claims", `${shown.code}:${place}`);
      return { refused: true };
    },

    /** Join a group with its code. A player has one name everywhere: giving another one here changes it everywhere. */
    async joinGroup({ player, now, code, playerName }) {
      const group = await this.group({ code, player, now });
      const who = tidyName(playerName, MAX_PLAYER_NAME, "Your name");
      if (group.brand) {
        // A brand's group can hold thousands, so its members are never fetched all at once. Names
        // are already one per player across Kickoff, so there is nothing to compare here.
        const before = await store.tableGet(`members:${group.code}`, player);
        if (!before && group.ended) refuse(409, "This group has ended.");
        if (!before && (await store.tableSize(`members:${group.code}`)) >= brandMax) refuse(409, `This group is full. It can have ${brandMax.toLocaleString("en-GB")} players.`);
        const person = await ensurePerson(player, now);
        await named(player, who, now);
        await store.tableSet(`members:${group.code}`, player, { ...before, name: who, joinedAt: before?.joinedAt ?? now, since: now });
        await store.tableSet(`groups-of:${player}`, group.code, { joinedAt: before?.joinedAt ?? now });
        await bringDevices(group.code, player, now);
        // The person is marked as in this group, which is how its leaderboard finds them.
        const key = (await personOf(player)) ?? person;
        const record = await store.tableGet("people", key);
        if (record && !(record.brands ?? []).includes(group.code)) {
          await store.tableSet("people", key, { ...record, brands: [...(record.brands ?? []), group.code] });
          await stale();
        }
        return this.group({ code: group.code, player, now });
      }
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

    /**
     * A group and its members: whoever started it, then the rest in the order they joined. Anyone
     * with the code can see this.
     *
     * A group run by a brand is told apart by `brand`. It says how many `players` it has, and its
     * `members` are never listed: only the seat of the player asking, if they are in it.
     */
    async group({ code, player = null, now = null }) {
      if (typeof code !== "string") refuse(400, "That is not a group code.");
      const tidy = code.trim().toUpperCase();
      if (!/^[A-Z]{1,7}-\d{4}$/.test(tidy)) refuse(400, "That is not a group code. A code looks like BALLERS-4821.");
      let group = (await store.get(`group:${tidy}`)) ?? refuse(404, "There is no group with that code.");
      if (group.brand) {
        if (now !== null) group = await settleGroup(group, now);
        const mine = player ? await store.tableGet(`members:${tidy}`, player) : null;
        const seat = mine ? { player, name: mine.name, joinedAt: mine.joinedAt, ...(mine.wallet ? { linked: true, players: (await devicesOf(mine.wallet)).sort() } : {}) } : null;
        // What is kept about the winner and the payment is shown only as prizeView() gives it.
        const { final, paid, claims, refused, money, ...shown } = group;
        return { ...shown, ...(await prizeView(group, player, now)), players: await store.tableSize(`members:${tidy}`), members: seat ? [seat] : [] };
      }
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
      for (const code of codes) groups.push(await this.group({ code, player, now: now || null }));
      return groups.sort((a, b) => a.startedAt - b.startedAt);
    },

    /** Choose which competitions a group plays. Only the player who started it may. */
    async setPlays({ player, code, plays }) {
      const group = await this.group({ code });
      if (group.brand) refuse(403, "This group's competitions were chosen by whoever runs it.");
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
          // Whichever joined first is when the person joined, and the person is in every brand
          // group either of them was in.
          const brands = [...new Set([...(theirs.brands ?? []), ...(mine.brands ?? [])])];
          if (mine.joinedAt < theirs.joinedAt || brands.length !== (theirs.brands ?? []).length) {
            await store.tableSet("people", address, { ...theirs, joinedAt: Math.min(mine.joinedAt, theirs.joinedAt), ...(brands.length > 0 ? { brands } : {}) });
          }
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

    // ---------------------------------------------------------------- moving to another phone
    //
    // A player is the key their phone made. To play on another phone, the first phone locks a
    // copy of its key with a one-time code and leaves it here; the other phone, given the code,
    // collects it and unlocks it (web/lib/move.js). The server holds the locked copy for a few
    // minutes and hands it over once. It is never given the code, so it cannot unlock it.

    /**
     * Leave a locked copy for another phone to collect.
     * @param id   where to leave it: 64 hex digits, worked out from the code by both phones
     * @param box  the locked copy, as base64
     * @returns { until } when it runs out
     */
    async leaveMove({ player, now, id, box }) {
      if (typeof id !== "string" || !HEX64.test(id)) refuse(400, "That is not a place a copy can be left.");
      if (typeof box !== "string" || box.length < 40 || box.length > MOVE_MAX || !/^[A-Za-z0-9+/]+={0,2}$/.test(box)) refuse(400, "That is not a locked copy, or it is too big.");
      // A phone has one copy waiting at a time: asking for a new code ends the old one.
      const before = await store.get(`move-of:${player}`);
      if (before && before !== id) await store.remove(`move:${before}`);
      await store.set(`move:${id}`, { box, from: player, until: now + MOVE_LASTS });
      await store.set(`move-of:${player}`, id);
      return { until: now + MOVE_LASTS };
    },

    /**
     * Collect a locked copy. It is handed over once and then gone. A phone gets a few tries, so
     * codes cannot be guessed at.
     * @returns { box }
     */
    async takeMove({ player, now, id }) {
      const tries = await store.get(`move-tries:${player}`);
      const recent = tries && now - tries.since < MOVE_LASTS ? tries : { count: 0, since: now };
      if (recent.count >= MOVE_TRIES) refuse(429, "Too many tries. Wait ten minutes, then get a new code.");
      const wrong = async () => {
        await store.set(`move-tries:${player}`, { count: recent.count + 1, since: recent.since });
        refuse(404, "That code is not right, or it has run out.");
      };
      if (typeof id !== "string" || !HEX64.test(id)) await wrong();
      const waiting = await store.get(`move:${id}`);
      if (!waiting || now >= waiting.until) {
        if (waiting) await store.remove(`move:${id}`);
        await wrong();
      }
      // Two phones asking at the same moment: only the first is given it.
      await store.setIfAbsent(`move-taken:${id}`, player);
      if ((await store.get(`move-taken:${id}`)) !== player) await wrong();
      await store.remove(`move:${id}`);
      await store.remove(`move-taken:${id}`);
      if ((await store.get(`move-of:${waiting.from}`)) === id) await store.remove(`move-of:${waiting.from}`);
      await store.remove(`move-tries:${player}`);
      return { box: waiting.box };
    },

    // ---------------------------------------------------------------- tables

    /**
     * What a player's League screen shows.
     * @param code  the group they are looking at, if any
     * @returns {
     *   everyone  { players, rows }: the top of the table of everybody, and this player's own row
     *             (marked `below`) if they are further down
     *   group     { players, rows }: the same for the group, in full, or null. For a group run by
     *             a brand it is the top of the group with this player's own row, like `everyone`,
     *             and each row also carries `players`, the ids that player picks with
     *   week      { from, to, everyone, group }: the last finished week, Monday to Sunday (UTC),
     *             and its player of the week among everybody and in the group, each
     *             { name, points, you } or null if nobody gained a point that week
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
      let brand = null;
      const group = code !== null && code !== undefined ? await this.group({ code, now }) : null;
      if (group?.brand) brand = group.code;
      else if (group) {
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
      // The player of the week: whoever gained the most points from matches that kicked off in
      // the last finished week, Monday to Sunday. A tie goes the way the leaderboard's do, to
      // whoever joined first. Nobody, if nobody gained a point that week.
      const lastWeek = weekStart(now) - WEEK;
      const gained = (await tables()).weeks[lastWeek] ?? {};
      const best = (rows) => {
        let top = null;
        for (const row of rows) {
          const points = gained[row.key] ?? 0;
          if (points === 0) continue;
          const ahead = !top || points > top.points || (points === top.points && (row.joinedAt < top.row.joinedAt || (row.joinedAt === top.row.joinedAt && row.key < top.row.key)));
          if (ahead) top = { row, points };
        }
        return top ? { name: top.row.name, points: top.points, you: top.row.key === me } : null;
      };
      const show = (row, place, extra = {}) => ({ place, name: row.name, threes: row.threes, ones: row.ones, points: row.points, you: row.key === me, ...extra });
      const top = all.slice(0, TABLE_TOP).map((row) => show(row, row.place));
      if (mine && mine.place > TABLE_TOP) top.push(show(mine, mine.place, { below: true }));
      let inGroup = members ? all.filter((row) => members.has(row.key)) : null;
      let groupRows = inGroup ? inGroup.map((row, i) => show(row, i + 1)) : null;
      if (brand) {
        // A brand's group is found by the mark on each person, never by fetching its members. Only
        // its top is sent, with the asking player's own row if they are further down. Each row
        // carries the player's ids, so the website's Check screen can look them up on X Layer.
        // A group with an end counts only its own matches (prizeRows). One with none shows its
        // players' points from everything they have played.
        inGroup = group.ends ? await prizeRows(group, all) : all.filter((row) => row.brands?.includes(brand));
        const devices = new Map();
        for (const [device, key] of Object.entries(await store.tableAll("owner-of"))) devices.set(key, [...(devices.get(key) ?? []), device]);
        const withIds = (row, place, extra) => show(row, place, { players: (devices.get(row.key) ?? [row.key]).sort(), ...extra });
        groupRows = inGroup.slice(0, TABLE_TOP).map((row, i) => withIds(row, i + 1));
        const at = inGroup.findIndex((row) => row.key === me);
        if (at >= TABLE_TOP) groupRows.push(withIds(inGroup[at], at + 1, { below: true }));
      }

      const mineByMatch = new Map();
      if (me) for (const device of await devicesOfPerson(me)) for (const [match, p] of Object.entries(await store.tableAll(`played:${device}`))) mineByMatch.set(match, p);
      const played = [];
      const fixtures = mineByMatch.size > 0 ? await store.tableAll("fixtures") : {};
      for (const [match, p] of mineByMatch) {
        const f = fixtures[match];
        if (!f) continue;
        const about = { match, comp: f.comp, sport: f.sport, home: f.home, away: f.away, score: f.score ?? "", kickoff: f.kickoff };
        // A match that was not locked in time is listed, so the player can see why it gave nothing.
        if (p.missed) played.push({ ...about, missed: true, points: 0 });
        else if (counts(f)) played.push({ ...about, pickByte: p.pickByte, points: p.points });
      }
      played.sort((a, b) => b.kickoff - a.kickoff || a.match.localeCompare(b.match));

      return {
        everyone: { players: all.length, rows: top },
        group: inGroup ? { players: inGroup.length, rows: groupRows } : null,
        week: { from: lastWeek, to: lastWeek + WEEK, everyone: best(all), group: inGroup ? best(inGroup) : null },
        you: { place: mine?.place ?? null, points: mine?.points ?? 0, threes: mine?.threes ?? 0, ones: mine?.ones ?? 0, wrong: played.filter((p) => p.points === 0 && !p.missed).length },
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
    async sealPick({ player, now, at, match, fingerprint, envelope = null }) {
      const f = await fixture(match);
      if (!isId(fingerprint)) refuse(400, "That is not a sealed prediction.");
      // The locked copy that lets the robot open this prediction after kickoff. The server keeps
      // it and cannot read it. A prediction sent without one can only be opened by its own phone.
      if (envelope !== null && envelope !== undefined && !(typeof envelope === "string" && /^[0-9a-f]+$/.test(envelope) && envelope.length === 2 * ENVELOPE_BYTES)) {
        refuse(400, "That is not a locked copy of a prediction.");
      }
      if (f.state !== "scheduled") refuse(409, "This match is no longer open for predictions.");
      if (now >= f.kickoff - CLOSES_BEFORE) refuse(409, "Predictions for this match have closed.");
      const before = await store.tableGet(`sealed:${match}`, player);
      if (before && at <= before.signedAt) refuse(409, "A newer prediction from this device is already in.");
      // Everyone who plays is on the table, so everyone has a name. Someone who picks before
      // choosing one is called "Player" and four characters of their id until they do.
      await ensurePerson(player, now, `Player ${player.slice(0, 4).toUpperCase()}`);
      await store.tableSet(`sealed:${match}`, player, { fingerprint, signedAt: at, receivedAt: now, ...(envelope ? { envelope } : {}) });
      // One player, one pick. If this player's wallet has other devices, a pick one of them sent
      // for this match is replaced by this one, just as a device replaces its own.
      const link = await store.get(`wallet-of:${player}`);
      if (link) for (const device of await devicesOf(link.wallet)) if (device !== player) await store.tableDelete(`sealed:${match}`, device);
      const closesAt = f.kickoff - CLOSES_BEFORE;
      // The server's signed word that it took this one (see engine/src/taken.js). The phone keeps
      // it: if this prediction is later missing from the locked bundle, it is the proof that
      // Kickoff was given it in time.
      const taken = signer ? { key: signer.publicKey, sig: await signer.sign({ league, match, player, fingerprint, receivedAt: now, closesAt }) } : null;
      return { match, fingerprint, receivedAt: now, closesAt, ...(taken ? { taken } : {}) };
    },

    /** The public key the server signs with, or null if it signs nothing. Safe to show to anyone. */
    signingKey() {
      return signer?.publicKey ?? null;
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
      const frozen = (await settle(f, now)) ?? refuse(409, "Predictions for this match are still open, or closed a moment ago. A bundle is made a few seconds after they close.");
      return { match, count: frozen.entries.length, root: frozen.root, entries: frozen.entries, frozenAt: frozen.frozenAt };
    },

    /** A player's receipt: the proof their sealed pick is in the bundle. Available once picks are frozen. */
    async receipt({ player, now, match }) {
      const f = await fixture(match);
      const frozen = (await settle(f, now)) ?? refuse(409, "Predictions for this match have not been locked yet.");
      if (!frozen.entries.some((e) => e.player === player)) refuse(404, "There is no sealed prediction from this player in the bundle.");
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
      if (now < f.kickoff) refuse(409, "A prediction cannot be opened before the match starts.");
      const frozen = await settle(f, now);
      const entry = frozen.entries.find((e) => e.player === player) ?? refuse(404, "You have no sealed prediction in this match's bundle.");
      if (!Number.isInteger(pickByte) || pickByte < 0 || pickByte > 255 || !isId(salt)) refuse(400, "That is not an opened prediction.");
      const fingerprint = await fingerprintOf({ league, match, sport: f.sport, pickByte, player: fromHex(player), salt: fromHex(salt) });
      if (toHex(fingerprint) !== entry.fingerprint) refuse(409, "That prediction and secret do not produce the fingerprint you sealed.");
      try {
        decodePick(f.sport, pickByte);
      } catch {
        refuse(409, "That is not a prediction that can happen in this kind of match.");
      }
      await store.tableSet(`opened:${match}`, player, { pickByte, salt, openedAt: now });
      if (counts(f)) {
        await scoreOne(f, player, pickByte);
        await store.tableSet("scored", f.id, { kickoff: f.kickoff });
        await stale();
      }
      return { match, pickByte };
    },

    /**
     * The locked copies of a match's predictions that have not been opened yet, for the robot to
     * unlock. They are handed over only once the match has started: before that nobody gets them,
     * whatever key they hold.
     * @returns [{ player, fingerprint, envelope }]
     */
    async envelopes({ now, match }) {
      const f = await fixture(match);
      if (now < f.kickoff) refuse(409, "Predictions are not opened before the match starts.");
      const frozen = await settle(f, now);
      const sealed = await store.tableAll(`sealed:${match}`);
      const opened = await store.tableAll(`opened:${match}`);
      return (frozen?.entries ?? [])
        .filter((e) => !opened[e.player] && sealed[e.player]?.envelope && sealed[e.player].fingerprint === e.fingerprint)
        .map((e) => ({ player: e.player, fingerprint: e.fingerprint, envelope: sealed[e.player].envelope }));
    },

    /**
     * Open several of a match's predictions at once: what the robot does with the copies it has
     * unlocked. Each is checked exactly as if its own phone had handed it over, so the robot can
     * open a prediction but cannot change one.
     * @param openings  [{ player, pickByte, salt }]
     * @returns { opened, refused: [{ player, why }] }
     */
    async openMany({ now, match, openings }) {
      if (!Array.isArray(openings) || openings.length > 5000) refuse(400, "That is not a list of opened predictions.");
      let opened = 0;
      const refused = [];
      for (const o of openings) {
        try {
          if (!isId(o?.player)) refuse(400, "That is not a player.");
          await this.openPick({ player: o.player, now, match, pickByte: o.pickByte, salt: o.salt });
          opened++;
        } catch (error) {
          if (!error.status) throw error;
          refused.push({ player: o?.player ?? null, why: error.message });
        }
      }
      return { opened, refused };
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
     * Every opening in it proves itself against the lock on X Layer. Each player's entry also says
     * when they joined Kickoff, so that the leaderboard built from X Layer puts players who are
     * level on points in the same order as the one here.
     */
    async openingsFile({ now, match }) {
      const f = await fixture(match);
      if (now < f.kickoff) refuse(409, "Predictions are not opened before the match starts.");
      const frozen = await settle(f, now);
      const people = await store.tableAll("people");
      const owner = await store.tableAll("owner-of");
      const entries = [];
      for (const e of frozen.entries) {
        const person = people[owner[e.player] ?? e.player] ?? people[await personOf(e.player)];
        entries.push({ player: fromHex(e.player), fingerprint: fromHex(e.fingerprint), ...(person ? { joined: person.joinedAt } : {}) });
      }
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
        if (!isId(f?.id) || !Number.isSafeInteger(f.kickoff) || typeof f.label !== "string" || !SPORTS.includes(f.sport) || f.sport === TENNIS || !COMPETITIONS.includes(f.comp)) {
          refuse(400, "One of the matches is not in the right form.");
        }
        const before = await store.tableGet("fixtures", f.id);
        if (before && (before.kickoff !== f.kickoff || before.label !== f.label || before.sport !== f.sport)) {
          refuse(409, `The facts of ${before.label} cannot change. A moved match is a new match.`);
        }
        // Whether a match was locked on X Layer comes in only through putLocks.
        const { lock: _notFromHere, ...facts } = f;
        const after = { ...before, ...facts };
        await store.tableSet("fixtures", f.id, after);
        // The result has just come in, or has been put right: every opened pick is scored, if the
        // match was locked. If the robot has not said so yet, it is scored when it does.
        if (counts(after) && !(before && isFinal(before) && before.resultByte === after.resultByte)) await scoreMatch(after);
        if (before) updated++;
        else added++;
      }
      return { added, updated };
    },

    /**
     * The robot says how locking went for each match: "locked" if the match's sealed picks were
     * locked on X Layer before kickoff, "missed" if they were not. Only matches that were locked
     * give points. Saying the same thing again changes nothing.
     * @param locks  [{ match, state }]
     * @returns { changed }: how many matches this was news for
     */
    async putLocks({ locks }) {
      if (!Array.isArray(locks) || locks.some((l) => !isId(l?.match) || !["locked", "missed"].includes(l.state))) refuse(400, "That is not a list of locks.");
      let changed = 0;
      for (const { match, state } of locks) {
        const before = await fixture(match);
        if (before.lock === state) continue;
        const after = { ...before, lock: state };
        await store.tableSet("fixtures", match, after);
        if (state === "missed") await voidMatch(after);
        else if (isFinal(after)) await scoreMatch(after);
        changed++;
      }
      return { changed };
    },
  };
}
