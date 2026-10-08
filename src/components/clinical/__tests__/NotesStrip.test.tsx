// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { NoteSummary } from "@/lib/clinical/notes/links"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }))
const notes = vi.hoisted(() => ({ listNotesRemote: vi.fn(), createNoteRemote: vi.fn() }))
vi.mock("@/lib/clinical/notes/client", () => notes)

import { NotesStrip } from "../NotesStrip"

const note = (id: string, extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id, title: `Title of ${id}`, excerpt: `Excerpt of ${id}`, updated: "2026-10-05", created: "2026-10-01",
  links: { papers: [], conditions: [], treatments: [] }, kind: "paper", conditions: [], papers: [], treatments: [], newSince: 0, project: false, ...extra,
})
const TWO = [note("first", { updated: "2026-10-06" }), note("second")]

let container: HTMLDivElement
let root: ReturnType<typeof createRoot> | null = null
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(node) })
  await act(async () => {})
}
const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click() }) }
const button = () => [...container.querySelectorAll("button")].find((entry) => entry.textContent === "Write a note") as HTMLButtonElement
const links = () => [...container.querySelectorAll("a")].map((entry) => [entry.textContent, entry.getAttribute("href")])

beforeEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ""
  nav.push.mockReset()
  notes.listNotesRemote.mockReset().mockResolvedValue(TWO)
  notes.createNoteRemote.mockReset().mockResolvedValue("new-note")
})

describe("the reader's notes on a paper", () => {
  it("lists the notes that link the paper under a heading, each opening its note", async () => {
    await render(<NotesStrip variant="section" about={{ paper: "smith-2024" }} />)
    expect(notes.listNotesRemote).toHaveBeenCalledTimes(1)
    expect(notes.listNotesRemote).toHaveBeenCalledWith({ paper: "smith-2024" })
    const section = container.querySelector("section#paper-notes")!
    expect(section.querySelector("h2")!.textContent).toBe("Your notes")
    const rows = [...section.querySelectorAll("[data-note]")]
    expect(rows.map((row) => row.getAttribute("data-note"))).toEqual(["first", "second"])
    expect(rows[0].querySelector("a")!.getAttribute("href")).toBe("/wiki/notes/first")
    expect(rows[0].textContent).toContain("Title of first")
    expect(rows[0].textContent).toContain("Excerpt of first")
    expect(rows[0].textContent).toContain("Edited Oct 6, 2026")
    expect(button()).toBeDefined()
  })

  it("shows nothing but the button when there are none", async () => {
    notes.listNotesRemote.mockResolvedValue([])
    await render(<NotesStrip variant="section" about={{ paper: "smith-2024" }} />)
    const section = container.querySelector("section#paper-notes")!
    expect(section.getAttribute("aria-label")).toBe("Your notes")
    expect(section.querySelector("h2")).toBeNull()
    expect(section.textContent).toBe("Write a note")
  })

  it("makes a note about the paper and opens it", async () => {
    await render(<NotesStrip variant="section" about={{ paper: "smith-2024" }} />)
    await click(button())
    expect(notes.createNoteRemote).toHaveBeenCalledTimes(1)
    expect(notes.createNoteRemote).toHaveBeenCalledWith({ about: { paper: "smith-2024" } })
    expect(nav.push).toHaveBeenCalledWith("/wiki/notes/new-note")
  })

  it("holds the button while the note is made, and makes one note for two presses", async () => {
    let done: (id: string) => void = () => {}
    notes.createNoteRemote.mockReturnValue(new Promise<string>((resolve) => { done = resolve }))
    await render(<NotesStrip variant="section" about={{ paper: "smith-2024" }} />)
    await click(button())
    expect(button().disabled).toBe(true)
    await click(button())
    expect(notes.createNoteRemote).toHaveBeenCalledTimes(1)
    await act(async () => { done("made") })
    expect(nav.push).toHaveBeenCalledWith("/wiki/notes/made")
  })

  it("shows why a note could not be made, and lets the reader try again", async () => {
    notes.createNoteRemote.mockRejectedValueOnce(new Error("That paper could not be saved to your Library, so the note was not made."))
    await render(<NotesStrip variant="section" about={{ paper: "smith-2024" }} />)
    await click(button())
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("That paper could not be saved to your Library, so the note was not made.")
    expect(nav.push).not.toHaveBeenCalled()
    expect(button().disabled).toBe(false)
  })

  it("shows why the notes could not be read, and still offers a note", async () => {
    notes.listNotesRemote.mockRejectedValue(new Error("Your notes could not be reached (500)."))
    await render(<NotesStrip variant="section" about={{ paper: "smith-2024" }} />)
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("Your notes could not be reached (500).")
    expect(button()).toBeDefined()
  })

  it("asks again for another paper, and does not show the notes of the one before", async () => {
    await render(<NotesStrip variant="section" about={{ paper: "smith-2024" }} />)
    let answer: (list: NoteSummary[]) => void = () => {}
    notes.listNotesRemote.mockReturnValue(new Promise<NoteSummary[]>((resolve) => { answer = resolve }))
    await act(async () => { root!.render(<NotesStrip variant="section" about={{ paper: "lee-2023" }} />) })
    expect(notes.listNotesRemote).toHaveBeenLastCalledWith({ paper: "lee-2023" })
    expect(container.querySelectorAll("[data-note]")).toHaveLength(0)
    await act(async () => { answer([note("third")]) })
    expect([...container.querySelectorAll("[data-note]")].map((row) => row.getAttribute("data-note"))).toEqual(["third"])
  })
})

describe("the reader's notes on a condition", () => {
  const strip = <NotesStrip variant="line" about={{ condition: "schizophrenia" }} name="Schizophrenia" />

  it("says how many there are, linking to the Notes tab of that condition", async () => {
    await render(strip)
    expect(notes.listNotesRemote).toHaveBeenCalledWith({ condition: "schizophrenia" })
    expect(links()).toEqual([["Your notes on Schizophrenia (2)", "/wiki?view=all&tab=notes&condition=schizophrenia"]])
    expect(container.querySelectorAll("[data-note]")).toHaveLength(0)
    expect(button()).toBeDefined()
  })

  it("shows only the button when there are none", async () => {
    notes.listNotesRemote.mockResolvedValue([])
    await render(strip)
    expect(links()).toEqual([])
    expect(container.textContent).toBe("Write a note")
  })

  it("makes a note about the condition and opens it", async () => {
    await render(strip)
    await click(button())
    expect(notes.createNoteRemote).toHaveBeenCalledWith({ about: { condition: "schizophrenia" } })
    expect(nav.push).toHaveBeenCalledWith("/wiki/notes/new-note")
  })

  it("shows inline why a note could not be made", async () => {
    notes.createNoteRemote.mockRejectedValueOnce(new Error("That condition is not in the pack."))
    await render(strip)
    await click(button())
    expect(container.querySelector('[role="alert"]')!.textContent).toBe("That condition is not in the pack.")
    expect(button().disabled).toBe(false)
  })
})

describe("the reader's notes on a treatment", () => {
  const strip = <NotesStrip variant="line" about={{ condition: "schizophrenia", treatment: "clozapine" }} />

  it("says how many there are, linking to the Notes tab of that condition and treatment", async () => {
    await render(strip)
    expect(notes.listNotesRemote).toHaveBeenCalledWith({ condition: "schizophrenia", treatment: "clozapine" })
    expect(links()).toEqual([["2 notes", "/wiki?view=all&tab=notes&condition=schizophrenia&treatment=clozapine"]])
  })

  it("counts one note as one", async () => {
    notes.listNotesRemote.mockResolvedValue([TWO[0]])
    await render(strip)
    expect(links()[0][0]).toBe("1 note")
  })

  it("shows only the button when there are none", async () => {
    notes.listNotesRemote.mockResolvedValue([])
    await render(strip)
    expect(container.textContent).toBe("Write a note")
  })

  it("makes a note about the treatment under its condition and opens it", async () => {
    await render(strip)
    await click(button())
    expect(notes.createNoteRemote).toHaveBeenCalledWith({ about: { treatment: { condition: "schizophrenia", key: "clozapine" } } })
    expect(nav.push).toHaveBeenCalledWith("/wiki/notes/new-note")
  })
})
