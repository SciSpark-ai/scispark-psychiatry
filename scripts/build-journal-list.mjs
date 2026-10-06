#!/usr/bin/env node
// Builds the tier A journal list of the psychiatry pack from v1's psychiatry_source_ids.json
// (a {journal name: OpenAlex source id} map) by looking the ids up on OpenAlex.
//
//   node scripts/build-journal-list.mjs <path to psychiatry_source_ids.json>
//
// Needs Node 22.18 or later (runs the TypeScript helper directly). Sends no contact email to
// OpenAlex (decision D32), so requests use its shared pool. Replaces tier A entries in
// packs/psychiatry/journals.json and keeps tier B.
import { readFile, writeFile } from "node:fs/promises"
import { buildTierA } from "../src/lib/clinical/pack/build-journals.ts"

const [, , v1Path] = process.argv
if (!v1Path) {
  console.error("usage: node scripts/build-journal-list.mjs <path to psychiatry_source_ids.json>")
  process.exit(2)
}

const v1 = JSON.parse(await readFile(v1Path, "utf8"))
const ids = Object.values(v1)
const rows = []
for (let i = 0; i < ids.length; i += 50) {
  const batch = ids.slice(i, i + 50)
  const url = `https://api.openalex.org/sources?filter=openalex:${batch.join("|")}&per-page=50&select=id,display_name,issn_l,issn`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`OpenAlex returned ${response.status} for batch starting at ${i}`)
  rows.push(...(await response.json()).results)
}

const { journals, unresolved } = buildTierA(v1, rows)
const target = new URL("../packs/psychiatry/journals.json", import.meta.url)
const existing = JSON.parse(await readFile(target, "utf8"))
const tierB = existing.journals.filter((journal) => journal.tier === "B")
await writeFile(target, JSON.stringify({ version: existing.version, journals: [...journals, ...tierB] }, null, 1) + "\n")

console.log(`tier A: ${journals.length} journals written (${Object.keys(v1).length} in v1); tier B kept: ${tierB.length}`)
if (unresolved.length > 0) console.log(`unresolved (no OpenAlex row or no valid ISSN):\n  ${unresolved.join("\n  ")}`)
