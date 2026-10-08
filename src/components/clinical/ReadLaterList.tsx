"use client"

import { useEffect, useState } from "react"
import { getOpenVault } from "@/lib/vault/get-vault"
import type { VaultStorage } from "@/lib/vault/storage"
import { loadBundle } from "@/lib/vault/bundle"
import { paperKey } from "@/lib/papers/types"
import { paperRecordFromFrontmatter } from "@/lib/papers/resolve"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { StoredFeedItem } from "@/lib/clinical/feed/stored"
import { loadFeedback, type FeedbackKind } from "@/lib/clinical/feedback/store"
import { loadReadLater } from "@/lib/clinical/readlater/store"
import { loadWatchEntries } from "@/lib/clinical/watch/store"
import type { WatchEntry } from "@/lib/clinical/types"
import { ClinicalFeedCard } from "./ClinicalFeedCard"
import { topicLookup } from "./topic"

const R = CLINICAL_COPY.readLater
const FRAME = "p-7"
type Loaded = { items: StoredFeedItem[]; entries: WatchEntry[]; saved: Set<string>; votes: Map<string, FeedbackKind> }

/**
 * The papers put aside with the clock on a feed card, as the same cards. `embedded` is the list as a tab of the
 * Library: without its own heading and margins, which the Library has.
 */
export function ReadLaterList({ embedded = false }: { embedded?: boolean }) {
  const frame = embedded ? undefined : FRAME
  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const [items, entries, bundle, feedback] = await Promise.all([loadReadLater(vault), loadWatchEntries(vault), loadBundle(vault), loadFeedback(vault)])
        const saved = new Set([...bundle.pages.values()].filter((page) => page.frontmatter.type === "paper").map((page) => paperKey(paperRecordFromFrontmatter(page.frontmatter))))
        if (cancelled) return
        setStorage(vault)
        setData({ items, entries, saved, votes: new Map(feedback.map((event) => [event.paperKey, event.kind])) })
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!data || !storage) {
    return <div className={frame}>{error ? <p role="alert" className="text-[13px] text-red-600">{CLINICAL_COPY.errorPrefix} {error}</p> : <p className="text-[14px] text-muted-text">{CLINICAL_COPY.loading}</p>}</div>
  }

  const { topicOf, toneOf } = topicLookup(data.entries)
  const markSaved = (key: string) => setData((current) => (current ? { ...current, saved: new Set(current.saved).add(key) } : current))
  const onReadLater = (key: string, on: boolean) => { if (!on) setData((current) => (current ? { ...current, items: current.items.filter((item) => item.key !== key) } : current)) }

  return (
    <div className={frame}>
      <div className="mb-5">
        {!embedded && <h1 className="font-heading text-[26px] font-semibold tracking-heading text-espresso">{R.heading}</h1>}
        <p className="mt-1 text-[14px] text-secondary-dark">{R.intro}</p>
      </div>
      {data.items.length === 0 ? <p className="text-[14px] text-muted-text">{R.empty}</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.items.map((item) => (
            <ClinicalFeedCard key={item.key} item={item} storage={storage} saved={data.saved.has(item.key)} onSave={markSaved}
              entryLabel={topicOf(item)} tone={toneOf(item)} vote={data.votes.get(item.key)} readLater onReadLater={onReadLater} />
          ))}
        </div>
      )}
    </div>
  )
}
