"use client"

import { useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { ClassEvidence, Counts, TreatmentEvidence } from "@/lib/clinical/evidence/build"
import { EvidenceBar } from "./EvidenceBar"
import { classNameOf } from "./evidence-labels"
import { StudyTable } from "./StudyTable"

const E = CLINICAL_COPY.evidence
const ROW = "grid w-full items-center gap-x-4 gap-y-1 border-b border-border-warm/60 px-2 py-3 text-left hover:bg-card-surface sm:grid-cols-[1.2fr_80px_1.6fr_70px]"

interface RowProps { name: string; papers: number; newPapers: number; counts: Counts; largest: number; open: boolean; onToggle: () => void }

/** The disclosure button of a class or a treatment: its name, its papers, a bar, and what is new. */
function RowButton({ name, papers, newPapers, counts, largest, open, onToggle }: RowProps) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className={ROW}>
      <span data-name="true" className="block text-[15px] font-semibold text-espresso">{name}</span>
      <span data-papers="true" className="block text-[14px] text-espresso">{E.papers(papers)}</span>
      <EvidenceBar counts={counts} papers={papers} largest={largest} />
      {newPapers > 0 ? <span data-new="true" className="block text-[12px] font-semibold text-accent-ink">{E.newCount(newPapers)}</span> : <span aria-hidden="true" />}
    </button>
  )
}

/**
 * A few words under a treatment's name. A treatment with one paper and one benefit text shows that
 * text alone; a single caution keeps its label, so it is never read as praise.
 */
function Lines({ treatment }: { treatment: TreatmentEvidence }) {
  const did = treatment.did.map((entry) => entry.text)
  const watch = treatment.watch.map((entry) => entry.text)
  const plain = treatment.papers === 1 && did.length === 1 && watch.length === 0
  return (
    <div className="px-2 pb-2 text-[13px] text-secondary-dark">
      {did.length > 0 && <p data-did="true">{plain ? did[0] : E.did(did)}</p>}
      {watch.length > 0 && <p data-watch="true">{E.watch(watch)}</p>}
    </div>
  )
}

function Treatment({ treatment, largest }: { treatment: TreatmentEvidence; largest: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-treatment={treatment.key}>
      <RowButton name={treatment.name} papers={treatment.papers} newPapers={treatment.newPapers} counts={treatment.counts} largest={largest} open={open} onToggle={() => setOpen(!open)} />
      <Lines treatment={treatment} />
      {open && <div className="pb-3"><StudyTable studies={treatment.studies} kind="treatment" /></div>}
    </div>
  )
}

/** A class with one treatment opens to that treatment's line and table, not to a row to open again. */
function Only({ treatment }: { treatment: TreatmentEvidence }) {
  return (
    <div data-treatment={treatment.key}>
      <p className="px-2 pt-2 text-[14px] font-semibold text-espresso">{treatment.name}</p>
      <Lines treatment={treatment} />
      <div className="pb-3"><StudyTable studies={treatment.studies} kind="treatment" /></div>
    </div>
  )
}

function ClassRow({ entry, largest }: { entry: ClassEvidence; largest: number }) {
  const [open, setOpen] = useState(false)
  const inside = Math.max(1, ...entry.treatments.map((treatment) => treatment.papers))
  return (
    <div data-class={entry.key}>
      <RowButton name={classNameOf(entry.key, entry.label)} papers={entry.papers} newPapers={entry.newPapers} counts={entry.counts} largest={largest} open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <div className="ml-4 border-l border-border-warm/60 pl-3">
          {entry.treatments.length === 1
            ? <Only treatment={entry.treatments[0]} />
            : entry.treatments.map((treatment) => <Treatment key={treatment.key} treatment={treatment} largest={inside} />)}
        </div>
      )}
    </div>
  )
}

/** The Treatments tab: one row per class, scaled against the largest class on the page. */
export function TreatmentList({ classes }: { classes: ClassEvidence[] }) {
  const largest = Math.max(1, ...classes.map((entry) => entry.papers))
  return <div>{classes.map((entry) => <ClassRow key={entry.key} entry={entry} largest={largest} />)}</div>
}
