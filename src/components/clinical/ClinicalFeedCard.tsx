"use client"

import { useState, type CSSProperties } from "react"
import { useRouter } from "next/navigation"
import type { VaultStorage } from "@/lib/vault/storage"
import { paperSlug } from "@/lib/wiki/authoring"
import { displayTitle } from "@/lib/papers/title"
import { savePaper } from "@/lib/papers/save-client"
import { Card } from "@/components/ui/Card"
import { Chip } from "@/components/ui/Chip"
import { PaperSaveButton } from "@/components/paper/PaperSaveButton"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { FeedbackKind } from "@/lib/clinical/feedback/store"
import type { StoredFeedItem } from "@/lib/clinical/feed/stored"
import { conclusionOf } from "@/lib/clinical/text/takeaway"
import { writeReaderHandoff } from "@/lib/reader/handoff"
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

export function ClinicalFeedCard({ item, storage, saved, onSave, entryLabel, vote, tone }: {
  item: StoredFeedItem; storage: VaultStorage; saved: boolean; onSave: (key: string) => void
  /** Human label of the matched watch entry, when there is one. */
  entryLabel?: string
  vote?: FeedbackKind
  /** Position of the matched watch entry in the watch list; picks the card's tint. */
  tone?: number
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { paper } = item
  // Journal and the publication date as precisely as the record gives it (day, month or year).
  const source = [paper.venue, paper.date?.slice(0, 10) ?? (paper.year ? String(paper.year) : undefined)].filter(Boolean).join(" · ")
  const inferredDesign = (item.designSource === "model" || item.designSource === "text-rule") && item.design !== "other" && item.design !== "unknown"
  const conclusion = conclusionOf(paper.abstract)
  const matched = item.entryId !== null && isMatchGrade(item.grade) ? item.grade : null
  const matchNote = matched === null ? undefined
    : [F.matchNotes[matched], item.quoteVerified && item.quote ? F.matchedOn(item.quote) : ""].filter(Boolean).join(" ")

  // The paper page finds a paper through the reader hand-off; a feed paper is in neither the wiki nor upstream's feed cache.
  async function open() {
    try { await writeReaderHandoff(storage, paper) } catch { /* the page then shows its own "not found" */ }
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
      // Inline, not utility classes: the tint has to win over the card's own background class.
      {...(tone === undefined ? {} : { "data-tone": String(tone), style: {
        "--card-tone": CARD_TONES[tone % CARD_TONES.length],
        backgroundColor: "color-mix(in srgb, var(--card-tone) 10%, var(--surface-light))",
        borderColor: "color-mix(in srgb, var(--card-tone) 30%, var(--border))",
      } as CSSProperties })}
      className="flex flex-col gap-2.5 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        {item.designSource === "publication-type"
          ? <Chip tone="accent" title={CLINICAL_COPY.designNote}>{CLINICAL_COPY.designLabels[item.design]}</Chip>
          : inferredDesign && <Chip tone="accent" data-inferred="true" title={CLINICAL_COPY.designInferredNote}>{CLINICAL_COPY.designLabels[item.design]}</Chip>}
        {entryLabel && <Chip title={matchNote}>{entryLabel}{matched !== null ? ` · ${F.matchLabels[matched]}` : ""}</Chip>}
        {item.flags.includes("title-only") && <Chip>{CLINICAL_COPY.feed.noAbstract}</Chip>}
        {item.ungraded && <Chip>{CLINICAL_COPY.feed.notGraded}</Chip>}
      </div>
      {/* With an AI headline the card shows only headline, source and summary; the paper's own title is on its page. */}
      <button type="button" onClick={() => void open()} className="text-left" title={displayTitle(paper.title)}>
        <h3 className="line-clamp-3 font-heading text-[18px] font-semibold leading-snug tracking-heading-card text-espresso">{item.digest ? item.digest.headline : displayTitle(paper.title)}</h3>
      </button>
      {source && <p className="truncate text-[13px] text-muted-text" title={source}>{source}</p>}
      {item.digest
        ? <p className="text-[15px] leading-relaxed text-espresso" title={F.aiSummaryNote(item.digest.quote)}>{item.digest.takeaway}</p>
        : conclusion && <p className="line-clamp-4 text-[15px] leading-relaxed text-espresso" title={F.conclusionLabel}>{conclusion}</p>}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <ClinicalFeedback storage={storage} paperKey={item.key} title={displayTitle(paper.title)} initial={vote} />
        <PaperSaveButton saved={saved} busy={saving} onSave={() => void handleSave()} />
      </div>
      {error && <p role="alert" className="text-[12px] text-espresso">{error}</p>}
    </Card>
  )
}
