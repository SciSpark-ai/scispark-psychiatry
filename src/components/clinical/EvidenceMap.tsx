import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Efficacy } from "@/lib/clinical/evidence/build"
import { BubbleGrid, discBoxHeight } from "./BubbleGrid"
import { BubbleDisc, EvidenceBubble } from "./EvidenceBubble"
import { dateParts, layoutMap, MAP_SIZE, mapScales, newestDate } from "./evidence-map"
import { AXIS_TEXT_COLOUR, COLUMN_FILL, EFFICACY_KINDS, GRID_COLOUR, KIND_COLOUR } from "./evidence-shapes"

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
const BUTTON = "group absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full outline-2 outline-offset-2 outline-transparent transition-all duration-200 focus-visible:outline-accent-ink"
/** The chosen bubble has a light ground around it; the outline is the keyboard's. */
const PRESSED = "z-10 bg-orange/20 ring-[6px] ring-orange/20"
/** The disc of a bubble grows a little under the pointer; its name stays as it is. */
const DISC = "block h-full w-full transition-transform duration-200 ease-out group-hover:scale-105 motion-reduce:transition-none"
/** Over this many items a map is a crowd: they are drawn side by side on the grid. */
const MOST_MAPPED = 20
/** A name has nothing behind it: it is read by its colour alone. */
const LABEL = "pointer-events-none absolute left-1/2 w-max -translate-x-1/2 text-center"
const NAME = "mx-auto block max-w-[120px] text-[14px] leading-[18px]"
const TITLE = "text-[13px] text-muted-text"
const [TICK, SMALL] = [13, 12]
/** The corners of the frame of the plot, and of the band and the column inside it. */
const CORNER = 12

/** What the three colours of a doughnut are: three small pills, at the right of the row they are put in. */
export function MapLegend() {
  return (
    <ul data-map-legend="true" className="ml-auto flex flex-wrap items-center gap-1.5">
      {EFFICACY_KINDS.map((kind) => (
        <li key={kind} data-key-kind={kind} className="inline-flex items-center gap-1.5 rounded-pill border border-border-warm/60 px-2.5 py-0.5 text-[12px] leading-5 text-secondary-dark">
          <span data-swatch="true" aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: KIND_COLOUR[kind] }} />
          <span>{E.kindLabels[kind]}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The classes of treatment, or the treatments of one class, on a map: across, the date of the newest paper of each,
 * with a column at the left for those with no date; up, the participants their papers state, added up, on a log
 * scale, with a band along the bottom for those that state none. A bubble is a button over the picture of the axes;
 * its size is its papers and its colours what they found (its owner names them, with `MapLegend`). The picture has a
 * light frame and a very light line per tick, and no line of an axis; no bubble and no name is on the clear space
 * inside the frame. Bubbles that would overlap are moved apart by the least that fits; one moved by more than its
 * radius has a thin line to where it belongs. On a narrow screen, and for more than twenty items, the same bubbles
 * are a grid, with the month and the participants in words. The time scale covers the bubbles that are shown and no
 * more, with a tick a week, a month or a year. Dates, counts and stated sizes: nothing is pooled.
 */
export function EvidenceMap({ label, entries, chosen, onPick }: { label: string; entries: MapEntry[]; chosen: string | null; onPick: (key: string) => void }) {
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
  if (entries.length > MOST_MAPPED) return <div data-evidence-map="grid"><BubbleGrid label={label}>{tiles}</BubbleGrid></div>

  const { width, height } = MAP_SIZE
  const items = drawn.map(({ entry, marks }) => ({ key: entry.key, name: entry.name, papers: entry.papers, participants: entry.participants, dates: entry.dates, marks: marks || undefined }))
  const scales = mapScales(items, MAP_SIZE)
  const { plot, column, band, bandY } = scales
  const places = layoutMap(items, MAP_SIZE)
  // From left to right, and from the top down: the order a reader tabs through.
  const bubbles = drawn
    .map((each, at) => ({ ...each, at: places[at] }))
    .sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y || (a.entry.key < b.entry.key ? -1 : 1))
    .map((each) => ({ ...each, shift: each.at.labelShift === 0 ? undefined : { marginLeft: each.at.labelShift }, style: { left: percent(each.at.x, width), top: percent(each.at.y, height), width: percent(2 * each.at.r, width) } }))
  const leaders = places.filter((place) => place.displaced)
  const months = scales.ticksX.map((tick) => ({
    id: `${tick.year}-${tick.month}-${tick.day}`, x: tick.x,
    text: !tick.labelled ? null : tick.day !== null && tick.month !== null ? M.day(tick.month, tick.day) : M.when(tick.year, tick.month),
  }))
  return (
    <div data-evidence-map-root="true" className="mt-4">
      <div data-evidence-map="wide" className="hidden sm:block">
        <div data-map-box="true" role="group" aria-label={label} className="relative mx-auto aspect-[720/460] w-full max-w-[720px]">
          <span className="pointer-events-none absolute left-0 top-0 flex h-[96%] w-5 items-center justify-center">
            <span data-axis-title="y" className={`${TITLE} -rotate-90 whitespace-nowrap`}>{M.axis}</span>
          </span>
          <svg data-map-axes="true" aria-hidden="true" viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full">
            {band && <rect data-band="true" x={plot.left} y={band.top} width={plot.right - plot.left} height={band.bottom - band.top} rx={CORNER} fill={COLUMN_FILL} />}
            {band && bandY !== null && <text data-band-label="true" x={plot.left - 8} y={bandY} textAnchor="end" dominantBaseline="central" fontSize={SMALL} fill={AXIS_TEXT_COLOUR}>{M.notStated}</text>}
            {column && <rect data-column="true" x={column.left} y={plot.top} width={column.right - column.left} height={plot.bottom - plot.top} rx={CORNER} fill={COLUMN_FILL} />}
            {column && <text data-column-label="true" x={(column.left + column.right) / 2} y={plot.bottom + 18} textAnchor="middle" fontSize={TICK} fill={AXIS_TEXT_COLOUR}>{M.noDate}</text>}
            {scales.ticksY.map((tick) => (
              <g key={tick.value}>
                <line data-guide="y" x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} stroke={GRID_COLOUR} strokeWidth={1} />
                <text data-tick-y="true" x={plot.left - 8} y={tick.y} textAnchor="end" dominantBaseline="central" fontSize={TICK} fill={AXIS_TEXT_COLOUR}>{M.tick(tick.value)}</text>
              </g>
            ))}
            {months.map((tick) => (
              <g key={tick.id}>
                <line data-guide="x" x1={tick.x} x2={tick.x} y1={plot.top} y2={plot.bottom} stroke={GRID_COLOUR} strokeWidth={1} />
                {tick.text !== null && <text data-tick-x="true" x={tick.x} y={plot.bottom + 18} textAnchor="middle" fontSize={TICK} fill={AXIS_TEXT_COLOUR}>{tick.text}</text>}
              </g>
            ))}
            <rect data-plot-frame="true" x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} rx={CORNER} fill="none" stroke={GRID_COLOUR} strokeWidth={1} />
            {leaders.map((place) => <line key={place.key} data-leader={place.key} x1={place.home.x} y1={place.home.y} x2={place.x} y2={place.y} stroke={AXIS_TEXT_COLOUR} strokeWidth={1} strokeDasharray="2 2" />)}
            {leaders.map((place) => <circle key={place.key} data-home={place.key} cx={place.home.x} cy={place.home.y} r={2.5} fill={AXIS_TEXT_COLOUR} />)}
          </svg>
          {bubbles.map(({ entry, marks, says, at, pressed, style, shift }) => (
            <button key={entry.key} type="button" data-bubble={entry.key} aria-pressed={pressed} aria-label={says} title={says} onClick={() => onPick(entry.key)} style={style}
              className={pressed ? `${BUTTON} ${PRESSED}` : `${BUTTON} hover:outline-border-warm`}>
              <span data-bubble-disc="true" className={DISC}>
                <BubbleDisc radius={at.r} papers={entry.papers} efficacy={entry.efficacy} safetyPapers={entry.safetyPapers} fluid />
              </span>
              <span data-label={at.labelAbove ? "above" : "under"} style={shift} className={at.labelAbove ? `${LABEL} bottom-full mb-[3px]` : `${LABEL} top-full mt-[3px]`}>
                <span data-name="true" className={pressed ? `${NAME} font-semibold text-espresso` : `${NAME} font-medium text-secondary-dark`}>{entry.name}</span>
                {marks !== "" && <span data-marks="true" className="block whitespace-nowrap text-[12px] leading-4 text-muted-text">{marks}</span>}
              </span>
            </button>
          ))}
        </div>
        <p data-axis-title="x" className={`${TITLE} mx-auto mt-1 max-w-[720px] pl-[84px] text-center`}>{M.timeAxis}</p>
      </div>
      <div data-evidence-map="narrow" className="sm:hidden">
        <BubbleGrid label={label} columns="two">{tiles}</BubbleGrid>
      </div>
    </div>
  )
}
