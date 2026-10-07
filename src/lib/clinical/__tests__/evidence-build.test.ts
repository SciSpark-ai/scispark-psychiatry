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
    conditionCodes: ["depression"], kind: "benefit", treatment: "ketamine", treatmentCode: "ketamine", text: "reduced symptoms",
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
      ["ketamine", "Ketamine", "drug", 3], ["cbt", "Cognitive behavioral therapy", "psychotherapy", 1], ["name:exercise", "Exercise", null, 1], ["none", null, null, 1],
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
