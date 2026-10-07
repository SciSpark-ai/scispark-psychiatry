import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { checkOverview, overviewTopics } from "../digest/topic"
import { runClinicalFeed, type ClinicalFeedDeps } from "../feed/run"
import { FEED_PATH, loadClinicalFeed } from "../feed/stored"
import { deleteHistory, listHistory, loadHistory, restoreHistory } from "../history/store"
import { settingsForLookBack } from "../modes"
import { loadSeenTimes, recordSeen } from "../seen/store"
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

  it("writes one overview per topic from the checked summaries, and stores it with the list", async () => {
    const { run } = await setup()
    const digests = llmResult({ digests: [
      { index: 0, headline: "Esketamine beat quetiapine", takeaway: "Remission at week 8 was 27% with esketamine and 18% with quetiapine.", source: 2 },
      { index: 1, headline: "Ketamine raised response", takeaway: "Response was 55% with ketamine.", source: 2 },
    ] }, "claude-haiku-4-5")
    const overview = llmResult({ sentences: [{ text: "Both trials reported benefit, with remission of 27% against 18% in one.", sources: [1, 2] }] }, "claude-haiku-4-5")
    const fast = new MockProvider([grades(), digests, overview])
    const feed = await run(fast, { summarise: true })
    expect(feed.topicOverviews?.w1).toEqual([{ text: "Both trials reported benefit, with remission of 27% against 18% in one.", sources: ["pmid:111", "pmid:112"] }])
    const sent = JSON.parse(fast.calls[2].req.messages.at(-1)!.content as string)
    expect(sent.papers.map((entry: { n: number }) => entry.n)).toEqual([1, 2])
    expect(JSON.stringify(sent)).not.toContain("METHODS")
  })

  it("never fails the run: no overview when the call fails or nothing passes the checks", async () => {
    const { run } = await setup()
    const digests = llmResult({ digests: [{ index: 0, headline: "Esketamine beat quetiapine", takeaway: "Remission at week 8 was 27% with esketamine and 18% with quetiapine.", source: 2 }, { index: 1, headline: "Ketamine raised response", takeaway: "Response was 55% with ketamine.", source: 2 }] }, "claude-haiku-4-5")
    const feed = await run(new MockProvider([grades(), digests]), { summarise: true })
    expect(feed.items).toHaveLength(2)
    expect(feed.topicOverviews ?? {}).toEqual({})
  })

  it("asks for an overview only for topics with at least two summarised papers", () => {
    const item = (key: string, entryId: string, withDigest = true) => ({ key, entryId, digest: withDigest ? { headline: "h", takeaway: "t", quote: "q" } : undefined })
    expect(overviewTopics([item("a", "w1"), item("b", "w1"), item("c", "w2"), item("d", "w3"), item("e", "w3", false)]).map((topic) => topic.entryId)).toEqual(["w1"])
  })
})
