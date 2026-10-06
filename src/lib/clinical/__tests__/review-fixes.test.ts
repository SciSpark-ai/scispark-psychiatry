import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadPsychiatryPack } from "../pack/load"
import { runClinicalFeed, type ClinicalFeedDeps } from "../feed/run"
import { loadClinicalFeed } from "../feed/stored"
import { designGate } from "../filter/gate"
import { MODES } from "../modes"
import { deterministicPlan, type DateWindow } from "../plan/queries"
import type { EnumerateFn } from "../retrieve/pool"
import { selectFeed } from "../select/select"
import { saveWatchEntries } from "../watch/store"
import { candidate, fastOk, paper, scored, SETTINGS, strongOk, watch } from "./helpers"

// Tests for the findings of the whole-branch review of Slices 0 and 1.

const NOW = () => new Date("2026-10-06T10:00:00.000Z")
const WINDOW: DateWindow = { from: new Date("2026-09-06T00:00:00.000Z"), to: new Date("2026-10-06T00:00:00.000Z") }

const RCT = paper({
  title: "Esketamine nasal spray versus quetiapine in treatment-resistant depression", ids: { pmid: "111" },
  abstract: "Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.",
  publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-28",
})
const RCT2 = paper({
  title: "Intravenous ketamine for treatment-resistant depression: a randomised trial", ids: { pmid: "112" },
  abstract: "Adults with treatment-resistant depression were randomised to ketamine or midazolam.",
  publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-27",
})

const tierOf = (query: string) => (query.includes("[Journal]") ? (query.includes('"Mental Disorders"') ? "B" : "A") : "entry")

async function setup() {
  const storage = new MemoryVaultStorage()
  await saveWatchEntries(storage, [watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine", priority: "high" })])
  const pack = await loadPsychiatryPack()
  const deps = (enumerate: EnumerateFn, assessments: unknown[]): ClinicalFeedDeps =>
    ({ pack, enumerate, settings: SETTINGS, now: NOW, providerOverride: { strong: strongOk(), fast: fastOk(assessments) } })
  return { storage, deps }
}

const twoGood = [
  { index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "esketamine nasal spray or quetiapine" },
  { index: 1, entryId: "w1", grade: 3, topicGrade: 4, quote: "randomised to ketamine or midazolam" },
]
const oneGood = [twoGood[0]]

describe("a partly failed run (review finding 2)", () => {
  it("keeps the previous feed when half or more of the PubMed queries failed", async () => {
    const { storage, deps } = await setup()
    const first = await runClinicalFeed(storage, deps(async () => ({ records: [RCT, RCT2], total: 2, truncated: false }), twoGood))
    expect(first.items).toHaveLength(2)

    const mostlyDown: EnumerateFn = async ({ query }) => {
      if (tierOf(query) !== "entry") throw new Error("rate limited")
      return { records: [RCT], total: 1, truncated: false }
    }
    await expect(runClinicalFeed(storage, deps(mostlyDown, oneGood))).rejects.toThrow(/previous feed is still shown/)
    expect(await loadClinicalFeed(storage)).toEqual(first)
  })

  it("still replaces the feed, with a warning, when only a few queries failed", async () => {
    const { storage, deps } = await setup()
    await runClinicalFeed(storage, deps(async () => ({ records: [RCT, RCT2], total: 2, truncated: false }), twoGood))
    const oneDown: EnumerateFn = async ({ query }) => {
      if (tierOf(query) === "B") throw new Error("rate limited")
      return { records: [RCT], total: 1, truncated: false }
    }
    const feed = await runClinicalFeed(storage, deps(oneDown, oneGood))
    expect(feed.items).toHaveLength(1)
    expect(feed.warnings.some((w) => w.includes("rate limited"))).toBe(true)
  })

  it("stores what it found when there is no previous feed to protect", async () => {
    const { storage, deps } = await setup()
    const mostlyDown: EnumerateFn = async ({ query }) => {
      if (tierOf(query) !== "entry") throw new Error("rate limited")
      return { records: [RCT], total: 1, truncated: false }
    }
    const feed = await runClinicalFeed(storage, deps(mostlyDown, oneGood))
    expect(feed.items).toHaveLength(1)
  })
})

describe("selection cuts are logged and ungraded papers are kept (review finding 3)", () => {
  const entries = [watch({ id: "a", condition: "depression" })]

  it("logs a drop for every lower-confidence paper beyond the cap", () => {
    const items = Array.from({ length: 30 }, (_, i) => scored(`k${i}`, `Distinct lower title number ${i} alpha${i} beta${i}`, "a", 0, 50 - i))
    const result = selectFeed(items, entries)
    expect(result.lowerConfidence).toHaveLength(24)
    const cut = result.drops.filter((d) => d.reason === "lower-confidence-cap")
    expect(cut.map((d) => d.key)).toEqual(["k24", "k25", "k26", "k27", "k28", "k29"])
    expect(cut.every((d) => d.step === "select")).toBe(true)
  })

  it("logs a drop for every shortlisted paper beyond the list cap", () => {
    const items = Array.from({ length: 50 }, (_, i) => scored(`k${i}`, `Distinct listed title number ${i} gamma${i} delta${i}`, "a", 4, 90 - i))
    const result = selectFeed(items, entries)
    expect(result.items).toHaveLength(48)
    expect(result.drops.filter((d) => d.reason === "list-cap").map((d) => d.key).sort()).toEqual(["k48", "k49"])
  })

  it("keeps every ungraded paper in the lower-confidence section, whatever the cap", () => {
    const gradedLow = Array.from({ length: 40 }, (_, i) => scored(`g${i}`, `Distinct graded title number ${i} eps${i} zeta${i}`, "a", 0, 40))
    const ungraded = Array.from({ length: 20 }, (_, i) => {
      const item = scored(`u${i}`, `Distinct ungraded title number ${i} eta${i} theta${i}`, null, 0, 5)
      return { ...item, grade: { ...item.grade, ungraded: true, quoteVerified: false } }
    })
    const result = selectFeed([...gradedLow, ...ungraded], entries)
    const kept = result.lowerConfidence.map((item) => item.candidate.key)
    for (let i = 0; i < 20; i++) expect(kept).toContain(`u${i}`)
    expect(result.lowerConfidence.filter((item) => !item.grade.ungraded)).toHaveLength(24)
  })
})

describe("safety signals (review finding 4)", () => {
  it("plans a case-report query for a safety-signal entry, and none for other entries", async () => {
    const pack = await loadPsychiatryPack()
    const plan = deterministicPlan(pack, [
      watch({ id: "s", treatment: "esketamine", safetySignal: true }),
      watch({ id: "n", treatment: "lithium" }),
      watch({ id: "p", treatment: "clozapine", safetySignal: true, priority: "paused" }),
    ], WINDOW)
    const caseQueries = plan.filter((q) => q.query.includes('"Case Reports"[pt]'))
    expect(caseQueries.map((q) => q.entryId)).toEqual(["s"])
    expect(caseQueries[0].tier).toBe("entry")
    expect(caseQueries[0].query).toContain("esketamine")
    expect(caseQueries[0].query).toContain("[edat]")
    expect(caseQueries[0].query).not.toContain('"Randomized Controlled Trial"[pt]')
  })

  it("does not count a word found inside another word as a mention of the treatment", async () => {
    const pack = await loadPsychiatryPack()
    const entries = [watch({ treatment: "Electroconvulsive therapy", safetySignal: true })]
    const unrelated = candidate({ title: "Severe hyponatremia: effect of fluid restriction in one subject, a case report", abstract: "The subject recovered.", publicationTypes: ["Case Reports"] }, "k:unrelated")
    const related = candidate({ title: "Prolonged seizure after ECT: a case report", abstract: "A patient had a prolonged seizure.", publicationTypes: ["Case Reports"] }, "k:related")
    const result = designGate(pack, entries, [unrelated, related], "standard")
    expect(result.safety.map((c) => c.key)).toEqual(["k:related"])
    expect(result.drops.map((d) => d.key)).toContain("k:unrelated")
  })
})

describe("the recall check stays off (decision D36)", () => {
  it("is not switched on in either mode", () => {
    expect(MODES["whats-new"].recallCheck).toBe(false)
    expect(MODES["catch-up"].recallCheck).toBe(false)
  })
})
