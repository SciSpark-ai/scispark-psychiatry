// src/components/clinical/__tests__/ClinicalTrialRecord.test.tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { RECORD } from "@/lib/clinical/__tests__/records-fixture"
import { withField } from "@/lib/clinical/records/schema"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = vi.hoisted(() => ({ loadRecordRemote: vi.fn(), extractRecordRemote: vi.fn(), editFieldRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => client)

import { ClinicalTrialRecord } from "../ClinicalTrialRecord"
import { useTrialRecord } from "../useTrialRecord"

const PAPER = { ids: { pmid: "111" }, title: "Esketamine versus quetiapine", authors: [], fields: [], source: "pubmed" as const }
let container: HTMLDivElement
function Page({ canExtract = true }: { canExtract?: boolean }) {
  const state = useTrialRecord(PAPER, "randomized-trial")
  return <ClinicalTrialRecord state={state} canExtract={canExtract} />
}
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(node) })
  await act(async () => {})
}
const button = (text: string, within: Element = container) => [...within.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === text) as HTMLButtonElement | undefined
const field = (path: string) => container.querySelector(`[data-field="${path}"]`)!
beforeEach(() => { document.body.innerHTML = ""; Object.values(client).forEach((mock) => mock.mockReset()) })

describe("the trial data of a paper", () => {
  it("offers to extract only for a trial, and extracts only when asked", async () => {
    client.loadRecordRemote.mockResolvedValue(null)
    client.extractRecordRemote.mockResolvedValue(RECORD)
    await render(<Page />)
    expect(client.extractRecordRemote).not.toHaveBeenCalled()
    await act(async () => { button("Extract trial data")!.click() })
    expect(client.extractRecordRemote).toHaveBeenCalledWith(PAPER, "randomized-trial")
    expect(container.querySelectorAll("[data-arm]")).toHaveLength(2)
    document.body.innerHTML = ""
    await render(<Page canExtract={false} />)
    expect(button("Extract trial data")).toBeUndefined()
    expect(container.querySelector("[data-testid=trial-record]")).toBeNull()
  })

  it("shows each value with its state and its source sentence, and how many are still to check", async () => {
    client.loadRecordRemote.mockResolvedValue(withField(RECORD, "outcomes.o2.results.a2.sd", { value: null, quote: null, state: "unverified" }))
    await render(<Page />)
    expect(field("arms.a1.n").querySelector("[data-value]")!.textContent).toBe("336")
    expect(field("arms.a1.n").querySelector("[data-state]")!.textContent).toBe("Matched to a sentence")
    expect(field("arms.a1.n").querySelector("details")!.textContent).toContain("n = 336")
    // Not reported is shown as unknown, never as 0, and there is nothing to confirm.
    expect(field("outcomes.o2.results.a2.sd").querySelector("[data-value]")!.textContent).toBe("Not reported")
    expect(button("Confirm", field("outcomes.o2.results.a2.sd"))).toBeUndefined()
    // A binary outcome shows events, not a mean.
    expect(container.querySelector('[data-field="outcomes.o1.results.a1.mean"]')).toBeNull()
    expect(container.querySelector("[data-testid=record-to-check]")!.textContent).toMatch(/^\d+ values to check$/)
  })

  it("shows an effect computed from the numbers, with its interval and direction, and says when it cannot be computed", async () => {
    client.loadRecordRemote.mockResolvedValue(RECORD)
    await render(<Page />)
    expect(container.querySelector('[data-outcome="o1"] [data-effect]')!.textContent).toBe("Risk ratio 1.53 (95% CI 1.15 to 2.05) · favours the treatment")
    expect(container.querySelector('[data-outcome="o2"] [data-effect]')!.textContent).toBe("Hedges g 0.30 (95% CI 0.15 to 0.45) · favours the treatment")
    document.body.innerHTML = ""
    client.loadRecordRemote.mockResolvedValue(withField(RECORD, "outcomes.o2.results.a2.sd", { value: null, quote: null, state: "unverified" }))
    await render(<Page />)
    expect(container.querySelector('[data-outcome="o2"] [data-effect]')!.textContent).toBe("Effect not computable from the values reported")
  })

  it("confirms a value and corrects one, sending what the screen showed", async () => {
    client.loadRecordRemote.mockResolvedValue(RECORD)
    client.editFieldRemote.mockImplementation(async (_slug: string, path: string, change: { action: string; value?: number }) =>
      withField(RECORD, path, change.action === "confirm" ? { ...RECORD.arms[0].n, state: "human-confirmed" } : { value: change.value ?? null, quote: null, state: "human-edited" }))
    await render(<Page />)
    await act(async () => { button("Confirm", field("arms.a1.n"))!.click() })
    expect(client.editFieldRemote).toHaveBeenCalledWith(RECORD.slug, "arms.a1.n", { action: "confirm" }, RECORD.arms[0].n)
    expect(field("arms.a1.n").querySelector("[data-state]")!.textContent).toBe("Confirmed by you")
    expect(button("Confirm", field("arms.a1.n"))).toBeUndefined()

    await act(async () => { button("Edit", field("arms.a2.n"))!.click() })
    const input = field("arms.a2.n").querySelector("input") as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "341")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { button("Save", field("arms.a2.n"))!.click() })
    expect(client.editFieldRemote).toHaveBeenLastCalledWith(RECORD.slug, "arms.a2.n", { action: "edit", value: 341 }, RECORD.arms[1].n)
    expect(field("arms.a2.n").querySelector("[data-state]")!.textContent).toBe("Corrected by you")
  })

  it("shows why an extraction or a change failed", async () => {
    client.loadRecordRemote.mockResolvedValue(null)
    client.extractRecordRemote.mockRejectedValue(new Error("The paper does not report a trial with two or more groups."))
    await render(<Page />)
    await act(async () => { button("Extract trial data")!.click() })
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("does not report a trial")
  })
})
