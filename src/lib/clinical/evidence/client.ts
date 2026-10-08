import { readErrorMessage } from "../../http"
import { CLINICAL_COPY } from "../copy"
import type { ConditionEvidence, Period, Scope } from "./build"

// Browser-side callers of /api/clinical/evidence. Types only from ./build.

export interface FollowedCondition { code: string; name: string; total: number; recent: number; treatments: Array<{ key: string; label: string | null }>; pageId: string | null }
const URL = "/api/clinical/evidence"
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await readErrorMessage(res, CLINICAL_COPY.evidence.requestFailed(res.status)))
  return ((await res.json()) as { result: T }).result
}
/** What the route answers for one condition: its evidence, and its wiki page when it has one (null when it has none). */
export type ConditionEvidenceAnswer = ConditionEvidence & { pageId: string | null }
/** The evidence on one condition: of every paper the feed listed (`all`, the default) or of the saved ones, in a period (`all` by default). */
export async function loadConditionEvidenceRemote(code: string, opts: { period?: Period; scope?: Scope } = {}, fetchFn: typeof fetch = fetch): Promise<ConditionEvidenceAnswer> {
  return unwrap<ConditionEvidenceAnswer>(await fetchFn(`${URL}?condition=${encodeURIComponent(code)}&period=${opts.period ?? "all"}&scope=${opts.scope ?? "all"}`, { method: "GET" }))
}
export async function listFollowedConditionsRemote(fetchFn: typeof fetch = fetch): Promise<FollowedCondition[]> {
  return (await unwrap<{ conditions: FollowedCondition[] }>(await fetchFn(URL, { method: "GET" }))).conditions
}
