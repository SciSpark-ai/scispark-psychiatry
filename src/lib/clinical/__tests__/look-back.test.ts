import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { runClinicalFeed } from "../feed/run"
import { LOOK_BACK, lookBackOf, lookBackPhrase, settingsForLookBack, settingsForRange, windowFor } from "../modes"
import { saveClinicalSettings, saveWatchEntries } from "../watch/store"
import { ClinicalSettingsSchema } from "../types"
import { llmResult, paper, SETTINGS, strongOk, watch } from "./helpers"

// Owner decision 2026-10-07: one "look back" choice replaces What's new and Catch up.

const NOW = new Date("2026-10-07T12:00:00.000Z")
const days = (window: { from: Date; to: Date }) => Math.round((window.to.getTime() - window.from.getTime()) / 86_400_000)

describe("look back", () => {
  it("offers 3 days to 12 months and stores each as the settings the run already understands", () => {
    expect(LOOK_BACK).toEqual(["3d", "7d", "14d", "30d", "3m", "6m", "12m"])
    expect(settingsForLookBack("7d")).toMatchObject({ mode: "whats-new", windowDays: 7 })
    expect(settingsForLookBack("30d")).toMatchObject({ mode: "whats-new", windowDays: 30 })
    expect(settingsForLookBack("6m")).toMatchObject({ mode: "catch-up", catchUpMonths: 6 })
    for (const key of LOOK_BACK) expect(lookBackOf(ClinicalSettingsSchema.parse(settingsForLookBack(key)))).toBe(key)
    expect(lookBackOf(ClinicalSettingsSchema.parse({}))).toBe("30d")
  })

  it("looks back that many days for the short choices, and calendar months for the long ones", () => {
    expect(days(windowFor("whats-new", NOW, 6, 3))).toBe(3)
    expect(days(windowFor("whats-new", NOW, 6, 14))).toBe(14)
    expect(days(windowFor("whats-new", NOW))).toBe(30)
    expect(windowFor("catch-up", NOW, 3).from.toISOString().slice(0, 10)).toBe("2026-07-07")
  })

  it("searches PubMed over the chosen days and records the choice with the list", async () => {
    const storage = new MemoryVaultStorage()
    await saveWatchEntries(storage, [watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine" })])
    await saveClinicalSettings(storage, ClinicalSettingsSchema.parse(settingsForLookBack("7d")))
    const RCT = paper({ title: "Esketamine nasal spray in treatment-resistant depression", ids: { pmid: "1" }, abstract: "Adults were randomised to esketamine nasal spray or placebo.", publicationTypes: ["Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-10-05" })
    const queries: string[] = []
    const fast = new MockProvider([llmResult({ assessments: [{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "randomised to esketamine nasal spray or placebo" }] }, "claude-haiku-4-5")])
    const feed = await runClinicalFeed(storage, { pack: await loadPsychiatryPack(), enumerate: async ({ query }) => { queries.push(query); return { records: [RCT], total: 1, truncated: false } }, settings: SETTINGS, now: () => NOW, providerOverride: { strong: strongOk(), fast } })
    expect(queries[0]).toContain('"2026/09/30"[edat]')
    expect(feed.lookBack).toBe("7d")
  })
})

// Owner decision 2026-10-07: a search over chosen dates, in the same control.
describe("a search over chosen dates", () => {
  it("is stored as a range, named by its dates, and cleared by any fixed choice", () => {
    expect(settingsForRange("2026-09-01", "2026-09-15")).toEqual({ range: { from: "2026-09-01", to: "2026-09-15" } })
    expect(settingsForRange("2026-09-15", "2026-09-01")).toBeNull()
    expect(settingsForRange("2026-09-01", "")).toBeNull()
    expect(settingsForRange("01/09/2026", "2026-09-15")).toBeNull()
    const custom = ClinicalSettingsSchema.parse({ range: { from: "2026-09-01", to: "2026-09-15" } })
    expect(lookBackOf(custom)).toBe("2026-09-01..2026-09-15")
    expect(lookBackOf(ClinicalSettingsSchema.parse({ ...custom, ...settingsForLookBack("7d") }))).toBe("7d")
    expect(lookBackPhrase("7d")).toBe("last 1 week")
    expect(lookBackPhrase("2026-09-01..2026-09-15")).toBe("2026-09-01 to 2026-09-15")
  })

  it("searches PubMed over exactly those dates, and ranks as a long look-back when the range is long", async () => {
    const storage = new MemoryVaultStorage()
    await saveWatchEntries(storage, [watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine" })])
    const RCT = paper({ title: "Esketamine nasal spray in treatment-resistant depression", ids: { pmid: "1" }, abstract: "Adults were randomised to esketamine nasal spray or placebo.", publicationTypes: ["Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-03-05" })
    const run = async (from: string, to: string) => {
      await saveClinicalSettings(storage, ClinicalSettingsSchema.parse({ range: { from, to } }))
      const queries: string[] = []
      const fast = new MockProvider([llmResult({ assessments: [{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "randomised to esketamine nasal spray or placebo" }] }, "claude-haiku-4-5")])
      const feed = await runClinicalFeed(storage, { pack: await loadPsychiatryPack(), enumerate: async ({ query }) => { queries.push(query); return { records: [RCT], total: 1, truncated: false } }, settings: SETTINGS, now: () => NOW, providerOverride: { strong: strongOk(), fast } })
      return { feed, query: queries[0] }
    }
    const short = await run("2026-03-01", "2026-03-15")
    expect(short.query).toContain('"2026/03/01"[edat] : "2026/03/15"[edat]')
    expect(short.feed.lookBack).toBe("2026-03-01..2026-03-15")
    expect(short.feed.mode).toBe("whats-new")
    const long = await run("2026-01-01", "2026-06-30")
    expect(long.feed.mode).toBe("catch-up")
  })
})
