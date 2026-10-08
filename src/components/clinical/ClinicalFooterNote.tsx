import { CLINICAL_COPY } from "@/lib/clinical/copy"

/**
 * The safety line of the clinical edition, drawn by the app shell under every page: what the app is
 * for, that its AI text can be wrong, and that nothing about a patient belongs in it. Small and quiet,
 * and outside the scrolling area so that no page can push it out of sight.
 */
export function ClinicalFooterNote() {
  const line = [CLINICAL_COPY.disclaimerShort, CLINICAL_COPY.aiCanBeWrong, CLINICAL_COPY.noPatientData].join(" ")
  return (
    <footer className="shrink-0 border-t border-border-warm/60 px-4 py-1 text-center">
      <p data-testid="clinical-footer-note" className="text-[11px] leading-4 text-muted-text">{line}</p>
    </footer>
  )
}
