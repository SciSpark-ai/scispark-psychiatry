import type { CardDigest } from "@/lib/clinical/digest/card"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const P = CLINICAL_COPY.paper

/** The AI summary shown on the feed card, repeated at the top of the paper page, with the paper's tags. The sentence it rests on is on hover. */
export function ClinicalPaperSummary({ digest }: { digest: CardDigest }) {
  const tags = digest.tags ?? []
  return (
    <section className="mt-5 max-w-[720px] rounded-card border border-border-warm/70 bg-light-surface px-5 py-4">
      <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted-text"><span title={P.aiSummaryNote(digest.quote)} className="cursor-help underline decoration-dotted">{P.aiSummary}</span></p>
      <p className="text-[17px] leading-relaxed text-espresso">{digest.takeaway}</p>
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => <span key={tag} data-tag="true" className="rounded-pill border border-border-warm px-2.5 py-0.5 text-[13px] text-secondary-dark">{tag}</span>)}
        </div>
      )}
    </section>
  )
}
