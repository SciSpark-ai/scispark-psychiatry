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
import { ClinicalFeedback } from "./ClinicalFeedback"

const firstSentence = (abstract: string | undefined) => abstract?.replace(/^[A-Za-z ]+:\s*/, "").split(/(?<=[.!?])\s/)[0]

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
        {entryLabel && <Chip>{entryLabel}{item.entryId ? ` · ${CLINICAL_COPY.feed.match(item.grade)}` : ""}</Chip>}
        {item.flags.includes("title-only") && <Chip>{CLINICAL_COPY.feed.noAbstract}</Chip>}
        {item.ungraded && <Chip>{CLINICAL_COPY.feed.notGraded}</Chip>}
      </div>
      <button type="button" onClick={() => router.push(`/paper/${paperSlug(paper)}`)} className="text-left">
        <h3 className="font-heading text-[19px] leading-snug tracking-heading-card text-espresso">{displayTitle(paper.title)}</h3>
      </button>
      {firstSentence(paper.abstract) && <p className="line-clamp-3 text-[13px] leading-relaxed text-espresso">{firstSentence(paper.abstract)}</p>}
      {item.quoteVerified && item.quote && <p className="text-[12px] italic text-muted-text">“{item.quote}”</p>}
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
