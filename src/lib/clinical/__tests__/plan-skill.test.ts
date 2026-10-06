import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { planQueries } from "../plan/skill"
import { SETTINGS, strongOk, watch } from "./helpers"

const WINDOW = { from: new Date("2026-09-06T00:00:00Z"), to: new Date("2026-10-06T00:00:00Z") }
const entries = [watch({ id: "w1", condition: "depression", treatment: "esketamine" })]

describe("planQueries", () => {
  const run = async (strong: MockProvider) => {
    const pack = await loadPsychiatryPack()
    return planQueries(pack, entries, WINDOW, { storage: new MemoryVaultStorage(), settings: SETTINGS, providerOverride: { strong } })
  }

  it("adds validated model queries, wrapped with the window and design hint, between entry and journal queries", async () => {
    const { plan, warnings } = await run(strongOk([{ entryId: "w1", query: 'esketamine[Title/Abstract] AND (remission[Title/Abstract] OR response[Title/Abstract])', rationale: "outcome terms" }]))
    expect(warnings).toEqual([])
    const extra = plan.filter((q) => q.rationale === "outcome terms")
    expect(extra).toHaveLength(1)
    expect(extra[0].query).toContain("[edat]")
    expect(extra[0].query).toContain('"Randomized Controlled Trial"[pt]')
    expect(plan.indexOf(extra[0])).toBeLessThan(plan.findIndex((q) => q.tier === "B"))
  })

  it("drops queries that are malformed, for an unknown entry, or beyond three per entry", async () => {
    const good = (n: number) => ({ entryId: "w1", query: `esketamine[Title/Abstract] AND term${n}[Title/Abstract]`, rationale: `good${n}` })
    const { plan } = await run(strongOk([
      { entryId: "w1", query: "(unbalanced", rationale: "bad1" },
      { entryId: "w-unknown", query: "esketamine[Title/Abstract]", rationale: "bad2" },
      good(1), good(2), good(3), good(4),
    ]))
    const rationales = plan.map((q) => q.rationale)
    expect(rationales).not.toContain("bad1")
    expect(rationales).not.toContain("bad2")
    expect(rationales.filter((r) => r.startsWith("good"))).toEqual(["good1", "good2", "good3"])
  })

  it("falls back to the deterministic plan when the model fails", async () => {
    const { plan, warnings } = await run(new MockProvider([]))
    expect(warnings[0]).toMatch(/standard queries only/)
    expect(plan.some((q) => q.tier === "entry")).toBe(true)
    expect(plan.some((q) => q.tier === "B")).toBe(true)
  })
})
