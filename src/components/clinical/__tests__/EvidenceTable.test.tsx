// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = vi.hoisted(() => ({ loadTreatmentTableRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => client)

import { EvidenceTable } from "../EvidenceTable"
import { clinicalFence } from "../clinical-fence"

const ROW = { key: "esketamine", treatment: "Esketamine", modality: "drug", trials: 3, comparators: ["Quetiapine", "placebo"], outcomes: ["remission (MADRS)"], favours: 2, against: 0, unclear: 1, notComputable: 0, unconfirmed: 0, latestYear: 2026, toCheck: 1, papers: [{ slug: "a-trial", title: "A trial" }] }
let container: HTMLDivElement
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(node) })
  await act(async () => {})
}
beforeEach(() => { document.body.innerHTML = ""; client.loadTreatmentTableRemote.mockReset() })

describe("the treatment-options table in a page", () => {
  it("asks for the table of the block's condition and shows a row per treatment", async () => {
    client.loadTreatmentTableRemote.mockResolvedValue({ condition: { code: "depression", name: "Major depressive disorder" }, rows: [ROW] })
    await render(<EvidenceTable body="condition: depression" />)
    expect(client.loadTreatmentTableRemote).toHaveBeenCalledWith("depression")
    expect([...container.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["Treatment", "Type", "Trials", "Compared with", "Primary outcomes", "Direction of effect", "Latest trial"])
    const cells = [...container.querySelectorAll("tbody tr:first-child td")].map((cell) => cell.textContent)
    expect(cells).toEqual(["Esketamine", "Drug", "3", "Quetiapine, placebo", "remission (MADRS)", "Favours the treatment in 2 of 3 trials; no clear difference in 1", "2026"])
    expect(container.textContent).toContain("1 trial has values still to check")
    expect(container.querySelector('a[href="/paper/a-trial#paper-trial-record"]')).not.toBeNull()
    expect(container.textContent).toContain("Counted from the trial data you have extracted. Not a meta-analysis")
  })
  it("says in the direction cell how many trials have a direction nobody has confirmed yet", async () => {
    client.loadTreatmentTableRemote.mockResolvedValue({ condition: { code: "depression", name: "Major depressive disorder" }, rows: [{ ...ROW, favours: 1, unclear: 0, unconfirmed: 2 }] })
    await render(<EvidenceTable body="condition: depression" />)
    expect(container.querySelector("tbody tr:first-child td:nth-child(6)")!.textContent).toBe("Favours the treatment in 1 of 3 trials; direction not yet confirmed in 2")
  })
  it("says so when there are no records yet, when the block is not a query, and when the table cannot be had", async () => {
    client.loadTreatmentTableRemote.mockResolvedValue({ condition: { code: "depression", name: "Major depressive disorder" }, rows: [] })
    await render(<EvidenceTable body="condition: depression" />)
    expect(container.textContent).toContain("No trial data has been extracted for Major depressive disorder yet")
    document.body.innerHTML = ""
    await render(<EvidenceTable body="something else" />)
    expect(container.textContent).toContain("This block does not name a condition")
    expect(client.loadTreatmentTableRemote).toHaveBeenCalledTimes(1)
    document.body.innerHTML = ""
    client.loadTreatmentTableRemote.mockRejectedValue(new Error("That condition is not in the pack."))
    await render(<EvidenceTable body="condition: nothing" />)
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("not in the pack")
  })
  it("is drawn for its own fence language only", () => {
    expect(clinicalFence("js", "let a = 1")).toBeNull()
    expect(clinicalFence("evidence-table", "condition: depression")).not.toBeNull()
  })
})
