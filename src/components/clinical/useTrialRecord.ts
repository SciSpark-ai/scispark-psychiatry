"use client"

import { useEffect, useState } from "react"
import { editFieldRemote, extractRecordRemote, loadRecordRemote } from "@/lib/clinical/records/client"
import { getField, type TrialRecord } from "@/lib/clinical/records/schema"
import type { Design } from "@/lib/clinical/types"
import type { PaperRecord } from "@/lib/papers/types"
import { paperKey } from "@/lib/papers/types"

export interface TrialRecordState {
  record: TrialRecord | null; busy: boolean; error: string | null
  extract(): void; confirm(path: string): void; edit(path: string, value: string | number | null): void
}

/** The trial record of the paper on the paper page. Read when the page opens; extracted or changed only on request. */
export function useTrialRecord(paper: PaperRecord | null, design?: Design): TrialRecordState {
  const [found, setFound] = useState<{ key: string; record: TrialRecord | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = paper ? paperKey(paper) : null
  const record = found && found.key === key ? found.record : null

  useEffect(() => {
    if (!paper || !key) return
    let cancelled = false
    loadRecordRemote(paper).then((stored) => { if (!cancelled) setFound((current) => (current?.key === key && current.record ? current : { key, record: stored })) }).catch(() => {})
    return () => { cancelled = true }
    // The record is the same paper for as long as its key is the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const run = (work: () => Promise<TrialRecord>) => {
    if (!key || busy) return
    setBusy(true)
    setError(null)
    work().then((next) => setFound({ key, record: next })).catch((failure) => setError(failure instanceof Error ? failure.message : String(failure))).finally(() => setBusy(false))
  }
  const change = (path: string, action: { action: "confirm" } | { action: "edit"; value: string | number | null }) => {
    const shown = record ? getField(record, path) : null
    if (record && shown) run(() => editFieldRemote(record.slug, path, action, shown))
  }
  return {
    record, busy, error,
    extract: () => { if (paper && design) run(() => extractRecordRemote(paper, design)) },
    confirm: (path) => change(path, { action: "confirm" }),
    edit: (path, value) => change(path, { action: "edit", value }),
  }
}
