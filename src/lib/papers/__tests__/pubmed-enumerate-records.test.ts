import { describe, expect, it } from "vitest"
import { enumeratePubmed } from "../pubmed"
import type { PaperRecord } from "../types"

const article = (pmid: string) =>
  `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article><ArticleTitle>Study ${pmid} of depression.</ArticleTitle>` +
  `<Abstract><AbstractText>Abstract ${pmid}.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>`

function fakePubmed(ids: string[], opts: { failEfetch?: boolean } = {}) {
  const asked: string[][] = []
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("esearch")) return { ok: true, status: 200, json: async () => ({ esearchresult: { idlist: ids, count: String(ids.length) } }) } as unknown as Response
    if (opts.failEfetch) return { ok: false, status: 500, text: async () => "" } as unknown as Response
    const batch = new URL(url).searchParams.get("id")!.split(",")
    asked.push(batch)
    return { ok: true, status: 200, text: async () => `<PubmedArticleSet>${batch.map(article).join("")}</PubmedArticleSet>` } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchFn, asked }
}
const memory = (seed: PaperRecord[] = []) => {
  const map = new Map(seed.map((record) => [record.ids.pmid as string, record]))
  return { map, get: (pmid: string) => map.get(pmid), put: (record: PaperRecord) => { if (record.ids.pmid) map.set(record.ids.pmid, record) } }
}
const stored = (pmid: string): PaperRecord => ({ ids: { pmid }, title: `Stored ${pmid}`, authors: [], fields: [], source: "pubmed" })

// The clinical feed keeps the records it has read. PubMed is still asked which papers match (ids only);
// the records themselves are fetched only for papers not already held.
describe("enumeratePubmed with a record store", () => {
  it("fetches only the papers it does not hold, and returns all of them in PubMed's order", async () => {
    const ids = ["1", "2", "3", "4", "5"]
    const { fetchFn, asked } = fakePubmed(ids)
    const records = memory([stored("2"), stored("4")])
    const result = await enumeratePubmed({ query: "q", maxRecords: 100 }, { fetchFn, records })
    expect(asked).toEqual([["1", "3", "5"]])
    expect(result.records.map((record) => record.ids.pmid)).toEqual(ids)
    expect(result.records[1].title).toBe("Stored 2")
    expect(result.truncated).toBe(false)
    expect([...records.map.keys()].sort()).toEqual(ids)
  })

  it("asks PubMed for no records at all when it holds every match", async () => {
    const { fetchFn, asked } = fakePubmed(["2", "4"])
    const result = await enumeratePubmed({ query: "q", maxRecords: 100 }, { fetchFn, records: memory([stored("2"), stored("4")]) })
    expect(asked).toEqual([])
    expect(result.records).toHaveLength(2)
  })

  it("returns what it holds, marked as cut short, when the missing records cannot be fetched", async () => {
    const { fetchFn } = fakePubmed(["1", "2"], { failEfetch: true })
    const result = await enumeratePubmed({ query: "q", maxRecords: 100 }, { fetchFn, records: memory([stored("2")]) })
    expect(result.records.map((record) => record.ids.pmid)).toEqual(["2"])
    expect(result.truncated).toBe(true)
  })
})
