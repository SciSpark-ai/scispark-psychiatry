import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { parseDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import { revertPersistedChangeset } from "../../vault/changesets"
import { TaxonomySchema } from "../pack/schema"
import { createConditionPage } from "../records/condition-page"
import { parseEvidenceQuery } from "../records/query"

const TAXONOMY = TaxonomySchema.parse({ version: "t", nodes: [
  { id: "depression", type: "condition", name: "Major depressive disorder", synonyms: ["MDD"], meshHeading: "Depressive Disorder, Major" },
  { id: "esketamine", type: "treatment", name: "Esketamine", modality: "drug" },
] })
const NOW = () => new Date("2026-10-07T10:00:00.000Z")

describe("creating a condition page", () => {
  it("writes a page of type condition with the pack's id and a condition-evidence block, through a changeset", async () => {
    const storage = new MemoryVaultStorage()
    const made = await createConditionPage(storage, TAXONOMY, "depression", { now: NOW })
    expect(made).toEqual({ id: "wiki/conditions/major-depressive-disorder", created: true })
    const { frontmatter, body } = parseDocument((await storage.read("wiki/conditions/major-depressive-disorder.md")) as string)
    expect(frontmatter).toMatchObject({ type: "condition", title: "Major depressive disorder", taxonomy: "depression", aliases: ["MDD"], mesh: "Depressive Disorder, Major", created: "2026-10-07" })
    const block = body.match(/```condition-evidence\n([\s\S]*?)\n```/)
    expect(parseEvidenceQuery(block![1])).toEqual({ condition: "depression" })
    expect(body).not.toContain("```evidence-table")
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
    // A page that has its evidence block is not written again.
    expect((await storage.list(".scispark/changesets/")).length).toBe(1)
  })
  it("gives a page made before the evidence block that block, at the top, and leaves the rest of the page as it is", async () => {
    const storage = new MemoryVaultStorage()
    const path = "wiki/conditions/major-depressive-disorder.md"
    const front = "---\ntype: condition\ntitle: Major depressive disorder\ncreated: 2026-09-01\nupdated: 2026-09-03\ntags: [mine]\nrelated: []\nsources: []\ntaxonomy: depression\n---\n\n"
    const rest = "## Treatment options\n\n```evidence-table\ncondition: depression\n```\n\n## My notes\n\nLithium first, I think.\n"
    await storage.write(path, front + rest)
    expect(await createConditionPage(storage, TAXONOMY, "depression", { now: NOW })).toEqual({ id: "wiki/conditions/major-depressive-disorder", created: false })
    const after = (await storage.read(path)) as string
    expect(after).toBe(`${front}## Evidence your feed has seen\n\n\`\`\`condition-evidence\ncondition: depression\n\`\`\`\n\n${rest}`)
    // Through a changeset that holds the page as it was, so it can be undone.
    const [changesetPath] = await storage.list(".scispark/changesets/")
    const changeset = JSON.parse((await storage.read(changesetPath)) as string)
    expect(changeset.changes).toEqual([{ path, before: front + rest, after }])
    await revertPersistedChangeset(storage, changeset.id)
    expect(await storage.read(path)).toBe(front + rest)
  })
  it("repairs a page once: asked again, it changes nothing", async () => {
    const storage = new MemoryVaultStorage()
    const path = "wiki/conditions/major-depressive-disorder.md"
    await storage.write(path, "---\ntype: condition\ntitle: Major depressive disorder\ncreated: 2026-09-01\nupdated: 2026-09-03\ntags: []\nrelated: []\nsources: []\n---\n\nOnly my notes.\n")
    await createConditionPage(storage, TAXONOMY, "depression", { now: NOW })
    const once = await storage.read(path)
    expect(once).toContain("```condition-evidence\ncondition: depression\n```")
    expect(await createConditionPage(storage, TAXONOMY, "depression", { now: NOW })).toEqual({ id: "wiki/conditions/major-depressive-disorder", created: false })
    expect(await storage.read(path)).toBe(once)
    expect((await storage.list(".scispark/changesets/")).length).toBe(1)
  })
  it("refuses a code that is not a condition of the pack", async () => {
    const storage = new MemoryVaultStorage()
    await expect(createConditionPage(storage, TAXONOMY, "esketamine", { now: NOW })).rejects.toThrow(/not in the pack/)
    await expect(createConditionPage(storage, TAXONOMY, "../x", { now: NOW })).rejects.toThrow(/not in the pack/)
    expect(await storage.list("wiki/")).toEqual([])
  })
})
