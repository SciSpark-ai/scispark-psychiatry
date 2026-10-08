// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Bundle } from "@/lib/vault/bundle"
import type { Frontmatter, WikiPage } from "@/lib/vault/types"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: nav.push }), useSearchParams: () => nav.params }))
const notes = vi.hoisted(() => ({ listNotesRemote: vi.fn(), createNoteRemote: vi.fn() }))
vi.mock("@/lib/clinical/notes/client", () => notes)
vi.mock("../NotesTab", () => ({ NotesTab: () => <div data-testid="notes-tab" /> }))

import { LibraryTabs } from "../LibraryTabs"

const fm = (type: string, title: string): Frontmatter => ({ type, title, created: "2026-07-11", updated: "2026-07-11", tags: [], related: [], sources: [] })
function bundleOf(entries: Array<[string, string, string]>): Bundle {
  const pages = new Map<string, WikiPage>()
  for (const [id, type, title] of entries) pages.set(id, { id, path: `${id}.md`, frontmatter: fm(type, title), body: "" })
  return { pages, links: [], errors: [] }
}
const BUNDLE = bundleOf([
  ["wiki/papers/first", "paper", "First Paper"],
  ["wiki/papers/second", "paper", "Second Paper"],
  ["wiki/projects/a-review", "project", "A Review"],
  ["wiki/queries/a-question", "query", "A Question"],
  ["wiki/queries/b-question", "query", "B Question"],
  ["wiki/queries/c-question", "query", "C Question"],
  ["wiki/conditions/depression", "condition", "Major depressive disorder"],
  // The bundle's own count of note pages is not the tab's: the notes list is.
  ["wiki/notes/a-note", "note", "A Note"],
])

let container: HTMLDivElement
let root: ReturnType<typeof createRoot> | null = null
async function render(query: string, bundle: Bundle = BUNDLE) {
  nav.params = new URLSearchParams(query)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<LibraryTabs bundle={bundle} />) })
  await act(async () => {})
}
const tabs = () => [...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
const chosen = () => tabs().filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.getAttribute("data-tab"))
const panel = () => container.querySelector('[role="tabpanel"]') as HTMLElement

beforeEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ""
  nav.replace.mockReset()
  notes.listNotesRemote.mockReset().mockResolvedValue(new Array(5).fill({}))
})

describe("the tabs of the Library", () => {
  it("has the four tabs, each with its count; the notes are counted by the notes list with no filter", async () => {
    await render("view=all")
    expect(container.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe("Parts of your Library")
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Papers 2", "Notes 5", "Projects 1", "Saved chats 3"])
    expect(notes.listNotesRemote).toHaveBeenCalledTimes(1)
    expect(notes.listNotesRemote).toHaveBeenCalledWith()
  })

  it("shows the Notes tab without a count until the notes are counted, and when they cannot be", async () => {
    notes.listNotesRemote.mockRejectedValue(new Error("no"))
    await render("view=all")
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Papers 2", "Notes", "Projects 1", "Saved chats 3"])
  })

  it("opens on Papers, as does an address that names no tab of it", async () => {
    await render("view=all")
    expect(chosen()).toEqual(["papers"])
    expect(panel().getAttribute("aria-labelledby")).toBe(tabs()[0].id)
    expect(panel().innerHTML).toMatch(/href="\/paper\/first"/)
    expect(panel().textContent).toContain("Second Paper")
    expect(panel().textContent).not.toContain("A Review")
    expect(panel().textContent).not.toContain("A Question")
    await render("view=all&tab=zzz")
    expect(chosen()).toEqual(["papers"])
  })

  it("never shows the Conditions group, on any tab", async () => {
    for (const query of ["view=all", "view=all&tab=notes", "view=all&tab=projects", "view=all&tab=chats"]) {
      await render(query)
      expect(container.textContent).not.toContain("Conditions")
      expect(container.textContent).not.toContain("Major depressive disorder")
    }
  })

  it("reads the tab from the address", async () => {
    await render("view=all&tab=projects")
    expect(chosen()).toEqual(["projects"])
    expect(panel().innerHTML).toMatch(/href="\/wiki\/projects\/a-review"/)
    expect(panel().textContent).not.toContain("First Paper")

    await render("view=all&tab=chats")
    expect(chosen()).toEqual(["chats"])
    expect(panel().innerHTML).toMatch(/href="\/wiki\/queries\/a-question"/)
    expect(panel().textContent).not.toContain("Saved answers")

    await render("view=all&tab=notes")
    expect(chosen()).toEqual(["notes"])
    expect(panel().querySelector("[data-testid=notes-tab]")).not.toBeNull()
    expect(panel().textContent).not.toContain("A Note")
  })

  it("writes a chosen tab to the address, Papers by leaving it out", async () => {
    await render("view=all")
    await act(async () => { tabs()[1].click() })
    expect(nav.replace).toHaveBeenLastCalledWith("/wiki?view=all&tab=notes")
    await act(async () => { tabs()[3].click() })
    expect(nav.replace).toHaveBeenLastCalledWith("/wiki?view=all&tab=chats")
    await act(async () => { tabs()[0].click() })
    expect(nav.replace).toHaveBeenLastCalledWith("/wiki?view=all")
  })

  it("points to the paper search when the Library has no paper", async () => {
    await render("view=all", bundleOf([["wiki/projects/a-review", "project", "A Review"]]))
    expect(panel().textContent).toContain("Your Library has no papers yet")
    expect(panel().querySelector('a[href="/papers"]')!.textContent).toBe("Search for papers →")
    await render("view=all&tab=projects", bundleOf([]))
    expect(panel().querySelector('a[href="/papers"]')).toBeNull()
  })
})
