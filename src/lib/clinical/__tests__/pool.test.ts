import { describe, expect, it, vi } from "vitest"
import { retrieve, toCandidate, MAX_RECORDS, type EnumerateFn } from "../retrieve/pool"
import type { PlannedQuery } from "../plan/queries"
import { paper } from "./helpers"

const plan = (n: number): PlannedQuery[] => Array.from({ length: n }, (_, i) => ({ query: `q${i}`, entryId: i === 0 ? "w1" : null, tier: i === 0 ? "entry" : "A", rationale: `r${i}` }))
const ok = (records: ReturnType<typeof paper>[], total = records.length) => ({ records, total, truncated: total > records.length })

describe("toCandidate", () => {
  it("cleans the stored text and flags a missing abstract", () => {
    const c = toCandidate(paper({ title: "12. Ketamine &amp; <i>mood</i>.", ids: { pmid: "1" } }), { query: "q", tier: "entry" })!
    expect(c.paper.title).toBe("Ketamine & mood")
    expect(c.flags).toContain("title-only")
    expect(c.key).toBe("pmid:1")
  })
  it("rejects a record without a usable title", () => {
    expect(toCandidate(paper({ title: "<i></i>" }), { query: "q", tier: "entry" })).toBeNull()
  })
})

describe("retrieve", () => {
  it("merges duplicates across queries and keeps every provenance entry", async () => {
    const same = paper({ title: "Esketamine for TRD", ids: { pmid: "7" }, abstract: "x".repeat(200) })
    const enumerate: EnumerateFn = vi.fn(async () => ok([same]))
    const result = await retrieve(enumerate, plan(2))
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].provenance.map((p) => p.query)).toEqual(["q0", "q1"])
    expect(result.queryLog).toHaveLength(2)
  })

  it("drops already-handled records and logs why", async () => {
    const enumerate: EnumerateFn = async () => ok([paper({ title: "Seen before", ids: { pmid: "9" } }), paper({ title: "Fresh one", ids: { pmid: "10" } })])
    const result = await retrieve(enumerate, plan(1), { exclude: new Set(["pmid:9"]) })
    expect(result.candidates.map((c) => c.key)).toEqual(["pmid:10"])
    expect(result.drops).toEqual([{ key: "pmid:9", title: "Seen before", step: "retrieve", reason: "already-handled" }])
  })

  it("logs a failed query and carries on with the rest", async () => {
    const enumerate: EnumerateFn = async ({ query }) => {
      if (query === "q0") throw new Error("PubMed esearch request failed with status 429")
      return ok([paper({ title: "Survivor", ids: { pmid: "5" } })])
    }
    const result = await retrieve(enumerate, plan(2))
    expect(result.candidates).toHaveLength(1)
    expect(result.queryLog[0].error).toMatch(/429/)
  })

  it("throws when every query failed, so a stored feed is never replaced by nothing", async () => {
    const enumerate: EnumerateFn = async () => { throw new Error("offline") }
    await expect(retrieve(enumerate, plan(3))).rejects.toThrow(/every query/)
  })

  it("passes the tier's record ceiling and reports truncation", async () => {
    const enumerate = vi.fn<EnumerateFn>(async () => ok([paper({ title: "One of many", ids: { pmid: "1" } })], 5000))
    const result = await retrieve(enumerate, plan(2))
    expect(enumerate).toHaveBeenNthCalledWith(1, { query: "q0", maxRecords: MAX_RECORDS.entry })
    expect(enumerate).toHaveBeenNthCalledWith(2, { query: "q1", maxRecords: MAX_RECORDS.A })
    expect(result.queryLog.every((entry) => entry.truncated)).toBe(true)
  })
})
