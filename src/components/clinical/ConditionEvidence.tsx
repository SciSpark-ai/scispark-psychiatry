"use client"

import { useEffect, useId, useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { loadConditionEvidenceRemote } from "@/lib/clinical/evidence/client"
import type { ConditionEvidence as Evidence, Period } from "@/lib/clinical/evidence/build"
import { parseEvidenceQuery } from "@/lib/clinical/records/query"
import { EvidenceTimeline } from "./EvidenceTimeline"
import { ResearchList } from "./ResearchList"
import { StudyTable } from "./StudyTable"
import { TreatmentList } from "./TreatmentList"

const E = CLINICAL_COPY.evidence
const PERIODS: Period[] = ["all", "12m", "6m", "3m"]
const TABS = ["treatments", "safety", "research"] as const
type Tab = (typeof TABS)[number]
type Loaded = { condition: string; period: Period; evidence: Evidence | null; error: string | null }

const periodPhrase = (period: Exclude<Period, "all">) => E.periodPhrases[period]

function PeriodSelect({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  return (
    <select aria-label={E.periodLabel} value={period} onChange={(event) => onChange(event.target.value as Period)}
      className="rounded-pill border border-border-warm bg-light-surface px-3 py-1 text-[12px] text-espresso">
      {PERIODS.map((entry) => <option key={entry} value={entry}>{E.periods[entry]}</option>)}
    </select>
  )
}

function Tabs({ evidence, tab, onPick }: { evidence: Evidence; tab: Tab; onPick: (tab: Tab) => void }) {
  const id = useId()
  const totals: Record<Tab, number> = {
    treatments: evidence.classes.reduce((sum, entry) => sum + entry.papers, 0),
    safety: evidence.safety.length,
    research: evidence.research.reduce((sum, group) => sum + group.papers, 0),
  }
  return (
    <div className="mt-4">
      <div role="tablist" aria-label={E.tabsLabel} className="flex gap-1 border-b border-border-warm">
        {TABS.map((entry) => (
          <button key={entry} type="button" role="tab" id={`${id}-${entry}`} aria-selected={tab === entry} aria-controls={`${id}-panel`} onClick={() => onPick(entry)}
            className={tab === entry ? "border-b-2 border-accent-ink px-3 py-2 text-[14px] font-semibold text-espresso" : "px-3 py-2 text-[14px] text-secondary-dark hover:text-espresso"}>
            <span>{E.tabs[entry]}</span>
            <span data-tab-count="true" className="ml-1.5 text-[12px] text-muted-text">{totals[entry]}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="pt-2">
        {tab === "treatments" && <TreatmentList classes={evidence.classes} />}
        {tab === "safety" && (evidence.safety.length > 0 ? <StudyTable studies={evidence.safety} kind="safety" /> : <p className="py-3 text-[14px] text-muted-text">{E.safetyEmpty}</p>)}
        {tab === "research" && <ResearchList groups={evidence.research} />}
      </div>
    </div>
  )
}

/**
 * The evidence the reader's feed has seen on one condition (spec D53), drawn from the page's fenced
 * block: classes of treatment, what each treatment did in a few words, and the studies on request;
 * the safety findings; the research that names no treatment; and, folded away, when the papers came
 * out. Counted on the server from the stored findings. Papers are counted, never pooled.
 */
export function ConditionEvidence({ body }: { body: string }) {
  const condition = parseEvidenceQuery(body)?.condition ?? null
  const [period, setPeriod] = useState<Period>("all")
  const [tab, setTab] = useState<Tab>("treatments")
  // The answer is kept with what it was asked for, so a new period keeps showing the last answer until the next comes, and another condition starts from "Counting…".
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    if (!condition) return
    let cancelled = false
    loadConditionEvidenceRemote(condition, period)
      .then((next) => { if (!cancelled) setLoaded({ condition, period, evidence: next, error: null }) })
      .catch((failure) => { if (!cancelled) setLoaded({ condition, period, evidence: null, error: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { cancelled = true }
  }, [condition, period])

  const current = loaded && loaded.condition === condition ? loaded : null
  if (!condition) return <p className="my-4 text-[13px] text-muted-text">{E.notAQuery}</p>
  if (current?.error) {
    return (
      <div className="my-4 flex items-center gap-3">
        <p role="alert" className="text-[13px] text-accent-ink">{current.error}</p>
        <PeriodSelect period={period} onChange={setPeriod} />
      </div>
    )
  }
  const evidence = current?.evidence ?? null
  if (!evidence) return <p className="my-4 text-[13px] text-muted-text">{E.loading}</p>
  if (evidence.collected === 0) return <p className="my-4 text-[14px] text-muted-text">{E.empty(evidence.condition.name)}</p>
  const name = evidence.condition.name
  const phrase = evidence.period === "all" ? null : periodPhrase(evidence.period)
  const basis = phrase === null ? E.basis(evidence.total, name, evidence.since) : E.basisPeriod(evidence.total, evidence.collected, phrase, name)
  const pending = current?.period !== period
  return (
    <div data-testid="condition-evidence" aria-busy={pending ? "true" : undefined} className={pending ? "my-4 opacity-60 transition-opacity" : "my-4"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p data-testid="evidence-basis" className="text-[13px] text-muted-text">{basis}</p>
        <PeriodSelect period={period} onChange={setPeriod} />
      </div>
      {evidence.total === 0 && phrase !== null ? (
        <p className="mt-4 text-[14px] text-muted-text">{E.emptyPeriod(name, phrase, evidence.collected)}</p>
      ) : (
        <Tabs key={evidence.condition.code} evidence={evidence} tab={tab} onPick={setTab} />
      )}
      {evidence.total > 0 && (
        <details className="mt-7">
          <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-wide text-accent-ink">{E.timeline}</summary>
          <div className="mt-2"><EvidenceTimeline evidence={evidence} /></div>
        </details>
      )}
    </div>
  )
}
