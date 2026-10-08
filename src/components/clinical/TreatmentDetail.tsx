import Link from "next/link"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { TreatmentEvidence } from "@/lib/clinical/evidence/build"
import { DirectionPlot } from "./DirectionPlot"
import { KIND_TEXT_COLOUR } from "./evidence-shapes"
import { StudyTable } from "./StudyTable"

const E = CLINICAL_COPY.evidence
const LINES = ["benefit", "no-benefit", "mixed", "safety"] as const

/**
 * What is under a chosen treatment: what its papers found in each paper's own few words, by direction; how many more
 * of its papers are not sorted by what they found; the papers of another treatment it was the comparison in; a dot per
 * paper; and the table of the papers. A paper it was the comparison in has no line, no dot and no row of this
 * treatment: its result is of the treatment it tested, and is written after that treatment's name.
 */
export function TreatmentDetail({ treatment }: { treatment: TreatmentEvidence }) {
  const lines = LINES.map((kind) => ({ kind, texts: treatment.lines[kind].map((entry) => entry.text) })).filter((line) => line.texts.length > 0)
  const compared = treatment.comparedIn.map((study) => ({
    key: study.key, href: `/paper/${study.slug}`, label: study.label ?? study.headline, kind: study.kind,
    result: E.comparedResult(study.treatment, study.text ?? study.takeaway),
  }))
  return (
    <div data-treatment-detail={treatment.key} className="pt-2">
      <div className="space-y-1 text-[13px] text-secondary-dark">
        {lines.map((line) => (
          <p key={line.kind} data-line={line.kind}>
            <span data-line-label="true" className="font-semibold" style={{ color: KIND_TEXT_COLOUR[line.kind] }}>{E.lineLabel(E.kindLabels[line.kind])}</span>{" "}
            <span>{E.lineText(line.texts)}</span>
          </p>
        ))}
        {treatment.unreportedPapers > 0 && <p data-unreported="true" className="text-muted-text">{E.unreported(treatment.unreportedPapers, treatment.name)}</p>}
      </div>
      {treatment.comparatorPapers > 0 && (
        <div data-compared-in="true" className="mt-2 text-[13px] text-secondary-dark">
          <p data-compared-count="true">{E.comparedIn(treatment.comparatorPapers)}</p>
          <ul className="mt-1 space-y-1 pl-4">
            {compared.map((entry) => (
              <li key={entry.key} data-compared={entry.key} className="list-disc">
                <Link href={entry.href} className="font-semibold text-espresso hover:text-accent-ink">{entry.label}</Link>{" "}
                <span data-compared-result="true">{entry.result}</span>
                {entry.kind && <span data-kind-label="true" className="ml-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: KIND_TEXT_COLOUR[entry.kind] }}>{E.kindLabels[entry.kind]}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <DirectionPlot studies={treatment.studies} name={treatment.name} />
      <div className="pt-3"><StudyTable studies={treatment.studies} kind="treatment" caption={treatment.name} /></div>
    </div>
  )
}
