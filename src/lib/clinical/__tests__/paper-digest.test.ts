import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { paperSlug } from "../../wiki/authoring"
import { generatePaperDigest, loadCachedPaperDigest, PAPER_DIGEST_ITEMS } from "../digest/paper"
import { llmResult, paper, SETTINGS } from "./helpers"

// The digest on the paper page (owner decision 2026-10-07): nine short items in a fixed order,
// written from the full text when it can be read and from the abstract otherwise.

const RCT = paper({
  title: "Esketamine nasal spray versus quetiapine in treatment-resistant depression", ids: { pmid: "111" },
  abstract: "METHODS: Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.\nRESULTS: Remission at week 8 was 27% with esketamine and 18% with quetiapine.",
})
const FULL_TEXT = `${RCT.abstract} Dizziness occurred in 12% of the esketamine group. The trial was open label. Funded by Janssen.`
const ANSWER = {
  question: "Does esketamine nasal spray give more remission than quetiapine in treatment-resistant depression?",
  design: "Open-label randomised trial", population: "Adults with treatment-resistant depression",
  intervention: "Esketamine nasal spray versus quetiapine", mainResult: "Remission at week 8 was 27% with esketamine and 18% with quetiapine.",
  safety: "Dizziness occurred in 12% of the esketamine group.", limitations: "The trial was open label.",
  conclusion: "Not reported", funding: "Funded by Janssen.",
}
const strong = (...answers: unknown[]) => new MockProvider(answers.map((answer) => llmResult(answer, "claude-sonnet-5")))
const FULL = { access: "full-text" as const, locator: "PMC", checkedAt: "2026-10-07T10:00:00.000Z", truncated: false, notes: [] }

describe("the clinical paper digest", () => {
  it("has nine items in the agreed order", () => {
    expect(PAPER_DIGEST_ITEMS).toEqual(["question", "design", "population", "intervention", "mainResult", "safety", "limitations", "conclusion", "funding"])
  })

  it("writes the items from the full text, records what it was written from, and keeps it", async () => {
    const storage = new MemoryVaultStorage()
    const provider = strong(ANSWER)
    const first = await generatePaperDigest(storage, RCT, { fullText: FULL_TEXT, source: FULL, settings: SETTINGS, providerOverride: { strong: provider } })
    expect(first.fromCache).toBe(false)
    expect(first.digest.source.access).toBe("full-text")
    expect(first.digest.items.safety).toBe("Dizziness occurred in 12% of the esketamine group.")
    // An item the paper does not state is empty, not a sentence saying so.
    expect(first.digest.items.conclusion).toBeNull()
    expect(first.digest.unverified).toEqual([])
    expect(JSON.stringify(provider.calls[0])).toContain("Funded by Janssen")

    const again = await generatePaperDigest(storage, RCT, { fullText: FULL_TEXT, source: FULL, settings: SETTINGS, providerOverride: { strong: provider } })
    expect(again.fromCache).toBe(true)
    expect(provider.calls).toHaveLength(1)
    expect((await loadCachedPaperDigest(storage, paperSlug(RCT)))?.items.funding).toBe("Funded by Janssen.")
  })

  it("asks again when an item has a number the text does not print, and marks the item if it stays", async () => {
    const storage = new MemoryVaultStorage()
    const wrong = { ...ANSWER, safety: "Dizziness occurred in 31% of the esketamine group." }
    const fixed = await generatePaperDigest(storage, RCT, { fullText: FULL_TEXT, source: FULL, settings: SETTINGS, providerOverride: { strong: strong(wrong, ANSWER) } })
    expect(fixed.digest.unverified).toEqual([])
    expect(fixed.digest.items.safety).toContain("12%")

    const other = paper({ ...RCT, ids: { pmid: "112" } })
    const provider = strong(wrong, wrong)
    const kept = await generatePaperDigest(new MemoryVaultStorage(), other, { fullText: FULL_TEXT, source: FULL, settings: SETTINGS, providerOverride: { strong: provider } })
    expect(provider.calls).toHaveLength(2)
    expect(JSON.stringify(provider.calls[1])).toContain("31")
    expect(kept.digest.unverified).toEqual(["safety"])
  })

  it("writes from the abstract when there is no full text, and writes again once the full text can be read", async () => {
    const storage = new MemoryVaultStorage()
    const provider = strong({ ...ANSWER, safety: null, limitations: null, funding: null }, ANSWER)
    const fromAbstract = await generatePaperDigest(storage, RCT, { settings: SETTINGS, providerOverride: { strong: provider } })
    expect(fromAbstract.digest.source.access).toBe("abstract")
    expect(fromAbstract.digest.items.safety).toBeNull()
    const upgraded = await generatePaperDigest(storage, RCT, { fullText: FULL_TEXT, source: FULL, settings: SETTINGS, providerOverride: { strong: provider } })
    expect(upgraded.fromCache).toBe(false)
    expect(upgraded.digest.source.access).toBe("full-text")
    expect(upgraded.digest.items.safety).toContain("12%")
  })

  it("reads a damaged or missing record as no digest", async () => {
    const storage = new MemoryVaultStorage()
    expect(await loadCachedPaperDigest(storage, paperSlug(RCT))).toBeNull()
    await storage.write(`.scispark/clinical/paper-digests/${paperSlug(RCT)}.json`, "{not json")
    expect(await loadCachedPaperDigest(storage, paperSlug(RCT))).toBeNull()
    expect(await loadCachedPaperDigest(storage, "../settings")).toBeNull()
  })
})
