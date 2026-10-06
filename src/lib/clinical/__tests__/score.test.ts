import { describe, expect, it } from "vitest"
import { MODES, windowFor } from "../modes"
import { journalPrior, normaliseJournalName, recencyScore, relevanceScore, scoreCandidate } from "../score/score"
import { loadPsychiatryPack } from "../pack/load"
import { DESIGN_TIER } from "../filter/gate"
import { gated, grade } from "./helpers"

const NOW = new Date("2026-10-06T00:00:00Z")

describe("modes", () => {
  it("carries the spec's parameters", () => {
    expect(MODES["whats-new"]).toMatchObject({ halfLifeDays: 21, candidateCap: 150, snowballing: false })
    expect(MODES["catch-up"]).toMatchObject({ halfLifeDays: 180, candidateCap: 300, snowballing: true })
    for (const mode of Object.values(MODES)) {
      const { relevance, impact, evidence, recency } = mode.weights
      expect(relevance + impact + evidence + recency).toBe(100)
    }
  })
  it("builds the window ending now: 30 days for what's new", () => {
    const window = windowFor("whats-new", NOW)
    expect(window.to).toEqual(NOW)
    expect(window.from.toISOString()).toBe("2026-09-06T00:00:00.000Z")
  })
  it("looks back six calendar months in catch up unless told otherwise (D35)", () => {
    expect(windowFor("catch-up", NOW).from.toISOString()).toBe("2026-04-06T00:00:00.000Z")
    expect(windowFor("catch-up", NOW, 3).from.toISOString()).toBe("2026-07-06T00:00:00.000Z")
    expect(windowFor("catch-up", NOW, 12).from.toISOString()).toBe("2025-10-06T00:00:00.000Z")
  })
})

describe("recencyScore", () => {
  it("halves every half-life", () => {
    expect(recencyScore("2026-10-06", NOW, 21)).toBeCloseTo(100)
    expect(recencyScore("2026-09-15", NOW, 21)).toBeCloseTo(50)
    expect(recencyScore("2026-08-25", NOW, 21)).toBeCloseTo(25)
  })
  it("is neutral for a missing or unparseable date, and never above 100 for a future date", () => {
    expect(recencyScore(undefined, NOW, 21)).toBe(50)
    expect(recencyScore("not a date", NOW, 21)).toBe(50)
    expect(recencyScore("2027-01-01", NOW, 21)).toBe(100)
  })
})

describe("journalPrior", () => {
  const journals = [
    { name: "The Lancet", tier: "B" as const, state: "pinned" as const, issn: "0140-6736" },
    { name: "JAMA Psychiatry", tier: "A" as const, state: "demoted" as const, issn: "2168-622X" },
  ]
  it("matches by normalised name", () => {
    expect(journalPrior(journals, "Lancet")).toBe(5)
    expect(journalPrior(journals, "JAMA  psychiatry")).toBe(-5)
    expect(journalPrior(journals, "Unlisted Journal")).toBe(0)
    expect(journalPrior(journals, undefined)).toBe(0)
  })
})

describe("normaliseJournalName", () => {
  it("makes every shipped tier B journal match the title PubMed prints for it (checked against live PubMed, 2026-10-06)", async () => {
    const pack = await loadPsychiatryPack()
    const printed: Record<string, string> = {
      "New England Journal of Medicine": "The New England journal of medicine", "The Lancet": "Lancet (London, England)", JAMA: "JAMA",
      BMJ: "BMJ (Clinical research ed.)", "JAMA Internal Medicine": "JAMA internal medicine", "JAMA Network Open": "JAMA network open",
      "Annals of Internal Medicine": "Annals of internal medicine", "PLOS Medicine": "PLoS medicine",
      CMAJ: "CMAJ : Canadian Medical Association journal = journal de l'Association medicale canadienne",
      "Cochrane Database of Systematic Reviews": "The Cochrane database of systematic reviews",
    }
    for (const journal of pack.journals.filter((j) => j.tier === "B")) {
      expect(normaliseJournalName(printed[journal.name]), journal.name).toBe(normaliseJournalName(journal.name))
    }
  })
  it("does not confuse JAMA with its sister journals", () => {
    expect(normaliseJournalName("JAMA psychiatry")).not.toBe(normaliseJournalName("JAMA"))
  })
})

describe("relevanceScore", () => {
  it("averages entry and topic grades, scaled to 100", () => {
    expect(relevanceScore(grade("k", "w1", 4, 4))).toBe(100)
    expect(relevanceScore(grade("k", "w1", 2, 4))).toBe(75)
  })
  it("caps an unmatched paper at a topic grade of 2", () => {
    expect(relevanceScore(grade("k", null, 0, 4))).toBe(50)
    expect(relevanceScore(grade("k", null, 0, 1))).toBe(25)
  })
})

describe("scoreCandidate", () => {
  it("normalises the mode's weights over the signals available now", () => {
    const item = scoreCandidate({ candidate: gated({ title: "t", date: "2026-10-06" }, "meta-analysis"), grade: grade("k", "w1", 4, 4), mode: "whats-new", now: NOW, journals: [] })
    expect(item.breakdown.weights.relevance + item.breakdown.weights.evidence + item.breakdown.weights.recency).toBeCloseTo(1)
    expect(item.breakdown.weights.relevance).toBeCloseTo(45 / 80)
    expect(item.score).toBeCloseTo(100)
  })
  it("lets evidence matter more in catch-up than in what's new", () => {
    const gap = (mode: "whats-new" | "catch-up") => {
      const base = { grade: grade("k", "w1", 2, 2), mode, now: NOW, journals: [] }
      const strong = scoreCandidate({ ...base, candidate: gated({ title: "t", date: "2025-12-01" }, "meta-analysis") })
      const weak = scoreCandidate({ ...base, candidate: gated({ title: "t", date: "2025-12-01" }, "other") })
      return strong.score - weak.score
    }
    expect(gap("catch-up")).toBeGreaterThan(gap("whats-new"))
  })
  it("clamps evidence plus journal prior to 0–100", () => {
    const pinned = [{ name: "Venue", tier: "A" as const, state: "pinned" as const, issn: "1234-5678" }]
    const item = scoreCandidate({ candidate: gated({ title: "t", venue: "Venue" }, "meta-analysis"), grade: grade("k", "w1", 4, 4), mode: "catch-up", now: NOW, journals: pinned })
    expect(item.breakdown.evidence).toBe(100)
    expect(DESIGN_TIER["meta-analysis"]).toBe(100)
  })
})
