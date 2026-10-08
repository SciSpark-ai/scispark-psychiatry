import type { TreatmentEvidence } from "@/lib/clinical/evidence/build"
import { NotesStrip } from "./NotesStrip"
import { ComparisonTable, StudyTable } from "./StudyTable"

/**
 * What is under a chosen treatment: the table of its papers, under one line with its name and how many they are; and,
 * when papers of another treatment used it as their comparison, a second small table of those. Its safety papers and
 * its papers that are not sorted by what they found are not here: they are under Safety and Other research, and
 * marked under its bubble. At the end of the line with its name: the reader's notes on it under this condition, and a
 * button that starts one.
 */
export function TreatmentDetail({ treatment, condition }: { treatment: TreatmentEvidence; condition: string }) {
  return (
    <div data-treatment-detail={treatment.key} className="space-y-5 pt-5">
      <StudyTable studies={treatment.studies} kind="treatment" caption={treatment.name} aside={<NotesStrip variant="line" about={{ condition, treatment: treatment.key }} />} />
      {treatment.comparedIn.length > 0 && <ComparisonTable studies={treatment.comparedIn} />}
    </div>
  )
}
