// Shared bits for the server's tests.
import { FOOTBALL, BASKETBALL, matchId, newDeviceKey, playerIdOf, signRequest, toHex } from "../../engine/src/index.js";
import { createHandler } from "../src/http.js";
import { createKickoff } from "../src/kickoff.js";
import { MemoryStore } from "../src/store.js";

export const LEAGUE = "0000000000000000000000c424ad6fe8a46a34fa9b0610959beaba8a2c6b6982";
export const START = 1_800_000_000;
export const ADMIN_KEY = "the-robots-key";
export const HOUR = 3600;

/** A phone: its key, its player id, and a way to sign what it sends. */
export async function device() {
  const key = await newDeviceKey();
  const player = toHex(await playerIdOf(key.publicKey));
  return { ...key, player, sign: (method, path, payload, at) => signRequest({ privateJwk: key.privateJwk, publicKey: key.publicKey, method, path, payload, at }) };
}

/** A server with a clock the test can move. */
export function server({ adminKey = ADMIN_KEY } = {}) {
  const store = new MemoryStore();
  const clock = { now: START };
  let n = 0;
  const kickoff = createKickoff({ store, league: LEAGUE, random: () => 4821 + n++ });
  const handle = createHandler({ kickoff, now: () => clock.now, adminKey });
  return {
    store, clock, kickoff, handle,
    get: (path) => handle({ method: "GET", path, headers: {}, body: null }),
    /** A device sends something, signed at the server's current time unless told otherwise. */
    post: async (who, path, payload = {}, at = clock.now) => handle({ method: "POST", path, headers: {}, body: await who.sign("POST", path, payload, at) }),
    robot: (path, body = null, key = ADMIN_KEY) => handle({ method: "POST", path, headers: { "x-kickoff-admin": key }, body }),
  };
}

const facts = {
  football: { comp: "pl", sport: FOOTBALL, kickoff: START + 24 * HOUR, label: "Premier League: Arsenal v Chelsea", home: "Arsenal", away: "Chelsea" },
  basketball: { comp: "nba", sport: BASKETBALL, kickoff: START + 30 * HOUR, label: "NBA: Knicks v Bucks", home: "Knicks", away: "Bucks" },
};

/** Two matches, as the robot would put them on the list. */
export async function fixtures() {
  const out = {};
  for (const [name, f] of Object.entries(facts)) {
    const id = toHex(await matchId(LEAGUE, { sport: f.sport, kickoff: f.kickoff, bestOf: 0, label: f.label }));
    out[name] = { id, feedId: `test:${name}`, state: "scheduled", ...f };
  }
  return out;
}

/** A server with the two matches already on its list. */
export async function serverWithFixtures() {
  const s = server();
  const f = await fixtures();
  const put = await s.robot("/api/admin/fixtures", { fixtures: Object.values(f) });
  if (put.status !== 200) throw new Error(JSON.stringify(put.body));
  return { ...s, f };
}
