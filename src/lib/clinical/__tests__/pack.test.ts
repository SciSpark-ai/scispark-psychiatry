import { describe, expect, it } from "vitest"
import { mkdtemp, writeFile, cp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadPackFromDir, loadPsychiatryPack } from "../pack/load"
import { TaxonomySchema } from "../pack/schema"
import { findNode, findTreatments, withDescendants } from "../pack/taxonomy"

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
    // The pack's long-acting-injectables node has no term "LAI", so the word found is the class.
    ["LAI antipsychotics", ["antipsychotic"]],
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
