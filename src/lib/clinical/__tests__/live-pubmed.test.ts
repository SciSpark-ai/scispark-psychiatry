import { describe, expect, it } from "vitest"
import { enumeratePubmed } from "../../papers/pubmed"
import { loadPsychiatryPack } from "../pack/load"
import { deterministicPlan, journalQueries, type DateWindow } from "../plan/queries"
import { watch } from "./helpers"

/**
 * Live check that the generated PubMed syntax is accepted and returns records. Skipped unless
 * LIVE_PUBMED=1, so the normal suite never touches the network. Run it after changing queries.ts:
 *   LIVE_PUBMED=1 npx vitest run src/lib/clinical/__tests__/live-pubmed.test.ts
 */
const live = process.env.LIVE_PUBMED === "1"
const NOW = new Date()
const WINDOW: DateWindow = { from: new Date(NOW.getTime() - 90 * 86_400_000), to: NOW }

describe.skipIf(!live)("live PubMed", () => {
  it("accepts an entry query and returns psychiatric trial records", async () => {
    const pack = await loadPsychiatryPack()
    const plan = deterministicPlan(pack, [watch({ id: "w1", condition: "depression", treatment: "esketamine" })], WINDOW)
    const entry = plan.find((q) => q.tier === "entry")!
    const result = await enumeratePubmed({ query: entry.query, maxRecords: 50 }, { apiKey: process.env.NCBI_API_KEY })
    console.log(`entry query: ${result.total} matches, ${result.records.length} read`)
    expect(result.total).toBeGreaterThan(0)
  }, 60_000)

  it("accepts a tier B journal query (ISSN scope plus the domain clause)", async () => {
    const pack = await loadPsychiatryPack()
    const [query] = journalQueries(pack, "B", WINDOW)
    const result = await enumeratePubmed({ query: query.query, maxRecords: 50 }, { apiKey: process.env.NCBI_API_KEY })
    console.log(`tier B query: ${result.total} matches, ${result.records.length} read`)
    expect(result.total).toBeGreaterThan(0)
  }, 60_000)
})
