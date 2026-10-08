import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { ResearchGroup } from "@/lib/clinical/evidence/build"
import { BubbleRow } from "./BubbleRow"
import { EvidenceBubble } from "./EvidenceBubble"
import { StudyTable } from "./StudyTable"

const E = CLINICAL_COPY.evidence
/** The group of the papers that name a treatment and report no efficacy result: its table says which treatment. */
const NO_EFFICACY = "no-efficacy"

/** Other research: a light bubble per kind of research, and under the row the table of the chosen one. */
export function ResearchList({ groups, chosen, onChoose }: { groups: ResearchGroup[]; chosen: string | null; onChoose: (type: string | null) => void }) {
  const open = groups.find((group) => group.type === chosen) ?? null
  return (
    <>
      <BubbleRow label={E.rows.research}>
        {groups.map((group) => (
          <EvidenceBubble key={group.type} id={group.type} name={E.researchTypes[group.type]} papers={group.papers} newPapers={group.newPapers}
            pressed={group.type === chosen} onPick={() => onChoose(group.type === chosen ? null : group.type)} />
        ))}
      </BubbleRow>
      {open && <div className="pt-1"><StudyTable studies={open.studies} kind="research" caption={E.researchTypes[open.type]} treatmentShown={open.type === NO_EFFICACY} /></div>}
    </>
  )
}
