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
  key, name, papers: studies.length, efficacy: efficacy({ benefit: studies.length }), newPapers: 0, safetyPapers: 0, unreportedPapers: 0, lines: lines(), studies, ...over,
})
const klass = (key: string, label: string | null, treatments: TreatmentEvidence[], over: Partial<ClassEvidence> = {}): ClassEvidence => ({
  key, label, papers: treatments.reduce((sum, entry) => sum + entry.papers, 0), efficacy: efficacy({ benefit: 1 }), newPapers: 0, treatments, ...over,
})
const ketamine = treatment("ketamine", "Ketamine", [study(1), study(2, { kind: "no-benefit", text: "No better than placebo", sampleSize: null })], {
  efficacy: efficacy({ benefit: 1, "no-benefit": 1 }), lines: lines({ benefit: [{ text: "Eased symptoms within a day", key: "pmid:1" }], "no-benefit": [{ text: "No better than placebo", key: "pmid:2" }] }),
})
const lithium = treatment("lithium", "Lithium", [study(3, { treatment: "Lithium", text: "Cut relapse" })], { lines: lines({ benefit: [{ text: "Cut relapse", key: "pmid:3" }] }) })
const sertraline = treatment("sertraline", "Sertraline", [study(7, { treatment: "Sertraline", kind: "safety", text: "Raised bleeding risk" })], {
  papers: 0, efficacy: efficacy(), safetyPapers: 1, lines: lines({ safety: [{ text: "Raised bleeding risk", key: "pmid:7" }] }),
})
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
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(node) })
  await act(async () => {})
}
const show = async (evidence: Evidence = EVIDENCE) => { client.loadConditionEvidenceRemote.mockResolvedValue(evidence); await render(<ConditionEvidence body="condition: depression" />) }
const q = (selector: string) => container.querySelector(selector) as HTMLElement
const qa = (selector: string) => [...container.querySelectorAll(selector)] as HTMLElement[]
const click = async (element: Element | null) => { await act(async () => { (element as HTMLElement).click() }) }
const classRow = (key: string) => q(`[data-class="${key}"]`)
const openClass = (key: string) => click(classRow(key).querySelector("button"))
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

  it("asks again with the chosen period, and keeps the old content, dimmed, until the answer comes", async () => {
    await show()
    let answer: (value: Evidence) => void = () => {}
    client.loadConditionEvidenceRemote.mockReturnValue(new Promise<Evidence>((resolve) => { answer = resolve }))
    const select = q("select") as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual(["All time", "Last 12 months", "Last 6 months", "Last 3 months"])
    await act(async () => {
      select.value = "6m"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(client.loadConditionEvidenceRemote).toHaveBeenLastCalledWith("depression", { period: "6m", scope: "all" })
    expect(q("[data-class=medicine]")).not.toBeNull()
    expect(q("[data-testid=condition-evidence]").getAttribute("aria-busy")).toBe("true")
    await act(async () => { answer({ ...EVIDENCE, period: "6m", total: 1, collected: 5, classes: [ect] }) })
    expect(q("[data-class=medicine]")).toBeNull()
    expect(q("[data-testid=condition-evidence]").getAttribute("aria-busy")).toBeNull()
    expect((q("select") as HTMLSelectElement).value).toBe("6m")
  })

  it("has three tabs with their counts, Treatments first and selected", async () => {
    await show()
    expect(q('[role="tablist"]')).not.toBeNull()
    const tabs = qa('[role="tab"]')
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Treatments5", "Safety1", "Other research2"])
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"])
    expect(qa('[role="tabpanel"]')).toHaveLength(1)
    expect(q("[data-class=medicine]")).not.toBeNull()
  })

  it("shows a class with its name, count and what is new, naming the classes the pack does not", async () => {
    await show()
    expect(qa("[data-class]").map((row) => row.getAttribute("data-class"))).toEqual(["medicine", "neuromodulation"])
    const row = classRow("medicine")
    expect(row.querySelector("[data-name]")!.textContent).toBe("Medicines")
    expect(row.querySelector("[data-papers]")!.textContent).toBe("4 papers")
    expect(row.querySelector("[data-new]")!.textContent).toBe("+2 new")
    expect(classRow("neuromodulation").querySelector("[data-name]")!.textContent).toBe("Neuromodulation")
    expect(classRow("neuromodulation").querySelector("[data-new]")).toBeNull()
  })

  it("fills the bar in proportion to the largest class, never under 6%", async () => {
    await show()
    const fill = (key: string) => (classRow(key).querySelector("[data-bar-fill]") as HTMLElement).style.width
    expect(fill("medicine")).toBe("100%")
    expect(fill("neuromodulation")).toBe("25%")
    document.body.innerHTML = ""
    await show({ ...EVIDENCE, classes: [{ ...med, papers: 40 }, { ...ect, papers: 1 }] })
    expect(fill("neuromodulation")).toBe("6%")
  })

  it("divides the fill by direction, in order, in proportion to the papers", async () => {
    await show()
    const bar = classRow("medicine").querySelector("[data-bar]") as HTMLElement
    expect(bar.getAttribute("title")).toBe("3 benefit, 1 no benefit")
    // Final review I4: the same words for a reader who cannot hover.
    expect(bar.getAttribute("aria-label")).toBe("3 benefit, 1 no benefit")
    expect(bar.getAttribute("role")).toBe("img")
    expect([...bar.querySelectorAll("[data-kind]")].map((segment) => [segment.getAttribute("data-kind"), (segment as HTMLElement).style.width])).toEqual([["benefit", "75%"], ["no-benefit", "25%"]])
    expect((bar.querySelector("[data-kind=benefit]") as HTMLElement).style.backgroundColor).toBe("var(--clinical-benefit)")
    expect((bar.querySelector("[data-kind=no-benefit]") as HTMLElement).style.backgroundColor).toBe("var(--clinical-no-benefit)")
  })

  // Final review I4.
  it("gives the bar a key above the classes: a swatch and a name for each direction on the page, in order", async () => {
    await show()
    const key = q("[data-bar-key]")
    expect(key.getAttribute("aria-label")).toBe("What the bar colours mean")
    expect(key.compareDocumentPosition(classRow("medicine")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const entries = [...key.querySelectorAll("[data-key-kind]")] as HTMLElement[]
    expect(entries.map((entry) => [entry.getAttribute("data-key-kind"), entry.textContent])).toEqual([["benefit", "Benefit"], ["no-benefit", "No benefit"]])
    expect((entries[0].querySelector("[data-swatch]") as HTMLElement).style.backgroundColor).toBe("var(--clinical-benefit)")
    document.body.innerHTML = ""
    const every = klass("medicine", null, [ketamine], { efficacy: efficacy({ benefit: 1, "no-benefit": 1, mixed: 1 }) })
    await show({ ...EVIDENCE, classes: [every] })
    expect(qa("[data-key-kind]").map((entry) => entry.textContent)).toEqual(["Benefit", "No benefit", "Mixed"])
    document.body.innerHTML = ""
    await show({ ...EVIDENCE, classes: [] })
    expect(q("[data-bar-key]")).toBeNull()
  })

  // Final review M8: the border colour on a border-coloured track could not be seen.
  // rewritten in Task 4: a bar is divided by the efficacy results only, so it has no other or not-sorted part.
  it.skip("fills the other and not-sorted parts of a bar with a colour that is not the track's", async () => {
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [ketamine], { efficacy: efficacy() })] })
    const colours = ["other", "unsorted"].map((kind) => (classRow("medicine").querySelector(`[data-bar] [data-kind=${kind}]`) as HTMLElement).style.backgroundColor)
    for (const colour of colours) {
      expect(colour).toContain("var(--text-muted)")
      expect(colour).not.toContain("var(--border)")
      expect(colour).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
    expect(new Set(colours).size).toBe(2)
  })

  it("keeps a class closed at first, with no study row, and opens it to its treatments with Did and Watch", async () => {
    await show()
    const button = classRow("medicine").querySelector("button") as HTMLElement
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(qa("[data-treatment]")).toHaveLength(0)
    expect(qa("[data-study]")).toHaveLength(0)
    await click(button)
    expect(button.getAttribute("aria-expanded")).toBe("true")
    expect(qa("[data-treatment]").map((row) => row.getAttribute("data-treatment"))).toEqual(["ketamine", "lithium"])
    const first = q("[data-treatment=ketamine]")
    expect(first.querySelector("[data-name]")!.textContent).toBe("Ketamine")
    expect(first.querySelector("[data-did]")!.textContent).toBe("Did: Eased symptoms within a day.")
    expect(first.querySelector("[data-watch]")!.textContent).toBe("Watch: No better than placebo.")
    // Bars inside the class are scaled against its largest treatment (2 papers): lithium has 1.
    expect((q("[data-treatment=lithium] [data-bar-fill]")).style.width).toBe("50%")
    expect(qa("[data-study]")).toHaveLength(0)
    await click(button)
    expect(qa("[data-treatment]")).toHaveLength(0)
  })

  it("joins several texts with a semicolon, and shows a single benefit text plain but a single caution labelled", async () => {
    const many = treatment("ketamine", "Ketamine", [study(1), study(2), study(8, { kind: "safety" })], {
      lines: lines({ benefit: [{ text: "Eased symptoms.", key: "a" }, { text: "Worked fast.", key: "b" }], safety: [{ text: "Dissociation. ", key: "c" }], mixed: [{ text: "Faded by week 6", key: "d" }] }),
    })
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [many, lithium, sertraline])] })
    await openClass("medicine")
    // Final review M5: each text loses its own full stop, and the line ends with one.
    expect(q("[data-treatment=ketamine] [data-did]").textContent).toBe("Did: Eased symptoms; Worked fast.")
    expect(q("[data-treatment=ketamine] [data-watch]").textContent).toBe("Watch: Dissociation; Faded by week 6.")
    expect(q("[data-treatment=lithium] [data-did]").textContent).toBe("Cut relapse")
    expect(q("[data-treatment=lithium] [data-watch]")).toBeNull()
    expect(q("[data-treatment=sertraline] [data-watch]").textContent).toBe("Watch: Raised bleeding risk.")
    expect(q("[data-treatment=sertraline] [data-did]")).toBeNull()
  })

  it("opens a treatment to the table of its studies", async () => {
    await show()
    await openClass("medicine")
    const button = q("[data-treatment=ketamine] button")
    expect(button.getAttribute("aria-expanded")).toBe("false")
    await click(button)
    expect(button.getAttribute("aria-expanded")).toBe("true")
    expect(qa("table th").map((head) => head.textContent)).toEqual(["Study", "Design", "Population", "n", "Compared with", "Outcome", "Result"])
    // Final review I2: the one unit of n is said where it is shown.
    expect(qa("table th").map((head) => head.getAttribute("title"))).toEqual([null, null, null, "Participants, as the paper prints it", null, null, null])
    const rows = qa("[data-study]")
    expect(rows.map((row) => row.getAttribute("data-study"))).toEqual(["pmid:1", "pmid:2"])
    const link = rows[0].querySelector("a") as HTMLAnchorElement
    expect([link.textContent, link.getAttribute("href")]).toEqual(["Smith 2026", "/paper/paper-1"])
    expect(rows[0].textContent).toContain("A Journal")
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

  // Owner decision 2026-10-08: a paper under each treatment it names shows what it named itself.
  it("shows what the paper itself named under the study, only when it names several treatments", async () => {
    const both = study(11, { treatment: "ketamine and esketamine", severalTreatments: true })
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [treatment("ketamine", "Ketamine", [both, study(12, { treatment: "IV ketamine" })])])] })
    await openClass("medicine")
    const named = q('[data-study="pmid:11"] [data-cell=study] [data-named]')
    expect(named.textContent).toBe("ketamine and esketamine")
    expect(named.className).toContain("text-muted-text")
    expect(q('[data-study="pmid:12"] [data-named]')).toBeNull()
  })
  it("counts the treatments tab by distinct papers, not by the sum of the classes", async () => {
    await show({ ...EVIDENCE, sections: { ...EVIDENCE.sections, treatments: 3 } })
    expect(qa('[role="tab"]')[0].querySelector("[data-tab-count]")!.textContent).toBe("3")
  })

  it("marks a new or saved study, falls back to the headline and the takeaway, and names a design only when named", async () => {
    const plain = study(9, { label: null, text: null, kind: null, designNamed: false, isNew: true, saved: true })
    await show({ ...EVIDENCE, classes: [klass("medicine", null, [treatment("ketamine", "Ketamine", [plain, study(10)])])] })
    await openClass("medicine")
    const row = q('[data-study="pmid:9"]')
    expect(row.querySelector("a")!.textContent).toBe("Headline 9")
    expect(row.querySelector("[data-cell=design]")!.textContent).toBe("")
    expect(row.querySelector("[data-cell=result]")!.textContent).toBe("Takeaway 9.")
    expect(row.querySelector("[data-cell=result] [data-kind-label]")).toBeNull()
    expect(row.textContent).toContain("new")
    expect(row.textContent).toContain("saved")
    expect(q('[data-study="pmid:10"]').textContent).not.toContain("saved")
  })

  it("opens a class with one treatment straight to its line and table", async () => {
    await show({ ...EVIDENCE, classes: [klass("neuromodulation", "Neuromodulation", [ketamine])] })
    await openClass("neuromodulation")
    expect(qa("[data-treatment] button")).toHaveLength(0)
    expect(q("[data-treatment]").querySelector("[data-did]")!.textContent).toBe("Did: Eased symptoms within a day.")
    expect(qa("[data-study]")).toHaveLength(2)
  })

  it("lists the safety studies with their treatment, and says so when there are none", async () => {
    await show()
    await click(qa('[role="tab"]')[1])
    expect(qa('[role="tab"]').map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"])
    expect(qa("table th").map((head) => head.textContent)).toEqual(["Treatment", "Study", "Design", "Population", "n", "Compared with", "Outcome", "Result"])
    expect(qa("[data-study]")).toHaveLength(1)
    expect(q("[data-study] [data-cell=treatment]").textContent).toBe("Sertraline")
    // A paper in the safety group of each treatment it names is one row.
    document.body.innerHTML = ""
    const both = study(8, { kind: "safety", treatment: "sertraline and lithium", severalTreatments: true, date: "2026-09-25" })
    await show({ ...EVIDENCE, safety: [safetyGroup("sertraline", "Sertraline", [both, study(7, { kind: "safety", treatment: "Sertraline" })]), safetyGroup("lithium", "Lithium", [both])] })
    await click(qa('[role="tab"]')[1])
    expect(qa("[data-study]").map((row) => row.getAttribute("data-study"))).toEqual(["pmid:8", "pmid:7"])
    document.body.innerHTML = ""
    await show({ ...EVIDENCE, safety: [] })
    await click(qa('[role="tab"]')[1])
    expect(q('[role="tabpanel"]').textContent).toBe("No safety findings among these papers.")
  })

  it("groups the other research by type, closed at first, and opens one to its table", async () => {
    await show()
    await click(qa('[role="tab"]')[2])
    const groups = qa("[data-research]")
    expect(groups.map((group) => [group.getAttribute("data-research"), group.querySelector("button")!.textContent])).toEqual([["mechanism", "Mechanisms1"], ["risk-factor", "Risk factors1"]])
    expect(qa("[data-study]")).toHaveLength(0)
    expect(qa("[data-research] [data-new]")).toHaveLength(0)
    await click(groups[0].querySelector("button"))
    expect(qa("table th").map((head) => head.textContent)).toEqual(["Study", "Design", "Population", "n", "Finding"])
    expect(q("[data-study] [data-cell=finding]").textContent).toBe("Inflammation tracks severity.")
  })

  // Final review M4.
  it("says how many papers of a research group are new, as on a class row", async () => {
    await show({ ...EVIDENCE, research: [{ ...EVIDENCE.research[0], papers: 3, newPapers: 2 }, EVIDENCE.research[1]] })
    await click(qa('[role="tab"]')[2])
    const [first, second] = qa("[data-research]")
    expect(first.querySelector("[data-new]")!.textContent).toBe("+2 new")
    expect(first.querySelector("[data-papers]")!.textContent).toBe("3")
    expect(second.querySelector("[data-new]")).toBeNull()
  })

  it("draws the timeline last, folded", async () => {
    await show()
    const details = q("details")
    expect(details.hasAttribute("open")).toBe(false)
    expect(details.querySelector("summary")!.textContent).toBe("When they were published")
    expect(details.querySelectorAll("rect[data-month]")).toHaveLength(2)
    expect(qa("[data-legend]").map((entry) => entry.textContent)).toEqual(["Medicines", "Other"])
    expect(q("[data-testid=condition-evidence]").lastElementChild!.tagName).toBe("DETAILS")
  })

  it("says so when nothing was published in the period, and keeps the period control", async () => {
    await show()
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, period: "3m", total: 0, collected: 5, classes: [], safety: [], research: [] })
    const select = q("select") as HTMLSelectElement
    await act(async () => { select.value = "3m"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(container.textContent).toContain("No paper on Major depressive disorder was published in the last 3 months. 5 are collected in all.")
    expect((q("select") as HTMLSelectElement).value).toBe("3m")
    expect(q('[role="tablist"]')).toBeNull()
  })

  it("says so when nothing is collected, when no condition is named, while loading, and on an error", async () => {
    await show({ ...EVIDENCE, total: 0, collected: 0, classes: [], safety: [], research: [], timeline: { months: [], series: [] } })
    expect(container.textContent).toContain("Your feed has not listed a paper on Major depressive disorder yet")
    document.body.innerHTML = ""
    await render(<ConditionEvidence body="nothing" />)
    expect(container.textContent).toContain("This block does not name a condition")
    document.body.innerHTML = ""
    client.loadConditionEvidenceRemote.mockReturnValue(new Promise(() => {}))
    await render(<ConditionEvidence body="condition: depression" />)
    expect(container.textContent).toContain("Counting…")
    document.body.innerHTML = ""
    client.loadConditionEvidenceRemote.mockRejectedValue(new Error("That condition is not in the pack."))
    await render(<ConditionEvidence body="condition: zzz" />)
    expect(q('[role="alert"]').textContent).toContain("not in the pack")
  })

  it("is drawn for its own block name, and the trial-numbers block still is for its", () => {
    expect(clinicalFence("condition-evidence", "condition: depression")).not.toBeNull()
    expect(clinicalFence("evidence-table", "condition: depression")).not.toBeNull()
    expect(clinicalFence("js", "let a = 1")).toBeNull()
  })
})
