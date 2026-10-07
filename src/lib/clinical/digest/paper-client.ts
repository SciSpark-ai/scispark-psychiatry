import { readErrorMessage } from "../../http"
import type { PaperRecord } from "../../papers/types"
import { paperSlug } from "../../wiki/authoring"
import type { StoredPaperDigest } from "./paper"

// Browser-side callers of /api/clinical/paper-digest. Types only from ./paper, so the model runner stays out of the page.

/** The stored digest of a paper, or null. Never spends anything. */
export async function loadPaperDigestRemote(paper: PaperRecord, fetchFn: typeof fetch = fetch): Promise<StoredPaperDigest | null> {
  const res = await fetchFn(`/api/clinical/paper-digest?slug=${encodeURIComponent(paperSlug(paper))}`, { method: "GET" })
  if (!res.ok) throw new Error(await readErrorMessage(res, `saved digest lookup failed (${res.status})`))
  return ((await res.json()) as { result: { digest: StoredPaperDigest | null } }).result.digest
}

/** Reads the paper (full text when it can be had) and writes its digest. */
export async function writePaperDigestRemote(paper: PaperRecord, fetchFn: typeof fetch = fetch): Promise<{ digest: StoredPaperDigest; fromCache: boolean }> {
  const res = await fetchFn("/api/clinical/paper-digest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paper }) })
  if (!res.ok) throw new Error(await readErrorMessage(res, `digest failed (${res.status})`))
  return ((await res.json()) as { result: { digest: StoredPaperDigest; fromCache: boolean } }).result
}
