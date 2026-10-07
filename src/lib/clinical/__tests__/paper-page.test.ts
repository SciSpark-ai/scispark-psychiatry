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
    expect(abstractSections("Results: mixed. We found three things: a, b and c.")).toEqual([{ text: "Results: mixed. We found three things: a, b and c." }])
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
    await storage.write(CACHE_PATH, JSON.stringify({ version: 1, entriesKey: "x", grades: {}, digests: { "pmid:77": { hash: textHash(record), at: "2026-10-07T00:00:00.000Z", value: digest } } }))
    expect(await findCardDigest(storage, record)).toEqual(digest)
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
