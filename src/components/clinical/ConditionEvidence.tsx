"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { loadConditionEvidenceRemote } from "@/lib/clinical/evidence/client"
import type { ClassEvidence, ConditionEvidence as Evidence, Period, Scope, Study } from "@/lib/clinical/evidence/build"
import { BubbleGrid, discBoxHeight } from "./BubbleGrid"
import { EvidenceBubble } from "./EvidenceBubble"
import { EvidenceMap, type MapEntry } from "./EvidenceMap"
import { classNameOf } from "./evidence-labels"
import { ResearchList } from "./ResearchList"
import { StudyTable } from "./StudyTable"
import { TreatmentDetail } from "./TreatmentDetail"

const E = CLINICAL_COPY.evidence
const V = E.page
type SectionName = keyof Evidence["sections"]
type Loaded = { condition: string; period: Period; scope: Scope; evidence: Evidence | null; error: string | null }
/** What the reader has chosen in each section: a class and one of its treatments, a safety group, a research group. */
interface Chosen { classKey: string | null; treatment: string | null; safety: string | null; research: string | null }
const NOTHING: Chosen = { classKey: null, treatment: null, safety: null, research: null }
const EMPTY = "text-[15px] text-muted-text"
/** A section is a card: the surface and the radius of the app's cards, a warm border at low opacity, 20 px of padding and 24 where the map is drawn. */
const CARD = "rounded-card border border-border-warm/60 bg-light-surface p-5 sm:p-6"

const periodPhrase = (period: Exclude<Period, "all">) => E.periodPhrases[period]

/** `chosen` without what `evidence` no longer has (after another scope or period); the same object when all of it is still there. */
function stillThere(chosen: Chosen, evidence: Evidence): Chosen {
  const cls = evidence.classes.find((entry) => entry.key === chosen.classKey) ?? null
  const next: Chosen = {
    classKey: cls ? cls.key : null,
    treatment: cls && cls.treatments.some((entry) => entry.key === chosen.treatment) ? chosen.treatment : null,
    safety: evidence.safety.some((group) => group.key === chosen.safety) ? chosen.safety : null,
    research: evidence.research.some((group) => group.type === chosen.research) ? chosen.research : null,
  }
  return next.classKey === chosen.classKey && next.treatment === chosen.treatment && next.safety === chosen.safety && next.research === chosen.research ? chosen : next
}

/** The publication dates of `studies` that have one, as they are printed. */
const datesOf = (studies: Study[]): string[] => studies.flatMap((study) => (study.date === null ? [] : [study.date]))
/** The dates of the papers of a class: a paper under two of its treatments is one paper. */
const classDates = (cls: ClassEvidence): string[] => datesOf([...new Map(cls.treatments.flatMap((entry) => entry.studies).map((study) => [study.key, study])).values()])

/**
 * One of the three stacked sections, in a card of its own: a row with its name and how many distinct papers it has in a
 * small pill, and nothing else; and 16 px under that row, what it shows.
 */
function Section({ name, count, children }: { name: SectionName; count: number; children: ReactNode }) {
  const id = useId()
  return (
    <section data-section={name} data-section-card={name} aria-labelledby={id} className={CARD}>
      <div data-section-head="true" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={id} className="flex items-center gap-2 font-heading text-[20px] font-semibold leading-7 tracking-heading text-espresso">
          <span>{E.sections[name]}</span>
          <span data-section-count="true" className="rounded-pill bg-card-surface px-2 py-0.5 text-[12px] font-normal leading-4 tracking-normal text-muted-text">{count}</span>
        </h3>
      </div>
      <div data-section-body="true" className="mt-4">{children}</div>
    </section>
  )
}

/**
 * Treatments, Safety and Other research, one under the other. Nothing is chosen at first, so no study is listed until
 * the reader presses a bubble. Treatments is one map: of the classes, and once a class is pressed of its treatments, with
 * a crumb back to the classes; the map fills the card, with the three colours of its bubbles named right beside it.
 * Safety is bubbles on an aligned grid, and Other research a row of pills. What is chosen in one section does not change another. The cards are 20 px apart.
 */
function Sections({ evidence }: { evidence: Evidence }) {
  const [picked, setPicked] = useState<Chosen>(NOTHING)
  // Another scope or period can take away what was chosen: it is then dropped for good, not kept for when it comes back.
  const chosen = stillThere(picked, evidence)
  if (chosen !== picked) setPicked(chosen)
  const choose = (next: Partial<Chosen>) => setPicked({ ...chosen, ...next })
  const cls = evidence.classes.find((entry) => entry.key === chosen.classKey) ?? null
  const treatment = cls?.treatments.find((entry) => entry.key === chosen.treatment) ?? null
  const harms = evidence.safety.find((group) => group.key === chosen.safety) ?? null
  const className = cls ? classNameOf(cls.key, cls.label) : null
  // The one map of the section: the classes, or the treatments of the chosen class.
  const classEntries: MapEntry[] = evidence.classes.map((entry) => ({ key: entry.key, name: classNameOf(entry.key, entry.label), papers: entry.papers, efficacy: entry.efficacy, newPapers: entry.newPapers, participants: entry.participants, sized: entry.sized, dates: classDates(entry) }))
  const treatmentEntries: MapEntry[] = (cls?.treatments ?? []).map((entry) => ({
    key: entry.key, name: entry.name, papers: entry.papers, efficacy: entry.efficacy, newPapers: entry.newPapers, safetyPapers: entry.safetyPapers, comparatorPapers: entry.comparatorPapers, participants: entry.participants, sized: entry.sized, dates: datesOf(entry.studies),
  }))
  const safetyBox = discBoxHeight(evidence.safety.map((group) => group.papers))
  // Back from a class, the keyboard is put on the bubble of that class: its own button is gone with the treatments.
  const treatments = useRef<HTMLDivElement>(null)
  const backFrom = useRef<string | null>(null)
  useEffect(() => {
    const key = backFrom.current
    if (key === null || chosen.classKey !== null) return
    backFrom.current = null
    const buttons = [...(treatments.current?.querySelectorAll<HTMLElement>("button[data-bubble]") ?? [])].filter((button) => button.getAttribute("data-bubble") === key)
    ;(buttons.find((button) => button.offsetParent !== null) ?? buttons[0])?.focus()
  }, [chosen.classKey])
  const leaveClass = () => { backFrom.current = chosen.classKey; choose({ classKey: null, treatment: null }) }
  const mapped = evidence.classes.length > 0
  return (
    <div data-sections="true" className="mt-5 space-y-5">
      <Section name="treatments" count={evidence.sections.treatments}>
        {!mapped ? <p data-empty="true" className={EMPTY}>{E.treatmentsEmpty}</p> : (
          <div ref={treatments}>
            <div data-treatments-lines="true" className="max-w-[720px] text-secondary-dark">
              <p className="text-[15px] leading-6">{E.lines.one}</p>
              <p className="text-[15px] leading-6">{E.lines.colours}</p>
            </div>
            {cls && className ? (
              <div data-treatments={cls.key} className="mt-4">
                <p data-crumb="true" className="text-[14px] text-secondary-dark">
                  <button type="button" autoFocus onClick={leaveClass} className="text-accent-ink underline-offset-2 hover:underline">{E.allClasses}</button>
                  <span aria-hidden="true">{E.crumbGap}</span>
                  <span aria-current="true" className="font-semibold text-espresso">{className}</span>
                </p>
                <EvidenceMap label={E.rows.treatments(className)} entries={treatmentEntries} chosen={chosen.treatment} onPick={(key) => choose({ treatment: key === chosen.treatment ? null : key })} />
                {treatment && <TreatmentDetail key={treatment.key} treatment={treatment} />}
              </div>
            ) : (
              <div data-classes="true">
                <EvidenceMap label={E.rows.classes} entries={classEntries} chosen={null} onPick={(key) => choose({ classKey: key, treatment: null })} />
              </div>
            )}
          </div>
        )}
      </Section>
      <Section name="safety" count={evidence.sections.safety}>
        {evidence.safety.length === 0 ? <p className={EMPTY}>{E.safetyEmpty}</p> : (
          <>
            <BubbleGrid label={E.rows.safety}>
              {evidence.safety.map((group) => (
                <EvidenceBubble key={group.key} id={group.key} name={group.name} papers={group.papers} newPapers={group.newPapers} discHeight={safetyBox}
                  pressed={group.key === chosen.safety} onPick={() => choose({ safety: group.key === chosen.safety ? null : group.key })} />
              ))}
            </BubbleGrid>
            {harms && <div className="pt-4"><StudyTable key={harms.key} studies={harms.studies} kind="safety" caption={harms.name} /></div>}
          </>
        )}
      </Section>
      <Section name="research" count={evidence.sections.research}>
        {evidence.research.length === 0 ? <p data-empty="true" className={EMPTY}>{E.researchEmpty}</p>
          : <ResearchList groups={evidence.research} chosen={chosen.research} onChoose={(research) => choose({ research })} />}
      </Section>
    </div>
  )
}

/** The line that says what the summary is built from: everything the feed listed, or the papers the reader saved; of all time, or of a period. */
function basisOf(evidence: Evidence, phrase: string | null): string {
  const name = evidence.condition.name
  if (evidence.scope === "saved") return phrase === null ? E.basisSaved(evidence.total, name) : E.basisSavedPeriod(evidence.total, evidence.savedCount, phrase, name)
  return phrase === null ? E.basis(evidence.total, name, evidence.since) : E.basisPeriod(evidence.total, evidence.collected, phrase, name)
}

/**
 * The evidence the reader's feed has seen on one condition (spec D53): the classes of treatment as bubbles on a map,
 * the treatments of a chosen class on the same map, and for a chosen treatment the table of its papers; the safety papers as bubbles and the other research as pills, each with its table; and, folded away,
 * when the papers came out. Counted on the server from the stored findings.
 * Papers are counted, never pooled. Which papers (`scope`) and of what time (`period`) is the caller's to
 * say: the Evidence view keeps both in its address; a page's fenced block asks for everything.
 */
export function ConditionEvidence({ condition, scope = "all", period = "all", onLoaded }: { condition: string | null; scope?: Scope; period?: Period; onLoaded?: (evidence: Evidence) => void }) {
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
  if (!condition) return <p className="my-4 text-[15px] text-muted-text">{E.notAQuery}</p>
  if (current?.error) return <p role="alert" className="my-4 text-[15px] text-accent-ink">{current.error}</p>
  const evidence = current?.evidence ?? null
  if (!evidence) return <p className="my-4 text-[15px] text-muted-text">{E.loading}</p>
  if (evidence.collected === 0) return <p className="my-4 text-[15px] text-muted-text">{E.empty(evidence.condition.name)}</p>
  const name = evidence.condition.name
  const phrase = evidence.period === "all" ? null : periodPhrase(evidence.period)
  const saved = evidence.scope === "saved"
  const pending = current?.period !== period || current?.scope !== scope
  // Why there is nothing to draw, when there is nothing: no paper is saved, or none of them is of the period.
  const nothing = evidence.total > 0 ? null
    : saved && evidence.savedCount === 0 ? E.noneSaved(name, V.scopeLabel, V.scopes.all)
    : phrase !== null ? (saved ? E.emptySavedPeriod(name, phrase, evidence.savedCount) : E.emptyPeriod(name, phrase, evidence.collected))
    : null
  return (
    <div data-testid="condition-evidence" aria-busy={pending ? "true" : undefined} className={pending ? "my-4 text-[15px] opacity-60 transition-opacity" : "my-4 text-[15px]"}>
      <p data-testid="evidence-basis" className="text-[14px] text-muted-text">{basisOf(evidence, phrase)}</p>
      {nothing !== null ? <p data-nothing="true" className="mt-4 text-[15px] text-muted-text">{nothing}</p> : <Sections key={evidence.condition.code} evidence={evidence} />}
    </div>
  )
}
