import { readErrorMessage } from "../../http"
import type { PaperRecord } from "../../papers/types"
import { paperSlug } from "../../wiki/authoring"
import { CLINICAL_COPY } from "../copy"
import type { Design } from "../types"
import type { RecordField, TrialRecord } from "./schema"
import type { FieldChange } from "./store"
import type { TreatmentRow } from "./table"

// Browser-side callers of /api/clinical/records. Types only from ./store and ./extract: both reach the server's file system.

const URL = "/api/clinical/records"
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await readErrorMessage(res, CLINICAL_COPY.records.requestFailed(res.status)))
  return ((await res.json()) as { result: T }).result
}

/** The stored record of a paper, or null. Spends nothing. */
export async function loadRecordRemote(paper: PaperRecord, fetchFn: typeof fetch = fetch): Promise<TrialRecord | null> {
  return (await unwrap<{ record: TrialRecord | null }>(await fetchFn(`${URL}?slug=${encodeURIComponent(paperSlug(paper))}`, { method: "GET" }))).record
}

/** Reads the paper and extracts its trial record. Uses the reader's model. */
export async function extractRecordRemote(paper: PaperRecord, design: Design, fetchFn: typeof fetch = fetch): Promise<TrialRecord> {
  return (await unwrap<{ record: TrialRecord }>(await fetchFn(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paper, design }) }))).record
}

export async function editFieldRemote(slug: string, path: string, change: FieldChange, expected: RecordField, fetchFn: typeof fetch = fetch): Promise<TrialRecord> {
  return (await unwrap<{ record: TrialRecord }>(await fetchFn(URL, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, path, change, expected }) }))).record
}

export interface TreatmentTable { condition: { code: string; name: string }; rows: TreatmentRow[] }
/** The treatment-options table of a condition. Spends nothing. */
export async function loadTreatmentTableRemote(condition: string, fetchFn: typeof fetch = fetch): Promise<TreatmentTable> {
  return unwrap<TreatmentTable>(await fetchFn(`${URL}/table?condition=${encodeURIComponent(condition)}`, { method: "GET" }))
}

export async function listConditionsRemote(fetchFn: typeof fetch = fetch): Promise<Array<{ code: string; name: string }>> {
  return (await unwrap<{ conditions: Array<{ code: string; name: string }> }>(await fetchFn("/api/clinical/conditions", { method: "GET" }))).conditions
}
export async function createConditionPageRemote(code: string, fetchFn: typeof fetch = fetch): Promise<{ id: string; created: boolean }> {
  return unwrap<{ id: string; created: boolean }>(await fetchFn("/api/clinical/conditions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) }))
}
