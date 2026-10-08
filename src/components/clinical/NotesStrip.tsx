"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { createNoteRemote, listNotesRemote, type NoteListFilters } from "@/lib/clinical/notes/client"
import { noteHref, notesHref } from "@/lib/clinical/notes/href"
import type { NoteAbout, NoteSummary } from "@/lib/clinical/notes/links"
import { NoteRow } from "./NoteRow"

const S = CLINICAL_COPY.notes.strip
/** The id of the section on the paper page, which its "On this page" list jumps to. */
export const PAPER_NOTES_ID = "paper-notes"
const ALERT = "text-[13px] text-accent-ink"
const COUNT = "text-[14px] text-accent-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"

/** What the notes are on: a paper by its slug, a condition by its code, or a treatment by its key under a condition. */
export type StripAbout = { paper: string } | { condition: string; treatment?: string }

/** The notes the route is asked for. A treatment goes with its condition, so the route counts the condition's subtypes too. */
function filtersOf(about: StripAbout): NoteListFilters {
  if ("paper" in about) return { paper: about.paper }
  return about.treatment ? { condition: about.condition, treatment: about.treatment } : { condition: about.condition }
}
/** What a note started here is about. */
function aboutOf(about: StripAbout): NoteAbout {
  if ("paper" in about) return { paper: about.paper }
  return about.treatment ? { treatment: { condition: about.condition, key: about.treatment } } : { condition: about.condition }
}
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))

/**
 * The reader's notes on what they are reading, and a button that starts one. As a `section` (a paper's page): a
 * heading and the notes, each opening its note; with no note, the button alone. As a `line` (a condition of the
 * Evidence view, an opened treatment): how many there are, as a link to the Notes page filtered to them, and
 * the button; with no note, the button alone. `name` is the condition's name, for its line. A note started here is
 * made on the server with its link to the paper, condition or treatment already in it, and is then opened.
 */
export function NotesStrip({ about, variant, name }: { about: StripAbout; variant: "section" | "line"; name?: string }) {
  const router = useRouter()
  const key = JSON.stringify(filtersOf(about))
  const [answer, setAnswer] = useState<{ key: string; notes: NoteSummary[]; error: string | null } | null>(null)
  const [making, setMaking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listNotesRemote(JSON.parse(key) as NoteListFilters)
      .then((notes) => { if (!cancelled) setAnswer({ key, notes, error: null }) })
      .catch((reason) => { if (!cancelled) setAnswer({ key, notes: [], error: messageOf(reason) }) })
    return () => { cancelled = true }
  }, [key])

  const write = async () => {
    if (making) return
    setMaking(true)
    setFailure(null)
    try {
      router.push(noteHref(await createNoteRemote({ about: aboutOf(about) })))
    } catch (reason) {
      setFailure(messageOf(reason))
      setMaking(false)
    }
  }

  // An answer belongs to what it was asked for: the notes of another paper or treatment are not shown while the next are read.
  const current = answer?.key === key ? answer : null
  const notes = current?.notes ?? []
  const problem = failure ?? current?.error ?? null
  const button = <Button variant="secondary" size="sm" onClick={() => void write()} disabled={making}>{S.write}</Button>

  if (variant === "section") {
    return (
      <section id={PAPER_NOTES_ID} data-notes-strip="section" aria-label={S.heading} tabIndex={-1} className="mb-10 scroll-mt-6">
        {notes.length > 0 && (
          <>
            <h2 className="mb-3 font-heading text-[20px] font-semibold text-espresso">{S.heading}</h2>
            <ul className="mb-3 space-y-2">{notes.map((note) => <NoteRow key={note.id} note={note} />)}</ul>
          </>
        )}
        {button}
        {problem && <p role="alert" className={`mt-2 ${ALERT}`}>{problem}</p>}
      </section>
    )
  }
  const condition = "condition" in about ? about.condition : undefined
  const treatment = "condition" in about ? about.treatment : undefined
  return (
    <div data-notes-strip="line" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {notes.length > 0 && (
        <Link href={notesHref({ condition, treatment })} className={COUNT}>
          {treatment || name === undefined ? S.count(notes.length) : S.onCondition(name, notes.length)}
        </Link>
      )}
      {button}
      {problem && <span role="alert" className={ALERT}>{problem}</span>}
    </div>
  )
}
