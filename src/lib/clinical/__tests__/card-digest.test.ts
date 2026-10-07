import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { CARD_DIGEST_BATCH, digestCards } from "../digest/card"
import { runClinicalFeed } from "../feed/run"
import { loadClinicalFeed } from "../feed/stored"
import { saveWatchEntries } from "../watch/store"
import { llmResult, paper, SETTINGS, strongOk, watch } from "./helpers"

// The AI-written headline and one-line takeaway on a feed card (owner request after the first real run).
// Generated text in a clinical tool, so each one must quote its source sentence and invent no numbers.

const RCT = paper({
  title: "Esketamine nasal spray versus quetiapine in treatment-resistant depression", ids: { pmid: "111" },
  abstract: "BACKGROUND: Treatment-resistant depression is hard to treat.\nMETHODS: Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.\nRESULTS: Remission at week 8 was 27% with esketamine and 18% with quetiapine.\nCONCLUSIONS: Esketamine was superior to quetiapine.",
  publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-28",
})
const item = (key: string, p = RCT) => ({ key, paper: p, design: "randomized-trial" as const })
const digests = (list: unknown[]) => new MockProvider([llmResult({ digests: list }, "claude-haiku-4-5")])
const opts = (fast: MockProvider) => ({ storage: new MemoryVaultStorage(), settings: SETTINGS, providerOverride: { fast } })

const GOOD = { index: 0, headline: "Esketamine beat quetiapine for treatment-resistant depression", takeaway: "Remission at week 8 was 27% with esketamine nasal spray and 18% with quetiapine.", quote: "Remission at week 8 was 27% with esketamine and 18% with quetiapine." }

describe("digestCards", () => {
  it("keeps a headline and takeaway whose quote is in the abstract", async () => {
    const result = await digestCards([item("k1")], opts(digests([GOOD])))
    expect(result.digests.get("k1")).toEqual({ headline: GOOD.headline, takeaway: GOOD.takeaway, quote: GOOD.quote })
    expect(result.failed).toBe(false)
  })

  it("drops a digest whose quote is not in the abstract", async () => {
    const result = await digestCards([item("k1")], opts(digests([{ ...GOOD, quote: "Esketamine cured most patients within days." }])))
    expect(result.digests.has("k1")).toBe(false)
  })

  it("drops a digest that states a number the abstract does not contain", async () => {
    const result = await digestCards([item("k1")], opts(digests([{ ...GOOD, takeaway: "Remission at week 8 was 62% with esketamine and 18% with quetiapine." }])))
    expect(result.digests.has("k1")).toBe(false)
  })

  it("drops a headline or takeaway that is too long to scan", async () => {
    const long = Array.from({ length: 30 }, () => "esketamine").join(" ")
    const result = await digestCards([item("k1"), item("k2")], opts(digests([{ ...GOOD, headline: long }, { ...GOOD, index: 1, takeaway: `${long} ${long}` }])))
    expect(result.digests.size).toBe(0)
  })

  it("never throws when the model call fails: the cards simply have no digest", async () => {
    const result = await digestCards([item("k1")], opts(new MockProvider([])))
    expect(result.digests.size).toBe(0)
    expect(result.failed).toBe(true)
  })

  it("works in batches and skips papers without an abstract", async () => {
    const many = Array.from({ length: CARD_DIGEST_BATCH + 1 }, (_, i) => item(`k${i}`))
    const noAbstract = item("none", paper({ title: "A title only record", ids: { pmid: "9" } }))
    const fast = new MockProvider([
      llmResult({ digests: Array.from({ length: CARD_DIGEST_BATCH }, (_, index) => ({ ...GOOD, index })) }, "claude-haiku-4-5"),
      llmResult({ digests: [GOOD] }, "claude-haiku-4-5"),
    ])
    const result = await digestCards([...many, noAbstract], opts(fast))
    expect(fast.calls).toHaveLength(2)
    expect(result.digests.size).toBe(CARD_DIGEST_BATCH + 1)
    expect(result.digests.has("none")).toBe(false)
  })
})

describe("runClinicalFeed with summaries", () => {
  const NOW = () => new Date("2026-10-06T10:00:00.000Z")
  const grade = llmResult({ assessments: [{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "esketamine nasal spray or quetiapine" }] }, "claude-haiku-4-5")
  async function setup() {
    const storage = new MemoryVaultStorage()
    await saveWatchEntries(storage, [watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine", priority: "high" })])
    return { storage, pack: await loadPsychiatryPack() }
  }
  const enumerate = async () => ({ records: [RCT], total: 1, truncated: false })

  it("stores the digest with the listed paper when summaries are on", async () => {
    const { storage, pack } = await setup()
    const fast = new MockProvider([grade, llmResult({ digests: [GOOD] }, "claude-haiku-4-5")])
    const feed = await runClinicalFeed(storage, { pack, enumerate, settings: SETTINGS, now: NOW, summarise: true, providerOverride: { strong: strongOk(), fast } })
    expect(feed.items[0].digest).toEqual({ headline: GOOD.headline, takeaway: GOOD.takeaway, quote: GOOD.quote })
    expect((await loadClinicalFeed(storage))!.items[0].digest?.headline).toBe(GOOD.headline)
  })

  it("still stores the feed, with a warning, when the summaries fail", async () => {
    const { storage, pack } = await setup()
    const feed = await runClinicalFeed(storage, { pack, enumerate, settings: SETTINGS, now: NOW, summarise: true, providerOverride: { strong: strongOk(), fast: new MockProvider([grade]) } })
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0].digest).toBeUndefined()
    expect(feed.warnings.some((w) => /summar/i.test(w))).toBe(true)
  })

  it("makes no summary call unless asked", async () => {
    const { storage, pack } = await setup()
    const fast = new MockProvider([grade])
    await runClinicalFeed(storage, { pack, enumerate, settings: SETTINGS, now: NOW, providerOverride: { strong: strongOk(), fast } })
    expect(fast.calls).toHaveLength(1)
  })
})
