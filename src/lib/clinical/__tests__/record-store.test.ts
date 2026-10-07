import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadPsychiatryPack } from "../pack/load"
import { handleRefresh } from "../feed/refresh-handler"
import { loadRecordStore, RECORDS_PATH } from "../retrieve/record-store"
import { saveWatchEntries } from "../watch/store"
import type { PaperRecord } from "../../papers/types"
import { fastOk, paper, SETTINGS, strongOk, watch } from "./helpers"

const NOW = new Date("2026-10-07T12:00:00.000Z")
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000)
const indexed: PaperRecord = paper({ title: "An indexed record", ids: { pmid: "1" }, fields: ["Depression"], publicationTypes: ["Journal Article", "Randomized Controlled Trial"] })
const fresh: PaperRecord = paper({ title: "A record PubMed has not indexed yet", ids: { pmid: "2" }, publicationTypes: ["Journal Article"] })

describe("the local record store", () => {
  it("keeps records between runs", async () => {
    const storage = new MemoryVaultStorage()
    const first = await loadRecordStore(storage, NOW)
    first.put(indexed)
    await first.save()
    const second = await loadRecordStore(storage, NOW)
    expect(second.get("1")?.title).toBe("An indexed record")
    expect(second.get("9")).toBeUndefined()
  })

  it("asks again for a record PubMed had not indexed when it was read, once a week has passed", async () => {
    const storage = new MemoryVaultStorage()
    const then = await loadRecordStore(storage, daysAgo(10))
    then.put(indexed)
    then.put(fresh)
    await then.save()
    const now = await loadRecordStore(storage, NOW)
    expect(now.get("1")).toBeDefined()
    expect(now.get("2")).toBeUndefined()
    const soon = await loadRecordStore(storage, daysAgo(8))
    expect(soon.get("2")).toBeDefined()
  })

  it("treats an unreadable file as empty", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(RECORDS_PATH, "{ not json")
    expect((await loadRecordStore(storage, NOW)).get("1")).toBeUndefined()
  })
})

describe("a refresh that keeps the records it reads", () => {
  it("hands the store to the search, and saves what the search put in it", async () => {
    const storage = new MemoryVaultStorage()
    await saveWatchEntries(storage, [watch({ id: "w1", condition: "depression", treatment: "esketamine" })])
    const RCT = paper({ title: "Esketamine nasal spray in depression", ids: { pmid: "77" }, abstract: "Adults with depression received esketamine nasal spray.", publicationTypes: ["Randomized Controlled Trial"], fields: ["Depression"], date: "2026-10-01" })
    const held: Array<string | undefined> = []
    await handleRefresh(storage, () => {}, {
      loadPack: loadPsychiatryPack, settings: SETTINGS, now: () => NOW,
      enumerate: async () => { throw new Error("the plain search must not be used when a record store is offered") },
      enumerateWithRecords: (records) => async () => { held.push(records.get("77")?.title); records.put(RCT); return { records: [RCT], total: 1, truncated: false } },
      providerOverride: { strong: strongOk(), fast: fastOk([{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "received esketamine nasal spray" }]) },
    })
    expect(held[0]).toBeUndefined()
    expect((await loadRecordStore(storage, NOW)).get("77")?.title).toBe("Esketamine nasal spray in depression")
  })
})
