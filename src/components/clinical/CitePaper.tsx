"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/Card"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { searchCitableRemote } from "@/lib/clinical/notes/client"
import type { CitablePaper } from "@/lib/clinical/notes/links"

const P = CLINICAL_COPY.notes.page
/** How long after the last key the papers are searched. */
export const CITE_DELAY_MS = 250
/** A search starts at this many characters. */
const MIN_QUERY = 2
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))

/**
 * The small dialog of "Cite a paper": a search over the papers that can be cited, the Library's first. It tells its
 * owner which paper was chosen and writes nothing itself. Escape and "Close" close it.
 */
export function CitePaper({ onChoose, onClose }: { onChoose: (paper: CitablePaper) => void; onClose: () => void }) {
  const [text, setText] = useState("")
  const [answer, setAnswer] = useState<{ q: string; papers: CitablePaper[] | null; error: string | null } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const q = text.trim()

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    if (q.length < MIN_QUERY) return
    let cancelled = false
    const timer = setTimeout(() => {
      searchCitableRemote(q)
        .then((papers) => { if (!cancelled) setAnswer({ q, papers, error: null }) })
        .catch((failure) => { if (!cancelled) setAnswer({ q, papers: null, error: messageOf(failure) }) })
    }, CITE_DELAY_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q])

  const current = answer?.q === q ? answer : null
  return (
    <Card role="dialog" aria-label={P.citePaper} data-cite-paper="true" className="mt-3 px-4 py-3" onKeyDown={(event) => { if (event.key === "Escape") onClose() }}>
      <div className="flex items-center gap-2">
        <input ref={input} type="search" aria-label={P.citeSearch} placeholder={P.citePlaceholder} autoComplete="off" value={text} onChange={(event) => setText(event.target.value)}
          className={`min-w-0 flex-1 rounded-pill border border-border-warm bg-light-surface px-3 py-1.5 text-[14px] text-espresso ${FOCUS}`} />
        <button type="button" onClick={onClose} className={`rounded-pill px-3 py-1.5 text-[13px] text-muted-text transition-colors hover:text-espresso ${FOCUS}`}>{P.close}</button>
      </div>
      {q.length >= MIN_QUERY && (
        <div className="mt-2 max-h-72 overflow-y-auto text-[14px]">
          {current === null ? <p className="px-1 py-1.5 text-muted-text">{P.citeSearching}</p>
            : current.error !== null ? <p role="alert" className="px-1 py-1.5 text-accent-ink">{current.error}</p>
            : (current.papers ?? []).length === 0 ? <p className="px-1 py-1.5 text-muted-text">{P.citeNone}</p>
            : (current.papers ?? []).map((paper) => (
              <button key={paper.slug} type="button" data-cite={paper.slug} onClick={() => onChoose(paper)}
                className={`block w-full rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-card-surface focus-visible:bg-card-surface ${FOCUS}`}>
                <span className="font-medium text-espresso">{paper.label}</span>
                {paper.saved && <span className="ml-2 rounded-pill bg-card-surface px-2 py-0.5 text-[12px] text-muted-text">{P.inLibrary}</span>}
                <span className="block text-[13px] leading-5 text-secondary-dark">{paper.title}</span>
                {(paper.venue || paper.year) && <span className="block text-[12px] text-muted-text">{[paper.venue, paper.year].filter(Boolean).join(", ")}</span>}
              </button>
            ))}
        </div>
      )}
    </Card>
  )
}
