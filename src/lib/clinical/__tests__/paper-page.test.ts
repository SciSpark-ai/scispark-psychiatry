import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { findCardDigest } from "../digest/lookup"
import { CACHE_PATH, textHash } from "../feed/cache"
import { FEED_PATH } from "../feed/stored"
import { toCandidate } from "../retrieve/pool"
import { abstractSections } from "../text/abstract-sections"
import { paper } from "./helpers"

// Owner requests 2026-10-07 for the page a card opens.

describe("abstractSections", () => {
  it("splits a structured abstract into sections with readable labels", () => {
    expect(abstractSections("OBJECTIVE: To screen metabolites.\nMETHODS: Plasma from 30 patients.\nRESULTS: 237 differed.\nCONCLUSION: Pathways were altered.\nTRIAL REGISTRATION: Not applicable.")).toEqual([
      { label: "Objective", text: "To screen metabolites." },
      { label: "Methods", text: "Plasma from 30 patients." },
      { label: "Results", text: "237 differed." },
      { label: "Conclusion", text: "Pathways were altered." },
      { label: "Trial registration", text: "Not applicable." },
    ])
  })
  it("joins a label that PubMed split in two", () => {
    expect(abstractSections("BACKGROUND: AND\nOBJECTIVE: A new formulation.\nMETHODS: A trial.")).toEqual([
      { label: "Background and objective", text: "A new formulation." },
      { label: "Methods", text: "A trial." },
    ])
  })
  it("keeps an unstructured abstract as one section without a label", () => {
    expect(abstractSections("We studied 40 patients. Symptoms fell by half.")).toEqual([{ text: "We studied 40 patients. Symptoms fell by half." }])
    expect(abstractSections(undefined)).toEqual([])
  })
  it("does not take a sentence with a colon for a label", () => {
    expect(abstractSections("Caveat: mixed. We found three things: a, b and c.")).toEqual([{ text: "Caveat: mixed. We found three things: a, b and c." }])
  })
})

describe("findCardDigest", () => {
  const record = paper({ title: "Esketamine nasal spray in depression", ids: { pmid: "77" }, abstract: "Adults received esketamine." })
  const digest = { headline: "Esketamine helped", takeaway: "Adults improved.", quote: "Adults received esketamine." }
  it("finds the AI headline and summary of a paper in the list on Home", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(FEED_PATH, JSON.stringify({ items: [{ key: "pmid:77", digest }], lowerConfidence: [] }))
    expect(await findCardDigest(storage, record)).toEqual(digest)
  })
  it("falls back to the stored summaries, for a paper opened from an earlier list or from Read later", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(CACHE_PATH, JSON.stringify({ version: 1, entriesKey: "x", grades: {}, digests: { "pmid:77": { hash: textHash(record), at: "2026-10-07T00:00:00.000Z", value: digest, scheme: 2 } } }))
    expect(await findCardDigest(storage, record)).toEqual(digest)
    // A summary kept under earlier checks is not shown.
    await storage.write(CACHE_PATH, JSON.stringify({ version: 1, entriesKey: "x", grades: {}, digests: { "pmid:77": { hash: textHash(record), at: "2026-10-07T00:00:00.000Z", value: digest } } }))
    expect(await findCardDigest(storage, record)).toBeNull()
  })
  it("returns nothing when the paper has no summary, or the files cannot be read", async () => {
    const storage = new MemoryVaultStorage()
    expect(await findCardDigest(storage, record)).toBeNull()
    await storage.write(FEED_PATH, "{ not json")
    await storage.write(CACHE_PATH, "{ not json")
    expect(await findCardDigest(storage, record)).toBeNull()
  })
})

describe("author names", () => {
  it("are shown with their letters, not as character codes", () => {
    const record = paper({ title: "A study of something long enough", ids: { pmid: "5" }, authors: [{ name: "Jens M&#xf8;llegaard Jepsen" }, { name: "Dost &#xd6;ng&#xfc;r" }, { name: "&#x130;smet K&#x131;rp&#x131;nar" }, { name: "Ana O&apos;Neil" }] })
    expect(toCandidate(record, { query: "q", tier: "entry" })!.paper.authors.map((author) => author.name)).toEqual(["Jens Møllegaard Jepsen", "Dost Öngür", "İsmet Kırpınar", "Ana O'Neil"])
  })
})

// Owner decision 2026-10-07: the paper page reads header, AI summary, abstract, digest, in that order.
describe("the order of the paper page", () => {
  it("puts the digest, once written, above the abstract, which stays open; one digest and its button in the top row", async () => {
    const { readFileSync } = await import("node:fs")
    const source = readFileSync("src/app/paper/[key]/page.tsx", "utf8")
    const abstract = source.indexOf('data-testid="paper-abstract"')
    expect(abstract).toBeGreaterThan(-1)
    expect(source.indexOf("<ClinicalPaperDigest")).toBeGreaterThan(-1)
    expect(source.indexOf("<ClinicalPaperDigest")).toBeLessThan(abstract)
    // Decision D56: the trial-data panel is not on the paper page; D57: nor is "Add to knowledge base".
    expect(source).not.toContain("<ClinicalTrialRecord")
    expect(source).not.toContain("useTrialRecord")
    expect(source).toContain("hideIngest")
    expect(source).not.toMatch(/<details className=\{paperStyles\.abstract\}/)
    expect(source).not.toContain("<PaperDigestView")
    expect(source).toContain("digestAction={<ClinicalDigestButton")
    expect(source).toContain("<ClinicalPaperNav")
    // The reader's notes on the paper come after the abstract, inside the reading column, and are in the jump list.
    const notes = source.indexOf('<NotesStrip variant="section" about={{ paper: slug }} />')
    expect(notes).toBeGreaterThan(abstract)
    expect(notes).toBeLessThan(source.indexOf("</article>"))
    expect(source).toMatch(/<ClinicalPaperNav[^>]* hasNotes \/>/)
  })
})

// Found 2026-10-07: the AI summary on the paper page had no tags although the list had them.
describe("the card summary looked up for the paper page", () => {
  it("keeps the tags", async () => {
    const { MemoryVaultStorage } = await import("../../vault/memory-storage")
    const { findCardDigest } = await import("../digest/lookup")
    const storage = new MemoryVaultStorage()
    const record = paper({ title: "T", ids: { pmid: "5" } })
    await storage.write(".scispark/clinical/cache.json", JSON.stringify({ digests: { "pmid:5": { scheme: 2, value: { headline: "H", takeaway: "S", quote: "Q", tags: ["Depression", "Esketamine"] } } } }))
    expect((await findCardDigest(storage, record))?.tags).toEqual(["Depression", "Esketamine"])
  })
})

describe("what the paper page knows about a paper from the list", () => {
  it("gives the kind of study and the topic the paper was listed under", async () => {
    const { MemoryVaultStorage } = await import("../../vault/memory-storage")
    const { findPaperCardInfo } = await import("../digest/lookup")
    const storage = new MemoryVaultStorage()
    const record = paper({ title: "T", ids: { pmid: "5" } })
    await storage.write(".scispark/clinical/feed.json", JSON.stringify({
      topics: [{ id: "w1", condition: "Depression", treatment: "Esketamine" }],
      items: [{ key: "pmid:5", design: "meta-analysis", designSource: "publication-type", entryId: "w1", digest: { headline: "H", takeaway: "S", quote: "Q" } }],
    }))
    expect(await findPaperCardInfo(storage, record)).toEqual({ digest: { headline: "H", takeaway: "S", quote: "Q" }, design: "meta-analysis", designSource: "publication-type", topic: "Depression × Esketamine" })
  })
  it("reads the kind of study from the record when the paper is not on the list", async () => {
    const { MemoryVaultStorage } = await import("../../vault/memory-storage")
    const { findPaperCardInfo } = await import("../digest/lookup")
    const record = paper({ title: "A trial", ids: { pmid: "6" }, publicationTypes: ["Randomized Controlled Trial"] })
    expect(await findPaperCardInfo(new MemoryVaultStorage(), record)).toEqual({ digest: null, design: "randomized-trial", designSource: "publication-type" })
  })
})
