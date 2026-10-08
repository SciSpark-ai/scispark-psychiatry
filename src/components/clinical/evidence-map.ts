import type { Efficacy } from "@/lib/clinical/evidence/build"

// Where the bubbles of the map of treatments go. Pure: no component, no wording, and the same places for the same items.

export interface MapItem {
  key: string; name: string; papers: number
  /** The share of its papers that report benefit, 0 to 1. */
  share: number
  /** The participants its papers state, added up; null when none states any. */
  participants: number | null
  /** The line of marks under its name, when it has one: it makes the name's box taller and maybe wider. */
  marks?: string
}
export interface MapSize { width: number; height: number }
export interface Placed {
  key: string; x: number; y: number; r: number; labelAbove: boolean
  /** Where it belongs by the scales. Its `x` may differ from this one's; its `y` does only when it is `displaced`. */
  home: { x: number; y: number }
  /** It could not stay at its own height: a line is drawn from it to where it belongs. */
  displaced: boolean
}
export interface Box { left: number; right: number; top: number; bottom: number }
export interface MapScales {
  /** The box the bubbles stay in. */
  plot: Box
  /** The shaded column of the items that state no participants; null when every item states them. */
  column: { left: number; right: number } | null
  domain: { min: number; max: number }
  /** Where 10 and the top of the domain are drawn, and a tick per power of ten between them. */
  x0: number; x1: number
  ticks: { value: number; x: number }[]
  /** Where a share of 1, of a half and of 0 are drawn. */
  yTop: number; yMiddle: number; yBottom: number
}

/** The picture the places are worked out in. It is drawn at any width, in this proportion. */
export const MAP_SIZE: MapSize = { width: 680, height: 350 }
const MAX_RADIUS = 40
/** The least clear space between two bubbles. */
const GAP = 6
const STEP = 4
const [GUTTER, RIGHT, TOP, FOOT] = [74, 8, 16, 24]
/** The share of the plot's width the column of items that state no participants takes: room for four small bubbles side by side. */
const COLUMN_SHARE = 0.29
/** How far sideways a bubble of the scaled part is moved before it is moved up or down, as a share of the plot's width. */
const X_REACH = 0.25
/** Half the least distance between two small bubbles: the items of the column start this far left of its middle when they are not one or three. */
const HALF_PITCH = 22
/** The room kept under the lowest bubble for its name, and the size of a name's box. */
const LABEL_ROOM = 34
const [LABEL_WIDTH, LABEL_OFFSET, CHAR, MARK_CHAR, NAME_LINE, MARKS_LINE] = [96, 3, 6.2, 5.6, 15, 14]
const MIN_DOMAIN = 1000
const tenth = (value: number) => Number(value.toFixed(1))

/** The radius of a bubble of the map in px: 18 for one paper, 24 for four, never over 40. */
export const mapRadius = (papers: number): number => tenth(Math.min(MAX_RADIUS, 12 + 6 * Math.sqrt(Math.max(0, papers))))

/** Benefit and half of mixed, over the papers: 1 when all report benefit, 0 when none does, and the middle with no paper. */
export function benefitShare(efficacy: Efficacy, papers: number): number {
  if (papers <= 0) return 0.5
  return Math.min(1, Math.max(0, (efficacy.benefit + 0.5 * efficacy.mixed) / papers))
}

/** The scales of a map of `items`: 10 to the next power of ten at or above the largest, on a log scale; share 1 at the top. */
export function mapScales(items: MapItem[], size: MapSize): MapScales {
  const plot = { left: GUTTER, right: size.width - RIGHT, top: TOP, bottom: size.height - FOOT }
  const column = items.some((item) => item.participants === null) ? { left: plot.left, right: plot.left + Math.round(COLUMN_SHARE * (plot.right - plot.left)) } : null
  const largest = Math.max(0, ...items.map((item) => item.participants ?? 0))
  let max = MIN_DOMAIN
  while (max < largest) max *= 10
  const x0 = (column ? column.right : plot.left) + MAX_RADIUS + 4
  const x1 = plot.right - MAX_RADIUS
  const decades = Math.round(Math.log10(max)) - 1
  const ticks = Array.from({ length: decades + 1 }, (_, at) => ({ value: 10 ** (at + 1), x: x0 + (at / decades) * (x1 - x0) }))
  const yTop = plot.top + MAX_RADIUS
  const yBottom = plot.bottom - LABEL_ROOM - MAX_RADIUS
  return { plot, column, domain: { min: 10, max }, x0, x1, ticks, yTop, yMiddle: (yTop + yBottom) / 2, yBottom }
}

interface Spot { x: number; y: number }
interface Range { low: number; high: number }
const within = (value: number, range: Range) => value >= range.low && value <= range.high
const clamp = (value: number, range: Range) => Math.min(range.high, Math.max(range.low, value))
/** 0, then a step one way and the same step the other, growing: -1, +1, -2, +2 … */
function* offsets(first: -1 | 1, reach: number): Generator<number> {
  yield 0
  for (let step = STEP; step <= reach; step += STEP) { yield first * step; yield -first * step }
}
const boxesMeet = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const discMeetsBox = (spot: Spot, r: number, box: Box) => Math.hypot(spot.x - clamp(spot.x, { low: box.left, high: box.right }), spot.y - clamp(spot.y, { low: box.top, high: box.bottom })) < r

/** The boxes the name of `item` would take under and above a bubble of radius `r` at `spot`. A name wraps at the width of a label; the marks are on one line. */
export function nameBoxes(item: MapItem, spot: Spot, r: number): { under: Box; above: Box } {
  const named = CHAR * item.name.length + 8
  const wide = Math.max(Math.min(LABEL_WIDTH, named), item.marks ? MARK_CHAR * item.marks.length + 8 : 0)
  const tall = (named > LABEL_WIDTH ? 2 : 1) * NAME_LINE + (item.marks ? MARKS_LINE : 0)
  const across = { left: spot.x - wide / 2, right: spot.x + wide / 2 }
  return {
    under: { ...across, top: spot.y + r + LABEL_OFFSET, bottom: spot.y + r + LABEL_OFFSET + tall },
    above: { ...across, top: spot.y - r - LABEL_OFFSET - tall, bottom: spot.y - r - LABEL_OFFSET },
  }
}

/**
 * The place of every item. Its height is its share of benefit, and stays so: an item whose own place is taken is moved
 * sideways (right, then left, in small steps), within a quarter of the plot's width for the scaled part and within the
 * column for an item that states no participants. Only when nothing is free on its line is it moved up or down, by
 * the least that fits, and it is then `displaced`. Larger bubbles are placed first, so the small ones move. A name
 * goes under its bubble, or above it when a bubble or a name already placed is in the way there; a place where the
 * name fits neither way, or where the bubble would cover a name, is not free while another is. The places are
 * returned in the order of `items`.
 */
export function layoutMap(items: MapItem[], size: MapSize): Placed[] {
  const { plot, column, domain, x0, x1, yTop, yBottom } = mapScales(items, size)
  const span = Math.log10(domain.max) - 1
  const order = [...items].sort((a, b) => b.papers - a.papers || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  // One item or three in the column start at its middle; any other number starts half a step left of it, so that two
  // sit evenly and four fit on a line.
  const unstated = items.filter((item) => item.participants === null).length
  const columnStart = column ? (column.left + column.right) / 2 - (unstated === 1 || unstated === 3 ? 0 : HALF_PITCH) : 0
  const placed: Placed[] = []
  const names: Box[] = []
  for (const item of order) {
    const r = mapRadius(item.papers)
    const inColumn = item.participants === null && column !== null
    const xs: Range = inColumn ? { low: column.left + r + 2, high: column.right - r - 2 } : { low: (column ? column.right : plot.left) + r + 2, high: plot.right - r }
    const ys: Range = { low: plot.top + r, high: plot.bottom - LABEL_ROOM - r }
    const reach = inColumn ? column.right - column.left : X_REACH * (plot.right - plot.left)
    const home: Spot = {
      x: clamp(inColumn ? columnStart : x0 + ((Math.log10(Math.max(domain.min, item.participants ?? domain.min)) - 1) / span) * (x1 - x0), xs),
      y: clamp(yTop + (1 - item.share) * (yBottom - yTop), ys),
    }
    const clearance = (spot: Spot) => Math.min(Infinity, ...placed.map((other) => Math.hypot(spot.x - other.x, spot.y - other.y) - other.r - r - GAP))
    const nameFree = (box: Box) => box.top >= 0 && !names.some((name) => boxesMeet(box, name)) && !placed.some((other) => discMeetsBox(other, other.r, box))
    /** Whether the name goes above at `spot`, or null when the bubble or its name would be on something there. */
    const nameSide = (spot: Spot): boolean | null => {
      if (names.some((name) => discMeetsBox(spot, r, name))) return null
      const { under, above } = nameBoxes(item, spot, r)
      return nameFree(under) ? false : nameFree(above) ? true : null
    }
    // Its own line first, sideways; then the nearest line with room. The first place where the bubble and its name are
    // clear; failing that, where the bubble is; failing that, the clearest.
    let clear: Spot | null = null
    let clearest = { spot: home, by: clearance(home) }
    let found: { spot: Spot; above: boolean } | null = null
    search: for (const dy of offsets(-1, size.height)) {
      const y = home.y + dy
      if (!within(y, ys)) continue
      for (const dx of offsets(1, reach)) {
        const spot = { x: home.x + dx, y }
        if (!within(spot.x, xs)) continue
        const by = clearance(spot)
        if (by > clearest.by) clearest = { spot, by }
        if (by < 0) continue
        clear ??= spot
        const above = nameSide(spot)
        if (above !== null) { found = { spot, above }; break search }
      }
    }
    const at = found?.spot ?? clear ?? clearest.spot
    const labelAbove = found?.above ?? false
    placed.push({ key: item.key, x: at.x, y: at.y, r, labelAbove, home, displaced: at.y !== home.y })
    const boxes = nameBoxes(item, at, r)
    names.push(labelAbove ? boxes.above : boxes.under)
  }
  const byKey = new Map(placed.map((entry) => [entry.key, entry]))
  return items.map((item) => byKey.get(item.key)!)
}
