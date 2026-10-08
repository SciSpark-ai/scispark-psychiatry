// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { ClassEvidence, ConditionEvidence as Evidence, Efficacy, SafetyGroup, Study, TreatmentEvidence } from "@/lib/clinical/evidence/build"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = vi.hoisted(() => ({ loadConditionEvidenceRemote: vi.fn() }))
vi.mock("@/lib/clinical/evidence/client", () => client)

import { ConditionEvidence } from "../ConditionEvidence"
import { clinicalFence } from "../clinical-fence"

const efficacy = (over: Partial<Efficacy> = {}): Efficacy => ({ benefit: 0, "no-benefit": 0, mixed: 0, ...over })
const lines = (over: Partial<TreatmentEvidence["lines"]> = {}): TreatmentEvidence["lines"] => ({ benefit: [], "no-benefit": [], mixed: [], safety: [], ...over })
const study = (n: number, over: Partial<Study> = {}): Study => ({
  key: `pmid:${n}`, slug: `paper-${n}`, headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, label: `Smith 2026`, venue: "A Journal", date: "2026-09-20",
  design: "randomized-trial", designNamed: true, population: "adults with depression", sampleSize: 120, comparator: "placebo", outcome: "depressive symptoms",
  kind: "benefit", text: `Text ${n}`, treatment: "Ketamine", severalTreatments: false, tier: "trial", isNew: false, saved: false, ...over,
})
const treatment = (key: string, name: string, studies: Study[], over: Partial<TreatmentEvidence> = {}): TreatmentEvidence => ({
  key, name, papers: studies.length, efficacy: efficacy({ benefit: studies.length }), newPapers: 0, participants: null, sized: 0, safetyPapers: 0, unreportedPapers: 0, comparatorPapers: 0, comparedIn: [], lines: lines(), studies, ...over,
})
const klass = (key: string, label: string | null, treatments: TreatmentEvidence[], over: Partial<ClassEvidence> = {}): ClassEvidence => ({
  key, label, papers: treatments.reduce((sum, entry) => sum + entry.papers, 0), efficacy: efficacy({ benefit: 1 }), newPapers: 0, participants: null, sized: 0, treatments, ...over,
})
const ketamine = treatment("ketamine", "Ketamine", [study(1), study(2, { kind: "no-benefit", text: "No better than placebo", sampleSize: null })], {
  efficacy: efficacy({ benefit: 1, "no-benefit": 1 }), lines: lines({ benefit: [{ text: "Eased symptoms within a day", key: "pmid:1" }], "no-benefit": [{ text: "No better than placebo", key: "pmid:2" }] }),
})
const lithium = treatment("lithium", "Lithium", [study(3, { treatment: "Lithium", text: "Cut relapse" })], { lines: lines({ benefit: [{ text: "Cut relapse", key: "pmid:3" }] }) })
const safetyGroup = (key: string, name: string, studies: Study[]): SafetyGroup => ({ key, name, classKey: "medicine", papers: studies.length, newPapers: 0, studies })
const med = klass("medicine", null, [ketamine, lithium], { papers: 4, newPapers: 2, efficacy: efficacy({ benefit: 3, "no-benefit": 1 }) })
const ect = klass("neuromodulation", "Neuromodulation", [treatment("ect", "ECT", [study(4, { treatment: "ECT" })])], { papers: 1, efficacy: efficacy({ benefit: 1 }) })
const EVIDENCE: Evidence = {
  condition: { code: "depression", name: "Major depressive disorder" }, period: "all", scope: "all", total: 8, collected: 8, savedCount: 0, since: "2026-03-02",
  sections: { treatments: 5, safety: 1, research: 2 },
  classes: [med, ect], safety: [safetyGroup("sertraline", "Sertraline", [study(7, { kind: "safety", treatment: "Sertraline" })])],
  research: [
    { type: "mechanism", papers: 1, newPapers: 0, studies: [study(5, { treatment: null, kind: null, takeaway: "Inflammation tracks severity." })] },
    { type: "risk-factor", papers: 1, newPapers: 0, studies: [study(6, { treatment: null, kind: null })] },
  ],
  timeline: { months: ["2026-08", "2026-09", "2026-10"], series: [{ key: "medicine", label: null, counts: [0, 3, 0] }, { key: "other", label: null, counts: [1, 0, 0] }] },
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
  await act(async () => {})
}
/** The same block with other props, as the Evidence view gives them when its address changes. */
const again = async (node: React.ReactNode) => { await act(async () => { root.render(node) }) }
const show = async (evidence: Evidence = EVIDENCE) => { client.loadConditionEvidenceRemote.mockResolvedValue(evidence); await render(<ConditionEvidence condition="depression" />) }
const q = (selector: string) => container.querySelector(selector) as HTMLElement
const qa = (selector: string) => [...container.querySelectorAll(selector)] as HTMLElement[]
const click = async (element: Element | null) => { await act(async () => { (element as HTMLElement).click() }) }
const bubble = (key: string, within = "") => q(`${within} button[data-bubble="${key}"]`.trim())
const section = (name: string) => q(`section[data-section="${name}"]`)
const pick = (key: string, within = "") => click(bubble(key, within))
/** Opens a class and one of its treatments. */
const openTreatment = async (classKey: string, key: string) => { await pick(classKey, "[data-classes]"); await pick(key, "[data-treatments]") }
const WIDE = '[data-evidence-map="wide"]'
const NARROW = '[data-evidence-map="narrow"]'
/** The same evidence with the participants stated, so the Treatments section is a map. */
const sizedKetamine: TreatmentEvidence = { ...ketamine, participants: 120, sized: 1, safetyPapers: 2, comparatorPapers: 1, studies: [study(1, { date: "2026-09-28" }), study(2, { kind: "no-benefit", text: "No better than placebo", sampleSize: null, date: "2026-08" })] }
const sizedLithium: TreatmentEvidence = { ...lithium, participants: 2400, sized: 1, studies: [study(3, { treatment: "Lithium", text: "Cut relapse", date: "2026-09-10" })] }
const SIZED: Evidence = { ...EVIDENCE, classes: [{ ...med, participants: 2520, sized: 2, treatments: [sizedKetamine, sizedLithium] }, { ...ect, participants: 60, sized: 1 }] }
const heads = () => qa("table thead th").map((head) => head.textContent)
beforeEach(() => { document.body.innerHTML = ""; client.loadConditionEvidenceRemote.mockReset() })

describe("the evidence block of a condition page", () => {
  it("says what it is built from, with and without a period", async () => {
    await show()
    expect(client.loadConditionEvidenceRemote).toHaveBeenCalledWith("depression", { period: "all", scope: "all" })
    expect(q("[data-testid=evidence-basis]").textContent).toBe("From the 8 papers your feed has listed on Major depressive disorder since 2026-03-02. Not all the evidence on it; papers are counted, nothing is pooled.")
    document.body.innerHTML = ""
    await show({ ...EVIDENCE, period: "6m", total: 3, collected: 5 })
    expect(q("[data-testid=evidence-basis]").textContent).toContain("3 of 5 papers")
    expect(q("[data-testid=evidence-basis]").textContent).toContain("published in the last 6 months")
    expect(q("[data-testid=evidence-basis]").textContent).toContain("nothing is pooled")
  })

  it("asks again with a new period or scope, and keeps the old content, dimmed, until the answer comes", async () => {
    await show()
    let answer: (value: Evidence) => void = () => {}
    client.loadConditionEvidenceRemote.mockReturnValue(new Promise<Evidence>((resolve) => { answer = resolve }))
    await again(<ConditionEvidence condition="depression" period="6m" />)
    expect(client.loadConditionEvidenceRemote).toHaveBeenLastCalledWith("depression", { period: "6m", scope: "all" })
    expect(bubble("medicine")).not.toBeNull()
    expect(q("[data-testid=condition-evidence]").getAttribute("aria-busy")).toBe("true")
    await act(async () => { answer({ ...EVIDENCE, period: "6m", total: 1, collected: 5, classes: [ect] }) })
    expect(bubble("medicine")).toBeNull()
    expect(q("[data-testid=condition-evidence]").getAttribute("aria-busy")).toBeNull()
    client.loadConditionEvidenceRemote.mockReturnValue(new Promise<Evidence>(() => {}))
    await again(<ConditionEvidence condition="depression" period="6m" scope="saved" />)
    expect(client.loadConditionEvidenceRemote).toHaveBeenLastCalledWith("depression", { period: "6m", scope: "saved" })
    expect(q("[data-testid=condition-evidence]").getAttribute("aria-busy")).toBe("true")
  })

  it("has no control of its own for the period or the scope, and tells its caller what it loaded", async () => {
    const onLoaded = vi.fn()
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, savedCount: 3 })
    await render(<ConditionEvidence condition="depression" onLoaded={onLoaded} />)
    expect(q("select")).toBeNull()
    expect(onLoaded).toHaveBeenCalledTimes(1)
    expect(onLoaded.mock.calls[0][0].savedCount).toBe(3)
  })

  it("says what the saved papers are when only those are shown, and how to see everything when none is saved", async () => {
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, scope: "saved", total: 3, savedCount: 3 })
    await render(<ConditionEvidence condition="depression" scope="saved" />)
    expect(q("[data-testid=evidence-basis]").textContent).toBe("From the 3 papers you saved to your Library on Major depressive disorder. Not all the evidence on it; papers are counted, nothing is pooled.")
    document.body.innerHTML = ""
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, scope: "saved", period: "6m", total: 1, savedCount: 3 })
    await render(<ConditionEvidence condition="depression" scope="saved" period="6m" />)
    expect(q("[data-testid=evidence-basis]").textContent).toBe("1 of the 3 papers you saved to your Library on Major depressive disorder, published in the last 6 months. Not all the evidence on it; papers are counted, nothing is pooled.")
    document.body.innerHTML = ""
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, scope: "saved", total: 0, savedCount: 0, classes: [], safety: [], research: [], sections: { treatments: 0, safety: 0, research: 0 } })
    await render(<ConditionEvidence condition="depression" scope="saved" />)
    expect(container.textContent).toContain("You have not saved a paper on Major depressive disorder to your Library yet.")
    expect(container.textContent).toContain("choose “Everything my feed listed” under Papers")
    expect(qa("section[data-section]")).toHaveLength(0)
    expect(q("details")).toBeNull()
  })

  it("stacks three sections, each under a heading with its count of distinct papers, and has no tabs of its own", async () => {
    await show({ ...EVIDENCE, sections: { treatments: 3, safety: 1, research: 2 } })
    expect(q('[role="tablist"]')).toBeNull()
    expect(q('[role="tab"]')).toBeNull()
    const sections = qa("section[data-section]")
    expect(sections.map((entry) => entry.getAttribute("data-section"))).toEqual(["treatments", "safety", "research"])
    // Not the sum of the classes (4 + 1): a paper under two classes is one paper.
    expect(sections.map((entry) => entry.querySelector("h3")!.textContent)).toEqual(["Treatments3", "Safety1", "Other research2"])
    expect(sections.map((entry) => entry.querySelector("h3 [data-section-count]")!.textContent)).toEqual(["3", "1", "2"])
    expect(sections.every((entry) => entry.getAttribute("aria-labelledby") === entry.querySelector("h3")!.id)).toBe(true)
  })

  it("says in two short lines what a bubble is, and has the colours beside the map, not in a sentence", async () => {
    await show()
    const lines = qa("section[data-section=treatments] [data-treatments-lines] > p")
    expect(lines.map((line) => line.textContent)).toEqual([
      "Each bubble is a treatment; its size is the number of papers.",
      "Colours are an AI reading of each abstract. Bubbles that would overlap are moved apart; a line shows where one belongs.",
    ])
    expect(lines.every((line) => line.className.includes("text-[13px]"))).toBe(true)
    // What is of the map only is not shown over the grid of a narrow screen.
    expect((lines[1].querySelector("[data-map-only]") as HTMLElement).textContent).toBe("Bubbles that would overlap are moved apart; a line shows where one belongs.")
    expect((lines[1].querySelector("[data-map-only]") as HTMLElement).className).toContain("hidden sm:inline")
    expect(q("[data-bubble-key]")).toBeNull()
    expect(q("[data-bubble-note]")).toBeNull()
    expect(q("[data-map-note]")).toBeNull()
    expect(section("treatments").textContent).not.toContain("A paper counts once")
    expect([...q(`${WIDE} [data-map-legend]`).querySelectorAll("[data-key-kind]")].map((entry) => entry.textContent)).toEqual(["Benefit", "No benefit", "Mixed"])
    expect(q("[data-treatments-lines]").compareDocumentPosition(bubble("medicine")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("keeps what a count and a place do not say behind a small button beside the heading, shown on a press or on focus", async () => {
    await show()
    const about = q("section[data-section=treatments] button[data-about]")
    const text = "A paper counts once, whatever its design or size, and its direction is an AI reading of its abstract. A paper that compares two treatments counts for the one it tested; the other shows it as a comparison. Across is the date of its most recent paper. Up is the participants its papers report, added up: a paper that states none adds none, and the same people can be in more than one paper. Choose a treatment to see each paper."
    expect(about.textContent).toBe("?")
    expect(about.getAttribute("aria-label")).toBe("How to read this map")
    expect(about.getAttribute("title")).toBe(text)
    expect(about.getAttribute("aria-expanded")).toBe("false")
    expect(section("treatments").querySelector("h3")!.contains(about)).toBe(false)
    expect(section("treatments").querySelector("h3")!.parentElement).toBe(about.parentElement)
    expect(q("[data-about-text]")).toBeNull()
    await click(about)
    expect(about.getAttribute("aria-expanded")).toBe("true")
    const shown = q("[data-about-text]")
    expect(shown.textContent).toBe(text)
    expect(shown.id).toBe(about.getAttribute("aria-describedby"))
    expect(text).not.toMatch(/earliest|reaches back/)
    await act(async () => { about.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    expect(q("[data-about-text]")).toBeNull()
    await act(async () => { about.focus() })
    expect(q("[data-about-text]")).not.toBeNull()
    await act(async () => { about.blur() })
    expect(q("[data-about-text]")).toBeNull()
    // The other sections have no such button.
    expect(qa("button[data-about]")).toHaveLength(1)
  })

  it("has larger headings for its sections", async () => {
    await show()
    expect(qa("section[data-section] h3").every((heading) => heading.className.includes("text-[19px]"))).toBe(true)
    expect(q("[data-testid=evidence-basis]").className).toContain("text-[13px]")
  })

  it("draws a bubble per class with its number, its name and what is new, naming the classes the pack does not", async () => {
    await show()
    const row = q(`[data-classes] ${NARROW}`)
    const bubbles = [...row.querySelectorAll("button[data-bubble]")] as HTMLElement[]
    expect(bubbles.map((entry) => entry.getAttribute("data-bubble"))).toEqual(["medicine", "neuromodulation"])
    expect(bubbles[0].querySelector("[data-number]")!.textContent).toBe("4")
    expect(bubbles[0].querySelector("[data-name]")!.textContent).toBe("Medicines")
    expect(bubbles[0].querySelector("[data-new]")!.textContent).toBe("+2 new")
    expect(bubbles[0].getAttribute("aria-label")).toBe("Medicines: 4 papers; 3 benefit, 1 no benefit, 0 mixed; 2 new; most recent paper 2026-09-20; participants not stated")
    expect(row.querySelector("[data-bubble-grid]")!.getAttribute("aria-label")).toBe("Classes of treatment")
    // No paper of this evidence states its participants: it is a map all the same, with every class in the band at the bottom.
    expect(q(`[data-classes] ${WIDE} [data-band-label]`).textContent).toBe("not stated")
    expect(qa(`[data-classes] ${WIDE} button[data-bubble]`)).toHaveLength(2)
    expect(container.textContent).not.toContain("None of these papers states")
    expect(bubbles[1].querySelector("[data-name]")!.textContent).toBe("Neuromodulation")
    expect(bubbles[1].querySelector("[data-new]")).toBeNull()
    // 4 papers: radius 36; 1 paper: radius 27.
    expect(bubbles.map((entry) => entry.querySelector("svg")!.getAttribute("width"))).toEqual(["72", "54"])
    expect([...bubbles[0].querySelectorAll("path[data-slice]")].map((slice) => slice.getAttribute("data-slice"))).toEqual(["benefit", "no-benefit"])
    expect(bubbles[1].querySelectorAll("circle[data-slice]")).toHaveLength(1)
  })

  it("has nothing chosen at first: no treatment, no line, no plot and no study row", async () => {
    await show()
    // Two classes, each on the map and in the grid of a narrow screen; one safety group; two kinds of other research.
    expect(qa("button[data-bubble]").map((entry) => entry.getAttribute("aria-pressed"))).toEqual(Array(7).fill("false"))
    expect(q("[data-treatments]")).toBeNull()
    expect(q("[data-crumb]")).toBeNull()
    expect(q("[data-testid=direction-plot]")).toBeNull()
    expect(qa("[data-study]")).toHaveLength(0)
    expect(q("table")).toBeNull()
  })

  it("opens a class to a crumb and its treatments' bubbles in place of the classes, and the crumb goes back", async () => {
    await show()
    await pick("medicine")
    // The same place now draws the treatments of the class: the bubbles of the classes are gone.
    expect(q("[data-classes]")).toBeNull()
    expect(bubble("medicine")).toBeNull()
    expect(bubble("neuromodulation")).toBeNull()
    const crumb = q("[data-crumb]")
    expect(crumb.textContent).toBe("All classes › Medicines")
    expect(crumb.querySelector("button")!.textContent).toBe("All classes")
    expect(q("[data-treatments]").getAttribute("data-treatments")).toBe("medicine")
    expect(q("[data-treatments] [data-bubble-grid]").getAttribute("aria-label")).toBe("Treatments in Medicines")
    const treatments = [...q(`[data-treatments] ${NARROW}`).querySelectorAll("button[data-bubble]")] as HTMLElement[]
    expect(treatments.map((entry) => entry.getAttribute("data-bubble"))).toEqual(["ketamine", "lithium"])
    expect(crumb.compareDocumentPosition(treatments[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(treatments[0].getAttribute("aria-label")).toBe("Ketamine: 2 papers; 1 benefit, 1 no benefit, 0 mixed; most recent paper 2026-09-20; participants not stated")
    expect(treatments.map((entry) => entry.querySelector("svg")!.getAttribute("width"))).toEqual([String(2 * Number((18 + 9 * Math.sqrt(2)).toFixed(1))), "54"])
    expect(qa("[data-study]")).toHaveLength(0)
    await click(crumb.querySelector("button"))
    expect(q("[data-treatments]")).toBeNull()
    expect(q("[data-crumb]")).toBeNull()
    expect(q("[data-classes]")).not.toBeNull()
    expect(bubble("medicine").getAttribute("aria-pressed")).toBe("false")
  })

  it("puts the keyboard on the crumb when a class opens, and back on the bubble of that class when it closes", async () => {
    await show()
    await pick("neuromodulation")
    expect(document.activeElement).toBe(q("[data-crumb] button"))
    await click(q("[data-crumb] button"))
    expect(document.activeElement).toBe(bubble("neuromodulation"))
  })

  it("shows the one bubble of a class with one treatment", async () => {
    await show()
    await pick("neuromodulation")
    expect([...q(`[data-treatments] ${WIDE}`).querySelectorAll("button[data-bubble]")].map((entry) => entry.getAttribute("data-bubble"))).toEqual(["ect"])
    expect([...q(`[data-treatments] ${NARROW}`).querySelectorAll("button[data-bubble]")].map((entry) => entry.getAttribute("data-bubble"))).toEqual(["ect"])
    expect(qa("[data-study]")).toHaveLength(0)
  })

  describe("when the papers state their participants", () => {
    it("draws the classes on a map of time by participants, and on a narrow screen as a grid of the same bubbles", async () => {
      await show(SIZED)
      expect(q(`[data-classes] ${WIDE}`).className).toContain("sm:block")
      expect(q(`[data-classes] ${NARROW}`).className).toContain("sm:hidden")
      // The newest paper of Neuromodulation is of 20 September, that of Medicines of 28 September: Medicines is to the right.
      expect(qa(`[data-classes] ${WIDE} button[data-bubble]`).map((entry) => entry.getAttribute("data-bubble"))).toEqual(["neuromodulation", "medicine"])
      expect(qa(`[data-classes] ${NARROW} button[data-bubble]`).map((entry) => entry.getAttribute("data-bubble"))).toEqual(["medicine", "neuromodulation"])
      expect(q(`${WIDE} [data-map-box]`).getAttribute("aria-label")).toBe("Classes of treatment")
      expect(qa(`${WIDE} [data-tick-y]`).map((tick) => tick.textContent)).toEqual(["10", "100", "1,000", "10,000"])
      expect(qa(`${WIDE} [data-tick-x]`).length).toBeGreaterThan(0)
      const medicine = bubble("medicine", WIDE)
      // A paper under two treatments of the class is one paper: three dates, the newest of them said.
      expect(medicine.getAttribute("aria-label")).toBe("Medicines: 4 papers; 3 benefit, 1 no benefit, 0 mixed; 2 new; most recent paper 2026-09-28; 2,520 participants in 2 of 4 papers")
      expect(medicine.querySelector("[data-name]")!.textContent).toBe("Medicines")
      expect(medicine.querySelector("[data-marks]")!.textContent).toBe("+2 new")
      expect(medicine.style.left).toMatch(/^\d+(\.\d+)?%$/)
      // 2,520 participants against 60: Medicines is higher.
      expect(parseFloat(medicine.style.top)).toBeLessThan(parseFloat(bubble("neuromodulation", WIDE).style.top))
      // Its papers are of more than one date: nothing is drawn back to the earlier ones.
      expect(qa(`${WIDE} [data-span]`)).toHaveLength(0)
      expect(q(`${NARROW} button[data-bubble=medicine] [data-participants]`).textContent).toBe("Sep 2026 · 2,520 participants")
      expect(q("[data-treatments-lines]").compareDocumentPosition(q(WIDE)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it("redraws the same map with the treatments of the pressed class, under the crumb, and goes back by the crumb", async () => {
      await show(SIZED)
      await pick("medicine", WIDE)
      expect(q("[data-classes]")).toBeNull()
      expect(qa(WIDE)).toHaveLength(1)
      expect(q("[data-crumb]").textContent).toBe("All classes › Medicines")
      expect(q(`[data-treatments] ${WIDE} [data-map-box]`).getAttribute("aria-label")).toBe("Treatments in Medicines")
      expect(q("[data-crumb]").compareDocumentPosition(q(WIDE)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // The newest paper of lithium is of 10 September, that of ketamine of 28 September: lithium is to the left.
      expect(qa(`${WIDE} button[data-bubble]`).map((entry) => entry.getAttribute("data-bubble"))).toEqual(["lithium", "ketamine"])
      expect(parseFloat(bubble("lithium", WIDE).style.left)).toBeLessThan(parseFloat(bubble("ketamine", WIDE).style.left))
      // Lithium has 2,400 participants, ketamine 120: lithium is higher.
      expect(parseFloat(bubble("lithium", WIDE).style.top)).toBeLessThan(parseFloat(bubble("ketamine", WIDE).style.top))
      expect(bubble("ketamine", WIDE).querySelector("[data-marks]")!.textContent).toBe("2 safety · compared in 1")
      expect(bubble("ketamine", WIDE).getAttribute("aria-label")).toBe("Ketamine: 2 papers; 1 benefit, 1 no benefit, 0 mixed; 2 safety; the comparison in 1 other paper; most recent paper 2026-09-28; 120 participants in 1 of 2 papers")
      await click(q("[data-crumb] button"))
      expect(q("[data-treatments]")).toBeNull()
      expect(qa(`[data-classes] ${WIDE} button[data-bubble]`)).toHaveLength(2)
      expect(document.activeElement!.getAttribute("data-bubble")).toBe("medicine")
    })

    it("opens the detail of a treatment under the map, from the map or from the grid, and closes it when pressed again", async () => {
      await show(SIZED)
      await pick("medicine", WIDE)
      expect(q("[data-treatment-detail]")).toBeNull()
      await pick("ketamine", WIDE)
      expect(bubble("ketamine", WIDE).getAttribute("aria-pressed")).toBe("true")
      expect(bubble("ketamine", NARROW).getAttribute("aria-pressed")).toBe("true")
      expect(bubble("lithium", WIDE).getAttribute("aria-pressed")).toBe("false")
      const detail = q("[data-treatment-detail]")
      expect(detail.getAttribute("data-treatment-detail")).toBe("ketamine")
      expect(q(NARROW).compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(detail.querySelector("[data-testid=direction-plot]")).not.toBeNull()
      expect(qa("[data-study]").map((row) => row.getAttribute("data-study"))).toEqual(["pmid:1", "pmid:2"])
      await pick("lithium", NARROW)
      expect(q("[data-treatment-detail]").getAttribute("data-treatment-detail")).toBe("lithium")
      await pick("lithium", WIDE)
      expect(q("[data-treatment-detail]")).toBeNull()
      expect(q("[data-treatments]")).not.toBeNull()
    })
  })

  it("marks a treatment that has safety papers in words under its bubble", async () => {
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [{ ...ketamine, safetyPapers: 2 }, lithium])] })
    await pick("medicine")
    expect(bubble("ketamine", NARROW).querySelector("[data-safety-mark]")!.textContent).toBe("2 safety")
    expect(bubble("ketamine", NARROW).querySelector("[data-safety-ring]")).not.toBeNull()
    expect(bubble("lithium", NARROW).querySelector("[data-safety-mark]")).toBeNull()
    expect(bubble("ketamine", WIDE).querySelector("[data-marks]")!.textContent).toBe("2 safety")
    expect(bubble("ketamine", WIDE).querySelector("[data-safety-ring]")).not.toBeNull()
  })

  it("opens a treatment to the lines that have text, each under its own label and colour, and never says Watch or Did", async () => {
    const many = treatment("ketamine", "Ketamine", [study(1), study(2)], {
      lines: lines({ benefit: [{ text: "Eased symptoms.", key: "a" }, { text: "Worked fast.", key: "b" }], "no-benefit": [{ text: "No better than placebo", key: "e" }], safety: [{ text: "Dissociation. ", key: "c" }], mixed: [{ text: "Faded by week 6", key: "d" }] }),
    })
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [many, lithium])] })
    await openTreatment("medicine", "ketamine")
    expect(bubble("ketamine").getAttribute("aria-pressed")).toBe("true")
    const shown = qa("[data-treatment-detail] [data-line]")
    // Each text loses its own full stop, and the line ends with one.
    expect(shown.map((line) => [line.getAttribute("data-line"), line.textContent])).toEqual([
      ["benefit", "Benefit: Eased symptoms; Worked fast."], ["no-benefit", "No benefit: No better than placebo."], ["mixed", "Mixed: Faded by week 6."], ["safety", "Safety: Dissociation."],
    ])
    expect(shown.map((line) => (line.querySelector("[data-line-label]") as HTMLElement).style.color)).toEqual(["var(--clinical-benefit)", "var(--clinical-no-benefit)", "var(--text-muted)", "var(--text-primary)"])
    expect(container.textContent).not.toMatch(/Watch|Did:/)
    await pick("lithium", "[data-treatments]")
    expect(bubble("ketamine").getAttribute("aria-pressed")).toBe("false")
    expect(qa("[data-treatment-detail] [data-line]").map((line) => line.textContent)).toEqual(["Benefit: Cut relapse."])
    expect(container.textContent).not.toMatch(/Watch|Did:/)
  })

  it("says how many more papers on the treatment are not sorted by what they found, only when there are some", async () => {
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [{ ...ketamine, unreportedPapers: 3 }, { ...lithium, unreportedPapers: 1 }])] })
    await openTreatment("medicine", "ketamine")
    expect(q("[data-unreported]").textContent).toBe("3 more papers on Ketamine are not sorted as benefit, no benefit or mixed (see Other research).")
    await pick("lithium", "[data-treatments]")
    expect(q("[data-unreported]").textContent).toBe("1 more paper on Lithium is not sorted as benefit, no benefit or mixed (see Other research).")
    document.body.innerHTML = ""
    await show()
    await openTreatment("medicine", "ketamine")
    expect(q("[data-unreported]")).toBeNull()
  })

  // Owner decision 2026-10-09: a paper counts for the treatment it tested; the other arm shows it as a comparison.
  describe("the papers a treatment was the comparison in", () => {
    const versus = [
      study(21, { label: "Kane 2026", treatment: "Esketamine", comparator: "ketamine", text: "Gave more remission.", kind: "benefit" }),
      study(22, { label: null, treatment: "lithium and quetiapine", comparator: "ketamine", text: null, takeaway: "Did not cut relapse more.", kind: "no-benefit" }),
      study(23, { label: "Lee 2025", treatment: null, comparator: "ketamine", text: "Eased symptoms", kind: "mixed" }),
    ]
    const compared = { ...ketamine, comparatorPapers: 3, comparedIn: versus }
    const open = async (entry: TreatmentEvidence) => { await show({ ...EVIDENCE, classes: [klass("medicine", null, [entry, lithium])] }); await openTreatment("medicine", "ketamine") }
    it("are listed under the lines and before the plot, each with its own treatment before its result and its own direction", async () => {
      await open(compared)
      const detail = q("[data-treatment-detail]")
      const block = detail.querySelector("[data-compared-in]") as HTMLElement
      expect(block.querySelector("[data-compared-count]")!.textContent).toBe("Used as the comparison in 3 papers:")
      const items = [...block.querySelectorAll("li[data-compared]")] as HTMLElement[]
      expect(items.map((item) => item.getAttribute("data-compared"))).toEqual(["pmid:21", "pmid:22", "pmid:23"])
      expect(items.map((item) => { const link = item.querySelector("a")!; return [link.textContent, link.getAttribute("href")] })).toEqual([["Kane 2026", "/paper/paper-21"], ["Headline 22", "/paper/paper-22"], ["Lee 2025", "/paper/paper-23"]])
      expect(items.map((item) => item.querySelector("[data-compared-result]")!.textContent)).toEqual([
        "Esketamine: Gave more remission.", "lithium and quetiapine: Did not cut relapse more.", "The treatment it tested: Eased symptoms.",
      ])
      expect(items.map((item) => { const label = item.querySelector("[data-kind-label]") as HTMLElement; return [label.textContent, label.style.color] })).toEqual([
        ["Benefit", "var(--clinical-benefit)"], ["No benefit", "var(--clinical-no-benefit)"], ["Mixed", "var(--text-muted)"],
      ])
      const lastLine = qa("[data-treatment-detail] [data-line]").at(-1)!
      expect(lastLine.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(block.compareDocumentPosition(detail.querySelector("[data-testid=direction-plot]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
    it("have no dot in the plot, no row in the table and no line of the treatment's own", async () => {
      await open(compared)
      expect(qa("[data-testid=direction-plot] a[data-dot]").map((dot) => dot.getAttribute("data-dot"))).toEqual(["pmid:1", "pmid:2"])
      expect(qa("[data-study]").map((row) => row.getAttribute("data-study"))).toEqual(["pmid:1", "pmid:2"])
      expect(qa("[data-treatment-detail] [data-line]").map((line) => line.textContent).join(" ")).not.toMatch(/remission|relapse/)
    })
    it("say paper for one, and are absent when there is none", async () => {
      await open({ ...ketamine, comparatorPapers: 1, comparedIn: [versus[0]] })
      expect(q("[data-compared-count]").textContent).toBe("Used as the comparison in 1 paper:")
      document.body.innerHTML = ""
      await open(ketamine)
      expect(q("[data-compared-in]")).toBeNull()
      expect(container.textContent).not.toContain("Used as the comparison")
    })
    it("are marked in words on the bubble of the treatment, only when there are some", async () => {
      await open(compared)
      expect(bubble("ketamine", NARROW).querySelector("[data-compared-mark]")!.textContent).toBe("compared in 3")
      expect(bubble("ketamine", WIDE).querySelector("[data-marks]")!.textContent).toBe("compared in 3")
      expect(bubble("ketamine").getAttribute("aria-label")).toContain("the comparison in 3 other papers")
      expect(bubble("lithium", NARROW).querySelector("[data-compared-mark]")).toBeNull()
    })
  })

  it("draws the direction plot of the chosen treatment and then the table of its studies", async () => {
    await show()
    await openTreatment("medicine", "ketamine")
    const detail = q("[data-treatment-detail]")
    const plot = detail.querySelector("[data-testid=direction-plot]") as HTMLElement
    expect([...plot.querySelectorAll("a[data-dot]")].map((dot) => dot.getAttribute("href"))).toEqual(["/paper/paper-1", "/paper/paper-2"])
    expect([...plot.querySelectorAll("[data-tier-label]")].map((label) => label.textContent)).toEqual(["Trials"])
    expect(plot.compareDocumentPosition(detail.querySelector("table")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(heads()).toEqual(["Study", "Design", "n", "Compared with", "Result", "Details"])
    const rows = qa("[data-study]")
    expect(rows.map((row) => row.getAttribute("data-study"))).toEqual(["pmid:1", "pmid:2"])
    const link = rows[0].querySelector("[data-cell=study] a") as HTMLAnchorElement
    expect([link.textContent, link.getAttribute("href"), link.getAttribute("title")]).toEqual(["Smith 2026", "/paper/paper-1", "A Journal"])
    // The journal is the link's title, not a line of the cell.
    expect(rows[0].querySelector("[data-cell=study]")!.textContent).toBe("Smith 2026")
    expect(rows[0].querySelector("[data-cell=design]")!.textContent).toBe("Randomized trial")
    expect(rows[0].querySelector("[data-cell=size]")!.textContent).toBe("120")
    expect(rows[1].querySelector("[data-cell=size]")!.textContent).toBe("–")
    expect(rows[0].querySelector("[data-cell=comparator]")!.textContent).toBe("placebo")
    const result = rows[1].querySelector("[data-cell=result]") as HTMLElement
    expect(result.textContent).toContain("No better than placebo")
    expect((result.querySelector("[data-kind-label]") as HTMLElement).textContent).toBe("No benefit")
    expect((result.querySelector("[data-kind-label]") as HTMLElement).style.color).toBe("var(--clinical-no-benefit)")
    expect(q("[data-table-scroll]").className).toContain("overflow-x-auto")
  })

  it("keeps the population and the outcome of a study behind a Details button, which is absent when there is neither", async () => {
    const bare = study(13, { population: null, outcome: null })
    const half = study(14, { population: null })
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [treatment("ketamine", "Ketamine", [study(1), bare, half])])] })
    await openTreatment("medicine", "ketamine")
    const button = q('[data-study="pmid:1"] [data-cell=details] button')
    expect(button.textContent).toBe("Details")
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(q("[data-details]")).toBeNull()
    expect(container.textContent).not.toContain("adults with depression")
    await click(button)
    expect(button.getAttribute("aria-expanded")).toBe("true")
    const more = q('[data-details="pmid:1"]')
    expect(more.id).toBe(button.getAttribute("aria-controls"))
    expect(q('[data-study="pmid:1"]').nextElementSibling).toBe(more)
    expect(more.textContent).toBe("Populationadults with depressionOutcomedepressive symptoms")
    await click(button)
    expect(q("[data-details]")).toBeNull()
    expect(q('[data-study="pmid:13"] [data-cell=details] button')).toBeNull()
    await click(q('[data-study="pmid:14"] [data-cell=details] button'))
    expect(q('[data-details="pmid:14"]').textContent).toBe("Outcomedepressive symptoms")
  })

  // Owner decision 2026-10-08: a paper under each treatment it names shows what it named itself.
  it("shows what the paper itself named under the study, only when it names several treatments", async () => {
    const both = study(11, { treatment: "ketamine and esketamine", severalTreatments: true })
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [treatment("ketamine", "Ketamine", [both, study(12, { treatment: "IV ketamine" })])])] })
    await openTreatment("medicine", "ketamine")
    const named = q('[data-study="pmid:11"] [data-cell=study] [data-named]')
    expect(named.textContent).toBe("ketamine and esketamine")
    expect(named.className).toContain("text-muted-text")
    expect(named.className).toContain("text-[12px]")
    expect(q('[data-study="pmid:12"] [data-named]')).toBeNull()
  })

  it("gives participants their own column: thousands separators, right-aligned tabular numerals, and a header that says what n is", async () => {
    const big = study(16, { sampleSize: 21025 })
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [treatment("ketamine", "Ketamine", [big])])] })
    await openTreatment("medicine", "ketamine")
    const cell = q('[data-study="pmid:16"] [data-cell=size]')
    expect(cell.textContent).toBe("21,025")
    expect(cell.className).toContain("text-right")
    expect(cell.className).toContain("tabular-nums")
    const head = qa("table thead th")[2]
    expect(head.getAttribute("title")).toBe("Participants, as the paper prints it")
    expect(head.className).toContain("text-right")
  })

  it("marks a new or saved study, falls back to the headline and the takeaway, and names a design or a size only when known", async () => {
    const plain = study(9, { label: null, text: null, kind: null, designNamed: false, sampleSize: null, isNew: true, saved: true, venue: null })
    const sized = study(10, { designNamed: false, sampleSize: 48 })
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [treatment("ketamine", "Ketamine", [plain, sized])])] })
    await openTreatment("medicine", "ketamine")
    const row = q('[data-study="pmid:9"]')
    expect(row.querySelector("a")!.textContent).toBe("Headline 9")
    expect(row.querySelector("a")!.hasAttribute("title")).toBe(false)
    expect(row.querySelector("[data-cell=design]")!.textContent).toBe("–")
    expect(row.querySelector("[data-cell=size]")!.textContent).toBe("–")
    expect(q('[data-study="pmid:10"] [data-cell=design]').textContent).toBe("–")
    expect(q('[data-study="pmid:10"] [data-cell=size]').textContent).toBe("48")
    expect(row.querySelector("[data-cell=result]")!.textContent).toBe("Takeaway 9.")
    expect(row.querySelector("[data-cell=result] [data-kind-label]")).toBeNull()
    expect(row.querySelector("[data-cell=study]")!.textContent).toContain("new")
    expect(row.querySelector("[data-cell=study]")!.textContent).toContain("saved")
    expect(q('[data-study="pmid:10"]').textContent).not.toContain("saved")
  })

  it("clears the chosen treatment when the reader goes back to the classes and opens one again", async () => {
    await show()
    await openTreatment("medicine", "ketamine")
    expect(q("[data-treatment-detail]")).not.toBeNull()
    await click(q("[data-crumb] button"))
    expect(q("[data-treatment-detail]")).toBeNull()
    await pick("neuromodulation", "[data-classes]")
    expect(qa("[data-treatments] button[data-bubble]").map((entry) => entry.getAttribute("aria-pressed"))).toEqual(["false", "false"])
    await click(q("[data-crumb] button"))
    await pick("medicine", "[data-classes]")
    expect(q("[data-treatment-detail]")).toBeNull()
    expect(qa("[data-treatments] button[data-bubble]").map((entry) => entry.getAttribute("aria-pressed"))).toEqual(Array(4).fill("false"))
  })

  it("draws a light bubble per safety group, opens one to the table of its studies, and says so when there are none", async () => {
    const both = study(8, { kind: "safety", treatment: "sertraline and lithium", severalTreatments: true, date: "2026-09-25" })
    await show({ ...EVIDENCE, safety: [safetyGroup("sertraline", "Sertraline", [both, study(7, { kind: "safety", treatment: "Sertraline" })]), { ...safetyGroup("lithium", "Lithium", [both]), newPapers: 1 }] })
    const bubbles = [...section("safety").querySelectorAll("button[data-bubble]")] as HTMLElement[]
    // On a grid of equal tiles: every disc in a box of one height, the height of the largest.
    const grid = section("safety").querySelector("[data-bubble-grid]") as HTMLElement
    expect([grid.getAttribute("role"), grid.getAttribute("aria-label")]).toEqual(["group", "Safety papers, by treatment"])
    expect(grid.className).toContain("evidence-tiles")
    expect(bubbles.map((entry) => entry.parentElement)).toEqual([grid, grid])
    expect(bubbles.map((entry) => (entry.querySelector("[data-disc-box]") as HTMLElement).style.height)).toEqual(Array(2).fill(`${2 * Number((18 + 9 * Math.sqrt(2)).toFixed(1)) + 8}px`))
    expect(bubbles.map((entry) => [entry.getAttribute("data-bubble"), entry.querySelector("[data-number]")!.textContent, entry.querySelector("[data-name]")!.textContent])).toEqual([["sertraline", "2", "Sertraline"], ["lithium", "1", "Lithium"]])
    expect(bubbles[0].getAttribute("aria-label")).toBe("Sertraline: 2 papers")
    expect(bubbles[1].getAttribute("aria-label")).toBe("Lithium: 1 paper; 1 new")
    expect(bubbles[1].querySelector("[data-new]")!.textContent).toBe("+1 new")
    // One light colour for all: no direction.
    expect(section("safety").querySelectorAll("[data-slice]")).toHaveLength(0)
    expect(bubbles.map((entry) => entry.querySelector("[data-disc]")!.getAttribute("fill"))).toEqual(Array(2).fill(bubbles[0].querySelector("[data-disc]")!.getAttribute("fill")))
    expect(qa("[data-study]")).toHaveLength(0)
    await click(bubbles[0])
    expect(bubbles[0].getAttribute("aria-pressed")).toBe("true")
    expect(heads()).toEqual(["Study", "Design", "n", "Compared with", "Result", "Details"])
    expect([...section("safety").querySelectorAll("[data-study]")].map((row) => row.getAttribute("data-study"))).toEqual(["pmid:8", "pmid:7"])
    expect(q('[data-study="pmid:8"] [data-named]').textContent).toBe("sertraline and lithium")
    expect(q("[data-testid=direction-plot]")).toBeNull()
    await click(bubbles[0])
    expect(qa("[data-study]")).toHaveLength(0)
    document.body.innerHTML = ""
    await show({ ...EVIDENCE, safety: [] })
    expect(section("safety").querySelector("p")!.textContent).toBe("No safety findings among these papers.")
    expect(section("safety").querySelectorAll("button[data-bubble]")).toHaveLength(0)
  })

  it("draws a light bubble per group of other research, opens one to its table, and names the papers with no efficacy result", async () => {
    const unreported = study(15, { kind: "other", treatment: "Ketamine", takeaway: "Ketamine changed sleep." })
    await show({ ...EVIDENCE, research: [{ ...EVIDENCE.research[0], papers: 3, newPapers: 2 }, EVIDENCE.research[1], { type: "no-efficacy", papers: 1, newPapers: 0, studies: [unreported] }] })
    const bubbles = [...section("research").querySelectorAll("button[data-bubble]")] as HTMLElement[]
    const grid = section("research").querySelector("[data-bubble-grid]") as HTMLElement
    expect([grid.getAttribute("role"), grid.getAttribute("aria-label")]).toEqual(["group", "Other research, by kind"])
    expect(grid.className).toContain("evidence-tiles")
    // Three papers at the most: a radius of 33.6, so every disc is in a box of 75.2.
    expect(bubbles.map((entry) => (entry.querySelector("[data-disc-box]") as HTMLElement).style.height)).toEqual(Array(3).fill("75.2px"))
    expect(bubbles.map((entry) => [entry.getAttribute("data-bubble"), entry.querySelector("[data-name]")!.textContent, entry.querySelector("[data-number]")!.textContent]))
      .toEqual([["mechanism", "Mechanisms", "3"], ["risk-factor", "Risk factors", "1"], ["no-efficacy", "Treatment studied, not sorted by result", "1"]])
    expect(bubbles[0].querySelector("[data-new]")!.textContent).toBe("+2 new")
    expect(bubbles[1].querySelector("[data-new]")).toBeNull()
    expect(section("research").querySelectorAll("[data-slice]")).toHaveLength(0)
    expect(qa("[data-study]")).toHaveLength(0)
    await click(bubbles[0])
    expect(heads()).toEqual(["Study", "Design", "n", "Finding", "Details"])
    expect(q("[data-study] [data-cell=finding]").textContent).toBe("Inflammation tracks severity.")
    expect(q("[data-study] [data-cell=design]").textContent).toBe("Randomized trial")
    expect(q("[data-study] [data-cell=size]").textContent).toBe("120")
    expect(q("[data-study] [data-named]")).toBeNull()
    await click(bubbles[2])
    expect(bubbles.map((entry) => entry.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"])
    expect(qa("[data-study]").map((row) => row.getAttribute("data-study"))).toEqual(["pmid:15"])
    expect(q("[data-study] [data-named]").textContent).toBe("Ketamine")
    expect(q("[data-study] [data-cell=finding]").textContent).toBe("Ketamine changed sleep.")
  })

  it("keeps what is chosen in each section apart", async () => {
    await show()
    await openTreatment("medicine", "ketamine")
    await pick("sertraline", "[data-section=safety]")
    await pick("mechanism", "[data-section=research]")
    expect(section("treatments").querySelectorAll("[data-study]")).toHaveLength(2)
    expect(section("safety").querySelectorAll("[data-study]")).toHaveLength(1)
    expect(section("research").querySelectorAll("[data-study]")).toHaveLength(1)
  })

  it("starts again with nothing chosen on another condition", async () => {
    await show()
    await openTreatment("medicine", "ketamine")
    await pick("sertraline", "[data-section=safety]")
    await pick("mechanism", "[data-section=research]")
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, condition: { code: "adhd", name: "ADHD" } })
    await again(<ConditionEvidence condition="adhd" />)
    await act(async () => {})
    expect(q("[data-testid=evidence-basis]").textContent).toContain("ADHD")
    expect(qa("button[data-bubble]").map((entry) => entry.getAttribute("aria-pressed"))).toEqual(Array(7).fill("false"))
    expect(q("[data-treatments]")).toBeNull()
    expect(qa("[data-study]")).toHaveLength(0)
  })

  it("keeps what is chosen over a new period while it is still there, and drops it for good when it is not", async () => {
    await show()
    await openTreatment("medicine", "ketamine")
    await pick("sertraline", "[data-section=safety]")
    // Still there: lithium is gone from the class, ketamine is not.
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, period: "12m", classes: [{ ...med, treatments: [ketamine] }, ect] })
    await again(<ConditionEvidence condition="depression" period="12m" />)
    await act(async () => {})
    expect(bubble("ketamine").getAttribute("aria-pressed")).toBe("true")
    expect(section("treatments").querySelectorAll("[data-study]")).toHaveLength(2)
    expect(section("safety").querySelectorAll("[data-study]")).toHaveLength(1)
    // The treatment is gone: its class stays open, the detail goes.
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, period: "6m", classes: [{ ...med, treatments: [lithium] }], safety: [] })
    await again(<ConditionEvidence condition="depression" period="6m" />)
    await act(async () => {})
    expect(q("[data-treatments]").getAttribute("data-treatments")).toBe("medicine")
    expect(q("[data-crumb]").textContent).toBe("All classes › Medicines")
    expect(q("[data-treatment-detail]")).toBeNull()
    expect(qa("[data-study]")).toHaveLength(0)
    // Back again: it is not chosen any more.
    client.loadConditionEvidenceRemote.mockResolvedValue(EVIDENCE)
    await again(<ConditionEvidence condition="depression" />)
    await act(async () => {})
    expect(bubble("ketamine").getAttribute("aria-pressed")).toBe("false")
    expect(bubble("sertraline").getAttribute("aria-pressed")).toBe("false")
    expect(qa("[data-study]")).toHaveLength(0)
    // The class is gone: nothing of it is left.
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, period: "3m", classes: [ect] })
    await again(<ConditionEvidence condition="depression" period="3m" />)
    await act(async () => {})
    expect(q("[data-treatments]")).toBeNull()
    expect(q("[data-crumb]")).toBeNull()
    expect(qa(`[data-classes] ${WIDE} button[data-bubble]`).map((entry) => entry.getAttribute("data-bubble"))).toEqual(["neuromodulation"])
  })

  it("says so in a section that has no paper", async () => {
    await show({ ...EVIDENCE, classes: [], research: [], sections: { treatments: 0, safety: 1, research: 0 } })
    expect(section("treatments").querySelector("p[data-empty]")!.textContent).toBe("None of these papers reports whether a treatment worked.")
    expect(q("[data-map-legend]")).toBeNull()
    expect(q("[data-treatments-lines]")).toBeNull()
    expect(q("button[data-about]")).toBeNull()
    expect(section("research").querySelector("p[data-empty]")!.textContent).toBe("No other research among these papers.")
  })

  it("has no timeline of when the papers were published", async () => {
    await show()
    expect(q("details")).toBeNull()
    expect(container.textContent).not.toContain("When they were published")
    expect(qa("rect[data-month]")).toHaveLength(0)
    expect(q("[data-testid=condition-evidence]").lastElementChild!.getAttribute("data-section")).toBe("research")
  })

  it("says so when nothing was published in the period", async () => {
    await show({ ...EVIDENCE, period: "3m", total: 0, collected: 5, classes: [], safety: [], research: [] })
    expect(container.textContent).toContain("No paper on Major depressive disorder was published in the last 3 months. 5 are collected in all.")
    expect(qa("section[data-section]")).toHaveLength(0)
    expect(qa("button[data-bubble]")).toHaveLength(0)
  })

  it("says so when nothing is collected, when no condition is named, while loading, and on an error", async () => {
    await show({ ...EVIDENCE, total: 0, collected: 0, classes: [], safety: [], research: [], timeline: { months: [], series: [] } })
    expect(container.textContent).toContain("Your feed has not listed a paper on Major depressive disorder yet")
    document.body.innerHTML = ""
    await render(<ConditionEvidence condition={null} />)
    expect(container.textContent).toContain("This block does not name a condition")
    document.body.innerHTML = ""
    client.loadConditionEvidenceRemote.mockReturnValue(new Promise(() => {}))
    await render(<ConditionEvidence condition="depression" />)
    expect(container.textContent).toContain("Counting…")
    document.body.innerHTML = ""
    client.loadConditionEvidenceRemote.mockRejectedValue(new Error("That condition is not in the pack."))
    await render(<ConditionEvidence condition="zzz" />)
    expect(q('[role="alert"]').textContent).toContain("not in the pack")
  })

  it("is drawn from a page's block with everything listed, of all time, and says so for a block that names no condition", async () => {
    client.loadConditionEvidenceRemote.mockResolvedValue(EVIDENCE)
    await render(clinicalFence("condition-evidence", "condition: depression"))
    expect(client.loadConditionEvidenceRemote).toHaveBeenCalledWith("depression", { period: "all", scope: "all" })
    expect(q("[data-testid=evidence-basis]")).not.toBeNull()
    // An old page draws the same three sections, with nothing chosen.
    expect(qa("section[data-section]").map((entry) => entry.getAttribute("data-section"))).toEqual(["treatments", "safety", "research"])
    expect(bubble("medicine")).not.toBeNull()
    document.body.innerHTML = ""
    await render(clinicalFence("condition-evidence", "nothing"))
    expect(container.textContent).toContain("This block does not name a condition")
  })

  it("is drawn for its own block name, and the trial-numbers block still is for its", () => {
    expect(clinicalFence("condition-evidence", "condition: depression")).not.toBeNull()
    expect(clinicalFence("evidence-table", "condition: depression")).not.toBeNull()
    expect(clinicalFence("js", "let a = 1")).toBeNull()
  })
})
