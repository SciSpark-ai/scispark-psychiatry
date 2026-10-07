import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { capCandidates, runClinicalFeed, runClinicalFeedSingleFlight, type ClinicalFeedDeps } from "../feed/run"
import { FEED_PATH, feedPage, loadClinicalFeed, pageCount } from "../feed/stored"
import { loadLatestRunLog } from "../feed/run-log"
import { auditRecall } from "../audit/recall"
import { recordFeedback } from "../feedback/store"
import { saveClinicalSettings, saveWatchEntries } from "../watch/store"
import type { EnumerateFn } from "../retrieve/pool"
import type { ClinicalStage } from "../types"
import { fastOk, gated, llmResult, paper, SETTINGS, strongOk, watch } from "./helpers"

const NOW = () => new Date("2026-10-06T10:00:00.000Z")

const RCT = paper({
  title: "Esketamine nasal spray versus quetiapine in treatment-resistant depression", ids: { pmid: "111", doi: "10.1000/rct" },
  abstract: "Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.",
  publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-28", venue: "Some Journal",
})
const EDITORIAL = paper({ title: "A commentary on esketamine", ids: { pmid: "222" }, abstract: "Opinion about depression treatments.", publicationTypes: ["Editorial"], date: "2026-09-20" })
const COHORT = paper({
  title: "Ketamine use and depressive symptoms in a cohort of veterans", ids: { pmid: "333" },
  abstract: "A prospective cohort of veterans with depression reported ketamine use.", publicationTypes: ["Observational Study"], fields: ["Depression"], date: "2026-09-10",
})
const STATINS = paper({ title: "Statin therapy and stroke outcomes", ids: { pmid: "444" }, abstract: "Cardiovascular outcomes in a randomised trial.", publicationTypes: ["Randomized Controlled Trial"], fields: ["Stroke"], date: "2026-09-12" })

const enumerateFrom = (byTier: Partial<Record<"entry" | "A" | "B", Array<typeof RCT>>>): EnumerateFn => async ({ query }) => {
  const tier = query.includes("[Journal]") ? (query.includes('"Mental Disorders"') ? "B" : "A") : "entry"
  const records = byTier[tier] ?? []
  return { records, total: records.length, truncated: false }
}

async function setup(entries = [watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine", priority: "high" })]) {
  const storage = new MemoryVaultStorage()
  await saveWatchEntries(storage, entries)
  const pack = await loadPsychiatryPack()
  return { storage, pack }
}

const verified = (index: number, grade: number, topicGrade: number, quote: string, entryId: string | null = "w1") => ({ index, entryId, grade, topicGrade, quote })

function deps(base: Partial<ClinicalFeedDeps> & Pick<ClinicalFeedDeps, "pack" | "enumerate">): ClinicalFeedDeps {
  return { settings: SETTINGS, now: NOW, ...base }
}

describe("runClinicalFeed", () => {
  it("runs the funnel end to end and stores a list, a lower-confidence section and a run log", async () => {
    const { storage, pack } = await setup()
    const stages: ClinicalStage[] = []
    const fast = fastOk([verified(0, 4, 4, "esketamine nasal spray or quetiapine"), verified(1, 1, 3, "prospective cohort of veterans with depression")])
    const feed = await runClinicalFeed(storage, deps({
      pack, enumerate: enumerateFrom({ entry: [RCT, EDITORIAL, COHORT, STATINS], B: [RCT] }), onStage: (s) => stages.push(s),
      providerOverride: { strong: strongOk(), fast },
    }))

    expect(stages).toEqual(["context", "plan", "retrieve", "filter", "grade", "select"])
    expect(feed.items.map((item) => item.paper.ids.pmid)).toEqual(["111"])
    expect(feed.items[0]).toMatchObject({ design: "randomized-trial", entryId: "w1", grade: 4, quoteVerified: true })
    // The cohort is graded 1 ("loosely related"), which is no longer listed anywhere (owner decision 2026-10-06).
    expect(feed.lowerConfidence.map((item) => item.paper.ids.pmid)).toEqual([])
    expect(feed.stats).toEqual({ retrieved: 4, domain: 3, gated: 2, graded: 2, listed: 1 })
    expect(feed.mode).toBe("whats-new")
    expect(typeof feed.costUsd).toBe("number")
    expect(await loadClinicalFeed(storage)).toEqual(feed)

    const log = (await loadLatestRunLog(storage))!
    expect(log.drops.map((d) => [d.step, d.reason])).toEqual(expect.arrayContaining([["prefilter", "not-psychiatric"], ["gate", "Non-article record: Editorial"]]))
    const report = auditRecall([{ pmid: "111" }, { pmid: "444" }, { doi: "10.1000/rct" }, { pmid: "999" }], log)
    expect(report.misses.map((m) => [m.gold.pmid ?? m.gold.doi, m.lostAt])).toEqual([["444", "domain"], ["999", "never-retrieved"]])
    expect(report.recallByStage).toMatchObject({ retrieved: 0.75, domain: 0.5, gated: 0.5, listed: 0.5 })
  })

  it("lists a paper once even when several queries return it", async () => {
    const { storage, pack } = await setup()
    const feed = await runClinicalFeed(storage, deps({
      pack, enumerate: enumerateFrom({ entry: [RCT], B: [RCT] }), providerOverride: { strong: strongOk(), fast: fastOk([verified(0, 4, 4, "esketamine nasal spray or quetiapine")]) },
    }))
    expect(feed.items).toHaveLength(1)
  })

  it("leaves out papers the user marked not relevant", async () => {
    const { storage, pack } = await setup()
    await recordFeedback(storage, { paperKey: "doi:10.1000/rct", title: RCT.title, kind: "not-relevant", at: "2026-10-01T00:00:00Z" })
    const fast = fastOk([verified(0, 1, 3, "prospective cohort of veterans with depression")])
    const feed = await runClinicalFeed(storage, deps({ pack, enumerate: enumerateFrom({ entry: [RCT, COHORT] }), providerOverride: { strong: strongOk(), fast } }))
    expect(feed.stats.retrieved).toBe(1)
  })

  it("refuses to run without an active watch entry", async () => {
    const { storage, pack } = await setup([watch({ id: "w1", condition: "ptsd", priority: "paused" })])
    await expect(runClinicalFeed(storage, deps({ pack, enumerate: enumerateFrom({}) }))).rejects.toThrow(/watch entry/)
  })

  it("continues with the standard queries when planning fails, and says so", async () => {
    const { storage, pack } = await setup()
    const feed = await runClinicalFeed(storage, deps({
      pack, enumerate: enumerateFrom({ entry: [RCT] }),
      providerOverride: { strong: new MockProvider([]), fast: fastOk([verified(0, 4, 4, "esketamine nasal spray or quetiapine")]) },
    }))
    expect(feed.warnings.some((w) => /standard queries only/.test(w))).toBe(true)
    expect(feed.items).toHaveLength(1)
  })

  it("keeps the previous feed when grading fails completely", async () => {
    const { storage, pack } = await setup()
    const first = await runClinicalFeed(storage, deps({ pack, enumerate: enumerateFrom({ entry: [RCT] }), providerOverride: { strong: strongOk(), fast: fastOk([verified(0, 4, 4, "esketamine nasal spray or quetiapine")]) } }))
    await expect(runClinicalFeed(storage, deps({
      pack, enumerate: enumerateFrom({ entry: [RCT] }), providerOverride: { strong: strongOk(), fast: new MockProvider([]) },
    }))).rejects.toThrow(/grading did not complete/)
    expect(await loadClinicalFeed(storage)).toEqual(first)
  })

  it("keeps the previous feed when nothing matches, but saves an empty first feed", async () => {
    const { storage, pack } = await setup()
    const empty = await runClinicalFeed(storage, deps({ pack, enumerate: enumerateFrom({}), providerOverride: { strong: strongOk(), fast: fastOk([]) } }))
    expect(empty.items).toEqual([])
    expect(await storage.read(FEED_PATH)).not.toBeNull()

    const first = await runClinicalFeed(storage, deps({ pack, enumerate: enumerateFrom({ entry: [RCT] }), providerOverride: { strong: strongOk(), fast: fastOk([verified(0, 4, 4, "esketamine nasal spray or quetiapine")]) } }))
    await expect(runClinicalFeed(storage, deps({ pack, enumerate: enumerateFrom({}), providerOverride: { strong: strongOk(), fast: fastOk([]) } }))).rejects.toThrow(/previous feed is still shown/)
    expect(await loadClinicalFeed(storage)).toEqual(first)
  })

  it("fails loudly, without touching the stored feed, when every PubMed query fails", async () => {
    const { storage, pack } = await setup()
    await expect(runClinicalFeed(storage, deps({ pack, enumerate: async () => { throw new Error("offline") }, providerOverride: { strong: strongOk(), fast: fastOk([]) } }))).rejects.toThrow(/every query/)
    expect(await storage.read(FEED_PATH)).toBeNull()
  })

  it("warns when a query matched more records than were read", async () => {
    const { storage, pack } = await setup()
    const enumerate: EnumerateFn = async () => ({ records: [RCT], total: 5000, truncated: true })
    const feed = await runClinicalFeed(storage, deps({ pack, enumerate, providerOverride: { strong: strongOk(), fast: fastOk([verified(0, 4, 4, "esketamine nasal spray or quetiapine")]) } }))
    expect(feed.warnings.some((w) => w.includes("5000") && w.includes("1 were read"))).toBe(true)
  })

  it("applies the mode and strictness settings", async () => {
    const { storage, pack } = await setup()
    await saveClinicalSettings(storage, { mode: "catch-up", strictness: "strict", catchUpMonths: 6 })
    const fast = fastOk([verified(0, 4, 4, "esketamine nasal spray or quetiapine")])
    const feed = await runClinicalFeed(storage, deps({ pack, enumerate: enumerateFrom({ entry: [RCT, COHORT] }), providerOverride: { strong: strongOk(), fast } }))
    expect(feed.mode).toBe("catch-up")
    expect(feed.stats.gated).toBe(1)
  })

  it("searches back the chosen number of months in catch up (D35)", async () => {
    const { storage, pack } = await setup()
    const seen: string[] = []
    const enumerate: EnumerateFn = async ({ query }) => { seen.push(query); return { records: [], total: 0, truncated: false } }
    const run = (catchUpMonths: 3 | 6 | 12) => saveClinicalSettings(storage, { mode: "catch-up", strictness: "standard", catchUpMonths })
      .then(() => runClinicalFeed(storage, deps({ pack, enumerate, providerOverride: { strong: strongOk(), fast: fastOk([]) } })))
    await run(3)
    expect(seen.every((query) => query.includes('"2026/07/06"[edat]'))).toBe(true)
    seen.length = 0
    await run(12)
    expect(seen.every((query) => query.includes('"2025/10/06"[edat]'))).toBe(true)
  })

  it("routes a case report to the safety area only for a safety-signal entry", async () => {
    const report = paper({ title: "Seizure after esketamine: a case report", ids: { pmid: "555" }, abstract: "A patient with depression had a seizure after esketamine.", publicationTypes: ["Case Reports"], fields: ["Depression"], date: "2026-09-25" })
    const { storage, pack } = await setup([watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine", safetySignal: true })])
    const feed = await runClinicalFeed(storage, deps({ pack, enumerate: enumerateFrom({ entry: [RCT, report] }), providerOverride: { strong: strongOk(), fast: fastOk([verified(0, 4, 4, "esketamine nasal spray or quetiapine")]) } }))
    expect(feed.safetySignals.map((s) => s.paper.ids.pmid)).toEqual(["555"])
    expect(feed.items.map((i) => i.paper.ids.pmid)).toEqual(["111"])
  })

  it("pages the stored list twelve at a time", async () => {
    const many = Array.from({ length: 30 }, (_, i) => paper({
      title: `Esketamine trial alpha${i}x beta${i}y gamma${i}z for treatment-resistant depression`, ids: { pmid: String(1000 + i) },
      abstract: "Adults with depression received esketamine nasal spray.", publicationTypes: ["Randomized Controlled Trial"], fields: ["Depression"], date: "2026-09-20",
    }))
    const { storage, pack } = await setup()
    const quote = "adults with depression received esketamine nasal spray"
    // Stage A grades 20 candidates per call, so 30 candidates take two calls.
    const fast = new MockProvider([
      llmResult({ assessments: Array.from({ length: 20 }, (_, i) => verified(i, 4, 4, quote)) }, "claude-haiku-4-5"),
      llmResult({ assessments: Array.from({ length: 10 }, (_, i) => verified(i, 4, 4, quote)) }, "claude-haiku-4-5"),
    ])
    const feed = await runClinicalFeed(storage, deps({ pack, enumerate: enumerateFrom({ entry: many }), providerOverride: { strong: strongOk(), fast } }))
    expect(feed.items).toHaveLength(30)
    expect(pageCount(feed)).toBe(3)
    expect(feedPage(feed, 0)).toHaveLength(12)
    expect(feedPage(feed, 2)).toHaveLength(6)
    expect(feedPage(feed, 3)).toEqual([])
  })
})

describe("capCandidates", () => {
  it("keeps entry-query hits, then stronger designs, then newer papers, and logs what it drops", () => {
    const fromJournal = (g: ReturnType<typeof gated>) => ({ ...g, provenance: [{ query: "q", tier: "A" as const }] })
    const entryHit = gated({ title: "Entry hit", date: "2026-01-01", ids: { pmid: "1" } }, "cohort", "k1")
    const journalRct = fromJournal(gated({ title: "Journal RCT", date: "2026-01-01", ids: { pmid: "2" } }, "randomized-trial", "k2"))
    const journalNewer = fromJournal(gated({ title: "Journal cohort", date: "2026-03-01", ids: { pmid: "3" } }, "cohort", "k3"))
    const { kept, drops } = capCandidates([journalNewer, journalRct, entryHit], 2)
    expect(kept.map((c) => c.key)).toEqual(["k1", "k2"])
    expect(drops).toEqual([{ key: "k3", title: "Journal cohort", step: "cap", reason: "over-cap:2" }])
  })
  it("does nothing under the cap", () => {
    const c = gated({ title: "x" }, "cohort", "k")
    expect(capCandidates([c], 5)).toEqual({ kept: [c], drops: [] })
  })
})

describe("runClinicalFeedSingleFlight", () => {
  it("joins a run already in progress", async () => {
    const { storage, pack } = await setup()
    const fast = fastOk([verified(0, 4, 4, "esketamine nasal spray or quetiapine")])
    const options = deps({ pack, enumerate: enumerateFrom({ entry: [RCT] }), providerOverride: { strong: strongOk(), fast } })
    const [a, b] = await Promise.all([runClinicalFeedSingleFlight(storage, options), runClinicalFeedSingleFlight(storage, options)])
    expect(a).toBe(b)
    expect(fast.calls).toHaveLength(1)
  })
})
