import { describe, expect, it } from "vitest"
import { mkdtemp, writeFile, cp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadPackFromDir, loadPsychiatryPack } from "../pack/load"
import { TaxonomySchema } from "../pack/schema"
import { findNode, withDescendants } from "../pack/taxonomy"

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
