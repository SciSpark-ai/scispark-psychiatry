import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { ResearchGroup } from "@/lib/clinical/evidence/build"
import { StudyTable } from "./StudyTable"

const E = CLINICAL_COPY.evidence
/** The group of the papers that name a treatment and are not sorted by what they found: its table says which treatment. */
const NO_EFFICACY = "no-efficacy"
/** A group is a compact pill. It is not a flex box, so the spaces between its count, its name and what is new are kept. */
const PILL = "max-w-full rounded-pill border px-3 py-1.5 text-left text-[14px] leading-5 text-espresso transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
const PILL_OFF = `${PILL} border-border-warm bg-light-surface hover:bg-card-surface`
/** The chosen one has the light ground of a chosen bubble. */
const PILL_ON = `${PILL} border-orange/60 bg-orange/20`

/**
 * Other research: a row of pills that wraps, one per kind of research, each with its number of papers, its name and,
 * in small muted type, how many of them are new; and under the row the table of the chosen one, under a line with its
 * name and how many papers it has. Pressing the chosen pill again puts its table away.
 */
export function ResearchList({ groups, chosen, onChoose }: { groups: ResearchGroup[]; chosen: string | null; onChoose: (type: string | null) => void }) {
  const open = groups.find((group) => group.type === chosen) ?? null
  return (
    <>
      <div role="group" aria-label={E.rows.research} data-research-pills="true" className="flex flex-wrap gap-2">
        {groups.map((group) => (
          <button key={group.type} type="button" data-research-pill={group.type} aria-pressed={group.type === chosen} onClick={() => onChoose(group.type === chosen ? null : group.type)}
            className={group.type === chosen ? PILL_ON : PILL_OFF}>
            <span data-count="true" className="font-semibold tabular-nums">{group.papers}</span>{" "}
            <span data-name="true">{E.researchTypes[group.type]}</span>
            {group.newPapers > 0 && <>{" "}<span data-new="true" className="text-[12px] text-muted-text">{E.newCount(group.newPapers)}</span></>}
          </button>
        ))}
      </div>
      {open && <div className="pt-4"><StudyTable studies={open.studies} kind="research" caption={E.researchTypes[open.type]} treatmentShown={open.type === NO_EFFICACY} /></div>}
    </>
  )
}
