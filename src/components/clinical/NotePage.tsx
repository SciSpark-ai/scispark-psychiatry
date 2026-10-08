"use client"

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/Button"
import { renderMarkdown } from "@/components/wiki/markdown-preview"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { evidenceHref } from "@/lib/clinical/evidence/href"
import { readNoteRemote, saveNoteRemote, type NoteAnswer } from "@/lib/clinical/notes/client"
import { clearDraft, readDraft, writeDraft } from "@/lib/clinical/notes/draft"
import { noteChatHref, notesHref, paperHref } from "@/lib/clinical/notes/href"
import { copyText, endOfText, insertLink } from "@/lib/clinical/notes/insert"
import { previewMarkdown } from "@/lib/clinical/notes/preview"
import { conditionLink, isUntitledStored, noteLinks, paperLink, titleOf, treatmentLink, type NoteConflict, type NoteReference } from "@/lib/clinical/notes/links"
import { CitePaper } from "./CitePaper"
import { LinkTopic, type Topic } from "./LinkTopic"
import { NewPapersSince } from "./NewPapersSince"

const N = CLINICAL_COPY.notes
const P = N.page
/** How long after the last change a note saves itself. Leaving a field, leaving the page and the buttons save at once. */
export const SAVE_DELAY_MS = 3000
/** The longest title the field takes. */
const TITLE_MAX = 200
const LINKS_ID = "note-links"
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
const CHIP = `rounded-pill border border-border-warm px-2.5 py-0.5 text-[12px] leading-4 text-secondary-dark transition-colors hover:bg-card-surface/60 ${FOCUS}`
const ACTION = `rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso transition-colors hover:bg-card-surface ${FOCUS}`
const TEXT_LINK = `text-accent-ink hover:underline ${FOCUS}`
/** As the tabs of the Library: muted, and the chosen one semibold over a line of the accent. */
const TAB = `border-b-2 border-transparent px-3 py-1.5 text-[14px] leading-5 text-muted-text transition-colors hover:text-espresso ${FOCUS}`
const TAB_ON = `border-b-2 border-accent-ink px-3 py-1.5 text-[14px] font-semibold leading-5 text-espresso ${FOCUS}`
/** The two ways the text is shown. */
const TABS = ["edit", "preview"] as const
type Tab = (typeof TABS)[number]

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
  /** The page is no longer drawn. */
  gone: boolean
  /** The page is being left (taken down, or hidden by the browser): what is unsaved is sent so that it outlives the page. */
  leaving: boolean
  saving: Promise<void> | null
  timer: ReturnType<typeof setTimeout> | null
  /** The links of the text the chips, references and new papers were read for. */
  links: string
  references: NoteReference[]
  /** How many times the chips were asked for: only the answer to the last asking is shown. */
  reads: number
}
const dirty = (work: Work) => work.ready && (work.title !== work.saved.title || work.body !== work.saved.body)
/** The title of a stored version as the field holds it: empty for a note that has none. */
const fieldTitle = (stored: NoteConflict) => (stored.untitled ? "" : stored.title)
/** True when the stored version of a conflict is what was just sent: the save arrived, and only its answer was lost. */
function isSent(stored: NoteConflict, sent: { title: string; body: string }): boolean {
  const title = sent.title.replace(/\s+/g, " ").trim()
  return stored.body === sent.body && (isUntitledStored(title) ? stored.untitled : !stored.untitled && stored.title === title)
}

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
 * until the reader says which to keep, and until then no link of the page takes the reader away from their text.
 * Opening a note writes nothing. Text that has not reached the server is also kept by the browser (a draft per note),
 * so it outlives a reload or a save that failed: a note opened with such a draft shows it again, as unsaved text when
 * it was typed over the stored version, else beside the stored version as a conflict.
 *
 * The text has two tabs: "Edit", the field, and "Preview", the text as it reads (the wiki's Markdown renderer), where
 * a cited paper is a link to the paper's page and a wiki link that resolves to nothing is marked. A note with text
 * opens on Preview, an empty one on Edit. The field stays in the page under Preview, hidden, so that the caret, what
 * is typed and a save under way are untouched by a change of tab; putting a link in shows Edit first.
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
  const [tab, setTab] = useState<Tab>("edit")
  const tabsId = useId()
  const [notice, setNotice] = useState<string | null>(null)
  /** The names of what was linked on this visit, until the server names them. */
  const [named, setNamed] = useState<Record<string, string>>({})
  const work = useRef<Work>({
    title: "", body: "", saved: { title: "", body: "", revision: "" }, ready: false, blocked: false, gone: false, leaving: false, saving: null, timer: null, links: "", references: [], reads: 0,
  })
  const card = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const touched = useRef(false)
  const place = useRef<number | null>(null)

  /** The browser's copy of what has not reached the server: kept while there is such text, dropped when there is none. */
  const keep = useCallback(() => {
    const w = work.current
    if (dirty(w) || w.blocked) writeDraft(id, { title: w.title, body: w.body, revision: w.saved.revision })
    else clearDraft(id)
  }, [id])

  /** The chips, the references and the new papers, read again: they follow the links of the text. */
  const refresh = useCallback(async () => {
    const w = work.current
    const asked = ++w.reads
    try {
      const fresh = await readNoteRemote(id)
      if (!fresh || w.gone || asked !== w.reads) return
      w.links = linkKey(fresh.body)
      w.references = fresh.references
      setView(fresh)
    } catch {
      // What is shown stays as it was; the next save that changes a link asks again.
    }
  }, [id])

  /**
   * Saves what is unsaved, one save at a time, until nothing is: a change made during a save is saved after it. The
   * turn ends with the last save; reading the chips again comes after it and holds nothing up.
   */
  const save = useCallback(function send(): Promise<void> {
    const w = work.current
    if (w.saving) return w.saving
    if (w.timer !== null) clearTimeout(w.timer)
    w.timer = null
    if (w.blocked || !dirty(w)) return Promise.resolve()
    let failed = false
    const turn = async () => {
      while (dirty(w) && !w.blocked) {
        const sent = { title: w.title, body: w.body }
        let result: Awaited<ReturnType<typeof saveNoteRemote>>
        try {
          result = await saveNoteRemote({ id, ...sent, revision: w.saved.revision }, undefined, w.leaving ? { keepalive: true } : {})
        } catch (reason) {
          failed = true
          setFailure(messageOf(reason))
          return
        }
        if ("conflict" in result && !isSent(result, sent)) {
          w.blocked = true
          setConflict(result)
          return
        }
        w.saved = { ...sent, revision: result.revision }
        keep()
        setFailure(null)
        // A conflict that says what was sent is a save whose answer was lost: there is nothing more to report of it.
        if ("conflict" in result) continue
        setUnresolved(result.unresolved)
        if (result.savedPapers.length > 0) setNotice(P.savedToLibrary)
      }
    }
    w.saving = turn().finally(() => {
      w.saving = null
      setUnsaved(dirty(w))
      if (!w.gone && w.links !== linkKey(w.saved.body)) void refresh()
      // Whatever was typed as the turn ended is not left waiting for another keystroke.
      if (!failed && !w.blocked && dirty(w)) void send()
    })
    return w.saving
  }, [id, keep, refresh])

  useEffect(() => {
    let cancelled = false
    const w = work.current
    readNoteRemote(id)
      .then((answer) => {
        if (cancelled) return
        if (answer && !w.ready) {
          const stored = { title: untitled ? "" : answer.summary.title, body: answer.body }
          // Text the browser kept from an earlier visit, when it says something the stored note does not.
          const draft = readDraft(id)
          const mine = draft && (draft.title !== stored.title || draft.body !== stored.body) ? draft : null
          if (draft && !mine) clearDraft(id)
          // Typed over another version than the stored one: the reader chooses, as for any conflict.
          const stale = mine !== null && mine.revision !== answer.revision
          const text = mine ? { title: mine.title, body: mine.body } : stored
          Object.assign(w, text, {
            saved: { ...stored, revision: mine && stale ? mine.revision : answer.revision }, ready: true, blocked: stale, links: linkKey(answer.body), references: answer.references,
          })
          setTitle(text.title)
          setBody(text.body)
          setTab(mine || text.body.trim() === "" ? "edit" : "preview")
          setUnsaved(mine !== null)
          if (stale) setConflict({ conflict: true, title: answer.summary.title, untitled, body: answer.body, revision: answer.revision })
          else if (mine) void save()
        }
        setView(answer)
      })
      .catch((reason) => { if (!cancelled) setLoadError(messageOf(reason)) })
    return () => { cancelled = true }
  }, [id, untitled, save])

  // Leaving the page with unsaved text sends it once more, in a request that outlives the page: when the page is
  // taken down, and when the browser hides it (a closed tab, another site). A page shown again saves as before.
  useEffect(() => {
    const w = work.current
    w.gone = false
    w.leaving = false
    const hide = () => { w.leaving = true; void save() }
    const show = () => { w.leaving = false }
    window.addEventListener("pagehide", hide)
    window.addEventListener("pageshow", show)
    return () => {
      window.removeEventListener("pagehide", hide)
      window.removeEventListener("pageshow", show)
      w.gone = true
      w.leaving = true
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
  }, [body, view, conflict, tab])

  // After a link was put in, the caret is behind it.
  useEffect(() => {
    const field = area.current
    if (place.current === null || !field) return
    field.focus()
    field.setSelectionRange(place.current, place.current)
    place.current = null
  }, [body, tab])

  const change = (next: { title?: string; body?: string }) => {
    const w = work.current
    if (next.title !== undefined) { w.title = next.title; setTitle(next.title) }
    if (next.body !== undefined) { w.body = next.body; setBody(next.body) }
    if (w.timer !== null) clearTimeout(w.timer)
    w.timer = null
    setNotice(null)
    keep()
    setUnsaved(dirty(w) || w.blocked || w.saving !== null)
    if (dirty(w)) w.timer = setTimeout(() => { w.timer = null; void save() }, SAVE_DELAY_MS)
  }

  /** Puts a link where the caret is, or after the last text when the reader has not been in the field. */
  const insert = (link: string) => {
    const w = work.current
    const field = area.current
    const start = touched.current && field ? field.selectionStart : endOfText(w.body)
    const end = touched.current && field ? field.selectionEnd : start
    const next = insertLink(w.body, link, start, end)
    setTab("edit")
    touched.current = true
    place.current = next.caret
    change({ body: next.text })
  }
  const cite = (paper: { slug: string; label: string }) => {
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
    // From here the stored version is what the reader's text is measured against: whatever differs from it is sent.
    w.saved = { title: fieldTitle(conflict), body: conflict.body, revision: conflict.revision }
    w.blocked = false
    setConflict(null)
    keep()
    setUnsaved(dirty(w))
    void save()
  }
  const useStored = () => {
    const w = work.current
    if (!conflict) return
    const stored = { title: fieldTitle(conflict), body: conflict.body }
    Object.assign(w, stored, { saved: { ...stored, revision: conflict.revision }, blocked: false })
    clearDraft(id)
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

  /**
   * A link away from the page waits for what is unsaved; when that cannot be saved the reader stays, with the reason.
   * While a conflict holds text of the reader's that the stored version does not have, no link takes them away: the
   * card that asks which to keep is brought to them instead.
   */
  const leave = (event: MouseEvent<HTMLDivElement>) => {
    const w = work.current
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element).closest("a[href]")
    const href = anchor?.getAttribute("href") ?? ""
    if (!anchor || !href.startsWith("/") || anchor.getAttribute("target")) return
    if (w.blocked) {
      if (conflict && w.title === fieldTitle(conflict) && w.body === conflict.body) return
      event.preventDefault()
      card.current?.scrollIntoView?.({ block: "center" })
      card.current?.focus()
      return
    }
    if (!dirty(w) && w.saving === null) return
    event.preventDefault()
    void save().then(() => { if (!dirty(w) && !w.blocked) router.push(href) })
  }

  if (loadError !== null) return <div className="p-7"><p role="alert" className="text-[14px] text-accent-ink">{loadError}</p></div>
  if (view === undefined) return <div className="p-7 text-[14px] text-muted-text">{P.loading}</div>
  const back = <Link href={notesHref()} className={`text-[13px] text-muted-text hover:text-espresso ${FOCUS}`}>{CLINICAL_COPY.nav.backTo(CLINICAL_COPY.nav.notes)}</Link>
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

  /** A panel that puts a link in the text is opened over the field, not over the preview. */
  const toggle = (which: "cite" | "link") => {
    setTab("edit")
    setPanel(panel === which ? null : which)
  }
  // The papers the preview can link: those the server named, and those cited on this visit.
  const known = new Map(summary.papers.map((paper) => [paper.slug, paper.label] as const))
  for (const slug of live.papers) {
    const label = named[`paper:${slug}`]
    if (label !== undefined && !known.has(slug)) known.set(slug, label)
  }
  const preview = tab !== "preview" ? null
    : body.trim() === "" ? <p className="text-[14px] text-muted-text">{P.previewEmpty}</p>
    : renderMarkdown(previewMarkdown(body, { papers: known, missing, notFound: P.notFound }), { preserveLineBreaks: true })

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
        <div ref={card} tabIndex={-1} role="alert" data-note-conflict="true" className="mt-4 rounded-card border border-orange bg-orange/10 px-4 py-3">
          <p className="text-[14px] text-espresso">{N.conflict}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={keepMine}>{P.keepMine}</Button>
            <Button variant="secondary" onClick={useStored}>{P.useStored}</Button>
          </div>
        </div>
      )}
      <div role="tablist" aria-label={P.tabsLabel} className="mt-4 flex gap-1 border-b border-border-warm">
        {TABS.map((entry) => (
          <button key={entry} type="button" role="tab" id={`${tabsId}-${entry}`} data-note-tab={entry} aria-selected={entry === tab} aria-controls={`${tabsId}-panel`}
            onClick={() => setTab(entry)} className={entry === tab ? TAB_ON : TAB}>{P.tabs[entry]}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className={conflict ? "mt-4 grid gap-4 lg:grid-cols-2" : "mt-4"}>
        <textarea ref={area} hidden={tab !== "edit"} aria-label={P.bodyLabel} placeholder={P.bodyPlaceholder} rows={8} value={body}
          onChange={(event) => change({ body: event.target.value })} onFocus={() => { touched.current = true }} onBlur={() => void save()}
          className={`w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-sans text-[15px] leading-7 text-espresso placeholder:text-muted-text ${FOCUS}`} />
        {preview !== null && <div data-note-preview="true" className="min-w-0 whitespace-pre-line">{preview}</div>}
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
        <button type="button" aria-expanded={panel === "cite"} onClick={() => toggle("cite")} className={ACTION}>{P.citePaper}</button>
        <button type="button" aria-expanded={panel === "link"} onClick={() => toggle("link")} className={ACTION}>{P.linkTopic}</button>
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
        <span aria-hidden="true" className="px-1.5">·</span>{CLINICAL_COPY.noPatientData}
        <span aria-hidden="true" className="px-1.5">·</span>{P.askHint}
      </p>
    </div>
  )
}
