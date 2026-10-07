import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { paperSlug, buildPaperPage } from "../../wiki/authoring"
import { applyChangeset } from "../../vault/changesets"
import { serializeDocument } from "../../vault/frontmatter"
import { writeReaderHandoff } from "../../reader/handoff"
import { DASHBOARD_CACHE_PATH, TRENDING_BOARD_VERSION } from "../../trending/cache"
import { resolvePaperByKey, resolvePaperBySlug, extractAbstractFromBody } from "../resolve"
import type { PaperRecord } from "../types"
import { RECORD } from "../../clinical/__tests__/records-fixture"

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "A Study of Ear-EEG",
  authors: [{ name: "A. Author" }],
  abstract: "We study ear-EEG.",
  fields: [],
  source: "arxiv",
}

const BREAKOUT_PAPER: PaperRecord = {
  ...PAPER,
  ids: { doi: "10.22331/q-2026-08-13-2189" },
  title: "A Trending Breakout Paper",
  source: "openalex",
}

async function writeTrendingBoard(s: MemoryVaultStorage) {
  await s.write(
    DASHBOARD_CACHE_PATH,
    JSON.stringify({
      version: TRENDING_BOARD_VERSION,
      generatedAt: "2026-08-29T21:51:44.393Z",
      topics: [{ papers: [{ record: PAPER, wikiPageId: null }] }],
      breakouts: [{ record: BREAKOUT_PAPER, citationCount: 12, wikiPageId: null }],
    }),
  )
}

async function writePaperPage(s: MemoryVaultStorage, paper: PaperRecord) {
  const draft = buildPaperPage(paper, { fullText: true, today: "2026-07-17" })
  await applyChangeset(s, {
    id: "cs-test",
    skill: "test",
    model: "test",
    timestamp: "2026-07-17T00:00:00.000Z",
    changes: [{ path: draft.path, before: null, after: serializeDocument(draft.frontmatter, draft.body) }],
  })
}

describe("resolvePaperBySlug", () => {
  it("resolves a paper from its wiki page frontmatter", async () => {
    const s = new MemoryVaultStorage()
    await writePaperPage(s, PAPER)
    const resolved = await resolvePaperBySlug(s, paperSlug(PAPER))
    expect(resolved?.ids.arxiv).toBe("2409.08710")
    expect(resolved?.title).toBe("A Study of Ear-EEG")
  })
  it("returns null for an unknown slug", async () => {
    const s = new MemoryVaultStorage()
    expect(await resolvePaperBySlug(s, "arxiv-9999-99999")).toBeNull()
  })

  // CRUX gap (SP2 Task 13): a paper reached straight from a /papers search
  // result is in neither the feed cache nor the wiki yet — the search page
  // stashes a reader handoff before navigating to /paper/<slug>, and
  // resolvePaperBySlug must be able to read it back by slug, with no feed
  // cache and no wiki page in play at all.
  it("resolves a freshly-searched paper via its reader handoff, with no feed cache and no wiki page", async () => {
    const s = new MemoryVaultStorage()
    await writeReaderHandoff(s, PAPER)
    const resolved = await resolvePaperBySlug(s, paperSlug(PAPER))
    expect(resolved?.ids.arxiv).toBe("2409.08710")
    expect(resolved?.title).toBe("A Study of Ear-EEG")
  })

  it("resolves topic and breakout papers straight from the trending cache", async () => {
    const s = new MemoryVaultStorage()
    await writeTrendingBoard(s)

    expect((await resolvePaperBySlug(s, paperSlug(PAPER)))?.title).toBe("A Study of Ear-EEG")
    expect((await resolvePaperBySlug(s, paperSlug(BREAKOUT_PAPER)))?.title).toBe("A Trending Breakout Paper")
    expect((await resolvePaperByKey(s, "doi:10.22331/q-2026-08-13-2189"))?.title).toBe(
      "A Trending Breakout Paper",
    )
  })

  it("ignores malformed trending records instead of crashing paper resolution", async () => {
    const s = new MemoryVaultStorage()
    await s.write(
      DASHBOARD_CACHE_PATH,
      JSON.stringify({
        version: TRENDING_BOARD_VERSION,
        generatedAt: "2026-08-29T21:51:44.393Z",
        topics: [{ papers: [{ record: { title: "missing required fields" } }] }],
        breakouts: [{ record: null }],
      }),
    )

    await expect(resolvePaperBySlug(s, "missing-required-fields")).resolves.toBeNull()
  })
})

// Clinical edition: the treatment-options table and the review inbox link to /paper/<slug>. A paper
// that has left the feed cache, was never ingested and has no handoff is still found by its trial record.
describe("resolvePaperBySlug, from a stored trial record", () => {
  const TRIAL: PaperRecord = { ids: { pmid: "111" }, title: "Esketamine versus quetiapine", authors: [{ name: "A. Author" }], abstract: "A trial.", year: 2026, fields: [], source: "pubmed" }
  const record = (paper: unknown) => ({ ...RECORD, slug: paperSlug(TRIAL), paperKey: "pmid:111", title: TRIAL.title, paper })

  it("resolves a slug that only a trial record knows, with the paper as it was when the record was read", async () => {
    const s = new MemoryVaultStorage()
    await s.write(`records/${paperSlug(TRIAL)}.json`, JSON.stringify(record(TRIAL)))
    expect(await resolvePaperBySlug(s, paperSlug(TRIAL))).toEqual(TRIAL)
  })
  it("resolves nothing from a record stored before the paper was kept, an unreadable one, or one whose paper is another paper", async () => {
    const s = new MemoryVaultStorage()
    const slug = paperSlug(TRIAL)
    await s.write(`records/${slug}.json`, JSON.stringify(record(undefined)))
    expect(await resolvePaperBySlug(s, slug)).toBeNull()
    await s.write(`records/${slug}.json`, "{ not json")
    expect(await resolvePaperBySlug(s, slug)).toBeNull()
    await s.write(`records/${slug}.json`, JSON.stringify(record({ ...TRIAL, title: "Another paper altogether" })))
    expect(await resolvePaperBySlug(s, slug)).toBeNull()
    expect(await resolvePaperBySlug(s, "../.scispark/settings")).toBeNull()
  })
  it("prefers the wiki page of the paper to the copy in the record", async () => {
    const s = new MemoryVaultStorage()
    await writePaperPage(s, TRIAL)
    await s.write(`records/${paperSlug(TRIAL)}.json`, JSON.stringify(record({ ...TRIAL, venue: "From the record" })))
    expect((await resolvePaperBySlug(s, paperSlug(TRIAL)))?.venue).toBeUndefined()
  })
})

describe("resolvePaperBySlug, from the findings store", () => {
  it("resolves a paper that only the findings store still knows", async () => {
    const storage = new MemoryVaultStorage()
    const record = { ids: { pmid: "7" }, title: "A paper that left the feed", authors: [], fields: [], source: "pubmed" as const }
    await storage.write(".scispark/clinical/findings.json", JSON.stringify({ version: 1, findings: { "pmid:7": {
      key: "pmid:7", slug: "a-paper-that-left-the-feed", paper: record, headline: "H", takeaway: "T", design: "cohort", designSource: "none", journalBand: null,
      conditionCodes: [], kind: null, treatment: null, treatmentCode: null, text: null, population: null, comparator: null, outcome: null,
      firstListedAt: "2026-10-01T10:00:00.000Z", lastListedAt: "2026-10-01T10:00:00.000Z" } } }))
    const resolved = await resolvePaperBySlug(storage, "a-paper-that-left-the-feed")
    expect(resolved?.title).toBe("A paper that left the feed")
  })
})

describe("extractAbstractFromBody", () => {
  it("pulls the text under a ## Abstract heading", () => {
    const body = "# Title\n\n## Abstract\n\nWe study ear-EEG.\n"
    expect(extractAbstractFromBody(body)).toBe("We study ear-EEG.")
  })

  it("stops at the next ## heading and does not swallow later sections", () => {
    const body =
      "# Title\n\n## Abstract\n\nLine one.\nLine two.\n\n## Links\n\n- DOI: something\n"
    expect(extractAbstractFromBody(body)).toBe("Line one.\nLine two.")
  })

  it("returns undefined when there is no Abstract section", () => {
    const body = "# Title\n\n## Digest\n\nSome digest.\n"
    expect(extractAbstractFromBody(body)).toBeUndefined()
  })

  it("returns undefined for an empty Abstract section", () => {
    const body = "# Title\n\n## Abstract\n\n## Links\n\n- x\n"
    expect(extractAbstractFromBody(body)).toBeUndefined()
  })

  it("round-trips a real buildPaperPage body", () => {
    const draft = buildPaperPage(PAPER, { fullText: true, today: "2026-07-17" })
    expect(extractAbstractFromBody(draft.body)).toBe("We study ear-EEG.")
  })
})
