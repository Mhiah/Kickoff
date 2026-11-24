// A stand-in for the database, for the tests. It answers the same web requests the real one
// does, in the same shapes, and keeps everything in memory.

export const FAKE_URL = "https://kickoff-test.example";
export const FAKE_TOKEN = "test-token";

export function fakeRedis() {
  const strings = new Map();
  const hashes = new Map();
  const seen = [];
  const run = ([name, ...args]) => {
    switch (String(name).toUpperCase()) {
      case "GET":
        return strings.get(args[0]) ?? null;
      case "SET":
        if (args[2] === "NX" && strings.has(args[0])) return null;
        strings.set(args[0], args[1]);
        return "OK";
      case "HGET":
        return hashes.get(args[0])?.get(args[1]) ?? null;
      case "HSET": {
        if (!hashes.has(args[0])) hashes.set(args[0], new Map());
        const fresh = hashes.get(args[0]).has(args[1]) ? 0 : 1;
        hashes.get(args[0]).set(args[1], args[2]);
        return fresh;
      }
      case "HDEL":
        return hashes.get(args[0])?.delete(args[1]) ? 1 : 0;
      case "HGETALL":
        return [...(hashes.get(args[0]) ?? [])].flat();
      default:
        throw new Error(`ERR unknown command '${name}'`);
    }
  };
  const fetch = async (url, options) => {
    seen.push({ url, options });
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url !== FAKE_URL) return reply(404, { error: "not found" });
    if (options.headers.authorization !== `Bearer ${FAKE_TOKEN}`) return reply(401, { error: "WRONGPASS invalid or missing auth token" });
    try {
      return reply(200, { result: run(JSON.parse(options.body)) });
    } catch (error) {
      return reply(400, { error: error.message });
    }
  };
  return { fetch, strings, hashes, seen };
}
