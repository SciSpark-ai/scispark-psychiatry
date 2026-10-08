// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { EvidenceMap, type MapEntry } from "../EvidenceMap"
import { benefitShare, layoutMap, MAP_SIZE, mapScales } from "../evidence-map"

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
beforeEach(() => { document.body.innerHTML = "" })

const entry = (key: string, over: Partial<MapEntry> = {}): MapEntry => ({ key, name: key, papers: 1, efficacy: { benefit: 1, "no-benefit": 0, mixed: 0 }, newPapers: 0, participants: 100, sized: 1, ...over })
const ENTRIES: MapEntry[] = [
  entry("medicine", { name: "Medicines", papers: 4, efficacy: { benefit: 3, "no-benefit": 1, mixed: 0 }, newPapers: 2, participants: 1240, sized: 3 }),
  entry("psychotherapy", { name: "Psychotherapy", papers: 2, efficacy: { benefit: 0, "no-benefit": 1, mixed: 1 }, participants: 48, sized: 2 }),
  entry("digital", { name: "Digital tools", papers: 1, participants: null, sized: 0 }),
]
const show = (entries: MapEntry[] = ENTRIES, chosen: string | null = null, onPick: (key: string) => void = () => {}) =>
  render(<EvidenceMap label="Classes of treatment" entries={entries} chosen={chosen} onPick={onPick} />)
const percent = (value: number, of: number) => `${Number(((value / of) * 100).toFixed(2))}%`
const items = (entries: MapEntry[]) => entries.map((each) => ({ key: each.key, name: each.name, papers: each.papers, share: benefitShare(each.efficacy, each.papers), participants: each.participants }))

describe("the map of treatments", () => {
  it("draws the axes in one hidden picture: a tick per power of ten, three words up the side, and a guide at the middle", async () => {
    await show()
    const pictures = qa(`${WIDE} svg[data-map-axes]`)
    expect(pictures).toHaveLength(1)
    expect(pictures[0].getAttribute("aria-hidden")).toBe("true")
    expect(pictures[0].getAttribute("viewBox")).toBe(`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`)
    // 1,240 is the largest: the scale runs to 10,000.
    expect(qa(`${WIDE} [data-tick]`).map((tick) => tick.textContent)).toEqual(["10", "100", "1,000", "10,000"])
    expect(qa(`${WIDE} [data-share-label]`).map((label) => label.textContent)).toEqual(["All benefit", "Split", "No benefit"])
    const scales = mapScales(items(ENTRIES), MAP_SIZE)
    expect(qa(`${WIDE} [data-share-label]`).map((label) => Number(label.getAttribute("y")))).toEqual([scales.yTop, scales.yMiddle, scales.yBottom])
    const guide = q(`${WIDE} [data-guide]`)
    expect([Number(guide.getAttribute("y1")), Number(guide.getAttribute("y2"))]).toEqual([scales.yMiddle, scales.yMiddle])
    expect(q(`${WIDE} [data-axis-title]`).textContent).toBe("Total participants across its papers (log scale)")
    expect(pictures[0].innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it("shades a column named not stated at the far left only when an item states no participants", async () => {
    await show()
    const column = q(`${WIDE} [data-column]`)
    const scales = mapScales(items(ENTRIES), MAP_SIZE)
    expect(Number(column.getAttribute("x"))).toBe(scales.column!.left)
    expect(Number(column.getAttribute("width"))).toBe(scales.column!.right - scales.column!.left)
    expect(q(`${WIDE} [data-column-label]`).textContent).toBe("not stated")
    document.body.innerHTML = ""
    await show(ENTRIES.slice(0, 2))
    expect(q(`${WIDE} [data-column]`)).toBeNull()
    expect(q(`${WIDE} [data-column-label]`)).toBeNull()
    expect(qa(`${WIDE} [data-tick]`).map((tick) => tick.textContent)).toEqual(["10", "100", "1,000", "10,000"])
  })

  it("puts each bubble over the picture as a button, at its place in percent, as wide as its papers make it", async () => {
    await show()
    const box = q(`${WIDE} [data-map-box]`)
    expect(box.getAttribute("role")).toBe("group")
    expect(box.getAttribute("aria-label")).toBe("Classes of treatment")
    expect(box.className).toContain("relative")
    expect(box.className).toContain("aspect-[680/350]")
    const placed = new Map(layoutMap(items(ENTRIES), MAP_SIZE).map((each) => [each.key, each]))
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
    // Radius 24 for four papers: the doughnut is drawn in a box of 48, and fills its button.
    const disc = q(`${WIDE} button[data-bubble=medicine] svg`)
    expect(disc.getAttribute("viewBox")).toBe("0 0 48 48")
    expect(disc.getAttribute("width")).toBe("100%")
    expect([...disc.querySelectorAll("path[data-slice]")].map((slice) => slice.getAttribute("data-slice"))).toEqual(["benefit", "no-benefit"])
    expect(disc.querySelector("[data-number]")!.textContent).toBe("4")
    expect(q(`${WIDE} button[data-bubble=digital] svg circle[data-slice]`).getAttribute("data-slice")).toBe("benefit")
  })

  it("orders the buttons from left to right, and from the top down where they are at the same x", async () => {
    await show([...ENTRIES, entry("lifestyle", { name: "Lifestyle", participants: null, sized: 0, efficacy: { benefit: 0, "no-benefit": 1, mixed: 0 } })])
    // The column first, its upper bubble before its lower; then 48 participants; then 1,240.
    expect(qa(`${WIDE} button[data-bubble]`).map((button) => button.getAttribute("data-bubble"))).toEqual(["digital", "lifestyle", "psychotherapy", "medicine"])
  })

  it("names each bubble, keeps its marks on one line, and says where it is in words", async () => {
    await show([
      entry("ketamine", { name: "Ketamine", papers: 4, efficacy: { benefit: 3, "no-benefit": 1, mixed: 0 }, newPapers: 2, safetyPapers: 2, comparatorPapers: 3, participants: 1240, sized: 3 }),
      entry("lithium", { name: "Lithium", participants: null, sized: 0 }),
      entry("ect", { name: "ECT", participants: 1, sized: 1 }),
    ], "lithium")
    const ketamine = q(`${WIDE} button[data-bubble=ketamine]`)
    expect(ketamine.querySelector("[data-name]")!.textContent).toBe("Ketamine")
    expect(ketamine.querySelector("[data-marks]")!.textContent).toBe("+2 new · 2 safety · compared in 3")
    expect(ketamine.querySelector("[data-safety-ring]")).not.toBeNull()
    expect(ketamine.getAttribute("aria-label")).toBe("Ketamine: 4 papers; 3 benefit, 1 no benefit, 0 mixed; 2 new; 2 safety; the comparison in 3 other papers; 1,240 participants in 3 of 4 papers")
    expect(ketamine.getAttribute("title")).toBe(ketamine.getAttribute("aria-label"))
    const lithium = q(`${WIDE} button[data-bubble=lithium]`)
    expect(lithium.getAttribute("aria-label")).toBe("Lithium: 1 paper; 1 benefit, 0 no benefit, 0 mixed; participants not stated")
    expect(lithium.querySelector("[data-marks]")).toBeNull()
    expect(q(`${WIDE} button[data-bubble=ect]`).getAttribute("aria-label")).toBe("ECT: 1 paper; 1 benefit, 0 no benefit, 0 mixed; 1 participant in 1 of 1 paper")
    expect(qa(`${WIDE} button[data-bubble]`).map((button) => [button.getAttribute("data-bubble"), button.getAttribute("aria-pressed")])).toEqual([["lithium", "true"], ["ect", "false"], ["ketamine", "false"]])
  })

  it("writes a name above its bubble where the layout says so", async () => {
    const stacked = [entry("a", { papers: 4, efficacy: { benefit: 2, "no-benefit": 2, mixed: 0 } }), entry("b", { efficacy: { benefit: 0, "no-benefit": 0, mixed: 1 } })]
    await show(stacked)
    expect(q(`${WIDE} button[data-bubble=a] [data-label]`).getAttribute("data-label")).toBe("under")
    expect(q(`${WIDE} button[data-bubble=a] [data-label]`).className).toContain("top-full")
    expect(q(`${WIDE} button[data-bubble=b] [data-label]`).getAttribute("data-label")).toBe("above")
    expect(q(`${WIDE} button[data-bubble=b] [data-label]`).className).toContain("bottom-full")
  })

  it("tells its owner which bubble was pressed, from the map and from the grid", async () => {
    const onPick = vi.fn()
    await show(ENTRIES, null, onPick)
    await act(async () => { q(`${WIDE} button[data-bubble=psychotherapy]`).click() })
    await act(async () => { q(`${NARROW} button[data-bubble=medicine]`).click() })
    expect(onPick.mock.calls).toEqual([["psychotherapy"], ["medicine"]])
  })

  it("says under the map what across, up and size are", async () => {
    await show()
    expect(q("[data-map-note]").textContent).toBe("Across = the participants its papers report, added up (a paper that states none adds none; the same people can be in more than one paper). Up = the share of its papers reporting benefit. Size = the number of papers.")
  })

  it("is a grid of two columns of tiles on a narrow screen, each with its participants in words, and only one of the two is shown", async () => {
    await show(ENTRIES, "medicine")
    expect(q(WIDE).className).toContain("hidden")
    expect(q(WIDE).className).toContain("sm:block")
    expect(q(NARROW).className).toContain("sm:hidden")
    const grid = q(`${NARROW} [data-bubble-grid]`)
    expect(grid.getAttribute("role")).toBe("group")
    expect(grid.getAttribute("aria-label")).toBe("Classes of treatment")
    expect(grid.className).toContain("grid-cols-2")
    expect(q(`${NARROW} svg[data-map-axes]`)).toBeNull()
    const tiles = qa(`${NARROW} button[data-bubble]`)
    // In the order they were given.
    expect(tiles.map((tile) => [tile.getAttribute("data-bubble"), tile.querySelector("[data-name]")!.textContent, tile.querySelector("[data-participants]")!.textContent])).toEqual([
      ["medicine", "Medicines", "1,240 participants"], ["psychotherapy", "Psychotherapy", "48 participants"], ["digital", "Digital tools", "participants not stated"],
    ])
    expect(tiles.map((tile) => tile.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"])
    expect(tiles[0].querySelector("[data-new]")!.textContent).toBe("+2 new")
    expect(tiles[0].getAttribute("aria-label")).toBe("Medicines: 4 papers; 3 benefit, 1 no benefit, 0 mixed; 2 new; 1,240 participants in 3 of 4 papers")
    // Every disc sits in a box of one height, so the circles share a centre line and the names a baseline.
    const boxes = tiles.map((tile) => (tile.querySelector("[data-disc-box]") as HTMLElement).style.height)
    expect(new Set(boxes).size).toBe(1)
    expect(boxes[0]).toBe("80px")
  })

  it("is still a map with one item", async () => {
    await show([ENTRIES[0]])
    expect(qa(`${WIDE} button[data-bubble]`)).toHaveLength(1)
    expect(qa(`${WIDE} [data-tick]`)).toHaveLength(4)
  })

  it("is the grid alone, with a line that says why, when no item states its participants", async () => {
    await show([entry("a", { participants: null, sized: 0 }), entry("b", { participants: null, sized: 0 })])
    expect(q(WIDE)).toBeNull()
    expect(q(NARROW)).toBeNull()
    expect(q("svg[data-map-axes]")).toBeNull()
    expect(q("[data-map-note]")).toBeNull()
    const only = q('[data-evidence-map="grid"]')
    expect(only.className).not.toContain("hidden")
    expect(only.querySelector("[data-map-none]")!.textContent).toBe("None of these papers states its participants, so they are shown side by side, not on a map.")
    expect(only.querySelector("[data-bubble-grid]")!.className).toContain("evidence-tiles")
    expect(qa("button[data-bubble]")).toHaveLength(2)
    expect(qa("[data-participants]")).toHaveLength(0)
  })
})
