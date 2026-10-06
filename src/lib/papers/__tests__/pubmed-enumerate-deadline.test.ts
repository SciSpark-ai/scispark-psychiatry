import { describe, expect, it } from "vitest"
import { enumeratePubmed } from "../pubmed"

const article = (pmid: string) =>
  `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article><ArticleTitle>Study ${pmid} of depression.</ArticleTitle>` +
  `<Abstract><AbstractText>Abstract ${pmid}.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>`

/** A PubMed stand-in whose every response takes `delayMs`, and whose efetch calls listed in `failOn` (1-based) fail. */
function slowPubmed(returned: number, opts: { delayMs?: number; failOn?: number[] } = {}) {
  const ids = Array.from({ length: returned }, (_, i) => String(1000 + i))
  let efetchCalls = 0
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (opts.delayMs) await new Promise((resolve) => setTimeout(resolve, opts.delayMs))
    if (url.includes("esearch")) {
      return { ok: true, status: 200, json: async () => ({ esearchresult: { idlist: ids, count: String(returned) } }) } as unknown as Response
    }
    efetchCalls += 1
    if (opts.failOn?.includes(efetchCalls)) return { ok: false, status: 429, text: async () => "" } as unknown as Response
    const asked = new URL(url).searchParams.get("id")!.split(",")
    return { ok: true, status: 200, text: async () => `<PubmedArticleSet>${asked.map(article).join("")}</PubmedArticleSet>` } as unknown as Response
  }) as unknown as typeof fetch
  return fetchFn
}

describe("enumeratePubmed deadlines and partial reads", () => {
  it("gives each request its own deadline, so a long enumeration is not cut off as a whole", async () => {
    // Four requests of 60 ms each take longer than one 150 ms deadline, but each is well inside it.
    const result = await enumeratePubmed({ query: "q", maxRecords: 500 }, { fetchFn: slowPubmed(300, { delayMs: 60 }), timeoutMs: 150 })
    expect(result.records).toHaveLength(300)
    expect(result.truncated).toBe(false)
  })

  it("keeps the batches already read when a later batch fails, and reports the rest as truncated", async () => {
    const result = await enumeratePubmed({ query: "q", maxRecords: 500 }, { fetchFn: slowPubmed(250, { failOn: [2] }) })
    expect(result.records).toHaveLength(100)
    expect(result.total).toBe(250)
    expect(result.truncated).toBe(true)
  })

  it("still fails when not even the first batch could be read", async () => {
    await expect(enumeratePubmed({ query: "q", maxRecords: 500 }, { fetchFn: slowPubmed(250, { failOn: [1] }) })).rejects.toThrow(/efetch/)
  })
})
