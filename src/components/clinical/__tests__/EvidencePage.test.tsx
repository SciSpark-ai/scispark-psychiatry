// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace }), useSearchParams: () => nav.params }))
const evidence = vi.hoisted(() => ({ listFollowedConditionsRemote: vi.fn(), loadConditionEvidenceRemote: vi.fn() }))
vi.mock("@/lib/clinical/evidence/client", () => evidence)
const vault = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => vault }))
const records = vi.hoisted(() => ({ createConditionPageRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => records)

import { EvidencePage } from "../EvidencePage"

const FOLLOWED = [
  { code: "depression", name: "Major depressive disorder", total: 22, recent: 5, treatments: [], pageId: "wiki/conditions/major-depressive-disorder" },
  { code: "adhd", name: "ADHD", total: 0, recent: 0, treatments: [], pageId: null },
]
const NAMES: Record<string, string> = { depression: "Major depressive disorder", adhd: "ADHD", ocd: "Obsessive-compulsive disorder" }
const PAGES: Record<string, string> = { depression: "wiki/conditions/major-depressive-disorder", ocd: "wiki/conditions/obsessive-compulsive-disorder" }
const NOTES: Record<string, string> = { "wiki/conditions/major-depressive-disorder.md": "Notes on depression.", "wiki/conditions/obsessive-compulsive-disorder.md": "Notes on OCD." }
const answer = (code: string) => ({
  condition: { code, name: NAMES[code] }, pageId: PAGES[code] ?? null, period: "all", scope: "all", total: 0, collected: 0, savedCount: 4, since: null,
  sections: { treatments: 0, safety: 0, research: 0 }, classes: [], safety: [], research: [], timeline: { months: [], series: [] },
})

let container: HTMLDivElement
let root: ReturnType<typeof createRoot> | null = null
async function render(query = "") {
  nav.params = new URLSearchParams(query)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<EvidencePage />) })
  await act(async () => {})
}
/** The view at another address, as after `router.replace`. */
async function at(query: string) {
  nav.params = new URLSearchParams(query)
  await act(async () => { root!.render(<EvidencePage />) })
  await act(async () => {})
}
const area = () => container.querySelector("textarea") as HTMLTextAreaElement
async function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  await act(async () => { setter.call(area(), text); area().dispatchEvent(new Event("input", { bubbles: true })) })
}
const saveButton = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Save") as HTMLButtonElement
/** Whether the browser would ask before the page is left. */
function leavingIsGuarded() {
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
const tablists = () => [...container.querySelectorAll('[role="tablist"]')]
const tabsOf = (list: Element) => [...list.querySelectorAll('[role="tab"]')] as HTMLElement[]
const selectedOf = (list: Element) => tabsOf(list).filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.textContent)
const select = (label: string) => container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
const choose = async (element: HTMLSelectElement, value: string) => { await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })) }) }
const click = async (element: HTMLElement) => { await act(async () => { element.click() }) }

beforeEach(() => {
  // The view of the test before is taken down, so that its guard on leaving the page is.
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ""
  nav.replace.mockReset()
  evidence.listFollowedConditionsRemote.mockReset().mockResolvedValue(FOLLOWED)
  evidence.loadConditionEvidenceRemote.mockReset().mockImplementation(async (code: string) => {
    if (!NAMES[code]) throw new Error("That condition is not in the pack.")
    return answer(code)
  })
  vault.read.mockReset().mockImplementation(async (path: string) => (NOTES[path] ? `---\ntype: condition\n---\n## My notes\n\n${NOTES[path]}\n` : null))
  vault.write.mockReset().mockResolvedValue(undefined)
  records.createConditionPageRemote.mockReset()
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
    expect(evidence.loadConditionEvidenceRemote).toHaveBeenCalledTimes(1)
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
    expect(evidence.loadConditionEvidenceRemote).toHaveBeenLastCalledWith("depression", { period: "all", scope: "all" })
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
    expect(container.querySelector("textarea")).toBeNull()
    await click(tabsOf(views)[1])
    expect(nav.replace).toHaveBeenCalledWith("/wiki?condition=depression&tab=notes")
  })

  it("shows the notes of the condition, with its page, when the address asks for them", async () => {
    await render("condition=depression&tab=notes")
    expect(selectedOf(tablists()[1])).toEqual(["Notes"])
    expect(vault.read).toHaveBeenCalledWith("wiki/conditions/major-depressive-disorder.md")
    expect(area().value).toBe("Notes on depression.")
    expect(evidence.loadConditionEvidenceRemote).not.toHaveBeenCalled()
    expect(container.querySelector("select")).toBeNull()
    await click(tabsOf(tablists()[1])[0])
    expect(nav.replace).toHaveBeenCalledWith("/wiki?condition=depression")
  })

  it("opens the notes of a condition the reader does not follow from its page, which it finds without making it", async () => {
    await render("condition=ocd&tab=notes")
    expect(selectedOf(tablists()[0])).toEqual(["Obsessive-compulsive disorder"])
    expect(vault.read).toHaveBeenCalledWith("wiki/conditions/obsessive-compulsive-disorder.md")
    expect(area().value).toBe("Notes on OCD.")
    expect(records.createConditionPageRemote).not.toHaveBeenCalled()
  })

  it("keeps what was typed in the notes over a change of tab and of condition, and guards leaving the page meanwhile", async () => {
    await render("condition=depression&tab=notes")
    expect(leavingIsGuarded()).toBe(false)
    await type("Notes on depression. And a new thought")
    expect(leavingIsGuarded()).toBe(true)
    await at("condition=depression")
    expect(container.querySelector("textarea")).toBeNull()
    await at("condition=depression&tab=notes")
    expect(area().value).toBe("Notes on depression. And a new thought")
    expect(saveButton().disabled).toBe(false)
    await at("condition=adhd&tab=notes")
    expect(area().value).toBe("")
    await at("condition=depression&tab=notes")
    expect(area().value).toBe("Notes on depression. And a new thought")
    expect(leavingIsGuarded()).toBe(true)
    await act(async () => { saveButton().click() })
    await act(async () => {})
    expect(vault.write).toHaveBeenCalledTimes(1)
    expect(leavingIsGuarded()).toBe(false)
  })

  it("keeps with a draft the notes it was begun from, so a change made elsewhere meanwhile is not written over", async () => {
    const path = "wiki/conditions/major-depressive-disorder.md"
    await render("condition=depression&tab=notes")
    await type("Notes on depression. Mine.")
    await at("condition=depression")
    NOTES[path] = "Written in another window."
    try {
      await at("condition=depression&tab=notes")
      expect(area().value).toBe("Notes on depression. Mine.")
      await act(async () => { saveButton().click() })
      await act(async () => {})
      expect(vault.write).not.toHaveBeenCalled()
      expect(container.querySelector("[data-stored-notes]")!.textContent).toBe("Written in another window.")
      expect(area().value).toBe("Notes on depression. Mine.")
    } finally {
      NOTES[path] = "Notes on depression."
    }
  })

  it("opens the notes of a page that was made on a first save, when the reader comes back to them", async () => {
    await render("condition=adhd&tab=notes")
    records.createConditionPageRemote.mockResolvedValue({ id: "wiki/conditions/adhd", created: true })
    NOTES["wiki/conditions/adhd.md"] = "Write what you conclude from these papers here."
    await type("First note.")
    await act(async () => { saveButton().click() })
    await act(async () => {})
    NOTES["wiki/conditions/adhd.md"] = "First note."
    await at("condition=adhd")
    await at("condition=adhd&tab=notes")
    expect(area().value).toBe("First note.")
    delete NOTES["wiki/conditions/adhd.md"]
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
