// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace }), useSearchParams: () => nav.params }))
const evidence = vi.hoisted(() => ({ listFollowedConditionsRemote: vi.fn(), loadConditionEvidenceRemote: vi.fn() }))
vi.mock("@/lib/clinical/evidence/client", () => evidence)
const records = vi.hoisted(() => ({ listConditionsRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => records)
vi.mock("../ConditionNotes", () => ({ ConditionNotes: ({ code, pageId }: { code: string; pageId: string | null }) => <div data-testid="notes" data-code={code} data-page={pageId ?? ""} /> }))

import { EvidencePage } from "../EvidencePage"

const FOLLOWED = [
  { code: "depression", name: "Major depressive disorder", total: 22, recent: 5, treatments: [], pageId: "wiki/conditions/major-depressive-disorder" },
  { code: "adhd", name: "ADHD", total: 0, recent: 0, treatments: [], pageId: null },
]
const answer = (code: string, name: string) => ({
  condition: { code, name }, period: "all", scope: "all", total: 0, collected: 0, savedCount: 4, since: null,
  sections: { treatments: 0, safety: 0, research: 0 }, classes: [], safety: [], research: [], timeline: { months: [], series: [] },
})

let container: HTMLDivElement
async function render(query = "") {
  nav.params = new URLSearchParams(query)
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<EvidencePage />) })
  await act(async () => {})
}
const tablists = () => [...container.querySelectorAll('[role="tablist"]')]
const tabsOf = (list: Element) => [...list.querySelectorAll('[role="tab"]')] as HTMLElement[]
const selectedOf = (list: Element) => tabsOf(list).filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.textContent)
const select = (label: string) => container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
const choose = async (element: HTMLSelectElement, value: string) => { await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })) }) }
const click = async (element: HTMLElement) => { await act(async () => { element.click() }) }

beforeEach(() => {
  document.body.innerHTML = ""
  nav.replace.mockReset()
  evidence.listFollowedConditionsRemote.mockReset().mockResolvedValue(FOLLOWED)
  evidence.loadConditionEvidenceRemote.mockReset().mockImplementation(async (code: string) => answer(code, code === "adhd" ? "ADHD" : "Major depressive disorder"))
  records.listConditionsRemote.mockReset().mockResolvedValue([{ code: "depression", name: "Major depressive disorder" }, { code: "ocd", name: "Obsessive-compulsive disorder" }])
})

describe("the Evidence view", () => {
  it("has a tab for each condition the reader follows, in the list's order, the first selected", async () => {
    await render()
    const [conditions] = tablists()
    expect(conditions.getAttribute("aria-label")).toBe("Conditions you follow")
    expect(tabsOf(conditions).map((tab) => tab.textContent)).toEqual(["Major depressive disorder", "ADHD"])
    expect(selectedOf(conditions)).toEqual(["Major depressive disorder"])
    const panel = container.querySelector('[role="tabpanel"]')!
    expect(panel.getAttribute("aria-labelledby")).toBe(tabsOf(conditions)[0].id)
    expect(panel.querySelector("h2")!.textContent).toBe("Major depressive disorder")
    expect(evidence.loadConditionEvidenceRemote).toHaveBeenCalledWith("depression", { period: "all", scope: "all" })
    expect(records.listConditionsRemote).not.toHaveBeenCalled()
  })

  it("selects the condition the address names", async () => {
    await render("condition=adhd")
    expect(selectedOf(tablists()[0])).toEqual(["ADHD"])
    expect(evidence.loadConditionEvidenceRemote).toHaveBeenCalledWith("adhd", { period: "all", scope: "all" })
  })

  it("shows a condition the reader does not follow but the pack knows as one more tab", async () => {
    await render("condition=ocd")
    const [conditions] = tablists()
    expect(tabsOf(conditions).map((tab) => tab.textContent)).toEqual(["Major depressive disorder", "ADHD", "Obsessive-compulsive disorder"])
    expect(selectedOf(conditions)).toEqual(["Obsessive-compulsive disorder"])
    expect(evidence.loadConditionEvidenceRemote).toHaveBeenCalledWith("ocd", { period: "all", scope: "all" })
  })

  it("shows the first condition for one the pack does not know", async () => {
    await render("condition=zzz")
    const [conditions] = tablists()
    expect(tabsOf(conditions)).toHaveLength(2)
    expect(selectedOf(conditions)).toEqual(["Major depressive disorder"])
    expect(evidence.loadConditionEvidenceRemote).not.toHaveBeenCalledWith("zzz", expect.anything())
  })

  it("replaces the address when a condition is chosen, keeping the scope and the period", async () => {
    await render("condition=depression&scope=saved&period=6m")
    await click(tabsOf(tablists()[0])[1])
    expect(nav.replace).toHaveBeenCalledWith("/wiki?condition=adhd&scope=saved&period=6m")
  })

  it("asks for the evidence with the scope and the period of the address, and names how many are saved", async () => {
    await render("condition=depression&scope=saved&period=6m")
    expect(evidence.loadConditionEvidenceRemote).toHaveBeenCalledWith("depression", { period: "6m", scope: "saved" })
    expect(select("Papers").value).toBe("saved")
    expect([...select("Papers").options].map((option) => option.textContent)).toEqual(["Everything my feed listed", "Saved to Library (4)"])
    expect(select("Period").value).toBe("6m")
    expect([...select("Period").options].map((option) => option.textContent)).toEqual(["All time", "Last 12 months", "Last 6 months", "Last 3 months"])
  })

  it("keeps a chosen scope or period in the address, with the other", async () => {
    await render("condition=adhd&period=3m")
    await choose(select("Papers"), "saved")
    expect(nav.replace).toHaveBeenLastCalledWith("/wiki?condition=adhd&scope=saved&period=3m")
    await choose(select("Period"), "12m")
    expect(nav.replace).toHaveBeenLastCalledWith("/wiki?condition=adhd&period=12m")
  })

  it("ignores a scope or a period it does not know", async () => {
    await render("scope=mine&period=1y")
    expect(evidence.loadConditionEvidenceRemote).toHaveBeenCalledWith("depression", { period: "all", scope: "all" })
  })

  it("has two tabs under a condition: the summary first, and the notes", async () => {
    await render()
    const views = tablists()[1]
    expect(tabsOf(views).map((tab) => tab.textContent)).toEqual(["Evidence summary", "Notes"])
    expect(selectedOf(views)).toEqual(["Evidence summary"])
    expect(container.querySelector("[data-testid=notes]")).toBeNull()
    await click(tabsOf(views)[1])
    expect(nav.replace).toHaveBeenCalledWith("/wiki?condition=depression&tab=notes")
  })

  it("shows the notes of the condition, with its page, when the address asks for them", async () => {
    await render("condition=depression&tab=notes")
    expect(selectedOf(tablists()[1])).toEqual(["Notes"])
    const notes = container.querySelector("[data-testid=notes]")!
    expect(notes.getAttribute("data-code")).toBe("depression")
    expect(notes.getAttribute("data-page")).toBe("wiki/conditions/major-depressive-disorder")
    expect(evidence.loadConditionEvidenceRemote).not.toHaveBeenCalled()
    expect(container.querySelector("select")).toBeNull()
    await click(tabsOf(tablists()[1])[0])
    expect(nav.replace).toHaveBeenCalledWith("/wiki?condition=depression")
  })

  it("says so, with the way to My topics, when no condition is followed", async () => {
    evidence.listFollowedConditionsRemote.mockResolvedValue([])
    await render()
    expect(container.textContent).toContain("You are not following a condition yet.")
    expect(container.querySelector('a[href="/watch"]')!.textContent).toBe("Add one under My topics")
    expect(container.querySelector('[role="tablist"]')).toBeNull()
  })

  it("shows the error when the conditions cannot be listed", async () => {
    evidence.listFollowedConditionsRemote.mockRejectedValue(new Error("The evidence could not be reached (500)."))
    await render()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("could not be reached")
  })
})
