import { describe, expect, it } from "vitest"
import { benefitShare, layoutMap, MAP_SIZE, mapRadius, mapScales, nameBoxes, type Box, type MapItem, type Placed } from "../evidence-map"

const item = (key: string, over: Partial<MapItem> = {}): MapItem => ({ key, name: key, papers: 1, share: 0.5, participants: 100, ...over })
const byKey = (placed: Placed[]) => new Map(placed.map((entry) => [entry.key, entry]))
const one = (over: Partial<MapItem>) => layoutMap([item("a", over)], MAP_SIZE)[0]
/** The participants that the x scale of `items` draws at `x`. */
const participantsAt = (x: number, items: MapItem[]) => {
  const { x0, x1, domain } = mapScales(items, MAP_SIZE)
  return 10 ** (1 + ((x - x0) / (x1 - x0)) * (Math.log10(domain.max) - 1))
}

describe("the map of the evidence summary", () => {
  it("sizes a bubble of the map by the square root of its papers, never over 40", () => {
    expect(mapRadius(1)).toBe(18)
    expect(mapRadius(4)).toBe(24)
    expect(mapRadius(9)).toBe(30)
    expect(mapRadius(25)).toBe(40)
    expect(mapRadius(400)).toBe(40)
  })

  it("reads the share of benefit as benefit plus half of mixed over the papers", () => {
    expect(benefitShare({ benefit: 4, "no-benefit": 0, mixed: 0 }, 4)).toBe(1)
    expect(benefitShare({ benefit: 0, "no-benefit": 3, mixed: 0 }, 3)).toBe(0)
    expect(benefitShare({ benefit: 1, "no-benefit": 1, mixed: 2 }, 4)).toBe(0.5)
    expect(benefitShare({ benefit: 3, "no-benefit": 1, mixed: 0 }, 4)).toBe(0.75)
    // Nothing to divide by: the middle.
    expect(benefitShare({ benefit: 0, "no-benefit": 0, mixed: 0 }, 0)).toBe(0.5)
  })

  it("runs the x scale from 10 to the next power of ten at or above the largest, and to 1,000 at least", () => {
    const ticks = (values: (number | null)[]) => mapScales(values.map((participants, at) => item(`k${at}`, { participants })), MAP_SIZE).ticks.map((tick) => tick.value)
    expect(ticks([100, 900])).toEqual([10, 100, 1000])
    expect(ticks([40])).toEqual([10, 100, 1000])
    expect(ticks([1000])).toEqual([10, 100, 1000])
    expect(ticks([1001])).toEqual([10, 100, 1000, 10000])
    expect(ticks([10000, null])).toEqual([10, 100, 1000, 10000])
    expect(ticks([250000])).toEqual([10, 100, 1000, 10000, 100000, 1000000])
    const scales = mapScales([item("a", { participants: 5000 })], MAP_SIZE)
    expect(scales.domain).toEqual({ min: 10, max: 10000 })
    expect(scales.ticks[0].x).toBe(scales.x0)
    expect(scales.ticks.at(-1)!.x).toBe(scales.x1)
  })

  it("draws a known value at its place: 100 of 10 to 1,000 in the middle, all benefit at the top, none at the bottom", () => {
    const scales = mapScales([item("a")], MAP_SIZE)
    const middleX = (scales.x0 + scales.x1) / 2
    const middleY = (scales.yTop + scales.yBottom) / 2
    expect(one({ participants: 100, share: 0.5 })).toMatchObject({ key: "a", x: middleX, y: middleY, r: 18 })
    expect(one({ participants: 10, share: 1 })).toMatchObject({ x: scales.x0, y: scales.yTop })
    expect(one({ participants: 1000, share: 0 })).toMatchObject({ x: scales.x1, y: scales.yBottom })
    expect(scales.yTop).toBeLessThan(scales.yBottom)
    expect(scales.yMiddle).toBe(middleY)
    // A value below 10 is drawn at 10.
    expect(one({ participants: 3 }).x).toBe(scales.x0)
    expect(one({ participants: 100, papers: 9 }).r).toBe(30)
  })

  it("keeps a column at the far left for the items that state no participants, and has none when all state them", () => {
    const stated = mapScales([item("a")], MAP_SIZE)
    expect(stated.column).toBeNull()
    const items = [item("a", { participants: null }), item("b", { participants: 10 })]
    const scales = mapScales(items, MAP_SIZE)
    const column = scales.column!
    expect(column.left).toBe(scales.plot.left)
    expect(column.right).toBeLessThan(scales.x0)
    const placed = byKey(layoutMap(items, MAP_SIZE))
    const a = placed.get("a")!
    expect(a.x).toBe((column.left + column.right) / 2)
    expect(a.x - a.r).toBeGreaterThanOrEqual(column.left)
    expect(a.x + a.r).toBeLessThanOrEqual(column.right)
    expect(placed.get("b")!.x - placed.get("b")!.r).toBeGreaterThanOrEqual(column.right)
  })

  const inside = (placed: Placed[], items: MapItem[]) => {
    const { plot } = mapScales(items, MAP_SIZE)
    return placed.every((entry) => entry.x - entry.r >= plot.left && entry.x + entry.r <= plot.right && entry.y - entry.r >= plot.top && entry.y + entry.r <= plot.bottom)
  }
  const overlaps = (placed: Placed[]) => placed.flatMap((a, at) => placed.slice(at + 1).filter((b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + 6 - 1e-9).map((b) => `${a.key}/${b.key}`))

  it("moves apart ten items that belong at the same point, along y first, and keeps them all in the plot", () => {
    const items = Array.from({ length: 10 }, (_, at) => item(`k${at}`, { papers: 1 + (at % 3) }))
    const placed = layoutMap(items, MAP_SIZE)
    expect(placed.map((entry) => entry.key)).toEqual(items.map((entry) => entry.key))
    expect(overlaps(placed)).toEqual([])
    expect(inside(placed, items)).toBe(true)
    // The largest, and of those the first by key, keeps its place; the next one moves along y only.
    const scales = mapScales(items, MAP_SIZE)
    const first = byKey(placed).get("k2")!
    expect([first.x, first.y]).toEqual([(scales.x0 + scales.x1) / 2, scales.yMiddle])
    const second = byKey(placed).get("k5")!
    expect(second.x).toBe(first.x)
    expect(second.y).toBeLessThan(first.y)
  })

  it("moves the items of the column apart too, without leaving the column", () => {
    const items = Array.from({ length: 4 }, (_, at) => item(`k${at}`, { participants: null }))
    const placed = layoutMap(items, MAP_SIZE)
    const column = mapScales(items, MAP_SIZE).column!
    expect(overlaps(placed)).toEqual([])
    expect(inside(placed, items)).toBe(true)
    expect(placed.every((entry) => entry.x - entry.r >= column.left && entry.x + entry.r <= column.right)).toBe(true)
  })

  it("keeps a bubble in the plot at the corners of the scales", () => {
    const items = [item("a", { participants: 10, share: 1, papers: 40 }), item("b", { participants: 1000, share: 0, papers: 40 }), item("c", { participants: null, share: 1, papers: 40 }), item("d", { participants: null, share: 0, papers: 40 })]
    expect(inside(layoutMap(items, MAP_SIZE), items)).toBe(true)
  })

  it("gives the same places for the same items, in whatever order they come", () => {
    const items = Array.from({ length: 12 }, (_, at) => item(`k${at}`, { papers: 1 + (at % 4), participants: at % 5 === 0 ? null : 60 + 15 * at, share: (at % 3) / 2 }))
    const once = layoutMap(items, MAP_SIZE)
    expect(layoutMap(items, MAP_SIZE)).toEqual(once)
    const reversed = layoutMap([...items].reverse(), MAP_SIZE)
    expect(byKey(reversed)).toEqual(byKey(once))
    expect(overlaps(once)).toEqual([])
  })

  it("writes a name under its bubble, and above it when the name of a larger one is already on that line", () => {
    const long = "A rather long name"
    const scales = mapScales([item("a")], MAP_SIZE)
    const middle = (scales.x0 + scales.x1) / 2
    // 44 px apart: far enough for two bubbles of radius 18, too near for their names.
    const near = [item("a", { name: long, participants: participantsAt(middle, [item("a")]) }), item("b", { name: long, participants: participantsAt(middle + 44, [item("a")]) })]
    const placed = byKey(layoutMap(near, MAP_SIZE))
    expect(placed.get("b")!.x - placed.get("a")!.x).toBeCloseTo(44, 6)
    expect(placed.get("a")!.y).toBe(placed.get("b")!.y)
    expect([placed.get("a")!.labelAbove, placed.get("b")!.labelAbove]).toEqual([false, true])
    // Far apart: both under.
    const far = layoutMap([item("a", { name: long, participants: 20 }), item("b", { name: long, participants: 900 })], MAP_SIZE)
    expect(far.map((entry) => entry.labelAbove)).toEqual([false, false])
    expect(one({}).labelAbove).toBe(false)
  })

  it("keeps every name clear of the other names and of the other bubbles, in a crowd near the top", () => {
    // Seen in the owner's vault: five classes whose papers all report benefit, within one power of ten of each other.
    const items = [
      item("other", { name: "Other treatments", participants: null, share: 1, marks: "+1 new" }),
      item("neuromodulation", { name: "Neuromodulation", participants: 30, share: 1, marks: "+1 new" }),
      item("psychotherapy", { name: "Psychotherapy", papers: 3, participants: 110, share: 1, marks: "+3 new" }),
      item("lifestyle", { name: "Lifestyle", papers: 3, participants: 160, share: 0.67, marks: "+3 new" }),
      item("antipsychotics", { name: "Antipsychotics", papers: 3, participants: 420, share: 0.67, marks: "+3 new · 2 safety" }),
      item("medicine", { name: "Medicines", participants: 600, share: 1 }),
      item("digital", { name: "Digital tools", papers: 2, participants: 2100, share: 1, marks: "+2 new" }),
    ]
    const placed = layoutMap(items, MAP_SIZE)
    const names: Box[] = placed.map((entry, at) => nameBoxes(items[at], entry, entry.r)[entry.labelAbove ? "above" : "under"])
    const meet = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const nearest = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
    const covered = (box: Box, entry: Placed) => Math.hypot(entry.x - nearest(entry.x, box.left, box.right), entry.y - nearest(entry.y, box.top, box.bottom)) < entry.r
    expect(names.flatMap((a, at) => names.slice(at + 1).filter((b) => meet(a, b)).map((b) => `${items[at].key}/${items[names.indexOf(b)].key}`))).toEqual([])
    expect(names.flatMap((box, at) => placed.filter((entry, other) => other !== at && covered(box, entry)).map((entry) => `${items[at].key} under ${entry.key}`))).toEqual([])
    expect(overlaps(placed)).toEqual([])
    expect(inside(placed, items)).toBe(true)
    expect(names.every((box) => box.top >= 0 && box.bottom <= MAP_SIZE.height)).toBe(true)
    // The first of the largest keeps its own place.
    const scales = mapScales(items, MAP_SIZE)
    expect(byKey(placed).get("antipsychotics")!.y).toBeCloseTo(scales.yTop + 0.33 * (scales.yBottom - scales.yTop), 6)
  })

  it("does not write a name over a bubble that was moved under its own", () => {
    const items = [item("a", { papers: 4 }), item("b", { papers: 1 })]
    const placed = byKey(layoutMap(items, MAP_SIZE))
    // b moved up, over a: its name would be on a, so it is written above b.
    expect(placed.get("b")!.y).toBeLessThan(placed.get("a")!.y)
    expect([placed.get("a")!.labelAbove, placed.get("b")!.labelAbove]).toEqual([false, true])
  })
})
