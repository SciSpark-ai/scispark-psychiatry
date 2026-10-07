// src/lib/clinical/__tests__/evidence-build.test.ts
import { describe, expect, it } from "vitest"
import { TaxonomySchema } from "../pack/schema"
import type { Finding } from "../evidence/schema"
import { buildConditionEvidence, followedConditions } from "../evidence/build"
import { paper } from "./helpers"

const CONDITIONS = [
  { id: "depression", type: "condition", name: "Major depressive disorder" },
  { id: "trd", type: "condition", name: "Treatment-resistant depression", parents: ["depression"] },
  { id: "schizophrenia", type: "condition", name: "Schizophrenia" },
]
const TAXONOMY = TaxonomySchema.parse({ version: "t", nodes: [
  ...CONDITIONS,
  { id: "ketamine", type: "treatment", name: "Ketamine", modality: "drug" },
  { id: "antipsychotic", type: "treatment", name: "Antipsychotics", modality: "drug" },
  { id: "clozapine", type: "treatment", name: "Clozapine", modality: "drug", parents: ["antipsychotic"] },
  { id: "psychotherapy", type: "treatment", name: "Psychotherapy", modality: "psychotherapy" },
  { id: "cbt", type: "treatment", name: "Cognitive behavioral therapy", modality: "psychotherapy", parents: ["psychotherapy"] },
  { id: "neuromodulation", type: "treatment", name: "Neuromodulation", modality: "neuromodulation" },
  { id: "rtms", type: "treatment", name: "rTMS", modality: "neuromodulation", parents: ["neuromodulation"] },
  { id: "ect", type: "treatment", name: "Electroconvulsive therapy", modality: "neuromodulation" },
  { id: "lightbox", type: "treatment", name: "Bright light", modality: "other" },
] })
/** No node for psychotherapy or neuromodulation: a parentless therapy and a parentless stimulation. */
const BARE = TaxonomySchema.parse({ version: "t", nodes: [
  ...CONDITIONS,
  { id: "cbt", type: "treatment", name: "Cognitive behavioral therapy", modality: "psychotherapy" },
  { id: "ect", type: "treatment", name: "Electroconvulsive therapy", modality: "neuromodulation" },
] })
const NOW = new Date("2026-10-07T12:00:00.000Z")
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10)

const finding = (n: number, over: Partial<Finding> & { date?: string; authors?: string[]; addedDate?: string } = {}): Finding => {
  const { date, authors, addedDate, ...rest } = over
  return {
    key: `pmid:${n}`, slug: `paper-${n}`,
    paper: paper({
      title: `Paper ${n}`, ids: { pmid: String(n) }, venue: "A Journal", ...(date === undefined ? { date: "2026-09-20" } : date ? { date } : {}),
      ...(authors ? { authors: authors.map((name) => ({ name })) } : {}), ...(addedDate ? { addedDate } : {}),
    }),
    headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, design: "randomized-trial", designSource: "publication-type", journalBand: null,
    conditionCodes: ["depression"], kind: "benefit", treatment: "Ketamine", treatmentCode: "ketamine", treatmentClass: null, researchType: null, sampleSize: null, text: "reduced symptoms",
    population: "adults", comparator: "placebo", outcome: "symptoms", firstListedAt: "2026-10-01T10:00:00.000Z", lastListedAt: "2026-10-01T10:00:00.000Z", ...rest,
  }
}
const uncoded = (n: number, treatment: string, over: Partial<Finding> & { date?: string } = {}) => finding(n, { treatment, treatmentCode: null, ...over })
const none = (n: number, over: Partial<Finding> & { date?: string } = {}) => finding(n, { treatment: null, treatmentCode: null, text: "a statement", ...over })
const build = (findings: Finding[], over: Parameters<typeof buildConditionEvidence>[3] = { now: NOW }, taxonomy = TAXONOMY) => buildConditionEvidence(findings, taxonomy, "depression", over)!
const classKeys = (evidence: ReturnType<typeof build>) => evidence.classes.map((entry) => entry.key)

describe("the class of a treatment", () => {
  it("is the top-most pack ancestor for a pack child", () => {
    const evidence = build([finding(1, { treatment: "Clozapine", treatmentCode: "clozapine" }), finding(2, { treatment: "rTMS", treatmentCode: "rtms" })])
    expect(evidence.classes.map((entry) => [entry.key, entry.label, entry.treatments.map((treatment) => treatment.key)])).toEqual([
      ["antipsychotic", "Antipsychotics", ["clozapine"]], ["neuromodulation", "Neuromodulation", ["rtms"]],
    ])
  })
  it("is the node itself when a pack class node is used directly, and the finding is a treatment of the same name inside it", () => {
    const evidence = build([finding(1, { treatment: "antipsychotics", treatmentCode: "antipsychotic" }), finding(2, { treatment: "Clozapine", treatmentCode: "clozapine" })])
    expect(evidence.classes).toHaveLength(1)
    expect(evidence.classes[0]).toMatchObject({ key: "antipsychotic", label: "Antipsychotics", papers: 2 })
    expect(evidence.classes[0].treatments.map((treatment) => [treatment.key, treatment.name, treatment.papers])).toEqual([["antipsychotic", "Antipsychotics", 1], ["clozapine", "Clozapine", 1]])
  })
  it("is medicine, without a label, for a parentless pack drug", () => {
    const evidence = build([finding(1)])
    expect(evidence.classes.map((entry) => [entry.key, entry.label])).toEqual([["medicine", null]])
    expect(evidence.classes[0].treatments[0]).toMatchObject({ key: "ketamine", name: "Ketamine" })
  })
  it("follows the modality of a parentless pack node, and the class of its findings for the modality other", () => {
    const evidence = build([
      finding(1, { treatment: "ECT", treatmentCode: "ect" }), finding(2, { treatment: "Bright light", treatmentCode: "lightbox", treatmentClass: "lifestyle" }), finding(3, { treatment: "Bright light", treatmentCode: "lightbox" }),
    ])
    expect(classKeys(evidence)).toEqual(["lifestyle", "neuromodulation"])
    expect(evidence.classes[0].treatments).toHaveLength(1)
    expect(evidence.classes[0].treatments[0]).toMatchObject({ key: "lightbox", papers: 2 })
    expect(evidence.classes.find((entry) => entry.key === "neuromodulation")!.label).toBe("Neuromodulation")
  })
  it("joins an uncoded psychosocial treatment to the psychotherapy class, one class for psychotherapies", () => {
    const evidence = build([finding(1, { treatment: "CBT", treatmentCode: "cbt" }), uncoded(2, "Mindfulness", { treatmentClass: "psychosocial" })])
    expect(evidence.classes.map((entry) => [entry.key, entry.label, entry.papers])).toEqual([["psychotherapy", "Psychotherapy", 2]])
  })
  it("uses the pack-less keys, with no label, when the pack has no node of that id", () => {
    const evidence = build([finding(1, { treatment: "CBT", treatmentCode: "cbt" }), uncoded(2, "Mindfulness", { treatmentClass: "psychosocial" }), finding(3, { treatment: "ECT", treatmentCode: "ect" }), uncoded(4, "tDCS", { treatmentClass: "neuromodulation" })], { now: NOW }, BARE)
    expect(evidence.classes.map((entry) => [entry.key, entry.label, entry.papers])).toEqual([["neuromodulation", null, 2], ["psychotherapy", null, 2]])
  })
  it("maps uncoded classes to their own keys, and an uncoded treatment with no class to other, last", () => {
    const evidence = build([
      uncoded(1, "Pill", { treatmentClass: "medicine" }), uncoded(2, "App", { treatmentClass: "digital" }), uncoded(3, "Yoga", { treatmentClass: "lifestyle" }),
      uncoded(4, "Thing", { treatmentClass: "other" }), uncoded(5, "Thing two"), uncoded(6, "Thing two"), uncoded(7, "Pill", { treatmentClass: "medicine" }),
    ])
    expect(classKeys(evidence)).toEqual(["medicine", "digital", "lifestyle", "other"])
    expect(evidence.classes.at(-1)).toMatchObject({ key: "other", label: null, papers: 3 })
  })
  it("keeps an uncoded treatment of kind other under its class", () => {
    const evidence = build([uncoded(1, "Yoga", { kind: "other", treatmentClass: "lifestyle" })])
    expect(evidence.classes[0].treatments[0]).toMatchObject({ key: "name:yoga", name: "Yoga" })
    expect(evidence.research).toEqual([])
  })
})

describe("one class per treatment", () => {
  it("puts one treatment under the class of its earliest-listed finding that has a class", () => {
    const evidence = build([
      uncoded(1, "Exercise", { treatmentClass: "lifestyle", firstListedAt: "2026-10-03T10:00:00.000Z" }),
      uncoded(2, "exercise", { treatmentClass: "digital", firstListedAt: "2026-10-02T10:00:00.000Z" }),
      uncoded(3, "Exercise", { treatmentClass: null, firstListedAt: "2026-09-01T10:00:00.000Z" }),
    ])
    expect(evidence.classes.map((entry) => [entry.key, entry.papers, entry.treatments.length])).toEqual([["digital", 3, 1]])
    expect(evidence.timeline.series.map((entry) => entry.key)).toEqual(["digital"])
  })
  it("takes lifestyle for one finding with no class and one with lifestyle, in either order", () => {
    for (const order of [[1, 2], [2, 1]]) {
      const all = [uncoded(1, "Exercise"), uncoded(2, "Exercise", { treatmentClass: "lifestyle" })]
      const evidence = build(order.map((n) => all[n - 1]))
      expect(evidence.classes.map((entry) => [entry.key, entry.papers])).toEqual([["lifestyle", 2]])
    }
  })
  it("is other when none of its findings has a class", () => {
    expect(classKeys(build([uncoded(1, "Exercise"), uncoded(2, "Exercise")]))).toEqual(["other"])
  })
  it("treats names that differ in spaces and case as one treatment", () => {
    const evidence = build([uncoded(1, "Light  therapy", { treatmentClass: "lifestyle" }), uncoded(2, " light therapy", { treatmentClass: "lifestyle" })])
    expect(evidence.classes[0].treatments).toHaveLength(1)
    expect(evidence.classes[0].treatments[0]).toMatchObject({ key: "name:light therapy", papers: 2 })
  })
  it("shows a code the pack does not know as the code, never as a key", () => {
    const evidence = build([finding(1, { treatment: null, treatmentCode: "abc", text: null })])
    expect(evidence.classes[0].treatments[0]).toMatchObject({ key: "name:abc", name: "abc" })
  })
})

describe("the edges of a period and of new", () => {
  const at = (days: number, period: "3m" | "6m" | "12m") => build([finding(1, { date: daysAgo(days) })], { now: NOW, period }).total
  it("takes a paper exactly 92, 183 and 365 days old, not one day more", () => {
    expect([at(92, "3m"), at(93, "3m"), at(183, "6m"), at(184, "6m"), at(365, "12m"), at(366, "12m")]).toEqual([1, 0, 1, 0, 1, 0])
  })
  it("counts 14 days as new (inclusive) and 15 as not", () => {
    const flag = (days: number) => build([finding(1, { date: daysAgo(days), firstListedAt: "2026-01-01T10:00:00.000Z" })]).classes[0].treatments[0].studies[0].isNew
    expect([flag(14), flag(15)]).toEqual([true, false])
  })
})

describe("the treatments of a class", () => {
  it("are one treatment under two spellings by case, named as the earliest-listed finding wrote it", () => {
    const evidence = build([
      uncoded(1, "exercise", { treatmentClass: "lifestyle", firstListedAt: "2026-10-03T10:00:00.000Z" }),
      uncoded(2, "Exercise", { treatmentClass: "lifestyle", firstListedAt: "2026-10-01T10:00:00.000Z" }),
    ])
    expect(evidence.classes[0].treatments).toHaveLength(1)
    expect(evidence.classes[0].treatments[0]).toMatchObject({ key: "name:exercise", name: "Exercise", papers: 2 })
  })
  it("give did from benefit findings and watch from safety, no-benefit and mixed ones, each with its paper", () => {
    const evidence = build([
      finding(1, { text: "lifted mood", date: "2026-09-01" }), finding(2, { kind: "safety", text: "caused dissociation", date: "2026-09-10" }),
      finding(3, { kind: "no-benefit", text: "did not beat placebo", date: "2026-09-05" }), finding(4, { kind: "mixed", text: "helped some", date: "2026-09-02" }), finding(5, { kind: "other", text: "ignored" }),
    ])
    const ketamine = evidence.classes[0].treatments[0]
    expect(ketamine.did).toEqual([{ text: "lifted mood", key: "pmid:1" }])
    expect(ketamine.watch).toEqual([
      { text: "caused dissociation", key: "pmid:2", kind: "safety" }, { text: "did not beat placebo", key: "pmid:3", kind: "no-benefit" }, { text: "helped some", key: "pmid:4", kind: "mixed" },
    ])
  })
  it("get nothing from a finding with no text, and at most four of each, newest first", () => {
    const evidence = build([
      finding(1, { text: null }), ...[2, 3, 4, 5, 6, 7].map((n) => finding(n, { text: `did ${n}`, date: `2026-09-0${n}` })),
    ])
    const { did } = evidence.classes[0].treatments[0]
    expect(did.map((entry) => entry.key)).toEqual(["pmid:7", "pmid:6", "pmid:5", "pmid:4"])
    expect(evidence.classes[0].treatments[0].papers).toBe(7)
  })
  it("sum, in the counts of a class, to the class", () => {
    const evidence = build([finding(1), finding(2, { kind: "safety" }), finding(3, { treatment: "Clozapine", treatmentCode: "clozapine", kind: null }), finding(4, { treatment: "Clozapine", treatmentCode: "clozapine", kind: "mixed" }), uncoded(5, "Pill", { treatmentClass: "medicine", kind: "no-benefit" })])
    const medicine = evidence.classes.find((entry) => entry.key === "medicine")!
    expect(medicine.counts).toEqual({ benefit: 1, "no-benefit": 1, mixed: 0, safety: 1, other: 0, unsorted: 0 })
    for (const entry of evidence.classes) {
      for (const kind of Object.keys(entry.counts) as Array<keyof typeof entry.counts>) expect(entry.counts[kind]).toBe(entry.treatments.reduce((sum, treatment) => sum + treatment.counts[kind], 0))
      expect(entry.papers).toBe(entry.treatments.reduce((sum, treatment) => sum + treatment.papers, 0))
    }
    expect(evidence.classes.find((entry) => entry.key === "antipsychotic")!.counts).toMatchObject({ unsorted: 1, mixed: 1 })
  })
  it("are ordered by papers then name, the classes by papers then label, other last", () => {
    const evidence = build([
      finding(1), finding(2), uncoded(3, "Zinc", { treatmentClass: "medicine" }), uncoded(4, "Aspirin", { treatmentClass: "medicine" }),
      finding(5, { treatment: "CBT", treatmentCode: "cbt" }), finding(6, { treatment: "ECT", treatmentCode: "ect" }), uncoded(7, "X"), uncoded(8, "X"), uncoded(9, "X"),
    ])
    expect(classKeys(evidence)).toEqual(["medicine", "neuromodulation", "psychotherapy", "other"])
    expect(evidence.classes[0].treatments.map((treatment) => treatment.name)).toEqual(["Ketamine", "Aspirin", "Zinc"])
  })
  it("list their studies newest first", () => {
    const evidence = build([finding(1, { date: "2026-08-01" }), finding(2, { date: "2026-09-15" }), finding(3, { date: "2026-09-01" })])
    expect(evidence.classes[0].treatments[0].studies.map((study) => study.key)).toEqual(["pmid:2", "pmid:3", "pmid:1"])
  })
})

describe("findings with no treatment, and safety findings", () => {
  it("are grouped by research type under Other research, null as other", () => {
    const evidence = build([none(1, { researchType: "prediction" }), none(2, { researchType: "prediction" }), none(3, { researchType: "mechanism" }), none(4), finding(5, { researchType: "risk-factor" })])
    expect(evidence.research.map((group) => [group.type, group.papers, group.studies.map((study) => study.key).sort()])).toEqual([
      ["prediction", 2, ["pmid:1", "pmid:2"]], ["mechanism", 1, ["pmid:3"]], ["other", 1, ["pmid:4"]],
    ])
    // A finding with both a treatment and a research type goes under Treatments.
    expect(evidence.classes[0].treatments[0].studies.map((study) => study.key)).toEqual(["pmid:5"])
  })
  it("lists every safety finding, newest first, and keeps it under its treatment", () => {
    const evidence = build([finding(1, { kind: "safety", date: "2026-09-01" }), none(2, { kind: "safety", date: "2026-09-10" }), finding(3)])
    expect(evidence.safety.map((study) => study.key)).toEqual(["pmid:2", "pmid:1"])
    expect(evidence.classes[0].treatments[0].studies.map((study) => study.key)).toContain("pmid:1")
  })
})

describe("a study", () => {
  it("is labelled from the first author's family name and the year", () => {
    const labelOf = (authors: string[] | undefined, date: string) => build([finding(1, { authors, date })]).classes[0].treatments[0].studies[0].label
    expect(labelOf(["Jane Q. Smith", "Other"], "2026-09-20")).toBe("Smith 2026")
    expect(labelOf(["Smith, Jane"], "2025-01-02")).toBe("Smith 2025")
    expect(labelOf(undefined, "2024-05")).toBe("2024")
    expect(build([finding(1, { date: "" })]).classes[0].treatments[0].studies[0].label).toBeNull()
  })
  it("carries its parts, and whether the paper is saved", () => {
    const study = build([finding(1, { sampleSize: 120 })], { now: NOW, savedSlugs: new Set(["paper-1"]) }).classes[0].treatments[0].studies[0]
    expect(study).toMatchObject({ key: "pmid:1", slug: "paper-1", headline: "Headline 1", venue: "A Journal", date: "2026-09-20", designNamed: true, sampleSize: 120, text: "reduced symptoms", treatment: "Ketamine", saved: true })
  })
})

describe("what is new", () => {
  const isNew = (over: Partial<Finding> & { date?: string; addedDate?: string }) => build([finding(1, { firstListedAt: "2026-01-01T10:00:00.000Z", ...over })]).classes[0].treatments[0].studies[0].isNew
  it("goes by a publication date 10 days ago", () => expect(isNew({ date: daysAgo(10) })).toBe(true))
  it("goes by an entry date 5 days ago when the publication date is 3 months ago", () => expect(isNew({ date: daysAgo(90), addedDate: daysAgo(5) })).toBe(true))
  it("goes by the entry date when the publication month is in the future", () => {
    expect(isNew({ date: "2026-12", addedDate: daysAgo(5) })).toBe(true)
    expect(isNew({ date: "2026-12", addedDate: daysAgo(40) })).toBe(false)
  })
  it("is false at 20 days", () => expect(isNew({ date: daysAgo(20) })).toBe(false))
  it("goes by the day first listed when the paper has neither date", () => {
    expect(isNew({ date: "", firstListedAt: `${daysAgo(3)}T10:00:00.000Z` })).toBe(true)
    expect(isNew({ date: "", firstListedAt: `${daysAgo(30)}T10:00:00.000Z` })).toBe(false)
  })
  it("counts papers in treatments, classes and the condition's follow-up", () => {
    const evidence = build([finding(1, { date: daysAgo(2) }), finding(2, { date: daysAgo(60) })])
    expect([evidence.classes[0].newPapers, evidence.classes[0].treatments[0].newPapers]).toEqual([1, 1])
    expect(followedConditions([finding(1, { date: daysAgo(2) }), finding(2, { date: daysAgo(60) })], TAXONOMY, [], NOW)[0].recent).toBe(1)
  })
})

describe("the period", () => {
  const spread = [finding(1, { date: daysAgo(10) }), finding(2, { date: daysAgo(120) }), finding(3, { date: daysAgo(200) }), finding(4, { date: daysAgo(400) }), finding(5, { date: "2026-12" })]
  it("leaves out a paper 4 months old in 3m while collected still counts it", () => {
    const evidence = build(spread, { now: NOW, period: "3m" })
    expect(evidence.period).toBe("3m")
    expect(evidence.total).toBe(2)
    expect(evidence.collected).toBe(5)
    expect(evidence.classes[0].treatments[0].studies.map((study) => study.key).sort()).toEqual(["pmid:1", "pmid:5"])
  })
  it("takes 6 months as 183 days and 12 months as 365, and everything for all", () => {
    expect(build(spread, { now: NOW, period: "6m" }).total).toBe(3)
    expect(build(spread, { now: NOW, period: "12m" }).total).toBe(4)
    expect(build(spread, { now: NOW, period: "all" }).total).toBe(5)
    expect(build(spread).period).toBe("all")
  })
  it("draws the timeline, safety and research of the period only", () => {
    const evidence = build([none(1, { date: daysAgo(10) }), none(2, { date: daysAgo(300) }), finding(3, { kind: "safety", date: daysAgo(300) })], { now: NOW, period: "3m" })
    expect(evidence.research.flatMap((group) => group.studies.map((study) => study.key))).toEqual(["pmid:1"])
    expect(evidence.safety).toEqual([])
    expect(evidence.timeline.series.flatMap((entry) => entry.counts).reduce((sum, count) => sum + count, 0)).toBe(1)
  })
  it("gives since as the earliest first-listed day of all the condition's findings, whatever the period", () => {
    const evidence = build([finding(1, { date: daysAgo(10), firstListedAt: "2026-10-01T10:00:00.000Z" }), finding(2, { date: daysAgo(400), firstListedAt: "2026-05-04T09:00:00.000Z" })], { now: NOW, period: "3m" })
    expect(evidence.since).toBe("2026-05-04")
    expect(build([], { now: NOW }).since).toBeNull()
  })
})

describe("the timeline and the condition", () => {
  it("draws a series per class (top five), then the rest, over twelve months", () => {
    const evidence = build([finding(1), finding(2, { treatment: "Clozapine", treatmentCode: "clozapine" }), none(3), uncoded(4, "Thing")])
    expect(evidence.timeline.months).toHaveLength(12)
    expect(evidence.timeline.months.at(-1)).toBe("2026-10")
    expect(evidence.timeline.series.map((entry) => entry.key)).toEqual(["antipsychotic", "medicine", "other"])
    expect(evidence.timeline.series[0].label).toBe("Antipsychotics")
    expect(evidence.timeline.series.flatMap((entry) => entry.counts).reduce((sum, count) => sum + count, 0)).toBe(4)
  })
  it("knows no condition the pack does not have, and counts the subtypes", () => {
    expect(buildConditionEvidence([finding(1)], TAXONOMY, "nothing", { now: NOW })).toBeNull()
    expect(buildConditionEvidence([finding(1)], TAXONOMY, "ketamine", { now: NOW })).toBeNull()
    const evidence = build([finding(1, { conditionCodes: ["trd"] }), finding(2, { conditionCodes: ["schizophrenia"] })])
    expect(evidence.total).toBe(1)
    expect(evidence.condition).toEqual({ code: "depression", name: "Major depressive disorder" })
  })
})

describe("the conditions the reader follows", () => {
  it("lists watched conditions and conditions with findings, the ones with new papers first, the three biggest classes by label", () => {
    const list = followedConditions([
      finding(1, { date: daysAgo(2) }), finding(2, { treatment: "Clozapine", treatmentCode: "clozapine" }), finding(3, { treatment: "Clozapine", treatmentCode: "clozapine" }),
      uncoded(4, "Yoga", { treatmentClass: "lifestyle" }), uncoded(5, "Thing"), finding(6, { treatment: "CBT", treatmentCode: "cbt" }),
      finding(7, { conditionCodes: ["schizophrenia"], date: daysAgo(100) }),
    ], TAXONOMY, ["trd"], NOW)
    expect(list.map((entry) => [entry.code, entry.total, entry.recent])).toEqual([["depression", 6, 1], ["schizophrenia", 1, 0], ["trd", 0, 0]])
    expect(list[0].treatments).toEqual([{ key: "antipsychotic", label: "Antipsychotics" }, { key: "lifestyle", label: null }, { key: "medicine", label: null }])
    expect(list[2].treatments).toEqual([])
  })
})
