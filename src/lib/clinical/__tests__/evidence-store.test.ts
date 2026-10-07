// src/lib/clinical/__tests__/evidence-store.test.ts
import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { TaxonomySchema } from "../pack/schema"
import type { StoredFeed, StoredFeedItem } from "../feed/stored"
import { saveHistory } from "../history/store"
import { FINDINGS_PATH, readFindings } from "../evidence/file"
import { backfillFindings, recordFindings } from "../evidence/store"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { runClinicalFeed } from "../feed/run"
import { saveWatchEntries } from "../watch/store"
import { CLINICAL_COPY } from "../copy"
import { loadClinicalFeed } from "../feed/stored"
import { llmResult, paper, SETTINGS, strongOk, watch } from "./helpers"

const TAXONOMY = TaxonomySchema.parse({ version: "t", nodes: [
  { id: "depression", type: "condition", name: "Major depressive disorder", synonyms: ["depression"] },
  { id: "schizophrenia", type: "condition", name: "Schizophrenia" },
  { id: "ketamine", type: "treatment", name: "Ketamine", modality: "drug" },
] })
const item = (n: number, over: Partial<StoredFeedItem> = {}): StoredFeedItem => ({
  paper: paper({ title: `Paper ${n}`, ids: { pmid: String(n) }, abstract: `Abstract ${n}.`, venue: "A Journal", date: "2026-09-20", authors: [{ name: "A. Author" }] }),
  key: `pmid:${n}`, design: "randomized-trial", designSource: "publication-type", entryId: "w1", grade: 4, topicGrade: 4,
  quote: "q", quoteVerified: true, ungraded: false, score: 90, flags: [],
  digest: { headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, quote: "q" }, ...over,
})
const feed = (items: StoredFeedItem[], over: Partial<StoredFeed> = {}): StoredFeed => ({
  version: 1, generatedAt: "2026-10-07T10:00:00.000Z", mode: "whats-new", strictness: "standard", items, lowerConfidence: [], safetySignals: [],
  stats: { retrieved: 9, domain: 9, gated: 9, graded: 9, listed: items.length }, costUsd: null, warnings: [],
  topics: [{ id: "w1", condition: "depression", treatment: "Ketamine" }, { id: "w2", condition: "Schizophrenia" }, { id: "w3", condition: "A condition the pack lacks" }],
  topicOverviews: { w1: [{ text: "reduced symptoms in adults", sources: ["pmid:1"], kind: "benefit", treatment: "ketamine", population: "adults with depression", comparator: "placebo", outcome: "depressive symptoms" }] },
  ...over,
})

describe("the findings store", () => {
  it("keeps one finding per listed paper, with its direction, its PICO line and the condition of its topic", async () => {
    const storage = new MemoryVaultStorage()
    expect(await recordFindings(storage, feed([item(1), item(2, { digest: undefined })]), TAXONOMY)).toBe(2)
    const [first, second] = (await readFindings(storage)).sort((a, b) => a.key.localeCompare(b.key))
    expect(first).toMatchObject({
      key: "pmid:1", slug: "paper-1", headline: "Headline 1", takeaway: "Takeaway 1.", kind: "benefit", treatment: "ketamine", treatmentCode: "ketamine",
      text: "reduced symptoms in adults", population: "adults with depression", comparator: "placebo", outcome: "depressive symptoms",
      conditionCodes: ["depression"], design: "randomized-trial", firstListedAt: "2026-10-07T10:00:00.000Z",
    })
    expect(first.paper.title).toBe("Paper 1")
    // A paper with no AI summary and no overview answer is still a finding: its title stands in for the headline.
    expect(second).toMatchObject({ key: "pmid:2", headline: "Paper 2", takeaway: "", kind: null, treatment: null, treatmentCode: null, conditionCodes: ["depression"] })
  })

  it("keeps a paper listed twice as one finding: the first date stays, a second condition is added, newer text wins only when there is some", async () => {
    const storage = new MemoryVaultStorage()
    await recordFindings(storage, feed([item(1)]), TAXONOMY)
    const later = feed([item(1, { entryId: "w2", digest: undefined })], { generatedAt: "2026-10-09T10:00:00.000Z", topicOverviews: {} })
    expect(await recordFindings(storage, later, TAXONOMY)).toBe(1)
    const [finding] = await readFindings(storage)
    expect(finding.firstListedAt).toBe("2026-10-07T10:00:00.000Z")
    expect(finding.lastListedAt).toBe("2026-10-09T10:00:00.000Z")
    expect(finding.conditionCodes).toEqual(["depression", "schizophrenia"])
    expect(finding.headline).toBe("Headline 1")
    expect(finding.kind).toBe("benefit")
  })

  it("keeps a paper whose topic names a condition the pack does not know, under no condition", async () => {
    const storage = new MemoryVaultStorage()
    await recordFindings(storage, feed([item(3, { entryId: "w3" }), item(4, { entryId: null })]), TAXONOMY)
    expect((await readFindings(storage)).map((finding) => finding.conditionCodes)).toEqual([[], []])
  })

  it("reads a missing or damaged file as no findings, and copies a damaged one aside before writing", async () => {
    const storage = new MemoryVaultStorage()
    expect(await readFindings(storage)).toEqual([])
    await storage.write(FINDINGS_PATH, "{ not json")
    expect(await readFindings(storage)).toEqual([])
    await recordFindings(storage, feed([item(1)]), TAXONOMY)
    expect(await storage.read(FINDINGS_PATH.replace(/\.json$/, ".unreadable.json"))).toBe("{ not json")
    expect(await readFindings(storage)).toHaveLength(1)
  })

  it("fills the store from the searches already kept, oldest first, once", async () => {
    const storage = new MemoryVaultStorage()
    await saveHistory(storage, feed([item(1)], { generatedAt: "2026-10-01T10:00:00.000Z" }))
    await saveHistory(storage, feed([item(1), item(5)], { generatedAt: "2026-10-05T10:00:00.000Z" }))
    expect(await backfillFindings(storage, TAXONOMY)).toBe(2)
    const byKey = Object.fromEntries((await readFindings(storage)).map((finding) => [finding.key, finding]))
    expect(byKey["pmid:1"].firstListedAt).toBe("2026-10-01T10:00:00.000Z")
    expect(byKey["pmid:5"].firstListedAt).toBe("2026-10-05T10:00:00.000Z")
    // Once the file exists, the kept searches are not read again.
    await saveHistory(storage, feed([item(6)], { generatedAt: "2026-10-06T10:00:00.000Z" }))
    expect(await backfillFindings(storage, TAXONOMY)).toBe(2)
  })
})

describe("a search records its findings", () => {
  it("stores the listed papers as findings when asked to, and not otherwise", async () => {
    const pack = await loadPsychiatryPack()
    const RCT = paper({ title: "Esketamine nasal spray versus quetiapine in treatment-resistant depression", ids: { pmid: "111" },
      abstract: "METHODS: Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.\nRESULTS: Remission at week 8 was 27% with esketamine and 18% with quetiapine.",
      publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-28" })
    const grade = () => llmResult({ assessments: [{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "randomised to esketamine nasal spray or quetiapine", conditionMatch: true, treatmentMatch: true }] }, "claude-haiku-4-5")
    const run = async (storage: MemoryVaultStorage, extra: Record<string, unknown>) => {
      await saveWatchEntries(storage, [watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine" })])
      return runClinicalFeed(storage, { pack, enumerate: async () => ({ records: [RCT], total: 1, truncated: false }), settings: SETTINGS, now: () => new Date("2026-10-06T10:00:00.000Z"), providerOverride: { strong: strongOk(), fast: new MockProvider([grade()]) }, ...extra })
    }
    const off = new MemoryVaultStorage()
    await run(off, {})
    expect(await readFindings(off)).toEqual([])
    const on = new MemoryVaultStorage()
    await run(on, { recordFindings: true })
    const [finding] = await readFindings(on)
    expect(finding).toMatchObject({ key: "pmid:111", conditionCodes: ["treatment-resistant-depression"], design: "randomized-trial" })
  })

  it("still lists the papers, with a warning, when the findings cannot be written", async () => {
    const pack = await loadPsychiatryPack()
    const RCT = paper({ title: "Esketamine nasal spray versus quetiapine in treatment-resistant depression", ids: { pmid: "111" },
      abstract: "METHODS: Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.",
      publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-28" })
    const grade = llmResult({ assessments: [{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "randomised to esketamine nasal spray or quetiapine", conditionMatch: true, treatmentMatch: true }] }, "claude-haiku-4-5")
    class FailingFindings extends MemoryVaultStorage {
      async write(path: string, content: string) { if (path === FINDINGS_PATH) throw new Error("disk full"); return super.write(path, content) }
    }
    const storage = new FailingFindings()
    await saveWatchEntries(storage, [watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine" })])
    const feed = await runClinicalFeed(storage, { pack, enumerate: async () => ({ records: [RCT], total: 1, truncated: false }), settings: SETTINGS, now: () => new Date("2026-10-06T10:00:00.000Z"), providerOverride: { strong: strongOk(), fast: new MockProvider([grade]) }, recordFindings: true })
    expect(feed.items.map((entry) => entry.key)).toEqual(["pmid:111"])
    expect(feed.warnings).toContain(CLINICAL_COPY.run.findingsNotKept)
    expect((await loadClinicalFeed(storage))?.warnings).toContain(CLINICAL_COPY.run.findingsNotKept)
  })
})
