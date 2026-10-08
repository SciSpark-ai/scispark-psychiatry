// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import type { Bundle } from "@/lib/vault/bundle"
import type { Frontmatter, WikiPage } from "@/lib/vault/types"

const loadBundleMock = vi.fn()
const reviewCountMock = vi.fn()
let searchParamsValue = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: (...args: unknown[]) => replaceMock(...args) }),
  useSearchParams: () => searchParamsValue,
}))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => ({}) }))
vi.mock("@/lib/vault/bundle", () => ({
  loadBundle: (...args: unknown[]) => loadBundleMock(...args),
}))
vi.mock("@/lib/wiki/review-queue", () => ({
  reviewCount: (...args: unknown[]) => reviewCountMock(...args),
}))
vi.mock("@/lib/clinical/records/client", () => ({ listConditionsRemote: async () => [], createConditionPageRemote: async () => ({ id: "", created: false }) }))

vi.mock("@/components/clinical/EvidencePage", () => ({ EvidencePage: () => <div data-testid="evidence-page" /> }))
vi.mock("@/lib/clinical/evidence/client", () => ({ listFollowedConditionsRemote: async () => [] }))
const replaceMock = vi.fn()
vi.mock("@/lib/clinical/readlater/store", () => ({ loadReadLater: async () => [{}, {}] }))
vi.mock("@/components/clinical/ReadLaterList", () => ({ ReadLaterList: () => <div data-testid="read-later" /> }))
vi.mock("@/components/clinical/FeedHistory", () => ({ FeedHistory: () => <div data-testid="feed-history" /> }))

import WikiIndexPage from "../page"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type,
  title,
  created: "2026-07-11",
  updated: "2026-07-11",
  tags: [],
  related: [],
  sources: [],
  ...extra,
})

function bundleFromPages(entries: Array<{ id: string; frontmatter: Frontmatter }>): Bundle {
  const pages = new Map<string, WikiPage>()
  for (const e of entries) {
    pages.set(e.id, { id: e.id, path: `${e.id}.md`, frontmatter: e.frontmatter, body: "" })
  }
  return { pages, links: [], errors: [] }
}

function smallBundle(): Bundle {
  return bundleFromPages([
    { id: "wiki/papers/saved-one", frontmatter: fm("paper", "Saved Paper One", { status: "saved", updated: "2026-07-20" }) },
    { id: "wiki/papers/enriched-one", frontmatter: fm("paper", "Enriched Paper One", { status: "enriched", updated: "2026-07-19" }) },
    { id: "wiki/papers/ingested-one", frontmatter: fm("paper", "Ingested Paper One", { status: "ingested", updated: "2026-07-18" }) },
    { id: "wiki/concepts/attention", frontmatter: fm("concept", "Attention Mechanism", { updated: "2026-07-17" }) },
    { id: "wiki/notes/idea-note", frontmatter: fm("note", "A quick note", { updated: "2026-07-16" }) },
    { id: "wiki/conditions/depression", frontmatter: fm("condition", "Major depressive disorder", { updated: "2026-07-15" }) },
  ])
}

function emptyBundle(): Bundle {
  return { pages: new Map(), links: [], errors: [] }
}

async function renderPage(): Promise<{ container: HTMLElement; root: ReturnType<typeof createRoot>; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<WikiIndexPage />)
  })
  await act(async () => {})
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  searchParamsValue = new URLSearchParams()
  reviewCountMock.mockResolvedValue(3)
  replaceMock.mockReset()
})

const title = (container: HTMLElement) => container.querySelector("h1")?.textContent
const hasLink = (container: HTMLElement, href: string) => container.querySelector(`a[href="${href}"]`) !== null

describe("WikiIndexPage — Evidence view (default)", () => {
  it("shows the Evidence view on wiki home under the heading Wiki, with none of the wiki's old buttons in the header", async () => {
    loadBundleMock.mockResolvedValue(smallBundle())
    const { container, cleanup } = await renderPage()

    expect(title(container)).toBe("Wiki")
    // Owner decision 2026-10-09: the review inbox, New note and the making of a condition page are not of this view.
    expect(container.textContent).not.toContain("New note")
    expect(container.textContent).not.toContain("Review inbox")
    expect(hasLink(container, "/wiki/inbox")).toBe(false)
    expect(container.textContent).not.toContain("New condition page")
    expect(container.querySelector("select")).toBeNull()
    expect(container.querySelector("button")).toBeNull()
    expect(container.querySelector("[data-testid=evidence-page]")).not.toBeNull()
    // nothing of the upstream dashboard, and no Dashboard / All pages toggle
    expect(container.textContent).not.toContain("In knowledge base")
    expect(container.textContent).not.toContain("Dashboard")
    expect(container.textContent).not.toContain("All pages")
    // Read later and History belong to the Library view
    expect(hasLink(container, "/read-later")).toBe(false)
    expect(hasLink(container, "/feed-history")).toBe(false)

    cleanup()
  })
})

describe("WikiIndexPage — Library view (?view=all)", () => {
  it("renders the Library's tabs under a header that keeps only the review inbox", async () => {
    searchParamsValue = new URLSearchParams("view=all")
    loadBundleMock.mockResolvedValue(smallBundle())
    const { container, cleanup } = await renderPage()

    expect(title(container)).toBe("Library")
    expect(container.textContent).toContain("Review inbox (3)")
    expect(hasLink(container, "/wiki/inbox")).toBe(true)
    // Read later and History are tabs here, not links to their own pages; a note is made on the Notes page.
    expect(hasLink(container, "/read-later")).toBe(false)
    expect(hasLink(container, "/feed-history")).toBe(false)
    expect(container.textContent).not.toContain("New note")
    expect(container.textContent).not.toContain("All pages")
    expect(container.querySelector("[data-testid=evidence-page]")).toBeNull()

    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("data-tab"))).toEqual(["papers", "read-later", "history", "chats"])
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["Papers 3", "Read later 2", "History", "Saved chats 0"])
    // Papers is the tab an address without one opens on: papers link to /paper/<slug>; no other type is listed.
    expect(container.innerHTML).toMatch(/href="\/paper\/saved-one"/)
    expect(container.textContent).not.toContain("Attention Mechanism")
    expect(container.textContent).not.toContain("A quick note")
    expect(container.textContent).not.toContain("Conditions")
    expect(container.textContent).not.toContain("Major depressive disorder")

    cleanup()
  })

  it("draws Read later and History as tabs, each what its own page draws", async () => {
    loadBundleMock.mockResolvedValue(smallBundle())
    searchParamsValue = new URLSearchParams("view=all&tab=read-later")
    const later = await renderPage()
    expect(later.container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-tab")).toBe("read-later")
    expect(later.container.querySelector("[data-testid=read-later]")).not.toBeNull()
    expect(later.container.innerHTML).not.toMatch(/href="\/paper\/saved-one"/)
    later.cleanup()

    searchParamsValue = new URLSearchParams("view=all&tab=history")
    const history = await renderPage()
    expect(history.container.querySelector("[data-testid=feed-history]")).not.toBeNull()
    history.cleanup()
  })

  it("sends an old address of the Notes tab to the Notes page", async () => {
    searchParamsValue = new URLSearchParams("view=all&tab=notes&condition=depression")
    loadBundleMock.mockResolvedValue(smallBundle())
    const { container, cleanup } = await renderPage()

    expect(replaceMock).toHaveBeenCalledWith("/notes?condition=depression")
    expect(container.querySelector('[role="tab"]')).toBeNull()

    cleanup()
  })
})

describe("WikiIndexPage — empty vault", () => {
  it("renders EmptyState with a Search for papers link in the Library view only", async () => {
    searchParamsValue = new URLSearchParams("view=all")
    loadBundleMock.mockResolvedValue(emptyBundle())
    const library = await renderPage()

    expect(library.container.textContent).toContain("Search for papers")
    expect(library.container.innerHTML).toMatch(/href="\/papers"/)
    library.cleanup()

    searchParamsValue = new URLSearchParams()
    const home = await renderPage()
    expect(home.container.querySelector("[data-testid=evidence-page]")).not.toBeNull()
    expect(home.container.textContent).not.toContain("Search for papers")
    home.cleanup()
  })
})
