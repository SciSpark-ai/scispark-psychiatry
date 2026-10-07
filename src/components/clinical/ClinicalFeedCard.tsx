"use client"

import { useState, type CSSProperties } from "react"
import { Clock } from "lucide-react"
import { useRouter } from "next/navigation"
import type { VaultStorage } from "@/lib/vault/storage"
import { paperSlug } from "@/lib/wiki/authoring"
import { displayTitle } from "@/lib/papers/title"
import { savePaper } from "@/lib/papers/save-client"
import { Card } from "@/components/ui/Card"
import { PaperSaveButton } from "@/components/paper/PaperSaveButton"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { FeedbackKind } from "@/lib/clinical/feedback/store"
import type { StoredFeedItem } from "@/lib/clinical/feed/stored"
import { conclusionOf } from "@/lib/clinical/text/takeaway"
import { writeReaderHandoff } from "@/lib/reader/handoff"
import { unescapeHtml } from "@/lib/clinical/text/clean"
import { toggleReadLater } from "@/lib/clinical/readlater/store"
import { ClinicalFeedback } from "./ClinicalFeedback"

const F = CLINICAL_COPY.feed
const isMatchGrade = (grade: number): grade is 1 | 2 | 3 | 4 => grade >= 1 && grade <= 4 && Number.isInteger(grade)

/**
 * One tint per watch entry, from the brand's band colours, so the papers of a topic can be told
 * apart at a glance. The tint is a pale wash of the colour over the normal card surface.
 */
export const CARD_TONES = [
  "var(--band-impact)", "var(--band-method)", "var(--band-breakthrough)", "var(--band-evidence)",
  "var(--band-trending)", "var(--band-application)", "var(--band-dataset)", "var(--band-review)",
] as const

export function ClinicalFeedCard({ item, storage, saved, onSave, entryLabel, vote, tone, readLater = false, onReadLater, position, highlighted = false }: {
  item: StoredFeedItem; storage: VaultStorage; saved: boolean; onSave: (key: string) => void
  /** Human label of the matched watch entry, when there is one. */
  entryLabel?: string
  vote?: FeedbackKind
  /** Position of the matched watch entry in the watch list; picks the card's tint. */
  tone?: number
  /** Whether the paper is on the Read later list when the card is drawn. */
  readLater?: boolean
  onReadLater?: (key: string, on: boolean) => void
  /** The card's place in the list on screen (1, 2, ...); the AI overview refers to papers by it. */
  position?: number
  /** Marked for a moment after a jump from the AI overview. */
  highlighted?: boolean
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [later, setLater] = useState(readLater)
  const { paper } = item

  async function toggleLater() {
    setError(null)
    try {
      const on = await toggleReadLater(storage, item)
      setLater(on)
      onReadLater?.(item.key, on)
    } catch (failure) { setError(failure instanceof Error ? failure.message : F.readLaterFailed) }
  }
  // Journal and the publication date as precisely as the record gives it (day, month or year).
  // When the record entered PubMed on another day, both dates are given: the search goes by the second.
  const published = paper.date?.slice(0, 10) ?? (paper.year ? String(paper.year) : undefined)
  const added = paper.addedDate?.slice(0, 10)
  const source = [paper.venue, ...(added && published && added !== published ? [F.publishedOn(published), F.inPubmed(added)] : [published])].filter(Boolean).join(" · ")
  const inferredDesign = (item.designSource === "model" || item.designSource === "text-rule") && item.design !== "other" && item.design !== "unknown"
  const designNote = item.designSource === "publication-type" ? CLINICAL_COPY.designNote : inferredDesign ? CLINICAL_COPY.designInferredNote : undefined
  const conclusion = conclusionOf(paper.abstract)
  const matched = item.entryId !== null && isMatchGrade(item.grade) ? item.grade : null
  const partNote = item.matched ? F.matchedPartNotes[item.matched] : matched === null ? undefined : F.matchNotes[matched]
  const matchNote = partNote === undefined ? undefined
    : [partNote, item.quoteVerified && item.quote ? F.matchedOn(item.quote) : ""].filter(Boolean).join(" ")

  // The paper page finds a paper through the reader hand-off; a feed paper is in neither the wiki nor upstream's feed cache.
  async function open() {
    // Lists stored before author names were cleaned may still carry character codes in them.
    const record = { ...paper, authors: paper.authors.map((author) => ({ ...author, name: unescapeHtml(author.name) })) }
    try { await writeReaderHandoff(storage, record) } catch { /* the page then shows its own "not found" */ }
    router.push(`/paper/${paperSlug(paper)}`)
  }

  async function handleSave() {
    if (saved || saving) return
    setSaving(true)
    setError(null)
    try { await savePaper(storage, paper); onSave(item.key) }
    catch (failure) { setError(failure instanceof Error ? failure.message : CLINICAL_COPY.feed.saveFailed) }
    finally { setSaving(false) }
  }

  return (
    <Card
      data-testid="clinical-feed-card"
      // The whole card opens the paper; its buttons (votes, read later, save) keep the click to themselves.
      onClick={() => void open()}
      {...(position === undefined ? {} : { id: `paper-${position}` })}
      // Inline, not utility classes: the tint has to win over the card's own background class.
      {...(tone === undefined ? {} : { "data-tone": String(tone), style: {
        "--card-tone": CARD_TONES[tone % CARD_TONES.length],
        // --card-strength is raised by the hover and highlight classes below: the tint deepens a little.
        backgroundColor: "color-mix(in srgb, var(--card-tone) var(--card-strength, 2%), var(--surface-light))",
        // Jumped to from the overview: the border takes the card's own colour, clearly, on top of the lift.
        borderColor: highlighted ? "color-mix(in srgb, var(--card-tone) 75%, var(--border))" : "color-mix(in srgb, var(--card-tone) 14%, var(--border))",
      } as CSSProperties })}
      {...(highlighted ? { "data-highlighted": "true" } : {})}
      // A card stands out by a slightly deeper tint and a lift: gently under the pointer, more when jumped to.
      className={`flex cursor-pointer flex-col gap-2.5 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:[--card-strength:6%] ${highlighted ? "-translate-y-1 border-2 shadow-xl [--card-strength:10%]" : ""}`}
    >
      {/* Tags are plain text, not pills: a pill's own background fights with the card's tint. */}
      <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] leading-snug">
        {position !== undefined && <span data-position="true" className="min-w-[1.1em] font-semibold tabular-nums text-muted-text">{position}</span>}
        {/* Topic first (the user's own watch entry, in the accent colour), then the study type in plain text. */}
        {entryLabel && (
          <span
            data-topic="true" title={matchNote} className="font-semibold text-accent-ink"
            // On a tinted card the topic takes the tint's own hue, deepened towards the text colour so it stays readable in both themes.
            {...(tone === undefined ? {} : { "data-toned": "true", style: { color: "color-mix(in srgb, var(--card-tone) 62%, var(--text-primary))" } })}
          >{entryLabel}</span>
        )}
        {designNote && <span title={designNote} {...(inferredDesign ? { "data-inferred": "true" } : {})} className="text-espresso">{CLINICAL_COPY.designLabels[item.design]}</span>}
        {item.flags.includes("title-only") && <span className="text-muted-text">{CLINICAL_COPY.feed.noAbstract}</span>}
        {item.ungraded && <span className="text-muted-text">{CLINICAL_COPY.feed.notGraded}</span>}
      </p>
      {/* With an AI headline the card shows only headline, source and summary; the paper's own title is on its page. */}
      <button type="button" onClick={(event) => { event.stopPropagation(); void open() }} className="text-left" title={displayTitle(paper.title)}>
        <h3 className="line-clamp-3 font-heading text-[18px] font-semibold leading-snug tracking-heading-card text-espresso">{item.digest ? item.digest.headline : displayTitle(paper.title)}</h3>
      </button>
      {source && <p data-testid="card-source" className="truncate text-[13px] font-medium text-secondary-dark" title={source}>{source}</p>}
      {item.digest
        ? <p className="text-[15px] leading-relaxed text-espresso" title={F.aiSummaryNote(item.digest.quote)}>{item.digest.takeaway}</p>
        : conclusion && <p className="line-clamp-4 text-[15px] leading-relaxed text-espresso" title={F.conclusionLabel}>{conclusion}</p>}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <ClinicalFeedback storage={storage} paperKey={item.key} title={displayTitle(paper.title)} initial={vote} />
        <div className="flex items-center gap-1">
          <button type="button" aria-label={later ? F.readLaterRemove : F.readLater} title={later ? F.readLaterRemove : F.readLater} aria-pressed={later}
            onClick={(event) => { event.stopPropagation(); void toggleLater() }}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-orange ${later ? "bg-orange/15 text-accent-ink" : "text-muted-text hover:bg-card-surface hover:text-espresso"}`}>
            <Clock size={17} strokeWidth={later ? 2.6 : 2} aria-hidden="true" />
          </button>
          <PaperSaveButton saved={saved} busy={saving} onSave={() => void handleSave()} />
        </div>
      </div>
      {error && <p role="alert" className="text-[12px] text-espresso">{error}</p>}
    </Card>
  )
}
