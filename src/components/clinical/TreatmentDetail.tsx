import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { TreatmentEvidence } from "@/lib/clinical/evidence/build"
import { DirectionPlot } from "./DirectionPlot"
import { KIND_TEXT_COLOUR } from "./evidence-shapes"
import { StudyTable } from "./StudyTable"

const E = CLINICAL_COPY.evidence
const LINES = ["benefit", "no-benefit", "mixed", "safety"] as const

/**
 * What is under a chosen treatment: what its papers found in each paper's own few words, by direction; how many more
 * of its papers report no efficacy result; a dot per paper; and the table of the papers.
 */
export function TreatmentDetail({ treatment }: { treatment: TreatmentEvidence }) {
  const lines = LINES.map((kind) => ({ kind, texts: treatment.lines[kind].map((entry) => entry.text) })).filter((line) => line.texts.length > 0)
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
      <DirectionPlot studies={treatment.studies} name={treatment.name} />
      <div className="pt-3"><StudyTable studies={treatment.studies} kind="treatment" caption={treatment.name} /></div>
    </div>
  )
}
