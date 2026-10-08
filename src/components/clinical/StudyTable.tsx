"use client"

import { useId, useState, type ReactNode } from "react"
import Link from "next/link"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Study } from "@/lib/clinical/evidence/build"
import { KIND_TEXT_COLOUR } from "./evidence-shapes"

const E = CLINICAL_COPY.evidence
const C = E.columns

/** What the table is for: studies of a treatment or of its safety (compared with what, and the result), or research (its finding). */
export type StudyTableKind = "treatment" | "safety" | "research"

const TH = "border-b border-border-warm px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-secondary-dark"
const TH_RIGHT = TH.replace("text-left", "text-right")
const TD = "border-b border-border-warm/60 px-3 py-3 align-top text-[14px] leading-5 text-espresso"
/** A row has a light tint under the pointer. */
const ROW = "transition-colors hover:bg-card-surface/50"
/** The one line over a table, the same over every table of the summary. */
const HEADING = "pb-2 text-[15px] font-semibold text-espresso"
/** The direction of a result, after its words: small bold capitals in the colour of the direction, with nothing around them. */
const KIND_LABEL = "ml-2 text-[11px] font-bold uppercase tracking-wide"

const SIZE_FORMAT = new Intl.NumberFormat("en-US")

function Cell({ name, children }: { name: string; children: ReactNode }) {
  return <td data-cell={name} className={TD}>{children}</td>
}

/** `named`: what the paper itself named as its treatment, in small type under the study. */
function StudyCell({ study, named }: { study: Study; named: string | null }) {
  return (
    <Cell name="study">
      <Link href={`/paper/${study.slug}`} title={study.venue ?? undefined} className="font-medium hover:text-accent-ink">{study.label ?? study.headline}</Link>
      {named && <span data-named="true" className="block text-[12px] text-muted-text">{named}</span>}
      {(study.isNew || study.saved) && (
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {study.isNew && <span className="text-[12px] font-bold uppercase tracking-wide text-accent-ink">{E.studyMarks.new}</span>}
          {study.saved && <span className="rounded-pill border border-border-warm px-2 py-0.5 text-[12px] text-secondary-dark">{E.studyMarks.saved}</span>}
        </span>
      )}
    </Cell>
  )
}

function ResultCell({ study }: { study: Study }) {
  const kind = study.kind
  return (
    <Cell name="result">
      <span>{study.text ?? study.takeaway}</span>
      {kind && <span data-kind-label="true" className={KIND_LABEL} style={{ color: KIND_TEXT_COLOUR[kind] }}>{E.kindLabels[kind]}</span>}
    </Cell>
  )
}

/** One study: its row and, on request, a second row with whom it studied and what it measured. */
function Row({ study, kind, named, width }: { study: Study; kind: StudyTableKind; named: string | null; width: number }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const more = [{ name: C.population, value: study.population }, { name: C.outcome, value: study.outcome }].flatMap((entry) => (entry.value ? [{ name: entry.name, value: entry.value }] : []))
  return (
    <>
      <tr data-study={study.key} className={ROW}>
        <StudyCell study={study} named={named} />
        <Cell name="design">{study.designNamed ? CLINICAL_COPY.designLabels[study.design] : E.noValue}</Cell>
        <td data-cell="size" className={`${TD} text-right tabular-nums`}>{study.sampleSize === null ? E.noValue : SIZE_FORMAT.format(study.sampleSize)}</td>
        {kind === "research" ? <Cell name="finding">{study.takeaway}</Cell> : (
          <>
            <Cell name="comparator">{study.comparator ?? ""}</Cell>
            <ResultCell study={study} />
          </>
        )}
        <Cell name="details">
          {more.length > 0 && (
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="whitespace-nowrap text-[13px] text-accent-ink underline-offset-2 hover:underline">{C.details}</button>
          )}
        </Cell>
      </tr>
      {open && (
        <tr id={id} data-details={study.key}>
          <td colSpan={width} className="border-b border-border-warm/60 bg-card-surface/40 px-3 py-3 text-[14px] leading-5 text-espresso">
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[110px_1fr]">
              {more.map((entry) => (
                <div key={entry.name} className="contents">
                  <dt className="text-[12px] font-semibold uppercase tracking-wide text-secondary-dark">{entry.name}</dt>
                  <dd>{entry.value}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * The studies behind a bubble, under one line with whose they are and how many, one row each: the study, its design
 * and participants, and what it was compared with and found (or, for research, its finding). The direction of a
 * result is written after it in small capitals of its colour. `treatmentShown`: the paper's own name of its treatment is under every study,
 * not only under those that name several. `aside` is drawn at the end of the heading's line. The table scrolls sideways inside its own box when the screen is narrow.
 */
export function StudyTable({ studies, kind, caption, treatmentShown = false, aside }: { studies: Study[]; kind: StudyTableKind; caption: string; treatmentShown?: boolean; aside?: ReactNode }) {
  const id = useId()
  const heads = [C.study, C.design, C.size, ...(kind === "research" ? [C.finding] : [C.comparator, C.result])]
  const heading = <h4 id={id} data-table-heading="true" className={HEADING}>{E.tableHeading(caption, studies.length)}</h4>
  return (
    <div data-study-table={kind}>
      {aside ? <div className="flex flex-wrap items-baseline justify-between gap-x-4">{heading}{aside}</div> : heading}
      <div data-table-scroll="true" className="overflow-x-auto">
        <table aria-labelledby={id} className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              {heads.map((head) => head === C.size
                ? <th key={head} scope="col" title={C.sizeTitle} className={TH_RIGHT}>{head}</th>
                : <th key={head} scope="col" className={TH}>{head}</th>)}
              <th scope="col" className={TH}><span className="sr-only">{C.details}</span></th>
            </tr>
          </thead>
          <tbody>
            {studies.map((study) => <Row key={study.key} study={study} kind={kind} named={treatmentShown || study.severalTreatments ? study.treatment : null} width={heads.length + 1} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * The papers of another treatment that used this one as their comparison, under the same line as any table: the study,
 * the treatment that paper tested, and its result, which is of that treatment. A paper that names none has a dash.
 */
export function ComparisonTable({ studies }: { studies: Study[] }) {
  const id = useId()
  return (
    <div data-compared-in="true">
      <h4 id={id} data-table-heading="true" className={HEADING}>{E.tableHeading(E.comparedName, studies.length)}</h4>
      <div data-table-scroll="true" className="overflow-x-auto">
        <table aria-labelledby={id} className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr>{[C.study, C.tested, C.result].map((head) => <th key={head} scope="col" className={TH}>{head}</th>)}</tr>
          </thead>
          <tbody>
            {studies.map((study) => (
              <tr key={study.key} data-compared={study.key} className={ROW}>
                <StudyCell study={study} named={null} />
                <Cell name="tested">{study.treatment ?? E.noValue}</Cell>
                <ResultCell study={study} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
