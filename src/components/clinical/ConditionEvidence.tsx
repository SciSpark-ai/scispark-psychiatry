"use client"

import { useEffect, useId, useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { loadConditionEvidenceRemote } from "@/lib/clinical/evidence/client"
import type { ConditionEvidence as Evidence, Period, Scope, Study } from "@/lib/clinical/evidence/build"
import { EvidenceTimeline } from "./EvidenceTimeline"
import { ResearchList } from "./ResearchList"
import { StudyTable } from "./StudyTable"
import { TreatmentList } from "./TreatmentList"

const E = CLINICAL_COPY.evidence
const TABS = ["treatments", "safety", "research"] as const
type Tab = (typeof TABS)[number]
type Loaded = { condition: string; period: Period; scope: Scope; evidence: Evidence | null; error: string | null }

const periodPhrase = (period: Exclude<Period, "all">) => E.periodPhrases[period]

/** The studies of the safety groups, each paper once (a paper is in the group of every treatment it names), newest first. */
function safetyStudies(evidence: Evidence): Study[] {
  const byKey = new Map<string, Study>()
  for (const group of evidence.safety) for (const study of group.studies) byKey.set(study.key, study)
  return [...byKey.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.key.localeCompare(b.key))
}

function Tabs({ evidence, tab, onPick }: { evidence: Evidence; tab: Tab; onPick: (tab: Tab) => void }) {
  const id = useId()
  // Distinct papers: a paper is in one section, however many treatments it names.
  const totals: Record<Tab, number> = evidence.sections
  const safety = safetyStudies(evidence)
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
        {tab === "safety" && (safety.length > 0 ? <StudyTable studies={safety} kind="safety" /> : <p className="py-3 text-[14px] text-muted-text">{E.safetyEmpty}</p>)}
        {tab === "research" && <ResearchList groups={evidence.research} />}
      </div>
    </div>
  )
}

/**
 * The evidence the reader's feed has seen on one condition (spec D53): classes of treatment, what each
 * treatment did in a few words, and the studies on request; the safety findings; the research that names
 * no treatment; and, folded away, when the papers came out. Counted on the server from the stored findings.
 * Papers are counted, never pooled. Which papers (`scope`) and of what time (`period`) is the caller's to
 * say: the Evidence view keeps both in its address; a page's fenced block asks for everything.
 */
export function ConditionEvidence({ condition, scope = "all", period = "all", onLoaded }: { condition: string | null; scope?: Scope; period?: Period; onLoaded?: (evidence: Evidence) => void }) {
  const [tab, setTab] = useState<Tab>("treatments")
  // The answer is kept with what it was asked for, so a new period or scope keeps showing the last answer until the next comes, and another condition starts from "Counting…".
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    if (!condition) return
    let cancelled = false
    loadConditionEvidenceRemote(condition, { period, scope })
      .then((next) => {
        if (cancelled) return
        setLoaded({ condition, period, scope, evidence: next, error: null })
        onLoaded?.(next)
      })
      .catch((failure) => { if (!cancelled) setLoaded({ condition, period, scope, evidence: null, error: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { cancelled = true }
  }, [condition, period, scope, onLoaded])

  const current = loaded && loaded.condition === condition ? loaded : null
  if (!condition) return <p className="my-4 text-[13px] text-muted-text">{E.notAQuery}</p>
  if (current?.error) return <p role="alert" className="my-4 text-[13px] text-accent-ink">{current.error}</p>
  const evidence = current?.evidence ?? null
  if (!evidence) return <p className="my-4 text-[13px] text-muted-text">{E.loading}</p>
  if (evidence.collected === 0) return <p className="my-4 text-[14px] text-muted-text">{E.empty(evidence.condition.name)}</p>
  const name = evidence.condition.name
  const phrase = evidence.period === "all" ? null : periodPhrase(evidence.period)
  const basis = phrase === null ? E.basis(evidence.total, name, evidence.since) : E.basisPeriod(evidence.total, evidence.collected, phrase, name)
  const pending = current?.period !== period || current?.scope !== scope
  return (
    <div data-testid="condition-evidence" aria-busy={pending ? "true" : undefined} className={pending ? "my-4 opacity-60 transition-opacity" : "my-4"}>
      <p data-testid="evidence-basis" className="text-[13px] text-muted-text">{basis}</p>
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
