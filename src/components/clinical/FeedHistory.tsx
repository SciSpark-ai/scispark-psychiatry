"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getOpenVault } from "@/lib/vault/get-vault"
import type { VaultStorage } from "@/lib/vault/storage"
import { Card } from "@/components/ui/Card"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { deleteHistory, listHistory, restoreHistory, type HistoryEntry } from "@/lib/clinical/history/store"
import { lookBackName } from "@/lib/clinical/modes"

const H = CLINICAL_COPY.history
const FRAME = "p-7"

/**
 * Every search that was run. One can be reopened as the list on Home, or deleted. `embedded` is the list as a tab of
 * the Library: without its own heading and margins, which the Library has.
 */
export function FeedHistory({ embedded = false }: { embedded?: boolean }) {
  const frame = embedded ? undefined : FRAME
  const router = useRouter()
  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  /** The search whose Delete was clicked once; a second click deletes it. */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const history = await listHistory(vault)
        if (cancelled) return
        setStorage(vault)
        setEntries(history)
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function open(id: string) {
    if (!storage) return
    try {
      await restoreHistory(storage, id)
      router.push("/")
    } catch (failure) { setError(failure instanceof Error ? failure.message : H.failed) }
  }

  async function remove(id: string) {
    if (!storage) return
    if (confirming !== id) { setConfirming(id); return }
    try {
      await deleteHistory(storage, id)
      setEntries((current) => (current ?? []).filter((entry) => entry.id !== id))
      setConfirming(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : H.failed) }
  }

  if (!entries) {
    return <div className={frame}>{error ? <p role="alert" className="text-[13px] text-red-600">{CLINICAL_COPY.errorPrefix} {error}</p> : <p className="text-[14px] text-muted-text">{CLINICAL_COPY.loading}</p>}</div>
  }

  return (
    <div className={frame}>
      <div className="mb-5">
        {!embedded && <h1 className="font-heading text-[26px] font-semibold tracking-heading text-espresso">{H.heading}</h1>}
        <p className="mt-1 text-[14px] text-secondary-dark">{H.intro}</p>
      </div>
      {error && <p role="alert" className="mb-4 text-[13px] text-red-600">{error}</p>}
      {entries.length === 0 ? <p className="text-[14px] text-muted-text">{H.empty}</p> : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Card data-testid="history-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-espresso">{new Date(entry.generatedAt).toLocaleString()}</p>
                  <p className="text-[13px] text-secondary-dark">{lookBackName(entry.lookBack)} · {H.papers(entry.listed)}</p>
                  {entry.topics.length > 0 && <p className="truncate text-[13px] text-muted-text" title={entry.topics.join(", ")}>{entry.topics.join(", ")}</p>}
                </div>
                <button type="button" onClick={() => void open(entry.id)} className="rounded-pill bg-orange px-4 py-1.5 text-[13px] font-medium text-on-accent hover:bg-orange/90">{H.open}</button>
                <button type="button" onClick={() => void remove(entry.id)} className="rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso hover:bg-card-surface/60">{confirming === entry.id ? H.confirmDelete : H.delete}</button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
