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
  /** Ask something only Kickoff's own key may ask. */
  const admin = async (path, body) => {
    const answer = await get(path, { method: "POST", headers: { "x-kickoff-admin": adminKey, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (answer.status !== 200) throw new Error(answer.body?.error ?? `status ${answer.status}`);
    return answer.body;
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
    /** Start a group run by a brand: { name, brand, prize, plays, ends }. Gives back the group, with its code. */
    async brandGroup(group) {
      const { status, body } = await get("/api/admin/brand-groups", { method: "POST", headers: { "x-kickoff-admin": adminKey, "content-type": "application/json" }, body: JSON.stringify(group) });
      if (status !== 200) throw new Error(body?.error ?? `status ${status}`);
      return body;
    },
    /** Where a brand group's prize stands: { name, brand, prize, ends, ended, decided, share, winners: [{ place, name, points, wallet, paid }] }. */
    async prizeLook(code) {
      return admin("/api/admin/prize/look", { code });
    },
    /** Record that a winner was paid, after the payment has been read on X Layer: { code, place, tx, to, token, raw, what }. */
    async recordPrize(payment) {
      return admin("/api/admin/prize", payment);
    },
    /** Payments whoever started a group says they made, waiting to be read: [{ code, place, tx, at, decidedAt, name, wallet, token, raw, what }]. */
    async prizeClaims() {
      return (await admin("/api/admin/prize/claims", {})).claims;
    },
    /** A payment that was read and was not what was owed: { code, place, tx, reason }. */
    async refusePrize(refusal) {
      return admin("/api/admin/prize/refuse", refusal);
    },
    /** The locked copies of a match's predictions still to open: [{ player, fingerprint, envelope }]. Only after kickoff. */
    async envelopes(match) {
      const { status, body } = await get(`/api/admin/envelopes/${match}`, { headers: { "x-kickoff-admin": adminKey } });
      if (status !== 200) throw new Error(`status ${status}: ${body?.error ?? "no reason given"}`);
      return body.envelopes;
    },
    /** Hand over predictions the robot has unlocked: [{ player, pickByte, salt }]. Gives back { opened, refused }. */
    async open(match, openings) {
      const { status, body } = await get("/api/admin/opened", { method: "POST", headers: { "x-kickoff-admin": adminKey, "content-type": "application/json" }, body: JSON.stringify({ match, openings }) });
      if (status !== 200) throw new Error(`status ${status}: ${body?.error ?? "no reason given"}`);
      return body;
    },
    /** Say how locking on X Layer went for some matches: [{ match, state }], state "locked" or "missed". */
    async report(locks) {
      const { status, body } = await get("/api/admin/locks", { method: "POST", headers: { "x-kickoff-admin": adminKey, "content-type": "application/json" }, body: JSON.stringify({ locks }) });
      if (status !== 200) throw new Error(`status ${status}: ${body?.error ?? "no reason given"}`);
      return body;
    },
    /** A match's file of opened picks, as text, or null if there is none yet. */
    async openings(match) {
      const response = await fetch(`${server}/api/matches/${match}/openings`);
      return response.ok ? response.text() : null;
    },
  };
}
