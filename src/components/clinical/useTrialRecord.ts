"use client"

import { useEffect, useState } from "react"
import { editFieldRemote, extractRecordRemote, loadRecordRemote, type RecordView } from "@/lib/clinical/records/client"
import { getCode, getField, type TrialRecord } from "@/lib/clinical/records/schema"
import type { Design } from "@/lib/clinical/types"
import type { PaperRecord } from "@/lib/papers/types"
import { paperKey } from "@/lib/papers/types"

type Filing = RecordView["filing"]
type Value = string | number | boolean | null
const NO_FILING: Filing = { conditions: [], treatments: [] }
const NO_NAMES: Record<string, string> = {}
const message = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))

export interface TrialRecordState {
  record: TrialRecord | null
  /** The pack's names of the codes the record is filed under, and the terms it could be filed under instead. */
  names: Record<string, string>; filing: Filing
  busy: boolean; error: string | null
  /** The stored record could not be read. Nothing is known about it, so an extraction must not be offered. */
  loadFailed: boolean
  extract(): void
  /** Each resolves to whether the change was accepted. */
  confirm(path: string): Promise<boolean>
  edit(path: string, value: Value): Promise<boolean>
  /** Changes what the condition or an arm is filed under. */
  file(path: string, code: string | null): Promise<boolean>
}

/** The trial record of the paper on the paper page. Read when the page opens; extracted or changed only on request. */
export function useTrialRecord(paper: PaperRecord | null, design?: Design): TrialRecordState {
  const [found, setFound] = useState<{ key: string; view: RecordView<TrialRecord | null> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null)
  const key = paper ? paperKey(paper) : null
  const view = found && found.key === key ? found.view : null
  const record = view?.record ?? null
  const loadFailed = loadError !== null && loadError.key === key && !record

  useEffect(() => {
    if (!paper || !key) return
    let cancelled = false
    loadRecordRemote(paper)
      .then((stored) => { if (!cancelled) setFound((current) => (current?.key === key && current.view.record ? current : { key, view: stored })) })
      .catch((failure) => { if (!cancelled) setLoadError({ key, message: message(failure) }) })
    return () => { cancelled = true }
    // The record is the same paper for as long as its key is the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const run = (work: () => Promise<RecordView>): Promise<boolean> => {
    if (!key || busy) return Promise.resolve(false)
    setBusy(true)
    setError(null)
    return work()
      .then((next) => { setFound({ key, view: next }); return true })
      .catch((failure) => { setError(message(failure)); return false })
      .finally(() => setBusy(false))
  }
  const change = (path: string, action: { action: "confirm" } | { action: "edit"; value: Value }) => {
    const shown = record ? getField(record, path) : null
    return record && shown ? run(() => editFieldRemote(record.slug, path, action, shown)) : Promise.resolve(false)
  }
  return {
    record, names: view?.names ?? NO_NAMES, filing: view?.filing ?? NO_FILING, busy,
    error: error ?? (loadFailed ? loadError.message : null), loadFailed,
    extract: () => { if (paper && design && !loadFailed) void run(() => extractRecordRemote(paper, design)) },
    confirm: (path) => change(path, { action: "confirm" }),
    edit: (path, value) => change(path, { action: "edit", value }),
    file: (path, code) => {
      const seen = record ? getCode(record, path) : undefined
      return record && seen !== undefined ? run(() => editFieldRemote(record.slug, path, { action: "edit", value: code }, { value: seen })) : Promise.resolve(false)
    },
  }
}
