import { readErrorMessage } from "../../http"
import { CLINICAL_COPY } from "../copy"
import type { ConditionEvidence } from "./build"

// Browser-side callers of /api/clinical/evidence. Types only from ./build.

export interface FollowedCondition { code: string; name: string; total: number; recent: number; treatments: string[]; pageId: string | null }
const URL = "/api/clinical/evidence"
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await readErrorMessage(res, CLINICAL_COPY.evidence.requestFailed(res.status)))
  return ((await res.json()) as { result: T }).result
}
export async function loadConditionEvidenceRemote(code: string, fetchFn: typeof fetch = fetch): Promise<ConditionEvidence> {
  return unwrap<ConditionEvidence>(await fetchFn(`${URL}?condition=${encodeURIComponent(code)}`, { method: "GET" }))
}
export async function listFollowedConditionsRemote(fetchFn: typeof fetch = fetch): Promise<FollowedCondition[]> {
  return (await unwrap<{ conditions: FollowedCondition[] }>(await fetchFn(URL, { method: "GET" }))).conditions
}
