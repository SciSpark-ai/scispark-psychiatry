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
  useRouter: () => ({ push: vi.fn() }),
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

vi.mock("@/components/clinical/ConditionHome", () => ({ ConditionHome: () => <div data-testid="condition-home" /> }))
vi.mock("@/lib/clinical/evidence/client", () => ({ listFollowedConditionsRemote: async () => [] }))

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
})

const title = (container: HTMLElement) => container.querySelector("h1")?.textContent
const hasLink = (container: HTMLElement, href: string) => container.querySelector(`a[href="${href}"]`) !== null

describe("WikiIndexPage — Evidence view (default)", () => {
  it("shows the conditions on wiki home and keeps New note + inbox count in the header", async () => {
    loadBundleMock.mockResolvedValue(smallBundle())
    const { container, cleanup } = await renderPage()

    expect(title(container)).toBe("Evidence")
    expect(container.textContent).toContain("New note")
    expect(container.textContent).toContain("Review inbox (3)")
    expect(container.querySelector("[data-testid=condition-home]")).not.toBeNull()
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
  it("renders the Tree, links to Read later and History, and keeps the header actions", async () => {
    searchParamsValue = new URLSearchParams("view=all")
    loadBundleMock.mockResolvedValue(smallBundle())
    const { container, cleanup } = await renderPage()

    expect(title(container)).toBe("Library")
    expect(container.textContent).toContain("New note")
    expect(container.textContent).toContain("Review inbox (3)")
    expect(hasLink(container, "/read-later")).toBe(true)
    expect(hasLink(container, "/feed-history")).toBe(true)
    expect(container.textContent).not.toContain("All pages")
    expect(container.querySelector("[data-testid=condition-home]")).toBeNull()

    // Tree groups by type heading and links papers to /paper/<slug>; concept pages are not listed
    expect(container.textContent).toContain("Papers")
    expect(container.textContent).not.toContain("Attention Mechanism")
    expect(container.innerHTML).toMatch(/href="\/paper\/saved-one"/)

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
    expect(home.container.querySelector("[data-testid=condition-home]")).not.toBeNull()
    expect(home.container.textContent).not.toContain("Search for papers")
    home.cleanup()
  })
})
