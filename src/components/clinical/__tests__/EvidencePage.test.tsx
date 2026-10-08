// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace }), useSearchParams: () => nav.params }))
const evidence = vi.hoisted(() => ({ listFollowedConditionsRemote: vi.fn(), loadConditionEvidenceRemote: vi.fn() }))
vi.mock("@/lib/clinical/evidence/client", () => evidence)
const records = vi.hoisted(() => ({ listConditionsRemote: vi.fn(), createConditionPageRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => records)

import { EvidencePage } from "../EvidencePage"

const FOLLOWED = [
  { code: "depression", name: "Major depressive disorder", total: 22, recent: 5, treatments: [], pageId: "wiki/conditions/major-depressive-disorder" },
  { code: "adhd", name: "ADHD", total: 0, recent: 0, treatments: [], pageId: null },
]
const NAMES: Record<string, string> = { depression: "Major depressive disorder", adhd: "ADHD", ocd: "Obsessive-compulsive disorder" }
const PAGES: Record<string, string> = { depression: "wiki/conditions/major-depressive-disorder", ocd: "wiki/conditions/obsessive-compulsive-disorder" }
const PACK = [{ code: "adhd", name: "ADHD" }, { code: "depression", name: "Major depressive disorder" }, { code: "ocd", name: "Obsessive-compulsive disorder" }, { code: "schizophrenia", name: "Schizophrenia" }]
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
  records.listConditionsRemote.mockReset().mockResolvedValue(PACK)
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
    // The name of the condition is written once: in its tab. The panel is named by that tab.
    expect(container.querySelector("h1, h2")).toBeNull()
    expect(container.querySelector("[data-control-row]")!.textContent!.split("Major depressive disorder")).toHaveLength(2)
    expect([...container.querySelectorAll("h1, h2, h3, h4")].some((heading) => heading.textContent!.includes("Major depressive disorder"))).toBe(false)
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1)
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

  it("shows the summary directly: no tabs under the condition, no notes, and an old address that asks for the notes is ignored", async () => {
    await render("condition=depression&tab=notes")
    expect(tablists()).toHaveLength(1)
    expect(container.textContent).not.toMatch(/Evidence summary|Notes/)
    expect(container.querySelector("textarea")).toBeNull()
    expect(evidence.loadConditionEvidenceRemote).toHaveBeenCalledWith("depression", { period: "all", scope: "all" })
    await click(tabsOf(tablists()[0])[1])
    expect(nav.replace).toHaveBeenCalledWith("/wiki?condition=adhd")
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it("has one row of controls: the tabs of the conditions at the left, the two selects at the right", async () => {
    await render()
    const row = container.querySelector("[data-control-row]") as HTMLElement
    expect(row.querySelector('[role="tablist"]')).toBe(tablists()[0])
    expect([...row.querySelectorAll("select")].map((each) => each.getAttribute("aria-label"))).toEqual(["Papers", "Period"])
    expect(container.querySelectorAll("select")).toHaveLength(2)
    // On a narrow screen the selects go under the tabs.
    expect(row.className).toContain("flex-wrap")
    expect(row.className).toContain("justify-between")
    expect(row.querySelector('[role="tablist"]')!.compareDocumentPosition(select("Papers")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('[role="tabpanel"]')!.contains(select("Papers"))).toBe(false)
  })

  it("underlines the chosen tab in the accent and writes it in semibold; the others are muted, and the two selects are pills", async () => {
    await render()
    const classes = (element: Element) => element.className.split(/\s+/)
    const [chosen, other] = tabsOf(tablists()[0])
    expect(classes(chosen)).toEqual(expect.arrayContaining(["border-b-2", "border-accent-ink", "text-[15px]", "font-semibold", "text-espresso"]))
    expect(classes(other)).toEqual(expect.arrayContaining(["border-b-2", "border-transparent", "text-[15px]", "text-muted-text", "hover:text-espresso"]))
    expect(classes(other)).not.toContain("font-semibold")
    for (const each of [select("Papers"), select("Period")]) {
      expect(classes(each)).toEqual(expect.arrayContaining(["rounded-pill", "border", "border-border-warm", "px-3", "text-[14px]", "hover:bg-card-surface", "focus-visible:outline-2"]))
    }
    // 24 px between the row and the line of what the summary is built from: 8 here and the 16 the summary has over it.
    expect(classes(container.querySelector('[role="tabpanel"]')!)).toContain("pt-2")
  })

  describe("the button that adds a condition", () => {
    const add = () => container.querySelector("button[data-add-condition]") as HTMLButtonElement
    const menu = () => container.querySelector("[data-add-menu]") as HTMLElement | null
    const options = () => [...menu()!.querySelectorAll("button")] as HTMLButtonElement[]
    const key = async (target: EventTarget, name: string) => { await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })) }) }
    it("is after the last tab, in the row and outside the list of tabs, and is named for a reader who does not see it", async () => {
      await render()
      expect(add().textContent).toBe("+")
      expect(add().getAttribute("aria-label")).toBe("Add a condition")
      expect(add().getAttribute("aria-expanded")).toBe("false")
      expect(container.querySelector("[data-control-row]")!.contains(add())).toBe(true)
      expect(tablists()[0].contains(add())).toBe(false)
      expect(tabsOf(tablists()[0]).at(-1)!.compareDocumentPosition(add()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(menu()).toBeNull()
      expect(records.listConditionsRemote).not.toHaveBeenCalled()
    })
    it("is as tall as a tab and on its line, at least 32 px each way, with a plus larger than the tabs' type in its middle", async () => {
      await render()
      const tabs = tabsOf(tablists()[0])
      const classes = (element: Element) => element.className.split(/\s+/)
      // The box of a tab: its padding, its type and the 2 px under it, whether it is the chosen one or not.
      for (const name of ["px-3", "py-2", "leading-5", "border-b-2"]) {
        expect(tabs.every((tab) => classes(tab).includes(name))).toBe(true)
        expect(classes(add())).toContain(name)
      }
      const size = classes(tabs[0]).find((name) => /^text-\[\d+px\]$/.test(name))!
      expect(classes(add())).toContain(size)
      expect(classes(add())).toEqual(expect.arrayContaining(["inline-flex", "items-center", "justify-center", "min-h-8", "min-w-8"]))
      expect(classes(add())).toContain("focus-visible:outline-2")
      const glyph = add().querySelector("[data-add-glyph]") as HTMLElement
      expect(glyph.textContent).toBe("+")
      expect(glyph.getAttribute("aria-hidden")).toBe("true")
      expect(classes(glyph)).toEqual(expect.arrayContaining(["text-[1.3em]", "leading-none"]))
      expect(add().children).toHaveLength(1)
      // The row sets the tabs and the button on one line.
      expect(add().closest("[data-control-row] > div")!.className).toContain("items-end")
    })

    it("opens a list of the pack's conditions that are not shown yet, and puts the keyboard on the first", async () => {
      await render()
      await click(add())
      await act(async () => {})
      expect(add().getAttribute("aria-expanded")).toBe("true")
      expect(menu()!.id).toBe(add().getAttribute("aria-controls"))
      expect(menu()!.getAttribute("aria-label")).toBe("Conditions to add")
      expect(options().map((option) => option.textContent)).toEqual(["Obsessive-compulsive disorder", "Schizophrenia"])
      expect(document.activeElement).toBe(options()[0])
      // One that is shown as an extra tab is not offered either.
      await at("condition=ocd")
      await click(add())
      await act(async () => {})
      expect(options().map((option) => option.textContent)).toEqual(["Schizophrenia"])
    })
    it("goes to the chosen condition, which then has a tab, and follows nothing and makes no page", async () => {
      await render("condition=adhd&period=6m")
      await click(add())
      await act(async () => {})
      await click(options()[0])
      expect(nav.replace).toHaveBeenCalledWith("/wiki?condition=ocd&period=6m")
      expect(menu()).toBeNull()
      expect(records.createConditionPageRemote).not.toHaveBeenCalled()
      await at("condition=ocd")
      expect(tabsOf(tablists()[0]).map((tab) => tab.textContent)).toEqual(["Major depressive disorder", "ADHD", "Obsessive-compulsive disorder"])
    })
    it("closes on Escape, with the keyboard back on the button, on a press outside it, and on a second press", async () => {
      await render()
      await click(add())
      await act(async () => {})
      await key(options()[1], "Escape")
      expect(menu()).toBeNull()
      expect(document.activeElement).toBe(add())
      await click(add())
      await act(async () => {})
      expect(menu()).not.toBeNull()
      await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })) })
      expect(menu()).toBeNull()
      await click(add())
      await act(async () => {})
      await click(add())
      expect(menu()).toBeNull()
    })
    it("says so when every condition is shown, and when the conditions cannot be listed", async () => {
      records.listConditionsRemote.mockResolvedValue(PACK.slice(0, 2))
      await render()
      await click(add())
      await act(async () => {})
      expect(menu()!.textContent).toBe("Every condition of the pack is already shown.")
      document.body.innerHTML = ""
      records.listConditionsRemote.mockRejectedValue(new Error("The conditions could not be reached (500)."))
      await render()
      await click(add())
      await act(async () => {})
      expect(menu()!.querySelector('[role="alert"]')!.textContent).toContain("could not be reached")
    })
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

  describe("a treatment's address", () => {
    const SIZED = {
      ...answer("depression"), total: 2, collected: 2, sections: { treatments: 2, safety: 0, research: 0 },
      classes: [{ key: "medicine", label: null, papers: 2, efficacy: { benefit: 2, "no-benefit": 0, mixed: 0 }, newPapers: 0, participants: null, sized: 0, treatments: [
        { key: "lithium", name: "Lithium", papers: 1, efficacy: { benefit: 1, "no-benefit": 0, mixed: 0 }, newPapers: 0, participants: null, sized: 0, safetyPapers: 0, unreportedPapers: 0, comparatorPapers: 0, comparedIn: [], lines: { benefit: [], "no-benefit": [], mixed: [], safety: [] }, studies: [] },
      ] }],
    }
    beforeEach(() => { evidence.loadConditionEvidenceRemote.mockImplementation(async (code: string) => (code === "depression" ? SIZED : answer(code))) })

    it("opens the treatment the address names", async () => {
      await render("condition=depression&treatment=lithium")
      expect(container.querySelector("[data-treatment-detail=lithium]")).not.toBeNull()
    })

    it("ignores a key the page does not have", async () => {
      await render("condition=depression&treatment=nonsense")
      expect(container.querySelector("[data-classes]")).not.toBeNull()
    })

    it("replaces the address when a class or a treatment is chosen, keeping the scope and the period, and drops it with the crumb", async () => {
      await render("condition=depression&scope=saved&period=6m")
      await click(container.querySelector('[data-classes] button[data-bubble="medicine"]') as HTMLElement)
      expect(nav.replace).toHaveBeenLastCalledWith("/wiki?condition=depression&treatment=medicine&scope=saved&period=6m")
      await click(container.querySelector('[data-treatments] button[data-bubble="lithium"]') as HTMLElement)
      expect(nav.replace).toHaveBeenLastCalledWith("/wiki?condition=depression&treatment=lithium&scope=saved&period=6m")
      await click(container.querySelector("[data-crumb] button") as HTMLElement)
      expect(nav.replace).toHaveBeenLastCalledWith("/wiki?condition=depression&scope=saved&period=6m")
    })

    it("drops the treatment when the condition tab changes, and keeps it when the scope does", async () => {
      await render("condition=depression&treatment=lithium&period=6m")
      await choose(select("Papers"), "saved")
      expect(nav.replace).toHaveBeenLastCalledWith("/wiki?condition=depression&treatment=lithium&scope=saved&period=6m")
      await click(tabsOf(tablists()[0])[1])
      expect(nav.replace).toHaveBeenLastCalledWith("/wiki?condition=adhd&period=6m")
    })
  })
})
