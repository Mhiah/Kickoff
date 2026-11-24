// Talking to Kickoff's server.
//
// Reading is open to anyone. Anything that acts for this player is signed by this device's key
// first (lib/device.js). When the server will not do something it says why in plain words, and
// those words are passed on as they are.

export const UNREACHABLE = "Could not reach Kickoff. Check your connection and try again.";
const UNCLEAR = "Kickoff could not do that just now. Try again.";

/**
 * @param base    the server's address ("" for the same site)
 * @param device  from createDevice()
 * @param fetch   the function used to make web requests (the checks pass a stand-in)
 * @param now     a function giving the time in seconds
 */
export function createClient({ base = "", device, fetch = (...args) => globalThis.fetch(...args), now = () => Math.floor(Date.now() / 1000) }) {
  async function send(method, path, body) {
    let response;
    try {
      response = await fetch(base + path, {
        method,
        cache: "no-store",
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch {
      throw Object.assign(new Error(UNREACHABLE), { unreachable: true });
    }
    let answer = null;
    try {
      answer = await response.json();
    } catch {
      // not JSON: handled below
    }
    if (!response.ok || answer === null) {
      const words = typeof answer?.error === "string" ? answer.error : UNCLEAR;
      throw Object.assign(new Error(words), { status: response.status, unreachable: response.status >= 500 });
    }
    return answer;
  }
  const signed = async (path, payload = {}) => send("POST", path, await device.sign("POST", path, payload, now()));
  const code = (value) => encodeURIComponent(String(value).trim().toUpperCase());

  return {
    startGroup: ({ name, playerName, plays }) => signed("/api/groups", { name, playerName, plays }),
    joinGroup: ({ code: c, playerName }) => signed(`/api/groups/${code(c)}/join`, { playerName }),
    setPlays: ({ code: c, plays }) => signed(`/api/groups/${code(c)}/plays`, { plays }),
    myGroups: async () => (await signed("/api/me/groups")).groups,
    group: (c) => send("GET", `/api/groups/${code(c)}`),
    /** Kickoff's id on X Layer, and every match on its list: { league, fixtures }. */
    fixtures: () => send("GET", "/api/fixtures"),
    /** Send a sealed pick: its fingerprint, and nothing else. */
    sendPick: ({ match, fingerprint }) => signed("/api/picks", { match, fingerprint }),
    /** The proof that a player's sealed pick is in the locked bundle. */
    receipt: ({ match, player }) => send("GET", `/api/matches/${match}/receipt/${player}`),
    /** Open a pick after the match has started: the pick and its secret. */
    openPick: ({ match, pickByte, salt }) => signed("/api/opened", { match, pickByte, salt }),
  };
}
