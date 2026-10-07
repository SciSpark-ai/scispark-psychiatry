import { commitChangeset } from "../../vault/mutations"
import { makeChangesetId } from "../../vault/changesets"
import { withVaultExclusive } from "../../vault/exclusive"
import type { VaultStorage } from "../../vault/storage"
import { slugifyTitle } from "../../wiki/authoring"
import { CLINICAL_COPY } from "../copy"
import { TrialRecordSchema, fieldPaths, getField, isNumberPath, withField, type RecordField, type TrialRecord } from "./schema"

/**
 * Trial records on disk: one JSON file per paper under `records/`, every write a changeset, so that
 * an extraction and each correction a person makes can be undone (spec 7.12). Not under `.scispark/`:
 * a changeset may not write there.
 */

export const RECORDS_DIR = "records"
const pathOf = (slug: string) => `${RECORDS_DIR}/${slug}.json`
/** A slug as `paperSlug` makes them. Anything else (a path, an empty string) names no record. */
export const isRecordSlug = (slug: string) => slug.length > 0 && slug === slugifyTitle(slug)

export class RecordConflictError extends Error {}
export class RecordNotFoundError extends Error {}
export type FieldChange = { action: "confirm" } | { action: "edit"; value: string | number | null }

const parse = (raw: string | null): TrialRecord | null => {
  if (raw === null) return null
  try {
    const parsed = TrialRecordSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function loadRecord(storage: VaultStorage, slug: string): Promise<TrialRecord | null> {
  return isRecordSlug(slug) ? parse(await storage.read(pathOf(slug))) : null
}

/** Every readable record. A damaged file is skipped, not an error: one bad file must not empty every table. */
export async function listRecords(storage: VaultStorage): Promise<TrialRecord[]> {
  const paths = (await storage.list(`${RECORDS_DIR}/`)).filter((path) => path.endsWith(".json"))
  const records = await Promise.all(paths.map(async (path) => parse(await storage.read(path))))
  return records.filter((record): record is TrialRecord => record !== null)
}

async function write(storage: VaultStorage, record: TrialRecord, skill: string, summary: string, now: Date): Promise<void> {
  const before = await storage.read(pathOf(record.slug))
  const after = `${JSON.stringify(record, null, 2)}\n`
  if (before === after) return
  await commitChangeset(storage, { id: makeChangesetId(), skill, model: record.model, timestamp: now.toISOString(), changes: [{ path: pathOf(record.slug), before, after }] }, { op: skill, summary })
}

/** Stores an extracted record and, the first time, asks for it to be checked in the review inbox. */
export async function saveRecord(storage: VaultStorage, record: TrialRecord, opts: { now?: () => Date } = {}): Promise<void> {
  const now = opts.now?.() ?? new Date()
  await withVaultExclusive(storage, "clinical-records", async () => {
    const isNew = (await storage.read(pathOf(record.slug))) === null
    await write(storage, TrialRecordSchema.parse(record), "trial-extraction", record.slug, now)
    if (!isNew) return
    const id = `extract-${record.slug}`
    const values = fieldPaths(record).filter((path) => getField(record, path)?.value !== null).length
    await storage.write(`.scispark/review/${id}.json`, JSON.stringify({
      id, createdAt: now.toISOString(), kind: "extraction-review", paperSlug: record.slug, pages: [],
      title: CLINICAL_COPY.records.inboxTitle(record.title), description: CLINICAL_COPY.records.inboxDescription(values, record.droppedFields),
    }, null, 2))
  })
}

/**
 * Confirms or corrects one field. `expected` is the field as the reader saw it; if the stored field
 * is no longer that, the change is refused, so that one of two edits made at once is not lost unseen.
 */
export async function editField(
  storage: VaultStorage, slug: string, path: string, change: FieldChange, expected: RecordField, opts: { now?: () => Date } = {},
): Promise<TrialRecord> {
  return withVaultExclusive(storage, "clinical-records", async () => {
    const record = await loadRecord(storage, slug)
    if (!record) throw new RecordNotFoundError(CLINICAL_COPY.records.notFound)
    const current = getField(record, path)
    // An unknown path: withField throws its own `no such field` invariant error.
    if (!current) return withField(record, path, expected)
    if (current.value !== expected.value || current.state !== expected.state) throw new RecordConflictError(CLINICAL_COPY.records.conflict)
    let next: RecordField
    if (change.action === "confirm") {
      if (current.value === null) throw new Error(CLINICAL_COPY.records.nothingToConfirm)
      next = { ...current, state: "human-confirmed" } as RecordField
    } else if (isNumberPath(path)) {
      if (change.value !== null && (typeof change.value !== "number" || !Number.isFinite(change.value))) throw new Error(CLINICAL_COPY.records.notANumber)
      next = { value: change.value, quote: null, state: "human-edited" }
    } else {
      const text = typeof change.value === "string" ? change.value.replace(/\s+/g, " ").trim() : ""
      next = { value: text || null, quote: null, state: "human-edited" }
    }
    const updated = withField(record, path, next)
    await write(storage, updated, "extraction-review", `${slug} ${path}`, opts.now?.() ?? new Date())
    return updated
  })
}
