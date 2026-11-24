// What the robot asks Kickoff's server for. The robot's key goes only to Kickoff's own server, in
// a header, and only on the one address that needs it.

/**
 * @param server    Kickoff's server address
 * @param adminKey  the robot's key
 * @param fetch     the function used to make web requests
 */
export function createServer({ server, adminKey, fetch = globalThis.fetch }) {
  const get = async (path, init) => {
    const response = await fetch(server + path, init);
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };
  return {
    /** Kickoff's id on X Layer and its list of matches: { league, fixtures }. */
    async list() {
      const { status, body } = await get("/api/fixtures");
      if (status !== 200 || !Array.isArray(body?.fixtures)) throw new Error(`Kickoff's server did not give its list of matches (status ${status})`);
      return body;
    },
    /** A match's bundle of sealed picks, once picks have closed: { count, root, entries }. */
    async bundle(match) {
      const { status, body } = await get(`/api/admin/freeze/${match}`, { method: "POST", headers: { "x-kickoff-admin": adminKey } });
      if (status !== 200) throw new Error(`Kickoff's server would not hand over the bundle (status ${status}): ${body?.error ?? "no reason given"}`);
      return body;
    },
    /** A match's file of opened picks, as text, or null if there is none yet. */
    async openings(match) {
      const response = await fetch(`${server}/api/matches/${match}/openings`);
      return response.ok ? response.text() : null;
    },
  };
}
