import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { ConditionEvidence } from "@/lib/clinical/evidence/build"
import { classNameOf } from "./evidence-labels"

const E = CLINICAL_COPY.evidence
const OTHER_SERIES = "other"
const SERIES_COLOURS = ["var(--viz-cat-1)", "var(--viz-cat-2)", "var(--viz-cat-3)", "var(--viz-cat-5)", "var(--viz-cat-7)"]
const OTHER_COLOUR = "var(--border)"

/** Papers by month of publication, stacked by class. Its last series, "other", is whatever has no series of its own. */
export function EvidenceTimeline({ evidence }: { evidence: ConditionEvidence }) {
  const { months, series } = evidence.timeline
  const totals = months.map((_, index) => series.reduce((sum, entry) => sum + entry.counts[index], 0))
  const peak = Math.max(1, ...totals)
  const [width, height, gap] = [640, 150, 6]
  const bar = (width - gap * (months.length - 1)) / Math.max(1, months.length)
  const colourOf = (key: string, index: number) => (key === OTHER_SERIES ? OTHER_COLOUR : SERIES_COLOURS[index % SERIES_COLOURS.length])
  const nameOf = (key: string, label: string | null) => (key === OTHER_SERIES ? E.otherSeries : classNameOf(key, label))
  // Every rectangle is worked out before any element is built: one per month and series with papers in it.
  const rects = months.flatMap((month, at) => {
    let top = height
    return series.flatMap((entry, index) => {
      const count = entry.counts[at]
      if (count === 0) return []
      const tall = (count / peak) * height
      top -= tall
      return [{ id: `${month}-${entry.key}`, month, count, x: at * (bar + gap), y: top, tall, colour: colourOf(entry.key, index) }]
    })
  })
  return (
    <div data-testid="evidence-timeline">
      <svg viewBox={`0 0 ${width} ${height + 18}`} role="img" aria-label={E.timelineLabel(evidence.condition.name)} className="w-full max-w-[720px]">
        {rects.map((rect) => <rect key={rect.id} data-month={rect.month} data-count={rect.count} x={rect.x} y={rect.y} width={bar} height={rect.tall} rx={2} fill={rect.colour}><title>{`${rect.month}: ${rect.count}`}</title></rect>)}
        {months.map((month, at) => (at % 3 === 0 || at === months.length - 1 ? <text key={month} x={at * (bar + gap) + bar / 2} y={height + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{month}</text> : null))}
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-secondary-dark">
        {series.map((entry, index) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: colourOf(entry.key, index) }} />
            <span data-legend="true">{nameOf(entry.key, entry.label)}</span>
          </span>
        ))}
      </p>
    </div>
  )
}
