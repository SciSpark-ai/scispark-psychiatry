// src/lib/clinical/__tests__/records-store.test.ts
import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { listReviews } from "../../wiki/review-queue"
import { TaxonomySchema } from "../pack/schema"
import { RecordConflictError, RecordExistsError, RecordNotFoundError, editField, isRecordSlug, listRecords, loadRecord, readRecord, saveRecord } from "../records/store"
import { PATHS, getField } from "../records/schema"
import { outcomeEffect } from "../records/effects"
import { RECORD, num, unconfirmed } from "./records-fixture"

const NOW = () => new Date("2026-10-07T10:00:00.000Z")
const FILE = "records/esketamine-versus-quetiapine.json"
const TAXONOMY = TaxonomySchema.parse({ version: "t", nodes: [
  { id: "depression", type: "condition", name: "Major depressive disorder", synonyms: ["depression"] },
  { id: "treatment-resistant-depression", type: "condition", name: "Treatment-resistant depression", parents: ["depression"] },
  { id: "esketamine", type: "treatment", name: "Esketamine", modality: "drug", synonyms: ["intranasal esketamine"] },
  { id: "ketamine", type: "treatment", name: "Ketamine", modality: "drug" },
  { id: "quetiapine", type: "treatment", name: "Quetiapine", modality: "drug", brands: ["Seroquel"] },
] })
const saved = async (record = RECORD) => { const storage = new MemoryVaultStorage(); await saveRecord(storage, record, { now: NOW }); return storage }

describe("the record store", () => {
  it("stores a record as a file the vault export carries, through a changeset", async () => {
    const storage = new MemoryVaultStorage()
    await saveRecord(storage, RECORD, { now: NOW })
    expect(JSON.parse((await storage.read("records/esketamine-versus-quetiapine.json")) as string).paperKey).toBe("pmid:111")
    expect((await loadRecord(storage, RECORD.slug))?.arms).toHaveLength(2)
    expect((await listRecords(storage)).map((record) => record.slug)).toEqual([RECORD.slug])
    expect((await storage.list(".scispark/changesets/")).length).toBe(1)
  })

  it("refuses to store a record where one is stored already, and leaves the stored one and its one inbox entry as they are", async () => {
    const storage = await saved()
    const before = await storage.read(FILE)
    await expect(saveRecord(storage, { ...RECORD, droppedFields: 2 }, { now: NOW })).rejects.toBeInstanceOf(RecordExistsError)
    expect(await storage.read(FILE)).toBe(before)
    expect((await storage.list(".scispark/changesets/")).length).toBe(1)
    const reviews = await listReviews(storage)
    expect(reviews.map((item) => [item.kind, item.paperSlug])).toEqual([["extraction-review", RECORD.slug]])
  })

  it("does not overwrite a file it cannot read", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(FILE, "{ not json")
    expect(await loadRecord(storage, RECORD.slug)).toBeNull()
    expect(await readRecord(storage, RECORD.slug)).toEqual({ stored: true, record: null })
    expect(await readRecord(storage, "nothing-here")).toEqual({ stored: false, record: null })
    await expect(saveRecord(storage, RECORD, { now: NOW })).rejects.toBeInstanceOf(RecordExistsError)
    expect(await storage.read(FILE)).toBe("{ not json")
    expect(await listReviews(storage)).toEqual([])
  })

  it("stores one of two records saved at the same moment and refuses the other", async () => {
    const storage = new MemoryVaultStorage()
    const results = await Promise.allSettled([saveRecord(storage, RECORD, { now: NOW }), saveRecord(storage, { ...RECORD, droppedFields: 2 }, { now: NOW })])
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"])
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(RecordExistsError)
    expect((await loadRecord(storage, RECORD.slug))?.droppedFields).toBe(0)
    expect((await storage.list(".scispark/changesets/")).length).toBe(1)
  })

  it("replaces a stored record only when told to, without a second inbox entry", async () => {
    const storage = await saved()
    await saveRecord(storage, { ...RECORD, droppedFields: 2 }, { now: NOW, replace: true })
    expect((await loadRecord(storage, RECORD.slug))?.droppedFields).toBe(2)
    expect(await listReviews(storage)).toHaveLength(1)
  })

  it("reads a record stored before the check states were kept", async () => {
    const storage = new MemoryVaultStorage()
    const old = JSON.parse(JSON.stringify(RECORD)) as { arms: Array<Record<string, unknown>>; outcomes: Array<Record<string, unknown>> }
    for (const arm of old.arms) delete arm.roleState
    for (const outcome of old.outcomes) { delete outcome.lowerIsBetterState; delete outcome.primaryState }
    await storage.write(FILE, JSON.stringify(old))
    const record = (await loadRecord(storage, RECORD.slug))!
    expect(record.arms[0].roleState).toBe("unverified")
    expect(outcomeEffect(record.outcomes[0], record.arms).direction).toBe("unconfirmed")
    expect(await listRecords(storage)).toHaveLength(1)
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

  it("confirms and sets the direction of benefit, the role of an arm and the primary mark, like any other field", async () => {
    const fresh = unconfirmed(RECORD)
    const storage = await saved(fresh)
    const benefit = PATHS.benefit("o2")
    const confirmed = await editField(storage, RECORD.slug, benefit, { action: "confirm" }, getField(fresh, benefit)!, { now: NOW })
    expect(getField(confirmed, benefit)).toEqual({ value: true, quote: null, state: "human-confirmed" })
    const set = await editField(storage, RECORD.slug, benefit, { action: "edit", value: false }, getField(confirmed, benefit)!, { now: NOW })
    expect(getField(set, benefit)).toEqual({ value: false, quote: null, state: "human-edited" })
    const unclear = await editField(storage, RECORD.slug, benefit, { action: "edit", value: null }, getField(set, benefit)!, { now: NOW })
    expect(getField(unclear, benefit)).toEqual({ value: null, quote: null, state: "human-edited" })
    const role = await editField(storage, RECORD.slug, PATHS.role("a2"), { action: "edit", value: "treatment" }, getField(fresh, PATHS.role("a2"))!, { now: NOW })
    expect(role.arms[1]).toMatchObject({ role: "treatment", roleState: "human-edited" })
    const primary = await editField(storage, RECORD.slug, PATHS.primary("o2"), { action: "edit", value: true }, getField(fresh, PATHS.primary("o2"))!, { now: NOW })
    expect(primary.outcomes.map((outcome) => outcome.primary)).toEqual([false, true])
    // The numbers and their sentences are untouched.
    expect(primary.outcomes[1].results).toEqual(fresh.outcomes[1].results)
    expect((await loadRecord(storage, RECORD.slug))!.outcomes.map((outcome) => outcome.primary)).toEqual([false, true])
  })

  it("lets a person confirm that the paper does not make the direction of benefit clear", async () => {
    const fresh = unconfirmed({ ...RECORD, outcomes: [RECORD.outcomes[0], { ...RECORD.outcomes[1], lowerIsBetter: null }] })
    const storage = await saved(fresh)
    const confirmed = await editField(storage, RECORD.slug, PATHS.benefit("o2"), { action: "confirm" }, getField(fresh, PATHS.benefit("o2"))!, { now: NOW })
    expect(getField(confirmed, PATHS.benefit("o2"))).toEqual({ value: null, quote: null, state: "human-confirmed" })
  })

  it("refuses a value a choice cannot take, and a stale choice", async () => {
    const fresh = unconfirmed(RECORD)
    const storage = await saved(fresh)
    const edit = (path: string, value: unknown) => editField(storage, RECORD.slug, path, { action: "edit", value: value as never }, getField(fresh, path)!, { now: NOW })
    await expect(edit(PATHS.benefit("o1"), "lower")).rejects.toThrow(/not one of the choices/)
    await expect(edit(PATHS.benefit("o1"), 1)).rejects.toThrow(/not one of the choices/)
    await expect(edit(PATHS.role("a1"), "placebo")).rejects.toThrow(/not one of the choices/)
    await expect(edit(PATHS.role("a1"), null)).rejects.toThrow(/not one of the choices/)
    await expect(edit(PATHS.primary("o1"), null)).rejects.toThrow(/not one of the choices/)
    await edit(PATHS.benefit("o1"), true)
    await expect(edit(PATHS.benefit("o1"), false)).rejects.toBeInstanceOf(RecordConflictError)
    expect((await storage.list(".scispark/changesets/")).length).toBe(2)
  })

  it("shows no direction for the model's wrong direction of benefit, and the right one once the reader sets it (the reviewed scenario)", async () => {
    // Mean reductions: a larger number is better. The model said lower is better.
    const reductions = { ...RECORD.outcomes[1], lowerIsBetter: true, results: [{ ...RECORD.outcomes[1].results[0], mean: num(12.0), sd: num(8.0) }, { ...RECORD.outcomes[1].results[1], mean: num(8.0), sd: num(8.0) }] }
    const fresh = unconfirmed({ ...RECORD, outcomes: [RECORD.outcomes[0], reductions] })
    const storage = await saved(fresh)
    let record = fresh
    // The reader confirms every number, and the roles. Still no direction.
    for (const path of ["arms.a1.n", "arms.a2.n", PATHS.role("a1"), PATHS.role("a2"), ...(["n", "mean", "sd"] as const).flatMap((key) => [PATHS.result("o2", "a1", key), PATHS.result("o2", "a2", key)])]) {
      record = await editField(storage, RECORD.slug, path, { action: "confirm" }, getField(record, path)!, { now: NOW })
    }
    expect(outcomeEffect(record.outcomes[1], record.arms).direction).toBe("unconfirmed")
    record = await editField(storage, RECORD.slug, PATHS.benefit("o2"), { action: "edit", value: false }, getField(record, PATHS.benefit("o2"))!, { now: NOW })
    expect(outcomeEffect(record.outcomes[1], record.arms).direction).toBe("favours-treatment")
  })

  it("files an arm under the pack's term for its corrected name, and under nothing when the pack has no such term", async () => {
    const storage = await saved()
    const path = "arms.a1.treatment"
    const corrected = await editField(storage, RECORD.slug, path, { action: "edit", value: "ketamine" }, getField(RECORD, path)!, { now: NOW, taxonomy: TAXONOMY })
    expect(corrected.arms[0]).toMatchObject({ treatment: { value: "ketamine", quote: null, state: "human-edited" }, treatmentCode: "ketamine" })
    const brand = await editField(storage, RECORD.slug, "arms.a2.treatment", { action: "edit", value: "  seroquel " }, getField(corrected, "arms.a2.treatment")!, { now: NOW, taxonomy: TAXONOMY })
    expect(brand.arms[1].treatmentCode).toBe("quetiapine")
    const unknown = await editField(storage, RECORD.slug, path, { action: "edit", value: "ketamine-like compound X" }, getField(brand, path)!, { now: NOW, taxonomy: TAXONOMY })
    expect(unknown.arms[0].treatmentCode).toBeNull()
    // A condition is not a treatment: its name files no arm.
    const wrongType = await editField(storage, RECORD.slug, path, { action: "edit", value: "depression" }, getField(unknown, path)!, { now: NOW, taxonomy: TAXONOMY })
    expect(wrongType.arms[0].treatmentCode).toBeNull()
    expect((await loadRecord(storage, RECORD.slug))!.arms[1].treatmentCode).toBe("quetiapine")
  })

  it("files the record under the pack's term for its corrected condition, and clears a code it cannot derive again", async () => {
    const storage = await saved()
    const condition = await editField(storage, RECORD.slug, "condition", { action: "edit", value: "Depression" }, RECORD.condition, { now: NOW, taxonomy: TAXONOMY })
    expect(condition.conditionCode).toBe("depression")
    const cleared = await editField(storage, RECORD.slug, "condition", { action: "edit", value: null }, condition.condition, { now: NOW, taxonomy: TAXONOMY })
    expect(cleared.conditionCode).toBeNull()
    // Without the pack the code of a corrected name cannot be known: it is not kept.
    const blind = await editField(storage, RECORD.slug, "arms.a1.treatment", { action: "edit", value: "ketamine" }, getField(RECORD, "arms.a1.treatment")!, { now: NOW })
    expect(blind.arms[0].treatmentCode).toBeNull()
    // Confirming a name changes nothing about where it is filed.
    const confirmed = await editField(storage, RECORD.slug, "arms.a2.treatment", { action: "confirm" }, getField(RECORD, "arms.a2.treatment")!, { now: NOW, taxonomy: TAXONOMY })
    expect(confirmed.arms[1].treatmentCode).toBe("quetiapine")
  })

  it("lets a person change what the condition or an arm is filed under, to a term of the pack of the right kind or to nothing", async () => {
    const storage = await saved()
    const file = (path: string, value: unknown, seen: string | null) => editField(storage, RECORD.slug, path, { action: "edit", value: value as never }, { value: seen }, { now: NOW, taxonomy: TAXONOMY })
    const refiled = await file(PATHS.treatmentCode("a1"), "ketamine", "esketamine")
    expect(refiled.arms[0].treatmentCode).toBe("ketamine")
    // The text and its state are the reader's own business: filing does not touch them.
    expect(refiled.arms[0].treatment).toEqual(RECORD.arms[0].treatment)
    expect((await file(PATHS.treatmentCode("a1"), null, "ketamine")).arms[0].treatmentCode).toBeNull()
    expect((await file(PATHS.conditionCode, "depression", "treatment-resistant-depression")).conditionCode).toBe("depression")
    await expect(file(PATHS.conditionCode, "ketamine", "depression")).rejects.toThrow(/not in the pack/)
    await expect(file(PATHS.treatmentCode("a2"), "depression", "quetiapine")).rejects.toThrow(/not in the pack/)
    await expect(file(PATHS.treatmentCode("a2"), "made-up", "quetiapine")).rejects.toThrow(/not in the pack/)
    await expect(file(PATHS.treatmentCode("a2"), 7, "quetiapine")).rejects.toThrow(/not in the pack/)
    await expect(file(PATHS.treatmentCode("a2"), "ketamine", "esketamine")).rejects.toBeInstanceOf(RecordConflictError)
    await expect(editField(storage, RECORD.slug, PATHS.treatmentCode("a2"), { action: "confirm" }, { value: "quetiapine" }, { now: NOW, taxonomy: TAXONOMY })).rejects.toThrow(/not understood/)
    // Without the pack nothing can be checked, so nothing but "not filed" is taken.
    await expect(editField(storage, RECORD.slug, PATHS.treatmentCode("a2"), { action: "edit", value: "ketamine" }, { value: "quetiapine" }, { now: NOW })).rejects.toThrow(/not in the pack/)
    expect((await loadRecord(storage, RECORD.slug))!.arms[1].treatmentCode).toBe("quetiapine")
  })
})
