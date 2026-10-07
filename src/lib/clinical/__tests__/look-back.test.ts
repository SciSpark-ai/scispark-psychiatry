import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { runClinicalFeed } from "../feed/run"
import { LOOK_BACK, lookBackOf, settingsForLookBack, windowFor } from "../modes"
import { saveClinicalSettings, saveWatchEntries } from "../watch/store"
import { ClinicalSettingsSchema } from "../types"
import { llmResult, paper, SETTINGS, strongOk, watch } from "./helpers"

// Owner decision 2026-10-07: one "look back" choice replaces What's new and Catch up.

const NOW = new Date("2026-10-07T12:00:00.000Z")
const days = (window: { from: Date; to: Date }) => Math.round((window.to.getTime() - window.from.getTime()) / 86_400_000)

describe("look back", () => {
  it("offers 3 days to 12 months and stores each as the settings the run already understands", () => {
    expect(LOOK_BACK).toEqual(["3d", "7d", "14d", "30d", "3m", "6m", "12m"])
    expect(settingsForLookBack("7d")).toEqual({ mode: "whats-new", windowDays: 7 })
    expect(settingsForLookBack("30d")).toEqual({ mode: "whats-new", windowDays: 30 })
    expect(settingsForLookBack("6m")).toEqual({ mode: "catch-up", catchUpMonths: 6 })
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
