// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { WikiPage } from "@/lib/vault/types"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ id: [] as string[], router: { push: vi.fn(), replace: vi.fn() } }))
vi.mock("next/navigation", () => ({ useParams: () => ({ id: nav.id }), useRouter: () => nav.router }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => ({}) }))
const bundle = vi.hoisted(() => ({ loadBundle: vi.fn() }))
vi.mock("@/lib/vault/bundle", () => bundle)
vi.mock("@/components/wiki/PageEditor", () => ({ PageEditor: () => <div data-testid="editor" /> }))
vi.mock("@/components/wiki/Backlinks", () => ({ Backlinks: () => <div data-testid="backlinks" /> }))
vi.mock("@/components/clinical/clinical-fence", () => ({ clinicalFence: () => null }))

import WikiPageDetail from "../[...id]/page"

let container: HTMLDivElement
async function open(id: string, type: string, body: string, extra: Record<string, unknown> = {}) {
  const page: WikiPage = { id, path: `${id}.md`, body, frontmatter: { type, title: "A page", created: "2026-10-07", updated: "2026-10-07", tags: [], related: [], sources: [], ...extra } }
  nav.id = id.replace(/^wiki\//, "").split("/")
  bundle.loadBundle.mockResolvedValue({ pages: new Map([[id, page]]), links: [], errors: [] })
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<WikiPageDetail />) })
  await act(async () => {})
}
const BLOCK = "## Evidence your feed has seen\n\n```condition-evidence\ncondition: schizophrenia\n```\n\n## My notes\n\nMine.\n"
beforeEach(() => { document.body.innerHTML = ""; bundle.loadBundle.mockReset(); nav.router.replace.mockReset() })

describe("the wiki page of a condition", () => {
  it("leads to the Evidence view on the condition its block names, and draws no editor or backlinks", async () => {
    await open("wiki/conditions/schizophrenia", "condition", BLOCK)
    expect(nav.router.replace).toHaveBeenCalledTimes(1)
    expect(nav.router.replace).toHaveBeenCalledWith("/wiki?condition=schizophrenia")
    expect(container.querySelector("[data-testid=editor]")).toBeNull()
    expect(container.querySelector("[data-testid=backlinks]")).toBeNull()
    expect(container.querySelector("h1")).toBeNull()
  })

  it("leads there by the condition its front matter holds, when the page has no block", async () => {
    await open("wiki/conditions/depression", "condition", "My own text.\n", { taxonomy: "depression" })
    expect(nav.router.replace).toHaveBeenCalledWith("/wiki?condition=depression")
  })

  it("stays an ordinary page when it names no condition", async () => {
    await open("wiki/conditions/something", "condition", "My own text.\n")
    expect(nav.router.replace).not.toHaveBeenCalled()
    expect(container.querySelector("[data-testid=editor]")).not.toBeNull()
  })

  it("does not move a paper page, though it holds the block", async () => {
    await open("wiki/papers/a-paper", "paper", BLOCK, { taxonomy: "schizophrenia" })
    expect(nav.router.replace).not.toHaveBeenCalled()
    expect(container.querySelector("[data-testid=editor]")).not.toBeNull()
    expect(container.querySelector("[data-testid=backlinks]")).not.toBeNull()
  })
})
