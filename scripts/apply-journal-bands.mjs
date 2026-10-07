#!/usr/bin/env node
// Writes each journal's band (1, 2 or 3) into packs/psychiatry/journals.json from the hand-made
// list in packs/psychiatry/journal-bands.json. Run it after editing that list, and again after
// scripts/build-journal-list.mjs (which rebuilds the journal entries without bands).
//
//   node scripts/apply-journal-bands.mjs
import { readFile, writeFile } from "node:fs/promises"

const read = async (name) => JSON.parse(await readFile(new URL(`../packs/psychiatry/${name}`, import.meta.url), "utf8"))
const bands = await read("journal-bands.json")
const pack = await read("journals.json")

const known = new Set(pack.journals.map((journal) => journal.name))
const unknown = [...bands.band1, ...bands.band2].filter((name) => !known.has(name))
if (unknown.length > 0) {
  console.error(`not in journals.json (check the spelling):\n  ${unknown.join("\n  ")}`)
  process.exit(1)
}
const both = bands.band1.filter((name) => bands.band2.includes(name))
if (both.length > 0) {
  console.error(`listed in both bands:\n  ${both.join("\n  ")}`)
  process.exit(1)
}

const counts = { 1: 0, 2: 0, 3: 0 }
for (const journal of pack.journals) {
  journal.band = bands.band1.includes(journal.name) ? 1 : bands.band2.includes(journal.name) ? 2 : 3
  counts[journal.band] += 1
}
await writeFile(new URL("../packs/psychiatry/journals.json", import.meta.url), JSON.stringify(pack, null, 1) + "\n")
console.log(`band 1: ${counts[1]}, band 2: ${counts[2]}, band 3: ${counts[3]}`)
