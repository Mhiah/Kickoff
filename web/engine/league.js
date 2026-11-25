// From the chain to the table, in one step.

import { toHex } from "./bytes.js";
import { parseOpenings, withOpenings } from "./openings.js";
import { readLeague } from "./reader.js";
import { buildTable } from "./table.js";

/**
 * @param league         the league's 32-byte id
 * @param account        the league's own account
 * @param messages       the league's inbox, as the chain holds it
 * @param openingsFiles  { "<match id as hex, no 0x>": "<the openings file's text>" }
 * @param circuits       from loadCircuits()
 * @returns { table, records, matches, ignored }
 */
export async function tableFromChain({ league, account, messages, openingsFiles = {}, circuits, players = [] }) {
  const { matches, ignored } = await readLeague({ league, account, messages });
  const ready = [];
  for (const match of matches) {
    const fileText = openingsFiles[toHex(match.id)];
    if (fileText === undefined) {
      ready.push(match);
      continue;
    }
    try {
      ready.push(await withOpenings(league, match, parseOpenings(fileText)));
    } catch (error) {
      ignored.push({ match: toHex(match.id), why: `openings file not used: ${error.message}` });
      ready.push(match);
    }
  }
  const { table, records } = await buildTable({ league, matches: ready, circuits, players });
  return { table, records, matches: ready, ignored };
}
