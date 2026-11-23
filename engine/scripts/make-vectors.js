// Writes vectors/league.json. Run from the engine folder:  npm run vectors
import { writeFileSync } from "node:fs";
import { VECTORS_FILE, asText, makeVectors } from "./vectors.js";

const vectors = await makeVectors();
writeFileSync(VECTORS_FILE, asText(vectors));
for (const row of vectors.table) console.log(`${row.position}  ${row.name.padEnd(6)} ${row.points} points`);
console.log(`wrote ${vectors.matchCount} matches to vectors/league.json`);
