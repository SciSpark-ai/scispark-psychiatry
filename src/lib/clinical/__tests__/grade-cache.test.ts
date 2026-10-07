import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { CACHE_PATH, loadFeedCache } from "../feed/cache"
import { runClinicalFeed, type ClinicalFeedDeps } from "../feed/run"
import { saveWatchEntries } from "../watch/store"
import { llmResult, paper, SETTINGS, strongOk, watch } from "./helpers"

// A paper graded once keeps its grade while the watch list is unchanged (owner decision after the third
// real run: the model gave the same paper a different grade in half the cases, so the list kept changing).

const NOW = () => new Date("2026-10-06T10:00:00.000Z")
const RCT = paper({
  title: "Esketamine nasal spray versus quetiapine in treatment-resistant depression", ids: { pmid: "111" },
  abstract: "METHODS: Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.\nRESULTS: Remission at week 8 was 27% with esketamine and 18% with quetiapine.",
  publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-28",
})
const RCT2 = paper({
  title: "Intravenous ketamine for treatment-resistant depression: a randomised trial", ids: { pmid: "112" },
  abstract: "METHODS: Adults with treatment-resistant depression were randomised to ketamine or midazolam.\nRESULTS: Response was 55% with ketamine.",
  publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-27",
})
const ENTRY = watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine", priority: "high" })
const grades = (...list: unknown[]) => llmResult({ assessments: list }, "claude-haiku-4-5")
const G0 = { index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "randomised to esketamine nasal spray or quetiapine" }
const G1 = { index: 1, entryId: "w1", grade: 3, topicGrade: 4, quote: "randomised to ketamine or midazolam" }

async function setup(entries = [ENTRY]) {
  const storage = new MemoryVaultStorage()
  await saveWatchEntries(storage, entries)
  const pack = await loadPsychiatryPack()
  const run = (fast: MockProvider, records = [RCT, RCT2], extra: Partial<ClinicalFeedDeps> = {}) =>
    runClinicalFeed(storage, { pack, enumerate: async () => ({ records, total: records.length, truncated: false }), settings: SETTINGS, now: NOW, useCache: true, providerOverride: { strong: strongOk(), fast }, ...extra })
  return { storage, run }
}
const pmids = (feed: { items: Array<{ paper: { ids: { pmid?: string } } }> }) => feed.items.map((item) => item.paper.ids.pmid)

describe("the grade cache", () => {
  it("does not grade a paper again while the watch list is unchanged, and lists the same papers", async () => {
    const { run } = await setup()
    const first = await run(new MockProvider([grades(G0, G1)]))
    const fast = new MockProvider([])
    const second = await run(fast)
    expect(fast.calls).toHaveLength(0)
    expect(pmids(second)).toEqual(pmids(first))
    expect(second.items.map((item) => item.grade)).toEqual([4, 3])
  })

  it("grades only the papers that are new since the last run", async () => {
    const { run } = await setup()
    await run(new MockProvider([grades(G0)]), [RCT])
    const fast = new MockProvider([grades({ ...G1, index: 0 })])
    const second = await run(fast, [RCT, RCT2])
    expect(fast.calls).toHaveLength(1)
    expect(JSON.parse(fast.calls[0].req.messages.at(-1)!.content as string).candidates).toHaveLength(1)
    expect(pmids(second).sort()).toEqual(["111", "112"])
  })

  it("grades everything again when the watch list changes", async () => {
    const { storage, run } = await setup()
    await run(new MockProvider([grades(G0, G1)]))
    await saveWatchEntries(storage, [{ ...ENTRY, treatment: "ketamine" }])
    const fast = new MockProvider([grades(G0, G1)])
    await run(fast)
    expect(fast.calls).toHaveLength(1)
  })

  it("asks again for a paper the model skipped, and for one whose grade the quote check zeroed", async () => {
    const { run } = await setup()
    await run(new MockProvider([grades(G0)]))                                             // RCT2 skipped
    const fast = new MockProvider([grades({ ...G1, index: 0, quote: "not in the text at all" })])
    await run(fast)                                                                        // RCT2 zeroed by the quote check
    expect(JSON.parse(fast.calls[0].req.messages.at(-1)!.content as string).candidates[0].title).toBe(RCT2.title)
    const again = new MockProvider([grades({ ...G1, index: 0 })])
    const third = await run(again)
    expect(again.calls).toHaveLength(1)
    expect(pmids(third).sort()).toEqual(["111", "112"])
  })

  it("grades a paper again when its abstract has changed", async () => {
    const { run } = await setup()
    await run(new MockProvider([grades(G0)]), [RCT])
    const fast = new MockProvider([grades(G0)])
    await run(fast, [{ ...RCT, abstract: `${RCT.abstract}\nCONCLUSIONS: Esketamine was superior.` }])
    expect(fast.calls).toHaveLength(1)
  })

  it("reuses the AI summary of a paper and makes no summary call for it", async () => {
    const { run } = await setup()
    const digest = llmResult({ digests: [{ index: 0, headline: "Esketamine beat quetiapine", takeaway: "Remission at week 8 was 27% with esketamine and 18% with quetiapine.", source: 2 }] }, "claude-haiku-4-5")
    const first = await run(new MockProvider([grades(G0), digest]), [RCT], { summarise: true })
    const fast = new MockProvider([])
    const second = await run(fast, [RCT], { summarise: true })
    expect(fast.calls).toHaveLength(0)
    expect(second.items[0].digest).toEqual(first.items[0].digest)
    expect(second.items[0].digest?.headline).toBe("Esketamine beat quetiapine")
  })

  it("is off unless asked, and a corrupt cache file is treated as empty", async () => {
    const { storage, run } = await setup()
    await run(new MockProvider([grades(G0, G1)]), [RCT, RCT2], { useCache: false })
    expect(await storage.read(CACHE_PATH)).toBeNull()
    await storage.write(CACHE_PATH, "{ not json")
    expect((await loadFeedCache(storage, [ENTRY])).grades).toEqual({})
    const fast = new MockProvider([grades(G0, G1)])
    await run(fast)
    expect(fast.calls).toHaveLength(1)
  })
})
