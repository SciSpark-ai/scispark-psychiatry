import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Efficacy } from "@/lib/clinical/evidence/build"
import { BubbleGrid, discBoxHeight } from "./BubbleGrid"
import { BubbleDisc, EvidenceBubble } from "./EvidenceBubble"
import { dateParts, layoutMap, MAP_SIZE, mapScales, newestDate } from "./evidence-map"
import { AXIS_COLOUR, AXIS_TEXT_COLOUR, COLUMN_FILL } from "./evidence-shapes"

const E = CLINICAL_COPY.evidence
const M = E.map

/** A class or a treatment, as the map and its grid draw it. */
export interface MapEntry {
  key: string; name: string; papers: number; efficacy: Efficacy; newPapers: number
  safetyPapers?: number; comparatorPapers?: number
  /** The participants its papers state, added up, and how many of the papers state them. */
  participants: number | null; sized: number
  /** The publication dates of its papers, as they are printed. */
  dates: string[]
}

const percent = (value: number, of: number) => `${Number(((value / of) * 100).toFixed(2))}%`
const BUTTON = "group absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full outline-2 outline-offset-2 transition-all duration-200 focus-visible:outline-accent-ink"
const LABEL = "pointer-events-none absolute left-1/2 w-max -translate-x-1/2 rounded-sm bg-page-bg/70 px-0.5 text-center"
const TITLE = "max-w-[680px] text-[12px] text-muted-text"

/**
 * The classes of treatment, or the treatments of one class, on a map: across, the date of the newest paper of each,
 * with a thin line back to its earliest and a column at the left for those with no date; up, the participants their
 * papers state, added up, on a log scale, with a band along the bottom for those that state none. A bubble is a
 * button over the picture of the axes; its size is its papers and its colours what they found. Bubbles that would
 * overlap are moved up or down at their own date; one that had to move sideways has a thin line to where it belongs.
 * On a narrow screen the same bubbles are a grid of two columns, with the month and the participants in words.
 * `today` is the day the time scale ends at. Dates, counts and stated sizes: nothing is pooled.
 */
export function EvidenceMap({ label, entries, chosen, onPick, today }: { label: string; entries: MapEntry[]; chosen: string | null; onPick: (key: string) => void; today: string }) {
  // Every word and every place is worked out before any element is built.
  const boxHeight = discBoxHeight(entries.map((entry) => entry.papers))
  const drawn = entries.map((entry) => {
    const newest = newestDate(entry.dates)
    const parts = newest === null ? null : dateParts(newest)
    const position = M.position(newest, entry.participants, entry.sized, entry.papers)
    const marks = [
      ...(entry.newPapers > 0 ? [E.newCount(entry.newPapers)] : []),
      ...((entry.safetyPapers ?? 0) > 0 ? [E.safetyMark(entry.safetyPapers ?? 0)] : []),
      ...((entry.comparatorPapers ?? 0) > 0 ? [E.comparedMark(entry.comparatorPapers ?? 0)] : []),
    ].join(M.markGap)
    return {
      entry, marks, position, pressed: entry.key === chosen,
      line: M.tileLine(parts ? M.when(parts.year, parts.month) : null, entry.participants),
      says: E.bubbleLabel(entry.name, entry.papers, entry.efficacy, entry.newPapers, entry.safetyPapers ?? 0, entry.comparatorPapers ?? 0, position),
    }
  })
  const tiles = drawn.map(({ entry, position, line, pressed }) => (
    <EvidenceBubble key={entry.key} id={entry.key} name={entry.name} papers={entry.papers} efficacy={entry.efficacy} newPapers={entry.newPapers} safetyPapers={entry.safetyPapers} comparatorPapers={entry.comparatorPapers}
      discHeight={boxHeight} detail={line} position={position} pressed={pressed} onPick={() => onPick(entry.key)} />
  ))
  if (entries.length === 0) return <div data-evidence-map="grid"><BubbleGrid label={label}>{tiles}</BubbleGrid></div>

  const { width, height } = MAP_SIZE
  const items = drawn.map(({ entry, marks }) => ({ key: entry.key, name: entry.name, papers: entry.papers, participants: entry.participants, dates: entry.dates, marks: marks || undefined }))
  const scales = mapScales(items, MAP_SIZE, today)
  const { plot, column, band } = scales
  const places = layoutMap(items, MAP_SIZE, today)
  // From left to right, and from the top down: the order a reader tabs through.
  const bubbles = drawn
    .map((each, at) => ({ ...each, at: places[at] }))
    .sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y || (a.entry.key < b.entry.key ? -1 : 1))
    .map((each) => ({ ...each, style: { left: percent(each.at.x, width), top: percent(each.at.y, height), width: percent(2 * each.at.r, width) } }))
  const leaders = places.filter((place) => place.displaced)
  const spans = places.flatMap((place) => (place.earliestX === null ? [] : [{ key: place.key, from: place.earliestX, to: place.x, y: place.y }]))
  const months = scales.ticksX.map((tick) => ({ id: `${tick.year}-${tick.month}`, x: tick.x, text: tick.labelled ? M.when(tick.year, tick.month) : null }))
  return (
    <div data-evidence-map-root="true">
      <div data-evidence-map="wide" className="mt-2 hidden sm:block">
        <p data-axis-title="y" className={TITLE}>{M.axis}</p>
        <div data-map-box="true" role="group" aria-label={label} className="relative aspect-[680/400] w-full max-w-[680px]">
          <svg data-map-axes="true" aria-hidden="true" viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full">
            {band && <rect data-band="true" x={plot.left} y={band.top} width={plot.right - plot.left} height={band.bottom - band.top} rx={6} fill={COLUMN_FILL} />}
            {band && scales.bandY !== null && <text data-band-label="true" x={plot.left - 6} y={scales.bandY} textAnchor="end" dominantBaseline="central" fontSize={11} fill={AXIS_TEXT_COLOUR}>{M.notStated}</text>}
            {column && <rect data-column="true" x={column.left} y={plot.top} width={column.right - column.left} height={plot.bottom - plot.top} rx={6} fill={COLUMN_FILL} />}
            {column && <text data-column-label="true" x={(column.left + column.right) / 2} y={plot.bottom + 16} textAnchor="middle" fontSize={11} fill={AXIS_TEXT_COLOUR}>{M.noDate}</text>}
            {scales.ticksY.map((tick) => (
              <g key={tick.value}>
                <line data-guide="true" x1={column ? column.right : plot.left} x2={plot.right} y1={tick.y} y2={tick.y} stroke={AXIS_COLOUR} strokeWidth={1} strokeDasharray="3 4" />
                <text data-tick-y="true" x={plot.left - 6} y={tick.y} textAnchor="end" dominantBaseline="central" fontSize={11} fill={AXIS_TEXT_COLOUR}>{M.tick(tick.value)}</text>
              </g>
            ))}
            <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke={AXIS_COLOUR} strokeWidth={1} />
            <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} stroke={AXIS_COLOUR} strokeWidth={1} />
            {months.map((tick) => (
              <g key={tick.id}>
                <line data-tick-mark="true" x1={tick.x} x2={tick.x} y1={plot.bottom} y2={plot.bottom + 4} stroke={AXIS_COLOUR} strokeWidth={1} />
                {tick.text !== null && <text data-tick-x="true" x={tick.x} y={plot.bottom + 16} textAnchor="middle" fontSize={11} fill={AXIS_TEXT_COLOUR}>{tick.text}</text>}
              </g>
            ))}
            {spans.map((span) => (
              <g key={span.key} data-span={span.key}>
                <line data-span-line="true" x1={span.from} x2={span.to} y1={span.y} y2={span.y} stroke={AXIS_TEXT_COLOUR} strokeWidth={1} />
                <line data-span-end="true" x1={span.from} x2={span.from} y1={span.y - 4} y2={span.y + 4} stroke={AXIS_TEXT_COLOUR} strokeWidth={1} />
              </g>
            ))}
            {leaders.map((place) => <line key={place.key} data-leader={place.key} x1={place.home.x} y1={place.home.y} x2={place.x} y2={place.y} stroke={AXIS_TEXT_COLOUR} strokeWidth={1} strokeDasharray="2 2" />)}
            {leaders.map((place) => <circle key={place.key} data-home={place.key} cx={place.home.x} cy={place.home.y} r={2.5} fill={AXIS_TEXT_COLOUR} />)}
          </svg>
          {bubbles.map(({ entry, marks, says, at, pressed, style }) => (
            <button key={entry.key} type="button" data-bubble={entry.key} aria-pressed={pressed} aria-label={says} title={says} onClick={() => onPick(entry.key)} style={style}
              className={pressed ? `${BUTTON} z-10 outline-accent-ink` : `${BUTTON} outline-transparent hover:outline-border-warm`}>
              <BubbleDisc radius={at.r} papers={entry.papers} efficacy={entry.efficacy} safetyPapers={entry.safetyPapers} fluid />
              <span data-label={at.labelAbove ? "above" : "under"} className={at.labelAbove ? `${LABEL} bottom-full mb-[3px]` : `${LABEL} top-full mt-[3px]`}>
                <span data-name="true" className={pressed ? "mx-auto block max-w-[96px] text-[12px] font-semibold leading-[15px] text-espresso" : "mx-auto block max-w-[96px] text-[12px] leading-[15px] text-secondary-dark"}>{entry.name}</span>
                {marks !== "" && <span data-marks="true" className="block whitespace-nowrap text-[11px] leading-[14px] text-muted-text">{marks}</span>}
              </span>
            </button>
          ))}
        </div>
        <p data-axis-title="x" className={`${TITLE} pl-[60px] text-center`}>{M.timeAxis}</p>
      </div>
      <div data-evidence-map="narrow" className="sm:hidden">
        <BubbleGrid label={label} columns="two">{tiles}</BubbleGrid>
      </div>
      <p data-map-note="true" className="mt-2 max-w-[720px] text-[12px] text-muted-text">{M.note}</p>
    </div>
  )
}
