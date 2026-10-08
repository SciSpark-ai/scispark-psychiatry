"use client"

import { useState } from "react"
import Link from "next/link"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { paperHref } from "@/lib/clinical/notes/href"
import type { NewPaper } from "@/lib/clinical/notes/links"

const P = CLINICAL_COPY.notes.page
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"

/**
 * The line that says how many papers were listed, since the note was last edited, on what it links, and that it does
 * not cite; "Show" opens them: each with what it found, its name as a link to its page, and "Cite" to put it in the note.
 */
export function NewPapersSince({ papers, since, onCite }: { papers: NewPaper[]; since: string; onCite: (paper: NewPaper) => void }) {
  const [open, setOpen] = useState(false)
  if (papers.length === 0) return null
  return (
    <div data-new-papers="true" className="mt-3">
      <p className="text-[13px] text-accent-ink">
        {P.newSince(papers.length, P.day(since))}
        <span aria-hidden="true" className="px-1.5 text-muted-text">—</span>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`font-medium underline underline-offset-2 ${FOCUS}`}>{open ? P.hide : P.show}</button>
      </p>
      {open && (
        <ul className="mt-2 space-y-2 rounded-card border border-border-warm bg-light-surface px-4 py-3">
          {papers.map((paper) => (
            <li key={paper.slug} data-new-paper={paper.slug} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[14px] leading-5 text-espresso">{paper.headline}</p>
                <Link href={paperHref(paper.slug)} className={`text-[13px] text-accent-ink hover:underline ${FOCUS}`}>{paper.label}</Link>
              </div>
              <button type="button" onClick={() => onCite(paper)}
                className={`shrink-0 rounded-pill border border-border-warm px-3 py-1 text-[13px] text-espresso transition-colors hover:bg-card-surface ${FOCUS}`}>{P.cite}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
