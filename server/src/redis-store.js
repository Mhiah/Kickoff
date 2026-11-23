// The real database: a Redis store reached over the web.
//
// This is the kind of database Vercel offers through its Marketplace (Upstash Redis). It is spoken
// to with plain web requests, so there is nothing to install. It does the same things as the
// in-memory store in store.js, and the same tests are run against both.
//
// The address and the token come from the host's settings, never from this code. The token is
// sent only to the database's own address, in a header.
//
//   single values   kept under their key, as JSON text
//   tables          kept as a Redis hash: one field for each name, each value as JSON text
//
// Every key starts with "kickoff:", so Kickoff's records sit apart from anything else kept in the
// same database, and the two can never overwrite each other.

const read = (value) => (value === null || value === undefined ? null : JSON.parse(value));

export class RedisStore {
  /**
   * @param url    the database's web address
   * @param token  its secret token
   * @param fetch  the function used to make web requests (the tests pass a stand-in)
   * @param prefix what every key starts with
   */
  constructor({ url, token, fetch = globalThis.fetch, prefix = "kickoff:" }) {
    if (!/^https:\/\//.test(url ?? "")) throw new Error("the database's address must start with https://");
    if (!token) throw new Error("the database needs its token");
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.fetch = fetch;
    this.prefix = prefix;
  }

  /** Send one Redis command and return its answer. */
  async command(...parts) {
    let response;
    try {
      response = await this.fetch(this.url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(parts),
      });
    } catch {
      // Say nothing that could carry the address or the token.
      throw new Error("the database could not be reached");
    }
    let answer = null;
    try {
      answer = await response.json();
    } catch {
      // handled below
    }
    if (!response.ok || answer === null || typeof answer !== "object" || "error" in answer) {
      throw new Error(`the database refused a ${parts[0]} (status ${response.status})`);
    }
    return answer.result;
  }

  async get(key) {
    return read(await this.command("GET", this.prefix + key));
  }
  async set(key, value) {
    await this.command("SET", this.prefix + key, JSON.stringify(value));
  }
  async setIfAbsent(key, value) {
    return (await this.command("SET", this.prefix + key, JSON.stringify(value), "NX")) === "OK";
  }
  async tableGet(table, name) {
    return read(await this.command("HGET", this.prefix + table, name));
  }
  async tableSet(table, name, value) {
    await this.command("HSET", this.prefix + table, name, JSON.stringify(value));
  }
  async tableAll(table) {
    const answer = (await this.command("HGETALL", this.prefix + table)) ?? [];
    // The answer is a flat list: name, value, name, value…
    const pairs = Array.isArray(answer) ? answer : Object.entries(answer).flat();
    const out = {};
    for (let i = 0; i + 1 < pairs.length; i += 2) out[pairs[i]] = read(pairs[i + 1]);
    return out;
  }
}
