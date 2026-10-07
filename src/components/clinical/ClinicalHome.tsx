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
import { LOOK_BACK, lookBackOf, settingsForLookBack, type LookBack } from "@/lib/clinical/modes"
import { loadFeedback, type FeedbackKind } from "@/lib/clinical/feedback/store"
import { loadSeenTimes, recordSeen, seenRecently } from "@/lib/clinical/seen/store"
import { loadReadLater } from "@/lib/clinical/readlater/store"
import { entryLabel, topicLookup } from "./topic"
import { refreshClinicalFeed } from "@/lib/clinical/feed/client"
import { loadClinicalFeed, type StoredFeed } from "@/lib/clinical/feed/stored"
import { loadClinicalSettings, loadWatchEntries, saveClinicalSettings } from "@/lib/clinical/watch/store"
import { DESIGNS, PAGE_SIZE, type ClinicalSettings, type ClinicalStage, type WatchEntry } from "@/lib/clinical/types"
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
  /** The topic tab on screen: a watch entry's id, or null for all topics. */
  const [topic, setTopic] = useState<string | null>(null)
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
  const inTab = (data?.feed?.items ?? []).filter((item) => topic === null || item.entryId === topic)
  const displayedKeys = inTab.slice(0, pages * PAGE_SIZE).map((item) => item.key).join("\n")
  // Recorded under the time range of the list on screen: only a new search of the same range leaves these papers out.
  const shownLookBack = data?.feed ? (data.feed.lookBack ?? lookBackOf({ mode: data.feed.mode, catchUpMonths: 6, windowDays: 30 })) : "30d"
  useEffect(() => {
    if (storage && displayedKeys) void recordSeen(storage, displayedKeys.split("\n"), new Date(), shownLookBack).catch(() => {})
  }, [storage, displayedKeys, shownLookBack])

  if (!data || !storage) {
    return <div className="p-7">{error ? <p role="alert" className="text-[13px] text-red-600">{CLINICAL_COPY.errorPrefix} {error}</p> : <p className="text-[14px] text-muted-text">{CLINICAL_COPY.loading}</p>}</div>
  }

  const { entries, settings, feed, saved, votes } = data
  // A list is labelled with the topics it was built for (kept with it), so an earlier list reopened
  // from the history still reads correctly after the topics have changed.
  const listTopics: WatchEntry[] = feed?.topics ? feed.topics.map((entry) => ({ ...entry, priority: "normal", safetySignal: false })) : entries
  const { topicOf, toneOf } = topicLookup(listTopics)
  const seenToday = (feed?.seenEarlier ?? []).filter((item) => data.seenToday.has(item.key))
  const shown = inTab.slice(0, pages * PAGE_SIZE)
  const current = lookBackOf(settings)
  const feedLookBack = feed ? ((feed.lookBack ?? lookBackOf({ mode: feed.mode, catchUpMonths: 6, windowDays: 30 })) as LookBack) : current
  const optionLabel = (key: LookBack) => CLINICAL_COPY.feed.lookBackOptions[key]
  const tabs = [
    { id: null as string | null, label: CLINICAL_COPY.feed.allTopics, count: feed?.items.length ?? 0 },
    ...listTopics.map((entry) => ({ id: entry.id as string | null, label: entryLabel(entry), count: (feed?.items ?? []).filter((item) => item.entryId === entry.id).length })),
  ]
  const overview = topic !== null ? feed?.topicOverviews?.[topic] : undefined
  const headlineOf = new Map((feed?.items ?? []).map((item) => [item.key, item.digest?.headline ?? item.paper.title]))
  // The count line of the tab: how many papers, how many match a condition and a treatment together,
  // how many are in leading journals, and the most common designs that someone has named.
  const designCounts = DESIGNS
    .filter((design) => design !== "other" && design !== "unknown")
    .map((design) => ({ design, count: inTab.filter((item) => item.design === design && item.designSource !== "none").length }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
  const stats = [
    { key: "papers", text: CLINICAL_COPY.feed.overview.papers(inTab.length) },
    ...[
      { key: "full", label: CLINICAL_COPY.feed.overview.full, count: inTab.filter((item) => item.matched === "full" && listTopics.some((entry) => entry.id === item.entryId && entry.condition && entry.treatment)).length },
      { key: "leading", label: CLINICAL_COPY.feed.overview.leading, count: inTab.filter((item) => item.journalBand === 1).length },
      ...designCounts.map((entry) => ({ key: entry.design, label: CLINICAL_COPY.designLabels[entry.design], count: entry.count })),
    ].filter((entry) => entry.count > 0).map((entry) => ({ key: entry.key, text: `${entry.label} ${entry.count}` })),
  ]
  const markSaved = (key: string) => setData((current) => (current ? { ...current, saved: new Set(current.saved).add(key) } : current))

  return (
    <div className="p-7">
      {/* The title and the controls share one line; the status line sits beneath them. */}
      <div className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="font-heading text-[26px] font-semibold tracking-heading text-espresso">{CLINICAL_COPY.feed.heading}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <select aria-label={CLINICAL_COPY.feed.lookBack} title={CLINICAL_COPY.feed.lookBack} value={current}
              onChange={(event) => void changeSettings(settingsForLookBack(event.target.value as LookBack))}
              className="rounded-pill border border-border-warm bg-transparent px-3 py-1.5 text-[13px] text-espresso">
              {LOOK_BACK.map((key) => <option key={key} value={key}>{optionLabel(key)}</option>)}
            </select>
            <button type="button" onClick={() => void refresh()} disabled={running || entries.length === 0}
              className="rounded-pill bg-orange px-4 py-1.5 text-[13px] font-medium text-on-accent hover:bg-orange/90 disabled:opacity-50">
              {running ? CLINICAL_COPY.feed.refreshing : CLINICAL_COPY.feed.refresh}
            </button>
          </div>
        </div>
        {feed && entries.length > 0 && (
          <p data-testid="clinical-feed-status" className="mt-1 text-[14px] text-secondary-dark">
            {CLINICAL_COPY.feed.status(feed.stats.listed, feed.stats.retrieved, optionLabel(feedLookBack), new Date(feed.generatedAt).toLocaleString())}
          </p>
        )}
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
          {feedLookBack !== current && <p className="mb-4 text-[14px] text-accent-ink">{CLINICAL_COPY.feed.modeChanged(optionLabel(current))}</p>}
          <div role="tablist" aria-label={CLINICAL_COPY.feed.topicsLabel} className="mb-3 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button key={tab.id ?? "all"} type="button" role="tab" aria-selected={topic === tab.id}
                onClick={() => { setTopic(tab.id); setPages(1) }}
                className={`rounded-pill border px-3.5 py-1.5 text-[14px] transition-colors ${topic === tab.id ? "border-orange bg-orange/10 font-semibold text-accent-ink" : "border-border-warm text-secondary-dark hover:bg-card-surface/60"}`}>
                {tab.label} <span className="text-[12px] font-normal text-muted-text">{tab.count}</span>
              </button>
            ))}
          </div>
          <p data-testid="clinical-feed-overview" className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-secondary-dark">
            {stats.map((stat, index) => <span key={stat.key} data-stat="true" className={index === 0 ? "font-semibold text-espresso" : ""}>{stat.text}</span>)}
          </p>
          {overview && overview.length > 0 && (
            <div data-testid="clinical-topic-overview" className="mb-5 rounded-card border border-border-warm/70 bg-light-surface px-4 py-3">
              <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted-text"><span title={CLINICAL_COPY.feed.aiOverviewNote} className="cursor-help underline decoration-dotted">{CLINICAL_COPY.feed.aiOverview}</span></p>
              <p className="text-[15px] leading-relaxed text-espresso">
                {overview.map((sentence) => (
                  <span key={sentence.text}>
                    {sentence.text}
                    {sentence.sources.map((key, index) => {
                      const position = inTab.findIndex((item) => item.key === key)
                      // Separate markers, so that papers 1 and 4 do not read as "14".
                      return <sup key={key} data-source="true" title={headlineOf.get(key) ?? key} className={`cursor-help text-[11px] text-accent-ink ${index === 0 ? "ml-0.5" : "ml-1.5"}`}>{position >= 0 ? position + 1 : "·"}</sup>
                    })}{" "}
                  </span>
                ))}
              </p>
            </div>
          )}
          {feed.items.length === 0 && <p className="mb-4 text-[14px] text-espresso">{CLINICAL_COPY.feed.nothingNew}</p>}
          {feed.warnings.length > 0 && <ul className="mb-4 list-disc pl-5 text-[12px] text-muted-text">{feed.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((item) => (
              <ClinicalFeedCard key={item.key} item={item} storage={storage} saved={saved.has(item.key)} onSave={markSaved}
                entryLabel={topicOf(item)} tone={toneOf(item)} vote={votes.get(item.key)} readLater={data.later.has(item.key)} />
            ))}
          </div>
          {shown.length < inTab.length && (
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
