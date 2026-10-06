import { describe, expect, it, vi } from "vitest"
import { enumeratePubmed } from "../pubmed"

const article = (pmid: string) =>
  `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article><ArticleTitle>Study ${pmid} of depression.</ArticleTitle>` +
  `<Abstract><AbstractText>Abstract ${pmid}.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>`

function fakePubmed(total: number, returned: number) {
  const ids = Array.from({ length: returned }, (_, i) => String(1000 + i))
  const urls: string[] = []
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    if (url.includes("esearch")) {
      return { ok: true, status: 200, json: async () => ({ esearchresult: { idlist: ids, count: String(total) } }) } as unknown as Response
    }
    const asked = new URL(url).searchParams.get("id")!.split(",")
    const xml = `<PubmedArticleSet>${asked.map(article).join("")}</PubmedArticleSet>`
    return { ok: true, status: 200, text: async () => xml } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchFn, urls }
}

describe("enumeratePubmed", () => {
  it("fetches every returned pmid in batches of 100", async () => {
    const { fetchFn, urls } = fakePubmed(250, 250)
    const result = await enumeratePubmed({ query: "q", maxRecords: 500 }, { fetchFn })
    expect(result.records).toHaveLength(250)
    expect(result.total).toBe(250)
    expect(result.truncated).toBe(false)
    expect(urls.filter((url) => url.includes("efetch"))).toHaveLength(3)
  })

  it("reports truncation when PubMed has more matches than were returned", async () => {
    const { fetchFn } = fakePubmed(1200, 100)
    const result = await enumeratePubmed({ query: "q", maxRecords: 100 }, { fetchFn })
    expect(result.records).toHaveLength(100)
    expect(result.total).toBe(1200)
    expect(result.truncated).toBe(true)
  })

  it("never asks esearch for more than 10,000 records", async () => {
    const { fetchFn, urls } = fakePubmed(0, 0)
    await enumeratePubmed({ query: "q", maxRecords: 50_000 }, { fetchFn })
    expect(new URL(urls[0]).searchParams.get("retmax")).toBe("10000")
  })

  it("skips efetch when nothing matches", async () => {
    const { fetchFn } = fakePubmed(0, 0)
    const result = await enumeratePubmed({ query: "q", maxRecords: 10 }, { fetchFn })
    expect(result).toEqual({ records: [], total: 0, truncated: false })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
