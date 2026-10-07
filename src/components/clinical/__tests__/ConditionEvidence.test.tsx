// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { ConditionEvidence as Evidence } from "@/lib/clinical/evidence/build"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = vi.hoisted(() => ({ loadConditionEvidenceRemote: vi.fn() }))
vi.mock("@/lib/clinical/evidence/client", () => client)

import { ConditionEvidence } from "../ConditionEvidence"
import { clinicalFence } from "../clinical-fence"

const item = (n: number, over: Partial<Evidence["items"][number]> = {}): Evidence["items"][number] => ({
  key: `pmid:${n}`, slug: `paper-${n}`, headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, kind: "benefit", treatment: "ketamine", rowKey: "ketamine",
  population: "adults with depression", comparator: "placebo", outcome: "depressive symptoms", design: "randomized-trial", designNamed: true,
  venue: "A Journal", date: "2026-09-20", listedAt: "2026-10-06T10:00:00.000Z", saved: false, ...over,
})
const EVIDENCE: Evidence = {
  condition: { code: "depression", name: "Major depressive disorder" }, total: 4,
  rows: [
    { key: "ketamine", treatment: "Ketamine", modality: "drug", studies: 3, kinds: { benefit: 2, "no-benefit": 1, mixed: 0, safety: 0, other: 0, unsorted: 0 }, designs: [{ design: "randomized-trial", count: 2 }, { design: "meta-analysis", count: 1 }], latest: "2026-09-20", papers: ["pmid:1", "pmid:2", "pmid:3"] },
    { key: "none", treatment: null, modality: null, studies: 1, kinds: { benefit: 0, "no-benefit": 0, mixed: 0, safety: 0, other: 1, unsorted: 0 }, designs: [], latest: "2026-08-02", papers: ["pmid:4"] },
  ],
  timeline: { months: ["2026-08", "2026-09", "2026-10"], series: [{ key: "ketamine", label: "Ketamine", counts: [0, 3, 0] }, { key: "other", label: null, counts: [1, 0, 0] }] },
  recent: [item(1)], recentTotal: 1,
  items: [item(1), item(2, { kind: "no-benefit", saved: true }), item(3, { comparator: null, outcome: null, designNamed: false }), item(4, { rowKey: "none", treatment: null, kind: "other", population: null, comparator: null, outcome: null })],
}

let container: HTMLDivElement
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(node) })
  await act(async () => {})
}
beforeEach(() => { document.body.innerHTML = ""; client.loadConditionEvidenceRemote.mockReset() })

describe("the evidence block of a condition page", () => {
  it("says what it is built from, and that it is not all the evidence", async () => {
    client.loadConditionEvidenceRemote.mockResolvedValue(EVIDENCE)
    await render(<ConditionEvidence body="condition: depression" />)
    expect(client.loadConditionEvidenceRemote).toHaveBeenCalledWith("depression")
    expect(container.querySelector("[data-testid=evidence-basis]")!.textContent).toBe("From the 4 papers your feed has listed on Major depressive disorder. Not all the evidence on it; studies are counted, not pooled.")
  })

  it("shows what is new, then one row per treatment with its studies by direction and design", async () => {
    client.loadConditionEvidenceRemote.mockResolvedValue(EVIDENCE)
    await render(<ConditionEvidence body="condition: depression" />)
    expect([...container.querySelectorAll("[data-testid=evidence-new] a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["Headline 1", "/paper/paper-1"]])
    const rows = [...container.querySelectorAll("[data-evidence-row]")]
    expect(rows.map((row) => row.getAttribute("data-evidence-row"))).toEqual(["ketamine", "none"])
    expect(rows[0].querySelector("[data-row-name]")!.textContent).toBe("Ketamine")
    expect(rows[0].querySelector("[data-row-studies]")!.textContent).toBe("3 studies")
    expect(rows[0].querySelector("[data-row-directions]")!.textContent).toBe("2 benefit, 1 no benefit")
    expect(rows[0].querySelector("[data-row-designs]")!.textContent).toBe("2 randomized trials, 1 meta-analysis")
    // The bar is divided in proportion to the studies.
    const segments = [...rows[0].querySelectorAll("[data-bar] [data-kind]")].map((segment) => [segment.getAttribute("data-kind"), (segment as HTMLElement).style.width])
    expect(segments).toEqual([["benefit", "66.6667%"], ["no-benefit", "33.3333%"]])
    expect(rows[1].querySelector("[data-row-name]")!.textContent).toBe("Not about a treatment")
    expect(rows[1].querySelector("[data-row-studies]")!.textContent).toBe("1 study")
  })

  it("draws a bar per month and a legend for the timeline", async () => {
    client.loadConditionEvidenceRemote.mockResolvedValue(EVIDENCE)
    await render(<ConditionEvidence body="condition: depression" />)
    const chart = container.querySelector("[data-testid=evidence-timeline] svg")!
    expect(chart.querySelectorAll("rect[data-month]")).toHaveLength(2)
    expect(chart.querySelector('rect[data-month="2026-09"]')!.getAttribute("data-count")).toBe("3")
    expect([...container.querySelectorAll("[data-testid=evidence-timeline] [data-legend]")].map((entry) => entry.textContent)).toEqual(["Ketamine", "Other"])
  })

  it("lists the findings by treatment, each with the PICO parts its paper states", async () => {
    client.loadConditionEvidenceRemote.mockResolvedValue(EVIDENCE)
    await render(<ConditionEvidence body="condition: depression" />)
    const groups = [...container.querySelectorAll("[data-finding-group]")]
    expect(groups.map((group) => [group.querySelector("h4")!.textContent, group.querySelectorAll("[data-finding]").length])).toEqual([["Ketamine", 3], ["Not about a treatment", 1]])
    const first = groups[0].querySelector('[data-finding="pmid:1"]')!
    expect(first.querySelector("a")!.getAttribute("href")).toBe("/paper/paper-1")
    expect(first.querySelector("[data-pico]")!.textContent).toBe("Population: adults with depression · Compared with: placebo · Outcome: depressive symptoms")
    expect(groups[0].querySelector('[data-finding="pmid:3"] [data-pico]')!.textContent).toBe("Population: adults with depression")
    expect(groups[1].querySelector("[data-pico]")).toBeNull()
    expect(groups[0].querySelector('[data-finding="pmid:2"]')!.textContent).toContain("Saved")
    expect(first.textContent).not.toContain("Saved")
  })

  it("says so when there is nothing yet, when the block names no condition, and when the evidence cannot be had", async () => {
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, total: 0, rows: [], recent: [], items: [], timeline: { months: [], series: [] } })
    await render(<ConditionEvidence body="condition: depression" />)
    expect(container.textContent).toContain("Your feed has not listed a paper on Major depressive disorder yet")
    expect(container.querySelector("svg")).toBeNull()
    document.body.innerHTML = ""
    await render(<ConditionEvidence body="nothing" />)
    expect(container.textContent).toContain("This block does not name a condition")
    document.body.innerHTML = ""
    client.loadConditionEvidenceRemote.mockRejectedValue(new Error("That condition is not in the pack."))
    await render(<ConditionEvidence body="condition: zzz" />)
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("not in the pack")
  })

  it("orders its sections: basis, new, treatments, safety, findings, then the folded timeline", async () => {
    const safe = { ...EVIDENCE, items: [...EVIDENCE.items, item(5, { kind: "safety" })] }
    client.loadConditionEvidenceRemote.mockResolvedValue(safe)
    await render(<ConditionEvidence body="condition: depression" />)
    expect(container.querySelector("[data-testid=evidence-basis]")).not.toBeNull()
    expect([...container.querySelectorAll("h3, summary")].map((heading) => heading.textContent)).toEqual(["New in the last two weeks", "Treatments", "Safety", "Findings", "When they were published"])
    const details = container.querySelector("details")!
    expect(details.hasAttribute("open")).toBe(false)
    expect(details.querySelector("summary")!.textContent).toBe("When they were published")
    expect(details.querySelector("[data-testid=evidence-timeline]")).not.toBeNull()
  })

  it("filters the findings by the pressed treatment row, and shows all again", async () => {
    client.loadConditionEvidenceRemote.mockResolvedValue(EVIDENCE)
    await render(<ConditionEvidence body="condition: depression" />)
    const groups = () => [...container.querySelectorAll("[data-finding-group]")].map((group) => group.getAttribute("data-finding-group"))
    const row = () => container.querySelector('button[data-evidence-row="ketamine"]') as HTMLButtonElement
    expect(row().getAttribute("aria-pressed")).toBe("false")
    expect(container.querySelector("[data-show-all]")).toBeNull()
    expect(groups()).toEqual(["ketamine", "none"])
    await act(async () => { row().click() })
    expect(groups()).toEqual(["ketamine"])
    expect(row().getAttribute("aria-pressed")).toBe("true")
    expect(row().getAttribute("data-selected")).toBe("true")
    await act(async () => { row().click() })
    expect(groups()).toEqual(["ketamine", "none"])
    expect(row().getAttribute("data-selected")).toBeNull()
    await act(async () => { row().click() })
    const all = container.querySelector("[data-show-all]") as HTMLButtonElement
    expect(all.textContent).toBe("Show all")
    await act(async () => { all.click() })
    expect(groups()).toEqual(["ketamine", "none"])
  })

  it("lists every safety finding with its treatment, and leaves the section out when there is none", async () => {
    client.loadConditionEvidenceRemote.mockResolvedValue({ ...EVIDENCE, items: [...EVIDENCE.items, item(5, { kind: "safety", treatment: "ketamine" })] })
    await render(<ConditionEvidence body="condition: depression" />)
    const section = container.querySelector("[data-testid=evidence-safety]")!
    expect([...section.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["Headline 5", "/paper/paper-5"]])
    expect(section.textContent).toContain("Ketamine")
    expect(container.querySelector('[data-finding="pmid:5"]')).not.toBeNull()
    document.body.innerHTML = ""
    client.loadConditionEvidenceRemote.mockResolvedValue(EVIDENCE)
    await render(<ConditionEvidence body="condition: depression" />)
    expect(container.querySelector("[data-testid=evidence-safety]")).toBeNull()
  })

  it("is drawn for its own block name, and the trial-numbers block still is for its", () => {
    expect(clinicalFence("condition-evidence", "condition: depression")).not.toBeNull()
    expect(clinicalFence("evidence-table", "condition: depression")).not.toBeNull()
    expect(clinicalFence("js", "let a = 1")).toBeNull()
  })
})
