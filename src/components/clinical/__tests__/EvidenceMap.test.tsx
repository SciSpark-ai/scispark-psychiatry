// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { EvidenceMap, type MapEntry } from "../EvidenceMap"
import { layoutMap, MAP_SIZE, mapScales } from "../evidence-map"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(node) })
}
const q = (selector: string) => container.querySelector(selector) as HTMLElement
const qa = (selector: string) => [...container.querySelectorAll(selector)] as HTMLElement[]
const WIDE = '[data-evidence-map="wide"]'
const NARROW = '[data-evidence-map="narrow"]'
const TODAY = "2026-10-08"
beforeEach(() => { document.body.innerHTML = "" })

const entry = (key: string, over: Partial<MapEntry> = {}): MapEntry => ({ key, name: key, papers: 1, efficacy: { benefit: 1, "no-benefit": 0, mixed: 0 }, newPapers: 0, participants: 100, sized: 1, dates: [TODAY], ...over })
const ENTRIES: MapEntry[] = [
  entry("medicine", { name: "Medicines", papers: 4, efficacy: { benefit: 3, "no-benefit": 1, mixed: 0 }, newPapers: 2, participants: 1240, sized: 3, dates: ["2026-09-28", "2026-03-10", "2026-06", "2026-06"] }),
  entry("psychotherapy", { name: "Psychotherapy", papers: 2, efficacy: { benefit: 0, "no-benefit": 1, mixed: 1 }, participants: 48, sized: 2, dates: ["2026-05", "2026-05"] }),
  entry("digital", { name: "Digital tools", papers: 1, participants: null, sized: 0, dates: ["2026"] }),
]
const show = (entries: MapEntry[] = ENTRIES, chosen: string | null = null, onPick: (key: string) => void = () => {}) =>
  render(<EvidenceMap label="Classes of treatment" entries={entries} chosen={chosen} onPick={onPick} today={TODAY} />)
const percent = (value: number, of: number) => `${Number(((value / of) * 100).toFixed(2))}%`
const items = (entries: MapEntry[]) => entries.map((each) => ({ key: each.key, name: each.name, papers: each.papers, participants: each.participants, dates: each.dates }))
const num = (element: Element, name: string) => Number(element.getAttribute(name))

describe("the map of treatments", () => {
  it("draws the axes in one hidden picture: time across with a tick a month, participants up with a tick per power of ten", async () => {
    await show()
    const pictures = qa(`${WIDE} svg[data-map-axes]`)
    expect(pictures).toHaveLength(1)
    expect(pictures[0].getAttribute("aria-hidden")).toBe("true")
    expect(pictures[0].getAttribute("viewBox")).toBe(`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`)
    const scales = mapScales(items(ENTRIES), MAP_SIZE, TODAY)
    // From 10 March to 8 October 2026: seven months begin in it.
    expect(qa(`${WIDE} [data-tick-x]`).map((tick) => tick.textContent)).toEqual(["Apr 2026", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026"])
    expect(qa(`${WIDE} [data-tick-x]`).map((tick) => num(tick, "x"))).toEqual(scales.ticksX.map((tick) => tick.x))
    // 1,240 is the largest: the scale runs to 10,000, written from the bottom up.
    expect(qa(`${WIDE} [data-tick-y]`).map((tick) => tick.textContent)).toEqual(["10", "100", "1,000", "10,000"])
    expect(qa(`${WIDE} [data-tick-y]`).map((tick) => num(tick, "y"))).toEqual(scales.ticksY.map((tick) => tick.y))
    expect(num(qa(`${WIDE} [data-tick-y]`)[0], "y")).toBeGreaterThan(num(qa(`${WIDE} [data-tick-y]`)[3], "y"))
    expect(qa(`${WIDE} [data-guide]`)).toHaveLength(4)
    expect(q(`${WIDE} [data-axis-title="x"]`).textContent).toBe("Publication date of its most recent paper")
    expect(q(`${WIDE} [data-axis-title="y"]`).textContent).toBe("Total participants across its papers (log scale)")
    // Nothing is left of the share of benefit.
    expect(q(WIDE).textContent).not.toMatch(/All benefit|Split|No benefit/)
    expect(pictures[0].innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it("names only the months there is room for, and the years when the papers reach back over eighteen months", async () => {
    await show([entry("a", { dates: ["2025-05-08"] })])
    expect(qa(`${WIDE} [data-tick-mark]`)).toHaveLength(17)
    expect(qa(`${WIDE} [data-tick-x]`).map((tick) => tick.textContent)).toEqual(["Jun 2025", "Aug 2025", "Oct 2025", "Dec 2025", "Feb 2026", "Apr 2026", "Jun 2026", "Aug 2026", "Oct 2026"])
    document.body.innerHTML = ""
    await show([entry("a", { dates: ["2023-01-20"] })])
    expect(qa(`${WIDE} [data-tick-x]`).map((tick) => tick.textContent)).toEqual(["2024", "2025", "2026"])
  })

  it("shades a band named not stated along the bottom only when an item states no participants", async () => {
    await show()
    const scales = mapScales(items(ENTRIES), MAP_SIZE, TODAY)
    const band = q(`${WIDE} [data-band]`)
    expect([num(band, "x"), num(band, "y"), num(band, "width"), num(band, "height")]).toEqual([scales.plot.left, scales.band!.top, scales.plot.right - scales.plot.left, scales.band!.bottom - scales.band!.top])
    expect(q(`${WIDE} [data-band-label]`).textContent).toBe("not stated")
    expect(num(q(`${WIDE} [data-band-label]`), "y")).toBe(scales.bandY)
    expect(q(`${WIDE} button[data-bubble=digital]`).style.top).toBe(percent(scales.bandY!, MAP_SIZE.height))
    document.body.innerHTML = ""
    await show(ENTRIES.slice(0, 2))
    expect(q(`${WIDE} [data-band]`)).toBeNull()
    expect(q(`${WIDE} [data-band-label]`)).toBeNull()
  })

  it("shades a column named no date at the far left only when an item has no dated paper", async () => {
    await show()
    expect(q(`${WIDE} [data-column]`)).toBeNull()
    expect(q(`${WIDE} [data-column-label]`)).toBeNull()
    document.body.innerHTML = ""
    const undated = [...ENTRIES, entry("lifestyle", { name: "Lifestyle", dates: [] })]
    await show(undated)
    const scales = mapScales(items(undated), MAP_SIZE, TODAY)
    const column = q(`${WIDE} [data-column]`)
    expect([num(column, "x"), num(column, "width")]).toEqual([scales.column!.left, scales.column!.right - scales.column!.left])
    expect(q(`${WIDE} [data-column-label]`).textContent).toBe("no date")
    expect(q(`${WIDE} button[data-bubble=lifestyle]`).style.left).toBe(percent((scales.column!.left + scales.column!.right) / 2, MAP_SIZE.width))
    expect(q(`${WIDE} button[data-bubble=lifestyle]`).getAttribute("aria-label")).toBe("Lifestyle: 1 paper; 1 benefit, 0 no benefit, 0 mixed; no publication date; 100 participants in 1 of 1 paper")
  })

  it("puts each bubble over the picture as a button, at its place in percent, as wide as its papers make it", async () => {
    await show()
    const box = q(`${WIDE} [data-map-box]`)
    expect(box.getAttribute("role")).toBe("group")
    expect(box.getAttribute("aria-label")).toBe("Classes of treatment")
    expect(box.className).toContain("relative")
    expect(box.className).toContain("aspect-[680/400]")
    const placed = new Map(layoutMap(items(ENTRIES), MAP_SIZE, TODAY).map((each) => [each.key, each]))
    const buttons = qa(`${WIDE} button[data-bubble]`)
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      const at = placed.get(button.getAttribute("data-bubble")!)!
      expect(button.getAttribute("type")).toBe("button")
      expect(button.style.left).toBe(percent(at.x, MAP_SIZE.width))
      expect(button.style.top).toBe(percent(at.y, MAP_SIZE.height))
      expect(button.style.width).toBe(percent(2 * at.r, MAP_SIZE.width))
      expect(button.className).toContain("absolute")
      expect(button.className).toContain("-translate-x-1/2")
      expect(button.className).toContain("-translate-y-1/2")
      expect(button.parentElement).toBe(box)
    }
    // The newest paper of Medicines is the latest of the three: it is the furthest right. It has the most participants: it is the highest.
    const [medicine, psychotherapy, digital] = ["medicine", "psychotherapy", "digital"].map((key) => q(`${WIDE} button[data-bubble=${key}]`))
    expect(parseFloat(medicine.style.left)).toBeGreaterThan(parseFloat(digital.style.left))
    expect(parseFloat(digital.style.left)).toBeGreaterThan(parseFloat(psychotherapy.style.left))
    expect(parseFloat(medicine.style.top)).toBeLessThan(parseFloat(psychotherapy.style.top))
    // Radius 24 for four papers: the doughnut is drawn in a box of 48, and fills its button.
    const disc = medicine.querySelector("svg")!
    expect(disc.getAttribute("viewBox")).toBe("0 0 48 48")
    expect(disc.getAttribute("width")).toBe("100%")
    expect([...disc.querySelectorAll("path[data-slice]")].map((slice) => slice.getAttribute("data-slice"))).toEqual(["benefit", "no-benefit"])
    expect(disc.querySelector("[data-number]")!.textContent).toBe("4")
    // In the order a reader tabs through: from left to right.
    expect(buttons.map((button) => button.getAttribute("data-bubble"))).toEqual(["psychotherapy", "digital", "medicine"])
  })

  it("draws a thin line from a bubble back to its earliest paper, with a small end, only for papers of more than one date", async () => {
    await show()
    const placed = new Map(layoutMap(items(ENTRIES), MAP_SIZE, TODAY).map((each) => [each.key, each]))
    const scales = mapScales(items(ENTRIES), MAP_SIZE, TODAY)
    // Medicines: four papers from 10 March to 28 September. Psychotherapy: two of one month. Digital tools: one.
    expect(qa(`${WIDE} svg[data-map-axes] [data-span]`).map((span) => span.getAttribute("data-span"))).toEqual(["medicine"])
    const at = placed.get("medicine")!
    const line = q(`${WIDE} [data-span=medicine] [data-span-line]`)
    expect(["x1", "x2", "y1", "y2"].map((name) => num(line, name))).toEqual([scales.x0, at.x, at.y, at.y])
    const end = q(`${WIDE} [data-span=medicine] [data-span-end]`)
    expect(["x1", "x2", "y1", "y2"].map((name) => num(end, name))).toEqual([scales.x0, scales.x0, at.y - 4, at.y + 4])
    expect(line.getAttribute("stroke")).toContain("var(--")
  })

  it("names each bubble, keeps its marks on one line, and says its newest paper and its participants in words", async () => {
    await show([
      entry("ketamine", { name: "Ketamine", papers: 4, efficacy: { benefit: 3, "no-benefit": 1, mixed: 0 }, newPapers: 2, safetyPapers: 2, comparatorPapers: 3, participants: 1240, sized: 3, dates: ["2026-09-28", "2026-07"] }),
      entry("lithium", { name: "Lithium", participants: null, sized: 0, dates: ["2026-08"] }),
      entry("ect", { name: "ECT", participants: 1, sized: 1, dates: ["2026"] }),
    ], "lithium")
    const ketamine = q(`${WIDE} button[data-bubble=ketamine]`)
    expect(ketamine.querySelector("[data-name]")!.textContent).toBe("Ketamine")
    expect(ketamine.querySelector("[data-marks]")!.textContent).toBe("+2 new · 2 safety · compared in 3")
    expect(ketamine.querySelector("[data-safety-ring]")).not.toBeNull()
    expect(ketamine.getAttribute("aria-label")).toBe("Ketamine: 4 papers; 3 benefit, 1 no benefit, 0 mixed; 2 new; 2 safety; the comparison in 3 other papers; most recent paper 2026-09-28; 1,240 participants in 3 of 4 papers")
    expect(ketamine.getAttribute("title")).toBe(ketamine.getAttribute("aria-label"))
    const lithium = q(`${WIDE} button[data-bubble=lithium]`)
    expect(lithium.getAttribute("aria-label")).toBe("Lithium: 1 paper; 1 benefit, 0 no benefit, 0 mixed; most recent paper 2026-08; participants not stated")
    expect(lithium.querySelector("[data-marks]")).toBeNull()
    expect(q(`${WIDE} button[data-bubble=ect]`).getAttribute("aria-label")).toBe("ECT: 1 paper; 1 benefit, 0 no benefit, 0 mixed; most recent paper 2026; 1 participant in 1 of 1 paper")
    expect(qa(`${WIDE} button[data-bubble]`).map((button) => [button.getAttribute("data-bubble"), button.getAttribute("aria-pressed")])).toEqual([["ect", "false"], ["lithium", "true"], ["ketamine", "false"]])
  })

  it("moves bubbles of one date up and down, and writes a name above its bubble where the layout says so", async () => {
    const long = "A rather long name"
    const stacked = [entry("a", { name: long, papers: 4 }), entry("b", { name: long })]
    await show(stacked)
    const [a, b] = ["a", "b"].map((key) => q(`${WIDE} button[data-bubble=${key}]`))
    expect(a.style.left).toBe(b.style.left)
    expect(parseFloat(b.style.top)).toBeLessThan(parseFloat(a.style.top))
    expect(a.querySelector("[data-label]")!.getAttribute("data-label")).toBe("under")
    expect(a.querySelector("[data-label]")!.className).toContain("top-full")
    expect(b.querySelector("[data-label]")!.getAttribute("data-label")).toBe("above")
    expect(b.querySelector("[data-label]")!.className).toContain("bottom-full")
    // No one was moved sideways, so no line is drawn.
    expect(qa(`${WIDE} [data-leader]`)).toHaveLength(0)
  })

  it("draws a thin line from a bubble that had to move sideways to where it belongs", async () => {
    const crowd = Array.from({ length: 4 }, (_, at) => entry(`k${at}`, { participants: null, sized: 0, dates: ["2026-08-20"] }))
    await show(crowd)
    const places = layoutMap(items(crowd), MAP_SIZE, TODAY)
    const moved = places.filter((place) => place.displaced)
    expect(moved).toHaveLength(3)
    const leaders = qa(`${WIDE} svg[data-map-axes] line[data-leader]`)
    expect(leaders.map((line) => line.getAttribute("data-leader"))).toEqual(moved.map((place) => place.key))
    for (const line of leaders) {
      const place = moved.find((each) => each.key === line.getAttribute("data-leader"))!
      expect(["x1", "y1", "x2", "y2"].map((name) => num(line, name))).toEqual([place.home.x, place.home.y, place.x, place.y])
      expect(line.getAttribute("stroke")).toContain("var(--")
    }
    expect(qa(`${WIDE} svg[data-map-axes] circle[data-home]`)).toHaveLength(3)
  })

  it("tells its owner which bubble was pressed, from the map and from the grid", async () => {
    const onPick = vi.fn()
    await show(ENTRIES, null, onPick)
    await act(async () => { q(`${WIDE} button[data-bubble=psychotherapy]`).click() })
    await act(async () => { q(`${NARROW} button[data-bubble=medicine]`).click() })
    expect(onPick.mock.calls).toEqual([["psychotherapy"], ["medicine"]])
  })

  it("says under the map what across, up and size are, and what a line is", async () => {
    await show()
    expect(q("[data-map-note]").textContent).toBe("Across = when its most recent paper was published; a line reaches back to its earliest. Up = the participants its papers report, added up (a paper that states none adds none; the same people can be in more than one paper). Size = the number of papers. Bubbles that would overlap are moved up or down a little; a line shows where one that had to move sideways belongs.")
  })

  it("is a grid of two columns of tiles on a narrow screen, each with its month and its participants in words, and only one of the two is shown", async () => {
    await show([...ENTRIES, entry("lifestyle", { name: "Lifestyle", dates: [], participants: 1, sized: 1 })], "medicine")
    expect(q(WIDE).className).toContain("hidden")
    expect(q(WIDE).className).toContain("sm:block")
    expect(q(NARROW).className).toContain("sm:hidden")
    const grid = q(`${NARROW} [data-bubble-grid]`)
    expect(grid.getAttribute("role")).toBe("group")
    expect(grid.getAttribute("aria-label")).toBe("Classes of treatment")
    expect(grid.className).toContain("grid-cols-2")
    expect(q(`${NARROW} svg[data-map-axes]`)).toBeNull()
    const tiles = qa(`${NARROW} button[data-bubble]`)
    // In the order they were given. A date that is a year is written as the year.
    expect(tiles.map((tile) => [tile.getAttribute("data-bubble"), tile.querySelector("[data-name]")!.textContent, tile.querySelector("[data-participants]")!.textContent])).toEqual([
      ["medicine", "Medicines", "Sep 2026 · 1,240 participants"], ["psychotherapy", "Psychotherapy", "May 2026 · 48 participants"],
      ["digital", "Digital tools", "2026 · participants not stated"], ["lifestyle", "Lifestyle", "no date · 1 participant"],
    ])
    expect(tiles.map((tile) => tile.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"])
    expect(tiles[0].querySelector("[data-new]")!.textContent).toBe("+2 new")
    expect(tiles[0].getAttribute("aria-label")).toBe("Medicines: 4 papers; 3 benefit, 1 no benefit, 0 mixed; 2 new; most recent paper 2026-09-28; 1,240 participants in 3 of 4 papers")
    // Every disc sits in a box of one height, so the circles share a centre line and the names a baseline.
    const boxes = tiles.map((tile) => (tile.querySelector("[data-disc-box]") as HTMLElement).style.height)
    expect(new Set(boxes).size).toBe(1)
    expect(boxes[0]).toBe("80px")
  })

  it("is still a map with one item, and when no item states its participants", async () => {
    await show([ENTRIES[0]])
    expect(qa(`${WIDE} button[data-bubble]`)).toHaveLength(1)
    expect(qa(`${WIDE} [data-tick-y]`)).toHaveLength(4)
    document.body.innerHTML = ""
    const unsized = [entry("a", { participants: null, sized: 0, dates: ["2026-08-01"] }), entry("b", { participants: null, sized: 0, dates: ["2026-10-01"] })]
    await show(unsized)
    const scales = mapScales(items(unsized), MAP_SIZE, TODAY)
    expect(qa(`${WIDE} button[data-bubble]`).map((button) => button.style.top)).toEqual(Array(2).fill(percent(scales.bandY!, MAP_SIZE.height)))
    expect(parseFloat(q(`${WIDE} button[data-bubble=a]`).style.left)).toBeLessThan(parseFloat(q(`${WIDE} button[data-bubble=b]`).style.left))
    expect(qa(`${WIDE} [data-tick-y]`).map((tick) => tick.textContent)).toEqual(["10", "100", "1,000"])
    expect(q('[data-evidence-map="grid"]')).toBeNull()
    expect(container.textContent).not.toContain("None of these papers states")
  })

  it("is an empty grid alone when there is no item", async () => {
    await show([])
    expect(q(WIDE)).toBeNull()
    expect(q(NARROW)).toBeNull()
    expect(q("svg")).toBeNull()
    expect(q('[data-evidence-map="grid"] [data-bubble-grid]').getAttribute("aria-label")).toBe("Classes of treatment")
    expect(qa("button")).toHaveLength(0)
  })
})
