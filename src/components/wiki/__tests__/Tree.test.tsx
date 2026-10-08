// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { Bundle } from "@/lib/vault/bundle"
import type { Frontmatter, WikiPage } from "@/lib/vault/types"
import { Tree } from "../Tree"

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

describe("Tree paper routing (SP3 task 3)", () => {
  it("links a paper node to /paper/<slug> instead of the wiki editor route", () => {
    const bundle = bundleFromPages([
      { id: "wiki/papers/ear-eeg-2409-08710", frontmatter: fm("paper", "Ear-EEG Attention") },
    ])
    const html = renderToStaticMarkup(<Tree bundle={bundle} />)
    expect(html).toMatch(/href="\/paper\/ear-eeg-2409-08710"/)
    expect(html).not.toMatch(/href="\/wiki\/papers\/ear-eeg-2409-08710"/)
  })

  it("leaves a non-paper node's href on the wikiHref route", () => {
    const bundle = bundleFromPages([
      { id: "wiki/notes/attention", frontmatter: fm("note", "Attention Mechanism") },
    ])
    const html = renderToStaticMarkup(<Tree bundle={bundle} />)
    expect(html).toMatch(/href="\/wiki\/notes\/attention"/)
  })
})

describe("Tree type headings (SP5 task 1: reinstated 'query' type)", () => {
  it("labels a 'query' section 'Saved answers', not the raw type", () => {
    const bundle = bundleFromPages([
      { id: "wiki/queries/what-causes-x", frontmatter: fm("query", "What causes X?") },
    ])
    const html = renderToStaticMarkup(<Tree bundle={bundle} />)
    expect(html).toContain("Saved answers")
    expect(html).not.toMatch(/>query</)
  })
})

describe("Tree in the clinical edition", () => {
  it("does not list concept, topic or author pages", () => {
    const bundle = bundleFromPages([
      { id: "wiki/papers/a-paper", frontmatter: fm("paper", "A Paper") },
      { id: "wiki/conditions/depression", frontmatter: fm("condition", "Major depressive disorder") },
      { id: "wiki/notes/a-note", frontmatter: fm("note", "A Note") },
      { id: "wiki/concepts/attention", frontmatter: fm("concept", "Attention Mechanism") },
      { id: "wiki/topics/sleep", frontmatter: fm("topic", "Sleep Overview") },
      { id: "wiki/authors/a-author", frontmatter: fm("author", "A. Author") },
    ])
    const html = renderToStaticMarkup(<Tree bundle={bundle} />)
    for (const shown of ["A Paper", "Major depressive disorder", "A Note"]) expect(html).toContain(shown)
    for (const hidden of ["Attention Mechanism", "Sleep Overview", "A. Author"]) expect(html).not.toContain(hidden)
  })
})

describe("Tree with a type filter (the Library's tabs)", () => {
  it("lists only the pages of the given types, without a heading", () => {
    const bundle = bundleFromPages([
      { id: "wiki/papers/a-paper", frontmatter: fm("paper", "A Paper") },
      { id: "wiki/conditions/depression", frontmatter: fm("condition", "Major depressive disorder") },
      { id: "wiki/notes/a-note", frontmatter: fm("note", "A Note") },
      { id: "wiki/queries/a-question", frontmatter: fm("query", "A Question") },
    ])
    const html = renderToStaticMarkup(<Tree bundle={bundle} types={["query"]} />)
    expect(html).toContain("A Question")
    expect(html).toMatch(/href="\/wiki\/queries\/a-question"/)
    for (const hidden of ["A Paper", "Major depressive disorder", "A Note", "Saved answers", "Papers", "Conditions"]) expect(html).not.toContain(hidden)
    expect(html).not.toContain("max-h-48")
  })

  it("says so when the type has no page", () => {
    const html = renderToStaticMarkup(<Tree bundle={bundleFromPages([])} types={["project"]} />)
    expect(html).toContain("None yet")
  })
})
