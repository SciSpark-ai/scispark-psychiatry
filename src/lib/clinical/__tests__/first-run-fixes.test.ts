import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadPsychiatryPack } from "../pack/load"
import { capCandidates } from "../feed/run"
import { gradeStageA } from "../grade/stage-a"
import { conclusionOf } from "../text/takeaway"
import { CLINICAL_COPY } from "../copy"
import type { GatedCandidate } from "../types"
import { fastOk, gated, SETTINGS, watch } from "./helpers"

// Changes made after the first real run (docs/psychiatry/first-run-2026-10-06.md) and the owner's feedback on it.

const fromEntry = (entryId: string, n: number, design: GatedCandidate["design"] = "cohort"): GatedCandidate =>
  ({ ...gated({ title: `Entry ${entryId} paper ${n}`, date: "2026-09-10", ids: { pmid: `${entryId}${n}` } }, design, `${entryId}:${n}`), provenance: [{ query: "q", tier: "entry", entryId }] })
const fromJournal = (n: number, title = `Journal paper ${n}`, design: GatedCandidate["design"] = "randomized-trial"): GatedCandidate =>
  ({ ...gated({ title, date: "2026-09-10", ids: { pmid: `j${n}` } }, design, `j:${n}`), provenance: [{ query: "q", tier: "A" }] })
const count = (kept: GatedCandidate[], prefix: string) => kept.filter((c) => c.key.startsWith(prefix)).length

describe("the candidate cap shares places between watch entries and the journals", () => {
  it("does not let one broad entry fill the cap", () => {
    const pool = [
      ...Array.from({ length: 100 }, (_, n) => fromEntry("a", n)),
      ...Array.from({ length: 5 }, (_, n) => fromEntry("b", n)),
      ...Array.from({ length: 100 }, (_, n) => fromJournal(n)),
    ]
    const { kept, drops } = capCandidates(pool, 30)
    expect(kept).toHaveLength(30)
    expect(count(kept, "b:")).toBe(5)
    expect(count(kept, "a:")).toBeGreaterThanOrEqual(12)
    expect(count(kept, "j:")).toBeGreaterThanOrEqual(12)
    expect(drops).toHaveLength(175)
    expect(drops[0]).toMatchObject({ step: "cap", reason: "over-cap:30" })
  })

  it("gives a High entry two places for every one of a Normal entry", () => {
    const pool = [...Array.from({ length: 50 }, (_, n) => fromEntry("hi", n)), ...Array.from({ length: 50 }, (_, n) => fromEntry("no", n))]
    const { kept } = capCandidates(pool, 30, { entries: [watch({ id: "hi", condition: "depression", priority: "high" }), watch({ id: "no", condition: "ptsd" })] })
    expect(count(kept, "hi:")).toBe(20)
    expect(count(kept, "no:")).toBe(10)
  })

  it("grades journal papers that name a watched condition or treatment before other journal papers", async () => {
    const pack = await loadPsychiatryPack()
    const pool = [
      ...Array.from({ length: 20 }, (_, n) => fromJournal(n, `Sertraline in generalised anxiety, trial ${n}`)),
      fromJournal(99, "Clozapine and neutropenia in a registry cohort", "cohort"),
    ]
    const { kept } = capCandidates(pool, 3, { entries: [watch({ id: "w", treatment: "clozapine" })], pack })
    expect(kept.map((c) => c.key)).toContain("j:99")
  })
})

describe("the run log records what the model said, not only the final grade", () => {
  const entries = [watch({ id: "w1", condition: "depression" })]
  const candidates = [
    gated({ title: "Esketamine for depression", abstract: "Adults were randomised to esketamine or placebo.", ids: { pmid: "1" } }, "randomized-trial", "k1"),
    gated({ title: "Statins and stroke", abstract: "A cardiovascular trial.", ids: { pmid: "2" } }, "randomized-trial", "k2"),
  ]
  it("keeps the model's grade when the quote check zeroes it, and when the model itself said 0", async () => {
    const fast = fastOk([
      { index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "a sentence that is not in the abstract" },
      { index: 1, entryId: null, grade: 0, topicGrade: 0, quote: "" },
    ])
    const { grades } = await gradeStageA(candidates, entries, [], { storage: new MemoryVaultStorage(), settings: SETTINGS, providerOverride: { fast } })
    expect(grades.get("k1")).toMatchObject({ grade: 0, quoteVerified: false, modelGrade: 4 })
    expect(grades.get("k2")).toMatchObject({ grade: 0, modelGrade: 0 })
  })
})

describe("conclusionOf: the authors' own conclusion for the card", () => {
  it("returns the labelled conclusion section without its label", () => {
    const abstract = "BACKGROUND: Depression is common.\nMETHODS: We randomised 200 adults.\nRESULTS: Response was 48% vs 30%.\nCONCLUSIONS: Drug A improved response at week 8. It was well tolerated.\nFUNDING: A foundation."
    expect(conclusionOf(abstract)).toBe("Drug A improved response at week 8. It was well tolerated.")
  })
  it("reads Interpretation and Authors' conclusions as the conclusion", () => {
    expect(conclusionOf("BACKGROUND: x.\nINTERPRETATION: Mood stabilisers were associated with fewer relapses.\nFUNDING: y.")).toBe("Mood stabilisers were associated with fewer relapses.")
    expect(conclusionOf("RATIONALE: x.\nAUTHORS' CONCLUSIONS: The evidence is very uncertain.\nREGISTRATION: z.")).toBe("The evidence is very uncertain.")
  })
  it("uses the last sentence of an unlabelled abstract, skipping funding and registration lines", () => {
    expect(conclusionOf("We studied 40 patients. Symptoms fell by half. Larger trials are needed to confirm this.\nFUNDING: none.")).toBe("Larger trials are needed to confirm this.")
  })
  it("keeps at most two sentences", () => {
    expect(conclusionOf("CONCLUSION: One. Two. Three. Four.")).toBe("One. Two.")
  })
  it("returns nothing when there is no abstract", () => {
    expect(conclusionOf(undefined)).toBeUndefined()
    expect(conclusionOf("  ")).toBeUndefined()
  })
})

describe("match wording", () => {
  it("names each grade in words and explains it", () => {
    expect(CLINICAL_COPY.feed.matchLabels[4]).toBe("Direct match")
    for (const grade of [1, 2, 3, 4] as const) {
      expect(CLINICAL_COPY.feed.matchLabels[grade].length).toBeGreaterThan(0)
      expect(CLINICAL_COPY.feed.matchNotes[grade].length).toBeGreaterThan(20)
    }
  })
})
