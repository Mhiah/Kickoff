// Where the web host starts Kickoff's server. Every address under /api/ comes here (see
// vercel.json). All of the server's own code is in server/src/.
import { fromEnv } from "../server/src/web.js";

const handler = fromEnv(process.env);

export default {
  fetch(request) {
    return handler(request);
  },
};
