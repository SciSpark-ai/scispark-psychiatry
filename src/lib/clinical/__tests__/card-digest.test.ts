import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { abstractSentences, CARD_DIGEST_BATCH, digestCards } from "../digest/card"
import { runClinicalFeed } from "../feed/run"
import { loadClinicalFeed } from "../feed/stored"
import { loadLatestRunLog } from "../feed/run-log"
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

// The model points to the abstract sentence its takeaway rests on by number; code looks the sentence up.
// RCT's sentences: 1 background, 2 methods, 3 results, 4 conclusions.
const GOOD = { index: 0, headline: "Esketamine beat quetiapine for treatment-resistant depression", takeaway: "Remission at week 8 was 27% with esketamine nasal spray and 18% with quetiapine.", source: 3 }
const SENTENCE_3 = "RESULTS: Remission at week 8 was 27% with esketamine and 18% with quetiapine."
const STORED = { headline: GOOD.headline, takeaway: GOOD.takeaway, quote: SENTENCE_3, tags: [] as string[] }

describe("abstractSentences", () => {
  it("numbers the sentences of an abstract, keeping section labels", () => {
    expect(abstractSentences(RCT.abstract)).toEqual([
      "BACKGROUND: Treatment-resistant depression is hard to treat.",
      "METHODS: Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.",
      SENTENCE_3,
      "CONCLUSIONS: Esketamine was superior to quetiapine.",
    ])
  })
  it("does not split inside a decimal or an abbreviation followed by lower case", () => {
    expect(abstractSentences("The hazard ratio was 0.74 (95% CI 0.61 to 0.90) vs. placebo. It held at 12 months.")).toEqual([
      "The hazard ratio was 0.74 (95% CI 0.61 to 0.90) vs. placebo.", "It held at 12 months.",
    ])
  })
})

describe("digestCards", () => {
  it("keeps a headline and takeaway, and stores the abstract sentence the model pointed to", async () => {
    const result = await digestCards([item("k1")], opts(digests([GOOD])))
    expect(result.digests.get("k1")).toEqual(STORED)
    expect(result.dropped).toEqual([])
    expect(result.failed).toBe(false)
  })

  it("sends the abstract as numbered sentences", async () => {
    const fast = digests([GOOD])
    await digestCards([item("k1")], opts(fast))
    const sent = JSON.parse(fast.calls[0].req.messages.at(-1)!.content as string)
    expect(sent.papers[0].sentences[2]).toEqual({ n: 3, text: SENTENCE_3 })
  })

  it("tries once more for a paper whose first answer failed a check, saying what was wrong", async () => {
    const fast = new MockProvider([
      llmResult({ digests: [{ ...GOOD, takeaway: "Remission at week 8 was 62% with esketamine and 18% with quetiapine." }] }, "claude-haiku-4-5"),
      llmResult({ digests: [GOOD] }, "claude-haiku-4-5"),
    ])
    const result = await digestCards([item("k1")], opts(fast))
    expect(fast.calls).toHaveLength(2)
    expect(JSON.stringify(fast.calls[1].req.messages)).toContain("62")
    expect(result.digests.get("k1")).toEqual(STORED)
    expect(result.dropped).toEqual([])
  })

  it("drops a digest that fails twice, with the reason: a number not in the text, a sentence number that does not exist, too long", async () => {
    const long = Array.from({ length: 30 }, () => "esketamine").join(" ")
    const bad = [
      { ...GOOD, index: 0, takeaway: "Remission at week 8 was 62% with esketamine and 18% with quetiapine." },
      { ...GOOD, index: 1, source: 9 },
      { ...GOOD, index: 2, headline: long },
    ]
    const fast = new MockProvider([llmResult({ digests: bad }, "claude-haiku-4-5"), llmResult({ digests: bad }, "claude-haiku-4-5")])
    const result = await digestCards([item("a"), item("b"), item("c")], opts(fast))
    expect(result.digests.size).toBe(0)
    expect(result.dropped).toEqual([
      { key: "a", reason: "number-not-in-text:62" },
      { key: "b", reason: "no-such-sentence:9" },
      { key: "c", reason: "too-long" },
    ])
  })

  it("never throws when the model call fails: the cards simply have no digest", async () => {
    const result = await digestCards([item("k1")], opts(new MockProvider([])))
    expect(result.digests.size).toBe(0)
    expect(result.failed).toBe(true)
    expect(result.dropped).toEqual([{ key: "k1", reason: "call-failed" }])
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

  it("reuses a digest it is given and does not ask the model for that paper again", async () => {
    const fast = digests([GOOD])
    const known = new Map([["old", STORED]])
    const result = await digestCards([item("old"), item("new")], { ...opts(fast), known })
    expect(fast.calls).toHaveLength(1)
    expect(JSON.parse(fast.calls[0].req.messages.at(-1)!.content as string).papers).toHaveLength(1)
    expect(result.digests.get("old")).toEqual(STORED)
    expect(result.digests.get("new")).toEqual(STORED)
  })
})

describe("the number check reads a number the way journals print it (third real run: 4 summaries dropped for 0.74, 21,025, 8,679, 2.26)", () => {
  const lancet = paper({ title: "Drug B and relapse", ids: { pmid: "7" }, abstract: "FINDINGS: Among 21 025 patients the hazard ratio was 0·74 (95% CI 0·61–0·90).\nINTERPRETATION: Drug B was associated with fewer relapses." })
  const answer = (takeaway: string) => llmResult({ digests: [{ index: 0, headline: "Drug B linked to fewer relapses", takeaway, source: 1 }] }, "claude-haiku-4-5")
  it("accepts a decimal point where the abstract prints a middle dot, and a comma where it prints a space", async () => {
    const result = await digestCards([item("k", lancet)], opts(new MockProvider([answer("Among 21,025 patients, relapse was less likely with Drug B (hazard ratio 0.74).")])))
    expect(result.dropped).toEqual([])
    expect(result.digests.has("k")).toBe(true)
  })
  it("still rejects a number that is not in the abstract in any form", async () => {
    const wrong = answer("Among 21,025 patients, relapse was less likely with Drug B (hazard ratio 0.47).")
    const result = await digestCards([item("k", lancet)], opts(new MockProvider([wrong, wrong])))
    expect(result.dropped).toEqual([{ key: "k", reason: "number-not-in-text:0.47" }])
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
    expect(feed.items[0].digest).toEqual(STORED)
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

describe("why a paper has no AI summary is recorded", () => {
  it("writes the reasons to the run log", async () => {
    const storage = new MemoryVaultStorage()
    await saveWatchEntries(storage, [watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine", priority: "high" })])
    const grade = llmResult({ assessments: [{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "esketamine nasal spray or quetiapine" }] }, "claude-haiku-4-5")
    const bad = llmResult({ digests: [{ ...GOOD, source: 9 }] }, "claude-haiku-4-5")
    const fast = new MockProvider([grade, bad, bad])
    await runClinicalFeed(storage, { pack: await loadPsychiatryPack(), enumerate: async () => ({ records: [RCT], total: 1, truncated: false }), settings: SETTINGS, now: () => new Date("2026-10-06T10:00:00.000Z"), summarise: true, providerOverride: { strong: strongOk(), fast } })
    const log = (await loadLatestRunLog(storage))!
    expect(log.digestDrops).toEqual([{ key: "pmid:111", reason: "no-such-sentence:9" }])
  })
})

// Owner request 2026-10-07: a few tags under the AI summary, in place of upstream's "At a glance".
describe("tags of a paper", () => {
  it("keeps short tags whose words are in the paper, at most four", async () => {
    const result = await digestCards([item("k1")], opts(digests([{ ...GOOD, tags: ["Treatment-resistant depression", "esketamine", "Remission", "quetiapine", "week 8", "cardiology"] }])))
    expect(result.digests.get("k1")?.tags).toEqual(["Treatment-resistant depression", "Esketamine", "Remission", "Quetiapine"])
  })
  it("drops a tag that is long or names something the paper does not mention", async () => {
    const result = await digestCards([item("k1")], opts(digests([{ ...GOOD, tags: ["a very long tag that is really a sentence", "psilocybin", "esketamine"] }])))
    expect(result.digests.get("k1")?.tags).toEqual(["Esketamine"])
  })
  it("gives an empty list when the model sends no tags", async () => {
    const result = await digestCards([item("k1")], opts(digests([GOOD])))
    expect(result.digests.get("k1")?.tags).toEqual([])
  })
})

