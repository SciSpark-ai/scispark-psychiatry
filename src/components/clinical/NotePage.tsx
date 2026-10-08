"use client"

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { evidenceHref } from "@/lib/clinical/evidence/href"
import { readNoteRemote, saveNoteRemote, type NoteAnswer } from "@/lib/clinical/notes/client"
import { libraryHref, noteChatHref, paperHref } from "@/lib/clinical/notes/href"
import { copyText, endOfText, insertLink } from "@/lib/clinical/notes/insert"
import { conditionLink, noteLinks, paperLink, titleOf, treatmentLink, type NoteConflict, type NoteReference } from "@/lib/clinical/notes/links"
import { CitePaper } from "./CitePaper"
import { LinkTopic, type Topic } from "./LinkTopic"
import { NewPapersSince } from "./NewPapersSince"

const N = CLINICAL_COPY.notes
const P = N.page
/** How long after the last change a note saves itself. */
export const SAVE_DELAY_MS = 800
/** The longest title the field takes. */
const TITLE_MAX = 200
const LINKS_ID = "note-links"
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
const CHIP = `rounded-pill border border-border-warm px-2.5 py-0.5 text-[12px] leading-4 text-secondary-dark transition-colors hover:bg-card-surface/60 ${FOCUS}`
const ACTION = `rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso transition-colors hover:bg-card-surface ${FOCUS}`
const TEXT_LINK = `text-accent-ink hover:underline ${FOCUS}`

const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))
/** What a note links, as one text: two texts with the same links give the same chips, references and new papers. */
const linkKey = (body: string) => JSON.stringify(noteLinks(body))

/** What the page holds outside of what is drawn: the text as typed, what the server has, and the save that is under way. */
interface Work {
  title: string
  body: string
  /** What was loaded or last saved, and the revision the next save must name. */
  saved: { title: string; body: string; revision: string }
  ready: boolean
  /** A conflict waits for the reader: nothing is saved until it is answered. */
  blocked: boolean
  /** The page was left: what is still unsaved is sent so that it outlives the page. */
  gone: boolean
  saving: Promise<void> | null
  timer: ReturnType<typeof setTimeout> | null
  /** The links of the text the chips, references and new papers were read for. */
  links: string
  references: NoteReference[]
  /** Papers cited here that were not in the Library: the next save puts them there. */
  awaiting: string[]
}
const dirty = (work: Work) => work.ready && (work.title !== work.saved.title || work.body !== work.saved.body)

export interface NotePageProps {
  /** The note's id, as the notes route knows it. */
  id: string
  /** True when the stored title reads as no title: the field then stays empty and shows the first line as a hint. */
  untitled: boolean
  /** "Delete" was pressed: the owner asks and deletes. */
  onDelete: () => void
  /** What the owner shows while it asks. */
  confirm?: ReactNode
}

/**
 * The page of one note: its title, what it is about, its text in one field that grows, and what can be done with it.
 * It saves itself a moment after the last change and when a field is left, one save at a time, each naming the
 * revision the one before gave; a note changed elsewhere is shown beside the reader's text and nothing is overwritten
 * until the reader says which to keep. Opening a note writes nothing.
 */
export function NotePage({ id, untitled, onDelete, confirm }: NotePageProps) {
  const router = useRouter()
  const [view, setView] = useState<NoteAnswer | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [unsaved, setUnsaved] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [conflict, setConflict] = useState<NoteConflict | null>(null)
  const [unresolved, setUnresolved] = useState<string[]>([])
  const [panel, setPanel] = useState<"cite" | "link" | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** The names of what was linked on this visit, until the server names them. */
  const [named, setNamed] = useState<Record<string, string>>({})
  const work = useRef<Work>({
    title: "", body: "", saved: { title: "", body: "", revision: "" }, ready: false, blocked: false, gone: false, saving: null, timer: null, links: "", references: [], awaiting: [],
  })
  const area = useRef<HTMLTextAreaElement>(null)
  const touched = useRef(false)
  const place = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const w = work.current
    readNoteRemote(id)
      .then((answer) => {
        if (cancelled) return
        if (answer && !w.ready) {
          const stored = { title: untitled ? "" : answer.summary.title, body: answer.body }
          Object.assign(w, stored, { saved: { ...stored, revision: answer.revision }, ready: true, links: linkKey(answer.body), references: answer.references })
          setTitle(stored.title)
          setBody(stored.body)
        }
        setView(answer)
      })
      .catch((reason) => { if (!cancelled) setLoadError(messageOf(reason)) })
    return () => { cancelled = true }
  }, [id, untitled])

  /** The chips, the references and the new papers, read again: they follow the links of the text. */
  const refresh = useCallback(async () => {
    const w = work.current
    try {
      const fresh = await readNoteRemote(id)
      if (!fresh || w.gone) return
      w.links = linkKey(fresh.body)
      w.references = fresh.references
      setView(fresh)
    } catch {
      // What is shown stays as it was; the next save that changes a link asks again.
    }
  }, [id])

  /** Saves what is unsaved, one save at a time, until nothing is: a change made during a save is saved after it. */
  const save = useCallback((): Promise<void> => {
    const w = work.current
    if (w.saving) return w.saving
    if (w.timer !== null) clearTimeout(w.timer)
    w.timer = null
    if (w.blocked || !dirty(w)) return Promise.resolve()
    const turn = async () => {
      while (dirty(w) && !w.blocked) {
        const sent = { title: w.title, body: w.body }
        let result: Awaited<ReturnType<typeof saveNoteRemote>>
        try {
          result = await saveNoteRemote({ id, ...sent, revision: w.saved.revision }, undefined, w.gone ? { keepalive: true } : {})
        } catch (reason) {
          setFailure(messageOf(reason))
          return
        }
        if ("conflict" in result) {
          w.blocked = true
          setConflict(result)
          return
        }
        const { revision, unresolved: lost } = result
        w.saved = { ...sent, revision }
        setFailure(null)
        setUnresolved(lost)
        const cited = noteLinks(sent.body).papers
        const done = w.awaiting.filter((slug) => cited.includes(slug))
        w.awaiting = w.awaiting.filter((slug) => !done.includes(slug))
        if (done.some((slug) => !lost.includes(slug))) setNotice(P.savedToLibrary)
      }
      if (!w.gone && w.links !== linkKey(w.saved.body)) await refresh()
    }
    w.saving = turn().finally(() => {
      w.saving = null
      setUnsaved(dirty(w))
    })
    return w.saving
  }, [id, refresh])

  // Leaving the page with unsaved text sends it once more, in a request that outlives the page.
  useEffect(() => {
    const w = work.current
    w.gone = false
    return () => {
      w.gone = true
      void save()
    }
  }, [save])

  // While something is unsaved the browser asks before it closes or reloads the page.
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [unsaved])

  // The field is as tall as its text. A document that lays nothing out (a test) measures nothing and is left alone.
  useEffect(() => {
    const fit = () => {
      const field = area.current
      if (!field) return
      field.style.height = "auto"
      if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight}px`
    }
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [body, view, conflict])

  // After a link was put in, the caret is behind it.
  useEffect(() => {
    const field = area.current
    if (place.current === null || !field) return
    field.focus()
    field.setSelectionRange(place.current, place.current)
    place.current = null
  }, [body])

  const change = (next: { title?: string; body?: string }) => {
    const w = work.current
    if (next.title !== undefined) { w.title = next.title; setTitle(next.title) }
    if (next.body !== undefined) { w.body = next.body; setBody(next.body) }
    if (w.timer !== null) clearTimeout(w.timer)
    w.timer = null
    setNotice(null)
    setUnsaved(dirty(w) || w.saving !== null)
    if (dirty(w)) w.timer = setTimeout(() => { w.timer = null; void save() }, SAVE_DELAY_MS)
  }

  /** Puts a link where the caret is, or after the last text when the reader has not been in the field. */
  const insert = (link: string) => {
    const w = work.current
    const field = area.current
    const start = touched.current && field ? field.selectionStart : endOfText(w.body)
    const end = touched.current && field ? field.selectionEnd : start
    const next = insertLink(w.body, link, start, end)
    touched.current = true
    place.current = next.caret
    change({ body: next.text })
  }
  const cite = (paper: { slug: string; label: string; saved?: boolean }) => {
    if (paper.saved === false && !work.current.awaiting.includes(paper.slug)) work.current.awaiting.push(paper.slug)
    setNamed((names) => ({ ...names, [`paper:${paper.slug}`]: paper.label }))
    setPanel(null)
    insert(paperLink(paper.slug, paper.label))
  }
  const link = (topic: Topic) => {
    setNamed((names) => ({ ...names, [topic.kind === "condition" ? `condition:${topic.code}` : `treatment:${topic.condition}/${topic.key}`]: topic.name }))
    setPanel(null)
    insert(topic.kind === "condition" ? conditionLink(topic.code, topic.name) : treatmentLink(topic.condition, topic.key, topic.name))
  }

  const keepMine = () => {
    const w = work.current
    if (!conflict) return
    w.saved = { ...w.saved, revision: conflict.revision }
    w.blocked = false
    setConflict(null)
    void save()
  }
  const useStored = () => {
    const w = work.current
    if (!conflict) return
    // A note that had no title still has none when the stored title is only its first line.
    const stored = { title: w.saved.title === "" && conflict.title === titleOf(null, conflict.body) ? "" : conflict.title, body: conflict.body }
    Object.assign(w, stored, { saved: { ...stored, revision: conflict.revision }, blocked: false })
    setTitle(stored.title)
    setBody(stored.body)
    setConflict(null)
    setFailure(null)
    setUnsaved(false)
    void refresh()
  }

  const copy = async () => {
    const w = work.current
    await save()
    const cited = noteLinks(w.body).papers
    const references = cited.flatMap((slug) => w.references.filter((reference) => reference.slug === slug))
    try {
      await navigator.clipboard.writeText(copyText(w.title.trim() || titleOf(null, w.body), w.body, references, P.references))
      setNotice(P.copied)
    } catch {
      setNotice(P.copyFailed)
    }
  }

  /** A link away from the page waits for what is unsaved; when that cannot be saved the reader stays, with the reason. */
  const leave = (event: MouseEvent<HTMLDivElement>) => {
    const w = work.current
    if ((!dirty(w) && w.saving === null) || w.blocked) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest("a[href]")
    const href = anchor?.getAttribute("href") ?? ""
    if (!anchor || !href.startsWith("/") || anchor.getAttribute("target")) return
    event.preventDefault()
    void save().then(() => { if (!dirty(w)) router.push(href) })
  }

  if (loadError !== null) return <div className="p-7"><p role="alert" className="text-[14px] text-accent-ink">{loadError}</p></div>
  if (view === undefined) return <div className="p-7 text-[14px] text-muted-text">{P.loading}</div>
  const back = <Link href={libraryHref("notes")} className={`text-[13px] text-muted-text hover:text-espresso ${FOCUS}`}>{CLINICAL_COPY.nav.backTo(N.library.tabs.notes)}</Link>
  if (view === null) return <div className="p-7">{back}<p className="mt-3 text-[14px] text-espresso">{N.notFound}</p></div>

  const { summary } = view
  const live = noteLinks(body)
  // A treatment linked under two conditions is named once among the chips.
  const treatments = summary.treatments.filter((entry, index, all) => all.findIndex((other) => other.key === entry.key) === index)
  const fresh = view.newPapers.filter((paper) => !live.papers.includes(paper.slug))
  const missing = new Set([...unresolved, ...summary.links.papers.filter((slug) => !view.references.some((reference) => reference.slug === slug))])
  const paperName = (slug: string) => named[`paper:${slug}`] ?? summary.papers.find((paper) => paper.slug === slug)?.label ?? null
  type Listed = { key: string; label: string; href: string | null }
  const listed: Listed[] = [
    ...live.papers.flatMap((slug): Listed[] => {
      if (missing.has(slug)) return [{ key: `paper:${slug}`, label: slug, href: null }]
      const label = paperName(slug)
      return label === null ? [] : [{ key: `paper:${slug}`, label, href: paperHref(slug) }]
    }),
    ...live.conditions.map((code) => ({
      key: `condition:${code}`, href: evidenceHref({ condition: code }),
      label: summary.conditions.find((entry) => entry.code === code)?.name ?? named[`condition:${code}`] ?? code,
    })),
    ...live.treatments.map((entry) => ({
      key: `treatment:${entry.condition}/${entry.treatment}`, href: evidenceHref({ condition: entry.condition, treatment: entry.treatment }),
      label: summary.treatments.find((other) => other.condition === entry.condition && other.key === entry.treatment)?.name ?? named[`treatment:${entry.condition}/${entry.treatment}`] ?? entry.treatment,
    })),
  ]

  return (
    <div data-note-page={id} className="max-w-3xl p-7" onClickCapture={leave}>
      {back}
      <input type="text" aria-label={P.titleLabel} placeholder={titleOf(null, body)} maxLength={TITLE_MAX} autoComplete="off" value={title}
        onChange={(event) => change({ title: event.target.value })} onBlur={() => void save()}
        className={`mt-3 block w-full border-0 bg-transparent p-0 font-heading text-[24px] tracking-heading text-espresso placeholder:text-muted-text ${FOCUS}`} />

      {summary.conditions.length + treatments.length + summary.papers.length > 0 && (
        <div aria-label={P.aboutLabel} role="group" className="mt-3 flex flex-wrap gap-1.5">
          {summary.conditions.map((entry) => <Link key={entry.code} data-chip="condition" href={evidenceHref({ condition: entry.code })} className={CHIP}>{entry.name}</Link>)}
          {treatments.map((entry) => <Link key={entry.key} data-chip="treatment" href={evidenceHref({ condition: entry.condition, treatment: entry.key })} className={CHIP}>{entry.name}</Link>)}
          {summary.papers.length > 0 && <a data-chip="papers" href={`#${LINKS_ID}`} className={CHIP}>{N.list.papers(summary.papers.length)}</a>}
        </div>
      )}
      <NewPapersSince papers={fresh} since={summary.updated} onCite={cite} />

      {conflict && (
        <div role="alert" data-note-conflict="true" className="mt-4 rounded-card border border-orange bg-orange/10 px-4 py-3">
          <p className="text-[14px] text-espresso">{N.conflict}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={keepMine}>{P.keepMine}</Button>
            <Button variant="secondary" onClick={useStored}>{P.useStored}</Button>
          </div>
        </div>
      )}
      <div className={conflict ? "mt-4 grid gap-4 lg:grid-cols-2" : "mt-4"}>
        <textarea ref={area} aria-label={P.bodyLabel} placeholder={P.bodyPlaceholder} rows={8} value={body}
          onChange={(event) => change({ body: event.target.value })} onFocus={() => { touched.current = true }} onBlur={() => void save()}
          className={`block w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-sans text-[15px] leading-7 text-espresso placeholder:text-muted-text ${FOCUS}`} />
        {conflict && (
          <div data-note-stored="true" className="rounded-card border border-border-warm bg-light-surface px-4 py-3">
            <p className="text-[12px] uppercase tracking-wide text-muted-text">{P.conflictStored}</p>
            <p className="mt-1 text-[15px] font-semibold text-espresso">{conflict.title}</p>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-secondary-dark">{conflict.body}</p>
          </div>
        )}
      </div>

      {listed.length > 0 && (
        <section id={LINKS_ID} aria-label={P.links} className="mt-5 border-t border-border-warm pt-3">
          <h2 className="text-[13px] font-medium text-espresso">{P.links}</h2>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {listed.map((entry) => (
              <li key={entry.key} data-note-link={entry.key}>
                {entry.href !== null ? <Link href={entry.href} className={TEXT_LINK}>{entry.label}</Link>
                  : <span className="text-muted-text"><span className="text-espresso">{entry.label}</span> <span data-not-found="true">{P.notFound}</span></span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" aria-expanded={panel === "cite"} onClick={() => setPanel(panel === "cite" ? null : "cite")} className={ACTION}>{P.citePaper}</button>
        <button type="button" aria-expanded={panel === "link"} onClick={() => setPanel(panel === "link" ? null : "link")} className={ACTION}>{P.linkTopic}</button>
        <button type="button" onClick={() => void copy()} className={ACTION}>{P.copy}</button>
        <Link href={noteChatHref(id)} className={ACTION}>{P.ask}</Link>
        <button type="button" onClick={() => void save().finally(onDelete)} className={`${ACTION} hover:text-accent-ink`}>{P.remove}</button>
        {notice !== null && <span role="status" data-note-notice="true" className="text-[13px] text-accent-ink">{notice}</span>}
      </div>
      {panel === "cite" && <CitePaper onChoose={cite} onClose={() => setPanel(null)} />}
      {panel === "link" && <LinkTopic onChoose={link} onClose={() => setPanel(null)} />}
      {confirm}

      <p className="mt-4 text-[12px] leading-5 text-muted-text">
        {failure !== null ? (
          <>
            <span role="alert" data-note-state="failed" className="text-accent-ink">{failure}</span>{" "}
            <button type="button" onClick={() => void save()} className={`font-medium underline underline-offset-2 ${FOCUS}`}>{P.retry}</button>
          </>
        ) : <span role="status" data-note-state={unsaved ? "saving" : "saved"}>{unsaved ? P.saving : P.saved}</span>}
        <span aria-hidden="true" className="px-1.5">·</span>{P.noPatient}
        <span aria-hidden="true" className="px-1.5">·</span>{P.askHint}
      </p>
    </div>
  )
}
