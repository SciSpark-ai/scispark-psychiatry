// Where the bubbles of the map of treatments go. Pure: no component, no wording, no clock (it does not know what day
// it is), and the same places for the same items.

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
  /** How far its name is shifted sideways from under its middle, in px, to stay inside the plot. 0 for most. */
  labelShift: number
  /** Where it belongs by the scales. */
  home: { x: number; y: number }
  /** It was moved from there by more than its radius, up or down or sideways: a line is drawn from it to where it belongs. */
  displaced: boolean
}
export interface Box { left: number; right: number; top: number; bottom: number }
export interface MapScales {
  /** The frame of the plot, as it is drawn. */
  plot: Box
  /** The part of it the bubbles and their names stay in: the plot less a clear space inside its frame. */
  inset: Box
  /** The column of the items none of whose papers has a date; null when every item has one. */
  column: { left: number; right: number } | null
  /** The band of the items that state no participants, and the height its bubbles are at; null when every item states them. */
  band: { top: number; bottom: number } | null
  bandY: number | null
  /** The days the x scale runs over, counted from 1970, and where its ends are drawn. */
  days: { from: number; to: number }
  x0: number; x1: number
  /** A tick a week (`day` is the Monday it is on), a month (`month` 1 to 12, `day` null) or a year (`month` null); `labelled` where there is room for its name. */
  ticksX: { x: number; year: number; month: number | null; day: number | null; labelled: boolean }[]
  /** The participants the y scale runs over, a tick per power of ten, and where 10, the middle and the top are drawn. */
  participants: { min: number; max: number }
  ticksY: { value: number; y: number }[]
  yTop: number; yMiddle: number; yBottom: number
}

/** The height of the picture as a share of its width, the least and the most it is, and the least width it is worked out for. */
const [HEIGHT_SHARE, MIN_HEIGHT, MAX_HEIGHT, MIN_WIDTH] = [0.6, 380, 520, 320]
/**
 * The picture for a width in px: as wide as what it is in, and about 0.6 of that high, never under 380 px and never
 * over 520. The places are worked out for this size and drawn in it as they are: a bubble and a letter keep their size.
 */
export function mapSizeFor(width: number): MapSize {
  const wide = Math.max(MIN_WIDTH, Math.round(width))
  return { width: wide, height: Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, HEIGHT_SHARE * wide))) }
}
/** The width the picture is drawn for until its own is measured, and where there is nothing to measure; and its size. */
export const DEFAULT_MAP_WIDTH = 720
export const MAP_SIZE: MapSize = mapSizeFor(DEFAULT_MAP_WIDTH)
const [MIN_RADIUS, MAX_RADIUS] = [18, 40]
/** The least clear space between two bubbles. */
const GAP = 6
const STEP = 2
/** Around the plot: at the left the title of the y axis, turned, and the names of its ticks; under it the names of the ticks of the x axis. */
const [GUTTER, RIGHT, TOP, FOOT, COLUMN] = [84, 8, 8, 28, 96]
/** The clear space kept inside the frame of the plot: no bubble and no name is nearer to an edge of it. */
export const INSET = 16
/** How far a bubble is moved up or down first, as a share of the height of the scale's part of the plot; then sideways, as a share of the plot's width. */
const [Y_REACH, X_REACH] = [0.12, 0.06]
/** The room kept under the lowest bubble for its name, and the size of a name's box. */
const LABEL_ROOM = 40
/** A name is written in 14 px and its marks in 12 px. */
const [LABEL_WIDTH, LABEL_OFFSET, CHAR, MARK_CHAR, NAME_LINE, MARKS_LINE] = [120, 3, 7.3, 6.1, 18, 16]
/** What the band has over the height of its largest bubble: a little above it, and a name of two lines with its marks under it. */
const BAND_HEAD = 4
const BAND_ROOM = BAND_HEAD + LABEL_OFFSET + 2 * NAME_LINE + MARKS_LINE
const MIN_DOMAIN = 1000
/** The share of the days between the first and the last bubble that is kept free at each end of the time scale, and the least days it covers. */
const [PADDING, MIN_DAYS] = [0.08, 21]
/** Up to this many days the scale has a tick a week, and up to this many a tick a month. */
const [WEEKLY_DAYS, MONTHLY_DAYS] = [70, 548]
/** The width of the name of a tick, and the least clear space between two. */
const TICK_NAME = { week: 44, month: 60, year: 32 }
const TICK_GAP = 8
/** 1970-01-01 was a Thursday: the days that are Mondays leave this over when divided by seven. */
const MONDAY = 4
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
 * The scales of a map of `items`: across, time, over the bubbles that are shown and no more: from the earliest to the
 * latest of the newest papers of the items, with a little more at each end and twenty-one days at least, the bubbles
 * in the middle of them; up, the participants, from 10 to the next power of ten at or above the largest, on a log
 * scale. An item with no date has a column at the left, and one that states no participants a band along the bottom.
 * Both scales end short of the frame of the plot, by the clear space kept inside it.
 */
export function mapScales(items: MapItem[], size: MapSize): MapScales {
  const plot = { left: GUTTER, right: size.width - RIGHT, top: TOP, bottom: size.height - FOOT }
  const inset = { left: plot.left + INSET, right: plot.right - INSET, top: plot.top + INSET, bottom: plot.bottom - INSET }
  const radius = Math.max(MIN_RADIUS, ...items.map((item) => mapRadius(item.papers)))
  const dated = items.map(daysOf)
  const column = dated.some((days) => days.length === 0) ? { left: plot.left, right: plot.left + COLUMN } : null
  const unstated = items.filter((item) => item.participants === null).map((item) => mapRadius(item.papers))
  const band = unstated.length > 0 ? { top: inset.bottom - 2 * Math.max(...unstated) - BAND_ROOM, bottom: plot.bottom } : null
  const bandY = band ? band.top + BAND_HEAD + Math.max(...unstated) : null

  // Where the bubbles are: each at the newest of its papers.
  const shown = dated.filter((days) => days.length > 0).map((days) => Math.max(...days))
  const [earliest, latest] = shown.length > 0 ? [Math.min(...shown), Math.max(...shown)] : [0, 0]
  const covered = Math.max(MIN_DAYS, (1 + 2 * PADDING) * (latest - earliest))
  const from = (earliest + latest) / 2 - covered / 2
  const to = from + covered
  const x0 = (column ? column.right : plot.left) + INSET
  const x1 = inset.right
  const xOf = (day: number) => x0 + ((day - from) / covered) * (x1 - x0)
  const every: keyof typeof TICK_NAME = covered <= WEEKLY_DAYS ? "week" : covered <= MONTHLY_DAYS ? "month" : "year"
  const starts: { year: number; month: number | null; day: number | null; at: number }[] = []
  if (shown.length > 0 && every === "week") {
    for (let at = Math.ceil(from); at <= to; at += 1) {
      if (at % 7 !== MONDAY) continue
      const date = new Date(at * DAY)
      starts.push({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), at })
    }
  } else if (shown.length > 0) {
    for (let year = new Date(from * DAY).getUTCFullYear(); year <= new Date(to * DAY).getUTCFullYear(); year += 1) {
      for (const month of every === "month" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1]) {
        const at = dayAt(year, month, 1)
        if (at >= from && at <= to) starts.push({ year, month: every === "month" ? month : null, day: null, at })
      }
    }
  }
  // A name every so many ticks, from the first that is clear of the column: no two touch, and none runs out of the picture.
  const half = TICK_NAME[every] / 2
  const fits = (x: number) => x - half >= (column ? column.right : 0) && x + half <= size.width
  const apart = starts.length > 1 ? xOf(starts[1].at) - xOf(starts[0].at) : Infinity
  const stride = Math.max(1, Math.ceil((TICK_NAME[every] + TICK_GAP) / apart))
  const first = starts.findIndex((start) => fits(xOf(start.at)))
  const ticksX = starts.map((start, at) => {
    const x = xOf(start.at)
    return { x, year: start.year, month: start.month, day: start.day, labelled: first >= 0 && at >= first && (at - first) % stride === 0 && fits(x) }
  })

  const largest = Math.max(0, ...items.map((item) => item.participants ?? 0))
  let max = MIN_DOMAIN
  while (max < largest) max *= 10
  const yTop = inset.top + radius
  const yBottom = (band ? band.top : inset.bottom) - radius - LABEL_ROOM
  const decades = Math.round(Math.log10(max)) - 1
  const ticksY = Array.from({ length: decades + 1 }, (_, at) => ({ value: 10 ** (at + 1), y: yBottom - (at / decades) * (yBottom - yTop) }))
  return { plot, inset, column, band, bandY, days: { from, to }, x0, x1, ticksX, participants: { min: 10, max }, ticksY, yTop, yMiddle: (yTop + yBottom) / 2, yBottom }
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

/**
 * The boxes the name of `item` would take under and above a bubble of radius `r` at `spot`, and how far they are
 * shifted sideways to stay between `limits`. A name wraps at the width of a label; the marks are on one line.
 */
export function nameBoxes(item: MapItem, spot: Spot, r: number, limits: { left: number; right: number }): { under: Box; above: Box; shift: number } {
  const named = CHAR * item.name.length + 8
  const wide = Math.max(Math.min(LABEL_WIDTH, named), item.marks ? MARK_CHAR * item.marks.length + 8 : 0)
  const tall = (named > LABEL_WIDTH ? 2 : 1) * NAME_LINE + (item.marks ? MARKS_LINE : 0)
  const centred = { left: spot.x - wide / 2, right: spot.x + wide / 2 }
  let across = centred
  if (limits.right < centred.right) across = { left: limits.right - wide, right: limits.right }
  else if (centred.left < limits.left) across = { left: limits.left, right: limits.left + wide }
  return {
    under: { ...across, top: spot.y + r + LABEL_OFFSET, bottom: spot.y + r + LABEL_OFFSET + tall },
    above: { ...across, top: spot.y - r - LABEL_OFFSET - tall, bottom: spot.y - r - LABEL_OFFSET },
    shift: tenth(across.left - centred.left),
  }
}

/**
 * The place of every item: across, the date of its newest paper; up, its participants. An item whose own place is
 * taken is moved by the least that fits: first up or down (up, then down, in small steps) within an eighth of the
 * height of the scale, then sideways within a little of the plot's width, and failing both to the nearest free place
 * there is. One moved by more than its radius is `displaced`. An item that states no participants is in the band,
 * which is one row high, and moves sideways only; one with no date stays in the column. Larger bubbles are placed
 * first, so the small ones move. A name goes under its bubble, or above it when a bubble or a name already placed is
 * in the way there, and is shifted sideways to stay clear of the frame; a place where the name fits neither way, or where the
 * bubble would cover a name, is not free while another is. No bubble and no name is on the clear space inside the
 * frame of the plot. The places are returned in the order of `items`.
 */
export function layoutMap(items: MapItem[], size: MapSize): Placed[] {
  const { inset, column, band, bandY, days, x0, x1, participants, yTop, yBottom } = mapScales(items, size)
  const xOf = (day: number) => x0 + ((day - days.from) / (days.to - days.from)) * (x1 - x0)
  const span = Math.log10(participants.max) - 1
  const scaleBottom = band ? band.top - 2 : inset.bottom
  const order = [...items].sort((a, b) => b.papers - a.papers || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const placed: Placed[] = []
  const names: Box[] = []
  for (const item of order) {
    const r = mapRadius(item.papers)
    const dated = daysOf(item)
    const inColumn = dated.length === 0 && column !== null
    const inBand = item.participants === null && band !== null && bandY !== null
    const xs: Range = inColumn ? { low: inset.left + r, high: column.right - r } : { low: x0 + r, high: x1 - r }
    const ys: Range = inBand ? { low: bandY, high: bandY } : { low: inset.top + r, high: scaleBottom - r }
    const newest = Math.max(...dated)
    const home: Spot = {
      x: clamp(inColumn ? (column.left + column.right) / 2 : xOf(newest), xs),
      y: inBand ? bandY : clamp(yBottom - ((Math.log10(Math.max(participants.min, item.participants ?? participants.min)) - 1) / span) * (yBottom - yTop), ys),
    }
    const clearance = (spot: Spot) => Math.min(Infinity, ...placed.map((other) => Math.hypot(spot.x - other.x, spot.y - other.y) - other.r - r - GAP))
    const inFrame = (box: Box) => box.top >= inset.top && box.bottom <= inset.bottom
    const nameFree = (box: Box) => inFrame(box) && !names.some((name) => boxesMeet(box, name)) && !placed.some((other) => discMeetsBox(other, other.r, box))
    // Where the bubble is clear of the others, failing a place where its name is too; and the clearest, failing that.
    let clear: Spot | null = null
    let clearest = { spot: home, by: clearance(home) }
    /** Whether the name goes above at `spot`, or null when the place is not free: out of bounds, or the bubble or its name on something. */
    const sideAt = (spot: Spot): boolean | null => {
      if (!within(spot.x, xs) || !within(spot.y, ys)) return null
      const by = clearance(spot)
      if (by > clearest.by) clearest = { spot, by }
      if (by < 0) return null
      clear ??= spot
      if (names.some((name) => discMeetsBox(spot, r, name))) return null
      const { under, above } = nameBoxes(item, spot, r, inset)
      return nameFree(under) ? false : nameFree(above) ? true : null
    }
    let found: { spot: Spot; above: boolean } | null = null
    const firstOf = (spots: Spot[]) => {
      for (const spot of spots) {
        if (found !== null) return
        const above = sideAt(spot)
        if (above !== null) found = { spot, above }
      }
    }
    /** The nearest free place no further than `reachX` sideways and `reachY` up or down. */
    const nearestIn = (reachX: number, reachY: number) => {
      let nearest = Infinity
      for (const dx of offsets(1, reachX)) {
        if (Math.abs(dx) >= nearest) break
        for (const dy of offsets(-1, reachY)) {
          if (Math.abs(dy) >= nearest) break
          const far = Math.hypot(dx, dy)
          if (far >= nearest) continue
          const spot = { x: home.x + dx, y: home.y + dy }
          const above = sideAt(spot)
          if (above !== null) { found = { spot, above }; nearest = far }
        }
      }
    }
    const upOrDown = (reach: number) => [...offsets(-1, reach)].map((dy) => ({ x: home.x, y: home.y + dy }))
    const sideways = (reach: number) => [...offsets(1, reach)].map((dx) => ({ x: home.x + dx, y: home.y }))
    // No further than its own radius, which needs no line: up or down, then sideways, then both at once.
    firstOf([...upOrDown(r), ...sideways(r)])
    if (found === null) nearestIn(r, r)
    // Further: up or down, then sideways, within the reaches; and failing those, the nearest free place there is.
    if (found === null) firstOf([...upOrDown(inBand ? 0 : Y_REACH * (scaleBottom - inset.top)), ...sideways(X_REACH * (inset.right - inset.left))])
    if (found === null) nearestIn(size.width, size.height)
    const settled = found as { spot: Spot; above: boolean } | null
    const at = settled?.spot ?? clear ?? clearest.spot
    const boxes = nameBoxes(item, at, r, inset)
    // With no free place its name is still kept off the clear space, when one of the two sides is.
    const labelAbove = settled?.above ?? (!inFrame(boxes.under) && inFrame(boxes.above))
    placed.push({
      key: item.key, x: at.x, y: at.y, r, labelAbove, labelShift: boxes.shift, home,
      displaced: Math.abs(at.x - home.x) > r || Math.abs(at.y - home.y) > r,
    })
    names.push(labelAbove ? boxes.above : boxes.under)
  }
  const byKey = new Map(placed.map((entry) => [entry.key, entry]))
  return items.map((item) => byKey.get(item.key)!)
}
