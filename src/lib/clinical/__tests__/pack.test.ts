import { describe, expect, it } from "vitest"
import { mkdtemp, writeFile, cp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadPackFromDir, loadPsychiatryPack } from "../pack/load"
import { TaxonomySchema } from "../pack/schema"
import { armsOf, findNode, findTreatments, treatmentMatcherStats, withDescendants } from "../pack/taxonomy"

describe("psychiatry pack", () => {
  it("loads and validates the shipped files", async () => {
    const pack = await loadPsychiatryPack()
    expect(pack.manifest.id).toBe("psychiatry")
    expect(pack.journals.filter((journal) => journal.tier === "B")).toHaveLength(10)
    expect(pack.onboarding.roles).toContain("Psychiatrist")
    expect(pack.textWords.length).toBeGreaterThan(20)
  })

  it("covers the D31 starting taxonomy", async () => {
    const { taxonomy } = await loadPsychiatryPack()
    for (const label of ["depression", "schizophrenia", "ADHD", "autism", "anxiety", "PTSD", "bipolar disorder"]) {
      expect(findNode(taxonomy, label, "condition"), label).not.toBeNull()
    }
    for (const label of ["rTMS", "ECT", "tDCS", "VNS", "DBS", "CBT", "IPT", "ACT", "DBT", "EMDR", "esketamine", "Spravato"]) {
      expect(findNode(taxonomy, label, "treatment"), label).not.toBeNull()
    }
  })

  it("rolls a condition up to its subtypes", async () => {
    const { taxonomy } = await loadPsychiatryPack()
    const ids = withDescendants(taxonomy, "depression").map((node) => node.id)
    expect(ids).toEqual(expect.arrayContaining(["depression", "treatment-resistant-depression", "postpartum-depression"]))
    expect(ids).not.toContain("schizophrenia")
  })

  it("only marks a MeSH label verified when it has one", async () => {
    const { taxonomy } = await loadPsychiatryPack()
    for (const node of taxonomy.nodes) if (node.meshVerified) expect(node.meshHeading, node.id).toBeDefined()
  })
})

// Owner decision 2026-10-08: a treatment is found by its words inside what the paper named, and a paper may name several.
describe("the treatments a text names", () => {
  const ids = async (text: string) => findTreatments((await loadPsychiatryPack()).taxonomy, text).map((node) => node.id)
  const CASES: Array<[string, string[]]> = [
    // "LAI" is a term of the long-acting injectables, which are below the class: the class is left out.
    ["LAI antipsychotics", ["long-acting-injectables"]],
    ["switching to an LAI", ["long-acting-injectables"]],
    ["trazodone", ["trazodone"]],
    ["zuclopenthixol acetate", ["zuclopenthixol"]],
    ["omega-3 PUFAs", ["omega-3"]],
    ["PUFA supplementation", ["omega-3"]],
    ["probiotics", ["probiotics"]],
    // No term of the digital interventions is printed in "web-based".
    ["web-based psychoeducation program", ["psychoeducation"]],
    ["centanafadine", ["centanafadine"]],
    ["low-dose antipsychotics", ["antipsychotic"]],
    ["clozapine, paliperidone, and olanzapine", ["clozapine", "paliperidone", "olanzapine"]],
    ["lithium and quetiapine", ["lithium", "quetiapine"]],
    ["methylphenidate and risperidone", ["methylphenidate", "risperidone"]],
    ["ketamine and esketamine", ["ketamine", "esketamine"]],
    ["high-frequency exercise", ["exercise"]],
    ["DMN-targeted TMS", ["rtms"]],
    ["mHealth interventions", ["digital-interventions"]],
    ["cognitive remediation and exercise", ["cognitive-remediation", "exercise"]],
  ]
  for (const [text, expected] of CASES) it(`finds ${expected.join(", ")} in "${text}"`, async () => expect(await ids(text)).toEqual(expected))

  it("does not find a short abbreviation inside a word, or as an English word in lower case", async () => {
    expect(await ids("physical activity")).toEqual(["exercise"])
    expect(await ids("impact of a brief intervention")).toEqual([])
    expect(await ids("an act of kindness")).toEqual([])
    expect(await ids("ectopic beats")).toEqual([])
  })
  it("finds a short abbreviation in upper case, and when the text is nothing else", async () => {
    expect(await ids("ACT")).toEqual(["act"])
    expect(await ids("act")).toEqual(["act"])
    expect(await ids("group ACT and usual care")).toEqual(["act"])
    expect(await ids("ECT")).toEqual(["ect"])
  })
  it("keeps the descendant when a treatment and its class are both named", async () => {
    expect(await ids("clozapine and other antipsychotics")).toEqual(["clozapine"])
    expect(await ids("antipsychotics such as clozapine")).toEqual(["clozapine"])
    expect(await ids("long-acting injectable antipsychotics")).toEqual(["long-acting-injectables"])
  })
  it("keeps the longest phrase when one term lies inside another", async () => {
    expect(await ids("internet-delivered CBT")).toEqual(["guided-self-help"])
    expect(await ids("mindfulness-based cognitive therapy")).toEqual(["mindfulness"])
  })
  it("allows a plural s, ignores case, and names each treatment once in the order of the text", async () => {
    expect(await ids("Antipsychotic")).toEqual(["antipsychotic"])
    expect(await ids("SSRIs and Benzodiazepines")).toEqual(["benzodiazepines"])
    expect(await ids("exercise, CBT, or more exercise")).toEqual(["exercise", "cbt"])
    expect(await ids("ketamines")).toEqual(["ketamine"])
    expect(await ids("ketaminergic drugs")).toEqual([])
  })
  it("still finds every label that is a whole term, as findNode does", async () => {
    const { taxonomy } = await loadPsychiatryPack()
    for (const label of ["rTMS", "ECT", "tDCS", "VNS", "DBS", "CBT", "IPT", "ACT", "DBT", "EMDR", "esketamine", "Spravato", "ect", "physical activity"]) {
      expect(findTreatments(taxonomy, label).map((node) => node.id), label).toContain(findNode(taxonomy, label, "treatment")?.id)
    }
  })
  it("allows the plural s on the last word of a term of several words", async () => {
    expect(await ids("cognitive remediations")).toEqual(["cognitive-remediation"])
    expect(await ids("cognitives remediation")).toEqual([])
  })
  it("reads a term with characters a pattern would read as its own as plain text", async () => {
    expect(await ids("3,4-methylenedioxymethamphetamine with therapy")).toEqual(["mdma-assisted-therapy"])
    const odd = TaxonomySchema.parse({ version: "t", nodes: [
      { id: "plus", type: "treatment", name: "Drug A+B (1.5 mg)", modality: "drug" }, { id: "dot", type: "treatment", name: "a.c", synonyms: ["x|y", "what?", "[z]*"], modality: "drug" },
    ] })
    const found = (text: string) => findTreatments(odd, text).map((node) => node.id)
    expect(found("gave Drug A+B (1.5 mg) daily")).toEqual(["plus"])
    expect(found("gave Drug AAB (1x5 mg) daily")).toEqual([])
    expect(found("abc, x, y, wha and z")).toEqual([])
    expect(found("x|y or [z]*")).toEqual(["dot"])
  })
  it("compiles the matchers of a taxonomy once, and finds the same again for the same text", async () => {
    const { taxonomy } = await loadPsychiatryPack()
    const first = findTreatments(taxonomy, "lithium and quetiapine")
    const compiled = treatmentMatcherStats.compiled
    const searched = treatmentMatcherStats.searched
    expect(findTreatments(taxonomy, "lithium and quetiapine")).toEqual(first)
    expect(treatmentMatcherStats.searched).toBe(searched)
    expect(findTreatments(taxonomy, "a text not seen before, with clozapine").map((node) => node.id)).toEqual(["clozapine"])
    expect(treatmentMatcherStats.searched).toBe(searched + 1)
    expect(treatmentMatcherStats.compiled).toBe(compiled)
    // What a caller does to the list it was given does not reach the next caller.
    findTreatments(taxonomy, "lithium and quetiapine").pop()
    expect(findTreatments(taxonomy, "lithium and quetiapine").map((node) => node.id)).toEqual(["lithium", "quetiapine"])
  })
  it("finds no condition or population", async () => {
    expect(await ids("depression in adults")).toEqual([])
    expect(await ids("")).toEqual([])
  })
})

describe("pack validation", () => {
  it("rejects duplicate ids and dangling parents", () => {
    const node = { id: "a", type: "condition", name: "A" }
    expect(TaxonomySchema.safeParse({ version: "1", nodes: [node, node] }).success).toBe(false)
    expect(TaxonomySchema.safeParse({ version: "1", nodes: [{ ...node, parents: ["missing"] }] }).success).toBe(false)
  })

  it("names the failing file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pack-"))
    await cp(path.join(process.cwd(), "packs", "psychiatry"), dir, { recursive: true })
    await writeFile(path.join(dir, "journals.json"), JSON.stringify({ version: "1", journals: [{ name: "No ISSN", tier: "A" }] }))
    await expect(loadPackFromDir(dir)).rejects.toThrow(/journals\.json/)
  })
})

// Owner decision 2026-10-09: a paper that compares two treatments counts for the one it tested; the other is its comparator.
describe("the arms of a finding", () => {
  const arms = async (treatment: string | null, comparator: string | null) => armsOf((await loadPsychiatryPack()).taxonomy, treatment, comparator)
  it("gives the treatment and, apart, the pack treatment it was compared with", async () => {
    expect(await arms("clozapine", "olanzapine")).toEqual({ treatments: ["clozapine"], comparators: ["olanzapine"] })
  })
  it("takes a treatment that is also the comparator as the comparator only", async () => {
    expect(await arms("clozapine and olanzapine", "olanzapine")).toEqual({ treatments: ["clozapine"], comparators: ["olanzapine"] })
  })
  it("has no comparator when the comparison is not with a pack treatment", async () => {
    for (const comparator of ["placebo", "sham", "treatment as usual", "control", "waiting list", null, ""]) expect(await arms("clozapine", comparator), String(comparator)).toEqual({ treatments: ["clozapine"], comparators: [] })
  })
  it("keeps the treatments that share one result together", async () => {
    expect(await arms("lithium and quetiapine", "placebo")).toEqual({ treatments: ["lithium", "quetiapine"], comparators: [] })
  })
  it("keeps the treatments, with no comparator, when every one of them is also named as the comparator", async () => {
    expect(await arms("clozapine and olanzapine", "olanzapine or clozapine")).toEqual({ treatments: ["clozapine", "olanzapine"], comparators: [] })
    expect(await arms("olanzapine", "olanzapine")).toEqual({ treatments: ["olanzapine"], comparators: [] })
  })
  // Owner decision 2026-10-09: a treatment the comparator rules out ("no", "without", "-naive") was not given to that arm.
  it("does not take a treatment the comparator rules out as a comparison arm", async () => {
    expect(await arms("ketamine and esketamine", "placebo or no ketamine-class agent")).toEqual({ treatments: ["ketamine", "esketamine"], comparators: [] })
    expect(await arms("clozapine", "treatment without lithium")).toEqual({ treatments: ["clozapine"], comparators: [] })
    expect(await arms("clozapine", "antipsychotic-naive controls")).toEqual({ treatments: ["clozapine"], comparators: [] })
    for (const comparator of ["no olanzapine", "non-olanzapine drugs", "not on olanzapine", "absence of olanzapine", "no add-on olanzapine", "olanzapine naive patients", "olanzapine-free weeks", "Olanzapine-Naïve adults"]) {
      expect(await arms("clozapine", comparator), comparator).toEqual({ treatments: ["clozapine"], comparators: [] })
    }
  })
  it("still takes a treatment the comparator names plainly, also beside one it rules out", async () => {
    expect(await arms("clozapine", "olanzapine")).toEqual({ treatments: ["clozapine"], comparators: ["olanzapine"] })
    expect(await arms("clozapine", "olanzapine without lithium")).toEqual({ treatments: ["clozapine"], comparators: ["olanzapine"] })
    // The negation reaches three words, and not past a comma or an "or".
    expect(await arms("clozapine", "no drug at all, olanzapine")).toEqual({ treatments: ["clozapine"], comparators: ["olanzapine"] })
    expect(await arms("clozapine", "no treatment or olanzapine")).toEqual({ treatments: ["clozapine"], comparators: ["olanzapine"] })
    expect(await arms("clozapine", "no change in the dose of olanzapine")).toEqual({ treatments: ["clozapine"], comparators: ["olanzapine"] })
    // Named once ruled out and once plainly: it was given.
    expect(await arms("clozapine", "olanzapine, or no olanzapine")).toEqual({ treatments: ["clozapine"], comparators: ["olanzapine"] })
  })
  it("does not drop a treatment that only a ruled-out comparator names", async () => {
    expect(await arms("clozapine and olanzapine", "no olanzapine")).toEqual({ treatments: ["clozapine", "olanzapine"], comparators: [] })
  })
  it("still gives the comparators of a treatment the pack does not know, and none of no text", async () => {
    expect(await arms("a drug nobody listed", "olanzapine")).toEqual({ treatments: [], comparators: ["olanzapine"] })
    expect(await arms(null, null)).toEqual({ treatments: [], comparators: [] })
  })
})
