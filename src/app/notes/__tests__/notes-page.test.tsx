// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: nav.push }), useSearchParams: () => nav.params }))
const notes = vi.hoisted(() => ({ listNotesRemote: vi.fn(), createNoteRemote: vi.fn() }))
vi.mock("@/lib/clinical/notes/client", () => notes)

import NotesPage from "../page"

const note = (id: string, kind: string) => ({
  id, title: `Title of ${id}`, excerpt: "", updated: "2026-10-05", created: "2026-10-01", links: { papers: [], conditions: [], treatments: [] },
  kind, conditions: [{ code: "depression", name: "Major depressive disorder" }], papers: [], treatments: [], newSince: 0, project: false,
})

let container: HTMLDivElement
async function render(query = "") {
  nav.params = new URLSearchParams(query)
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<NotesPage />) })
  await act(async () => {})
}

beforeEach(() => {
  document.body.innerHTML = ""
  nav.replace.mockReset()
  notes.listNotesRemote.mockReset().mockResolvedValue([note("a", "paper"), note("b", "topic")])
})

describe("the Notes page (/notes)", () => {
  it("draws the list of notes under the heading Notes, with the button that makes one", async () => {
    await render()
    expect(container.querySelector("h1")!.textContent).toBe("Notes")
    expect([...container.querySelectorAll("[data-note]")].map((row) => row.getAttribute("data-note"))).toEqual(["a", "b"])
    expect(container.querySelector('[data-note="a"] a')!.getAttribute("href")).toBe("/wiki/notes/a")
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "New note")).toBe(true)
  })

  it("reads its filters from its own address and writes them back to it", async () => {
    await render("q=keta&condition=depression&kind=topic&treatment=esketamine")
    expect(notes.listNotesRemote).toHaveBeenCalledWith({ q: "keta", condition: "depression", treatment: "esketamine" })
    expect((container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe("keta")
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("depression")
    expect(container.querySelector('[role="group"] button[aria-pressed="true"]')!.textContent).toContain("On a topic")
    expect([...container.querySelectorAll("[data-note]")].map((row) => row.getAttribute("data-note"))).toEqual(["b"])
    await act(async () => { (container.querySelector('[role="group"] button') as HTMLButtonElement).click() })
    expect(nav.replace).toHaveBeenCalledWith("/notes?q=keta&condition=depression&treatment=esketamine")
  })
})
