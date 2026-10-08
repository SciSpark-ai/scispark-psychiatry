"use client"

import Link from "next/link"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { noteHref } from "@/lib/clinical/notes/href"
import type { NoteSummary } from "@/lib/clinical/notes/links"

const L = CLINICAL_COPY.notes.list
const CHIP = "rounded-pill border border-border-warm px-2.5 py-0.5 text-[12px] leading-4 text-secondary-dark"
const CHIP_NEW = "rounded-pill bg-orange/10 px-2.5 py-0.5 text-[12px] font-medium leading-4 text-accent-ink"
const CHIP_PROJECT = "rounded-pill bg-card-surface px-2.5 py-0.5 text-[12px] leading-4 text-muted-text"

/**
 * One note of the Notes list: its title and the day it was edited, the start of its text, and as chips what it is
 * about (its conditions, its treatments, how many papers it cites), how many papers were listed since it was edited,
 * and whether it belongs to a project. The whole row opens the note.
 */
export function NoteRow({ note }: { note: NoteSummary }) {
  // A treatment linked under two conditions is named once.
  const treatments = note.treatments.filter((entry, index, all) => all.findIndex((other) => other.key === entry.key) === index)
  const chips = note.conditions.length + treatments.length + note.papers.length + note.newSince + Number(note.project) > 0
  return (
    <li data-note={note.id}>
      <Link href={noteHref(note.id)} className="block rounded-card border border-border-warm bg-light-surface px-4 py-3 transition-colors hover:bg-card-surface/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="min-w-0 truncate text-[15px] font-semibold leading-5 text-espresso">{note.title}</h3>
          <span className="shrink-0 text-[12px] text-muted-text">{L.edited(note.updated)}</span>
        </div>
        {note.excerpt && <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-secondary-dark">{note.excerpt}</p>}
        {chips && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {note.conditions.map((entry) => <span key={entry.code} data-chip="condition" className={CHIP}>{entry.name}</span>)}
            {treatments.map((entry) => <span key={entry.key} data-chip="treatment" className={CHIP}>{entry.name}</span>)}
            {note.papers.length > 0 && <span data-chip="papers" className={CHIP}>{L.papers(note.papers.length)}</span>}
            {note.newSince > 0 && <span data-chip="new" className={CHIP_NEW}>{L.newSince(note.newSince)}</span>}
            {note.project && <span data-chip="project" className={CHIP_PROJECT}>{L.project}</span>}
          </div>
        )}
      </Link>
    </li>
  )
}
