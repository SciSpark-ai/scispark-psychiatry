"use client"

import { useState } from "react"
import type { VaultStorage } from "@/lib/vault/storage"
import { recordFeedback, type FeedbackKind } from "@/lib/clinical/feedback/store"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const BUTTONS: Array<{ kind: FeedbackKind; label: string }> = [
  { kind: "relevant", label: CLINICAL_COPY.feedback.relevant },
  { kind: "practice-change", label: CLINICAL_COPY.feedback.practiceChange },
  { kind: "not-relevant", label: CLINICAL_COPY.feedback.notRelevant },
]

/** Three feedback controls (D30). A vote is stored locally; "not relevant" keeps the paper out of later runs. */
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
      setError(failure instanceof Error ? failure.message : "Your vote could not be saved.")
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
      {BUTTONS.map(({ kind, label }) => (
        <button
          key={kind} type="button" aria-pressed={current === kind} onClick={() => void vote(kind)}
          className={`rounded-pill border px-3 py-1 text-[12px] transition-colors focus-visible:ring-2 focus-visible:ring-orange ${
            current === kind ? "border-orange bg-orange/10 text-accent-ink" : "border-border-warm text-muted-text hover:bg-card-surface/60"}`}
        >
          {label}
        </button>
      ))}
      {error && <span role="alert" className="text-[12px] text-espresso">{error}</span>}
    </div>
  )
}
