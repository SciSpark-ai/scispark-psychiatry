import type { CardDigest } from "@/lib/clinical/digest/card"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const P = CLINICAL_COPY.paper

/** The AI summary shown on the feed card, repeated at the top of the paper page with the sentence it rests on. */
export function ClinicalPaperSummary({ digest }: { digest: CardDigest }) {
  return (
    <section className="mt-5 max-w-[720px] rounded-card border border-border-warm/70 bg-light-surface px-5 py-4">
      <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted-text"><span title={P.aiSummaryNote} className="cursor-help underline decoration-dotted">{P.aiSummary}</span></p>
      <p className="text-[17px] leading-relaxed text-espresso">{digest.takeaway}</p>
      {digest.quote && <p className="mt-2 text-[13px] leading-relaxed text-muted-text">{P.aiSummaryBasis} <span className="italic">{digest.quote}</span></p>}
    </section>
  )
}
