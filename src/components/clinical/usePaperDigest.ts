"use client"

import { useEffect, useState } from "react"
import { loadPaperDigestRemote, writePaperDigestRemote } from "@/lib/clinical/digest/paper-client"
import type { StoredPaperDigest } from "@/lib/clinical/digest/paper"
import type { PaperRecord } from "@/lib/papers/types"
import { paperKey } from "@/lib/papers/types"

export interface PaperDigestState { digest: StoredPaperDigest | null; busy: boolean; error: string | null; write: () => void }

/**
 * The clinical digest of the paper on the paper page. The stored one is read when the page opens;
 * a new one is written only when `write` is called, because that reads the paper and calls the model.
 */
export function usePaperDigest(paper: PaperRecord | null): PaperDigestState {
  const [found, setFound] = useState<{ key: string; digest: StoredPaperDigest | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = paper ? paperKey(paper) : null

  useEffect(() => {
    if (!paper || !key) return
    let cancelled = false
    loadPaperDigestRemote(paper).then((digest) => { if (!cancelled) setFound((current) => (current?.key === key && current.digest ? current : { key, digest })) }).catch(() => {})
    return () => { cancelled = true }
    // The record is the same paper for as long as its key is the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const write = () => {
    if (!paper || !key || busy) return
    setBusy(true)
    setError(null)
    writePaperDigestRemote(paper)
      .then((result) => setFound({ key, digest: result.digest }))
      .catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setBusy(false))
  }
  return { digest: found && found.key === key ? found.digest : null, busy, error, write }
}
