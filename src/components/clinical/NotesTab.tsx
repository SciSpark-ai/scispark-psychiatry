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

const CHIP = "inline-flex items-center gap-1.5 rounded-pill border border-orange bg-orange/10 py-1 pl-3 pr-2 text-[13px] text-accent-ink"
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))
/** What the route is asked, the filters that are set only. As one text it is also what an answer belongs to. */
function asked(q: string, condition: string, treatment: string): string {
  const filters: NoteListFilters = {}
  if (q) filters.q = q
  if (condition) filters.condition = condition
  if (treatment) filters.treatment = treatment
  return JSON.stringify(filters)
}

interface Answer { key: string; notes: NoteSummary[] | null; error: string | null }
/** The notes the route gives for one set of filters (`key`, from `asked`); null while they are read, and for no key. */
function useNotes(key: string | null): Answer | null {
  const [answer, setAnswer] = useState<Answer | null>(null)
  useEffect(() => {
    if (key === null) return
    let cancelled = false
    listNotesRemote(JSON.parse(key) as NoteListFilters)
      .then((notes) => { if (!cancelled) setAnswer({ key, notes, error: null }) })
      .catch((reason) => { if (!cancelled) setAnswer({ key, notes: null, error: messageOf(reason) }) })
    return () => { cancelled = true }
  }, [key])
  return answer?.key === key ? answer : null
}

/**
 * The Notes tab of the Library: a search, a condition, what a note is about, and the notes last edited first. The
 * search, the condition, the kind and a treatment (which the Evidence view's links name; shown as a chip that can be
 * removed) are kept in the address. The search, the condition and the treatment are the route's to apply: a condition
 * counts with its subtypes, and a treatment with a condition means that treatment under it or under its subtypes.
 * The kind is applied here to what came back, so each pill can say how many notes it would show. With a condition
 * chosen the route is asked a second time without it, so the select keeps offering the other conditions.
 */
export function NotesTab() {
  const router = useRouter()
  const params = useSearchParams()
  const q = (params.get("q") ?? "").trim()
  const condition = params.get("condition") ?? ""
  const treatment = params.get("treatment") ?? ""
  const kind = noteKindOf(params.get("kind"))

  // What is typed: the address follows it a moment after the last key, and it follows an address that changed elsewhere.
  const [typed, setTyped] = useState({ text: q, from: q })
  const [making, setMaking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (typed.from !== q) setTyped({ text: typed.text.trim() === q ? typed.text : q, from: q })

  // Without a condition the two are one list, asked for once.
  const wide = useNotes(asked(q, "", treatment))
  const narrow = useNotes(condition ? asked(q, condition, treatment) : null)

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

  const current = condition ? narrow : wide
  const all = wide?.notes ?? []
  const ofCondition = current?.notes ?? []
  const ofKind = kind ? all.filter((note) => note.kind === kind) : all
  const shown = kind ? ofCondition.filter((note) => note.kind === kind) : ofCondition
  const filtered = q !== "" || condition !== "" || treatment !== "" || kind !== undefined

  // The conditions of the notes the search and the kind leave, by name; the chosen one stays even when none of them
  // has exactly it (a condition whose notes are all on its subtypes, or an address of another day), by its code then.
  const names = new Map<string, string>()
  for (const note of ofKind) for (const entry of note.conditions) names.set(entry.code, entry.name)
  if (condition && !names.has(condition)) names.set(condition, all.flatMap((note) => note.conditions).find((entry) => entry.code === condition)?.name ?? condition)
  // The treatment by the name a note gives it; by its key when no note that came back links it.
  const treatmentName = [...ofCondition, ...all].flatMap((note) => note.treatments).find((entry) => entry.key === treatment)?.name ?? treatment
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
      {treatment && (
        <p className="mt-3">
          <span data-filter="treatment" className={CHIP}>
            {L.treatment(treatmentName)}
            <button type="button" aria-label={L.removeTreatment} onClick={() => go({ treatment: undefined })} className={`rounded-pill px-1 leading-4 hover:bg-orange/20 ${FOCUS}`}>
              <span aria-hidden="true">{L.removeMark}</span>
            </button>
          </span>
        </p>
      )}
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
