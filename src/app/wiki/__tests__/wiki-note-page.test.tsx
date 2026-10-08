// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { WikiPage } from "@/lib/vault/types"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ id: [] as string[], router: { push: vi.fn(), replace: vi.fn() } }))
vi.mock("next/navigation", () => ({ useParams: () => ({ id: nav.id }), useRouter: () => nav.router }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => ({}) }))
const bundle = vi.hoisted(() => ({ loadBundle: vi.fn() }))
vi.mock("@/lib/vault/bundle", () => bundle)
const removal = vi.hoisted(() => ({ deletePage: vi.fn() }))
vi.mock("@/lib/wiki/delete", () => ({ isDeletablePage: () => true, backlinkCount: () => 2, deletePage: removal.deletePage }))
vi.mock("@/components/wiki/PageEditor", () => ({ PageEditor: () => <div data-testid="editor" /> }))
vi.mock("@/components/wiki/Backlinks", () => ({ Backlinks: () => <div data-testid="backlinks" /> }))
vi.mock("@/components/clinical/clinical-fence", () => ({ clinicalFence: () => null }))
vi.mock("@/components/clinical/NotePage", () => ({
  NotePage: (props: { id: string; untitled: boolean; onDelete: () => void; confirm?: ReactNode }) => (
    <div data-testid="note-page" data-id={props.id} data-untitled={String(props.untitled)}>
      <button type="button" data-testid="note-delete" onClick={props.onDelete} />
      {props.confirm}
    </div>
  ),
}))

import WikiPageDetail from "../[...id]/page"

let container: HTMLDivElement
let opened: WikiPage
async function open(id: string, type: string, title = "A page") {
  opened = { id, path: `${id}.md`, body: "Text.\n", frontmatter: { type, title, created: "2026-10-07", updated: "2026-10-07", tags: [], related: [], sources: [] } } as WikiPage
  nav.id = id.replace(/^wiki\//, "").split("/")
  bundle.loadBundle.mockResolvedValue({ pages: new Map([[id, opened]]), links: [], errors: [] })
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<WikiPageDetail />) })
  await act(async () => {})
}
const note = () => container.querySelector("[data-testid=note-page]")
const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click() }) }
beforeEach(() => {
  document.body.innerHTML = ""
  for (const mock of [bundle.loadBundle, removal.deletePage, nav.router.push, nav.router.replace]) mock.mockReset()
})

describe("the wiki page of a note", () => {
  it("draws the note page for it, by the note's id, and none of the editor, the Save button or the Backlinks", async () => {
    await open("wiki/notes/esketamine-in-trd", "note", "Esketamine in TRD")
    expect(note()?.getAttribute("data-id")).toBe("esketamine-in-trd")
    expect(note()?.getAttribute("data-untitled")).toBe("false")
    expect(container.querySelector("[data-testid=editor]")).toBeNull()
    expect(container.querySelector("[data-testid=backlinks]")).toBeNull()
    expect(container.querySelector("h1")).toBeNull()
    expect([...container.querySelectorAll("button")].some((entry) => entry.textContent === "Save")).toBe(false)
    expect(nav.router.replace).not.toHaveBeenCalled()
  })

  it("tells the note page when the stored title is the old button's", async () => {
    await open("wiki/notes/note-20261001-ab12", "note", "Untitled note")
    expect(note()?.getAttribute("data-untitled")).toBe("true")
  })

  it("keeps the editor for every other type, and for a note page outside the notes directory", async () => {
    for (const [id, type] of [["wiki/papers/a-paper", "paper"], ["wiki/concepts/a-concept", "concept"], ["wiki/projects/p/a-note", "note"]]) {
      document.body.innerHTML = ""
      await open(id, type)
      expect(note()).toBeNull()
      expect(container.querySelector("[data-testid=editor]")).not.toBeNull()
      expect(container.querySelector("[data-testid=backlinks]")).not.toBeNull()
    }
  })

  it("asks once before deleting, deletes through the wiki's changeset delete, and returns to the Notes tab", async () => {
    removal.deletePage.mockResolvedValue("changeset-1")
    await open("wiki/notes/esketamine-in-trd", "note", "Esketamine in TRD")
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await click(container.querySelector("[data-testid=note-delete]") as Element)
    const card = container.querySelector('[role="dialog"]') as HTMLElement
    expect(card.textContent).toContain("Esketamine in TRD")
    expect(removal.deletePage).not.toHaveBeenCalled()
    await click([...card.querySelectorAll("button")].find((entry) => entry.textContent === "Delete") as Element)
    await act(async () => {})
    expect(removal.deletePage).toHaveBeenCalledTimes(1)
    expect(removal.deletePage.mock.calls[0][1]).toBe(opened)
    expect(nav.router.push).toHaveBeenCalledWith("/wiki?view=all&tab=notes")
  })

  it("deletes nothing when the reader cancels, and still sends another page's delete to the wiki", async () => {
    await open("wiki/notes/esketamine-in-trd", "note")
    await click(container.querySelector("[data-testid=note-delete]") as Element)
    await click([...container.querySelectorAll('[role="dialog"] button')].find((entry) => entry.textContent === "Cancel") as Element)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(removal.deletePage).not.toHaveBeenCalled()

    document.body.innerHTML = ""
    removal.deletePage.mockResolvedValue("changeset-2")
    await open("wiki/concepts/a-concept", "concept")
    await click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "Delete") as Element)
    await click([...container.querySelectorAll('[role="dialog"] button')].find((entry) => entry.textContent === "Delete") as Element)
    await act(async () => {})
    expect(nav.router.push).toHaveBeenCalledWith("/wiki")
  })
})
