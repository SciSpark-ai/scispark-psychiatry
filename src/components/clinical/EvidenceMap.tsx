import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Efficacy } from "@/lib/clinical/evidence/build"
import { BubbleGrid, discBoxHeight } from "./BubbleGrid"
import { BubbleDisc, EvidenceBubble } from "./EvidenceBubble"
import { benefitShare, layoutMap, MAP_SIZE, mapScales } from "./evidence-map"
import { AXIS_COLOUR, AXIS_TEXT_COLOUR, COLUMN_FILL } from "./evidence-shapes"

const E = CLINICAL_COPY.evidence
const M = E.map

/** A class or a treatment, as the map and its grid draw it. */
export interface MapEntry {
  key: string; name: string; papers: number; efficacy: Efficacy; newPapers: number
  safetyPapers?: number; comparatorPapers?: number
  /** The participants its papers state, added up, and how many of the papers state them. */
  participants: number | null; sized: number
}

const percent = (value: number, of: number) => `${Number(((value / of) * 100).toFixed(2))}%`
const BUTTON = "group absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full outline-2 outline-offset-2 transition-all duration-200 focus-visible:outline-accent-ink"
const LABEL = "pointer-events-none absolute left-1/2 w-max -translate-x-1/2 rounded-sm bg-page-bg/70 px-0.5 text-center"

/**
 * The classes of treatment, or the treatments of one class, on a map: across, the participants their papers state,
 * added up, on a log scale, with a column at the left for those that state none; up, the share of their papers that
 * report benefit. A bubble is a button over the picture of the axes; its size is its papers. Bubbles that would
 * overlap are set side by side at their own height; one that had to move up or down has a thin line to where it belongs. On a narrow screen the
 * same bubbles are a grid of two columns, with the participants in words. When no item states its participants there
 * is nothing to map, and the grid is drawn alone with a line that says so. Counts and stated sizes: nothing is pooled.
 */
export function EvidenceMap({ label, entries, chosen, onPick }: { label: string; entries: MapEntry[]; chosen: string | null; onPick: (key: string) => void }) {
  const mapped = entries.some((entry) => entry.participants !== null)
  const boxHeight = discBoxHeight(entries.map((entry) => entry.papers))
  const tiles = entries.map((entry) => (
    <EvidenceBubble key={entry.key} id={entry.key} name={entry.name} papers={entry.papers} efficacy={entry.efficacy} newPapers={entry.newPapers} safetyPapers={entry.safetyPapers} comparatorPapers={entry.comparatorPapers}
      discHeight={boxHeight} detail={mapped ? M.participants(entry.participants) : undefined} position={M.position(entry.participants, entry.sized, entry.papers)}
      pressed={entry.key === chosen} onPick={() => onPick(entry.key)} />
  ))
  if (!mapped) {
    return (
      <div data-evidence-map="grid">
        <p data-map-none="true" className="mt-2 text-[12px] text-muted-text">{M.noneStated}</p>
        <BubbleGrid label={label}>{tiles}</BubbleGrid>
      </div>
    )
  }

  // Every place is worked out before any element is built.
  const { width, height } = MAP_SIZE
  const drawn = entries.map((entry) => {
    const marks = [
      ...(entry.newPapers > 0 ? [E.newCount(entry.newPapers)] : []),
      ...((entry.safetyPapers ?? 0) > 0 ? [E.safetyMark(entry.safetyPapers ?? 0)] : []),
      ...((entry.comparatorPapers ?? 0) > 0 ? [E.comparedMark(entry.comparatorPapers ?? 0)] : []),
    ].join(M.markGap)
    return { entry, marks, says: E.bubbleLabel(entry.name, entry.papers, entry.efficacy, entry.newPapers, entry.safetyPapers ?? 0, entry.comparatorPapers ?? 0, M.position(entry.participants, entry.sized, entry.papers)) }
  })
  const items = drawn.map(({ entry, marks }) => ({ key: entry.key, name: entry.name, papers: entry.papers, share: benefitShare(entry.efficacy, entry.papers), participants: entry.participants, marks: marks || undefined }))
  const scales = mapScales(items, MAP_SIZE)
  const { plot, column } = scales
  const places = layoutMap(items, MAP_SIZE)
  // From left to right, and from the top down: the order a reader tabs through.
  const bubbles = drawn
    .map((each, at) => ({ ...each, at: places[at], pressed: each.entry.key === chosen }))
    .sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y || (a.entry.key < b.entry.key ? -1 : 1))
    .map((each) => ({ ...each, style: { left: percent(each.at.x, width), top: percent(each.at.y, height), width: percent(2 * each.at.r, width) } }))
  const leaders = places.filter((place) => place.displaced)
  const shares = [{ id: "all", y: scales.yTop, text: M.shares.all }, { id: "split", y: scales.yMiddle, text: M.shares.split }, { id: "none", y: scales.yBottom, text: M.shares.none }]
  return (
    <div data-evidence-map-root="true">
      <div data-evidence-map="wide" className="mt-2 hidden sm:block">
        <div data-map-box="true" role="group" aria-label={label} className="relative aspect-[680/350] w-full max-w-[680px]">
          <svg data-map-axes="true" aria-hidden="true" viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full">
            {column && <rect data-column="true" x={column.left} y={plot.top} width={column.right - column.left} height={plot.bottom - plot.top} rx={6} fill={COLUMN_FILL} />}
            {column && <text data-column-label="true" x={(column.left + column.right) / 2} y={plot.bottom + 16} textAnchor="middle" fontSize={11} fill={AXIS_TEXT_COLOUR}>{M.notStated}</text>}
            <line data-guide="true" x1={column ? column.right : plot.left} x2={plot.right} y1={scales.yMiddle} y2={scales.yMiddle} stroke={AXIS_COLOUR} strokeWidth={1} strokeDasharray="3 4" />
            <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke={AXIS_COLOUR} strokeWidth={1} />
            <line x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.bottom} stroke={AXIS_COLOUR} strokeWidth={1} />
            {scales.ticks.map((tick) => (
              <g key={tick.value}>
                <line x1={tick.x} x2={tick.x} y1={plot.bottom} y2={plot.bottom + 4} stroke={AXIS_COLOUR} strokeWidth={1} />
                <text data-tick="true" x={tick.x} y={plot.bottom + 16} textAnchor="middle" fontSize={11} fill={AXIS_TEXT_COLOUR}>{M.tick(tick.value)}</text>
              </g>
            ))}
            {leaders.map((place) => <line key={place.key} data-leader={place.key} x1={place.home.x} y1={place.home.y} x2={place.x} y2={place.y} stroke={AXIS_TEXT_COLOUR} strokeWidth={1} />)}
            {leaders.map((place) => <circle key={place.key} data-home={place.key} cx={place.home.x} cy={place.home.y} r={2.5} fill={AXIS_TEXT_COLOUR} />)}
            {shares.map((share) => <text key={share.id} data-share-label="true" x={plot.left - 8} y={share.y} textAnchor="end" dominantBaseline="central" fontSize={11} fill={AXIS_TEXT_COLOUR}>{share.text}</text>)}
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
        <p data-axis-title="true" className="max-w-[680px] pl-[74px] text-center text-[12px] text-muted-text">{M.axis}</p>
      </div>
      <div data-evidence-map="narrow" className="sm:hidden">
        <BubbleGrid label={label} columns="two">{tiles}</BubbleGrid>
      </div>
      <p data-map-note="true" className="mt-2 max-w-[720px] text-[12px] text-muted-text">{M.note}</p>
    </div>
  )
}
