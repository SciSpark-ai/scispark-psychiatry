import { readErrorMessage } from "../../http"
import { paperKey, type PaperRecord } from "../../papers/types"
import { paperSlug } from "../../wiki/authoring"
import { CLINICAL_COPY } from "../copy"
import type { Design } from "../types"
import type { TrialRecord } from "./schema"
import type { FieldChange, Seen } from "./store"
import type { TreatmentRow } from "./table"

// Browser-side callers of /api/clinical/records. Types only from ./store and ./extract: both reach the server's file system.

const URL = "/api/clinical/records"
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await readErrorMessage(res, CLINICAL_COPY.records.requestFailed(res.status)))
  return ((await res.json()) as { result: T }).result
}

export interface Term { code: string; name: string }
/** A record with the pack's names of what it is filed under, and the terms it could be filed under instead. */
export interface RecordView<T extends TrialRecord | null = TrialRecord> { record: T; names: Record<string, string>; filing: { conditions: Term[]; treatments: Term[] } }

/** The stored record of a paper (null when it has none). The paper's key goes with its slug: two papers with one title share a slug. Spends nothing. */
export async function loadRecordRemote(paper: PaperRecord, fetchFn: typeof fetch = fetch): Promise<RecordView<TrialRecord | null>> {
  const query = new URLSearchParams({ slug: paperSlug(paper), key: paperKey(paper) })
  return unwrap<RecordView<TrialRecord | null>>(await fetchFn(`${URL}?${query.toString()}`, { method: "GET" }))
}

/** Reads the paper and extracts its trial record. Uses the reader's model. */
export async function extractRecordRemote(paper: PaperRecord, design: Design, fetchFn: typeof fetch = fetch): Promise<RecordView> {
  return unwrap<RecordView>(await fetchFn(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paper, design }) }))
}

/** Confirms or corrects a value, or changes what the condition or an arm is filed under. `expected` is what the screen showed. */
export async function editFieldRemote(slug: string, path: string, change: FieldChange, expected: Seen, fetchFn: typeof fetch = fetch): Promise<RecordView> {
  return unwrap<RecordView>(await fetchFn(URL, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, path, change, expected }) }))
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
