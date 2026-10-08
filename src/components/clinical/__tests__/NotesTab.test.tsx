// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { NoteSummary } from "@/lib/clinical/notes/links"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: nav.push }), useSearchParams: () => nav.params }))
const notes = vi.hoisted(() => ({ listNotesRemote: vi.fn(), createNoteRemote: vi.fn() }))
vi.mock("@/lib/clinical/notes/client", () => notes)

import { NotesTab, SEARCH_DELAY_MS } from "../NotesTab"

const MDD = { code: "depression", name: "Major depressive disorder" }
const ADHD = { code: "adhd", name: "ADHD" }
const note = (id: string, extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id, title: `Title of ${id}`, excerpt: `Excerpt of ${id}`, updated: "2026-10-05", created: "2026-10-01",
  links: { papers: [], conditions: [], treatments: [] }, kind: "none", conditions: [], papers: [], treatments: [], newSince: 0, project: false, ...extra,
})
/** Newest edit first, as the route gives them. */
const ALL: NoteSummary[] = [
  note("on-a-paper", {
    kind: "paper", updated: "2026-10-06", conditions: [MDD], newSince: 0,
    papers: [{ slug: "p1", label: "Smith 2024" }, { slug: "p2", label: "Lee 2023" }],
  }),
  note("on-a-topic", {
    kind: "topic", updated: "2026-09-30", conditions: [MDD, ADHD], newSince: 3,
    treatments: [{ condition: "depression", key: "esketamine", name: "Esketamine" }],
  }),
  note("one-paper", { kind: "paper", conditions: [ADHD], papers: [{ slug: "p3", label: "Kim 2022" }], newSince: 1 }),
  note("loose", { kind: "none", project: true }),
]
/** The pack's parents, as the route knows them: a note on a subtype is a note on its parent. */
const PARENTS: Record<string, string> = { depression: "mood-disorders" }
/** What the route answers: the search, the condition (with its subtypes) and the treatment are the server's; the kind is applied in the view. */
const answer = (filters: { q?: string; condition?: string; treatment?: string } = {}) => (filters.q === "nothing" ? [] : ALL)
  .filter((entry) => !filters.condition || entry.conditions.some(({ code }) => code === filters.condition || PARENTS[code] === filters.condition))
  .filter((entry) => !filters.treatment || entry.treatments.some(({ key }) => key === filters.treatment))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot> | null = null
async function render(query = "view=all&tab=notes") {
  nav.params = new URLSearchParams(query)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<NotesTab />) })
  await act(async () => {})
}
/** The view at another address, as after `router.replace`. */
async function at(query: string) {
  nav.params = new URLSearchParams(query)
  await act(async () => { root!.render(<NotesTab />) })
  await act(async () => {})
}
const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click() }) }
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const choose = async (element: HTMLSelectElement, value: string) => { await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })) }) }
const rows = () => [...container.querySelectorAll("[data-note]")] as HTMLElement[]
const ids = () => rows().map((row) => row.getAttribute("data-note"))
const pills = () => [...container.querySelectorAll('[role="group"] button')] as HTMLButtonElement[]
const search = () => container.querySelector('input[type="search"]') as HTMLInputElement
const select = () => container.querySelector("select") as HTMLSelectElement
const chip = () => container.querySelector('[data-filter="treatment"]')
const button = (text: string) => [...container.querySelectorAll("button")].find((entry) => entry.textContent === text) as HTMLButtonElement

beforeEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ""
  nav.replace.mockReset()
  nav.push.mockReset()
  notes.listNotesRemote.mockReset().mockImplementation(async (filters) => answer(filters))
  notes.createNoteRemote.mockReset().mockResolvedValue("new-note")
})
afterEach(() => { vi.useRealTimers() })

describe("the Notes tab of the Library", () => {
  it("lists the notes in the order the route gives them, each opening its page", async () => {
    await render()
    expect(notes.listNotesRemote).toHaveBeenCalledTimes(1)
    expect(notes.listNotesRemote).toHaveBeenCalledWith({})
    expect(ids()).toEqual(["on-a-paper", "on-a-topic", "one-paper", "loose"])
    expect(rows()[0].querySelector("a")!.getAttribute("href")).toBe("/wiki/notes/on-a-paper")
  })

  it("draws each part of a row", async () => {
    await render()
    const [paper, topic, one, loose] = rows()
    expect(paper.querySelector("h3")!.textContent).toBe("Title of on-a-paper")
    expect(paper.textContent).toContain("Excerpt of on-a-paper")
    const chips = (row: HTMLElement) => [...row.querySelectorAll("[data-chip]")].map((chip) => chip.textContent)
    expect(chips(paper)).toEqual(["Major depressive disorder", "2 papers"])
    expect(paper.textContent).toContain("Edited Oct 6, 2026")
    expect(paper.textContent).not.toContain("since your last edit")
    expect(chips(topic)).toEqual(["Major depressive disorder", "ADHD", "Esketamine", "3 new papers since your last edit"])
    expect(topic.textContent).toContain("Edited Sep 30, 2026")
    expect(chips(one)).toEqual(["ADHD", "1 paper", "1 new paper since your last edit"])
    expect(chips(loose)).toEqual(["Project"])
    expect(chips(paper)).not.toContain("Project")
  })

  it("has the three kinds as pills with their counts, All first and pressed", async () => {
    await render()
    expect(container.querySelector('[role="group"]')!.getAttribute("aria-label")).toBe("What a note is about")
    expect(pills().map((pill) => pill.textContent)).toEqual(["All 4", "On a paper 2", "On a topic 1", "Not linked 1"])
    expect(pills().map((pill) => pill.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"])
  })

  it("puts a chosen kind in the address and shows only the notes of that kind", async () => {
    await render()
    await click(pills()[1])
    expect(nav.replace).toHaveBeenCalledWith("/wiki?view=all&tab=notes&kind=paper")
    await at("view=all&tab=notes&kind=paper")
    expect(ids()).toEqual(["on-a-paper", "one-paper"])
    expect(pills().map((pill) => pill.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false"])
    // The kind is applied here: the list is not asked for again.
    expect(notes.listNotesRemote).toHaveBeenCalledTimes(1)
    await click(pills()[0])
    expect(nav.replace).toHaveBeenLastCalledWith("/wiki?view=all&tab=notes")
  })

  it("offers the conditions that any note has, by name, after All conditions", async () => {
    await render()
    expect(select().getAttribute("aria-label")).toBe("Condition")
    expect([...select().options].map((option) => [option.value, option.textContent])).toEqual([["", "All conditions"], ["adhd", "ADHD"], ["depression", "Major depressive disorder"]])
    await choose(select(), "depression")
    expect(nav.replace).toHaveBeenCalledWith("/wiki?view=all&tab=notes&condition=depression")
    await at("view=all&tab=notes&condition=depression")
    expect(ids()).toEqual(["on-a-paper", "on-a-topic"])
    // The condition is the route's to apply, so its subtypes count: the list is asked for once more, with it.
    expect(notes.listNotesRemote).toHaveBeenCalledTimes(2)
    expect(notes.listNotesRemote).toHaveBeenLastCalledWith({ condition: "depression" })
    // The select still offers every condition, from the list that was asked for without one.
    expect([...select().options].map((option) => option.value)).toEqual(["", "adhd", "depression"])
  })

  it("shows the notes on the subtypes of a condition the address names, and keeps that condition in the select", async () => {
    await render("view=all&tab=notes&condition=mood-disorders")
    expect(notes.listNotesRemote).toHaveBeenCalledWith({ condition: "mood-disorders" })
    expect(ids()).toEqual(["on-a-paper", "on-a-topic"])
    expect(select().value).toBe("mood-disorders")
    expect([...select().options].map((option) => option.value)).toEqual(["", "adhd", "depression", "mood-disorders"])
    expect(pills().map((pill) => pill.textContent)).toEqual(["All 2", "On a paper 1", "On a topic 1", "Not linked 0"])
  })

  it("applies the search, the condition and the kind together: the search and the condition by the route, the kind to what comes back", async () => {
    await render("view=all&tab=notes&q=keta&condition=depression&kind=topic")
    expect(notes.listNotesRemote).toHaveBeenCalledTimes(2)
    expect(notes.listNotesRemote).toHaveBeenCalledWith({ q: "keta" })
    expect(notes.listNotesRemote).toHaveBeenCalledWith({ q: "keta", condition: "depression" })
    expect(ids()).toEqual(["on-a-topic"])
    expect(search().value).toBe("keta")
    expect(select().value).toBe("depression")
    // The pills count the notes of the search and the condition, so a pill never promises a note it then does not show.
    expect(pills().map((pill) => pill.textContent)).toEqual(["All 2", "On a paper 1", "On a topic 1", "Not linked 0"])
    // The select offers the conditions of the notes of the search and the kind.
    expect([...select().options].map((option) => option.value)).toEqual(["", "adhd", "depression"])
  })

  it("keeps a chosen condition in the select, by its name, when no note of the kind has it", async () => {
    await render("view=all&tab=notes&condition=adhd&kind=none")
    expect([...select().options].map((option) => option.value)).toEqual(["", "adhd"])
    expect(select().value).toBe("adhd")
    expect(select().selectedOptions[0].textContent).toBe("ADHD")
    expect(container.textContent).toContain("No note matches these filters")
  })

  it("passes a treatment of the address to the route together with its condition", async () => {
    await render("view=all&tab=notes&condition=depression&treatment=esketamine")
    expect(notes.listNotesRemote).toHaveBeenCalledWith({ condition: "depression", treatment: "esketamine" })
    expect(ids()).toEqual(["on-a-topic"])
    await click(pills()[2])
    expect(nav.replace).toHaveBeenCalledWith("/wiki?view=all&tab=notes&condition=depression&treatment=esketamine&kind=topic")
  })

  it("shows the treatment of the address as a chip, by its name, and has no chip without one", async () => {
    await render("view=all&tab=notes&condition=depression&treatment=esketamine")
    expect(chip()!.textContent).toContain("Treatment: Esketamine")
    await at("view=all&tab=notes&condition=depression")
    expect(chip()).toBeNull()
  })

  it("names the treatment by its key when no note names it", async () => {
    await render("view=all&tab=notes&condition=adhd&treatment=clozapine")
    expect(chip()!.textContent).toContain("Treatment: clozapine")
    expect(container.textContent).toContain("No note matches these filters")
  })

  it("takes the treatment out of the address when its chip is removed, and keeps the rest", async () => {
    await render("view=all&tab=notes&q=keta&condition=depression&treatment=esketamine&kind=topic")
    const remove = chip()!.querySelector("button")!
    expect(remove.getAttribute("aria-label")).toBe("Remove the treatment filter")
    await click(remove)
    expect(nav.replace).toHaveBeenCalledWith("/wiki?view=all&tab=notes&q=keta&condition=depression&kind=topic")
  })

  it("clears the treatment with the other filters", async () => {
    await render("view=all&tab=notes&condition=adhd&treatment=clozapine")
    await click(button("Clear filters"))
    expect(nav.replace).toHaveBeenCalledWith("/wiki?view=all&tab=notes")
  })

  it("puts the search in the address a moment after the last key, not at each key", async () => {
    await render("view=all&tab=notes&kind=paper")
    vi.useFakeTimers()
    await type(search(), "ke")
    await act(async () => { vi.advanceTimersByTime(SEARCH_DELAY_MS - 1) })
    await type(search(), "keta")
    await act(async () => { vi.advanceTimersByTime(SEARCH_DELAY_MS - 1) })
    expect(nav.replace).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(nav.replace).toHaveBeenCalledTimes(1)
    expect(nav.replace).toHaveBeenCalledWith("/wiki?view=all&tab=notes&q=keta&kind=paper")
    vi.useRealTimers()
    await at("view=all&tab=notes&q=keta&kind=paper")
    expect(notes.listNotesRemote).toHaveBeenLastCalledWith({ q: "keta" })
    expect(search().value).toBe("keta")
  })

  it("says so when there is no note, and offers no filter to clear", async () => {
    notes.listNotesRemote.mockResolvedValue([])
    await render()
    expect(container.textContent).toContain("You have no notes yet")
    expect(button("Clear filters")).toBeUndefined()
    expect(rows()).toHaveLength(0)
    expect(button("New note")).toBeDefined()
  })

  it("says so when no note matches, and clears every filter from there", async () => {
    await render("view=all&tab=notes&q=nothing&kind=paper")
    expect(container.textContent).toContain("No note matches these filters")
    expect(container.textContent).not.toContain("You have no notes yet")
    await click(button("Clear filters"))
    expect(nav.replace).toHaveBeenCalledWith("/wiki?view=all&tab=notes")
    expect(search().value).toBe("")
  })

  it("says no note matches when the kind alone leaves none", async () => {
    notes.listNotesRemote.mockResolvedValue([ALL[0]])
    await render("view=all&tab=notes&kind=none")
    expect(container.textContent).toContain("No note matches these filters")
    expect(button("Clear filters")).toBeDefined()
  })

  it("makes an empty note through the route and opens it", async () => {
    await render()
    await click(button("New note"))
    expect(notes.createNoteRemote).toHaveBeenCalledTimes(1)
    expect(notes.createNoteRemote).toHaveBeenCalledWith()
    expect(nav.push).toHaveBeenCalledWith("/wiki/notes/new-note")
  })

  it("shows why a note could not be made, and lets the reader try again", async () => {
    notes.createNoteRemote.mockRejectedValueOnce(new Error("Your notes could not be reached (500)."))
    await render()
    await click(button("New note"))
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Your notes could not be reached (500).")
    expect(nav.push).not.toHaveBeenCalled()
    expect(button("New note").disabled).toBe(false)
  })

  it("shows why the notes could not be read", async () => {
    notes.listNotesRemote.mockRejectedValue(new Error("Your notes could not be reached (500)."))
    await render()
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Your notes could not be reached (500).")
    expect(container.textContent).not.toContain("You have no notes yet")
  })
})
