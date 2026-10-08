"use client"

import { useEffect, useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { createConditionPageRemote } from "@/lib/clinical/records/client"
import { notesOf, replaceNotes } from "@/lib/clinical/records/notes"
import { getOpenVault } from "@/lib/vault/get-vault"

const N = CLINICAL_COPY.evidence.notes
const P = CLINICAL_COPY.records.conditionPage
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))
const pathOf = (pageId: string) => `${pageId}.md`

type Loading = { state: "loading" } | { state: "failed"; message: string } | { state: "ready" }
type Outcome = { kind: "saved" } | { kind: "error"; message: string } | null

/**
 * The reader's notes on one condition: the notes section of the condition's wiki page, written in place.
 * The page is read and written the way the wiki's own editor does it, through the vault; it is made on the
 * first save when the condition has none. A save reads the page again and changes only its notes section.
 * Notes that are not the ones that were opened are never written over unseen: they are shown first.
 * Mount it with the condition as its key. It is taken down when the reader looks at something else, so the
 * text that is not saved yet is the caller's to keep: `onDraft` gets it at every change (null once it is what
 * is stored) and `draft` gives it back; `onPage` says where the page is when a save made it.
 */
export function ConditionNotes({ code, pageId: initialPageId, draft, onDraft, onPage }: {
  code: string; pageId: string | null; draft?: string
  onDraft?: (code: string, text: string | null) => void; onPage?: (code: string, pageId: string) => void
}) {
  const [pageId, setPageId] = useState(initialPageId)
  const [loading, setLoading] = useState<Loading>(initialPageId === null ? { state: "ready" } : { state: "loading" })
  // The notes as they were when opened or last saved, and what the reader has in the text area.
  const [opened, setOpened] = useState("")
  const [text, setText] = useState(draft ?? "")
  // Whether it was opened with text the reader had not saved: the stored notes do not replace that.
  const [resumed] = useState(draft !== undefined)
  const [stored, setStored] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)

  useEffect(() => {
    if (initialPageId === null) return
    let cancelled = false
    getOpenVault().then((vault) => vault.read(pathOf(initialPageId)))
      .then((raw) => {
        if (cancelled) return
        const notes = raw === null ? "" : notesOf(raw)
        setOpened(notes)
        if (!resumed) setText(notes)
        setLoading({ state: "ready" })
      })
      .catch((failure) => { if (!cancelled) setLoading({ state: "failed", message: messageOf(failure) }) })
    return () => { cancelled = true }
  }, [initialPageId, resumed])

  const save = async () => {
    setSaving(true)
    setOutcome(null)
    try {
      const vault = await getOpenVault()
      let id = pageId
      let raw = id === null ? null : await vault.read(pathOf(id))
      if (id === null || raw === null) {
        id = (await createConditionPageRemote(code)).id
        raw = await vault.read(pathOf(id))
        setPageId(id)
        onPage?.(code, id)
      }
      if (raw === null) throw new Error(N.missing)
      const current = notesOf(raw)
      if (current !== opened) {
        // Written somewhere else since, or on a page this view did not know of. Nothing is saved until the reader has seen it.
        setOpened(current)
        setStored(current)
        setOutcome({ kind: "error", message: N.conflict })
        return
      }
      const next = replaceNotes(raw, text)
      await vault.write(pathOf(id), next)
      setOpened(notesOf(next))
      setStored(null)
      setOutcome({ kind: "saved" })
      onDraft?.(code, null)
    } catch (failure) {
      setOutcome({ kind: "error", message: messageOf(failure) })
    } finally {
      setSaving(false)
    }
  }

  if (loading.state === "loading") return <p className="my-4 text-[13px] text-muted-text">{N.loading}</p>
  // No text area without the notes: an empty one, saved, would wipe them.
  if (loading.state === "failed") return <p role="alert" className="my-4 text-[13px] text-accent-ink">{loading.message}</p>
  const changed = text.trim() !== opened || stored !== null
  const edit = (value: string) => {
    setText(value)
    setOutcome((before) => (before?.kind === "saved" ? null : before))
    onDraft?.(code, value.trim() !== opened ? value : null)
  }
  return (
    <div className="my-4">
      <textarea aria-label={P.notes} placeholder={P.notesHint} value={text} rows={14}
        onChange={(event) => edit(event.target.value)}
        className="block w-full rounded-card border border-border-warm bg-light-surface px-4 py-3 text-[14px] leading-relaxed text-espresso placeholder:text-muted-text" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving || !changed}
          className="rounded-pill bg-orange px-4 py-1.5 text-[13px] font-medium text-on-accent transition-colors hover:bg-orange/90 disabled:opacity-50">
          {saving ? N.saving : N.save}
        </button>
        {outcome?.kind === "saved" && <span role="status" className="text-[13px] text-accent-ink">{N.saved}</span>}
        {outcome?.kind === "error" && <span role="alert" className="text-[13px] text-accent-ink">{outcome.message}</span>}
      </div>
      {stored !== null && (
        <div className="mt-4 rounded-card border border-border-warm/70 bg-card-surface/60 px-4 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-text">{N.stored}</p>
          <pre data-stored-notes="true" className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-espresso">{stored}</pre>
        </div>
      )}
    </div>
  )
}
