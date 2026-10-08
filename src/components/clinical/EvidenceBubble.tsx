import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Efficacy } from "@/lib/clinical/evidence/build"
import { arcPath, bubbleRadius, CENTRE_FILL, KIND_COLOUR, LIGHT_EDGE, LIGHT_FILL, NUMBER_COLOUR, pieSlices, SAFETY_COLOUR } from "./evidence-shapes"

const E = CLINICAL_COPY.evidence
/** The share of the radius the plain centre of a pie takes: the number is read there, not on a colour. */
const HOLE = 0.6
const RING_GAP = 3

interface Props {
  id: string; name: string; papers: number
  /** What the papers found. Without it the bubble is one light disc: it says no direction. */
  efficacy?: Efficacy
  newPapers?: number; safetyPapers?: number
  pressed: boolean; onPick: () => void
}

/**
 * One bubble: a button whose disc grows with its papers, the number in it, and its name under it. With `efficacy` the
 * disc is a ring divided by what the papers found, clockwise from 12 o'clock; a treatment that has safety papers has a
 * ring around it and says so in words.
 */
export function EvidenceBubble({ id, name, papers, efficacy, newPapers = 0, safetyPapers = 0, pressed, onPick }: Props) {
  const radius = bubbleRadius(papers)
  const size = 2 * radius
  const slices = efficacy ? pieSlices(efficacy) : []
  // Every wedge is worked out before any element is built.
  let turned = 0
  const wedges = slices.length < 2 ? [] : slices.map((slice) => {
    const from = turned
    turned += slice.fraction
    return { kind: slice.kind, d: arcPath(radius, radius, radius, from, turned) }
  })
  const whole = slices.length === 1 ? slices[0].kind : null
  const plain = slices.length === 0
  return (
    <button type="button" data-bubble={id} aria-pressed={pressed} aria-label={E.bubbleLabel(name, papers, efficacy ?? null, newPapers, safetyPapers)} onClick={onPick}
      className="group flex max-w-[168px] flex-col items-center gap-1.5 rounded-card p-1 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink">
      <span className={pressed ? "block rounded-full outline-2 outline-offset-4 outline-accent-ink" : "block rounded-full outline-2 outline-offset-4 outline-transparent group-hover:outline-border-warm"}>
        <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block overflow-visible">
          {plain && <circle data-disc="true" cx={radius} cy={radius} r={radius - 0.5} fill={LIGHT_FILL} stroke={LIGHT_EDGE} strokeWidth={1} />}
          {whole && <circle data-slice={whole} cx={radius} cy={radius} r={radius} fill={KIND_COLOUR[whole]} />}
          {wedges.map((wedge) => <path key={wedge.kind} data-slice={wedge.kind} d={wedge.d} fill={KIND_COLOUR[wedge.kind]} />)}
          {!plain && <circle data-hole="true" cx={radius} cy={radius} r={radius * HOLE} fill={CENTRE_FILL} />}
          {safetyPapers > 0 && <circle data-safety-ring="true" cx={radius} cy={radius} r={radius + RING_GAP} fill="none" stroke={SAFETY_COLOUR} strokeWidth={2} />}
          <text data-number="true" x={radius} y={radius} textAnchor="middle" dominantBaseline="central" fontSize={radius < 30 ? 13 : 15} fontWeight={600} fill={NUMBER_COLOUR}>{papers}</text>
        </svg>
      </span>
      <span data-name="true" className={pressed ? "block text-[13px] font-semibold leading-tight text-espresso" : "block text-[13px] leading-tight text-secondary-dark"}>{name}</span>
      {newPapers > 0 && <span data-new="true" className="block text-[12px] font-semibold leading-tight text-accent-ink">{E.newCount(newPapers)}</span>}
      {safetyPapers > 0 && <span data-safety-mark="true" className="block text-[12px] font-semibold leading-tight" style={{ color: SAFETY_COLOUR }}>{E.safetyMark(safetyPapers)}</span>}
    </button>
  )
}
