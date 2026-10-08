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
const EMPTY = "py-2 text-[14px] text-muted-text"

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
 * The small button beside a heading: what it is about is its title, and is shown under the heading on a press or
 * while it has the keyboard. Escape puts it away.
 */
function About({ label, text }: { label: string; text: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" data-about="true" aria-label={label} title={text} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false) }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border-warm text-[12px] font-semibold leading-none text-muted-text hover:text-espresso focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink">{E.about.mark}</button>
      {open && <p id={id} role="note" data-about-text="true" className="absolute left-0 top-full z-20 mt-1 w-80 max-w-[80vw] rounded-card border border-border-warm bg-light-surface p-3 text-[13px] leading-snug text-secondary-dark shadow-md">{text}</p>}
    </>
  )
}

/** One of the three stacked sections: its name and how many distinct papers it has, a button about it when it has one, then its bubbles. */
function Section({ name, count, about, children }: { name: SectionName; count: number; about?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section data-section={name} aria-labelledby={id} className="mt-7">
      <div className="relative flex items-center gap-2">
        <h3 id={id} className="font-heading text-[19px] font-semibold tracking-heading text-espresso">
          <span>{E.sections[name]}</span>
          <span data-section-count="true" className="ml-2 text-[13px] font-normal text-muted-text">{count}</span>
        </h3>
        {about}
      </div>
      {children}
    </section>
  )
}

/**
 * Treatments, Safety and Other research, one under the other. Nothing is chosen at first, so no study is listed until
 * the reader presses a bubble. Treatments is one map: of the classes, and once a class is pressed of its treatments, with
 * a crumb back to the classes. What is chosen in one section does not change another.
 */
function Sections({ evidence }: { evidence: Evidence }) {
  const [picked, setPicked] = useState<Chosen>(NOTHING)
  // The day the map's time scale ends at: read once, when the sections are first drawn.
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
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
  return (
    <>
      <Section name="treatments" count={evidence.sections.treatments} about={evidence.classes.length > 0 ? <About label={E.about.label} text={E.about.text} /> : undefined}>
        {evidence.classes.length === 0 ? <p data-empty="true" className={EMPTY}>{E.treatmentsEmpty}</p> : (
          <div ref={treatments}>
            <div data-treatments-lines="true" className="mt-1 max-w-[720px] text-secondary-dark">
              <p className="text-[13px]">{E.lines.one}</p>
              <p className="text-[13px]"><span>{E.lines.colours}</span>{" "}<span data-map-only="true" className="hidden sm:inline">{E.lines.moved}</span></p>
            </div>
            {cls && className ? (
              <div data-treatments={cls.key} className="mt-2">
                <p data-crumb="true" className="text-[13px] text-secondary-dark">
                  <button type="button" autoFocus onClick={leaveClass} className="text-accent-ink underline-offset-2 hover:underline">{E.allClasses}</button>
                  <span aria-hidden="true">{E.crumbGap}</span>
                  <span aria-current="true" className="font-semibold text-espresso">{className}</span>
                </p>
                <EvidenceMap label={E.rows.treatments(className)} entries={treatmentEntries} chosen={chosen.treatment} today={today} onPick={(key) => choose({ treatment: key === chosen.treatment ? null : key })} />
                {treatment && <TreatmentDetail key={treatment.key} treatment={treatment} />}
              </div>
            ) : (
              <div data-classes="true">
                <EvidenceMap label={E.rows.classes} entries={classEntries} chosen={null} today={today} onPick={(key) => choose({ classKey: key, treatment: null })} />
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
            {harms && <div className="pt-1"><StudyTable key={harms.key} studies={harms.studies} kind="safety" caption={harms.name} /></div>}
          </>
        )}
      </Section>
      <Section name="research" count={evidence.sections.research}>
        {evidence.research.length === 0 ? <p data-empty="true" className={EMPTY}>{E.researchEmpty}</p>
          : <ResearchList groups={evidence.research} chosen={chosen.research} onChoose={(research) => choose({ research })} />}
      </Section>
    </>
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
 * the treatments of a chosen class on the same map, and for a chosen treatment what its papers found, a dot per paper and the
 * table of them; the safety papers and the other research, as bubbles with their tables; and, folded away,
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
  if (!condition) return <p className="my-4 text-[13px] text-muted-text">{E.notAQuery}</p>
  if (current?.error) return <p role="alert" className="my-4 text-[13px] text-accent-ink">{current.error}</p>
  const evidence = current?.evidence ?? null
  if (!evidence) return <p className="my-4 text-[13px] text-muted-text">{E.loading}</p>
  if (evidence.collected === 0) return <p className="my-4 text-[14px] text-muted-text">{E.empty(evidence.condition.name)}</p>
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
    <div data-testid="condition-evidence" aria-busy={pending ? "true" : undefined} className={pending ? "my-4 opacity-60 transition-opacity" : "my-4"}>
      <p data-testid="evidence-basis" className="text-[13px] text-muted-text">{basisOf(evidence, phrase)}</p>
      {nothing !== null ? <p data-nothing="true" className="mt-4 text-[14px] text-muted-text">{nothing}</p> : <Sections key={evidence.condition.code} evidence={evidence} />}
    </div>
  )
}
