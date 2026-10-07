import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { parseDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import { TaxonomySchema } from "../pack/schema"
import { createConditionPage } from "../records/condition-page"
import { parseEvidenceQuery } from "../records/query"

const TAXONOMY = TaxonomySchema.parse({ version: "t", nodes: [
  { id: "depression", type: "condition", name: "Major depressive disorder", synonyms: ["MDD"], meshHeading: "Depressive Disorder, Major" },
  { id: "esketamine", type: "treatment", name: "Esketamine", modality: "drug" },
] })
const NOW = () => new Date("2026-10-07T10:00:00.000Z")

describe("creating a condition page", () => {
  it("writes a page of type condition with the pack's id and an evidence-table block, through a changeset", async () => {
    const storage = new MemoryVaultStorage()
    const made = await createConditionPage(storage, TAXONOMY, "depression", { now: NOW })
    expect(made).toEqual({ id: "wiki/conditions/major-depressive-disorder", created: true })
    const { frontmatter, body } = parseDocument((await storage.read("wiki/conditions/major-depressive-disorder.md")) as string)
    expect(frontmatter).toMatchObject({ type: "condition", title: "Major depressive disorder", taxonomy: "depression", aliases: ["MDD"], mesh: "Depressive Disorder, Major", created: "2026-10-07" })
    const block = body.match(/```evidence-table\n([\s\S]*?)\n```/)
    expect(parseEvidenceQuery(block![1])).toEqual({ condition: "depression" })
    expect((await storage.list(".scispark/changesets/")).length).toBe(1)
    // The page is one the wiki can load.
    expect((await loadBundle(storage)).pages.get("wiki/conditions/major-depressive-disorder")?.frontmatter.type).toBe("condition")
  })
  it("opens the page that is already there instead of writing over it", async () => {
    const storage = new MemoryVaultStorage()
    await createConditionPage(storage, TAXONOMY, "depression", { now: NOW })
    const path = "wiki/conditions/major-depressive-disorder.md"
    await storage.write(path, `${await storage.read(path)}\nMy own notes.\n`)
    expect(await createConditionPage(storage, TAXONOMY, "depression", { now: NOW })).toEqual({ id: "wiki/conditions/major-depressive-disorder", created: false })
    expect(await storage.read(path)).toContain("My own notes.")
  })
  it("refuses a code that is not a condition of the pack", async () => {
    const storage = new MemoryVaultStorage()
    await expect(createConditionPage(storage, TAXONOMY, "esketamine", { now: NOW })).rejects.toThrow(/not in the pack/)
    await expect(createConditionPage(storage, TAXONOMY, "../x", { now: NOW })).rejects.toThrow(/not in the pack/)
    expect(await storage.list("wiki/")).toEqual([])
  })
})
