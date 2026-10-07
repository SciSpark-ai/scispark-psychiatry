import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { runClinicalFeed } from "../feed/run"
import { JOURNAL_TIERS_PATH, JOURNAL_TIER_BOOST, journalTierOf, loadJournalTiers } from "../score/journal-tiers"
import { scoreCandidate } from "../score/score"
import { saveWatchEntries } from "../watch/store"
import { gated, grade, llmResult, paper, SETTINGS, strongOk, watch } from "./helpers"

// An optional file in the user's own vault can put journals in three tiers. A paper from a higher
// tier is listed earlier within its match layer. The file is not part of the repository or the pack.

const NOW = new Date("2026-10-06T10:00:00.000Z")
const issnOf = async (name: string) => {
  const journal = (await loadPsychiatryPack()).journals.find((entry) => entry.name === name)!
  return (journal.issn ?? journal.eissn) as string
}

describe("loadJournalTiers", () => {
  it("reads the tiers, and treats a missing or unreadable file as no tiers at all", async () => {
    const storage = new MemoryVaultStorage()
    expect((await loadJournalTiers(storage)).size).toBe(0)
    await storage.write(JOURNAL_TIERS_PATH, JSON.stringify({ version: 1, tiers: { "2215-0366": 1, "1471-244X": 3, "0000-0000": 7 } }))
    expect([...(await loadJournalTiers(storage))]).toEqual([["2215-0366", 1], ["1471-244X", 3]])
    await storage.write(JOURNAL_TIERS_PATH, "{ not json")
    expect((await loadJournalTiers(storage)).size).toBe(0)
  })
})

describe("journalTierOf", () => {
  it("uses the band the pack gives a journal, found from the title PubMed prints for it", async () => {
    const pack = await loadPsychiatryPack()
    expect(journalTierOf(pack.journals, new Map(), "The lancet. Psychiatry")).toBe(1)
    expect(journalTierOf(pack.journals, new Map(), "A journal that is not in the pack")).toBeNull()
    expect(journalTierOf(pack.journals, new Map(), undefined)).toBeNull()
  })
  it("lets the user's own tiers file overrule the pack", async () => {
    const pack = await loadPsychiatryPack()
    const tiers = new Map([[await issnOf("The Lancet Psychiatry"), 3 as const]])
    expect(journalTierOf(pack.journals, tiers, "The lancet. Psychiatry")).toBe(3)
  })
})

describe("the pack's journal bands", () => {
  it("gives every journal a band of 1, 2 or 3, with the best-known journals in band 1", async () => {
    const pack = await loadPsychiatryPack()
    expect(pack.journals.every((journal) => journal.band === 1 || journal.band === 2 || journal.band === 3)).toBe(true)
    const band = (name: string) => pack.journals.find((journal) => journal.name === name)?.band
    for (const name of ["New England Journal of Medicine", "The Lancet", "JAMA", "BMJ", "World Psychiatry", "JAMA Psychiatry", "The Lancet Psychiatry", "American Journal of Psychiatry", "Molecular Psychiatry", "Biological Psychiatry", "Schizophrenia Bulletin", "The British Journal of Psychiatry"]) {
      expect(band(name), name).toBe(1)
    }
    const counts = [1, 2, 3].map((value) => pack.journals.filter((journal) => journal.band === value).length)
    expect(counts[0]).toBeGreaterThanOrEqual(15)
    expect(counts[0]).toBeLessThan(counts[1] + counts[2])
  })
})

describe("scoring", () => {
  it("adds the tier's boost to the score and records it", async () => {
    const pack = await loadPsychiatryPack()
    const candidate = gated({ title: "A trial", date: "2026-09-20" }, "randomized-trial", "k")
    const base = scoreCandidate({ candidate, grade: grade("k", "w1", 4), mode: "whats-new", now: NOW, journals: pack.journals })
    const boosted = scoreCandidate({ candidate, grade: grade("k", "w1", 4), mode: "whats-new", now: NOW, journals: pack.journals, journalBoost: JOURNAL_TIER_BOOST[1] })
    expect(boosted.score).toBeCloseTo(Math.min(100, base.score + JOURNAL_TIER_BOOST[1]))
    expect(boosted.breakdown.journalBoost).toBe(JOURNAL_TIER_BOOST[1])
    expect(base.breakdown.journalBoost ?? 0).toBe(0)
  })
})

describe("a run", () => {
  const PLAIN = paper({ title: "Sertraline in schizophrenia with depression: a trial", ids: { pmid: "201" }, abstract: "Adults with schizophrenia received sertraline.", publicationTypes: ["Randomized Controlled Trial"], fields: ["Schizophrenia"], date: "2026-09-20", venue: "BMC psychiatry" })
  const LEADING = paper({ title: "Aripiprazole in schizophrenia: a trial", ids: { pmid: "202" }, abstract: "Adults with schizophrenia received aripiprazole.", publicationTypes: ["Randomized Controlled Trial"], fields: ["Schizophrenia"], date: "2026-09-20", venue: "The lancet. Psychiatry" })
  const assessments = llmResult({ assessments: [
    { index: 0, entryId: "s", grade: 4, topicGrade: 4, quote: "Adults with schizophrenia received sertraline", conditionMatch: true, treatmentMatch: null },
    { index: 1, entryId: "s", grade: 4, topicGrade: 4, quote: "Adults with schizophrenia received aripiprazole", conditionMatch: true, treatmentMatch: null },
  ] }, "claude-haiku-4-5")

  async function run(tiers?: Record<string, number>) {
    const storage = new MemoryVaultStorage()
    await saveWatchEntries(storage, [watch({ id: "s", condition: "Schizophrenia" })])
    if (tiers) await storage.write(JOURNAL_TIERS_PATH, JSON.stringify({ version: 1, tiers }))
    const feed = await runClinicalFeed(storage, { pack: await loadPsychiatryPack(), enumerate: async () => ({ records: [PLAIN, LEADING], total: 2, truncated: false }), settings: SETTINGS, now: () => NOW, providerOverride: { strong: strongOk(), fast: new MockProvider([assessments]) } })
    return feed.items.map((item) => item.paper.ids.pmid)
  }

  it("lists the paper from the higher-band journal first", async () => {
    expect(await run()).toEqual(["202", "201"])
  })
  it("follows the user's own tiers file when the vault has one", async () => {
    expect(await run({ [await issnOf("The Lancet Psychiatry")]: 3, [await issnOf("BMC Psychiatry")]: 1 })).toEqual(["201", "202"])
  })
})
