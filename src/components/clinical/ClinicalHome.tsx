"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import type { VaultStorage } from "@/lib/vault/storage"
import { loadBundle } from "@/lib/vault/bundle"
import { paperKey } from "@/lib/papers/types"
import { paperRecordFromFrontmatter } from "@/lib/papers/resolve"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { MODE_LABELS } from "@/lib/clinical/modes"
import { loadFeedback, type FeedbackKind } from "@/lib/clinical/feedback/store"
import { loadSeenTimes, recordSeen, seenRecently } from "@/lib/clinical/seen/store"
import { loadReadLater } from "@/lib/clinical/readlater/store"
import { topicLookup } from "./topic"
import { refreshClinicalFeed } from "@/lib/clinical/feed/client"
import { feedPage, loadClinicalFeed, pageCount, type StoredFeed } from "@/lib/clinical/feed/stored"
import { loadClinicalSettings, loadWatchEntries, saveClinicalSettings } from "@/lib/clinical/watch/store"
import { CATCH_UP_MONTHS, FEED_MODES, type CatchUpMonths, type ClinicalSettings, type ClinicalStage, type WatchEntry } from "@/lib/clinical/types"
import { ClinicalFeedCard } from "./ClinicalFeedCard"

type Loaded = {
  entries: WatchEntry[]; settings: ClinicalSettings; feed: StoredFeed | null; saved: Set<string>; votes: Map<string, FeedbackKind>
  /** Papers first displayed within the last day; only these are shown under "Seen earlier today". */
  seenToday: Set<string>
  /** Papers on the Read later list. */
  later: Set<string>
}

async function loadSeenToday(vault: VaultStorage): Promise<Set<string>> {
  const now = new Date()
  return new Set([...(await loadSeenTimes(vault))].filter(([, at]) => seenRecently(at, now)).map(([key]) => key))
}


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
        const [entries, settings, feed, bundle, feedback, seenKeys, laterItems] = await Promise.all([
          loadWatchEntries(vault), loadClinicalSettings(vault), loadClinicalFeed(vault), loadBundle(vault), loadFeedback(vault), loadSeenToday(vault), loadReadLater(vault),
        ])
        const saved = new Set([...bundle.pages.values()].filter((page) => page.frontmatter.type === "paper").map((page) => paperKey(paperRecordFromFrontmatter(page.frontmatter))))
        if (cancelled) return
        setStorage(vault)
        setData({ entries, settings, feed, saved, votes: new Map(feedback.map((event) => [event.paperKey, event.kind])), seenToday: seenKeys, later: new Set(laterItems.map((entry) => entry.key)) })
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
      const seenKeys = storage ? await loadSeenToday(storage) : new Set<string>()
      setData((current) => (current ? { ...current, feed, seenToday: seenKeys } : current))
      setPages(1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setRunning(false)
      setStage(null)
    }
  }, [running, storage])

  // The mode and the Catch up window are chosen here, on Home (owner decision 2026-10-06). They take effect on the next Refresh.
  async function changeSettings(patch: Partial<ClinicalSettings>) {
    if (!storage || !data) return
    const settings = { ...data.settings, ...patch }
    try {
      await saveClinicalSettings(storage, settings)
      setData({ ...data, settings })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  // Every paper put on screen is remembered as seen, so that a later refresh does not recommend it again.
  // Only what was displayed counts: the pages opened so far, not the whole stored list.
  const displayedKeys = data?.feed ? Array.from({ length: pages }, (_, page) => feedPage(data.feed as StoredFeed, page)).flat().map((item) => item.key).join("\n") : ""
  useEffect(() => {
    if (storage && displayedKeys) void recordSeen(storage, displayedKeys.split("\n")).catch(() => {})
  }, [storage, displayedKeys])

  if (!data || !storage) {
    return <div className="p-7">{error ? <p role="alert" className="text-[13px] text-red-600">{CLINICAL_COPY.errorPrefix} {error}</p> : <p className="text-[14px] text-muted-text">{CLINICAL_COPY.loading}</p>}</div>
  }

  const { entries, settings, feed, saved, votes } = data
  const { topicOf, toneOf } = topicLookup(entries)
  const seenToday = (feed?.seenEarlier ?? []).filter((item) => data.seenToday.has(item.key))
  const shown = feed ? Array.from({ length: pages }, (_, page) => feedPage(feed, page)).flat() : []
  const markSaved = (key: string) => setData((current) => (current ? { ...current, saved: new Set(current.saved).add(key) } : current))

  return (
    <div className="p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-[26px] font-semibold tracking-heading text-espresso">{CLINICAL_COPY.feed.heading}</h1>
          {feed && entries.length > 0 && (
            <p data-testid="clinical-feed-status" className="mt-1 text-[14px] text-secondary-dark">
              {CLINICAL_COPY.feed.status(feed.stats.listed, feed.stats.retrieved, MODE_LABELS[feed.mode], new Date(feed.generatedAt).toLocaleString())}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div role="group" aria-label={CLINICAL_COPY.watch.mode} className="flex overflow-hidden rounded-pill border border-border-warm text-[13px]">
            {FEED_MODES.map((mode) => (
              <button key={mode} type="button" aria-pressed={settings.mode === mode} onClick={() => void changeSettings({ mode })}
                className={`px-3 py-1.5 ${settings.mode === mode ? "bg-orange text-on-accent" : "text-muted-text hover:bg-card-surface/60"}`}>
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          {settings.mode === "catch-up" && (
            <select aria-label={CLINICAL_COPY.watch.catchUpWindow} title={CLINICAL_COPY.watch.catchUpWindow} value={settings.catchUpMonths}
              onChange={(event) => void changeSettings({ catchUpMonths: Number(event.target.value) as CatchUpMonths })}
              className="rounded-pill border border-border-warm bg-transparent px-3 py-1.5 text-[13px] text-espresso">
              {CATCH_UP_MONTHS.map((months) => <option key={months} value={months}>{CLINICAL_COPY.watch.months[months]}</option>)}
            </select>
          )}
          <button type="button" onClick={() => void refresh()} disabled={running || entries.length === 0}
            className="rounded-pill bg-orange px-4 py-1.5 text-[13px] font-medium text-on-accent hover:bg-orange/90 disabled:opacity-50">
            {running ? CLINICAL_COPY.feed.refreshing : CLINICAL_COPY.feed.refresh}
          </button>
        </div>
      </div>

      {running && stage && <p role="status" aria-live="polite" className="mb-4 text-[13px] text-muted-text">{CLINICAL_COPY.stages[stage]}…</p>}
      {error && <div role="alert" className="mb-4"><LlmErrorMessage message={error} /></div>}

      {entries.length === 0 ? (
        <p className="text-[14px] text-muted-text">
          {CLINICAL_COPY.feed.emptyNoEntries}{" "}
          <Link href="/watch" className="text-accent-ink underline">{CLINICAL_COPY.feed.openWatchList}</Link>
        </p>
      ) : !feed ? (
        <p className="text-[14px] text-muted-text">{CLINICAL_COPY.feed.emptyNoFeed}</p>
      ) : (
        <>
          {feed.mode !== settings.mode && <p className="mb-4 text-[14px] text-accent-ink">{CLINICAL_COPY.feed.modeChanged(MODE_LABELS[settings.mode])}</p>}
          {feed.items.length === 0 && <p className="mb-4 text-[14px] text-espresso">{CLINICAL_COPY.feed.nothingNew}</p>}
          {feed.warnings.length > 0 && <ul className="mb-4 list-disc pl-5 text-[12px] text-muted-text">{feed.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((item) => (
              <ClinicalFeedCard key={item.key} item={item} storage={storage} saved={saved.has(item.key)} onSave={markSaved}
                entryLabel={topicOf(item)} tone={toneOf(item)} vote={votes.get(item.key)} readLater={data.later.has(item.key)} />
            ))}
          </div>
          {pages < pageCount(feed) && (
            <button type="button" onClick={() => setPages(pages + 1)} className="mt-5 rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso hover:bg-card-surface/60">
              {CLINICAL_COPY.feed.morePapers}
            </button>
          )}
          {seenToday.length > 0 && (
            <details className="mt-8">
              <summary className="cursor-pointer text-[14px] text-espresso">{CLINICAL_COPY.feed.seenEarlier} ({seenToday.length})</summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                {seenToday.map((item) => (
                  <ClinicalFeedCard key={item.key} item={item} storage={storage} saved={saved.has(item.key)} onSave={markSaved}
                    entryLabel={topicOf(item)} tone={toneOf(item)} vote={votes.get(item.key)} readLater={data.later.has(item.key)} />
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
      {/* What the feed is and is not, once per page and out of the way of the papers. */}
      <p data-testid="clinical-feed-note" className="mt-10 border-t border-border-warm/60 pt-4 text-[13px] leading-relaxed text-muted-text">
        {CLINICAL_COPY.disclaimerShort} {CLINICAL_COPY.feed.aiNotice}
      </p>
    </div>
  )
}
