// src/lib/clinical/__tests__/records-store.test.ts
import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { listReviews } from "../../wiki/review-queue"
import { RecordConflictError, RecordNotFoundError, editField, isRecordSlug, listRecords, loadRecord, saveRecord } from "../records/store"
import { getField } from "../records/schema"
import { RECORD } from "./records-fixture"

const NOW = () => new Date("2026-10-07T10:00:00.000Z")

describe("the record store", () => {
  it("stores a record as a file the vault export carries, through a changeset", async () => {
    const storage = new MemoryVaultStorage()
    await saveRecord(storage, RECORD, { now: NOW })
    expect(JSON.parse((await storage.read("records/esketamine-versus-quetiapine.json")) as string).paperKey).toBe("pmid:111")
    expect((await loadRecord(storage, RECORD.slug))?.arms).toHaveLength(2)
    expect((await listRecords(storage)).map((record) => record.slug)).toEqual([RECORD.slug])
    expect((await storage.list(".scispark/changesets/")).length).toBe(1)
  })

  it("puts one entry in the review inbox for a new record, and not another when it is saved again", async () => {
    const storage = new MemoryVaultStorage()
    await saveRecord(storage, RECORD, { now: NOW })
    await saveRecord(storage, { ...RECORD, droppedFields: 2 }, { now: NOW })
    const reviews = await listReviews(storage)
    expect(reviews.map((item) => [item.kind, item.paperSlug])).toEqual([["extraction-review", RECORD.slug]])
  })

  it("reads a missing, damaged or foreign file as no record, and refuses a slug that is not one", async () => {
    const storage = new MemoryVaultStorage()
    expect(await loadRecord(storage, "nothing-here")).toBeNull()
    await storage.write("records/broken.json", "{ not json")
    await storage.write("records/other.json", JSON.stringify({ hello: 1 }))
    expect(await loadRecord(storage, "broken")).toBeNull()
    expect(await listRecords(storage)).toEqual([])
    expect(isRecordSlug("../.scispark/settings")).toBe(false)
    expect(isRecordSlug("")).toBe(false)
    expect(await loadRecord(storage, "../.scispark/settings")).toBeNull()
  })

  it("confirms a field, and edits one, each as its own undoable changeset", async () => {
    const storage = new MemoryVaultStorage()
    await saveRecord(storage, RECORD, { now: NOW })
    const seen = getField(RECORD, "arms.a1.n")!
    const confirmed = await editField(storage, RECORD.slug, "arms.a1.n", { action: "confirm" }, seen, { now: NOW })
    expect(getField(confirmed, "arms.a1.n")).toEqual({ ...seen, state: "human-confirmed" })
    const edited = await editField(storage, RECORD.slug, "arms.a2.n", { action: "edit", value: 341 }, getField(RECORD, "arms.a2.n")!, { now: NOW })
    // A value a person typed has no source sentence of the model's.
    expect(getField(edited, "arms.a2.n")).toEqual({ value: 341, quote: null, state: "human-edited" })
    expect(getField((await loadRecord(storage, RECORD.slug))!, "arms.a1.n")?.state).toBe("human-confirmed")
    expect((await storage.list(".scispark/changesets/")).length).toBe(3)
  })

  it("refuses a stale edit, an edit of the wrong kind, an unknown field and an unknown record", async () => {
    const storage = new MemoryVaultStorage()
    await saveRecord(storage, RECORD, { now: NOW })
    const seen = getField(RECORD, "arms.a1.n")!
    await editField(storage, RECORD.slug, "arms.a1.n", { action: "edit", value: 337 }, seen, { now: NOW })
    // A second tab still shows 336.
    await expect(editField(storage, RECORD.slug, "arms.a1.n", { action: "confirm" }, seen, { now: NOW })).rejects.toBeInstanceOf(RecordConflictError)
    await expect(editField(storage, RECORD.slug, "arms.a2.n", { action: "edit", value: "many" }, getField(RECORD, "arms.a2.n")!, { now: NOW })).rejects.toThrow(/number/)
    await expect(editField(storage, RECORD.slug, "arms.a2.n", { action: "edit", value: Number.NaN }, getField(RECORD, "arms.a2.n")!, { now: NOW })).rejects.toThrow(/number/)
    await expect(editField(storage, RECORD.slug, "arms.zz.n", { action: "confirm" }, seen, { now: NOW })).rejects.toThrow(/no such field/)
    await expect(editField(storage, "nothing-here", "arms.a1.n", { action: "confirm" }, seen, { now: NOW })).rejects.toBeInstanceOf(RecordNotFoundError)
    // An unknown value cannot be confirmed: there is nothing to confirm.
    await expect(editField(storage, RECORD.slug, "outcomes.o1.results.a1.mean", { action: "confirm" }, getField(RECORD, "outcomes.o1.results.a1.mean")!, { now: NOW })).rejects.toThrow(/nothing to confirm/)
  })
})
