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
  // Owner decision 2026-10-08: the stored code is the first treatment the text names, found by its words.
  it("stores the code of the first treatment the answer's text names", async () => {
    const stored = async (treatment: string) => {
      const storage = new MemoryVaultStorage()
      await recordFindings(storage, feed([item(1)], { topicOverviews: { w1: [{ text: "reduced symptoms", sources: ["pmid:1"], kind: "benefit", treatment }] } }), TAXONOMY)
      return (await readFindings(storage))[0]
    }
    expect(await stored("low-dose ketamine and lithium")).toMatchObject({ treatment: "low-dose ketamine and lithium", treatmentCode: "ketamine" })
    expect(await stored("yoga")).toMatchObject({ treatment: "yoga", treatmentCode: null })
  })
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

  it("files a paper that matched only the topic's treatment under no condition", async () => {
    const storage = new MemoryVaultStorage()
    await recordFindings(storage, feed([item(1, { matched: "treatment" }), item(2, { matched: "full" }), item(3, { matched: "condition" }), item(4)]), TAXONOMY)
    const codes = Object.fromEntries((await readFindings(storage)).map((finding) => [finding.key, finding.conditionCodes]))
    expect(codes).toEqual({ "pmid:1": [], "pmid:2": ["depression"], "pmid:3": ["depression"], "pmid:4": ["depression"] })
    // The treatment it matched is still kept with the finding.
    expect((await readFindings(storage)).find((finding) => finding.key === "pmid:1")).toMatchObject({ treatment: "ketamine", treatmentCode: "ketamine" })
  })

  it("keeps both conditions of a topic that names two, whichever the paper matched", async () => {
    const storage = new MemoryVaultStorage()
    const two = feed([item(1, { matched: "condition" })], { topics: [{ id: "w1", condition: "depression", condition2: "Schizophrenia", treatment: "Ketamine" }] })
    await recordFindings(storage, two, TAXONOMY)
    expect((await readFindings(storage))[0].conditionCodes).toEqual(["depression", "schizophrenia"])
  })

  it("keeps an earlier named treatment when a newer answer names none", async () => {
    const storage = new MemoryVaultStorage()
    await recordFindings(storage, feed([item(1)]), TAXONOMY)
    const later = feed([item(1)], { generatedAt: "2026-10-09T10:00:00.000Z", topicOverviews: { w1: [{ text: "was no better than placebo", sources: ["pmid:1"], kind: "no-benefit" }] } })
    await recordFindings(storage, later, TAXONOMY)
    const [finding] = await readFindings(storage)
    expect(finding).toMatchObject({ kind: "no-benefit", text: "was no better than placebo", treatment: "ketamine", treatmentCode: "ketamine" })
  })

  it("stores the class of treatment, the type of research and the sample size, keeps earlier ones through a newer listing without them, and reads a finding stored without them as null", async () => {
    const storage = new MemoryVaultStorage()
    const answer = (extra: object) => ({ text: "reduced symptoms", sources: ["pmid:1"], kind: "benefit" as const, ...extra })
    await recordFindings(storage, feed([item(1)], { topicOverviews: { w1: [answer({ treatment: "ketamine", treatmentClass: "medicine", sampleSize: 180 })] } }), TAXONOMY)
    expect((await readFindings(storage))[0]).toMatchObject({ treatmentClass: "medicine", researchType: null, sampleSize: 180 })
    await recordFindings(storage, feed([item(1)], { generatedAt: "2026-10-09T10:00:00.000Z", topicOverviews: { w1: [answer({})] } }), TAXONOMY)
    expect((await readFindings(storage))[0]).toMatchObject({ treatmentClass: "medicine", sampleSize: 180 })
    await recordFindings(storage, feed([item(1)], { generatedAt: "2026-10-10T10:00:00.000Z", topicOverviews: { w1: [answer({ treatmentClass: "digital", researchType: "other", sampleSize: 200 })] } }), TAXONOMY)
    // Final review I3: the latest answer decides what the paper is about. One that names no treatment and a type of research clears the treatment.
    expect((await readFindings(storage))[0]).toMatchObject({ treatment: null, treatmentCode: null, treatmentClass: null, researchType: "other", sampleSize: 200 })
    const research = new MemoryVaultStorage()
    await recordFindings(research, feed([item(1)], { topicOverviews: { w1: [answer({ researchType: "risk-factor" })] } }), TAXONOMY)
    expect((await readFindings(research))[0]).toMatchObject({ treatmentClass: null, researchType: "risk-factor", sampleSize: null })
    // A file written before the fields existed still reads, with null.
    const old = JSON.parse((await research.read(FINDINGS_PATH))!)
    for (const finding of Object.values<Record<string, unknown>>(old.findings)) { delete finding.treatmentClass; delete finding.researchType; delete finding.sampleSize }
    await research.write(FINDINGS_PATH, JSON.stringify(old))
    expect((await readFindings(research))[0]).toMatchObject({ treatmentClass: null, researchType: null, sampleSize: null })
  })

  it("never leaves a finding with both a treatment and a type of research", async () => {
    const answer = (extra: object) => ({ text: "reduced symptoms", sources: ["pmid:1"], kind: "benefit" as const, ...extra })
    const record = async (storage: MemoryVaultStorage, day: string, extra: object) => {
      await recordFindings(storage, feed([item(1)], { generatedAt: `2026-10-${day}T10:00:00.000Z`, topicOverviews: { w1: [answer(extra)] } }), TAXONOMY)
      return (await readFindings(storage))[0]
    }
    // A treatment after a type of research: the type goes.
    const first = new MemoryVaultStorage()
    await record(first, "07", { researchType: "risk-factor" })
    expect(await record(first, "08", { treatment: "ketamine", treatmentClass: "medicine" })).toMatchObject({ treatment: "ketamine", treatmentCode: "ketamine", treatmentClass: "medicine", researchType: null })
    // A type of research after a treatment: the treatment, its code and its class go.
    expect(await record(first, "09", { researchType: "mechanism" })).toMatchObject({ treatment: null, treatmentCode: null, treatmentClass: null, researchType: "mechanism" })
    // An answer with neither keeps the earlier treatment, and no type of research beside it.
    const second = new MemoryVaultStorage()
    await record(second, "07", { treatment: "ketamine", treatmentClass: "medicine" })
    expect(await record(second, "08", {})).toMatchObject({ treatment: "ketamine", treatmentCode: "ketamine", treatmentClass: "medicine", researchType: null })
    // An answer with neither keeps an earlier type of research when no treatment stands.
    const third = new MemoryVaultStorage()
    await record(third, "07", { researchType: "prediction" })
    expect(await record(third, "08", {})).toMatchObject({ treatment: null, researchType: "prediction" })
    // A finding stored with both (before this rule) loses the type when an answer with neither comes.
    const fourth = new MemoryVaultStorage()
    await record(fourth, "07", { treatment: "ketamine" })
    const both = JSON.parse((await fourth.read(FINDINGS_PATH))!)
    both.findings["pmid:1"].researchType = "risk-factor"
    await fourth.write(FINDINGS_PATH, JSON.stringify(both))
    expect(await record(fourth, "08", {})).toMatchObject({ treatment: "ketamine", researchType: null })
  })

  it("keeps the PICO line and the journal band through a listing without an answer, and takes a newer answer over an older one", async () => {
    const storage = new MemoryVaultStorage()
    await recordFindings(storage, feed([item(1, { journalBand: 1 })]), TAXONOMY)
    await recordFindings(storage, feed([item(1)], { generatedAt: "2026-10-08T10:00:00.000Z", topicOverviews: {} }), TAXONOMY)
    expect((await readFindings(storage))[0]).toMatchObject({ population: "adults with depression", comparator: "placebo", outcome: "depressive symptoms", journalBand: 1, kind: "benefit" })
    const newer = feed([item(1, { journalBand: 2 })], { generatedAt: "2026-10-09T10:00:00.000Z", topicOverviews: { w1: [{ text: "reduced relapse", sources: ["pmid:1"], kind: "benefit", treatment: "Ketamine", population: "older adults", comparator: "midazolam", outcome: "relapse" }] } })
    await recordFindings(storage, newer, TAXONOMY)
    expect((await readFindings(storage))[0]).toMatchObject({ text: "reduced relapse", population: "older adults", comparator: "midazolam", outcome: "relapse", journalBand: 2, treatment: "Ketamine", treatmentCode: "ketamine" })
  })

  it("copies a file of the earlier version aside and builds the store again from the kept searches, as a search does", async () => {
    const storage = new MemoryVaultStorage()
    // Version 1 filed a treatment-only match under the topic's condition.
    await recordFindings(storage, feed([item(1, { matched: "treatment" })]), TAXONOMY)
    const wrong = { ...(await readFindings(storage))[0], conditionCodes: ["depression"] }
    const old = JSON.stringify({ version: 1, findings: { "pmid:1": wrong } })
    await storage.write(FINDINGS_PATH, old)
    expect(await readFindings(storage)).toEqual([])
    await saveHistory(storage, feed([item(1, { matched: "treatment" }), item(5)], { generatedAt: "2026-10-01T10:00:00.000Z" }))
    // A search fills an unreadable store from the kept searches, then records its own papers.
    await backfillFindings(storage, TAXONOMY)
    await recordFindings(storage, feed([item(6)], { generatedAt: "2026-10-08T10:00:00.000Z" }), TAXONOMY)
    expect(await storage.read(FINDINGS_PATH.replace(/\.json$/, ".unreadable.json"))).toBe(old)
    expect(JSON.parse((await storage.read(FINDINGS_PATH)) as string).version).toBe(2)
    const byKey = Object.fromEntries((await readFindings(storage)).map((finding) => [finding.key, finding]))
    expect(Object.keys(byKey).sort()).toEqual(["pmid:1", "pmid:5", "pmid:6"])
    expect(byKey["pmid:1"].conditionCodes).toEqual([])
    expect(byKey["pmid:5"].firstListedAt).toBe("2026-10-01T10:00:00.000Z")
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
