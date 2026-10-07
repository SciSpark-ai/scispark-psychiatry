"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { VaultStorage } from "@/lib/vault/storage"
import { paperSlug } from "@/lib/wiki/authoring"
import { displayTitle } from "@/lib/papers/title"
import { venueYearLine } from "@/lib/papers/venue"
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

export function ClinicalFeedCard({ item, storage, saved, onSave, entryLabel, vote }: {
  item: StoredFeedItem; storage: VaultStorage; saved: boolean; onSave: (key: string) => void
  /** Human label of the matched watch entry, when there is one. */
  entryLabel?: string
  vote?: FeedbackKind
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { paper } = item
  const meta = venueYearLine(paper.venue, paper.year)
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
    <Card className="flex flex-col gap-3 p-4" data-testid="clinical-feed-card">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent" title={CLINICAL_COPY.designNote}>{CLINICAL_COPY.designLabels[item.design]}</Chip>
        {entryLabel && <Chip title={matchNote}>{entryLabel}{matched !== null ? ` · ${F.matchLabels[matched]}` : ""}</Chip>}
        {item.flags.includes("title-only") && <Chip>{CLINICAL_COPY.feed.noAbstract}</Chip>}
        {item.ungraded && <Chip>{CLINICAL_COPY.feed.notGraded}</Chip>}
      </div>
      <button type="button" onClick={() => void open()} className="text-left" title={displayTitle(paper.title)}>
        <h3 className="line-clamp-3 font-heading text-[17px] leading-snug tracking-heading-card text-espresso">{displayTitle(paper.title)}</h3>
      </button>
      {conclusion && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-text">{F.conclusionLabel}</p>
          <p className="line-clamp-4 text-[13px] leading-relaxed text-espresso">{conclusion}</p>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-2 border-t border-border-warm/60 pt-3">
        <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-text">
          {meta && <p className="truncate" title={meta}>{meta}</p>}
          <p>{paper.date ? CLINICAL_COPY.feed.published(paper.date.slice(0, 10)) : CLINICAL_COPY.feed.noDate}</p>
        </div>
        <PaperSaveButton saved={saved} busy={saving} onSave={() => void handleSave()} />
      </div>
      <ClinicalFeedback storage={storage} paperKey={item.key} title={displayTitle(paper.title)} initial={vote} />
      {error && <p role="alert" className="text-[12px] text-espresso">{error}</p>}
    </Card>
  )
}
