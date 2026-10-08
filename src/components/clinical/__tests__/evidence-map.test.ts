import { describe, expect, it } from "vitest"
import { dayOf, INSET, layoutMap, mapRadius, mapScales, mapSizeFor, nameBoxes, newestDate, type Box, type MapItem, type Placed } from "../evidence-map"

const TODAY = "2026-10-08"
const DAY = 86400000
const utc = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day) / DAY
const item = (key: string, over: Partial<MapItem> = {}): MapItem => ({ key, name: key, papers: 1, participants: 100, dates: [TODAY], ...over })
const byKey = (placed: Placed[]) => new Map(placed.map((entry) => [entry.key, entry]))
// The layout takes any size. These cases were worked out in a picture of 720 by 460, and are kept in it.
const SIZE = { width: 720, height: 460 }
const scalesOf = (items: MapItem[]) => mapScales(items, SIZE)
const layout = (items: MapItem[]) => layoutMap(items, SIZE)
const xAt = (scales: ReturnType<typeof scalesOf>, day: number) => scales.x0 + ((day - scales.days.from) / (scales.days.to - scales.days.from)) * (scales.x1 - scales.x0)
const one = (over: Partial<MapItem>) => layout([item("a", over)])[0]
/** Every bubble in the part of the plot that is kept clear of its frame. */
const inside = (placed: Placed[], items: MapItem[]) => {
  const { inset } = scalesOf(items)
  return placed.every((entry) => entry.x - entry.r >= inset.left && entry.x + entry.r <= inset.right && entry.y - entry.r >= inset.top && entry.y + entry.r <= inset.bottom)
}
/** The box of the name of each bubble, where the layout put it. */
const nameBoxesOf = (placed: Placed[], items: MapItem[]): Box[] => {
  const { inset } = scalesOf(items)
  return placed.map((entry, at) => nameBoxes(items[at], entry, entry.r, inset)[entry.labelAbove ? "above" : "under"])
}
const namesInside = (placed: Placed[], items: MapItem[]) => {
  const { inset } = scalesOf(items)
  return nameBoxesOf(placed, items).every((box) => box.left >= inset.left && box.right <= inset.right && box.top >= inset.top && box.bottom <= inset.bottom)
}
/** Moved by more than its radius, up or down or sideways: what `displaced` must say. */
const far = (entry: Placed) => Math.abs(entry.x - entry.home.x) > entry.r || Math.abs(entry.y - entry.home.y) > entry.r
const overlaps = (placed: Placed[]) => placed.flatMap((a, at) => placed.slice(at + 1).filter((b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + 6 - 1e-9).map((b) => `${a.key}/${b.key}`))

describe("the map of the evidence summary", () => {
  it("sizes a bubble of the map by the square root of its papers, never over 40", () => {
    expect(mapRadius(1)).toBe(18)
    expect(mapRadius(4)).toBe(24)
    expect(mapRadius(9)).toBe(30)
    expect(mapRadius(25)).toBe(40)
    expect(mapRadius(400)).toBe(40)
  })

  it("reads a day as that day, a month as its 15th, a year as its first of July, and nothing else", () => {
    expect(dayOf("2026-09-28")).toBe(utc(2026, 9, 28))
    expect(dayOf("2026-09")).toBe(utc(2026, 9, 15))
    expect(dayOf("2026")).toBe(utc(2026, 7, 1))
    expect(dayOf("September 2026")).toBeNull()
    expect(dayOf("2026-13-01")).toBeNull()
    expect(dayOf("")).toBeNull()
  })

  it("takes the newest of an item's dates, as it is printed", () => {
    expect(newestDate(["2026-03", "2026-09-28", "2025"])).toBe("2026-09-28")
    expect(newestDate(["2026", "2026-03-01"])).toBe("2026")
    expect(newestDate(["soon", "2024-05"])).toBe("2024-05")
    expect(newestDate(["soon"])).toBeNull()
    expect(newestDate([])).toBeNull()
  })

  it("runs the x scale over the items shown only: from the earliest to the latest of their newest papers, with 8% of that more on each side", () => {
    // The earlier papers of an item are not on the map, so they do not widen it.
    const items = [item("a", { dates: ["2024-01-10", "2026-06-15", "2026-08"] }), item("b", { dates: ["2026-10-08"], participants: 1000 }), item("c", { dates: ["2026-03-10"], participants: 10 })]
    const scales = scalesOf(items)
    const [first, last] = [utc(2026, 3, 10), utc(2026, 10, 8)]
    expect(last - first).toBe(212)
    expect(scales.days.from).toBeCloseTo(first - 0.08 * 212, 9)
    expect(scales.days.to).toBeCloseTo(last + 0.08 * 212, 9)
    // The scale fills the plot less the clear space inside its frame: the padding is the room at its ends.
    expect([scales.x0, scales.x1]).toEqual([scales.inset.left, scales.inset.right])
    const placed = byKey(layout(items))
    expect(placed.get("a")!.x).toBeCloseTo(xAt(scales, utc(2026, 8, 15)), 9)
    expect(placed.get("b")!.x).toBeCloseTo(xAt(scales, last), 9)
    expect(placed.get("c")!.x).toBeCloseTo(xAt(scales, first), 9)
    expect(placed.get("c")!.x - scales.x0).toBeCloseTo(scales.x1 - placed.get("b")!.x, 9)
    expect(placed.get("a")!.home.x).toBe(placed.get("a")!.x)
    expect(placed.get("a")!.displaced).toBe(false)
  })

  it("covers twenty-one days at least, with the papers in the middle of them", () => {
    const alone = scalesOf([item("a", { dates: ["2026-10-01"] })])
    expect(alone.days).toEqual({ from: utc(2026, 10, 1) - 10.5, to: utc(2026, 10, 1) + 10.5 })
    expect(one({ dates: ["2026-10-01"] }).x).toBe((alone.x0 + alone.x1) / 2)
    // Ten days apart: 11.6 with the padding, so the scale is widened to 21 around their middle.
    const near = [item("a", { dates: ["2026-09-01"] }), item("b", { dates: ["2026-09-11"] })]
    expect(scalesOf(near).days).toEqual({ from: utc(2026, 9, 6) - 10.5, to: utc(2026, 9, 6) + 10.5 })
    const placed = byKey(layout(near))
    expect((placed.get("a")!.x + placed.get("b")!.x) / 2).toBeCloseTo((alone.x0 + alone.x1) / 2, 9)
    // Twenty days apart: 23.2 with the padding, which is enough.
    const wider = scalesOf([item("a", { dates: ["2026-09-01"] }), item("b", { dates: ["2026-09-21"] })])
    expect(wider.days.from).toBeCloseTo(utc(2026, 9, 1) - 1.6, 9)
    expect(wider.days.to).toBeCloseTo(utc(2026, 9, 21) + 1.6, 9)
  })

  it("does not know what day it is: the scale ends where the papers do, however old they are", () => {
    expect(mapScales).toHaveLength(2)
    expect(layoutMap).toHaveLength(2)
    const old = scalesOf([item("a", { dates: ["2019-02-01"] }), item("b", { dates: ["2019-05-12"] })])
    expect(old.days.from).toBeCloseTo(utc(2019, 2, 1) - 8, 9)
    expect(old.days.to).toBeCloseTo(utc(2019, 5, 12) + 8, 9)
    expect(old.ticksX.every((tick) => tick.year === 2019)).toBe(true)
  })

  it("says nothing of the earlier papers of an item: a bubble is at its newest paper only", () => {
    const placed = layout([item("a", { dates: ["2026-03-10", "2026-06-15", "2026-08"] })])
    expect(Object.keys(placed[0]).sort()).toEqual(["displaced", "home", "key", "labelAbove", "labelShift", "r", "x", "y"])
  })

  it("keeps a narrow column at the far left for the items none of whose papers has a date, and has none when all have", () => {
    expect(scalesOf([item("a")]).column).toBeNull()
    const items = [item("a", { dates: [] }), item("b", { dates: ["never"], participants: 1000 }), item("c", { dates: ["2026-01-01"], participants: 10 })]
    const scales = scalesOf(items)
    const column = scales.column!
    expect(column.left).toBe(scales.plot.left)
    // The scale starts clear of the column.
    expect(scales.x0).toBe(column.right + INSET)
    expect((column.right - column.left) / (scales.plot.right - scales.plot.left)).toBeLessThan(0.16)
    // The scale is of the dated papers only.
    expect(scales.days).toEqual({ from: utc(2026, 1, 1) - 10.5, to: utc(2026, 1, 1) + 10.5 })
    const placed = byKey(layout(items))
    for (const key of ["a", "b"]) {
      const entry = placed.get(key)!
      expect(entry.x).toBe((column.left + column.right) / 2)
      expect(entry.x + entry.r).toBeLessThanOrEqual(column.right)
      expect(entry.displaced).toBe(false)
    }
    // Each at the height of its participants.
    expect(placed.get("a")!.y).toBe(scales.yMiddle)
    expect(placed.get("b")!.y).toBe(scales.yTop)
    expect(placed.get("c")!.x - placed.get("c")!.r).toBeGreaterThanOrEqual(column.right)
  })

  it("runs the y scale from 10 at the bottom to the next power of ten at or above the largest, and to 1,000 at least", () => {
    const ticks = (values: (number | null)[]) => scalesOf(values.map((participants, at) => item(`k${at}`, { participants }))).ticksY.map((tick) => tick.value)
    expect(ticks([100, 900])).toEqual([10, 100, 1000])
    expect(ticks([40])).toEqual([10, 100, 1000])
    expect(ticks([1000])).toEqual([10, 100, 1000])
    expect(ticks([1001])).toEqual([10, 100, 1000, 10000])
    expect(ticks([10000, null])).toEqual([10, 100, 1000, 10000])
    expect(ticks([250000])).toEqual([10, 100, 1000, 10000, 100000, 1000000])
    const scales = scalesOf([item("a", { participants: 5000 })])
    expect(scales.participants).toEqual({ min: 10, max: 10000 })
    expect(scales.ticksY[0].y).toBe(scales.yBottom)
    expect(scales.ticksY.at(-1)!.y).toBe(scales.yTop)
    // More participants are higher.
    expect(scales.yTop).toBeLessThan(scales.yBottom)
  })

  it("draws a known number of participants at its height: 100 of 10 to 1,000 in the middle, and under 10 at 10", () => {
    const scales = scalesOf([item("a")])
    expect(scales.yMiddle).toBe((scales.yTop + scales.yBottom) / 2)
    expect(one({ participants: 100 })).toMatchObject({ key: "a", y: scales.yMiddle, r: 18 })
    expect(one({ participants: 1000 }).y).toBe(scales.yTop)
    expect(one({ participants: 10 }).y).toBe(scales.yBottom)
    expect(one({ participants: 3 }).y).toBe(scales.yBottom)
    expect(one({ participants: 100, papers: 9 }).r).toBe(30)
  })

  it("keeps a band along the bottom for the items that state no participants, one row of bubbles and their names high", () => {
    expect(scalesOf([item("a")]).band).toBeNull()
    const items = [item("a", { participants: null, papers: 4, dates: ["2026-08-01"] }), item("b", { participants: 10, dates: ["2026-08-01"] })]
    const scales = scalesOf(items)
    const band = scales.band!
    expect(band.bottom).toBe(scales.plot.bottom)
    // A bubble of radius 24, and room for a name of two lines and its marks.
    expect(band.bottom - band.top).toBeGreaterThanOrEqual(2 * 24 + 30 + 14)
    expect(band.bottom - band.top).toBeLessThan(0.35 * (scales.plot.bottom - scales.plot.top))
    const placed = byKey(layout(items))
    const a = placed.get("a")!
    expect(a.y).toBe(scales.bandY)
    expect(a.y - a.r).toBeGreaterThanOrEqual(band.top)
    expect(a.y + a.r).toBeLessThanOrEqual(band.bottom)
    expect(a.labelAbove).toBe(false)
    // The scale of the others ends above the band.
    expect(scales.yBottom + 18).toBeLessThan(band.top)
    expect(placed.get("b")!.y).toBe(scales.yBottom)
    expect(a.x).toBe(placed.get("b")!.x)
  })

  it("moves apart ten items of one date and one size: up or down first, then to the nearest free place, and says which were moved far", () => {
    const items = Array.from({ length: 10 }, (_, at) => item(`k${at}`, { dates: ["2026-08-20"] }))
    const placed = layout(items)
    expect(placed.map((entry) => entry.key)).toEqual(items.map((entry) => entry.key))
    expect(overlaps(placed)).toEqual([])
    expect(inside(placed, items)).toBe(true)
    const scales = scalesOf(items)
    const home = placed[0].home
    expect(placed.every((entry) => entry.home.x === home.x && entry.home.y === scales.yMiddle)).toBe(true)
    // The first keeps its place. The next goes up by the least that fits, which is over its radius: it is displaced.
    expect([placed[0].x, placed[0].y, placed[0].displaced]).toEqual([home.x, scales.yMiddle, false])
    expect([placed[1].x, placed[1].y, placed[1].displaced]).toEqual([home.x, scales.yMiddle - 42, true])
    // Under the first is its name, further than an eighth of the height: the third goes to the nearest free place, beside the first.
    expect([placed[2].x, placed[2].y, placed[2].displaced]).toEqual([home.x + 42, scales.yMiddle, true])
    expect(placed.every((entry) => entry.displaced === far(entry))).toBe(true)
    expect(placed.slice(1).every((entry) => entry.displaced)).toBe(true)
    // The nearest places: no one is further than three bubbles from where it belongs.
    expect(Math.max(...placed.map((entry) => Math.hypot(entry.x - home.x, entry.y - home.y)))).toBeLessThan(3 * 42)
  })

  it("tries the places no further than its own radius first, both ways at once too, so that fewer need a line", () => {
    // 12 px to the right and 12 px up of a bubble of the same size: 42 px are needed, and straight up, down or sideways that is over its radius.
    const far = item("c", { dates: ["2026-08-26"], participants: 10 })
    const base = scalesOf([item("a"), item("b", { dates: ["2026-10-09"] }), far])
    const day = (base.x1 - base.x0) / (44 * 1.16)
    const above = 100 * 10 ** (12 / ((base.yBottom - base.yTop) / 2))
    const placed = byKey(layout([item("a"), item("b", { dates: ["2026-10-09"], participants: above }), far]))
    const [a, b] = [placed.get("a")!, placed.get("b")!]
    expect([a.x, a.y]).toEqual([a.home.x, a.home.y])
    expect(b.home.x - a.x).toBeCloseTo(day, 6)
    expect(day).toBeLessThan(12)
    expect(b.home.y).toBeCloseTo(a.y - 12, 6)
    expect(b.x).toBeGreaterThan(b.home.x)
    expect(b.y).toBeLessThan(b.home.y)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(42)
    expect(b.displaced).toBe(false)
  })

  it("moves a bubble that overlaps another only a little up or down, and does not call that displaced", () => {
    const base = scalesOf([item("a", { papers: 2 })])
    // 30 px above the middle: twelve more are needed to clear a bubble at the middle.
    const above = 100 * 10 ** (30 / ((base.yBottom - base.yTop) / 2))
    const items = [item("a", { papers: 2 }), item("b", { participants: above })]
    const placed = byKey(layout(items))
    const [a, b] = [placed.get("a")!, placed.get("b")!]
    expect(b.home.y).toBeCloseTo(a.y - 30, 6)
    expect(b.x).toBe(a.x)
    expect(a.y - b.y).toBeGreaterThanOrEqual(a.r + b.r + 6)
    expect(a.y - b.y).toBeLessThan(a.r + b.r + 6 + 2)
    expect([a.displaced, b.displaced]).toEqual([false, false])
  })

  it("tries up or down within an eighth of the height, then sideways within a little of the width, before anywhere", () => {
    const items = [item("a", { papers: 4 }), item("b")]
    const scales = scalesOf(items)
    const placed = byKey(layout(items))
    // 48 px are needed between them: under an eighth of the height of the scale (12%), so b goes straight up.
    expect(0.12 * (scales.inset.bottom - scales.inset.top)).toBeLessThan(48)
    expect(0.06 * (scales.inset.right - scales.inset.left)).toBeLessThan(48)
    const [a, b] = [placed.get("a")!, placed.get("b")!]
    expect([a.x, a.y, a.displaced]).toEqual([a.home.x, a.home.y, false])
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(48)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(50)
    expect(b.displaced).toBe(true)
  })

  it("moves the items of the band apart sideways, at the one height of the band, and marks those moved far", () => {
    const items = Array.from({ length: 3 }, (_, at) => item(`k${at}`, { participants: null, dates: ["2026-08-20"] }))
    const placed = layout(items)
    const scales = scalesOf(items)
    expect(placed.map((entry) => entry.y)).toEqual(Array(3).fill(scales.bandY))
    expect(placed.map((entry) => entry.displaced)).toEqual([false, true, true])
    expect(placed[1].x - placed[0].x).toBe(42)
    expect(placed[2].x - placed[0].x).toBe(-42)
    expect(placed.every((entry) => entry.home.x === placed[0].x && entry.home.y === scales.bandY)).toBe(true)
    expect(overlaps(placed)).toEqual([])
    expect(inside(placed, items)).toBe(true)
    // A day apart, 28 px here: the second moves 14 px more, within a little of the width, and is not displaced.
    const near = [item("a", { participants: null, dates: ["2026-08-20"] }), item("b", { participants: null, dates: ["2026-08-21"] })]
    const pair = byKey(layout(near))
    expect(pair.get("b")!.home.x - pair.get("a")!.x).toBeCloseTo((scales.x1 - scales.x0) / 21, 6)
    expect(pair.get("b")!.x - pair.get("a")!.x).toBeGreaterThanOrEqual(42)
    expect(pair.get("b")!.x - pair.get("a")!.x).toBeLessThan(44)
    expect([pair.get("a")!.displaced, pair.get("b")!.displaced]).toEqual([false, false])
  })

  it("moves the items of the column apart up and down, inside the column", () => {
    const items = Array.from({ length: 6 }, (_, at) => item(`k${at}`, { dates: [] }))
    const placed = layout(items)
    const column = scalesOf(items).column!
    expect(overlaps(placed)).toEqual([])
    expect(inside(placed, items)).toBe(true)
    expect(placed.every((entry) => entry.x - entry.r >= column.left && entry.x + entry.r <= column.right)).toBe(true)
    expect(placed.every((entry) => entry.displaced === far(entry))).toBe(true)
  })

  it("keeps a name clear of the frame on the left and on the right, by shifting it under its bubble", () => {
    const marks = "+12 new · 12 safety · compared in 12"
    const items = [item("a", { marks }), item("b", { name: "A rather long name", dates: [], participants: 1000 }), item("c", { dates: ["2026-08-20"], participants: 10 })]
    const scales = scalesOf(items)
    const placed = byKey(layout(items))
    const boxOf = (key: string) => {
      const entry = placed.get(key)!
      return nameBoxes(items.find((each) => each.key === key)!, entry, entry.r, scales.inset)[entry.labelAbove ? "above" : "under"]
    }
    // The newest, by the right edge: a line of marks 200 px wide would run out of the picture.
    expect(placed.get("a")!.x).toBeCloseTo(xAt(scales, utc(2026, 10, 8)), 9)
    expect(placed.get("a")!.labelShift).toBeLessThan(0)
    expect(boxOf("a").right).toBe(scales.inset.right)
    expect(boxOf("a").right - boxOf("a").left).toBeGreaterThan(190)
    // In the column, by the left edge.
    expect(placed.get("b")!.labelShift).toBeGreaterThan(0)
    expect(boxOf("b").left).toBe(scales.inset.left)
    // In the middle: under its bubble, centred.
    expect(placed.get("c")!.labelShift).toBe(0)
    expect((boxOf("c").left + boxOf("c").right) / 2).toBeCloseTo(placed.get("c")!.x, 9)
  })

  it("keeps a bubble in the plot at the corners", () => {
    const items = [
      item("a", { dates: ["2026-01-01"], participants: 1000, papers: 40 }), item("b", { participants: 10, papers: 40 }), item("c", { dates: [], participants: null, papers: 40 }),
      item("d", { participants: null, papers: 40 }), item("e", { dates: [], participants: 1000, papers: 40 }), item("f", { dates: ["2026-01-01"], participants: null }),
    ]
    expect(inside(layout(items), items)).toBe(true)
    expect(overlaps(layout(items))).toEqual([])
  })

  it("has a tick a week, on Mondays, when the scale covers seventy days or less", () => {
    // 1 to 29 September 2026: 32.48 days with the padding. The Mondays in it are 31 August and 7, 14, 21 and 28 September.
    const items = [item("a", { dates: ["2026-09-01"] }), item("b", { dates: ["2026-09-29"] })]
    const scales = scalesOf(items)
    expect(scales.days.to - scales.days.from).toBeCloseTo(28 * 1.16, 9)
    expect(scales.ticksX.map((tick) => [tick.year, tick.month, tick.day])).toEqual([[2026, 8, 31], [2026, 9, 7], [2026, 9, 14], [2026, 9, 21], [2026, 9, 28]])
    expect(scales.ticksX.every((tick) => tick.labelled)).toBe(true)
    expect(scales.ticksX[1].x).toBeCloseTo(xAt(scales, utc(2026, 9, 7)), 9)
    expect(new Date(Date.UTC(2026, 8, 7)).getUTCDay()).toBe(1)
    // One paper: twenty-one days, three Mondays.
    expect(scalesOf([item("a", { dates: ["2026-10-01"] })]).ticksX.map((tick) => [tick.month, tick.day])).toEqual([[9, 21], [9, 28], [10, 5]])
    // Sixty days and the padding: 69.6 days, still by the week.
    const sixty = scalesOf([item("a", { dates: ["2026-08-01"] }), item("b", { dates: ["2026-09-30"] })])
    expect(sixty.ticksX.every((tick) => tick.day !== null)).toBe(true)
    expect(sixty.ticksX).toHaveLength(9)
  })

  it("has a tick a month over eighteen months or less, and a tick a year over more", () => {
    // Sixty-one days and the padding: 70.8 days, by the month.
    const months = scalesOf([item("a", { dates: ["2026-08-01"] }), item("b", { dates: ["2026-10-01"] })])
    expect(months.ticksX.map((tick) => [tick.year, tick.month, tick.day, tick.labelled])).toEqual([[2026, 8, null, true], [2026, 9, null, true], [2026, 10, null, true]])
    expect(months.ticksX[1].x).toBeCloseTo(xAt(months, utc(2026, 9, 1)), 9)
    // Fifteen months and the padding: seventeen months begin in it.
    const longer = scalesOf([item("a", { dates: ["2025-06-20"] }), item("b", { dates: ["2026-09-20"] })])
    expect(longer.ticksX).toHaveLength(17)
    expect(longer.ticksX.every((tick) => tick.month !== null && tick.day === null)).toBe(true)
    const years = scalesOf([item("a", { dates: ["2023-01-20"] }), item("b", { dates: ["2026-10-08"] })])
    expect(years.ticksX.map((tick) => [tick.year, tick.month, tick.day, tick.labelled])).toEqual([[2023, null, null, true], [2024, null, null, true], [2025, null, null, true], [2026, null, null, true], [2027, null, null, true]])
  })

  it("names only the ticks there is room for: no two names touch, none runs out of the picture, none is under the name of the column", () => {
    const widths = { week: 44, month: 60, year: 32 }
    const check = (items: MapItem[]) => {
      const scales = scalesOf(items)
      const named = scales.ticksX.filter((tick) => tick.labelled)
      const half = (tick: (typeof named)[number]) => (tick.day !== null ? widths.week : tick.month !== null ? widths.month : widths.year) / 2
      expect(named.length).toBeGreaterThan(0)
      for (const [at, tick] of named.entries()) {
        if (at > 0) expect(tick.x - half(tick)).toBeGreaterThan(named[at - 1].x + half(named[at - 1]))
        expect(tick.x + half(tick)).toBeLessThanOrEqual(SIZE.width)
        expect(tick.x - half(tick)).toBeGreaterThanOrEqual(scales.column ? scales.column.right : 0)
      }
      return scales.ticksX.map((tick) => tick.labelled)
    }
    // Seventeen months: a name every third month.
    const longer = check([item("a", { dates: ["2025-06-20"] }), item("b", { dates: ["2026-09-20"] })])
    expect(longer.filter(Boolean).length).toBeLessThanOrEqual(6)
    expect(longer.filter(Boolean).length).toBeGreaterThanOrEqual(5)
    // Ten weeks: every week has room.
    expect(check([item("a", { dates: ["2026-08-01"] }), item("b", { dates: ["2026-09-30"] })]).every(Boolean)).toBe(true)
    // With the column of no date, the scale is narrower and starts beside the column's name.
    check([item("a", { dates: ["2026-08-01"] }), item("b", { dates: ["2026-09-30"] }), item("c", { dates: [] })])
    check([item("a", { dates: ["2012-01-20"] }), item("b", { dates: ["2026-10-08"] }), item("c", { dates: [] })])
  })

  it("has no tick when no item has a date", () => {
    expect(scalesOf([item("a", { dates: [] })]).ticksX).toEqual([])
  })

  it("gives the same places for the same items, in whatever order they come", () => {
    const items = Array.from({ length: 12 }, (_, at) => item(`k${at}`, {
      papers: 1 + (at % 4), participants: at % 5 === 0 ? null : 60 + 15 * at, dates: at % 6 === 1 ? [] : [`2026-0${1 + (at % 3) * 4}-10`, "2026-01-02"],
    }))
    const once = layout(items)
    expect(layout(items)).toEqual(once)
    expect(byKey(layout([...items].reverse()))).toEqual(byKey(once))
    expect(overlaps(once)).toEqual([])
    expect(inside(once, items)).toBe(true)
  })

  it("writes a name under its bubble, and above it when the name of another is already on that line", () => {
    const long = "A rather long name"
    const scales = scalesOf([item("a", { dates: ["2026-01-01"] })])
    // Six days are 44 px wide here or more: far enough for two bubbles of radius 18, too near for their names.
    const days = Math.ceil(44 / ((scales.x1 - scales.x0) / (scales.days.to - scales.days.from)))
    const near = [item("a", { name: long, dates: ["2026-01-01", "2026-06-01"] }), item("b", { name: long, dates: ["2026-01-01", new Date((utc(2026, 6, 1) + days) * DAY).toISOString().slice(0, 10)] })]
    const placed = byKey(layout(near))
    expect(placed.get("a")!.y).toBe(placed.get("b")!.y)
    expect(placed.get("b")!.x).toBeGreaterThan(placed.get("a")!.x)
    expect([placed.get("a")!.labelAbove, placed.get("b")!.labelAbove]).toEqual([false, true])
    expect([placed.get("a")!.displaced, placed.get("b")!.displaced]).toEqual([false, false])
    const apart = layout([item("a", { name: long, dates: ["2026-01-01"] }), item("b", { name: long })])
    expect(apart.map((entry) => entry.labelAbove)).toEqual([false, false])
  })

  it("keeps every name clear of the other names and of the other bubbles, in a crowd of recent papers", () => {
    const items = [
      item("other", { name: "Other treatments", participants: null, dates: ["2026-09-30"], marks: "+1 new" }),
      item("neuromodulation", { name: "Neuromodulation", participants: 30, dates: ["2026-09-28"], marks: "+1 new" }),
      item("psychotherapy", { name: "Psychotherapy", papers: 3, participants: 110, dates: ["2026-10-01", "2026-08-11", "2026-09"], marks: "+3 new" }),
      item("lifestyle", { name: "Lifestyle", papers: 3, participants: 160, dates: ["2026-10-02", "2026-09-12"], marks: "+3 new" }),
      item("antipsychotics", { name: "Antipsychotics", papers: 3, participants: 420, dates: ["2026-10-03", "2026-07-20"], marks: "+3 new · 2 safety" }),
      item("medicine", { name: "Medicines", participants: 600, dates: ["2026-09-29"] }),
      item("digital", { name: "Digital tools", papers: 2, participants: 2100, dates: ["2026-10-05", "2026-10-01"], marks: "+2 new" }),
    ]
    const placed = layout(items)
    const names = nameBoxesOf(placed, items)
    const meet = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const nearest = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
    const covered = (box: Box, entry: Placed) => Math.hypot(entry.x - nearest(entry.x, box.left, box.right), entry.y - nearest(entry.y, box.top, box.bottom)) < entry.r
    expect(names.flatMap((a, at) => names.slice(at + 1).filter((b) => meet(a, b)).map((b) => `${items[at].key}/${items[names.indexOf(b)].key}`))).toEqual([])
    expect(names.flatMap((box, at) => placed.filter((entry, other) => other !== at && covered(box, entry)).map((entry) => `${items[at].key} under ${entry.key}`))).toEqual([])
    expect(overlaps(placed)).toEqual([])
    expect(inside(placed, items)).toBe(true)
    expect(namesInside(placed, items)).toBe(true)
    // Every one that was moved by more than its radius says so, and no other.
    expect(placed.every((entry) => entry.displaced === far(entry))).toBe(true)
  })

  it("keeps a clear space inside the frame of the plot: the scales end short of it, and room is left around the plot", () => {
    expect(INSET).toBe(16)
    const items = [item("a", { dates: ["2026-08-01"], participants: 10 }), item("b", { participants: 1000, papers: 9 }), item("c", { dates: [], participants: null })]
    const scales = scalesOf(items)
    const { plot, inset } = scales
    expect(inset).toEqual({ left: plot.left + 16, right: plot.right - 16, top: plot.top + 16, bottom: plot.bottom - 16 })
    // Left of the plot: the title of the y axis, turned, and the names of its ticks. Around the rest, a little.
    expect(plot.left).toBeGreaterThanOrEqual(76)
    expect(SIZE.width - plot.right).toBeGreaterThanOrEqual(8)
    expect(plot.top).toBeGreaterThanOrEqual(8)
    expect(SIZE.height - plot.bottom).toBeGreaterThanOrEqual(24)
    // The top and the bottom tick of the y scale, and both ends of the x scale, are inside the clear space, by the largest radius at least.
    expect(scales.yTop).toBe(inset.top + 30)
    expect(scales.yBottom).toBeLessThanOrEqual(scales.band!.top - 30)
    expect(scales.x1).toBe(inset.right)
    expect(scales.band!.bottom).toBe(plot.bottom)
    // The row of the band: its bubbles, and a name of two lines with its marks under them, clear of the frame.
    expect(scales.bandY! + 18 + 3 + 2 * 18 + 16).toBeLessThanOrEqual(inset.bottom)
  })

  it("puts no bubble nearer to an edge of the plot than its radius and 16 px, and no name on the clear space", () => {
    const crowd = Array.from({ length: 10 }, (_, at) => item(`k${at}`, { dates: ["2026-08-20"] }))
    const corners = [
      item("a", { dates: ["2026-01-01"], participants: 1000, papers: 40 }), item("b", { participants: 10, papers: 40 }), item("c", { dates: [], participants: null, papers: 40 }),
      item("d", { participants: null, papers: 40 }), item("e", { dates: [], participants: 1000, papers: 40 }), item("f", { dates: ["2026-01-01"], participants: null }),
    ]
    const edges = [
      item("a", { name: "Olanzapine and samidorphan", dates: ["2026-08-01"], participants: 10, marks: "+12 new · 12 safety · compared in 12" }),
      item("b", { name: "Cognitive behavioural therapy", participants: 1000, marks: "+12 new · 12 safety · compared in 12" }),
      item("c", { name: "Long-acting injectable", dates: [], participants: null, marks: "+1 new" }), item("d", { name: "Transcranial stimulation", participants: null, marks: "+1 new · 2 safety" }),
    ]
    for (const items of [REAL, SEVEN, crowd, corners, edges, [item("a")]]) {
      const placed = layout(items)
      const { plot } = scalesOf(items)
      for (const entry of placed) {
        expect(entry.x - plot.left).toBeGreaterThanOrEqual(entry.r + 16)
        expect(plot.right - entry.x).toBeGreaterThanOrEqual(entry.r + 16)
        expect(entry.y - plot.top).toBeGreaterThanOrEqual(entry.r + 16)
        expect(plot.bottom - entry.y).toBeGreaterThanOrEqual(entry.r + 16)
      }
      expect(inside(placed, items)).toBe(true)
    }
    for (const items of [REAL, SEVEN, edges, [item("a")]]) expect(namesInside(layout(items), items)).toBe(true)
  })

  /** The classes of a real condition on 2026-10-07: seven within a month, three of them within a week. */
  const REAL: MapItem[] = [
    item("antipsychotic", { name: "Antipsychotics", papers: 3, participants: 421, dates: ["2026-09-22", "2026-09-24", "2026-09-24"], marks: "+3 new" }),
    item("lifestyle", { name: "Lifestyle", papers: 3, participants: 161, dates: ["2026-09-28", "2026-08-31", "2026-08-31"], marks: "+3 new" }),
    item("psychotherapy", { name: "Psychotherapy", papers: 3, participants: 100, dates: ["2026-08-31", "2026-09-25", "2026-09-29"], marks: "+3 new" }),
    item("digital", { name: "Digital tools", papers: 2, participants: 2174, dates: ["2026-09-01", "2026-08-26"], marks: "+2 new" }),
    item("medicine", { name: "Medicines", participants: 608, dates: ["2026-09-22"] }),
    item("neuromodulation", { name: "Neuromodulation", participants: 31, dates: ["2026-09-16"], marks: "+1 new" }),
    item("other", { name: "Other treatments", participants: null, dates: ["2026-09-29"], marks: "+1 new" }),
  ]
  /** The same shape, harder: seven within eight weeks, 10 to 2,000 participants, radii 18 to 28. */
  const SEVEN: MapItem[] = [
    item("a", { name: "Antipsychotics", papers: 7, participants: 2000, dates: ["2026-09-24"], marks: "+3 new · 2 safety" }),
    item("b", { name: "Psychotherapy", papers: 5, participants: 300, dates: ["2026-09-29"], marks: "+3 new" }),
    item("c", { name: "Lifestyle", papers: 4, participants: 160, dates: ["2026-09-27"], marks: "+3 new" }),
    item("d", { name: "Digital tools", papers: 2, participants: 900, dates: ["2026-08-17"], marks: "+2 new" }),
    item("e", { name: "Medicines", participants: 600, dates: ["2026-09-22"] }),
    item("f", { name: "Neuromodulation", participants: 10, dates: ["2026-08-10"], marks: "+1 new" }),
    item("g", { name: "Other treatments", papers: 2, participants: 40, dates: ["2026-10-05"], marks: "compared in 1" }),
  ]

  it("draws seven items of ten weeks with two lines to where one belongs at most, and none on another", () => {
    for (const items of [REAL, SEVEN]) {
      const placed = layout(items)
      expect(placed.map((entry) => entry.r).every((r) => r >= 18 && r <= 28)).toBe(true)
      expect(overlaps(placed)).toEqual([])
      expect(inside(placed, items)).toBe(true)
      expect(namesInside(placed, items)).toBe(true)
      expect(placed.every((entry) => entry.displaced === far(entry))).toBe(true)
      expect(placed.filter((entry) => entry.displaced).length).toBeLessThanOrEqual(2)
      // By the week.
      expect(scalesOf(items).ticksX.every((tick) => tick.day !== null)).toBe(true)
    }
    // A bubble moved by no more than its radius has no line: Medicines, by Antipsychotics, is moved up a little and has none.
    const real = byKey(layout(REAL))
    expect(real.get("medicine")!.y).toBeLessThan(real.get("medicine")!.home.y)
    expect(real.get("medicine")!.displaced).toBe(false)
    expect(layout(REAL).filter((entry) => entry.displaced)).toHaveLength(0)
  })
  it("places the same items in a picture of any width: the plot is as wide as the picture, the radii are the same, and nothing overlaps or leaves the frame", () => {
    const sizes = [560, 720, 1000, 1240].map(mapSizeFor)
    expect(sizes.map((size) => size.height)).toEqual([380, 432, 520, 520])
    for (const items of [REAL, SEVEN]) {
      const radii = layoutMap(items, sizes[0]).map((entry) => entry.r)
      expect(radii).toEqual(items.map((each) => mapRadius(each.papers)))
      for (const size of sizes) {
        const { plot, inset } = mapScales(items, size)
        const placed = layoutMap(items, size)
        expect([plot.left, size.width - plot.right, plot.top, size.height - plot.bottom]).toEqual([84, 8, 8, 28])
        expect(placed.map((entry) => entry.r)).toEqual(radii)
        expect(overlaps(placed)).toEqual([])
        expect(placed.every((entry) => entry.x - entry.r >= inset.left && entry.x + entry.r <= inset.right && entry.y - entry.r >= inset.top && entry.y + entry.r <= inset.bottom)).toBe(true)
      }
      // A wider picture spreads them further apart across.
      const spread = (size: { width: number; height: number }) => { const xs = layoutMap(items, size).map((entry) => entry.home.x); return Math.max(...xs) - Math.min(...xs) }
      expect(spread(sizes[2])).toBeGreaterThan(spread(sizes[1]))
    }
  })
})
