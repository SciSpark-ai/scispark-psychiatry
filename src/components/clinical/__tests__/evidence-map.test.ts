import { describe, expect, it } from "vitest"
import { dayOf, layoutMap, MAP_SIZE, mapRadius, mapScales, nameBoxes, newestDate, type Box, type MapItem, type Placed } from "../evidence-map"

const TODAY = "2026-10-08"
const DAY = 86400000
const utc = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day) / DAY
const item = (key: string, over: Partial<MapItem> = {}): MapItem => ({ key, name: key, papers: 1, participants: 100, dates: [TODAY], ...over })
const byKey = (placed: Placed[]) => new Map(placed.map((entry) => [entry.key, entry]))
const scalesOf = (items: MapItem[]) => mapScales(items, MAP_SIZE, TODAY)
const layout = (items: MapItem[]) => layoutMap(items, MAP_SIZE, TODAY)
const one = (over: Partial<MapItem>) => layout([item("a", over)])[0]
const inside = (placed: Placed[], items: MapItem[]) => {
  const { plot } = scalesOf(items)
  return placed.every((entry) => entry.x - entry.r >= plot.left && entry.x + entry.r <= plot.right && entry.y - entry.r >= plot.top && entry.y + entry.r <= plot.bottom)
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

  it("runs the x scale from the earliest paper of all the items to today, and puts an item at its newest paper", () => {
    const items = [item("a", { dates: ["2026-03-10", "2026-06-15", "2026-08"] }), item("b", { dates: ["2026-10-08"], participants: 1000 }), item("c", { dates: ["2026-03-10"], participants: 10 })]
    const scales = scalesOf(items)
    expect(scales.days).toEqual({ from: utc(2026, 3, 10), to: utc(2026, 10, 8) })
    const placed = byKey(layout(items))
    const xOf = (day: number) => scales.x0 + ((day - scales.days.from) / (scales.days.to - scales.days.from)) * (scales.x1 - scales.x0)
    expect(placed.get("a")!.x).toBeCloseTo(xOf(utc(2026, 8, 15)), 9)
    expect(placed.get("b")!.x).toBe(scales.x1)
    expect(placed.get("c")!.x).toBe(scales.x0)
    expect(scales.x0).toBeLessThan(scales.x1)
    expect(placed.get("a")!.home.x).toBe(placed.get("a")!.x)
    expect(placed.get("a")!.displaced).toBe(false)
  })

  it("widens the x scale to ninety days at least, and to a paper dated after today", () => {
    const recent = scalesOf([item("a", { dates: ["2026-10-01"] })])
    expect(recent.days).toEqual({ from: utc(2026, 10, 8) - 90, to: utc(2026, 10, 8) })
    expect(one({ dates: ["2026-10-01"] }).x).toBeCloseTo(recent.x0 + (83 / 90) * (recent.x1 - recent.x0), 9)
    expect(scalesOf([item("a", { dates: ["2026-01-01", "2026-11"] })]).days).toEqual({ from: utc(2026, 1, 1), to: utc(2026, 11, 15) })
  })

  it("says where the earliest paper of an item is, only when it has papers of more than one date", () => {
    const items = [item("a", { dates: ["2026-03-10", "2026-06-15", "2026-08"] }), item("b", { dates: ["2026-10-08"] }), item("c", { dates: ["2026-05", "2026-05"], participants: 10 }), item("d", { dates: [], participants: 1000 })]
    const scales = scalesOf(items)
    const placed = byKey(layout(items))
    expect(placed.get("a")!.earliestX).toBe(scales.x0)
    expect(placed.get("a")!.earliestX!).toBeLessThan(placed.get("a")!.x)
    expect(placed.get("b")!.earliestX).toBeNull()
    expect(placed.get("c")!.earliestX).toBeNull()
    expect(placed.get("d")!.earliestX).toBeNull()
  })

  it("keeps a narrow column at the far left for the items none of whose papers has a date, and has none when all have", () => {
    expect(scalesOf([item("a")]).column).toBeNull()
    const items = [item("a", { dates: [] }), item("b", { dates: ["never"], participants: 1000 }), item("c", { dates: ["2026-01-01"], participants: 10 })]
    const scales = scalesOf(items)
    const column = scales.column!
    expect(column.left).toBe(scales.plot.left)
    expect(column.right).toBeLessThan(scales.x0)
    expect((column.right - column.left) / (scales.plot.right - scales.plot.left)).toBeLessThan(0.16)
    // The scale is of the dated papers only.
    expect(scales.days.from).toBe(utc(2026, 1, 1))
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
    expect(0.12 * (scales.plot.bottom - scales.plot.top)).toBeLessThan(48)
    expect(0.06 * (scales.plot.right - scales.plot.left)).toBeLessThan(48)
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
    // Five days apart, 30 px here: the second moves 12 px more, within a little of the width, and is not displaced.
    const near = [item("a", { participants: null, dates: ["2026-08-20"] }), item("b", { participants: null, dates: ["2026-08-25"] })]
    const pair = byKey(layout(near))
    expect(pair.get("b")!.home.x - pair.get("a")!.x).toBeCloseTo(5 * ((scales.x1 - scales.x0) / 90), 6)
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

  it("keeps a name inside the plot on the left and on the right, by shifting it under its bubble", () => {
    const marks = "+12 new · 12 safety · compared in 12"
    const items = [item("a", { marks }), item("b", { name: "A rather long name", dates: [], participants: 1000 }), item("c", { dates: ["2026-08-20"], participants: 10 })]
    const scales = scalesOf(items)
    const placed = byKey(layout(items))
    const boxOf = (key: string) => {
      const entry = placed.get(key)!
      return nameBoxes(items.find((each) => each.key === key)!, entry, entry.r, scales.plot)[entry.labelAbove ? "above" : "under"]
    }
    // At today, by the right edge: a line of marks 200 px wide would run out of the picture.
    expect(placed.get("a")!.x).toBe(scales.x1)
    expect(placed.get("a")!.labelShift).toBeLessThan(0)
    expect(boxOf("a").right).toBe(scales.plot.right)
    expect(boxOf("a").right - boxOf("a").left).toBeGreaterThan(190)
    // In the column, by the left edge.
    expect(placed.get("b")!.labelShift).toBeGreaterThan(0)
    expect(boxOf("b").left).toBe(scales.plot.left)
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

  it("has a tick a month, named where there is room, over eighteen months or less, and a tick a year over more", () => {
    const short = scalesOf([item("a", { dates: ["2026-03-10"] })])
    expect(short.ticksX.map((tick) => [tick.year, tick.month, tick.labelled])).toEqual([[2026, 4, true], [2026, 5, true], [2026, 6, true], [2026, 7, true], [2026, 8, true], [2026, 9, true], [2026, 10, true]])
    const first = short.ticksX[0]
    expect(first.x).toBeCloseTo(short.x0 + ((utc(2026, 4, 1) - short.days.from) / (short.days.to - short.days.from)) * (short.x1 - short.x0), 9)
    // Seventeen months: a name every other month, so that two do not meet.
    const longer = scalesOf([item("a", { dates: ["2025-05-08"] })])
    expect(longer.ticksX).toHaveLength(17)
    expect(longer.ticksX.every((tick) => tick.month !== null)).toBe(true)
    expect(longer.ticksX.map((tick) => tick.labelled)).toEqual(Array.from({ length: 17 }, (_, at) => at % 2 === 0))
    const years = scalesOf([item("a", { dates: ["2023-01-20"] })])
    expect(years.ticksX.map((tick) => [tick.year, tick.month, tick.labelled])).toEqual([[2024, null, true], [2025, null, true], [2026, null, true]])
    // Ninety days: three months.
    expect(scalesOf([item("a")]).ticksX.map((tick) => tick.month)).toEqual([8, 9, 10])
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
    const { plot } = scalesOf(items)
    const names: Box[] = placed.map((entry, at) => nameBoxes(items[at], entry, entry.r, plot)[entry.labelAbove ? "above" : "under"])
    const meet = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const nearest = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
    const covered = (box: Box, entry: Placed) => Math.hypot(entry.x - nearest(entry.x, box.left, box.right), entry.y - nearest(entry.y, box.top, box.bottom)) < entry.r
    expect(names.flatMap((a, at) => names.slice(at + 1).filter((b) => meet(a, b)).map((b) => `${items[at].key}/${items[names.indexOf(b)].key}`))).toEqual([])
    expect(names.flatMap((box, at) => placed.filter((entry, other) => other !== at && covered(box, entry)).map((entry) => `${items[at].key} under ${entry.key}`))).toEqual([])
    expect(overlaps(placed)).toEqual([])
    expect(inside(placed, items)).toBe(true)
    expect(names.every((box) => box.top >= 0 && box.bottom <= MAP_SIZE.height && box.left >= plot.left && box.right <= plot.right)).toBe(true)
    // Every one that was moved by more than its radius says so, and no other.
    expect(placed.every((entry) => entry.displaced === far(entry))).toBe(true)
  })
})
