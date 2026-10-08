import type { Efficacy } from "@/lib/clinical/evidence/build"

// The geometry and the colours of the evidence summary's drawings. Pure: no component, no wording.

/** The directions a pie is divided by, in the order they are drawn from 12 o'clock. */
export const EFFICACY_KINDS = ["benefit", "no-benefit", "mixed"] as const
export type EfficacyKind = (typeof EFFICACY_KINDS)[number]
type Kind = EfficacyKind | "safety" | "other"

/** Mixed is the muted text colour, thinned: it says neither of the other two. */
const MIXED_FILL = "color-mix(in srgb, var(--text-muted) 55%, transparent)"
export const SAFETY_COLOUR = "var(--viz-cat-3)"
export const KIND_COLOUR: Record<EfficacyKind, string> = { benefit: "var(--clinical-benefit)", "no-benefit": "var(--clinical-no-benefit)", mixed: MIXED_FILL }
/**
 * The colour of a direction's name in text: the thinned fill of a neutral kind would not be read, and the violet of
 * safety has too little contrast as text, so that word is in the colour of text and the violet stays on the ring.
 */
export const KIND_TEXT_COLOUR: Record<Kind, string> = { ...KIND_COLOUR, mixed: "var(--text-muted)", safety: "var(--text-primary)", other: "var(--text-muted)" }
/** The disc of a bubble that has no direction: the accent, as light as a badge's ground. */
export const LIGHT_FILL = "color-mix(in srgb, var(--accent) 18%, transparent)"
export const LIGHT_EDGE = "color-mix(in srgb, var(--accent) 45%, transparent)"
/** The centre of a pie, where its number is read, and the number. */
export const CENTRE_FILL = "var(--surface-light)"
export const NUMBER_COLOUR = "var(--text-primary)"

const MAX_BUBBLE = 72
const MAX_DOT = 16
const UNKNOWN_DOT = 5
const tenth = (value: number) => Number(value.toFixed(1))
const hundredth = (value: number) => Number(value.toFixed(2))

/** The radius of a bubble in px: 27 for one paper, 36 for four, never over 72. Its area does not grow as fast as its papers past the cap. */
export const bubbleRadius = (papers: number): number => tenth(Math.min(MAX_BUBBLE, 18 + 9 * Math.sqrt(Math.max(0, papers))))

/** The radius of a study's dot in px, by its participants: never over 16, and 5 when they are not known. */
export const dotRadius = (size: number | null): number => (size === null ? UNKNOWN_DOT : tenth(Math.min(MAX_DOT, 5 + 3.6 * Math.log10(Math.max(0, size) + 1))))

export interface Slice { kind: EfficacyKind; fraction: number }

/** The parts of a pie: the share of each direction that has a paper, in the order benefit, no benefit, mixed. */
export function pieSlices(efficacy: Efficacy): Slice[] {
  const whole = EFFICACY_KINDS.reduce((sum, kind) => sum + efficacy[kind], 0)
  return EFFICACY_KINDS.filter((kind) => efficacy[kind] > 0).map((kind) => ({ kind, fraction: efficacy[kind] / whole }))
}

/**
 * The wedge of a circle of radius `r` around (`cx`, `cy`) between two fractions of a turn, clockwise from 12 o'clock,
 * as an SVG path. A whole turn has no wedge: it is drawn as a circle.
 */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (fraction: number) => {
    const angle = 2 * Math.PI * fraction
    return [hundredth(cx + r * Math.sin(angle)), hundredth(cy - r * Math.cos(angle))]
  }
  const [startX, startY] = point(from)
  const [endX, endY] = point(to)
  const large = to - from > 0.5 ? 1 : 0
  return `M ${cx} ${cy} L ${startX} ${startY} A ${r} ${r} 0 ${large} 1 ${endX} ${endY} Z`
}
