import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import * as route from "../../../app/api/clinical/evidence/route"
import { FINDINGS_PATH } from "../../clinical/evidence/file"
import { saveWatchEntries } from "../../clinical/watch/store"
import { paper, watch } from "../../clinical/__tests__/helpers"

const finding = (n: number, conditionCodes: string[]) => ({
  key: `pmid:${n}`, slug: `paper-${n}`, paper: paper({ title: `Paper ${n}`, ids: { pmid: String(n) }, date: "2026-09-20" }),
  headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, design: "randomized-trial", designSource: "publication-type", journalBand: null,
  conditionCodes, kind: "benefit", treatment: "esketamine", treatmentCode: "esketamine", treatmentClass: null, researchType: null, sampleSize: null, text: "reduced symptoms", population: null, comparator: null, outcome: null,
  firstListedAt: new Date().toISOString(), lastListedAt: new Date().toISOString(),
})
const get = (query = "") => route.GET(new Request(`http://x/api/clinical/evidence${query}`))

let storage: MemoryVaultStorage
beforeEach(async () => {
  storage = new MemoryVaultStorage()
  setServerVaultForTests(storage)
  await storage.write(FINDINGS_PATH, JSON.stringify({ version: 2, findings: { "pmid:1": finding(1, ["treatment-resistant-depression"]), "pmid:2": finding(2, ["schizophrenia"]) } }))
})
afterEach(() => setServerVaultForTests(null))

describe("/api/clinical/evidence", () => {
  it("gives the evidence of a condition, its subtypes included, and marks saved papers", async () => {
    await storage.write("wiki/papers/paper-1.md", "---\ntype: paper\ntitle: Paper 1\ncreated: 2026-10-07\nupdated: 2026-10-07\ntags: []\nrelated: []\nsources: []\n---\n")
    const { result } = await (await get("?condition=depression")).json()
    expect(result.condition.code).toBe("depression")
    expect(result.total).toBe(1)
    expect(result.period).toBe("all")
    expect(result.classes.map((entry: { key: string; papers: number }) => [entry.key, entry.papers])).toEqual([["antidepressant", 1]])
    expect(result.classes[0].treatments[0].studies[0]).toMatchObject({ key: "pmid:1", saved: true })
  })
  it("passes the period through, and answers 400 for one it does not know", async () => {
    const { result } = await (await get("?condition=depression&period=3m")).json()
    expect(result.period).toBe("3m")
    expect(result.total).toBe(1)
    expect((await get("?condition=depression&period=2y")).status).toBe(400)
    expect((await get("?period=2y")).status).toBe(400)
  })
  it("passes the scope through, all when none is given, and answers 400 for one it does not know", async () => {
    await storage.write("wiki/papers/paper-2.md", "---\ntype: paper\ntitle: Paper 2\ncreated: 2026-10-07\nupdated: 2026-10-07\ntags: []\nrelated: []\nsources: []\n---\n")
    const all = (await (await get("?condition=depression")).json()).result
    expect([all.scope, all.total, all.collected, all.savedCount]).toEqual(["all", 1, 1, 0])
    expect(all.sections).toEqual({ treatments: 1, safety: 0, research: 0 })
    const saved = (await (await get("?condition=depression&scope=saved")).json()).result
    expect([saved.scope, saved.total, saved.collected, saved.savedCount, saved.classes]).toEqual(["saved", 0, 1, 0, []])
    const mine = (await (await get("?condition=schizophrenia&scope=saved&period=3m")).json()).result
    expect([mine.scope, mine.period, mine.total, mine.savedCount]).toEqual(["saved", "3m", 1, 1])
    expect((await get("?condition=depression&scope=mine")).status).toBe(400)
    expect((await get("?scope=mine")).status).toBe(400)
  })
  it("answers 404 for a condition the pack lacks and 400 for a malformed id", async () => {
    expect((await get("?condition=no-such-condition")).status).toBe(404)
    expect((await get("?condition=../etc")).status).toBe(400)
  })
  it("lists the conditions the reader follows, with the page of each when there is one", async () => {
    await saveWatchEntries(storage, [watch({ id: "w1", condition: "ADHD" })])
    await storage.write("wiki/conditions/schizophrenia.md", "---\ntype: condition\ntitle: Schizophrenia\ncreated: 2026-10-07\nupdated: 2026-10-07\ntags: []\nrelated: []\nsources: []\n---\n")
    const { result } = await (await get()).json()
    const byCode = Object.fromEntries(result.conditions.map((entry: { code: string }) => [entry.code, entry]))
    expect(byCode.schizophrenia).toMatchObject({ total: 1, pageId: "wiki/conditions/schizophrenia" })
    expect(byCode["treatment-resistant-depression"]).toMatchObject({ total: 1, pageId: null })
    expect(byCode.adhd).toMatchObject({ total: 0 })
    expect(byCode.schizophrenia.treatments).toEqual([{ key: "antidepressant", label: "Antidepressants" }])
  })
})
