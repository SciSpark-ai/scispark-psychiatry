"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import type { VaultStorage } from "@/lib/vault/storage"
import { loadBundle } from "@/lib/vault/bundle"
import { paperKey } from "@/lib/papers/types"
import { paperRecordFromFrontmatter } from "@/lib/papers/resolve"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { PageHeader } from "@/components/ui/PageHeader"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { MODE_LABELS } from "@/lib/clinical/modes"
import { loadFeedback, type FeedbackKind } from "@/lib/clinical/feedback/store"
import { refreshClinicalFeed } from "@/lib/clinical/feed/client"
import { feedPage, loadClinicalFeed, pageCount, type StoredFeed } from "@/lib/clinical/feed/stored"
import { loadClinicalSettings, loadWatchEntries, saveClinicalSettings } from "@/lib/clinical/watch/store"
import { FEED_MODES, type ClinicalSettings, type ClinicalStage, type WatchEntry } from "@/lib/clinical/types"
import { ClinicalFeedCard } from "./ClinicalFeedCard"

type Loaded = { entries: WatchEntry[]; settings: ClinicalSettings; feed: StoredFeed | null; saved: Set<string>; votes: Map<string, FeedbackKind> }

const entryLabel = (entry: WatchEntry) => [entry.condition, entry.treatment].filter(Boolean).join(" × ")

export function ClinicalHome() {
  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [data, setData] = useState<Loaded | null>(null)
  const [pages, setPages] = useState(1)
  const [stage, setStage] = useState<ClinicalStage | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const [entries, settings, feed, bundle, feedback] = await Promise.all([
          loadWatchEntries(vault), loadClinicalSettings(vault), loadClinicalFeed(vault), loadBundle(vault), loadFeedback(vault),
        ])
        const saved = new Set([...bundle.pages.values()].filter((page) => page.frontmatter.type === "paper").map((page) => paperKey(paperRecordFromFrontmatter(page.frontmatter))))
        if (cancelled) return
        setStorage(vault)
        setData({ entries, settings, feed, saved, votes: new Map(feedback.map((event) => [event.paperKey, event.kind])) })
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => { cancelled = true }
  }, [])

  const refresh = useCallback(async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      const feed = await refreshClinicalFeed((next) => setStage(next))
      setData((current) => (current ? { ...current, feed } : current))
      setPages(1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setRunning(false)
      setStage(null)
    }
  }, [running])

  async function changeMode(mode: ClinicalSettings["mode"]) {
    if (!storage || !data) return
    const settings = { ...data.settings, mode }
    await saveClinicalSettings(storage, settings)
    setData({ ...data, settings })
  }

  if (!data || !storage) {
    return <div className="p-7">{error ? <p role="alert" className="text-[13px] text-red-600">Error: {error}</p> : <p className="text-[14px] text-muted-text">Loading…</p>}</div>
  }

  const { entries, settings, feed, saved, votes } = data
  const labels = new Map(entries.map((entry) => [entry.id, entryLabel(entry)]))
  const shown = feed ? Array.from({ length: pages }, (_, page) => feedPage(feed, page)).flat() : []
  const markSaved = (key: string) => setData((current) => (current ? { ...current, saved: new Set(current.saved).add(key) } : current))

  return (
    <div className="p-7">
      <PageHeader
        title={CLINICAL_COPY.feed.heading}
        description={CLINICAL_COPY.disclaimerShort}
        actions={
          <>
            <div role="group" aria-label={CLINICAL_COPY.watch.mode} className="flex overflow-hidden rounded-pill border border-border-warm text-[13px]">
              {FEED_MODES.map((mode) => (
                <button key={mode} type="button" aria-pressed={settings.mode === mode} onClick={() => void changeMode(mode)}
                  className={`px-3 py-1.5 ${settings.mode === mode ? "bg-orange text-on-accent" : "text-muted-text hover:bg-card-surface/60"}`}>
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void refresh()} disabled={running || entries.length === 0}
              className="rounded-pill bg-orange px-4 py-1.5 text-[13px] font-medium text-on-accent hover:bg-orange/90 disabled:opacity-50">
              {running ? CLINICAL_COPY.feed.refreshing : CLINICAL_COPY.feed.refresh}
            </button>
          </>
        }
      />

      {running && stage && <p role="status" aria-live="polite" className="mb-4 text-[13px] text-muted-text">{CLINICAL_COPY.stages[stage]}…</p>}
      {error && <div role="alert" className="mb-4"><LlmErrorMessage message={error} /></div>}

      {entries.length === 0 ? (
        <p className="text-[14px] text-muted-text">
          {CLINICAL_COPY.feed.emptyNoEntries}{" "}
          <Link href="/watch" className="text-accent-ink underline">Open the watch list</Link>
        </p>
      ) : !feed ? (
        <p className="text-[14px] text-muted-text">{CLINICAL_COPY.feed.emptyNoFeed}</p>
      ) : (
        <>
          <p className="mb-4 text-[13px] text-muted-text">
            Updated {new Date(feed.generatedAt).toLocaleString()} · {MODE_LABELS[feed.mode]} · {feed.stats.listed} papers listed from {feed.stats.retrieved} found
          </p>
          {feed.warnings.length > 0 && <ul className="mb-4 list-disc pl-5 text-[12px] text-muted-text">{feed.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((item) => (
              <ClinicalFeedCard key={item.key} item={item} storage={storage} saved={saved.has(item.key)} onSave={markSaved}
                entryLabel={item.entryId ? labels.get(item.entryId) : undefined} vote={votes.get(item.key)} />
            ))}
          </div>
          {pages < pageCount(feed) && (
            <button type="button" onClick={() => setPages(pages + 1)} className="mt-5 rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso hover:bg-card-surface/60">
              {CLINICAL_COPY.feed.morePapers}
            </button>
          )}
          {feed.lowerConfidence.length > 0 && (
            <details className="mt-8">
              <summary className="cursor-pointer text-[14px] text-espresso">{CLINICAL_COPY.feed.lowerConfidence} ({feed.lowerConfidence.length})</summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                {feed.lowerConfidence.map((item) => (
                  <ClinicalFeedCard key={item.key} item={item} storage={storage} saved={saved.has(item.key)} onSave={markSaved}
                    entryLabel={item.entryId ? labels.get(item.entryId) : undefined} vote={votes.get(item.key)} />
                ))}
              </div>
            </details>
          )}
          {feed.safetySignals.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-[14px] text-espresso">{CLINICAL_COPY.feed.safetySignals} ({feed.safetySignals.length})</summary>
              <ul className="mt-3 list-disc pl-5 text-[13px] text-espresso">
                {feed.safetySignals.map((signal) => <li key={signal.key}>{signal.paper.title}{signal.paper.venue ? ` — ${signal.paper.venue}` : ""}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}
