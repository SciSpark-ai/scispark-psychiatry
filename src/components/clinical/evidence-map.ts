// Where the bubbles of the map of treatments go. Pure: no component, no wording, no clock, and the same places for
// the same items.

export interface MapItem {
  key: string; name: string; papers: number
  /** The participants its papers state, added up; null when none states any. */
  participants: number | null
  /** The publication dates of its papers, as they are printed: a day, a month or a year. A paper with none adds none. */
  dates: string[]
  /** The line of marks under its name, when it has one: it makes the name's box taller and maybe wider. */
  marks?: string
}
export interface MapSize { width: number; height: number }
export interface Placed {
  key: string; x: number; y: number; r: number; labelAbove: boolean
  /** Where it belongs by the scales. Its `y` may differ from this one's; its `x` does only when it is `displaced`. */
  home: { x: number; y: number }
  /** It could not stay at its own date: a line is drawn from it to where it belongs. */
  displaced: boolean
  /** The x of its earliest paper, when it has papers of more than one date: a line reaches back to it. */
  earliestX: number | null
}
export interface Box { left: number; right: number; top: number; bottom: number }
export interface MapScales {
  /** The box the bubbles stay in. */
  plot: Box
  /** The column of the items none of whose papers has a date; null when every item has one. */
  column: { left: number; right: number } | null
  /** The band of the items that state no participants, and the height its bubbles are at; null when every item states them. */
  band: { top: number; bottom: number } | null
  bandY: number | null
  /** The days the x scale runs over, counted from 1970, and where its ends are drawn. */
  days: { from: number; to: number }
  x0: number; x1: number
  /** A tick a month (`month` 1 to 12) or a year (`month` null); `labelled` where there is room for its name. */
  ticksX: { x: number; year: number; month: number | null; labelled: boolean }[]
  /** The participants the y scale runs over, a tick per power of ten, and where 10, the middle and the top are drawn. */
  participants: { min: number; max: number }
  ticksY: { value: number; y: number }[]
  yTop: number; yMiddle: number; yBottom: number
}

/** The picture the places are worked out in. It is drawn at any width, in this proportion. */
export const MAP_SIZE: MapSize = { width: 680, height: 400 }
const [MIN_RADIUS, MAX_RADIUS] = [18, 40]
/** The least clear space between two bubbles. */
const GAP = 6
const STEP = 4
const [GUTTER, RIGHT, TOP, FOOT, COLUMN] = [60, 8, 12, 24, 88]
/** The least room kept right of the newest date, so that the name of a bubble there stays by the picture. */
const RIGHT_ROOM = 44
/** How far up or down a bubble is moved before it is moved sideways, as a share of the height of the scale's part of the plot. */
const Y_REACH = 0.25
/** The room kept under the lowest bubble for its name, and the size of a name's box. */
const LABEL_ROOM = 34
const [LABEL_WIDTH, LABEL_OFFSET, CHAR, MARK_CHAR, NAME_LINE, MARKS_LINE] = [96, 3, 6.2, 5.6, 15, 14]
/** What the band has over the height of its largest bubble: a little above it, and a name of two lines with its marks under it. */
const BAND_ROOM = 52
const MIN_DOMAIN = 1000
const [MIN_DAYS, MONTHLY_DAYS, MONTH_LABEL, YEAR_LABEL] = [90, 548, 58, 36]
const DAY = 86400000
const tenth = (value: number) => Number(value.toFixed(1))
const dayAt = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day) / DAY

/** The radius of a bubble of the map in px: 18 for one paper, 24 for four, never over 40. */
export const mapRadius = (papers: number): number => tenth(Math.min(MAX_RADIUS, 12 + 6 * Math.sqrt(Math.max(0, papers))))

export interface DateParts { year: number; month: number | null; day: number | null }
/** The year of a date as a paper prints it, with its month and its day when it has them. Null for anything that is not a day, a month or a year. */
export function dateParts(date: string): DateParts | null {
  const parts = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date)
  if (!parts) return null
  const [year, month, day] = [Number(parts[1]), parts[2] ? Number(parts[2]) : null, parts[3] ? Number(parts[3]) : null]
  if (month !== null && (month < 1 || month > 12)) return null
  if (day !== null && (day < 1 || day > 31)) return null
  return { year, month, day }
}

/** The day of such a date, counted from 1970: a day is that day, a month its 15th, a year its first of July. */
export function dayOf(date: string): number | null {
  const parts = dateParts(date)
  if (!parts) return null
  return parts.month === null ? dayAt(parts.year, 7, 1) : dayAt(parts.year, parts.month, parts.day ?? 15)
}

/** The newest of `dates`, as it is printed; null when none of them is a date. */
export function newestDate(dates: string[]): string | null {
  let newest: { date: string; day: number } | null = null
  for (const date of dates) {
    const day = dayOf(date)
    if (day !== null && (newest === null || day > newest.day)) newest = { date, day }
  }
  return newest?.date ?? null
}

const daysOf = (item: MapItem): number[] => item.dates.map(dayOf).filter((day): day is number => day !== null)

/**
 * The scales of a map of `items` on the day `today`: across, time, from the earliest paper of them all to today and
 * over ninety days at least; up, the participants, from 10 to the next power of ten at or above the largest, on a log
 * scale. An item with no date has a column at the left, and one that states no participants a band along the bottom.
 */
export function mapScales(items: MapItem[], size: MapSize, today: string): MapScales {
  const plot = { left: GUTTER, right: size.width - RIGHT, top: TOP, bottom: size.height - FOOT }
  const radius = Math.max(MIN_RADIUS, ...items.map((item) => mapRadius(item.papers)))
  const dated = items.map(daysOf)
  const column = dated.some((days) => days.length === 0) ? { left: plot.left, right: plot.left + COLUMN } : null
  const unstated = items.filter((item) => item.participants === null).map((item) => mapRadius(item.papers))
  const band = unstated.length > 0 ? { top: plot.bottom - 2 * Math.max(...unstated) - BAND_ROOM, bottom: plot.bottom } : null
  const bandY = band ? band.top + 4 + Math.max(...unstated) : null

  const all = dated.flat()
  const now = dayOf(today) ?? Math.max(0, ...all)
  const to = Math.max(now, ...all)
  const from = Math.min(to - MIN_DAYS, ...all)
  const x0 = (column ? column.right : plot.left) + radius + 4
  const x1 = plot.right - Math.max(radius, RIGHT_ROOM)
  const xOf = (day: number) => x0 + ((day - from) / (to - from)) * (x1 - x0)
  const monthly = to - from <= MONTHLY_DAYS
  const [first, last] = [new Date(from * DAY), new Date(to * DAY)]
  const starts: { year: number; month: number | null; day: number }[] = []
  for (let year = first.getUTCFullYear(); year <= last.getUTCFullYear(); year += 1) {
    for (const month of monthly ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1]) {
      const day = dayAt(year, month, 1)
      if (day >= from && day <= to) starts.push({ year, month: monthly ? month : null, day })
    }
  }
  const apart = starts.length > 1 ? xOf(starts[1].day) - xOf(starts[0].day) : Infinity
  const every = Math.max(1, Math.ceil((monthly ? MONTH_LABEL : YEAR_LABEL) / apart))
  const ticksX = starts.map((start, at) => ({ x: xOf(start.day), year: start.year, month: start.month, labelled: at % every === 0 }))

  const largest = Math.max(0, ...items.map((item) => item.participants ?? 0))
  let max = MIN_DOMAIN
  while (max < largest) max *= 10
  const yTop = plot.top + radius + 4
  const yBottom = (band ? band.top : plot.bottom) - radius - LABEL_ROOM
  const decades = Math.round(Math.log10(max)) - 1
  const ticksY = Array.from({ length: decades + 1 }, (_, at) => ({ value: 10 ** (at + 1), y: yBottom - (at / decades) * (yBottom - yTop) }))
  return { plot, column, band, bandY, days: { from, to }, x0, x1, ticksX, participants: { min: 10, max }, ticksY, yTop, yMiddle: (yTop + yBottom) / 2, yBottom }
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
 * The place of every item. Across it is at the date of its newest paper, and stays there: an item whose own place is
 * taken is moved up or down (up, then down, in small steps), within a quarter of the height of the scale. Only when
 * nothing is free there is it moved sideways, to the nearest free place, and it is then `displaced`. An item that states
 * no participants is in the band, which is one row high, so it is moved sideways at once. An item with no date is in
 * the column: it has no place across to keep, and is moved up or down as far as it takes. Larger bubbles are placed
 * first, so the small ones move. A name goes under its bubble, or above it when a bubble or a name already placed is
 * in the way there; a place where the name fits neither way, or where the bubble would cover a name, is not free
 * while another is. The places are returned in the order of `items`.
 */
export function layoutMap(items: MapItem[], size: MapSize, today: string): Placed[] {
  const { plot, column, band, bandY, days, x0, x1, participants, yTop, yBottom } = mapScales(items, size, today)
  const xOf = (day: number) => x0 + ((day - days.from) / (days.to - days.from)) * (x1 - x0)
  const span = Math.log10(participants.max) - 1
  const scaleBottom = band ? band.top : plot.bottom
  const order = [...items].sort((a, b) => b.papers - a.papers || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const placed: Placed[] = []
  const names: Box[] = []
  for (const item of order) {
    const r = mapRadius(item.papers)
    const dated = daysOf(item)
    const inColumn = dated.length === 0 && column !== null
    const inBand = item.participants === null && band !== null && bandY !== null
    const xs: Range = inColumn ? { low: column.left + r + 2, high: column.right - r - 2 } : { low: (column ? column.right : plot.left) + r + 2, high: plot.right - r }
    const ys: Range = inBand ? { low: bandY, high: bandY } : { low: plot.top + r, high: scaleBottom - r - 2 }
    const [newest, earliest] = [Math.max(...dated), Math.min(...dated)]
    const home: Spot = {
      x: clamp(inColumn ? (column.left + column.right) / 2 : xOf(newest), xs),
      y: inBand ? bandY : clamp(yBottom - ((Math.log10(Math.max(participants.min, item.participants ?? participants.min)) - 1) / span) * (yBottom - yTop), ys),
    }
    const clearance = (spot: Spot) => Math.min(Infinity, ...placed.map((other) => Math.hypot(spot.x - other.x, spot.y - other.y) - other.r - r - GAP))
    const nameFree = (box: Box) => box.top >= 0 && box.bottom <= plot.bottom && !names.some((name) => boxesMeet(box, name)) && !placed.some((other) => discMeetsBox(other, other.r, box))
    /** Whether the name goes above at `spot`, or null when the bubble or its name would be on something there. */
    const nameSide = (spot: Spot): boolean | null => {
      if (names.some((name) => discMeetsBox(spot, r, name))) return null
      const { under, above } = nameBoxes(item, spot, r)
      return nameFree(under) ? false : nameFree(above) ? true : null
    }
    // Its own date first, up and down. Then, of the places sideways within the same reach up and down, the nearest.
    // A place is one where the bubble and its name are clear; failing any, where the bubble is; failing that, the clearest.
    const reach = inBand ? 0 : inColumn ? size.height : Y_REACH * (scaleBottom - plot.top)
    let clear: Spot | null = null
    let clearest = { spot: home, by: clearance(home) }
    let found: { spot: Spot; above: boolean; far: number } | null = null
    for (const dx of offsets(1, size.width)) {
      if (found !== null && (found.spot.x === home.x || Math.abs(dx) >= found.far)) break
      const x = home.x + dx
      if (!within(x, xs)) continue
      for (const dy of offsets(-1, reach)) {
        const far = Math.hypot(dx, dy)
        if (found !== null && far >= found.far) continue
        const spot = { x, y: home.y + dy }
        if (!within(spot.y, ys)) continue
        const by = clearance(spot)
        if (by > clearest.by) clearest = { spot, by }
        if (by < 0) continue
        clear ??= spot
        const above = nameSide(spot)
        if (above === null) continue
        found = { spot, above, far }
        if (dx === 0) break
      }
    }
    const at = found?.spot ?? clear ?? clearest.spot
    const labelAbove = found?.above ?? false
    placed.push({ key: item.key, x: at.x, y: at.y, r, labelAbove, home, displaced: !inColumn && at.x !== home.x, earliestX: dated.length > 0 && earliest < newest ? xOf(earliest) : null })
    const boxes = nameBoxes(item, at, r)
    names.push(labelAbove ? boxes.above : boxes.under)
  }
  const byKey = new Map(placed.map((entry) => [entry.key, entry]))
  return items.map((item) => byKey.get(item.key)!)
}
