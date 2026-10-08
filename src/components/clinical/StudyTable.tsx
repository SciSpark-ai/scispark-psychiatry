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

const TH = "border-b border-border-warm px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-secondary-dark"
const TD = "border-b border-border-warm/60 px-3 py-2.5 align-top text-[13px] text-espresso"

function Cell({ name, children }: { name: string; children: ReactNode }) {
  return <td data-cell={name} className={TD}>{children}</td>
}

/** `named`: what the paper itself named as its treatment, in small type under the study. */
function StudyCell({ study, named }: { study: Study; named: string | null }) {
  return (
    <Cell name="study">
      <Link href={`/paper/${study.slug}`} title={study.venue ?? undefined} className="font-semibold hover:text-accent-ink">{study.label ?? study.headline}</Link>
      {named && <span data-named="true" className="block text-[12px] text-muted-text">{named}</span>}
      {(study.isNew || study.saved) && (
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {study.isNew && <span className="text-[11px] font-bold uppercase tracking-wide text-accent-ink">{E.studyMarks.new}</span>}
          {study.saved && <span className="rounded-pill border border-border-warm px-2 py-0.5 text-[11px] text-secondary-dark">{E.studyMarks.saved}</span>}
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
      {kind && <span data-kind-label="true" className="ml-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: KIND_TEXT_COLOUR[kind] }}>{E.kindLabels[kind]}</span>}
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
      <tr data-study={study.key}>
        <StudyCell study={study} named={named} />
        <Cell name="design">{E.designCell(study.designNamed ? CLINICAL_COPY.designLabels[study.design] : null, study.sampleSize)}</Cell>
        {kind === "research" ? <Cell name="finding">{study.takeaway}</Cell> : (
          <>
            <Cell name="comparator">{study.comparator ?? ""}</Cell>
            <ResultCell study={study} />
          </>
        )}
        <Cell name="details">
          {more.length > 0 && (
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="whitespace-nowrap text-[12px] text-accent-ink underline-offset-2 hover:underline">{C.details}</button>
          )}
        </Cell>
      </tr>
      {open && (
        <tr id={id} data-details={study.key}>
          <td colSpan={width} className="border-b border-border-warm/60 bg-card-surface/40 px-3 py-2.5 text-[13px] text-espresso">
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[110px_1fr]">
              {more.map((entry) => (
                <div key={entry.name} className="contents">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-secondary-dark">{entry.name}</dt>
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
 * The studies behind a bubble, one row each: the study, its design and participants, and what it was compared with and
 * found (or, for research, its finding). `treatmentShown`: the paper's own name of its treatment is under every study,
 * not only under those that name several. The table scrolls sideways inside its own box when the screen is narrow.
 */
export function StudyTable({ studies, kind, caption, treatmentShown = false }: { studies: Study[]; kind: StudyTableKind; caption: string; treatmentShown?: boolean }) {
  const heads = [C.study, C.design, ...(kind === "research" ? [C.finding] : [C.comparator, C.result])]
  return (
    <div data-table-scroll="true" className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {heads.map((head) => <th key={head} scope="col" className={TH}>{head}</th>)}
            <th scope="col" className={TH}><span className="sr-only">{C.details}</span></th>
          </tr>
        </thead>
        <tbody>
          {studies.map((study) => <Row key={study.key} study={study} kind={kind} named={treatmentShown || study.severalTreatments ? study.treatment : null} width={heads.length + 1} />)}
        </tbody>
      </table>
    </div>
  )
}
