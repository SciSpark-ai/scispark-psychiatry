"use client"

import { useState } from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import type { VaultStorage } from "@/lib/vault/storage"
import { recordFeedback, type FeedbackKind } from "@/lib/clinical/feedback/store"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const F = CLINICAL_COPY.feedback
const BUTTONS = [
  { kind: "relevant", label: F.up, note: F.upNote, Icon: ThumbsUp },
  { kind: "not-relevant", label: F.down, note: F.downNote, Icon: ThumbsDown },
] as const

/**
 * Thumbs up and thumbs down (owner decision 2026-10-06, replacing the three text buttons of D30).
 * A vote is stored locally; thumbs down keeps the paper out of later runs. The store still accepts
 * the earlier "practice-change" votes, which count as positive.
 */
export function ClinicalFeedback({ storage, paperKey, title, initial, onVote }: {
  storage: VaultStorage; paperKey: string; title: string; initial?: FeedbackKind; onVote?: (kind: FeedbackKind) => void
}) {
  const [current, setCurrent] = useState<FeedbackKind | undefined>(initial)
  const [error, setError] = useState<string | null>(null)

  async function vote(kind: FeedbackKind) {
    setError(null)
    try {
      await recordFeedback(storage, { paperKey, title, kind, at: new Date().toISOString() })
      setCurrent(kind)
      onVote?.(kind)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : F.saveFailed)
    }
  }

  const pressed = (kind: FeedbackKind) => current === kind || (kind === "relevant" && current === "practice-change")

  return (
    <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
      {BUTTONS.map(({ kind, label, note, Icon }) => (
        <button
          key={kind} type="button" aria-label={label} title={note} aria-pressed={pressed(kind)} onClick={() => void vote(kind)}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-orange ${
            pressed(kind) ? "bg-orange/15 text-accent-ink" : "text-muted-text hover:bg-card-surface hover:text-espresso"}`}
        >
          <Icon size={17} fill={pressed(kind) ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      ))}
      {error && <span role="alert" className="text-[12px] text-espresso">{error}</span>}
    </div>
  )
}
