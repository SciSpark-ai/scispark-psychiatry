// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { WikiPage } from "@/lib/vault/types"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const route = vi.hoisted(() => ({ id: [] as string[] }))
vi.mock("next/navigation", () => ({ useParams: () => ({ id: route.id }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => ({}) }))
const bundle = vi.hoisted(() => ({ loadBundle: vi.fn() }))
vi.mock("@/lib/vault/bundle", () => bundle)
vi.mock("@/components/wiki/PageEditor", () => ({ PageEditor: () => null }))
vi.mock("@/components/wiki/Backlinks", () => ({ Backlinks: () => null }))
vi.mock("@/components/clinical/clinical-fence", () => ({ clinicalFence: () => null }))

import WikiPageDetail from "../[...id]/page"

const page = (id: string, type: string): WikiPage => ({
  id, path: `${id}.md`, body: "",
  frontmatter: { type, title: "A page", created: "2026-10-07", updated: "2026-10-07", tags: [], related: [], sources: [] },
})
async function backLink(id: string, type: string) {
  route.id = id.replace(/^wiki\//, "").split("/")
  bundle.loadBundle.mockResolvedValue({ pages: new Map([[id, page(id, type)]]) })
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<WikiPageDetail />) })
  await act(async () => {})
  const link = container.querySelector("a") as HTMLAnchorElement
  return [link.textContent?.trim(), link.getAttribute("href")]
}
beforeEach(() => { document.body.innerHTML = ""; bundle.loadBundle.mockReset() })

describe("the way back from a wiki page", () => {
  it("leads to Evidence from a condition page", async () => {
    expect(await backLink("wiki/conditions/schizophrenia", "condition")).toEqual(["← Evidence", "/wiki"])
  })
  it("leads to the Library from any other page", async () => {
    expect(await backLink("wiki/papers/a-paper", "paper")).toEqual(["← Library", "/wiki?view=all"])
    document.body.innerHTML = ""
    expect(await backLink("wiki/notes/a-note", "note")).toEqual(["← Library", "/wiki?view=all"])
  })
})
