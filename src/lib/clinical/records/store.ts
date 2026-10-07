import { commitChangeset } from "../../vault/mutations"
import { makeChangesetId } from "../../vault/changesets"
import { withVaultExclusive } from "../../vault/exclusive"
import type { VaultStorage } from "../../vault/storage"
import { CLINICAL_COPY } from "../copy"
import type { Taxonomy } from "../pack/schema"
import { findNode } from "../pack/taxonomy"
import { RECORDS_DIR, isRecordSlug, parseRecord, readRecord, recordPath } from "./file"
import { CHOICE_VALUES, PATHS, TrialRecordSchema, choiceKind, getCode, getField, isNumberPath, shownFieldPaths, withCode, withField, type FieldState, type RecordField, type TrialRecord } from "./schema"

/**
 * Trial records on disk: one JSON file per paper under `records/`, every write a changeset, so that
 * an extraction and each correction a person makes can be undone (spec 7.12). Not under `.scispark/`:
 * a changeset may not write there.
 *
 * A stored file is never written over by an extraction, readable or not: it may hold values a
 * person confirmed. Only `editField`, which starts from the stored record, changes one.
 */

export { RECORDS_DIR, isRecordSlug, readRecord }
const pathOf = recordPath

export class RecordConflictError extends Error {}
export class RecordNotFoundError extends Error {}
/** A file is already stored where the record would go. */
export class RecordExistsError extends Error {}
export type FieldChange = { action: "confirm" } | { action: "edit"; value: string | number | boolean | null }
/** The value, and for a field its state, as the reader saw it. What a record is filed under has no state. */
export type Seen = { value: RecordField["value"]; state?: FieldState }

export async function loadRecord(storage: VaultStorage, slug: string): Promise<TrialRecord | null> {
  return (await readRecord(storage, slug)).record
}

/** Every readable record. A damaged file is skipped, not an error: one bad file must not empty every table. */
export async function listRecords(storage: VaultStorage): Promise<TrialRecord[]> {
  const paths = (await storage.list(`${RECORDS_DIR}/`)).filter((path) => path.endsWith(".json"))
  const records = await Promise.all(paths.map(async (path) => parseRecord(await storage.read(path))))
  return records.filter((record): record is TrialRecord => record !== null)
}

async function write(storage: VaultStorage, record: TrialRecord, skill: string, summary: string, now: Date): Promise<void> {
  const before = await storage.read(pathOf(record.slug))
  const after = `${JSON.stringify(record, null, 2)}\n`
  if (before === after) return
  await commitChangeset(storage, { id: makeChangesetId(), skill, model: record.model, timestamp: now.toISOString(), changes: [{ path: pathOf(record.slug), before, after }] }, { op: skill, summary })
}

/**
 * Stores an extracted record and asks for it to be checked in the review inbox. Refused with
 * RecordExistsError when a file is already there, whatever it holds; the check is made inside the
 * lock, so of two extractions of one paper that end together one is stored. `replace` writes over
 * the stored file and asks for nothing.
 */
export async function saveRecord(storage: VaultStorage, record: TrialRecord, opts: { now?: () => Date; replace?: boolean } = {}): Promise<void> {
  const now = opts.now?.() ?? new Date()
  await withVaultExclusive(storage, "clinical-records", async () => {
    const isNew = (await storage.read(pathOf(record.slug))) === null
    if (!isNew && !opts.replace) throw new RecordExistsError(CLINICAL_COPY.records.unreadable)
    await write(storage, TrialRecordSchema.parse(record), "trial-extraction", record.slug, now)
    if (!isNew) return
    const id = `extract-${record.slug}`
    // The three choices have no sentence: they are not among the values "matched to a sentence".
    const values = shownFieldPaths(record).filter((path) => choiceKind(path) === null && getField(record, path)?.value !== null).length
    await storage.write(`.scispark/review/${id}.json`, JSON.stringify({
      id, createdAt: now.toISOString(), kind: "extraction-review", paperSlug: record.slug, pages: [],
      title: CLINICAL_COPY.records.inboxTitle(record.title), description: CLINICAL_COPY.records.inboxDescription(values, record.droppedFields),
    }, null, 2))
  })
}

/** The pack's id for a name a person typed, when the pack has a term of that kind that reads the same. */
const codeFor = (taxonomy: Taxonomy | undefined, name: string | null, type: "condition" | "treatment") => (taxonomy && name ? findNode(taxonomy, name, type)?.id ?? null : null)

/** The next field for a change, or an Error that says why the change cannot be made. */
function changed(path: string, current: RecordField, change: FieldChange): RecordField {
  const choice = choiceKind(path)
  if (change.action === "confirm") {
    // "Not clear from the paper" can be confirmed; a field that holds nothing cannot.
    if (current.value === null && choice !== "lowerIsBetter") throw new Error(CLINICAL_COPY.records.nothingToConfirm)
    return { ...current, state: "human-confirmed" } as RecordField
  }
  if (choice) {
    if (!CHOICE_VALUES[choice].includes(change.value as never)) throw new Error(CLINICAL_COPY.records.notAChoice)
    return { value: change.value as boolean | "treatment" | "control" | null, quote: null, state: "human-edited" }
  }
  if (isNumberPath(path)) {
    if (change.value !== null && (typeof change.value !== "number" || !Number.isFinite(change.value))) throw new Error(CLINICAL_COPY.records.notANumber)
    return { value: change.value, quote: null, state: "human-edited" }
  }
  const text = typeof change.value === "string" ? change.value.replace(/\s+/g, " ").trim() : ""
  return { value: text || null, quote: null, state: "human-edited" }
}

/**
 * Confirms or corrects one field, or changes what the condition or an arm is filed under. `expected`
 * is the value as the reader saw it; if the stored one is no longer that, the change is refused, so
 * that one of two edits made at once is not lost unseen.
 *
 * A code is the pack's id of a name. When a person corrects the name, the code is derived again from
 * the new name (null when the pack has no such term, or when no taxonomy was given): a code the
 * model picked for another name must not outlive that name.
 */
export async function editField(
  storage: VaultStorage, slug: string, path: string, change: FieldChange, expected: Seen, opts: { now?: () => Date; taxonomy?: Taxonomy } = {},
): Promise<TrialRecord> {
  return withVaultExclusive(storage, "clinical-records", async () => {
    const record = await loadRecord(storage, slug)
    if (!record) throw new RecordNotFoundError(CLINICAL_COPY.records.notFound)
    const save = async (updated: TrialRecord) => {
      await write(storage, updated, "extraction-review", `${slug} ${path}`, opts.now?.() ?? new Date())
      return updated
    }
    const code = getCode(record, path)
    if (code !== undefined) {
      if (change.action !== "edit") throw new Error(CLINICAL_COPY.records.badRequest)
      if (code !== expected.value) throw new RecordConflictError(CLINICAL_COPY.records.conflict)
      const type = path === PATHS.conditionCode ? "condition" : "treatment"
      const next = change.value
      if (next !== null && !(typeof next === "string" && opts.taxonomy?.nodes.some((node) => node.id === next && node.type === type))) throw new Error(CLINICAL_COPY.records.notInPack)
      return save(withCode(record, path, next))
    }
    const current = getField(record, path)
    // An unknown path: withField throws its own `no such field` invariant error.
    if (!current) return withField(record, path, { value: null, quote: null, state: "unverified" })
    if (current.value !== expected.value || current.state !== expected.state) throw new RecordConflictError(CLINICAL_COPY.records.conflict)
    const next = changed(path, current, change)
    let updated = withField(record, path, next)
    if (change.action === "edit" && path === "condition") updated = { ...updated, conditionCode: codeFor(opts.taxonomy, next.value as string | null, "condition") }
    const arm = change.action === "edit" ? record.arms.find((entry) => path === `arms.${entry.id}.treatment`) : undefined
    if (arm) updated = withCode(updated, PATHS.treatmentCode(arm.id), codeFor(opts.taxonomy, next.value as string | null, "treatment"))
    return save(updated)
  })
}
