import { readNdjson } from "../../server/ndjson"
import type { ClinicalStage } from "../types"
import type { StoredFeed } from "./stored"

/**
 * Browser-side call to POST /api/clinical/feed/refresh. Imports `readNdjson` from the isomorphic
 * module, never from `skill-route.ts` (which pulls Node-only code into the client bundle).
 */
export async function refreshClinicalFeed(
  onStage?: (stage: ClinicalStage) => void,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<StoredFeed> {
  const res = await fetchFn("/api/clinical/feed/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
    signal,
  })
  return (await readNdjson(res, (event) => {
    if (event.type === "progress" && typeof event.stage === "string") onStage?.(event.stage as ClinicalStage)
  })) as StoredFeed
}
