"use client"

import { useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Design, DesignSource } from "@/lib/clinical/types"
import type { PaperRecord } from "@/lib/papers/types"
import { displayTitle } from "@/lib/papers/title"
import { displayVenue } from "@/lib/papers/venue"

const H = CLINICAL_COPY.paper.header
/** How many authors are named before the rest is folded away. */
const AUTHORS_SHOWN = 3

/**
 * The top of the paper page in the clinical edition: what kind of study it is and the topic it was
 * listed under, the AI headline with the paper's own title beneath, the authors, and the source on
 * a line of its own (journal, the two dates, links to the record).
 */
export function ClinicalPaperHeader({ paper, headline, design, designSource, topic }: {
  paper: PaperRecord; headline?: string; design?: Design; designSource?: DesignSource; topic?: string
}) {
  const [allAuthors, setAllAuthors] = useState(false)
  const names = paper.authors.map((author) => author.name)
  const folded = !allAuthors && names.length > AUTHORS_SHOWN + 1
  // A kind of study is shown only when someone has named it: PubMed, the model or a text rule.
  const named = design && designSource && designSource !== "none" && design !== "other" && design !== "unknown"
  const inferred = designSource === "model" || designSource === "text-rule"
  const published = paper.date?.slice(0, 10) ?? (paper.year ? String(paper.year) : undefined)
  const added = paper.addedDate?.slice(0, 10)
  const dates = [published ? H.published(published) : undefined, added && added !== published ? H.inPubmed(added) : undefined].filter(Boolean).join(H.separator)
  const venue = displayVenue(paper.venue)
  return (
    <header>
      {(named || topic) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {named && <span data-chip="design" title={inferred ? CLINICAL_COPY.designInferredNote : CLINICAL_COPY.designNote} className="rounded-pill bg-espresso px-3 py-1 text-[12px] font-semibold tracking-wide text-on-accent">{CLINICAL_COPY.designLabels[design]}</span>}
          {topic && <span data-chip="topic" className="rounded-pill border border-orange/50 bg-orange/10 px-3 py-1 text-[12px] font-semibold text-accent-ink">{topic}</span>}
        </div>
      )}
      <h1 className="max-w-[960px] font-heading text-[30px] leading-[1.2] tracking-heading text-espresso [overflow-wrap:anywhere] sm:text-[36px]">{headline ?? displayTitle(paper.title)}</h1>
      {headline && (
        <div className="mt-4 max-w-[960px] border-l-2 border-border-warm pl-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-text">{H.originalTitle}</p>
          <p data-original-title="true" className="mt-0.5 text-[17px] leading-snug text-secondary-dark [overflow-wrap:anywhere]">{displayTitle(paper.title)}</p>
        </div>
      )}
      <div className="mt-5 space-y-1.5 text-[14px]">
        {(venue || dates) && (
          <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            {venue && <span data-journal="true" className="font-semibold text-espresso">{venue}</span>}
            {dates && <span data-dates="true" className="text-secondary-dark">{dates}</span>}
          </p>
        )}
        {names.length > 0 && (
          <p data-authors="true" className="leading-relaxed text-secondary-dark">
            <span>{(folded ? names.slice(0, AUTHORS_SHOWN) : names).join(H.authorJoin)}</span>
            {folded && <button type="button" onClick={() => setAllAuthors(true)} className="text-accent-ink underline decoration-dotted hover:text-accent-ink-hover">{H.moreAuthors(names.length - AUTHORS_SHOWN)}</button>}
          </p>
        )}
        {(paper.ids.doi || paper.ids.pmid) && (
          <p data-ids="true" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {paper.ids.doi && <a href={`https://doi.org/${paper.ids.doi}`} target="_blank" rel="noreferrer" className="text-muted-text underline decoration-dotted hover:text-accent-ink">{H.doi(paper.ids.doi)}</a>}
            {paper.ids.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${paper.ids.pmid}/`} target="_blank" rel="noreferrer" className="text-muted-text underline decoration-dotted hover:text-accent-ink">{H.pmid(paper.ids.pmid)}</a>}
          </p>
        )}
      </div>
    </header>
  )
}
