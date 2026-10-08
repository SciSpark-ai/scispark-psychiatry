// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { BubbleRow } from "../BubbleRow"
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
    expect(q("svg [data-safety-ring]").getAttribute("stroke")).toBe("var(--viz-cat-3)")
    expect(q("svg [data-safety-ring]").getAttribute("fill")).toBe("none")
    expect(q("button").getAttribute("aria-label")).toBe("Ketamine: 2 papers; 2 benefit, 0 no benefit, 0 mixed; 3 safety")
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
      <BubbleRow label="Classes of treatment">
        <EvidenceBubble id="a" name="A" papers={1} pressed onPick={onPick} />
        <EvidenceBubble id="b" name="B" papers={1} pressed={false} onPick={() => {}} />
      </BubbleRow>,
    )
    const row = q("[data-bubble-row]")
    expect(row.getAttribute("role")).toBe("group")
    expect(row.getAttribute("aria-label")).toBe("Classes of treatment")
    expect(row.className).toContain("flex-wrap")
    expect(qa("button").map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"])
    await act(async () => { q("button[data-bubble=a]").click() })
    expect(onPick).toHaveBeenCalledTimes(1)
  })
})
