// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Study } from "@/lib/clinical/evidence/build"
import { DirectionPlot } from "../DirectionPlot"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const study = (n: number, over: Partial<Study> = {}): Study => ({
  key: `pmid:${n}`, slug: `paper-${n}`, headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, label: `Smith 202${n}`, venue: "A Journal", date: "2026-09-20",
  design: "randomized-trial", designNamed: true, population: null, sampleSize: 120, comparator: null, outcome: null,
  kind: "benefit", text: `Text ${n}`, treatment: "Ketamine", severalTreatments: false, tier: "trial", isNew: false, saved: false, ...over,
})

let container: HTMLDivElement
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(node) })
}
const q = (selector: string) => container.querySelector(selector) as HTMLElement
const qa = (selector: string) => [...container.querySelectorAll(selector)] as HTMLElement[]
beforeEach(() => { document.body.innerHTML = "" })

describe("the direction plot of a treatment", () => {
  it("has a labelled row for each tier of design that has a study, in order, and leaves out the others", async () => {
    await render(<DirectionPlot name="Ketamine" studies={[study(1), study(2, { tier: "synthesis" })]} />)
    expect(qa("[data-tier]").map((row) => [row.getAttribute("data-tier"), row.querySelector("[data-tier-label]")!.textContent])).toEqual([["synthesis", "Reviews and meta-analyses"], ["trial", "Trials"]])
    document.body.innerHTML = ""
    await render(<DirectionPlot name="Ketamine" studies={[study(3, { tier: "observational" })]} />)
    expect(qa("[data-tier-label]").map((label) => label.textContent)).toEqual(["Observational and other"])
  })

  it("links one dot per study to its paper, coloured by what it found, and says the same in words", async () => {
    await render(<DirectionPlot name="Ketamine" studies={[study(1), study(2, { kind: "no-benefit", text: "No better than placebo" }), study(3, { kind: "mixed", text: null, label: null })]} />)
    const dots = qa("a[data-dot]")
    expect(dots.map((dot) => dot.getAttribute("href"))).toEqual(["/paper/paper-1", "/paper/paper-2", "/paper/paper-3"])
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual([
      "Smith 2021: Benefit (Text 1), n = 120", "Smith 2022: No benefit (No better than placebo), n = 120", "Headline 3: Mixed, n = 120",
    ])
    expect(dots.map((dot) => dot.getAttribute("title"))).toEqual(dots.map((dot) => dot.getAttribute("aria-label")))
    expect(dots.map((dot) => dot.querySelector("circle")!.getAttribute("fill"))).toEqual(["var(--clinical-benefit)", "var(--clinical-no-benefit)", expect.stringContaining("var(--text-muted)")])
    expect(dots.every((dot) => dot.querySelector("svg")!.getAttribute("aria-hidden") === "true")).toBe(true)
  })

  it("draws a larger dot for more participants, and a hollow small one when they are not known", async () => {
    await render(<DirectionPlot name="Ketamine" studies={[study(1, { sampleSize: 20 }), study(2, { sampleSize: 2000 }), study(3, { sampleSize: null })]} />)
    const radius = (key: string) => Number(q(`a[data-dot="${key}"] circle`).getAttribute("r"))
    expect(radius("pmid:2")).toBeGreaterThan(radius("pmid:1"))
    expect(radius("pmid:2")).toBeLessThanOrEqual(16)
    expect(radius("pmid:3")).toBe(5)
    const hollow = q('a[data-dot="pmid:3"] circle')
    expect(hollow.getAttribute("fill")).toBe("none")
    expect(hollow.getAttribute("stroke")).toBe("var(--clinical-benefit)")
    expect(q('a[data-dot="pmid:3"]').getAttribute("aria-label")).toBe("Smith 2023: Benefit (Text 3), n = not stated")
  })

  it("says what a dot is under the rows, and names the plot", async () => {
    await render(<DirectionPlot name="Ketamine" studies={[study(1)]} />)
    expect(q("[data-plot-key]").textContent).toBe("Each dot is one paper. Larger dots have more participants.")
    expect(q("[data-testid=direction-plot]").getAttribute("aria-label")).toBe("Papers on Ketamine, by design and by what they found")
    expect(q("[data-tier-dots]").className).toContain("overflow-x-auto")
  })
})
