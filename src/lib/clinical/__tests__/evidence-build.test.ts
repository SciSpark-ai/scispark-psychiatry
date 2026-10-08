// src/lib/clinical/__tests__/evidence-build.test.ts
import { describe, expect, it } from "vitest"
import { TaxonomySchema } from "../pack/schema"
import type { Finding } from "../evidence/schema"
import { buildConditionEvidence, followedConditions } from "../evidence/build"
import { loadPsychiatryPack } from "../pack/load"
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
  { id: "paliperidone", type: "treatment", name: "Paliperidone", modality: "drug", parents: ["antipsychotic"] },
  { id: "olanzapine", type: "treatment", name: "Olanzapine", modality: "drug", parents: ["antipsychotic"] },
  { id: "risperidone", type: "treatment", name: "Risperidone", modality: "drug", parents: ["antipsychotic"] },
  { id: "methylphenidate", type: "treatment", name: "Methylphenidate", modality: "drug" },
  { id: "cognitive-remediation", type: "treatment", name: "Cognitive remediation", modality: "psychotherapy", parents: ["psychotherapy"] },
  { id: "psychotherapy", type: "treatment", name: "Psychotherapy", modality: "psychotherapy" },
  { id: "cbt", type: "treatment", name: "Cognitive behavioral therapy", modality: "psychotherapy", parents: ["psychotherapy"] },
  { id: "neuromodulation", type: "treatment", name: "Neuromodulation", modality: "neuromodulation" },
  { id: "rtms", type: "treatment", name: "rTMS", modality: "neuromodulation", parents: ["neuromodulation"] },
  { id: "ect", type: "treatment", name: "Electroconvulsive therapy", modality: "neuromodulation" },
  { id: "lightbox", type: "treatment", name: "Bright light", modality: "other" },
  { id: "exercise", type: "treatment", name: "Exercise", modality: "other" },
  { id: "light-therapy", type: "treatment", name: "Light therapy", modality: "other" },
  { id: "digital-interventions", type: "treatment", name: "Digital interventions", modality: "other" },
  { id: "mdma-assisted-therapy", type: "treatment", name: "MDMA-assisted therapy", modality: "other" },
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
  it("has no class for an uncoded treatment whose only paper reports no efficacy result", () => {
    const evidence = build([uncoded(1, "Yoga", { kind: "other", treatmentClass: "lifestyle" })])
    expect(evidence.classes).toEqual([])
    expect(evidence.research.map((group) => [group.type, group.studies.map((study) => study.treatment)])).toEqual([["no-efficacy", ["Yoga"]]])
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
    expect(classKeys(build([uncoded(1, "Yoga"), uncoded(2, "Yoga")]))).toEqual(["other"])
  })
  it("treats names that differ in spaces and case as one treatment", () => {
    const evidence = build([uncoded(1, "Forest  bathing", { treatmentClass: "lifestyle" }), uncoded(2, " forest bathing", { treatmentClass: "lifestyle" })])
    expect(evidence.classes[0].treatments).toHaveLength(1)
    expect(evidence.classes[0].treatments[0]).toMatchObject({ key: "name:forest bathing", papers: 2 })
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
      uncoded(1, "yoga", { treatmentClass: "lifestyle", firstListedAt: "2026-10-03T10:00:00.000Z" }),
      uncoded(2, "Yoga", { treatmentClass: "lifestyle", firstListedAt: "2026-10-01T10:00:00.000Z" }),
    ])
    expect(evidence.classes[0].treatments).toHaveLength(1)
    expect(evidence.classes[0].treatments[0]).toMatchObject({ key: "name:yoga", name: "Yoga", papers: 2 })
  })
  it("give one line per paper under its kind, each with its paper, and the safety lines from the safety papers of the same treatment", () => {
    const evidence = build([
      finding(1, { text: "lifted mood", date: "2026-09-01" }), finding(2, { kind: "safety", text: "caused dissociation", date: "2026-09-10" }),
      finding(3, { kind: "no-benefit", text: "did not beat placebo", date: "2026-09-05" }), finding(4, { kind: "mixed", text: "helped some", date: "2026-09-02" }), finding(5, { kind: "other", text: "ignored" }),
      finding(6, { kind: "safety", text: "raised agranulocytosis risk", treatment: "Clozapine", treatmentCode: "clozapine" }),
    ])
    expect(evidence.classes[0].treatments[0].lines).toEqual({
      benefit: [{ text: "lifted mood", key: "pmid:1" }], "no-benefit": [{ text: "did not beat placebo", key: "pmid:3" }],
      mixed: [{ text: "helped some", key: "pmid:4" }], safety: [{ text: "caused dissociation", key: "pmid:2" }],
    })
  })
  it("get no line from a finding with no text, and at most four of each kind, newest first", () => {
    const six = (kind: Finding["kind"], from: number) => [0, 1, 2, 3, 4, 5].map((at) => finding(from + at, { kind, text: `did ${from + at}`, date: `2026-09-0${at + 2}` }))
    const evidence = build([finding(1, { text: null }), finding(2, { text: "  " }), ...six("benefit", 10), ...six("no-benefit", 20), ...six("mixed", 30), ...six("safety", 40)])
    const ketamine = evidence.classes[0].treatments[0]
    expect(ketamine.lines.benefit.map((entry) => entry.key)).toEqual(["pmid:15", "pmid:14", "pmid:13", "pmid:12"])
    expect(ketamine.lines["no-benefit"].map((entry) => entry.key)).toEqual(["pmid:25", "pmid:24", "pmid:23", "pmid:22"])
    expect(ketamine.lines.mixed.map((entry) => entry.key)).toEqual(["pmid:35", "pmid:34", "pmid:33", "pmid:32"])
    expect(ketamine.lines.safety.map((entry) => entry.key)).toEqual(["pmid:45", "pmid:44", "pmid:43", "pmid:42"])
    expect([ketamine.papers, ketamine.safetyPapers]).toEqual([20, 6])
  })
  it("count each of their efficacy papers once, as the class does: the same sums while no paper names two treatments", () => {
    const evidence = build([finding(1), finding(2, { kind: "safety" }), finding(3, { treatment: "Clozapine", treatmentCode: "clozapine", kind: null }), finding(4, { treatment: "Clozapine", treatmentCode: "clozapine", kind: "mixed" }), uncoded(5, "Pill", { treatmentClass: "medicine", kind: "no-benefit" })])
    const medicine = evidence.classes.find((entry) => entry.key === "medicine")!
    expect([medicine.papers, medicine.efficacy]).toEqual([2, { benefit: 1, "no-benefit": 1, mixed: 0 }])
    for (const entry of evidence.classes) {
      for (const kind of ["benefit", "no-benefit", "mixed"] as const) expect(entry.efficacy[kind]).toBe(entry.treatments.reduce((sum, treatment) => sum + treatment.efficacy[kind], 0))
      expect(entry.papers).toBe(entry.treatments.reduce((sum, treatment) => sum + treatment.papers, 0))
      expect(entry.papers).toBe(entry.efficacy.benefit + entry.efficacy["no-benefit"] + entry.efficacy.mixed)
    }
    expect(evidence.classes.find((entry) => entry.key === "antipsychotic")).toMatchObject({ papers: 1, efficacy: { benefit: 0, "no-benefit": 0, mixed: 1 } })
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

// Owner decision 2026-10-08: a treatment is found by its words, and a paper counts under each treatment it names.
describe("a paper that names several treatments", () => {
  const three = (n: number, over: Partial<Finding> & { date?: string } = {}) => finding(n, { treatment: "clozapine, paliperidone, and olanzapine", treatmentCode: null, treatmentClass: "medicine", ...over })
  it("is under each of three antipsychotics with 1 paper each, and adds 1 to their class", () => {
    const evidence = build([three(1, { kind: "mixed", text: "eased symptoms but not relapse", date: daysAgo(3) })])
    expect(evidence.classes).toHaveLength(1)
    const [cls] = evidence.classes
    expect(cls).toMatchObject({ key: "antipsychotic", label: "Antipsychotics", papers: 1, newPapers: 1 })
    expect(cls.efficacy).toEqual({ benefit: 0, "no-benefit": 0, mixed: 1 })
    expect(cls.treatments.map((treatment) => [treatment.key, treatment.name, treatment.papers, treatment.newPapers, treatment.efficacy.mixed])).toEqual([
      ["clozapine", "Clozapine", 1, 1, 1], ["olanzapine", "Olanzapine", 1, 1, 1], ["paliperidone", "Paliperidone", 1, 1, 1],
    ])
    for (const treatment of cls.treatments) {
      expect(treatment.studies.map((study) => [study.key, study.treatment, study.severalTreatments])).toEqual([["pmid:1", "clozapine, paliperidone, and olanzapine", true]])
      expect(treatment.lines.mixed).toEqual([{ text: "eased symptoms but not relapse", key: "pmid:1" }])
    }
    expect([evidence.total, evidence.sections]).toEqual([1, { treatments: 1, safety: 0, research: 0 }])
  })
  it("counts the distinct papers of a class, not the sum of its treatments", () => {
    const evidence = build([three(1), finding(2, { treatment: "Clozapine", treatmentCode: "clozapine", kind: "no-benefit" }), finding(3, { treatment: "olanzapine", treatmentCode: null, date: daysAgo(2) })])
    const [cls] = evidence.classes
    expect([cls.papers, cls.newPapers]).toEqual([3, 1])
    expect(cls.efficacy).toEqual({ benefit: 2, "no-benefit": 1, mixed: 0 })
    expect(cls.treatments.map((treatment) => [treatment.key, treatment.papers])).toEqual([["clozapine", 2], ["olanzapine", 2], ["paliperidone", 1]])
    expect(cls.treatments.reduce((sum, treatment) => sum + treatment.papers, 0)).toBe(5)
  })
  it("adds 1 to each of two classes and 1 to the total", () => {
    const evidence = build([finding(1, { treatment: "methylphenidate and risperidone", treatmentCode: null, treatmentClass: "medicine" }), none(2)])
    expect(evidence.classes.map((entry) => [entry.key, entry.papers, entry.treatments.map((treatment) => [treatment.key, treatment.papers])])).toEqual([
      ["antipsychotic", 1, [["risperidone", 1]]], ["medicine", 1, [["methylphenidate", 1]]],
    ])
    expect(evidence.total).toBe(2)
    expect(evidence.sections).toEqual({ treatments: 1, safety: 0, research: 1 })
  })
  it("gives the total of the treatments tab as distinct papers", () => {
    const evidence = build([three(1), finding(2, { treatment: "methylphenidate and risperidone", treatmentCode: null }), finding(3), none(4), uncoded(5, "Yoga")])
    expect(evidence.classes.reduce((sum, entry) => sum + entry.papers, 0)).toBe(5)
    expect(evidence.sections.treatments).toBe(4)
    expect(evidence.total).toBe(5)
  })
  it("does not give a pack treatment the one class the paper named for all of them", () => {
    const evidence = build([finding(1, { treatment: "cognitive remediation and exercise", treatmentCode: null, treatmentClass: "psychosocial" })])
    expect(evidence.classes.map((entry) => [entry.key, entry.treatments.map((treatment) => treatment.key)])).toEqual([["lifestyle", ["exercise"]], ["psychotherapy", ["cognitive-remediation"]]])
  })
  it("draws the paper once in each class it is under, and in the rest only when none of its classes is drawn", () => {
    const evidence = build([finding(1, { treatment: "methylphenidate and risperidone", treatmentCode: null })])
    expect(evidence.timeline.series.map((entry) => [entry.key, entry.counts.reduce((sum, count) => sum + count, 0)])).toEqual([["antipsychotic", 1], ["medicine", 1]])
  })
  it("is in the safety group of each of three antipsychotics when it is a safety paper, and counted once in the section", () => {
    const evidence = build([three(1, { kind: "safety" })])
    expect(evidence.safety.map((group) => [group.key, group.name, group.classKey, group.papers, group.studies.map((study) => [study.key, study.severalTreatments])])).toEqual([
      ["clozapine", "Clozapine", "antipsychotic", 1, [["pmid:1", true]]], ["olanzapine", "Olanzapine", "antipsychotic", 1, [["pmid:1", true]]], ["paliperidone", "Paliperidone", "antipsychotic", 1, [["pmid:1", true]]],
    ])
    expect(evidence.sections).toEqual({ treatments: 0, safety: 1, research: 0 })
    expect([evidence.total, evidence.classes]).toEqual([1, []])
  })
  it("is once in the no-efficacy group when it reports no efficacy result, and marks each treatment it names", () => {
    const evidence = build([three(1, { kind: "other" }), finding(2, { treatment: "Clozapine", treatmentCode: "clozapine" })])
    expect(evidence.research.map((group) => [group.type, group.papers, group.studies.map((study) => [study.key, study.treatment, study.severalTreatments])])).toEqual([
      ["no-efficacy", 1, [["pmid:1", "clozapine, paliperidone, and olanzapine", true]]],
    ])
    expect(evidence.classes[0].treatments.map((treatment) => [treatment.key, treatment.papers, treatment.unreportedPapers])).toEqual([["clozapine", 1, 1]])
    expect(evidence.sections).toEqual({ treatments: 1, safety: 0, research: 1 })
  })
})

describe("the treatment of a finding", () => {
  it("is found in its words when it was stored without a code, and marks nothing when it names one", () => {
    const evidence = build([finding(1, { treatment: "low-dose antipsychotics", treatmentCode: null }), finding(2, { treatment: "Clozapine", treatmentCode: null })])
    expect(evidence.classes.map((entry) => [entry.key, entry.treatments.map((treatment) => [treatment.key, treatment.name])])).toEqual([["antipsychotic", [["antipsychotic", "Antipsychotics"], ["clozapine", "Clozapine"]]]])
    const [study] = evidence.classes[0].treatments[0].studies
    expect([study.treatment, study.severalTreatments]).toEqual(["low-dose antipsychotics", false])
  })
  it("goes by its words before the stored code", () => {
    expect(build([finding(1, { treatment: "Clozapine", treatmentCode: "ketamine" })]).classes[0].treatments.map((treatment) => treatment.key)).toEqual(["clozapine"])
  })
  it("is the stored code when its words name no pack treatment", () => {
    const evidence = build([finding(1, { treatment: "the talking cure", treatmentCode: "cbt" })])
    expect(evidence.classes[0].treatments.map((treatment) => [treatment.key, treatment.name])).toEqual([["cbt", "Cognitive behavioral therapy"]])
    expect(evidence.classes[0].treatments[0].studies[0].treatment).toBe("the talking cure")
  })
  it("is keyed by its name when there is neither", () => {
    const evidence = build([uncoded(1, "Yoga  nidra"), uncoded(2, "yoga nidra")])
    expect(evidence.classes[0].treatments.map((treatment) => [treatment.key, treatment.name, treatment.papers])).toEqual([["name:yoga nidra", "Yoga  nidra".trim(), 2]])
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
  it("puts a safety finding with no treatment under Other research, other", () => {
    const evidence = build([none(2, { kind: "safety", date: "2026-09-10" }), finding(3)])
    expect(evidence.safety).toEqual([])
    expect(evidence.research.map((group) => [group.type, group.studies.map((study) => study.key)])).toEqual([["other", ["pmid:2"]]])
    expect(evidence.sections).toEqual({ treatments: 1, safety: 0, research: 1 })
  })
})

// Owner decision 2026-10-08: efficacy only in a treatment's bubble; safety and the papers with no efficacy result apart.
describe("the section of a finding", () => {
  const clozapine = (n: number, over: Partial<Finding> & { date?: string } = {}) => finding(n, { treatment: "Clozapine", treatmentCode: "clozapine", ...over })
  it("is Treatments for a benefit, a no-benefit and a mixed finding", () => {
    const evidence = build([finding(1), finding(2, { kind: "no-benefit" }), finding(3, { kind: "mixed" })])
    expect(evidence.classes[0].treatments[0]).toMatchObject({ key: "ketamine", papers: 3, efficacy: { benefit: 1, "no-benefit": 1, mixed: 1 }, safetyPapers: 0, unreportedPapers: 0 })
    expect(evidence.classes[0].treatments[0].studies.map((study) => study.kind).sort()).toEqual(["benefit", "mixed", "no-benefit"])
    expect([evidence.safety, evidence.research]).toEqual([[], []])
    expect(evidence.sections).toEqual({ treatments: 3, safety: 0, research: 0 })
  })
  it("is Safety, in the group of its treatment, for a safety finding", () => {
    const evidence = build([finding(1, { kind: "safety", date: daysAgo(3) }), finding(2, { kind: "safety", date: "2026-08-01" })])
    expect(evidence.safety).toHaveLength(1)
    expect(evidence.safety[0]).toMatchObject({ key: "ketamine", name: "Ketamine", classKey: "medicine", papers: 2, newPapers: 1 })
    expect(evidence.safety[0].studies.map((study) => study.key)).toEqual(["pmid:1", "pmid:2"])
    expect([evidence.classes, evidence.research]).toEqual([[], []])
  })
  it("is Other research, in the one no-efficacy group, for a treatment finding of kind other or of no kind", () => {
    const evidence = build([finding(1, { kind: "other", date: "2026-09-02" }), clozapine(2, { kind: null, date: "2026-09-12" }), none(3, { researchType: "mechanism" })])
    expect(evidence.research.map((group) => [group.type, group.papers, group.studies.map((study) => [study.key, study.treatment])])).toEqual([
      ["no-efficacy", 2, [["pmid:2", "Clozapine"], ["pmid:1", "Ketamine"]]], ["mechanism", 1, [["pmid:3", null]]],
    ])
    expect([evidence.classes, evidence.safety]).toEqual([[], []])
    expect(evidence.sections).toEqual({ treatments: 0, safety: 0, research: 3 })
  })
  it("gives a treatment with one benefit, one safety and one other paper a bubble of 1 with a mark for each of the others", () => {
    const evidence = build([finding(1), finding(2, { kind: "safety" }), finding(3, { kind: "other" })])
    expect(evidence.classes).toHaveLength(1)
    expect(evidence.classes[0]).toMatchObject({ key: "medicine", papers: 1, efficacy: { benefit: 1, "no-benefit": 0, mixed: 0 } })
    const ketamine = evidence.classes[0].treatments[0]
    expect(ketamine).toMatchObject({ papers: 1, safetyPapers: 1, unreportedPapers: 1 })
    expect(ketamine.studies.map((study) => study.key)).toEqual(["pmid:1"])
    expect(evidence.safety.map((group) => [group.key, group.studies.map((study) => study.key)])).toEqual([["ketamine", ["pmid:2"]]])
    expect(evidence.research.map((group) => [group.type, group.studies.map((study) => study.key)])).toEqual([["no-efficacy", ["pmid:3"]]])
    expect([evidence.total, evidence.sections]).toEqual([3, { treatments: 1, safety: 1, research: 1 }])
  })
  it("gives a treatment with only a safety paper no class bubble and one safety group", () => {
    const evidence = build([clozapine(1, { kind: "safety" }), finding(2)])
    expect(classKeys(evidence)).toEqual(["medicine"])
    expect(evidence.safety.map((group) => [group.key, group.classKey, group.papers])).toEqual([["clozapine", "antipsychotic", 1]])
  })
  it("gives a treatment with only a paper of kind other the no-efficacy group only", () => {
    const evidence = build([clozapine(1, { kind: "other" })])
    expect([evidence.classes, evidence.safety]).toEqual([[], []])
    expect(evidence.research.map((group) => group.type)).toEqual(["no-efficacy"])
  })
  it("gives a safety group the class of its treatment by the same rules as a bubble", () => {
    const evidence = build([uncoded(1, "Yoga", { kind: "safety" }), uncoded(2, "Yoga", { treatmentClass: "lifestyle", kind: "other" }), finding(3, { treatment: "exercise", treatmentCode: "exercise", kind: "safety" }), uncoded(4, "Thing", { kind: "safety" })])
    expect(evidence.safety.map((group) => [group.key, group.name, group.classKey])).toEqual([["exercise", "Exercise", "lifestyle"], ["name:thing", "Thing", "other"], ["name:yoga", "Yoga", "lifestyle"]])
  })
  it("orders the safety groups by papers then name", () => {
    const evidence = build([finding(1, { kind: "safety" }), clozapine(2, { kind: "safety" }), clozapine(3, { kind: "safety" }), uncoded(4, "Aspirin", { kind: "safety" })])
    expect(evidence.safety.map((group) => [group.name, group.papers])).toEqual([["Clozapine", 2], ["Aspirin", 1], ["Ketamine", 1]])
  })
  it("counts the distinct efficacy papers of a class, its directions and what is new", () => {
    const two = (n: number, over: Partial<Finding> & { date?: string } = {}) => finding(n, { treatment: "clozapine and olanzapine", treatmentCode: null, ...over })
    const evidence = build([two(1, { kind: "mixed", date: daysAgo(2) }), two(2, { kind: "safety", date: daysAgo(2) }), two(3, { kind: "other", date: daysAgo(2) }), clozapine(4, { kind: "no-benefit", date: "2026-08-01" })])
    const [cls] = evidence.classes
    expect(cls).toMatchObject({ key: "antipsychotic", papers: 2, newPapers: 1, efficacy: { benefit: 0, "no-benefit": 1, mixed: 1 } })
    expect(cls.treatments.map((treatment) => [treatment.key, treatment.papers, treatment.newPapers, treatment.safetyPapers, treatment.unreportedPapers])).toEqual([["clozapine", 2, 1, 1, 1], ["olanzapine", 1, 1, 1, 1]])
    expect(evidence.sections).toEqual({ treatments: 2, safety: 1, research: 1 })
    expect(evidence.total).toBe(4)
  })
  it("orders the research groups by papers, then by the list of types with no-efficacy before other", () => {
    const evidence = build([
      none(1), finding(2, { kind: "other" }), none(3, { researchType: "services" }), none(4, { researchType: "risk-factor" }),
      none(5, { researchType: "epidemiology" }), none(6, { researchType: "epidemiology" }), none(7, { researchType: "mechanism" }), none(8, { researchType: "prediction" }),
    ])
    expect(evidence.research.map((group) => group.type)).toEqual(["epidemiology", "risk-factor", "prediction", "mechanism", "services", "no-efficacy", "other"])
  })
  it("counts what is new in a research group", () => {
    const evidence = build([finding(1, { kind: "other", date: daysAgo(2) }), finding(2, { kind: null, date: "2026-08-01" })])
    expect(evidence.research.map((group) => [group.type, group.papers, group.newPapers])).toEqual([["no-efficacy", 2, 1]])
  })
})

describe("the tier of a study's design", () => {
  it("is synthesis for a review of trials or a guideline, trial for a trial, observational for everything else", () => {
    const tierOf = (design: Finding["design"]) => build([finding(1, { design })]).classes[0].treatments[0].studies[0].tier
    expect((["systematic-review", "meta-analysis", "guideline"] as const).map(tierOf)).toEqual(["synthesis", "synthesis", "synthesis"])
    expect((["randomized-trial", "clinical-trial"] as const).map(tierOf)).toEqual(["trial", "trial"])
    for (const design of ["cohort", "review", "case-report", "editorial", "erratum", "retraction", "protocol", "preclinical", "other", "unknown"] as const) expect(tierOf(design), design).toBe("observational")
  })
})

describe("the scope", () => {
  const findings = [finding(1, { date: daysAgo(10) }), finding(2, { kind: "safety", date: daysAgo(10) }), finding(3, { date: daysAgo(300) }), none(4, { date: daysAgo(10) }), finding(5, { conditionCodes: ["schizophrenia"] })]
  const saved = new Set(["paper-1", "paper-3", "paper-5"])
  it("is all unless it is asked for, and says how many of the condition's papers are saved", () => {
    const evidence = build(findings, { now: NOW, savedSlugs: saved })
    expect([evidence.scope, evidence.total, evidence.collected, evidence.savedCount]).toEqual(["all", 4, 4, 2])
    expect(build(findings).savedCount).toBe(0)
  })
  it("keeps only the saved papers when it is saved, while collected still counts all of them", () => {
    const evidence = build(findings, { now: NOW, savedSlugs: saved, scope: "saved" })
    expect([evidence.scope, evidence.total, evidence.collected, evidence.savedCount]).toEqual(["saved", 2, 4, 2])
    expect(evidence.classes[0].treatments[0]).toMatchObject({ papers: 2, safetyPapers: 0 })
    expect([evidence.safety, evidence.research]).toEqual([[], []])
    expect(evidence.sections).toEqual({ treatments: 2, safety: 0, research: 0 })
    expect(evidence.timeline.series.flatMap((entry) => entry.counts).reduce((sum, count) => sum + count, 0)).toBe(2)
  })
  it("is empty when nothing is saved, and still says what is collected", () => {
    for (const savedSlugs of [undefined, new Set<string>(), new Set(["paper-5"])]) {
      const evidence = build(findings, { now: NOW, savedSlugs, scope: "saved" })
      expect([evidence.total, evidence.collected, evidence.savedCount, evidence.classes, evidence.safety, evidence.research]).toEqual([0, 4, 0, [], [], []])
      expect(evidence.since).toBe("2026-10-01")
    }
  })
  it("is applied before the period", () => {
    const evidence = build(findings, { now: NOW, savedSlugs: saved, scope: "saved", period: "3m" })
    expect([evidence.period, evidence.scope, evidence.total, evidence.collected, evidence.savedCount]).toEqual(["3m", "saved", 1, 4, 2])
    expect(evidence.classes[0].treatments[0].studies.map((study) => study.key)).toEqual(["pmid:1"])
  })
  it("does not change the class of a treatment whose class comes from a paper outside it", () => {
    const yoga = [uncoded(1, "Yoga"), uncoded(2, "Yoga", { treatmentClass: "lifestyle" })]
    expect(build(yoga, { now: NOW, savedSlugs: new Set(["paper-1"]), scope: "saved" }).classes.map((entry) => [entry.key, entry.papers])).toEqual([["lifestyle", 1]])
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
    const study = build([finding(1, { sampleSize: 120, takeaway: "Ketamine helped 120 adults." })], { now: NOW, savedSlugs: new Set(["paper-1"]) }).classes[0].treatments[0].studies[0]
    expect(study).toMatchObject({ key: "pmid:1", slug: "paper-1", headline: "Headline 1", venue: "A Journal", date: "2026-09-20", designNamed: true, sampleSize: 120, text: "reduced symptoms", treatment: "Ketamine", saved: true })
  })
  // Final review I1: a size stored before the check is not shown unless the paper ties it to people.
  it("shows a stored sample size only when the paper's title, abstract, headline or takeaway ties it to people", () => {
    const sizeOf = (over: Partial<Finding>, abstract?: string) => {
      const base = finding(1, over)
      return build([abstract === undefined ? base : { ...base, paper: { ...base.paper, abstract } }]).classes[0].treatments[0].studies[0].sampleSize
    }
    expect(sizeOf({ sampleSize: 2019 }, "Adults were recruited between 2019 and 2021.")).toBeNull()
    expect(sizeOf({ sampleSize: 12 }, "Adults were followed for 12 weeks.")).toBeNull()
    expect(sizeOf({ sampleSize: 52 }, "We pooled 52 studies (2856 participants).")).toBeNull()
    expect(sizeOf({ sampleSize: 2856 }, "We pooled 52 studies (2856 participants).")).toBe(2856)
    expect(sizeOf({ sampleSize: 180 }, "We enrolled 180 treatment-resistant patients.")).toBe(180)
    expect(sizeOf({ sampleSize: 42, headline: "Ketamine in depression (n = 42)" })).toBe(42)
    expect(sizeOf({ sampleSize: 120 })).toBeNull()
    expect(sizeOf({ sampleSize: null }, "n = 42")).toBeNull()
  })
})

describe("what the period does not change", () => {
  // Final review M1.
  it("keeps the class of an uncoded treatment when the finding that gives it is outside the period", () => {
    const findings = [uncoded(1, "Yoga", { date: daysAgo(10) }), uncoded(2, "Yoga", { treatmentClass: "lifestyle", date: daysAgo(300) })]
    expect(build(findings).classes.map((entry) => [entry.key, entry.papers])).toEqual([["lifestyle", 2]])
    expect(build(findings, { now: NOW, period: "3m" }).classes.map((entry) => [entry.key, entry.papers])).toEqual([["lifestyle", 1]])
  })
  it("keeps the spelling of an uncoded treatment when its earliest-listed finding is outside the period", () => {
    const findings = [
      uncoded(1, "tai chi training", { date: daysAgo(10), firstListedAt: "2026-10-03T10:00:00.000Z" }),
      uncoded(2, "Tai Chi Training", { date: daysAgo(300), firstListedAt: "2026-01-03T10:00:00.000Z" }),
    ]
    for (const period of ["all", "3m"] as const) expect(build(findings, { now: NOW, period }).classes[0].treatments[0].name).toBe("Tai Chi Training")
  })
})

describe("a pack treatment of no modality the pack names", () => {
  // Final review M2.
  const node = (n: number, id: string, over: Partial<Finding> = {}) => finding(n, { treatment: id, treatmentCode: id, ...over })
  it("takes a class by its id when no finding gives one", () => {
    const evidence = build([node(1, "exercise"), node(2, "light-therapy"), node(3, "digital-interventions"), node(4, "mdma-assisted-therapy"), node(5, "lightbox")])
    expect(evidence.classes.map((entry) => [entry.key, entry.treatments.map((treatment) => treatment.key).sort()])).toEqual([
      ["lifestyle", ["exercise", "light-therapy"]], ["digital", ["digital-interventions"]], ["medicine", ["mdma-assisted-therapy"]], ["other", ["lightbox"]],
    ])
  })
  it("takes the class of its findings before the one of its id", () => {
    expect(classKeys(build([node(1, "exercise"), node(2, "exercise", { treatmentClass: "digital" })]))).toEqual(["digital"])
  })
})

describe("a paper filed under both a treatment and a type of research", () => {
  // Final review I3: the five stored before the store kept them apart.
  it("goes to Other research when it has a type of research, no class and no code", () => {
    const evidence = build([uncoded(1, "sleep", { researchType: "risk-factor" }), uncoded(2, "sleep", { researchType: "risk-factor", treatmentClass: "lifestyle" }), finding(3, { researchType: "mechanism" })])
    expect(evidence.research.map((group) => [group.type, group.studies.map((study) => study.key)])).toEqual([["risk-factor", ["pmid:1"]]])
    expect(evidence.classes.map((entry) => [entry.key, entry.papers])).toEqual([["lifestyle", 1], ["medicine", 1]])
  })
})

describe("a publication date that is only a year", () => {
  // Final review M3. NOW is 2026-10-07: the 12-month cutoff is in 2025, the 3-month one in 2026.
  const yearOnly = (year: string) => [finding(1, { date: year, addedDate: daysAgo(5) })]
  it("is outside a period when the year is before the year of the cutoff", () => {
    expect(build(yearOnly("2024"), { now: NOW, period: "12m" }).total).toBe(0)
    expect(build(yearOnly("2025"), { now: NOW, period: "3m" }).total).toBe(0)
    expect(build(yearOnly("2024"), { now: NOW, period: "all" }).total).toBe(1)
  })
  it("goes by the day it entered PubMed, as before, when the year is the cutoff's or later", () => {
    expect(build(yearOnly("2025"), { now: NOW, period: "12m" }).total).toBe(1)
    expect(build(yearOnly("2026"), { now: NOW, period: "3m" }).total).toBe(1)
    expect(build([finding(1, { date: "2026", addedDate: daysAgo(200) })], { now: NOW, period: "3m" }).total).toBe(0)
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
  it("draws every paper that names a treatment in its class, whatever its kind, and the others in the rest", () => {
    const clozapine = (n: number, kind: Finding["kind"]) => finding(n, { treatment: "Clozapine", treatmentCode: "clozapine", kind })
    const evidence = build([clozapine(1, "safety"), clozapine(2, "other"), clozapine(3, null), finding(4), none(5)])
    expect(evidence.timeline.series.map((entry) => [entry.key, entry.label, entry.counts.reduce((sum, count) => sum + count, 0)])).toEqual([["antipsychotic", "Antipsychotics", 3], ["medicine", null, 1], ["other", null, 1]])
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
  it("names the three largest classes by their efficacy papers", () => {
    const clozapine = (n: number, kind: Finding["kind"]) => finding(n, { treatment: "Clozapine", treatmentCode: "clozapine", kind })
    const list = followedConditions([clozapine(1, "safety"), clozapine(2, "safety"), clozapine(3, "other"), finding(4), finding(5, { treatment: "CBT", treatmentCode: "cbt" }), finding(6, { treatment: "CBT", treatmentCode: "cbt" })], TAXONOMY, [], NOW)
    expect(list[0]).toMatchObject({ code: "depression", total: 6 })
    expect(list[0].treatments).toEqual([{ key: "psychotherapy", label: "Psychotherapy" }, { key: "medicine", label: null }])
  })
})

describe("the treatments added to the pack", () => {
  it("puts omega-3 and probiotics under lifestyle and trazodone under Antidepressants", async () => {
    const { taxonomy } = await loadPsychiatryPack()
    const evidence = buildConditionEvidence([
      uncoded(1, "omega-3 PUFAs"), uncoded(2, "trazodone"), uncoded(3, "probiotics"), uncoded(4, "LAI antipsychotics"), uncoded(5, "psychoeducation"),
    ], taxonomy, "depression", { now: NOW })!
    expect(evidence.classes.map((entry) => [entry.key, entry.label, entry.treatments.map((treatment) => [treatment.key, treatment.name])])).toEqual([
      ["lifestyle", null, [["omega-3", "Omega-3 fatty acids"], ["probiotics", "Probiotics"]]],
      ["antidepressant", "Antidepressants", [["trazodone", "Trazodone"]]],
      ["antipsychotic", "Antipsychotics", [["long-acting-injectables", "Long-acting injectable antipsychotics"]]],
      ["psychotherapy", "Psychotherapy", [["psychoeducation", "Psychoeducation"]]],
    ])
  })
})

// Owner decision 2026-10-09: a paper that compares two treatments counts for the one it tested; the other shows it as a comparison.
describe("a paper that compares two pack treatments", () => {
  const versus = (n: number, over: Partial<Finding> & { date?: string; authors?: string[] } = {}) => finding(n, { treatment: "clozapine", treatmentCode: "clozapine", comparator: "olanzapine", text: "reduced symptoms more", ...over })
  const own = (n: number, over: Partial<Finding> & { date?: string } = {}) => finding(n, { treatment: "Olanzapine", treatmentCode: "olanzapine", comparator: "placebo", ...over })
  const treatmentsOf = (evidence: ReturnType<typeof build>) => evidence.classes.flatMap((entry) => entry.treatments)
  it("counts as a benefit for the treatment it tested, and gives the other arm no bubble of its own", () => {
    const evidence = build([versus(1)])
    expect(evidence.classes.map((entry) => [entry.key, entry.papers, entry.efficacy.benefit])).toEqual([["antipsychotic", 1, 1]])
    expect(treatmentsOf(evidence).map((treatment) => [treatment.key, treatment.papers, treatment.efficacy.benefit, treatment.comparatorPapers, treatment.comparedIn])).toEqual([["clozapine", 1, 1, 0, []]])
    const [study] = treatmentsOf(evidence)[0].studies
    expect([study.key, study.comparator, study.severalTreatments]).toEqual(["pmid:1", "olanzapine", false])
    expect([evidence.total, evidence.sections]).toEqual([1, { treatments: 1, safety: 0, research: 0 }])
  })
  it("is not an efficacy paper of the comparator, which shows it as a comparison beside its own papers", () => {
    const evidence = build([versus(1, { authors: ["Kane, J"], date: "2026-09-01" }), own(2)])
    const olanzapine = treatmentsOf(evidence).find((treatment) => treatment.key === "olanzapine")!
    expect([olanzapine.papers, olanzapine.efficacy, olanzapine.comparatorPapers]).toEqual([1, { benefit: 1, "no-benefit": 0, mixed: 0 }, 1])
    expect(olanzapine.studies.map((study) => study.key)).toEqual(["pmid:2"])
    expect(olanzapine.lines.benefit).toEqual([{ text: "reduced symptoms", key: "pmid:2" }])
    expect(olanzapine.comparedIn.map((study) => [study.key, study.slug, study.label, study.treatment, study.text, study.kind])).toEqual([["pmid:1", "paper-1", "Kane 2026", "clozapine", "reduced symptoms more", "benefit"]])
    const clozapine = treatmentsOf(evidence).find((treatment) => treatment.key === "clozapine")!
    expect([clozapine.papers, clozapine.comparatorPapers]).toEqual([1, 0])
    // The class counts its distinct papers, and the page counts each paper once.
    expect(evidence.classes[0]).toMatchObject({ key: "antipsychotic", papers: 2, efficacy: { benefit: 2, "no-benefit": 0, mixed: 0 } })
    expect([evidence.total, evidence.sections.treatments]).toEqual([2, 2])
  })
  it("lists the comparisons of a treatment newest first", () => {
    const evidence = build([own(1), versus(2, { date: "2026-08-01" }), versus(3, { date: "2026-09-15" }), versus(4, { treatment: "paliperidone", treatmentCode: "paliperidone", date: "2026-09-01" })])
    const olanzapine = treatmentsOf(evidence).find((treatment) => treatment.key === "olanzapine")!
    expect(olanzapine.comparatorPapers).toBe(3)
    expect(olanzapine.comparedIn.map((study) => study.key)).toEqual(["pmid:3", "pmid:4", "pmid:2"])
  })
  it("fixes a stored answer that names both arms as the treatment, with no migration", () => {
    const evidence = build([versus(1, { treatment: "clozapine and olanzapine", treatmentCode: "clozapine" }), own(2)])
    expect(treatmentsOf(evidence).map((treatment) => [treatment.key, treatment.papers, treatment.comparatorPapers])).toEqual([["clozapine", 1, 0], ["olanzapine", 1, 1]])
    // The row keeps the paper's own words, and is under one treatment only.
    const [study] = treatmentsOf(evidence)[0].studies
    expect([study.treatment, study.severalTreatments]).toEqual(["clozapine and olanzapine", false])
  })
  it("leaves a stored answer that names both arms with no comparator as it was", () => {
    const evidence = build([versus(1, { treatment: "clozapine and olanzapine", treatmentCode: "clozapine", comparator: null })])
    expect(treatmentsOf(evidence).map((treatment) => [treatment.key, treatment.papers, treatment.comparatorPapers])).toEqual([["clozapine", 1, 0], ["olanzapine", 1, 0]])
  })
  it("ignores a comparator that is not a pack treatment, and keeps treatments that share one result together", () => {
    const evidence = build([finding(1, { treatment: "clozapine and olanzapine", treatmentCode: null, comparator: "placebo" }), finding(2, { treatment: "Clozapine", treatmentCode: "clozapine", comparator: "treatment as usual" })])
    expect(treatmentsOf(evidence).map((treatment) => [treatment.key, treatment.papers, treatment.comparatorPapers])).toEqual([["clozapine", 2, 0], ["olanzapine", 1, 0]])
  })
  it("does not take a treatment the comparator rules out as a comparison", () => {
    const evidence = build([own(1), finding(2, { treatment: "clozapine and olanzapine", treatmentCode: null, comparator: "placebo or no olanzapine-class agent" }), versus(3, { comparator: "olanzapine-naive controls" })])
    expect(treatmentsOf(evidence).map((treatment) => [treatment.key, treatment.papers, treatment.comparatorPapers])).toEqual([["clozapine", 2, 0], ["olanzapine", 2, 0]])
  })
  it("makes no class, no safety group and no research row of a treatment that is only a comparator", () => {
    const evidence = build([finding(1, { comparator: "olanzapine" }), finding(2, { kind: "safety", comparator: "risperidone" }), finding(3, { kind: "other", comparator: "paliperidone" })])
    expect(evidence.classes.map((entry) => [entry.key, entry.treatments.map((treatment) => treatment.key)])).toEqual([["medicine", ["ketamine"]]])
    expect(evidence.safety.map((group) => group.key)).toEqual(["ketamine"])
    expect(evidence.research.map((group) => [group.type, group.papers])).toEqual([["no-efficacy", 1]])
    expect(evidence.timeline.series.map((entry) => entry.key)).toEqual(["medicine"])
    expect([evidence.total, evidence.sections]).toEqual([3, { treatments: 1, safety: 1, research: 1 }])
    expect(followedConditions([finding(1, { comparator: "olanzapine" })], TAXONOMY, [], NOW)[0].treatments).toEqual([{ key: "medicine", label: null }])
  })
  it("counts as a comparison only a paper that reports whether its treatment worked", () => {
    const evidence = build([own(1), versus(2, { kind: "safety" }), versus(3, { kind: "other" }), versus(4, { kind: "no-benefit", text: "did not reduce symptoms more" })])
    const olanzapine = treatmentsOf(evidence).find((treatment) => treatment.key === "olanzapine")!
    expect([olanzapine.comparatorPapers, olanzapine.comparedIn.map((study) => [study.key, study.kind]), olanzapine.safetyPapers, olanzapine.unreportedPapers]).toEqual([1, [["pmid:4", "no-benefit"]], 0, 0])
    expect(evidence.safety.map((group) => group.key)).toEqual(["clozapine"])
  })
  it("does not lose a paper whose every treatment is also named as its comparator", () => {
    const evidence = build([finding(1, { treatment: "olanzapine", treatmentCode: "olanzapine", comparator: "olanzapine" }), finding(2, { treatment: "clozapine and olanzapine", treatmentCode: null, comparator: "olanzapine, clozapine" })])
    expect(treatmentsOf(evidence).map((treatment) => [treatment.key, treatment.papers, treatment.comparatorPapers])).toEqual([["olanzapine", 2, 0], ["clozapine", 1, 0]])
    expect(evidence.total).toBe(2)
  })
  it("does not count a paper as a comparison of the treatment its stored code files it under", () => {
    const evidence = build([finding(1, { treatment: "the older drug", treatmentCode: "olanzapine", comparator: "olanzapine" })])
    expect(treatmentsOf(evidence).map((treatment) => [treatment.key, treatment.papers, treatment.comparatorPapers])).toEqual([["olanzapine", 1, 0]])
  })
  it("counts the comparisons of the scope and the period shown", () => {
    const evidence = build([own(1), versus(2, { date: "2025-01-10" }), versus(3)], { now: NOW, period: "3m" })
    expect(treatmentsOf(evidence).find((treatment) => treatment.key === "olanzapine")!.comparedIn.map((study) => study.key)).toEqual(["pmid:3"])
  })
})
