import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Efficacy } from "@/lib/clinical/evidence/build"

const E = CLINICAL_COPY.evidence

export const KIND_ORDER = ["benefit", "no-benefit", "mixed", "safety", "other", "unsorted"] as const
type Kind = (typeof KIND_ORDER)[number]
/** The neutral kinds are the muted text colour, thinned: the border colour could not be seen on the track, which has that colour as its edge. */
export const KIND_COLOUR: Record<Kind, string> = {
  benefit: "var(--clinical-benefit)", "no-benefit": "var(--clinical-no-benefit)", mixed: "var(--viz-cat-6)", safety: "var(--viz-cat-3)",
  other: "color-mix(in srgb, var(--text-muted) 55%, transparent)", unsorted: "color-mix(in srgb, var(--text-muted) 30%, transparent)",
}
/** The colour of a direction's name in text: the pale fill colour of the neutral kinds would not be read. */
export const KIND_TEXT_COLOUR: Record<Kind, string> = { ...KIND_COLOUR, other: "var(--text-muted)", unsorted: "var(--text-muted)" }

/** The directions a bar is divided by: the efficacy results, in the order of the fill. */
const BAR_KINDS = ["benefit", "no-benefit", "mixed"] as const

const MIN_FILL = 6
const TRACK = "flex h-2.5 w-full overflow-hidden rounded-full border border-border-warm bg-light-surface"
const percent = (part: number, whole: number) => `${Number(((part / whole) * 100).toFixed(4))}%`

/**
 * The efficacy papers of a class or treatment as a bar. The track is as wide as the column; the fill is
 * `papers` against `largest` (never under 6%) and is divided by direction in proportion to the papers.
 */
export function EvidenceBar({ counts, papers, largest }: { counts: Efficacy; papers: number; largest: number }) {
  const kinds = BAR_KINDS.filter((kind) => counts[kind] > 0)
  const fill = Math.max(MIN_FILL, Math.round((100 * papers) / Math.max(1, largest)))
  const title = kinds.map((kind) => `${counts[kind]} ${E.kinds[kind]}`).join(", ")
  return (
    <span data-bar="true" role="img" aria-label={title} title={title} className={TRACK}>
      <span data-bar-fill="true" className="flex h-full" style={{ width: `${fill}%` }}>
        {kinds.map((kind) => <span key={kind} data-kind={kind} className="h-full" style={{ width: percent(counts[kind], papers), backgroundColor: KIND_COLOUR[kind] }} />)}
      </span>
    </span>
  )
}

/** The key to the bars: a swatch and the name of each direction that some bar of the list has, in the order of the fill. */
export function EvidenceBarKey({ counts }: { counts: Efficacy[] }) {
  const kinds = BAR_KINDS.filter((kind) => counts.some((entry) => entry[kind] > 0))
  if (kinds.length === 0) return null
  return (
    <ul data-bar-key="true" aria-label={E.barKey} className="flex flex-wrap gap-x-4 gap-y-1 px-2 pb-1 pt-2 text-[12px] text-muted-text">
      {kinds.map((kind) => (
        <li key={kind} data-key-kind={kind} className="flex items-center gap-1.5">
          <span data-swatch="true" aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: KIND_COLOUR[kind] }} />
          <span>{E.kindLabels[kind]}</span>
        </li>
      ))}
    </ul>
  )
}
