import { describe, expect, it } from "vitest"
import { loadPsychiatryPack } from "../pack/load"
import {
  deterministicPlan, domainClause, entryQuery, isPlausiblePubmedQuery, journalQueries, resolveFacet, windowClause,
  type DateWindow,
} from "../plan/queries"
import type { WatchEntry } from "../types"

const WINDOW: DateWindow = { from: new Date("2026-09-06T00:00:00Z"), to: new Date("2026-10-06T00:00:00Z") }
const entry = (overrides: Partial<WatchEntry>): WatchEntry => ({ id: "w1", priority: "normal", safetySignal: false, ...overrides })

describe("windowClause", () => {
  it("uses the entrez date with slashes", () => {
    expect(windowClause(WINDOW)).toBe('("2026/09/06"[edat] : "2026/10/06"[edat])')
  })
})

describe("resolveFacet", () => {
  it("rolls a condition up to its subtypes and keeps MeSH labels", async () => {
    const pack = await loadPsychiatryPack()
    const facet = resolveFacet(pack, "depression", "condition")
    expect(facet.mesh).toEqual(expect.arrayContaining(["Depressive Disorder, Major", "Depressive Disorder, Treatment-Resistant", "Depression, Postpartum"]))
    expect(facet.words).toEqual(expect.arrayContaining(["Treatment-resistant depression", "perinatal depression"]))
  })
  it("includes generic and brand names", async () => {
    const pack = await loadPsychiatryPack()
    expect(resolveFacet(pack, "esketamine", "treatment").words).toEqual(expect.arrayContaining(["Esketamine", "Spravato", "S-ketamine"]))
  })
  it("never uses ambiguous acronyms as text words", async () => {
    const pack = await loadPsychiatryPack()
    const words = resolveFacet(pack, "psychotherapy", "treatment").words.map((word) => word.toLowerCase())
    for (const bad of ["act", "ba", "pe", "ipt", "mst", "tbs"]) expect(words).not.toContain(bad)
    expect(words).toContain("cbt")
  })
  it("keeps an unknown label as a plain text word", async () => {
    const pack = await loadPsychiatryPack()
    expect(resolveFacet(pack, "tinnitus-related distress", "condition")).toEqual({ label: "tinnitus-related distress", mesh: [], words: ["tinnitus-related distress"] })
  })
})

describe("entryQuery", () => {
  it("ANDs the filled facets with the window and design hint", async () => {
    const pack = await loadPsychiatryPack()
    const planned = entryQuery(pack, entry({ condition: "treatment-resistant depression", treatment: "esketamine" }), WINDOW)!
    expect(planned.entryId).toBe("w1")
    expect(planned.query).toContain('"Depressive Disorder, Treatment-Resistant"[MeSH Terms]')
    expect(planned.query).toContain('"Spravato"[Title/Abstract]')
    expect(planned.query).toContain("[edat]")
    expect(planned.query).toContain('"Randomized Controlled Trial"[pt]')
    expect(isPlausiblePubmedQuery(planned.query)).toBe(true)
  })
  it("skips paused entries", async () => {
    const pack = await loadPsychiatryPack()
    expect(entryQuery(pack, entry({ condition: "ptsd", priority: "paused" }), WINDOW)).toBeNull()
  })
  it("serves a treatment-only entry", async () => {
    const pack = await loadPsychiatryPack()
    const planned = entryQuery(pack, entry({ treatment: "theta burst" }), WINDOW)!
    expect(planned.query).toContain('"Theta burst stimulation"[Title/Abstract]')
  })
})

describe("journalQueries", () => {
  it("batches journals and adds the domain clause for tier B only", async () => {
    const pack = await loadPsychiatryPack()
    const tierB = journalQueries(pack, "B", WINDOW)
    expect(tierB).toHaveLength(1)
    expect(tierB[0].query).toContain('"0028-4793"[Journal]')
    expect(tierB[0].query).toContain('"Mental Disorders"[MeSH Terms]')
    const many = { ...pack, journals: Array.from({ length: 31 }, (_, i) => ({ name: `J${i}`, issn: `1000-${String(i).padStart(3, "0")}0`, tier: "A" as const, state: "normal" as const })) }
    const tierA = journalQueries(many, "A", WINDOW)
    expect(tierA).toHaveLength(3)
    expect(tierA[0].query).not.toContain("Mental Disorders")
  })
  it("excludes muted journals", async () => {
    const pack = await loadPsychiatryPack()
    const muted = { ...pack, journals: pack.journals.map((journal) => ({ ...journal, state: "muted" as const })) }
    expect(journalQueries(muted, "B", WINDOW)).toEqual([])
  })
})

describe("domainClause", () => {
  it("expands a truncated phrase to singular and plural, and keeps single-word truncation", async () => {
    const pack = await loadPsychiatryPack()
    const clause = domainClause(pack)
    expect(clause).toContain('"mental disorder"[Title/Abstract]')
    expect(clause).toContain('"mental disorders"[Title/Abstract]')
    expect(clause).toContain("depress*[Title/Abstract]")
  })
})

describe("deterministicPlan", () => {
  it("puts entry queries before journal enumeration", async () => {
    const pack = await loadPsychiatryPack()
    const plan = deterministicPlan(pack, [entry({ condition: "ptsd" })], WINDOW)
    expect(plan[0].tier).toBe("entry")
    expect(plan.at(-1)?.tier).toBe("B")
  })
})

describe("isPlausiblePubmedQuery", () => {
  it.each([
    ["", false], ["(a OR b", false], ["a OR b)", false], ['"unbalanced', false], ['x[MeSH', false], ["(a AND b)", true], ["x".repeat(1600), false],
  ])("%s -> %s", (query, ok) => expect(isPlausiblePubmedQuery(query)).toBe(ok))
})
