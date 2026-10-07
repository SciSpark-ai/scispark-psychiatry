"use client"

import { useEffect, useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { loadPaperDigestRemote, writePaperDigestRemote } from "@/lib/clinical/digest/paper-client"
import type { StoredPaperDigest } from "@/lib/clinical/digest/paper"
import type { PaperRecord } from "@/lib/papers/types"
import { paperKey } from "@/lib/papers/types"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"

const D = CLINICAL_COPY.paper.digest
/** The items in the order they are read: the order of their labels in copy.ts, which a test holds to the library's. */
const ITEMS = Object.keys(D.labels) as Array<keyof typeof D.labels>

/**
 * The digest of a paper as nine short labelled items. A stored digest is shown when the page opens;
 * a new one is written only when the reader asks, because it reads the paper and calls the model.
 */
export function ClinicalPaperDigest({ paper }: { paper: PaperRecord }) {
  const [digest, setDigest] = useState<StoredPaperDigest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = paperKey(paper)

  useEffect(() => {
    let cancelled = false
    loadPaperDigestRemote(paper).then((stored) => { if (!cancelled) setDigest(stored) }).catch(() => {})
    return () => { cancelled = true }
    // The paper is identified by its key; a new object for the same paper must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const write = async () => {
    setBusy(true)
    setError(null)
    try { setDigest((await writePaperDigestRemote(paper)).digest) } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } finally { setBusy(false) }
  }
  const fromFullText = digest?.source.access === "full-text"

  return (
    <section data-testid="paper-digest" aria-labelledby="clinical-digest-title" className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="clinical-digest-title" className="font-heading text-[20px] font-semibold text-espresso">{D.heading}</h2>
        {digest && <span className="text-[12px] text-muted-text">{fromFullText ? (digest.source.truncated ? D.fromExcerpt : D.fromFullText) : D.fromAbstract}</span>}
      </div>
      {digest ? (
        <dl className="space-y-3">
          {ITEMS.map((item) => (
            <div key={item} data-digest-item={item} className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[190px_1fr]">
              <dt className="text-[13px] font-semibold text-secondary-dark">{D.labels[item]}</dt>
              <div>
                <dd className={`text-[15px] leading-relaxed ${digest.items[item] ? "text-espresso" : "text-muted-text"}`}>{digest.items[item] ?? (fromFullText ? D.notInPaper : D.notInAbstract)}</dd>
                {digest.unverified.includes(item) && <p className="text-[12px] text-accent-ink">{D.unverified}</p>}
              </div>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[14px] text-muted-text">{D.none}</p>
      )}
      {(!digest || !fromFullText) && (
        <button type="button" onClick={() => void write()} disabled={busy}
          className="mt-4 rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso hover:bg-card-surface/60 disabled:opacity-50">
          {busy ? D.writing : digest ? D.update : D.write}
        </button>
      )}
      {error && <div role="alert" className="mt-3"><LlmErrorMessage message={error} /></div>}
    </section>
  )
}
