import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { checkOverview, judgeOverview, overviewTopics, tidyOverviewSentence, writeTopicOverviews } from "../digest/topic"
import { runClinicalFeed, type ClinicalFeedDeps } from "../feed/run"
import { FEED_PATH, loadClinicalFeed } from "../feed/stored"
import { deleteHistory, listHistory, loadHistory, restoreHistory } from "../history/store"
import { loadLatestRunLog } from "../feed/run-log"
import { settingsForLookBack } from "../modes"
import { clearSeen, loadSeenTimes, recordSeen } from "../seen/store"
import { ClinicalSettingsSchema } from "../types"
import { saveClinicalSettings, saveWatchEntries } from "../watch/store"
import { llmResult, paper, SETTINGS, strongOk, watch } from "./helpers"

// Owner decisions 2026-10-07: every search is kept and can be reopened or deleted; a paper already
// shown is left out only when the same time range is searched again; each topic gets an AI overview.

const RCT = paper({
  title: "Esketamine nasal spray versus quetiapine in treatment-resistant depression", ids: { pmid: "111" },
  abstract: "METHODS: Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.\nRESULTS: Remission at week 8 was 27% with esketamine and 18% with quetiapine.",
  publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-28",
})
const RCT2 = paper({
  title: "Ketamine infusions in treatment-resistant depression: a randomised trial", ids: { pmid: "112" },
  abstract: "METHODS: Adults with treatment-resistant depression were randomised to ketamine or midazolam.\nRESULTS: Response was 55% with ketamine.",
  publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-27",
})
const ENTRY = watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine", priority: "high" })
const grades = () => llmResult({ assessments: [
  { index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "randomised to esketamine nasal spray or quetiapine" },
  { index: 1, entryId: "w1", grade: 4, topicGrade: 4, quote: "randomised to ketamine or midazolam" },
] }, "claude-haiku-4-5")

async function setup() {
  const storage = new MemoryVaultStorage()
  await saveWatchEntries(storage, [ENTRY])
  const pack = await loadPsychiatryPack()
  let tick = 0
  const run = (fast: MockProvider, extra: Partial<ClinicalFeedDeps> = {}) =>
    runClinicalFeed(storage, { pack, enumerate: async () => ({ records: [RCT, RCT2], total: 2, truncated: false }), settings: SETTINGS, now: () => new Date(Date.UTC(2026, 9, 6, 10, tick++)), keepHistory: true, providerOverride: { strong: strongOk(), fast }, ...extra })
  return { storage, run }
}

describe("history of searches", () => {
  it("keeps every search, newest first, with what it searched and how many papers it listed", async () => {
    const { storage, run } = await setup()
    const first = await run(new MockProvider([grades()]))
    const second = await run(new MockProvider([grades()]))
    const history = await listHistory(storage)
    expect(history.map((entry) => entry.generatedAt)).toEqual([second.generatedAt, first.generatedAt])
    expect(history[0]).toMatchObject({ lookBack: "30d", listed: 2, topics: ["treatment-resistant depression × esketamine"] })
    expect(await loadHistory(storage, history[1].id)).toEqual(first)
  })

  it("reopens an earlier search as the list on Home, with the topics as they were then", async () => {
    const { storage, run } = await setup()
    const first = await run(new MockProvider([grades()]))
    await recordSeen(storage, ["pmid:111", "pmid:112"], new Date(Date.UTC(2026, 9, 6, 10, 30)), "30d")
    const second = await run(new MockProvider([grades()]))
    expect(second.items).toEqual([])
    const [, earlier] = await listHistory(storage)
    await saveWatchEntries(storage, [watch({ id: "other", condition: "ADHD" })])
    await restoreHistory(storage, earlier.id)
    const reopened = await loadClinicalFeed(storage)
    expect(reopened).toEqual(first)
    expect(reopened?.topics).toEqual([{ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine" }])
  })

  it("deletes one search without touching the others or the list on Home", async () => {
    const { storage, run } = await setup()
    await run(new MockProvider([grades()]))
    const second = await run(new MockProvider([grades()]))
    const [latest, earlier] = await listHistory(storage)
    await deleteHistory(storage, earlier.id)
    expect((await listHistory(storage)).map((entry) => entry.id)).toEqual([latest.id])
    expect(JSON.parse((await storage.read(FEED_PATH)) as string).generatedAt).toBe(second.generatedAt)
  })

  it("keeps no history unless asked", async () => {
    const { storage, run } = await setup()
    await run(new MockProvider([grades()]), { keepHistory: false })
    expect(await listHistory(storage)).toEqual([])
  })
})

describe("seen papers and the time range", () => {
  it("leaves a shown paper out when the same range is searched again, and shows it again under another range", async () => {
    const { storage, run } = await setup()
    await run(new MockProvider([grades()]))
    await recordSeen(storage, ["pmid:111"], new Date(Date.UTC(2026, 9, 6, 10, 30)), "30d")
    const same = await run(new MockProvider([grades()]))
    expect(same.items.map((item) => item.paper.ids.pmid)).toEqual(["112"])

    await saveClinicalSettings(storage, ClinicalSettingsSchema.parse(settingsForLookBack("7d")))
    const other = await run(new MockProvider([grades()]))
    expect(other.items.map((item) => item.paper.ids.pmid).sort()).toEqual(["111", "112"])
  })

  it("keeps what was seen under each range apart, and reads an older file as seen under 30 days", async () => {
    const storage = new MemoryVaultStorage()
    await recordSeen(storage, ["a"], new Date("2026-10-06T10:00:00Z"), "30d")
    await recordSeen(storage, ["b"], new Date("2026-10-06T10:00:00Z"), "7d")
    expect([...(await loadSeenTimes(storage, "30d")).keys()]).toEqual(["a"])
    expect([...(await loadSeenTimes(storage, "7d")).keys()]).toEqual(["b"])
    expect([...(await loadSeenTimes(storage)).keys()].sort()).toEqual(["a", "b"])
    await storage.write(".scispark/clinical/seen.json", JSON.stringify({ version: 1, seen: { old: "2026-10-05T10:00:00.000Z" } }))
    expect([...(await loadSeenTimes(storage, "30d")).keys()]).toEqual(["old"])
    expect([...(await loadSeenTimes(storage, "7d")).keys()]).toEqual([])
  })
})

describe("the AI overview of a topic", () => {
  const papers = [
    { key: "k1", headline: "Esketamine beat quetiapine", takeaway: "Remission at week 8 was 27% with esketamine and 18% with quetiapine." },
    { key: "k2", headline: "Ketamine raised response", takeaway: "Response was 55% with ketamine." },
  ]
  it("keeps a sentence that names its papers and uses only their numbers", () => {
    const kept = checkOverview([
      { text: "Two trials favoured ketamine-type drugs, with remission of 27% against 18% in one.", sources: [1, 2] },
      { text: "Response reached 55% with ketamine.", sources: [2] },
    ], papers)
    expect(kept).toEqual([
      { text: "Two trials favoured ketamine-type drugs, with remission of 27% against 18% in one.", sources: ["k1", "k2"] },
      { text: "Response reached 55% with ketamine.", sources: ["k2"] },
    ])
  })
  // Seen on the first real run: the model also wrote its sources into the sentence, "(1)" and "[2, 3]",
  // and those digits failed the number check, so two of three topics lost their whole overview.
  it("takes source markers the model wrote into the sentence out of the text, and does not count them as numbers", () => {
    expect(checkOverview([
      { text: "Remission was 27% with esketamine (1), while ketamine raised response [2].", sources: [1, 2] },
      { text: "Both trials reported benefit (1, 2).", sources: [1, 2] },
    ], papers)).toEqual([
      { text: "Remission was 27% with esketamine, while ketamine raised response.", sources: ["k1", "k2"] },
      { text: "Both trials reported benefit.", sources: ["k1", "k2"] },
    ])
  })

  // Owner report 2026-10-07: "(1)" and the like still turned up inside overviews.
  it("reads as plain prose: no source markers of any kind, tidy spacing, a closing full stop", () => {
    for (const [written, clean] of [
      ["Remission was 27% with esketamine（1）, and ketamine raised response (papers 1 and 2)", "Remission was 27% with esketamine, and ketamine raised response."],
      ["Both trials reported benefit [1-2] .", "Both trials reported benefit."],
      ["In study 2, response was 55% with ketamine (Paper 2).", "In study 2, response was 55% with ketamine."],
      ["Both trials reported benefit ¹ ².", "Both trials reported benefit."],
    ] as const) {
      expect(tidyOverviewSentence(written)).toBe(clean)
    }
    // A stored overview written before this rule is tidied when it is shown, too.
    expect(tidyOverviewSentence("Adults with ADHD had a higher mortality risk (HR, 2.42) (1), while adherence was unchanged (2).")).toBe("Adults with ADHD had a higher mortality risk (HR, 2.42), while adherence was unchanged.")
  })

  it("drops a sentence with no valid source, with a number its sources do not contain, or that is too long", () => {
    const long = Array.from({ length: 60 }, () => "word").join(" ")
    expect(checkOverview([
      { text: "Ketamine is the best treatment.", sources: [] },
      { text: "Remission was 62% with esketamine.", sources: [1] },
      { text: "Response was 55% in the esketamine trial.", sources: [1] },
      { text: long, sources: [1] },
      { text: "Something about paper nine.", sources: [9] },
    ], papers)).toEqual([])
  })

  const twoDigests = () => llmResult({ digests: [
    { index: 0, headline: "Esketamine beat quetiapine", takeaway: "Remission at week 8 was 27% with esketamine and 18% with quetiapine.", source: 2 },
    { index: 1, headline: "Ketamine raised response", takeaway: "Response was 55% with ketamine.", source: 2 },
  ] }, "claude-haiku-4-5")
  const plan = () => llmResult({ queries: [] }, "claude-opus-4-8")
  const overviewOf = (sentences: Array<{ text: string; sources: number[] }>) => llmResult({ sentences }, "claude-opus-4-8")

  it("writes one overview per topic from the checked summaries, with the stronger model, and stores it with the list", async () => {
    const { run } = await setup()
    const strong = new MockProvider([plan(), overviewOf([{ text: "Both trials reported benefit, with remission of 27% against 18% in one.", sources: [1, 2] }])])
    const feed = await run(new MockProvider([grades(), twoDigests()]), { summarise: true, providerOverride: { strong, fast: new MockProvider([grades(), twoDigests()]) } })
    expect(feed.topicOverviews?.w1).toEqual([{ text: "Both trials reported benefit, with remission of 27% against 18% in one.", sources: ["pmid:111", "pmid:112"] }])
    const sent = JSON.parse(strong.calls[1].req.messages.at(-1)!.content as string)
    expect(sent.papers.map((entry: { n: number }) => entry.n)).toEqual([1, 2])
    expect(JSON.stringify(sent)).not.toContain("METHODS")
  })

  it("asks once more when the first overview loses sentences to the checks, saying why, and keeps the better answer", async () => {
    const { storage, run } = await setup()
    const strong = new MockProvider([
      plan(),
      overviewOf([{ text: "Remission reached 62% with esketamine.", sources: [1] }, { text: "Ketamine raised response.", sources: [] }]),
      overviewOf([{ text: "Remission was 27% with esketamine against 18% with quetiapine.", sources: [1] }, { text: "Ketamine raised response to 55%.", sources: [2] }]),
    ])
    const feed = await run(new MockProvider([]), { summarise: true, providerOverride: { strong, fast: new MockProvider([grades(), twoDigests()]) } })
    expect(strong.calls).toHaveLength(3)
    expect(JSON.stringify(strong.calls[2].req.messages)).toContain("62")
    expect(feed.topicOverviews?.w1.map((sentence) => sentence.text)).toEqual(["Remission was 27% with esketamine against 18% with quetiapine.", "Ketamine raised response to 55%."])
    expect((await loadLatestRunLog(storage))!.overviewDrops).toEqual([])
  })

  it("records why a topic has no overview", async () => {
    const { storage, run } = await setup()
    const bad = () => overviewOf([{ text: "Remission reached 62% with esketamine.", sources: [1] }])
    const strong = new MockProvider([plan(), bad(), bad()])
    const feed = await run(new MockProvider([]), { summarise: true, providerOverride: { strong, fast: new MockProvider([grades(), twoDigests()]) } })
    expect(feed.topicOverviews ?? {}).toEqual({})
    expect((await loadLatestRunLog(storage))!.overviewDrops).toEqual([{ entryId: "w1", reason: "number-not-in-sources:62" }])
  })

  it("never fails the run: no overview when the call fails", async () => {
    const { run } = await setup()
    const feed = await run(new MockProvider([grades(), twoDigests()]), { summarise: true })
    expect(feed.items).toHaveLength(2)
    expect(feed.topicOverviews ?? {}).toEqual({})
  })

  it("asks for an overview only for topics with at least two summarised papers", () => {
    const item = (key: string, entryId: string, withDigest = true) => ({ key, entryId, digest: withDigest ? { headline: "h", takeaway: "t", quote: "q" } : undefined })
    expect(overviewTopics([item("a", "w1"), item("b", "w1"), item("c", "w2"), item("d", "w3"), item("e", "w3", false)]).map((topic) => topic.entryId)).toEqual(["w1"])
  })

  // Owner request 2026-10-07: the overview as short points, the key words marked, and papers that
  // match only the condition summarised apart from those that match the whole topic.
  it("keeps which part of the topic a point is about, and the words to mark in it", () => {
    const kept = judgeOverview([
      { text: "Esketamine gave more remission than quetiapine (27% against 18%).", sources: [1], group: "focus", emphasis: ["Esketamine", "more remission", "not in the sentence"] },
      { text: "Ketamine raised response to 55%.", sources: [2], group: "related", emphasis: ["Ketamine"] },
    ], papers).kept
    expect(kept).toEqual([
      { text: "Esketamine gave more remission than quetiapine (27% against 18%).", sources: ["k1"], group: "focus", emphasis: ["Esketamine", "more remission"] },
      { text: "Ketamine raised response to 55%.", sources: ["k2"], group: "related", emphasis: ["Ketamine"] },
    ])
  })
  it("tells the model which papers match the whole topic and which only its condition", () => {
    const item = (key: string, matched: "full" | "condition") => ({ key, entryId: "w1", matched, digest: { headline: "h", takeaway: "t", quote: "q" } })
    const [topic] = overviewTopics([item("a", "condition"), item("b", "full"), item("c", "condition")])
    expect(topic.papers.map((paper) => [paper.key, paper.part])).toEqual([["b", "focus"], ["a", "related"], ["c", "related"]])
  })
})

// Owner request 2026-10-07: a way to see papers again that were already shown.
describe("showing seen papers again", () => {
  it("forgets what was seen under one time range and leaves the other ranges alone", async () => {
    const storage = new MemoryVaultStorage()
    const at = new Date("2026-10-07T10:00:00Z")
    await recordSeen(storage, ["a", "b"], at, "14d")
    await recordSeen(storage, ["b", "c"], at, "30d")
    expect(await clearSeen(storage, "14d")).toBe(2)
    expect([...(await loadSeenTimes(storage, "14d")).keys()]).toEqual([])
    expect([...(await loadSeenTimes(storage, "30d")).keys()].sort()).toEqual(["b", "c"])
    expect(await clearSeen(storage, "7d")).toBe(0)
  })
})

// Owner request 2026-10-07: a synthesis, not a list: what helped, what did not, what else was found.
describe("the overview as a synthesis", () => {
  const papers = [
    { key: "k1", headline: "Esketamine beat quetiapine", takeaway: "Remission at week 8 was 27% with esketamine and 18% with quetiapine." },
    { key: "k2", headline: "Omega-3 added nothing", takeaway: "Adding omega-3 did not reduce symptoms." },
    { key: "k3", headline: "Older age slowed improvement", takeaway: "Older age was linked to slower improvement." },
  ]
  it("keeps what each finding says about benefit", () => {
    const { kept } = judgeOverview([
      { text: "esketamine gave more remission than quetiapine", sources: [1], group: "focus", kind: "benefit", emphasis: ["esketamine"] },
      { text: "adding omega-3 did not reduce symptoms", sources: [2], group: "focus", kind: "no-benefit" },
      { text: "older age was linked to slower improvement", sources: [3], group: "related", kind: "other" },
    ], papers)
    expect(kept.map((point) => [point.kind, point.group, point.sources.length])).toEqual([["benefit", "focus", 1], ["no-benefit", "focus", 1], ["other", "related", 1]])
  })
  it("rejects a finding that runs on like a sentence about several things", () => {
    const long = "esketamine gave more remission than quetiapine and also improved sleep, appetite, energy, concentration and overall functioning across all of the groups that were studied in the trial, at every visit"
    expect(judgeOverview([{ text: long, sources: [1], kind: "benefit" }], papers).problems).toEqual(["too-long"])
  })
  it("keeps a finding that is part benefit, part none", () => {
    expect(judgeOverview([{ text: "A phone app improved adherence but not symptoms.", sources: [2], kind: "mixed" }], papers).kept[0].kind).toBe("mixed")
  })
  it("asks again when a listed paper is left out, naming it, and keeps the answer that covers more papers", async () => {
    const answer = (sentences: unknown[]) => llmResult({ sentences }, "claude-opus-4-8")
    const strong = new MockProvider([
      answer([{ text: "Esketamine gave more remission than quetiapine.", sources: [1], kind: "benefit" }]),
      answer([{ text: "Esketamine gave more remission than quetiapine.", sources: [1], kind: "benefit" }, { text: "Adding omega-3 did not reduce symptoms.", sources: [2], kind: "no-benefit" }, { text: "Older age was linked to slower improvement.", sources: [3], kind: "other" }]),
    ])
    const written = await writeTopicOverviews([{ entryId: "w1", label: "Depression", papers: papers.map((paper) => ({ ...paper, part: "focus" as const })) }], { storage: new MemoryVaultStorage(), settings: SETTINGS, providerOverride: { strong } })
    expect(strong.calls).toHaveLength(2)
    expect(JSON.parse(strong.calls[1].req.messages.at(-1)!.content as string).problems.join(" ")).toMatch(/papers? 2, 3/i)
    expect(written.overviews.w1.flatMap((sentence) => sentence.sources).sort()).toEqual(["k1", "k2", "k3"])
  })
})
