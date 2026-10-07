import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { entriesKey, loadFeedCache, CACHE_PATH } from "../feed/cache"
import { gradeStageA } from "../grade/stage-a"
import { selectFeed } from "../select/select"
import type { StageAGrade } from "../types"
import { gated, llmResult, scored, SETTINGS, watch } from "./helpers"

// Owner decision 2026-10-06: most readers follow a condition. A paper that matches the whole watch
// entry comes first, then one that matches only its condition, then one that matches only its treatment.

const BOTH = watch({ id: "mdd-esk", condition: "Major depressive disorder", treatment: "Esketamine" })
const CONDITION_ONLY = watch({ id: "scz", condition: "Schizophrenia" })
const paperOf = (key: string, title: string, abstract: string) => gated({ title, abstract, ids: { pmid: key } }, "randomized-trial", key)
const P = [
  paperOf("p0", "Esketamine nasal spray in major depressive disorder", "Adults with major depressive disorder received esketamine nasal spray."),
  paperOf("p1", "Electroconvulsive therapy and memory in major depressive disorder", "Adults with major depressive disorder received electroconvulsive therapy."),
  paperOf("p2", "Esketamine for anxiety after colorectal surgery", "Surgical patients received esketamine during induction."),
  paperOf("p3", "Statins and stroke outcomes", "Adults with stroke received statins in this trial."),
  paperOf("p4", "Clozapine in schizophrenia", "Adults with schizophrenia received clozapine."),
]
const answer = (index: number, entryId: string | null, grade: number, quote: string, conditionMatch: boolean | null, treatmentMatch: boolean | null) =>
  ({ index, entryId, grade, topicGrade: 3, quote, conditionMatch, treatmentMatch })

async function grade(assessments: unknown[]) {
  const fast = new MockProvider([llmResult({ assessments }, "claude-haiku-4-5")])
  const { grades } = await gradeStageA(P, [BOTH, CONDITION_ONLY], [], { storage: new MemoryVaultStorage(), settings: SETTINGS, providerOverride: { fast } })
  return grades
}

describe("stage A records which part of the watch entry a paper matches", () => {
  it("tells a full match from a condition-only and a treatment-only match", async () => {
    const grades = await grade([
      answer(0, "mdd-esk", 4, "received esketamine nasal spray", true, true),
      answer(1, "mdd-esk", 4, "received electroconvulsive therapy", true, false),
      answer(2, "mdd-esk", 3, "received esketamine during induction", false, true),
      answer(3, "mdd-esk", 2, "received statins in this trial", false, false),
      answer(4, "scz", 4, "received clozapine", true, null),
    ])
    expect(grades.get("p0")?.matched).toBe("full")
    expect(grades.get("p1")?.matched).toBe("condition")
    expect(grades.get("p2")?.matched).toBe("treatment")
    // Neither part matches: not a match, whatever grade the model gave.
    expect(grades.get("p3")).toMatchObject({ entryId: null, grade: 0 })
    expect(grades.get("p3")?.matched).toBeUndefined()
    // An entry with only a condition is fully matched by its condition.
    expect(grades.get("p4")?.matched).toBe("full")
  })

  it("records no match when the quote is not in the text, and leaves answers without the two fields as they were", async () => {
    const grades = await grade([
      answer(0, "mdd-esk", 4, "a sentence that is nowhere in the paper", true, true),
      { index: 1, entryId: "mdd-esk", grade: 3, topicGrade: 3, quote: "received electroconvulsive therapy" },
    ])
    expect(grades.get("p0")).toMatchObject({ grade: 0 })
    expect(grades.get("p0")?.matched).toBeUndefined()
    expect(grades.get("p1")).toMatchObject({ grade: 3, entryId: "mdd-esk" })
    expect(grades.get("p1")?.matched).toBeUndefined()
  })
})

const item = (key: string, matched: StageAGrade["matched"], g: number, score: number, entryId = "mdd-esk") => {
  const base = scored(key, `Distinct title ${key} alpha${key} beta${key} gamma${key}`, entryId, g, score)
  return { ...base, grade: { ...base.grade, matched } }
}

describe("the list shows full matches first, then condition-only, then treatment-only", () => {
  it("orders by layer before score, and by score within a layer", () => {
    const result = selectFeed([
      item("t1", "treatment", 3, 99), item("c1", "condition", 2, 95), item("f1", "full", 4, 60), item("c2", "condition", 1, 97), item("f2", "full", 4, 70),
    ], [BOTH])
    expect(result.items.map((i) => i.candidate.key)).toEqual(["f2", "f1", "c2", "c1", "t1"])
  })

  it("lists a condition-only paper even when its grade is low, since the layer now says how it matches", () => {
    const result = selectFeed([item("c", "condition", 1, 50)], [BOTH])
    expect(result.items.map((i) => i.candidate.key)).toEqual(["c"])
    expect(result.drops).toEqual([])
  })

  it("fills the list from the first layer down, so the last layer is cut first", () => {
    const pool = [
      ...Array.from({ length: 30 }, (_, n) => item(`f${n}`, "full", 4, 50 - n * 0.1)),
      ...Array.from({ length: 30 }, (_, n) => item(`c${n}`, "condition", 2, 90 - n * 0.1)),
      ...Array.from({ length: 30 }, (_, n) => item(`t${n}`, "treatment", 2, 99 - n * 0.1)),
    ]
    const result = selectFeed(pool, [BOTH])
    const keys = result.items.map((i) => i.candidate.key)
    expect(keys).toHaveLength(48)
    expect(keys.slice(0, 30).every((k) => k.startsWith("f"))).toBe(true)
    expect(keys.slice(30).every((k) => k.startsWith("c"))).toBe(true)
    expect(result.drops.filter((d) => d.reason === "list-cap")).toHaveLength(42)
  })
})

describe("grades given before the layers existed are not reused", () => {
  it("drops stored grades of the earlier scheme and keeps the stored summaries", async () => {
    const storage = new MemoryVaultStorage()
    const oldKey = JSON.stringify([["mdd-esk", "Major depressive disorder", "Esketamine", "", ""]])
    const kept = { hash: "h", at: "2026-10-06T00:00:00.000Z" }
    await storage.write(CACHE_PATH, JSON.stringify({ version: 1, entriesKey: oldKey, grades: { k: { ...kept, value: {} } }, digests: { k: { ...kept, value: { headline: "h", takeaway: "t", quote: "q" } } } }))
    const cache = await loadFeedCache(storage, [BOTH])
    expect(cache.grades).toEqual({})
    expect(Object.keys(cache.digests)).toEqual(["k"])
    expect(entriesKey([BOTH])).not.toBe(oldKey)
  })
})
