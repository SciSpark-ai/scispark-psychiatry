import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { dismissedKeys, exemplarTitles, loadFeedback, recordFeedback } from "../feedback/store"
import { loadClinicalSettings, loadWatchEntries, newEntryId, saveClinicalSettings, saveWatchEntries, WATCH_PATH } from "../watch/store"
import { WatchEntrySchema } from "../types"
import { watch } from "./helpers"

describe("watch entries", () => {
  it("round-trips and applies defaults", async () => {
    const storage = new MemoryVaultStorage()
    await saveWatchEntries(storage, [WatchEntrySchema.parse({ id: "w1", condition: "ptsd" })])
    expect(await loadWatchEntries(storage)).toEqual([{ id: "w1", condition: "ptsd", priority: "normal", safetySignal: false }])
  })
  it("rejects an entry with neither condition nor treatment, and duplicate ids", async () => {
    const storage = new MemoryVaultStorage()
    await expect(saveWatchEntries(storage, [watch({ id: "w1" })])).rejects.toThrow()
    await expect(saveWatchEntries(storage, [watch({ id: "w1", condition: "a" }), watch({ id: "w1", condition: "b" })])).rejects.toThrow(/unique/)
  })
  it("skips a corrupt entry instead of failing the feed", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(WATCH_PATH, JSON.stringify({ version: 1, entries: [{ id: "ok", condition: "adhd" }, { nonsense: true }] }))
    expect((await loadWatchEntries(storage)).map((e) => e.id)).toEqual(["ok"])
  })
  it("returns nothing for a missing or unreadable file", async () => {
    const storage = new MemoryVaultStorage()
    expect(await loadWatchEntries(storage)).toEqual([])
    await storage.write(WATCH_PATH, "{not json")
    expect(await loadWatchEntries(storage)).toEqual([])
  })
  it("makes distinct ids", () => expect(newEntryId()).not.toBe(newEntryId()))
})

describe("clinical settings", () => {
  it("defaults to what's new and the standard gate", async () => {
    expect(await loadClinicalSettings(new MemoryVaultStorage())).toEqual({ mode: "whats-new", strictness: "standard", catchUpMonths: 6 })
  })
  it("persists a change", async () => {
    const storage = new MemoryVaultStorage()
    await saveClinicalSettings(storage, { mode: "catch-up", strictness: "strict", catchUpMonths: 3, defaultPopulation: "adults" })
    expect(await loadClinicalSettings(storage)).toEqual({ mode: "catch-up", strictness: "strict", catchUpMonths: 3, defaultPopulation: "adults" })
  })
})

describe("feedback", () => {
  it("keeps one current vote per paper", async () => {
    const storage = new MemoryVaultStorage()
    await recordFeedback(storage, { paperKey: "k1", title: "T1", kind: "relevant", at: "2026-10-01T00:00:00Z" })
    await recordFeedback(storage, { paperKey: "k1", title: "T1", kind: "not-relevant", at: "2026-10-02T00:00:00Z" })
    const events = await loadFeedback(storage)
    expect(events).toHaveLength(1)
    expect([...dismissedKeys(events)]).toEqual(["k1"])
  })
  it("uses the newest positive titles as exemplars", async () => {
    const storage = new MemoryVaultStorage()
    await recordFeedback(storage, { paperKey: "a", title: "Old", kind: "relevant", at: "2026-09-01T00:00:00Z" })
    await recordFeedback(storage, { paperKey: "b", title: "New", kind: "practice-change", at: "2026-10-01T00:00:00Z" })
    await recordFeedback(storage, { paperKey: "c", title: "Disliked", kind: "not-relevant", at: "2026-10-02T00:00:00Z" })
    expect(exemplarTitles(await loadFeedback(storage), 5)).toEqual(["New", "Old"])
    expect(exemplarTitles(await loadFeedback(storage), 1)).toEqual(["New"])
  })
})
