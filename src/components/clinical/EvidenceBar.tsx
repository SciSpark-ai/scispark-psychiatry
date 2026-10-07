import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Counts } from "@/lib/clinical/evidence/build"

const E = CLINICAL_COPY.evidence

export const KIND_ORDER = ["benefit", "no-benefit", "mixed", "safety", "other", "unsorted"] as const
export const KIND_COLOUR: Record<(typeof KIND_ORDER)[number], string> = {
  benefit: "var(--clinical-benefit)", "no-benefit": "var(--clinical-no-benefit)", mixed: "var(--viz-cat-6)", safety: "var(--viz-cat-3)", other: "var(--border)", unsorted: "var(--border)",
}
/** The colour of a direction's name in text: the pale fill colour of the neutral kinds would not be read. */
export const KIND_TEXT_COLOUR: Record<(typeof KIND_ORDER)[number], string> = { ...KIND_COLOUR, other: "var(--text-muted)", unsorted: "var(--text-muted)" }

const MIN_FILL = 6
const TRACK = "flex h-2.5 w-full overflow-hidden rounded-full border border-border-warm bg-light-surface"
const percent = (part: number, whole: number) => `${Number(((part / whole) * 100).toFixed(4))}%`

/**
 * The papers of a class or treatment as a bar. The track is as wide as the column; the fill is
 * `papers` against `largest` (never under 6%) and is divided by direction in proportion to the papers.
 */
export function EvidenceBar({ counts, papers, largest }: { counts: Counts; papers: number; largest: number }) {
  const kinds = KIND_ORDER.filter((kind) => counts[kind] > 0)
  const fill = Math.max(MIN_FILL, Math.round((100 * papers) / Math.max(1, largest)))
  const title = kinds.map((kind) => `${counts[kind]} ${E.kinds[kind]}`).join(", ")
  return (
    <span data-bar="true" title={title} className={TRACK}>
      <span data-bar-fill="true" className="flex h-full" style={{ width: `${fill}%` }}>
        {kinds.map((kind) => <span key={kind} data-kind={kind} className="h-full" style={{ width: percent(counts[kind], papers), backgroundColor: KIND_COLOUR[kind] }} />)}
      </span>
    </span>
  )
}
