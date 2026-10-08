// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { BubbleGrid, discBoxHeight } from "../BubbleGrid"
import { EvidenceBubble } from "../EvidenceBubble"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(node) })
}
const q = (selector: string) => container.querySelector(selector) as HTMLElement
const qa = (selector: string) => [...container.querySelectorAll(selector)] as HTMLElement[]
beforeEach(() => { document.body.innerHTML = "" })

describe("a bubble of the evidence summary", () => {
  it("is a button with its number inside, its name under it, and a label that says what the colours say", async () => {
    await render(<EvidenceBubble id="medicine" name="Medicines" papers={4} efficacy={{ benefit: 3, "no-benefit": 1, mixed: 0 }} newPapers={2} pressed={false} onPick={() => {}} />)
    const button = q("button[data-bubble=medicine]")
    expect(button.getAttribute("type")).toBe("button")
    expect(button.getAttribute("aria-label")).toBe("Medicines: 4 papers; 3 benefit, 1 no benefit, 0 mixed; 2 new")
    expect(button.getAttribute("aria-pressed")).toBe("false")
    const svg = button.querySelector("svg")!
    expect(svg.getAttribute("aria-hidden")).toBe("true")
    expect([svg.getAttribute("width"), svg.getAttribute("height")]).toEqual(["72", "72"])
    expect(svg.querySelector("[data-number]")!.textContent).toBe("4")
    expect(button.querySelector("[data-name]")!.textContent).toBe("Medicines")
    expect(button.querySelector("[data-new]")!.textContent).toBe("+2 new")
    expect(button.querySelector("[data-safety-mark]")).toBeNull()
    expect(svg.querySelector("[data-safety-ring]")).toBeNull()
  })

  it("draws two kinds as two wedges in order, in the colours of the directions, with the number on a plain centre", async () => {
    await render(<EvidenceBubble id="medicine" name="Medicines" papers={4} efficacy={{ benefit: 3, "no-benefit": 1, mixed: 0 }} pressed={false} onPick={() => {}} />)
    const slices = qa("svg path[data-slice]")
    expect(slices.map((slice) => [slice.getAttribute("data-slice"), slice.getAttribute("fill")])).toEqual([["benefit", "var(--clinical-benefit)"], ["no-benefit", "var(--clinical-no-benefit)"]])
    expect(slices[0].getAttribute("d")).toBe("M 36 36 L 36 0 A 36 36 0 1 1 0 36 Z")
    expect(slices[1].getAttribute("d")).toBe("M 36 36 L 0 36 A 36 36 0 0 1 36 0 Z")
    expect(qa("svg circle[data-slice]")).toHaveLength(0)
    expect(q("svg [data-hole]").getAttribute("fill")).toBe("var(--surface-light)")
    expect(q("svg [data-number]").getAttribute("fill")).toBe("var(--text-primary)")
    expect(q("[data-new]")).toBeNull()
  })

  it("draws one kind as one full circle, and mixed in the muted colour, thinned", async () => {
    await render(<EvidenceBubble id="ect" name="ECT" papers={1} efficacy={{ benefit: 0, "no-benefit": 0, mixed: 1 }} pressed={false} onPick={() => {}} />)
    expect(qa("svg path[data-slice]")).toHaveLength(0)
    const full = qa("svg circle[data-slice]")
    expect(full).toHaveLength(1)
    expect(full[0].getAttribute("data-slice")).toBe("mixed")
    expect(full[0].getAttribute("fill")).toContain("var(--text-muted)")
    expect(full[0].getAttribute("fill")).toContain("color-mix(")
    expect(q("button").getAttribute("aria-label")).toBe("ECT: 1 paper; 0 benefit, 0 no benefit, 1 mixed")
    expect(q("svg").getAttribute("width")).toBe("54")
  })

  it("marks the safety papers of a treatment with a ring and with words", async () => {
    await render(<EvidenceBubble id="ketamine" name="Ketamine" papers={2} efficacy={{ benefit: 2, "no-benefit": 0, mixed: 0 }} safetyPapers={3} pressed={false} onPick={() => {}} />)
    expect(q("[data-safety-mark]").textContent).toBe("3 safety")
    // The words are in the colour of text; the violet of the ring is on a small ring before them.
    expect(q("[data-safety-mark]").style.color).toBe("var(--text-primary)")
    const swatch = q("[data-safety-mark] [data-safety-swatch]")
    expect(swatch.style.borderColor).toBe("var(--viz-cat-3)")
    expect(swatch.getAttribute("aria-hidden")).toBe("true")
    expect(swatch.textContent).toBe("")
    expect(q("svg [data-safety-ring]").getAttribute("stroke")).toBe("var(--viz-cat-3)")
    expect(q("svg [data-safety-ring]").getAttribute("fill")).toBe("none")
    expect(q("button").getAttribute("aria-label")).toBe("Ketamine: 2 papers; 2 benefit, 0 no benefit, 0 mixed; 3 safety")
  })

  it("says in words in how many papers the treatment was the comparison, only when there are some", async () => {
    await render(<EvidenceBubble id="olanzapine" name="Olanzapine" papers={2} efficacy={{ benefit: 2, "no-benefit": 0, mixed: 0 }} safetyPapers={1} comparatorPapers={3} pressed={false} onPick={() => {}} />)
    expect(q("[data-compared-mark]").textContent).toBe("compared in 3")
    expect(q("[data-compared-mark]").className).toContain("text-secondary-dark")
    expect(q("[data-safety-mark]").textContent).toBe("1 safety")
    expect(q("button").getAttribute("aria-label")).toBe("Olanzapine: 2 papers; 2 benefit, 0 no benefit, 0 mixed; 1 safety; the comparison in 3 other papers")
    // The number in the disc and its colours are of the treatment's own papers.
    expect(q("svg [data-number]").textContent).toBe("2")
    expect(qa("svg [data-slice]").map((slice) => slice.getAttribute("data-slice"))).toEqual(["benefit"])
    document.body.innerHTML = ""
    await render(<EvidenceBubble id="olanzapine" name="Olanzapine" papers={2} efficacy={{ benefit: 2, "no-benefit": 0, mixed: 0 }} comparatorPapers={1} pressed={false} onPick={() => {}} />)
    expect(q("button").getAttribute("aria-label")).toBe("Olanzapine: 2 papers; 2 benefit, 0 no benefit, 0 mixed; the comparison in 1 other paper")
    document.body.innerHTML = ""
    await render(<EvidenceBubble id="olanzapine" name="Olanzapine" papers={2} efficacy={{ benefit: 2, "no-benefit": 0, mixed: 0 }} comparatorPapers={0} pressed={false} onPick={() => {}} />)
    expect(q("[data-compared-mark]")).toBeNull()
    expect(q("button").getAttribute("aria-label")).toBe("Olanzapine: 2 papers; 2 benefit, 0 no benefit, 0 mixed")
  })

  it("is a plain light disc with no direction when it is given no efficacy", async () => {
    await render(<EvidenceBubble id="mechanism" name="Mechanisms" papers={4} pressed={false} onPick={() => {}} />)
    expect(qa("svg [data-slice]")).toHaveLength(0)
    const disc = q("svg [data-disc]")
    expect(disc.getAttribute("fill")).toContain("var(--accent)")
    expect(disc.getAttribute("fill")).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(q("svg [data-number]").textContent).toBe("4")
    expect(q("button").getAttribute("aria-label")).toBe("Mechanisms: 4 papers")
  })

  it("says when it is the chosen one, and tells its owner when it is pressed", async () => {
    const onPick = vi.fn()
    await render(
      <BubbleGrid label="Classes of treatment">
        <EvidenceBubble id="a" name="A" papers={1} pressed onPick={onPick} />
        <EvidenceBubble id="b" name="B" papers={1} pressed={false} onPick={() => {}} />
      </BubbleGrid>,
    )
    const grid = q("[data-bubble-grid]")
    expect(grid.getAttribute("role")).toBe("group")
    expect(grid.getAttribute("aria-label")).toBe("Classes of treatment")
    expect(qa("button").map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"])
    await act(async () => { q("button[data-bubble=a]").click() })
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it("sits on a grid of equal tiles: as many columns as fit, or two, and never a wrapping row", async () => {
    await render(<BubbleGrid label="Safety papers, by treatment"><EvidenceBubble id="a" name="A" papers={1} pressed={false} onPick={() => {}} /></BubbleGrid>)
    expect(q("[data-bubble-grid]").className).toContain("grid")
    expect(q("[data-bubble-grid]").className).toContain("evidence-tiles")
    expect(q("[data-bubble-grid]").className).toContain("items-start")
    expect(q("[data-bubble-grid]").className).not.toContain("flex-wrap")
    document.body.innerHTML = ""
    await render(<BubbleGrid label="Classes of treatment" columns="two"><EvidenceBubble id="a" name="A" papers={1} pressed={false} onPick={() => {}} /></BubbleGrid>)
    expect(q("[data-bubble-grid]").className).toContain("grid-cols-2")
    expect(q("[data-bubble-grid]").className).not.toContain("evidence-tiles")
  })

  it("centres its disc in a box of the height it is given, keeps two lines for its name, and writes a small line under it when given one", async () => {
    // The largest of 1, 4 and 40 papers has a radius of 72: a box of 144 and room for the ring.
    expect(discBoxHeight([1, 4, 40])).toBe(152)
    expect(discBoxHeight([1])).toBe(62)
    await render(
      <BubbleGrid label="Classes of treatment">
        <EvidenceBubble id="a" name="A" papers={1} discHeight={152} detail="48 participants" position="48 participants in 1 of 1 paper" pressed={false} onPick={() => {}} />
        <EvidenceBubble id="b" name="B" papers={40} discHeight={152} pressed={false} onPick={() => {}} />
      </BubbleGrid>,
    )
    const boxes = qa("button [data-disc-box]")
    expect(boxes.map((box) => box.style.height)).toEqual(["152px", "152px"])
    expect(boxes.every((box) => box.className.includes("items-center") && box.className.includes("justify-center"))).toBe(true)
    expect(boxes.map((box) => box.querySelector("svg")!.getAttribute("width"))).toEqual(["54", "144"])
    expect(qa("button").every((button) => button.className.includes("w-full"))).toBe(true)
    // Two lines of 18 px for a name of 14 px in medium weight; the number in a disc is 15 px, semibold.
    expect(qa("[data-name]").every((name) => ["min-h-9", "leading-[18px]", "text-[14px]", "font-medium"].every((each) => name.className.split(" ").includes(each)))).toBe(true)
    expect(qa("[data-number]").map((number) => [number.getAttribute("font-size"), number.getAttribute("font-weight")])).toEqual([["15", "600"], ["15", "600"]])
    expect(q("button[data-bubble=a] [data-participants]").className).toContain("text-[12px]")
    // The disc grows a little under the pointer.
    expect(qa("button [data-disc-box] > span").every((ground) => ["transition-transform", "group-hover:scale-105"].every((each) => ground.className.split(" ").includes(each)))).toBe(true)
    expect(q("button[data-bubble=a] [data-participants]").textContent).toBe("48 participants")
    expect(q("button[data-bubble=a]").getAttribute("aria-label")).toBe("A: 1 paper; 48 participants in 1 of 1 paper")
    expect(q("button[data-bubble=b] [data-participants]")).toBeNull()
    // A disc is never wider than its tile.
    expect(q("button[data-bubble=b] svg").getAttribute("class")).toContain("max-w-full")
  })
})
