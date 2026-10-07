"use client"

import { useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { ResearchGroup } from "@/lib/clinical/evidence/build"
import { StudyTable } from "./StudyTable"

const E = CLINICAL_COPY.evidence

function Group({ group }: { group: ResearchGroup }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-research={group.type}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full items-baseline justify-between gap-4 border-b border-border-warm/60 px-2 py-3 text-left hover:bg-card-surface">
        <span className="text-[15px] font-semibold text-espresso">{E.researchTypes[group.type]}</span>
        <span className="flex items-baseline gap-3">
          {group.newPapers > 0 && <span data-new="true" className="text-[12px] font-semibold text-accent-ink">{E.newCount(group.newPapers)}</span>}
          <span data-papers="true" className="text-[14px] text-espresso">{group.papers}</span>
        </span>
      </button>
      {open && <div className="py-2"><StudyTable studies={group.studies} kind="research" /></div>}
    </div>
  )
}

/** The Other research tab: one disclosure per kind of research that names no treatment. */
export function ResearchList({ groups }: { groups: ResearchGroup[] }) {
  return <div>{groups.map((group) => <Group key={group.type} group={group} />)}</div>
}
