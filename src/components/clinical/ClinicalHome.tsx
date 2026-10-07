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
import { LOOK_BACK, lookBackName, lookBackOf, lookBackPhrase, settingsForLookBack, settingsForRange, type LookBack } from "@/lib/clinical/modes"
import { loadFeedback, type FeedbackKind } from "@/lib/clinical/feedback/store"
import { clearSeen, recordSeen } from "@/lib/clinical/seen/store"
import { loadReadLater } from "@/lib/clinical/readlater/store"
import { tidyOverviewSentence } from "@/lib/clinical/text/overview-text"
import { conditionLabel } from "@/lib/clinical/topic-label"
import { entryLabel, topicLookup } from "./topic"
import { refreshClinicalFeed } from "@/lib/clinical/feed/client"
import { loadClinicalFeed, type StoredFeed } from "@/lib/clinical/feed/stored"
import { loadClinicalSettings, loadWatchEntries, saveClinicalSettings } from "@/lib/clinical/watch/store"
import { DESIGNS, PAGE_SIZE, type ClinicalSettings, type ClinicalStage, type WatchEntry } from "@/lib/clinical/types"
import { ClinicalFeedCard } from "./ClinicalFeedCard"

type Loaded = {
  entries: WatchEntry[]; settings: ClinicalSettings; feed: StoredFeed | null; saved: Set<string>; votes: Map<string, FeedbackKind>
  /** Papers on the Read later list. */
  later: Set<string>
}

const OVERVIEW_KIND_ORDER = ["benefit", "no-benefit", "mixed", "safety", "other"] as const
/** The colour of a kind of finding: green for benefit, red for none; the rest are set in the text colour. */
const KIND_COLOUR: Partial<Record<(typeof OVERVIEW_KIND_ORDER)[number], string>> = { benefit: "var(--clinical-benefit)", "no-benefit": "var(--clinical-no-benefit)" }
const SPACE = " "
const tint = (colour: string) => `color-mix(in srgb, ${colour} 16%, transparent)`
/** The words that turn a finding round. Marked in findings of no benefit and in mixed ones. */
const NEGATION = /\b(?:not|no|nor|neither|without)\b/gi

export function ClinicalHome() {
  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [data, setData] = useState<Loaded | null>(null)
  const [pages, setPages] = useState(1)
  /** The topic tab on screen: a watch entry's id, or null for all topics. */
  const [topic, setTopic] = useState<string | null>(null)
  /** Whether "Custom dates" is chosen, and the two dates as typed so far. */
  const [customDates, setCustomDates] = useState<{ from: string; to: string } | null>(null)
  /** The card just jumped to from the AI overview; it is marked for a moment. */
  const [jumped, setJumped] = useState<number | null>(null)
  /** What "Show seen papers again" answered, until the next refresh. */
  const [seenNote, setSeenNote] = useState<string | null>(null)
  const [stage, setStage] = useState<ClinicalStage | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const [entries, settings, feed, bundle, feedback, laterItems] = await Promise.all([
          loadWatchEntries(vault), loadClinicalSettings(vault), loadClinicalFeed(vault), loadBundle(vault), loadFeedback(vault), loadReadLater(vault),
        ])
        const saved = new Set([...bundle.pages.values()].filter((page) => page.frontmatter.type === "paper").map((page) => paperKey(paperRecordFromFrontmatter(page.frontmatter))))
        if (cancelled) return
        setStorage(vault)
        if (settings.range) setCustomDates(settings.range)
        setData({ entries, settings, feed, saved, votes: new Map(feedback.map((event) => [event.paperKey, event.kind])), later: new Set(laterItems.map((entry) => entry.key)) })
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
    setSeenNote(null)
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
  // A date typed into "Custom dates": saved as the search range as soon as both dates are valid and in order.
  const changeDate = (patch: Partial<{ from: string; to: string }>) => {
    const next = { from: "", to: "", ...customDates, ...patch }
    setCustomDates(next)
    const range = settingsForRange(next.from, next.to)
    if (range) void changeSettings(range)
  }
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
  const shown = inTab.slice(0, pages * PAGE_SIZE)
  const current = lookBackOf(settings)
  const feedLookBack = feed ? shownLookBack : current
  const tabs = [
    { id: null as string | null, label: CLINICAL_COPY.feed.allTopics, count: feed?.items.length ?? 0 },
    ...listTopics.map((entry) => ({ id: entry.id as string | null, label: entryLabel(entry), count: (feed?.items ?? []).filter((item) => item.entryId === entry.id).length })),
  ]
  const overview = topic !== null ? feed?.topicOverviews?.[topic] : undefined
  const headlineOf = new Map((feed?.items ?? []).map((item) => [item.key, item.digest?.headline ?? item.paper.title]))
  // The overview in two parts: points about papers on the whole topic, then about papers on its condition alone.
  const overviewTopic = listTopics.find((entry) => entry.id === topic)
  const overviewGroups = [
    { id: "focus", title: overviewTopic ? entryLabel(overviewTopic) : "", points: (overview ?? []).filter((point) => point.group !== "related") },
    { id: "related", title: CLINICAL_COPY.feed.alsoOn(overviewTopic ? (conditionLabel(overviewTopic) ?? entryLabel(overviewTopic)) : ""), points: (overview ?? []).filter((point) => point.group === "related") },
  ].filter((group) => group.points.length > 0)
  // Each part as a synthesis: one line per kind of finding. An overview stored before findings had a kind reads as "other".
  const overviewRows = (points: NonNullable<typeof overview>) =>
    OVERVIEW_KIND_ORDER.map((kind) => ({ kind, points: points.filter((point) => (point.kind ?? "other") === kind) })).filter((row) => row.points.length > 0)
  // The first line of the overview: the papers of the tab, and how many the overview cites under each kind.
  const kindCounts = OVERVIEW_KIND_ORDER
    .filter((kind) => kind !== "other")
    .map((kind) => ({ label: CLINICAL_COPY.feed.overviewKinds[kind], count: new Set((overview ?? []).filter((point) => point.kind === kind).flatMap((point) => point.sources).filter((key) => inTab.some((item) => item.key === key))).size }))
    .filter((entry) => entry.count > 0)
  const forgetSeen = async () => {
    if (!storage) return
    try { setSeenNote(CLINICAL_COPY.feed.seenForgotten(await clearSeen(storage, current))) } catch { setSeenNote(CLINICAL_COPY.feed.seenForgetFailed) }
  }
  /**
   * A sentence with its treatment marked and, where the finding is that something did not help, the
   * word that says so. Only words that are in the sentence as written are marked.
   */
  const marked = (text: string, treatment: string | undefined, kind: (typeof OVERVIEW_KIND_ORDER)[number]) => {
    const colour = KIND_COLOUR[kind]
    const spans: Array<{ at: number; end: number; negation: boolean }> = []
    const found = treatment ? text.indexOf(treatment) : -1
    if (treatment && found >= 0) spans.push({ at: found, end: found + treatment.length, negation: false })
    if (kind === "no-benefit" || kind === "mixed") {
      for (const match of text.matchAll(NEGATION)) {
        const at = match.index ?? 0
        if (!spans.some((span) => at < span.end && at + match[0].length > span.at)) spans.push({ at, end: at + match[0].length, negation: true })
      }
    }
    spans.sort((a, b) => a.at - b.at)
    const parts: React.ReactNode[] = []
    let cursor = 0
    for (const span of spans) {
      if (span.at > cursor) parts.push(<span key={cursor}>{text.slice(cursor, span.at)}</span>)
      const shade = span.negation ? "var(--clinical-no-benefit)" : colour
      parts.push(
        <mark key={span.at} {...(span.negation ? { "data-negation": "true" } : { "data-treatment": "true" })}
          className={`rounded-[3px] px-0.5 text-espresso ${shade ? "" : "bg-orange/15"}`} style={shade ? { backgroundColor: tint(shade) } : undefined}>{text.slice(span.at, span.end)}</mark>,
      )
      cursor = span.end
    }
    if (cursor < text.length) parts.push(<span key={cursor}>{text.slice(cursor)}</span>)
    return parts
  }
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
  // Jump to a card by its place in the tab, opening as much of the list as it takes to reach it.
  // The card is marked for a moment so the eye finds it. The scroll waits for the list to be drawn
  // (it may have just grown) and is not animated: an animated scroll was being cancelled by the redraw.
  const jumpTo = (position: number) => {
    setPages((current) => Math.max(current, Math.ceil((position + 1) / PAGE_SIZE)))
    setJumped(position + 1)
    const scroll = () => document.getElementById(`paper-${position + 1}`)?.scrollIntoView?.({ block: "center" })
    setTimeout(scroll, 60)
    setTimeout(scroll, 300)
    // Long enough to find the card and start reading it; a hover, by contrast, ends with the pointer.
    setTimeout(() => setJumped((current) => (current === position + 1 ? null : current)), 6000)
  }
  const markSaved = (key: string) => setData((current) => (current ? { ...current, saved: new Set(current.saved).add(key) } : current))

  return (
    <div className="p-7">
      {/* The title and the controls share one line; the status line sits beneath them. */}
      <div className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="font-heading text-[26px] font-semibold tracking-heading text-espresso">{CLINICAL_COPY.feed.heading}</h1>
          <div className="flex shrink-0 items-center gap-2">
              <select aria-label={CLINICAL_COPY.feed.lookBack} title={CLINICAL_COPY.feed.lookBack} value={customDates ? "custom" : current}
              onChange={(event) => {
                if (event.target.value === "custom") { setCustomDates(settings.range ?? { from: "", to: "" }); return }
                setCustomDates(null)
                void changeSettings(settingsForLookBack(event.target.value as LookBack))
              }}
              className="rounded-pill border border-border-warm bg-transparent px-3 py-1.5 text-[13px] text-espresso">
              {LOOK_BACK.map((key) => <option key={key} value={key}>{lookBackName(key)}</option>)}
              <option value="custom">{CLINICAL_COPY.feed.customDates}</option>
            </select>
            {customDates && (
              <>
                <input type="date" aria-label={CLINICAL_COPY.feed.dateFrom} title={CLINICAL_COPY.feed.dateFrom} value={customDates.from} max={customDates.to || undefined}
                  onChange={(event) => changeDate({ from: event.target.value })} className="rounded-pill border border-border-warm bg-transparent px-3 py-1.5 text-[13px] text-espresso" />
                <input type="date" aria-label={CLINICAL_COPY.feed.dateTo} title={CLINICAL_COPY.feed.dateTo} value={customDates.to} min={customDates.from || undefined}
                  onChange={(event) => changeDate({ to: event.target.value })} className="rounded-pill border border-border-warm bg-transparent px-3 py-1.5 text-[13px] text-espresso" />
              </>
            )}
            <button type="button" onClick={() => void refresh()} disabled={running || entries.length === 0}
              className="rounded-pill bg-orange px-4 py-1.5 text-[13px] font-medium text-on-accent hover:bg-orange/90 disabled:opacity-50">
              {running ? CLINICAL_COPY.feed.refreshing : CLINICAL_COPY.feed.refresh}
            </button>
          </div>
        </div>
        {feed && entries.length > 0 && (
          <p data-testid="clinical-feed-status" className="mt-1 text-[14px] text-secondary-dark">
            {CLINICAL_COPY.feed.status(feed.stats.listed, feed.stats.retrieved, lookBackPhrase(feedLookBack), new Date(feed.generatedAt).toLocaleString())}
            <button type="button" onClick={() => void forgetSeen()} title={CLINICAL_COPY.feed.showSeenAgainNote} className="ml-3 text-[13px] text-accent-ink underline decoration-dotted hover:text-accent-ink-hover">{CLINICAL_COPY.feed.showSeenAgain}</button>
          </p>
        )}
        {seenNote && <p role="status" className="mt-1 text-[13px] text-accent-ink">{seenNote}</p>}
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
          {feedLookBack !== current && <p className="mb-4 text-[14px] text-accent-ink">{CLINICAL_COPY.feed.modeChanged(lookBackPhrase(current))}</p>}
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
            <div data-testid="clinical-topic-overview" className="mb-5 rounded-card border border-border-warm/70 bg-light-surface px-5 py-4">
              <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted-text">
                <span title={CLINICAL_COPY.feed.aiOverviewNote} className="cursor-help underline decoration-dotted">{CLINICAL_COPY.feed.aiOverview}</span>
                <span data-testid="overview-counts" className="ml-2 normal-case tracking-normal">{CLINICAL_COPY.feed.overviewCounts(inTab.length, kindCounts)}</span>
              </p>
              {/* Running text: what helped, what did not, mixed, safety, the rest. Papers on the whole topic first, then those on its condition alone. */}
              {overviewGroups.map((group) => (
                <div key={group.id} data-overview-group={group.id} className="mt-2.5 first:mt-0">
                  {overviewGroups.length > 1 && <span data-group-title="true" className="mb-0.5 block text-[13px] font-semibold text-secondary-dark">{group.title}</span>}
                  {overviewGroups.length === 1 && <span data-group-title="true" className="sr-only">{group.title}</span>}
                  <p className="text-[15px] leading-[1.75] text-espresso">
                    {overviewRows(group.points).map((row) => (
                      <span key={row.kind} data-kind={row.kind}>
                        <span data-kind-label="true" className="mr-1.5 text-[12px] font-semibold uppercase tracking-wide" style={KIND_COLOUR[row.kind] ? { color: KIND_COLOUR[row.kind] } : undefined}>{CLINICAL_COPY.feed.overviewKinds[row.kind]}</span>
                        {row.points.map((point) => (
                          <span key={point.text}>
                            {marked(tidyOverviewSentence(point.text), point.emphasis?.[0], row.kind)}
                            {point.sources.map((key, index) => {
                              // A source is always a paper of this list: the overview is written from the listed papers only.
                              const position = inTab.findIndex((item) => item.key === key)
                              if (position < 0) return null
                              return (
                                <button key={key} type="button" data-source="true" title={headlineOf.get(key) ?? key} onMouseDown={(event) => event.preventDefault()} onClick={() => jumpTo(position)}
                                  className={`align-super text-[11px] font-medium text-accent-ink underline decoration-dotted hover:text-accent-ink-hover ${index === 0 ? "ml-0.5" : "ml-1.5"}`}>{position + 1}</button>
                              )
                            })}
                            <span>{SPACE}</span>
                          </span>
                        ))}
                      </span>
                    ))}
                  </p>
                </div>
              ))}
            </div>
          )}
          {feed.items.length === 0 && <p className="mb-4 text-[14px] text-espresso">{CLINICAL_COPY.feed.nothingNew}</p>}
          {feed.warnings.length > 0 && <ul className="mb-4 list-disc pl-5 text-[12px] text-muted-text">{feed.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <div className="grid gap-4 lg:grid-cols-2">
            {shown.map((item, index) => (
              <ClinicalFeedCard key={item.key} item={item} storage={storage} saved={saved.has(item.key)} onSave={markSaved} position={index + 1} highlighted={jumped === index + 1}
                entryLabel={topicOf(item)} tone={toneOf(item)} vote={votes.get(item.key)} readLater={data.later.has(item.key)} />
            ))}
          </div>
          {shown.length < inTab.length && (
            <button type="button" onClick={() => setPages(pages + 1)} className="mt-5 rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso hover:bg-card-surface/60">
              {CLINICAL_COPY.feed.morePapers}
            </button>
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
