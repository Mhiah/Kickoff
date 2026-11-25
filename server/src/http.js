// The addresses the website talks to, and what each one does.
//
//   Anyone may ask
//     GET  /api/fixtures                         Kickoff's id on X Layer, and every match on its list
//     GET  /api/groups/<code>                    a group and its members
//     GET  /api/matches/<match>                  how many picks are in; after kickoff, the opened picks
//     GET  /api/matches/<match>/receipt/<player> a player's proof their sealed pick was locked
//     GET  /api/matches/<match>/openings         the file of opened picks, as the picks engine reads it
//
//   A device must sign these (engine/src/identity.js)
//     POST /api/groups                { name, playerName, plays } start a group
//     POST /api/groups/<code>/join    { playerName }            join one
//     POST /api/groups/<code>/plays   { plays }                 choose its competitions (its starter only)
//     POST /api/me/groups             {}                        the groups this device is in, and its wallet if it linked one
//     POST /api/me/table              { group }                 the League screen: both tables, and this player's place and matches
//     POST /api/wallet                { wallet, linkAt, signature } link a wallet (engine/src/wallet.js)
//     POST /api/picks                 { match, fingerprint }    send a sealed pick
//     POST /api/picks/mine            { match }                 what the server holds for this device
//     POST /api/opened                { match, pickByte, salt } open a pick, after kickoff
//
//   Only the robot may use these, with the admin key
//     POST /api/admin/fixtures        { fixtures }              put matches on the list
//     POST /api/admin/freeze/<match>                            a match's bundle, once picks have closed
//     POST /api/admin/brand-groups    { name, brand, prize, plays }   start a group run by a brand, of up to 5,000 players
//     POST /api/admin/locks           { locks: [{ match, state }] }   how locking on X Layer went: "locked" or "missed"
//
// This file knows nothing about any particular web host. It takes a request as plain values and
// returns { status, body }, so the same code runs in the tests, on a laptop, and when hosted.

import { timingSafeEqual } from "node:crypto";

import { toHex, verifyRequest } from "../../engine/src/index.js";
import { Refusal } from "./kickoff.js";

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * @param kickoff   from createKickoff()
 * @param now       a function giving the time in seconds
 * @param adminKey  the robot's key. If there is none, the robot's addresses are switched off.
 */
export function createHandler({ kickoff, now, adminKey = null }) {
  // A signed request, checked. What the device sent is spread first, so nothing inside it can
  // stand in for the player id or the time, which come from the signature and nowhere else.
  const signed = async (request) => {
    let checked;
    try {
      checked = await verifyRequest({ method: request.method, path: request.path, envelope: request.body, now: now() });
    } catch (error) {
      const words = `${error.message[0].toUpperCase()}${error.message.slice(1)}`;
      throw new Refusal(401, words.endsWith(".") ? words : `${words}.`);
    }
    return { ...checked.payload, player: toHex(checked.player), at: checked.at };
  };
  const admin = (request) => {
    if (!adminKey || !sameSecret(request.headers?.["x-kickoff-admin"] ?? "", adminKey)) throw new Refusal(403, "This address is for Kickoff's robot only.");
  };

  const routes = [
    ["GET", /^\/api\/fixtures$/, async () => ({ league: kickoff.league, fixtures: await kickoff.fixtures() })],
    ["GET", /^\/api\/groups\/([^/]+)$/, async (r, code) => kickoff.group({ code: decodeURIComponent(code) })],
    ["GET", /^\/api\/matches\/([0-9a-f]{64})$/, async (r, match) => kickoff.match({ now: now(), match })],
    ["GET", /^\/api\/matches\/([0-9a-f]{64})\/receipt\/([0-9a-f]{64})$/, async (r, match, player) => kickoff.receipt({ now: now(), match, player })],
    ["GET", /^\/api\/matches\/([0-9a-f]{64})\/openings$/, async (r, match) => JSON.parse(await kickoff.openingsFile({ now: now(), match }))],

    ["POST", /^\/api\/groups$/, async (r) => {
      const s = await signed(r);
      return kickoff.createGroup({ player: s.player, now: now(), name: s.name, playerName: s.playerName, plays: s.plays });
    }],
    ["POST", /^\/api\/groups\/([^/]+)\/join$/, async (r, code) => {
      const s = await signed(r);
      return kickoff.joinGroup({ player: s.player, now: now(), code: decodeURIComponent(code), playerName: s.playerName });
    }],
    ["POST", /^\/api\/groups\/([^/]+)\/plays$/, async (r, code) => {
      const s = await signed(r);
      return kickoff.setPlays({ player: s.player, code: decodeURIComponent(code), plays: s.plays });
    }],
    ["POST", /^\/api\/me\/groups$/, async (r) => {
      const s = await signed(r);
      return { groups: await kickoff.groupsOf({ player: s.player, now: now() }), wallet: (await kickoff.walletOf({ player: s.player }))?.wallet ?? null };
    }],
    ["POST", /^\/api\/me\/table$/, async (r) => {
      const s = await signed(r);
      return kickoff.table({ player: s.player, now: now(), code: s.group ?? null });
    }],
    ["POST", /^\/api\/wallet$/, async (r) => {
      const s = await signed(r);
      const link = await kickoff.linkWallet({ player: s.player, now: now(), wallet: s.wallet, at: s.linkAt, signature: s.signature });
      return { ...link, groups: await kickoff.groupsOf({ player: s.player, now: now() }) };
    }],
    ["POST", /^\/api\/picks$/, async (r) => {
      const s = await signed(r);
      return kickoff.sealPick({ player: s.player, now: now(), at: s.at, match: s.match, fingerprint: s.fingerprint });
    }],
    ["POST", /^\/api\/picks\/mine$/, async (r) => {
      const s = await signed(r);
      return { sealed: await kickoff.sealedBy({ player: s.player, now: now(), match: s.match }) };
    }],
    ["POST", /^\/api\/opened$/, async (r) => {
      const s = await signed(r);
      return kickoff.openPick({ player: s.player, now: now(), match: s.match, pickByte: s.pickByte, salt: s.salt });
    }],

    ["POST", /^\/api\/admin\/fixtures$/, async (r) => {
      admin(r);
      return kickoff.putFixtures({ fixtures: r.body?.fixtures });
    }],
    ["POST", /^\/api\/admin\/freeze\/([0-9a-f]{64})$/, async (r, match) => {
      admin(r);
      return kickoff.freeze({ now: now(), match });
    }],
    ["POST", /^\/api\/admin\/brand-groups$/, async (r) => {
      admin(r);
      return kickoff.createBrandGroup({ now: now(), name: r.body?.name, brand: r.body?.brand, prize: r.body?.prize, plays: r.body?.plays });
    }],
    ["POST", /^\/api\/admin\/locks$/, async (r) => {
      admin(r);
      return kickoff.putLocks({ locks: r.body?.locks });
    }],
  ];

  /** @param request { method, path, headers, body } with the body already read as JSON (or null) */
  return async function handle(request) {
    const method = String(request.method).toUpperCase();
    const path = String(request.path).split("?")[0];
    let pathKnown = false;
    for (const [routeMethod, pattern, run] of routes) {
      const found = pattern.exec(path);
      if (!found) continue;
      pathKnown = true;
      if (routeMethod !== method) continue;
      try {
        return { status: 200, body: await run({ ...request, method, path }, ...found.slice(1)) };
      } catch (error) {
        if (error instanceof Refusal) return { status: error.status, body: { error: error.message } };
        // Anything unexpected: say nothing about what went wrong inside.
        return { status: 500, body: { error: "Something went wrong on Kickoff's side. Try again." }, cause: error };
      }
    }
    return pathKnown ? { status: 405, body: { error: "That address does not take that kind of request." } } : { status: 404, body: { error: "There is nothing at that address." } };
  };
}
