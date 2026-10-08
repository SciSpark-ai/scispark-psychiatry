import type { ReactNode } from "react"
import Link from "next/link"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Study } from "@/lib/clinical/evidence/build"
import { KIND_TEXT_COLOUR } from "./EvidenceBar"

const E = CLINICAL_COPY.evidence
const C = E.columns

/** What the table is for: a treatment's studies, the safety studies (with the treatment first), or research that names no treatment. */
export type StudyTableKind = "treatment" | "safety" | "research"

const TH = "border-b border-border-warm px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-secondary-dark"
const TD = "border-b border-border-warm/60 px-3 py-2.5 align-top text-[13px] text-espresso"

function Cell({ name, children }: { name: string; children: ReactNode }) {
  return <td data-cell={name} className={TD}>{children}</td>
}

/** `named`: what the paper itself named, shown when the row sits under one of several treatments it names. */
function StudyCell({ study, named }: { study: Study; named: string | null }) {
  return (
    <Cell name="study">
      <Link href={`/paper/${study.slug}`} className="font-semibold hover:text-accent-ink">{study.label ?? study.headline}</Link>
      {named && <span data-named="true" className="block text-[12px] text-muted-text">{named}</span>}
      {study.venue && <span className="block text-[12px] text-muted-text">{study.venue}</span>}
      {study.isNew && <span className="mr-1.5 text-[11px] font-bold uppercase tracking-wide text-accent-ink">{E.studyMarks.new}</span>}
      {study.saved && <span className="rounded-pill border border-border-warm px-2 py-0.5 text-[11px] text-secondary-dark">{E.studyMarks.saved}</span>}
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

/** The characteristics of studies, one row each. It scrolls sideways when the screen is narrow. */
export function StudyTable({ studies, kind }: { studies: Study[]; kind: StudyTableKind }) {
  const heads = [
    ...(kind === "safety" ? [C.treatment] : []), C.study, C.design, C.population, C.size,
    ...(kind === "research" ? [C.finding] : [C.comparator, C.outcome, C.result]),
  ]
  return (
    <div data-table-scroll="true" className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead><tr>{heads.map((head) => <th key={head} scope="col" title={head === C.size ? E.sizeTitle : undefined} className={TH}>{head}</th>)}</tr></thead>
        <tbody>
          {studies.map((study) => (
            <tr key={study.key} data-study={study.key}>
              {kind === "safety" && <Cell name="treatment">{study.treatment ?? E.noTreatment}</Cell>}
              <StudyCell study={study} named={kind === "treatment" && study.severalTreatments ? study.treatment : null} />
              <Cell name="design">{study.designNamed ? CLINICAL_COPY.designLabels[study.design] : ""}</Cell>
              <Cell name="population">{study.population ?? ""}</Cell>
              <Cell name="size">{study.sampleSize === null ? E.dash : String(study.sampleSize)}</Cell>
              {kind === "research" ? <Cell name="finding">{study.takeaway}</Cell> : (
                <>
                  <Cell name="comparator">{study.comparator ?? ""}</Cell>
                  <Cell name="outcome">{study.outcome ?? ""}</Cell>
                  <ResultCell study={study} />
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
