// src/components/clinical/__tests__/ClinicalTrialRecord.test.tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { RECORD, num, unconfirmed } from "@/lib/clinical/__tests__/records-fixture"
import { PATHS, pathsToCheck, withCode, withField, type TrialRecord } from "@/lib/clinical/records/schema"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = vi.hoisted(() => ({ loadRecordRemote: vi.fn(), extractRecordRemote: vi.fn(), editFieldRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => client)

import { ClinicalTrialRecord } from "../ClinicalTrialRecord"
import { useTrialRecord } from "../useTrialRecord"

const FILING = {
  conditions: [{ code: "depression", name: "Major depressive disorder" }, { code: "treatment-resistant-depression", name: "Treatment-resistant depression" }],
  treatments: [{ code: "esketamine", name: "Esketamine" }, { code: "ketamine", name: "Ketamine" }, { code: "quetiapine", name: "Quetiapine" }],
}
const NAMES: Record<string, string> = { "treatment-resistant-depression": "Treatment-resistant depression", esketamine: "Esketamine", ketamine: "Ketamine", quetiapine: "Quetiapine" }
/** A record as the routes answer: with the names of what it is filed under. */
const view = (record: TrialRecord | null) => ({ record, names: record ? NAMES : {}, filing: record ? FILING : { conditions: [], treatments: [] } })
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
const select = (within: Element) => within.querySelector("select") as HTMLSelectElement
const optionTexts = (within: Element) => [...select(within).options].map((option) => option.textContent)
/** Picks the option with this text, as a reader would. */
async function choose(within: Element, text: string) {
  const element = select(within)
  const option = [...element.options].find((entry) => entry.textContent === text)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, option.value)
    element.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const filed = (path: string) => container.querySelector(`[data-filed="${path}"]`)!
const effectOf = (outcomeId: string) => container.querySelector(`[data-outcome="${outcomeId}"] [data-effect]`)!.textContent
beforeEach(() => { document.body.innerHTML = ""; Object.values(client).forEach((mock) => mock.mockReset()) })

describe("the trial data of a paper", () => {
  it("offers to extract only for a trial, and extracts only when asked", async () => {
    client.loadRecordRemote.mockResolvedValue(view(null))
    client.extractRecordRemote.mockResolvedValue(view(RECORD))
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
    client.loadRecordRemote.mockResolvedValue(view(withField(RECORD, "outcomes.o2.results.a2.sd", { value: null, quote: null, state: "unverified" })))
    await render(<Page />)
    expect(field("arms.a1.n").querySelector("[data-value]")!.textContent).toBe("336")
    expect(field("arms.a1.n").querySelector("[data-state]")!.textContent).toBe("Matched to a sentence")
    expect(field("arms.a1.n").querySelector("details")!.textContent).toContain("n = 336")
    // Not reported is shown as unknown, never as 0, and there is nothing to confirm.
    expect(field("outcomes.o2.results.a2.sd").querySelector("[data-value]")!.textContent).toBe("No checked value")
    expect(button("Confirm", field("outcomes.o2.results.a2.sd"))).toBeUndefined()
    // A binary outcome shows events, not a mean.
    expect(container.querySelector('[data-field="outcomes.o1.results.a1.mean"]')).toBeNull()
    expect(container.querySelector("[data-testid=record-to-check]")!.textContent).toMatch(/^\d+ values to check$/)
  })

  it("counts as values to check what it shows and nothing else", async () => {
    // A mean the model gave for a binary outcome is not on the panel, so it is not something to check.
    const record = withField(RECORD, "outcomes.o1.results.a1.mean", num(3.1))
    client.loadRecordRemote.mockResolvedValue(view(record))
    await render(<Page />)
    const shownUnchecked = [...container.querySelectorAll("[data-field]")].filter((entry) => button("Confirm", entry)).length
    expect(shownUnchecked).toBe(pathsToCheck(record).length)
    expect(container.querySelector("[data-testid=record-to-check]")!.textContent).toBe(`${shownUnchecked} values to check`)
  })

  it("says in its header when the paper was too long to be read whole", async () => {
    client.loadRecordRemote.mockResolvedValue(view(RECORD))
    await render(<Page />)
    expect(container.querySelector("[data-testid=record-source]")!.textContent).toBe("Read by AI from the full text")
    document.body.innerHTML = ""
    client.loadRecordRemote.mockResolvedValue(view({ ...RECORD, source: { ...RECORD.source, truncated: true } }))
    await render(<Page />)
    expect(container.querySelector("[data-testid=record-source]")!.textContent).toBe("Read by AI from the full text. The paper was too long to read whole: its middle was left out, so a value printed there is missing here.")
  })

  it("shows which result is the better one, the role of each group and the primary mark, each with its state and a way to confirm or change it", async () => {
    const fresh = unconfirmed(RECORD)
    client.loadRecordRemote.mockResolvedValue(view(fresh))
    client.editFieldRemote.mockImplementation(async (_slug: string, path: string, change: { action: string; value?: boolean | string | null }) =>
      view(withField(fresh, path, change.action === "confirm" ? { ...(path === PATHS.role("a1") ? { value: "treatment" as const } : { value: true }), quote: null, state: "human-confirmed" } : { value: change.value ?? null, quote: null, state: "human-edited" })))
    await render(<Page />)
    const benefit = field(PATHS.benefit("o2"))
    expect(optionTexts(benefit)).toEqual(["A lower score or fewer events", "A higher score or more events", "Not clear from the paper"])
    expect(select(benefit).selectedOptions[0].textContent).toBe("A lower score or fewer events")
    expect(benefit.querySelector("[data-state]")!.textContent).toBe("Not checked")
    expect(optionTexts(field(PATHS.role("a2")))).toEqual(["Treatment", "Comparator"])
    expect(select(field(PATHS.role("a2"))).selectedOptions[0].textContent).toBe("Comparator")
    expect(optionTexts(field(PATHS.primary("o1")))).toEqual(["Yes, the primary outcome", "No, a secondary outcome"])
    expect(select(field(PATHS.primary("o2"))).selectedOptions[0].textContent).toBe("No, a secondary outcome")
    // They are values to check like any other.
    expect(container.querySelector("[data-testid=record-to-check]")!.textContent).toBe(`${pathsToCheck(fresh).length} values to check`)
    expect(pathsToCheck(fresh).length).toBe(pathsToCheck(RECORD).length + 6)

    await act(async () => { button("Confirm", field(PATHS.role("a1")))!.click() })
    expect(client.editFieldRemote).toHaveBeenLastCalledWith(RECORD.slug, "arms.a1.role", { action: "confirm" }, { value: "treatment", quote: null, state: "unverified" })
    expect(field(PATHS.role("a1")).querySelector("[data-state]")!.textContent).toBe("Confirmed by you")
    expect(button("Confirm", field(PATHS.role("a1")))).toBeUndefined()

    await choose(field(PATHS.benefit("o2")), "A higher score or more events")
    expect(client.editFieldRemote).toHaveBeenLastCalledWith(RECORD.slug, "outcomes.o2.lowerIsBetter", { action: "edit", value: false }, { value: true, quote: null, state: "unverified" })
    expect(field(PATHS.benefit("o2")).querySelector("[data-state]")!.textContent).toBe("Corrected by you")
    await choose(field(PATHS.benefit("o1")), "Not clear from the paper")
    expect(client.editFieldRemote).toHaveBeenLastCalledWith(RECORD.slug, "outcomes.o1.lowerIsBetter", { action: "edit", value: null }, { value: false, quote: null, state: "unverified" })
    await choose(field(PATHS.role("a2")), "Treatment")
    expect(client.editFieldRemote).toHaveBeenLastCalledWith(RECORD.slug, "arms.a2.role", { action: "edit", value: "treatment" }, { value: "control", quote: null, state: "unverified" })
    await choose(field(PATHS.primary("o2")), "Yes, the primary outcome")
    expect(client.editFieldRemote).toHaveBeenLastCalledWith(RECORD.slug, "outcomes.o2.primary", { action: "edit", value: true }, { value: false, quote: null, state: "unverified" })
  })

  it("claims no direction until the reader has confirmed which result is better and both roles, then the right one", async () => {
    // Mean reductions: a larger number is the better result. The model said lower is better.
    const reductions = { ...RECORD.outcomes[1], lowerIsBetter: true, lowerIsBetterState: "unverified" as const,
      results: [{ ...RECORD.outcomes[1].results[0], mean: num(12.0), sd: num(8.0) }, { ...RECORD.outcomes[1].results[1], mean: num(8.0), sd: num(8.0) }] }
    const record = { ...RECORD, outcomes: [RECORD.outcomes[0], reductions] }
    client.loadRecordRemote.mockResolvedValue(view(record))
    client.editFieldRemote.mockImplementation(async (_slug: string, path: string, change: { value?: boolean }) => view(withField(record, path, { value: change.value ?? null, quote: null, state: "human-edited" })))
    await render(<Page />)
    expect(effectOf("o2")).toBe("No direction is shown yet: first confirm which result is the better one for this outcome, and the role of both groups.")
    expect(effectOf("o2")).not.toContain("favours")
    // The other outcome was confirmed, and is not held back.
    expect(effectOf("o1")).toContain("favours the treatment")
    await choose(field(PATHS.benefit("o2")), "A higher score or more events")
    expect(effectOf("o2")).toBe("Hedges g 0.50 (95% CI 0.35 to 0.65; above 0 favours the treatment) · esketamine nasal spray vs quetiapine · favours the treatment")
    document.body.innerHTML = ""
    client.loadRecordRemote.mockResolvedValue(view({ ...RECORD, arms: [RECORD.arms[0], { ...RECORD.arms[1], roleState: "unverified" }] }))
    await render(<Page />)
    expect(effectOf("o1")).toContain("No direction is shown yet")
  })

  it("shows an effect computed from the numbers, with its interval and direction, and says when it cannot be computed", async () => {
    client.loadRecordRemote.mockResolvedValue(view(RECORD))
    await render(<Page />)
    // The two groups compared are named, and Hedges g says which way it is turned.
    expect(effectOf("o1")).toBe("Risk ratio 1.53 (95% CI 1.15 to 2.05) · esketamine nasal spray vs quetiapine · favours the treatment")
    expect(effectOf("o2")).toBe("Hedges g 0.30 (95% CI 0.15 to 0.45; above 0 favours the treatment) · esketamine nasal spray vs quetiapine · favours the treatment")
    document.body.innerHTML = ""
    client.loadRecordRemote.mockResolvedValue(view(withField(RECORD, "outcomes.o2.results.a2.sd", { value: null, quote: null, state: "unverified" })))
    await render(<Page />)
    expect(container.querySelector('[data-outcome="o2"] [data-effect]')!.textContent).toBe("Effect not computable from the values reported")
  })

  it("prints the risk ratio of a bad event as the paper would, below 1 when the treatment had fewer, and says the direction in words", async () => {
    const relapse = { ...RECORD.outcomes[0], lowerIsBetter: true, results: [{ ...RECORD.outcomes[0].results[0], n: num(200), events: num(20) }, { ...RECORD.outcomes[0].results[1], n: num(200), events: num(60) }] }
    client.loadRecordRemote.mockResolvedValue(view({ ...RECORD, outcomes: [relapse] }))
    await render(<Page />)
    expect(effectOf("o1")).toBe("Risk ratio 0.33 (95% CI 0.21 to 0.53) · esketamine nasal spray vs quetiapine · favours the treatment")
  })

  it("shows what the condition and each group is filed under, by the pack's name, and says when it is filed under nothing", async () => {
    const record = withCode(withCode(RECORD, PATHS.treatmentCode("a2"), null), PATHS.conditionCode, null)
    client.loadRecordRemote.mockResolvedValue(view(RECORD))
    await render(<Page />)
    expect(filed(PATHS.conditionCode).querySelector("[data-filed-text]")!.textContent).toBe("Filed under: Treatment-resistant depression")
    expect(filed(PATHS.treatmentCode("a1")).querySelector("[data-filed-text]")!.textContent).toBe("Filed under: Esketamine")
    expect(optionTexts(filed(PATHS.treatmentCode("a1")))).toEqual(["Not in the pack", "Esketamine", "Ketamine", "Quetiapine"])
    expect(select(filed(PATHS.treatmentCode("a1"))).selectedOptions[0].textContent).toBe("Esketamine")
    document.body.innerHTML = ""
    client.loadRecordRemote.mockResolvedValue(view(record))
    await render(<Page />)
    expect(filed(PATHS.treatmentCode("a2")).querySelector("[data-filed-text]")!.textContent).toBe("Not in the pack")
    expect(filed(PATHS.conditionCode).querySelector("[data-filed-text]")!.textContent).toBe("Not filed under a condition of the pack: this trial appears in no table")
    expect(select(filed(PATHS.conditionCode)).selectedOptions[0].textContent).toBe("Not in the pack")
  })

  it("lets the reader change what a group is filed under, sending what the screen showed", async () => {
    client.loadRecordRemote.mockResolvedValue(view(RECORD))
    client.editFieldRemote.mockImplementation(async (_slug: string, path: string, change: { value: string | null }) => view(withCode(RECORD, path, change.value)))
    await render(<Page />)
    await choose(filed(PATHS.treatmentCode("a1")), "Ketamine")
    expect(client.editFieldRemote).toHaveBeenLastCalledWith(RECORD.slug, "arms.a1.treatmentCode", { action: "edit", value: "ketamine" }, { value: "esketamine" })
    expect(filed(PATHS.treatmentCode("a1")).querySelector("[data-filed-text]")!.textContent).toBe("Filed under: Ketamine")
    await choose(filed(PATHS.conditionCode), "Not in the pack")
    expect(client.editFieldRemote).toHaveBeenLastCalledWith(RECORD.slug, "conditionCode", { action: "edit", value: null }, { value: "treatment-resistant-depression" })
  })

  it("keeps a correction open, with Save disabled, until the server has taken it; and open with the typed text when it is refused", async () => {
    client.loadRecordRemote.mockResolvedValue(view(RECORD))
    let settle: { resolve(value: unknown): void; reject(reason: Error): void } = { resolve: () => {}, reject: () => {} }
    client.editFieldRemote.mockImplementation(() => new Promise((resolve, reject) => { settle = { resolve, reject } }))
    await render(<Page />)
    await act(async () => { button("Edit", field("arms.a2.n"))!.click() })
    await type(field("arms.a2.n").querySelector("input") as HTMLInputElement, "341")
    await act(async () => { button("Save", field("arms.a2.n"))!.click() })
    // Still waiting: the draft is there and cannot be sent twice.
    expect((field("arms.a2.n").querySelector("input") as HTMLInputElement).value).toBe("341")
    expect(button("Save", field("arms.a2.n"))!.disabled).toBe(true)
    await act(async () => { button("Save", field("arms.a2.n"))!.click() })
    expect(client.editFieldRemote).toHaveBeenCalledTimes(1)
    await act(async () => { settle.reject(new Error("This value was changed elsewhere since you opened the page. Reload to see it.")) })
    expect((field("arms.a2.n").querySelector("input") as HTMLInputElement).value).toBe("341")
    expect(button("Save", field("arms.a2.n"))!.disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("changed elsewhere")
    await act(async () => { button("Save", field("arms.a2.n"))!.click() })
    await act(async () => { settle.resolve(view(withField(RECORD, "arms.a2.n", { value: 341, quote: null, state: "human-edited" }))) })
    expect(field("arms.a2.n").querySelector("input")).toBeNull()
    expect(field("arms.a2.n").querySelector("[data-value]")!.textContent).toBe("341")
  })

  it("shows why the stored record could not be loaded, and does not offer to extract over it", async () => {
    client.loadRecordRemote.mockRejectedValue(new Error("Trial data for this paper is already stored but could not be read; it was left untouched."))
    await render(<Page />)
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("could not be read; it was left untouched")
    expect(button("Extract trial data")).toBeUndefined()
    expect(client.extractRecordRemote).not.toHaveBeenCalled()
  })

  it("confirms a value and corrects one, sending what the screen showed", async () => {
    client.loadRecordRemote.mockResolvedValue(view(RECORD))
    client.editFieldRemote.mockImplementation(async (_slug: string, path: string, change: { action: string; value?: number }) =>
      view(withField(RECORD, path, change.action === "confirm" ? { ...RECORD.arms[0].n, state: "human-confirmed" } : { value: change.value ?? null, quote: null, state: "human-edited" })))
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
    client.loadRecordRemote.mockResolvedValue(view(null))
    client.extractRecordRemote.mockRejectedValue(new Error("The paper does not report a trial with two or more groups."))
    await render(<Page />)
    await act(async () => { button("Extract trial data")!.click() })
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("does not report a trial")
  })
})
