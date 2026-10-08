"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { EmptyState } from "@/components/ui/EmptyState"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { createNoteRemote, listNotesRemote, type NoteListFilters } from "@/lib/clinical/notes/client"
import { libraryHref, noteHref, noteKindOf, type NotesAddress } from "@/lib/clinical/notes/href"
import { NOTE_KINDS, type NoteKind, type NoteSummary } from "@/lib/clinical/notes/links"
import { NoteRow } from "./NoteRow"

const L = CLINICAL_COPY.notes.list
/** How long after the last key the search is written to the address. */
export const SEARCH_DELAY_MS = 300
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
const FIELD = `rounded-pill border border-border-warm bg-light-surface px-3 py-1.5 text-[14px] text-espresso ${FOCUS}`
const PILL = `rounded-pill border border-border-warm px-3 py-1 text-[13px] text-secondary-dark transition-colors hover:bg-card-surface/60 ${FOCUS}`
const PILL_ON = `rounded-pill border border-orange bg-orange/10 px-3 py-1 text-[13px] font-semibold text-accent-ink ${FOCUS}`

/** What the route was asked, as one text: an answer belongs to the address it was asked for. */
const keyOf = (q: string, treatment: string) => JSON.stringify([q, treatment])
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))
const has = (note: NoteSummary, condition: string) => note.conditions.some((entry) => entry.code === condition)

/**
 * The Notes tab of the Library: a search, a condition, what a note is about, and the notes last edited first. The
 * search, the condition and the kind are kept in the address. The route is asked once for a search (and for a
 * treatment, when the address names one); the condition and the kind are applied here to what came back, so each
 * pill can say how many notes it would show and the select offers only conditions that would show a note.
 */
export function NotesTab() {
  const router = useRouter()
  const params = useSearchParams()
  const q = (params.get("q") ?? "").trim()
  const condition = params.get("condition") ?? ""
  const treatment = params.get("treatment") ?? ""
  const kind = noteKindOf(params.get("kind"))

  const [answer, setAnswer] = useState<{ key: string; notes: NoteSummary[] | null; error: string | null } | null>(null)
  // What is typed: the address follows it a moment after the last key, and it follows an address that changed elsewhere.
  const [typed, setTyped] = useState({ text: q, from: q })
  const [making, setMaking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (typed.from !== q) setTyped({ text: typed.text.trim() === q ? typed.text : q, from: q })

  useEffect(() => {
    let cancelled = false
    const key = keyOf(q, treatment)
    const filters: NoteListFilters = {}
    if (q) filters.q = q
    if (treatment) filters.treatment = treatment
    listNotesRemote(filters)
      .then((notes) => { if (!cancelled) setAnswer({ key, notes, error: null }) })
      .catch((reason) => { if (!cancelled) setAnswer({ key, notes: null, error: messageOf(reason) }) })
    return () => { cancelled = true }
  }, [q, treatment])

  const wait = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null }
  useEffect(() => wait, [])

  /** Another address of this tab. What is typed goes with it, so a filter chosen while the search waits does not lose it. */
  const go = (next: NotesAddress, text = typed.text) => {
    wait()
    router.replace(libraryHref("notes", { q: text, condition: condition || undefined, treatment: treatment || undefined, kind, ...next }))
  }
  const search = (text: string) => {
    setTyped({ text, from: q })
    wait()
    timer.current = setTimeout(() => go({}, text), SEARCH_DELAY_MS)
  }
  const clear = () => {
    wait()
    setTyped({ text: "", from: q })
    router.replace(libraryHref("notes"))
  }
  const create = async () => {
    setMaking(true)
    setFailure(null)
    try {
      router.push(noteHref(await createNoteRemote()))
    } catch (reason) {
      setFailure(messageOf(reason))
      setMaking(false)
    }
  }

  const current = answer?.key === keyOf(q, treatment) ? answer : null
  const notes = current?.notes ?? null
  const all = notes ?? []
  const ofCondition = condition ? all.filter((note) => has(note, condition)) : all
  const ofKind = kind ? all.filter((note) => note.kind === kind) : all
  const shown = kind ? ofCondition.filter((note) => note.kind === kind) : ofCondition
  const filtered = q !== "" || condition !== "" || treatment !== "" || kind !== undefined

  // The conditions of the notes the search and the kind leave, by name; the chosen one stays even when none of them has it.
  const names = new Map<string, string>()
  for (const note of ofKind) for (const entry of note.conditions) names.set(entry.code, entry.name)
  if (condition && !names.has(condition)) names.set(condition, all.flatMap((note) => note.conditions).find((entry) => entry.code === condition)?.name ?? condition)
  const options = [...names].sort((a, b) => a[1].localeCompare(b[1]))
  const pills: Array<{ kind: NoteKind | undefined; label: string; count: number }> = [
    { kind: undefined, label: L.kinds.all, count: ofCondition.length },
    ...NOTE_KINDS.map((entry) => ({ kind: entry, label: L.kinds[entry], count: ofCondition.filter((note) => note.kind === entry).length })),
  ]

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" aria-label={L.searchLabel} placeholder={L.searchPlaceholder} autoComplete="off" value={typed.text}
          onChange={(event) => search(event.target.value)} className={`min-w-0 max-w-md flex-1 ${FIELD}`} />
        <select aria-label={L.conditionLabel} value={condition} onChange={(event) => go({ condition: event.target.value || undefined })} className={FIELD}>
          <option value="">{L.allConditions}</option>
          {options.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <Button onClick={() => void create()} disabled={making} className="ml-auto">{L.newNote}</Button>
      </div>
      <div role="group" aria-label={L.kindLabel} className="mt-3 flex flex-wrap gap-1.5">
        {pills.map((pill) => (
          <button key={pill.kind ?? ""} type="button" aria-pressed={pill.kind === kind} onClick={() => go({ kind: pill.kind })} className={pill.kind === kind ? PILL_ON : PILL}>
            {pill.label} <span className="font-normal opacity-70">{pill.count}</span>
          </button>
        ))}
      </div>
      {failure && <p role="alert" className="mt-3 text-[14px] text-accent-ink">{failure}</p>}
      <div className="mt-4">
        {current === null ? <p className="text-[14px] text-muted-text">{L.loading}</p>
          : current.error !== null ? <p role="alert" className="text-[14px] text-accent-ink">{current.error}</p>
          : shown.length > 0 ? <ul className="space-y-2">{shown.map((note) => <NoteRow key={note.id} note={note} />)}</ul>
          : filtered ? <EmptyState title={L.noMatch} action={<Button variant="secondary" onClick={clear}>{L.clear}</Button>} />
          : <EmptyState title={L.none} hint={L.noneHint} />}
      </div>
    </section>
  )
}
