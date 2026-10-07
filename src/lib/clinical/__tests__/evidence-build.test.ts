// src/lib/clinical/__tests__/evidence-build.test.ts
import { describe, expect, it } from "vitest"
import { TaxonomySchema } from "../pack/schema"
import type { Finding } from "../evidence/schema"
import { buildConditionEvidence, followedConditions } from "../evidence/build"
import { paper } from "./helpers"

const TAXONOMY = TaxonomySchema.parse({ version: "t", nodes: [
  { id: "depression", type: "condition", name: "Major depressive disorder" },
  { id: "trd", type: "condition", name: "Treatment-resistant depression", parents: ["depression"] },
  { id: "schizophrenia", type: "condition", name: "Schizophrenia" },
  { id: "ketamine", type: "treatment", name: "Ketamine", modality: "drug" },
  { id: "cbt", type: "treatment", name: "Cognitive behavioral therapy", modality: "psychotherapy" },
] })
const NOW = new Date("2026-10-07T12:00:00.000Z")
const finding = (n: number, over: Partial<Finding> & { date?: string } = {}): Finding => {
  const { date, ...rest } = over
  return {
    key: `pmid:${n}`, slug: `paper-${n}`, paper: paper({ title: `Paper ${n}`, ids: { pmid: String(n) }, venue: "A Journal", ...(date === undefined ? { date: "2026-09-20" } : date ? { date } : {}) }),
    headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, design: "randomized-trial", designSource: "publication-type", journalBand: null,
    conditionCodes: ["depression"], kind: "benefit", treatment: "ketamine", treatmentCode: "ketamine", treatmentClass: null, researchType: null, sampleSize: null, text: "reduced symptoms",
    population: "adults", comparator: "placebo", outcome: "symptoms", firstListedAt: "2026-10-01T10:00:00.000Z", lastListedAt: "2026-10-01T10:00:00.000Z", ...rest,
  }
}

describe("the evidence of one condition", () => {
  const findings = [
    finding(1), finding(2, { kind: "no-benefit", design: "meta-analysis" }), finding(3, { kind: null }),
    finding(4, { treatment: "CBT", treatmentCode: "cbt", kind: "mixed", conditionCodes: ["trd"] }),
    finding(5, { treatment: "Exercise", treatmentCode: null, kind: "benefit", design: "cohort", designSource: "none" }),
    finding(6, { treatment: null, treatmentCode: null, kind: "other", text: "older age was linked to slower improvement" }),
    finding(7, { conditionCodes: ["schizophrenia"] }),
  ]
  const evidence = buildConditionEvidence(findings, TAXONOMY, "depression", { now: NOW, savedSlugs: new Set(["paper-2"]) })!

  it("has one row per treatment, counting studies by direction and by named design, subtypes included, other conditions left out", () => {
    expect(evidence.condition).toEqual({ code: "depression", name: "Major depressive disorder" })
    expect(evidence.total).toBe(6)
    expect(evidence.rows.map((row) => [row.key, row.treatment, row.modality, row.studies])).toEqual([
      ["ketamine", "Ketamine", "drug", 3], ["cbt", "Cognitive behavioral therapy", "psychotherapy", 1], ["folded", null, null, 1], ["none", null, null, 1],
    ])
    expect(evidence.rows[0].kinds).toEqual({ benefit: 1, "no-benefit": 1, mixed: 0, safety: 0, other: 0, unsorted: 1 })
    expect(evidence.rows[0].designs).toEqual([{ design: "randomized-trial", count: 2 }, { design: "meta-analysis", count: 1 }])
    // A design nobody named is not counted as one.
    expect(evidence.rows[2].designs).toEqual([])
    expect(evidence.rows[0].papers).toEqual(["pmid:1", "pmid:2", "pmid:3"])
  })

  it("keeps findings that name no treatment in a row of their own, last", () => {
    const only = buildConditionEvidence([finding(6, { treatment: null, treatmentCode: null, kind: "other" })], TAXONOMY, "depression", { now: NOW })!
    expect(only.rows).toHaveLength(1)
    expect(only.rows[0]).toMatchObject({ key: "none", treatment: null, studies: 1 })
    expect(only.timeline.series.map((series) => series.key)).toEqual(["other"])
  })

  it("puts a finding on something the pack does not know and that claims no effect in the row without a treatment", () => {
    const built = buildConditionEvidence([
      finding(1), finding(2, { treatment: "Childhood trauma", treatmentCode: null, kind: "other" }), finding(3, { treatment: "A screening tool", treatmentCode: null, kind: null }),
      finding(4, { treatment: null, treatmentCode: null, kind: "benefit" }),
    ], TAXONOMY, "depression", { now: NOW })!
    expect(built.rows.map((row) => [row.key, row.studies])).toEqual([["ketamine", 1], ["none", 3]])
    expect(built.rows[1].papers).toEqual(["pmid:2", "pmid:3", "pmid:4"])
    // What the paper named stays on the finding.
    expect(built.items.find((entry) => entry.key === "pmid:2")).toMatchObject({ rowKey: "none", treatment: "Childhood trauma" })
  })

  it("folds treatments the pack does not know that have one paper each into a single row, after the named rows and before the row without a treatment", () => {
    const built = buildConditionEvidence([
      finding(1), finding(2, { treatment: "Yoga", treatmentCode: null, kind: "benefit" }), finding(3, { treatment: "Saffron", treatmentCode: null, kind: "no-benefit", design: "cohort" }),
      finding(4, { treatment: "Light therapy", treatmentCode: null, kind: "safety" }), finding(5, { treatment: null, treatmentCode: null, kind: "other" }),
    ], TAXONOMY, "depression", { now: NOW })!
    expect(built.rows.map((row) => [row.key, row.treatment, row.studies])).toEqual([["ketamine", "Ketamine", 1], ["folded", null, 3], ["none", null, 1]])
    const folded = built.rows[1]
    expect(folded.kinds).toMatchObject({ benefit: 1, "no-benefit": 1, safety: 1 })
    expect(folded.designs).toEqual([{ design: "randomized-trial", count: 2 }, { design: "cohort", count: 1 }])
    expect(folded.papers).toEqual(["pmid:2", "pmid:3", "pmid:4"])
    expect(built.items.filter((entry) => entry.rowKey === "folded").map((entry) => entry.treatment).sort()).toEqual(["Light therapy", "Saffron", "Yoga"])
    // Neither the folded row nor the row without a treatment is a line of the timeline.
    expect(built.timeline.series.map((series) => series.key)).toEqual(["ketamine", "other"])
  })

  it("keeps a row for a treatment the pack does not know once two papers are on it, however they spell it", () => {
    const built = buildConditionEvidence([
      finding(1, { treatment: "Exercise", treatmentCode: null }), finding(2, { treatment: "exercise", treatmentCode: null, kind: "mixed" }), finding(3, { treatment: "Yoga", treatmentCode: null }),
    ], TAXONOMY, "depression", { now: NOW })!
    expect(built.rows.map((row) => [row.key, row.treatment, row.studies])).toEqual([["name:exercise", "Exercise", 2], ["folded", null, 1]])
    expect(followedConditions([
      finding(1, { treatment: "Exercise", treatmentCode: null }), finding(2, { treatment: "exercise", treatmentCode: null }), finding(3, { treatment: "Yoga", treatmentCode: null }),
      finding(4), finding(5, { treatment: null, treatmentCode: null, kind: "other" }),
    ], TAXONOMY, [], NOW)[0].treatments).toEqual(["Exercise", "Ketamine"])
  })

  it("shows a month-only publication date as the month, never with a day, and still orders and counts by it", () => {
    const built = buildConditionEvidence([finding(1, { date: "2026-08" }), finding(2, { date: "2026-07-30" })], TAXONOMY, "depression", { now: NOW })!
    expect(built.items.map((entry) => [entry.key, entry.date])).toEqual([["pmid:1", "2026-08"], ["pmid:2", "2026-07-30"]])
    expect(built.rows[0].latest).toBe("2026-08")
    expect(built.timeline.series[0].counts[built.timeline.months.indexOf("2026-08")]).toBe(1)
  })

  it("places a paper dated in a coming month by the day it entered PubMed, else by the day it was first listed", () => {
    const ahead = (n: number, addedDate?: string): Finding => {
      const base = finding(n, { date: "2026-12", firstListedAt: "2026-09-12T10:00:00.000Z" })
      return { ...base, paper: { ...base.paper, ...(addedDate ? { addedDate } : {}) } }
    }
    const built = buildConditionEvidence([ahead(1, "2026-10-02"), ahead(2), finding(3, { date: "2026-10-31" })], TAXONOMY, "depression", { now: NOW })!
    const counts = Object.fromEntries(built.timeline.months.map((month, index) => [month, built.timeline.series[0].counts[index]]))
    expect(counts["2026-10"]).toBe(2)
    expect(counts["2026-09"]).toBe(1)
    expect(built.timeline.series[0].counts.reduce((sum, count) => sum + count, 0)).toBe(3)
    // The date shown is still the one the paper carries.
    expect(built.items.find((entry) => entry.key === "pmid:1")!.date).toBe("2026-12")
  })

  it("lists every finding with its PICO line and whether the paper is saved", () => {
    expect(evidence.items).toHaveLength(6)
    expect(evidence.items[1]).toMatchObject({ key: "pmid:2", rowKey: "ketamine", saved: true, population: "adults", comparator: "placebo", outcome: "symptoms", designNamed: true })
    expect(evidence.items.find((entry) => entry.key === "pmid:5")).toMatchObject({ saved: false, designNamed: false })
  })

  it("draws the timeline over the last twelve months, placing a paper without a date by the day it was listed", () => {
    const dated = buildConditionEvidence([
      finding(1, { date: "2026-08-15" }), finding(2, { date: "2026" }), finding(3, { date: "" }), finding(4, { date: "2024-01-01" }),
    ], TAXONOMY, "depression", { now: NOW })!
    expect(dated.timeline.months).toHaveLength(12)
    expect(dated.timeline.months.at(-1)).toBe("2026-10")
    expect(dated.timeline.months[0]).toBe("2025-11")
    const counts = Object.fromEntries(dated.timeline.months.map((month, index) => [month, dated.timeline.series[0].counts[index]]))
    expect(counts["2026-08"]).toBe(1)
    // A year alone, or no date, falls on the month the paper was first listed; a paper older than the window is not drawn.
    expect(counts["2026-10"]).toBe(2)
    expect(dated.timeline.series[0].counts.reduce((sum, count) => sum + count, 0)).toBe(3)
    expect(dated.timeline.series.every((series) => series.counts.every((count) => Number.isInteger(count) && count >= 0))).toBe(true)
  })

  it("says what is new: findings first listed in the last two weeks, newest first", () => {
    const recent = buildConditionEvidence([
      finding(1, { firstListedAt: "2026-10-06T10:00:00.000Z" }), finding(2, { firstListedAt: "2026-09-01T10:00:00.000Z" }), finding(3, { firstListedAt: "2026-10-03T10:00:00.000Z" }),
    ], TAXONOMY, "depression", { now: NOW })!
    expect(recent.recent.map((entry) => entry.key)).toEqual(["pmid:1", "pmid:3"])
    expect(recent.recentTotal).toBe(2)
  })

  it("says how many were first listed in the last two weeks when it shows only some of them", () => {
    const many = buildConditionEvidence(Array.from({ length: 11 }, (_, index) => finding(index + 1, { firstListedAt: `2026-10-0${1 + (index % 6)}T10:00:00.000Z` })), TAXONOMY, "depression", { now: NOW })!
    expect(many.recent).toHaveLength(8)
    expect(many.recentTotal).toBe(11)
  })

  it("knows no condition the pack does not have", () => {
    expect(buildConditionEvidence(findings, TAXONOMY, "nothing", { now: NOW })).toBeNull()
    expect(buildConditionEvidence(findings, TAXONOMY, "ketamine", { now: NOW })).toBeNull()
  })
})

describe("the conditions the reader follows", () => {
  it("lists watched conditions and conditions with findings, the ones with news first", () => {
    const list = followedConditions([
      finding(1, { firstListedAt: "2026-10-06T10:00:00.000Z" }), finding(2), finding(7, { conditionCodes: ["schizophrenia"], firstListedAt: "2026-09-01T10:00:00.000Z" }),
    ], TAXONOMY, ["trd"], NOW)
    expect(list.map((entry) => [entry.code, entry.total, entry.recent])).toEqual([["depression", 2, 2], ["schizophrenia", 1, 0], ["trd", 0, 0]])
    expect(list[0].treatments).toEqual(["Ketamine"])
  })
})
