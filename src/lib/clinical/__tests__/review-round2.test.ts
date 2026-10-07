import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { cleanAbstract } from "../text/clean"
import { abstractSections } from "../text/abstract-sections"
import { checkDigest } from "../digest/card"
import { judgeOverview, tidyOverviewSentence } from "../digest/topic"
import { classifyDesign } from "../filter/gate"
import { selectFeed } from "../select/select"
import { loadRecordStore } from "../retrieve/record-store"
import { cachedDigest, DIGEST_SCHEME, type FeedCache, textHash } from "../feed/cache"
import { emptyListIsFailure } from "../feed/run"
import { paper, scored, watch } from "./helpers"

// Findings of the independent review of 2026-10-07, each pinned here.

describe("cleaning an abstract does not change what it says", () => {
  it("keeps comparisons written with < and >", () => {
    const text = "Remission (HAM-D <7) occurred in 42% vs 21% (OR 2.6, p<0.001). Weight gain >7% was seen in 12% of the olanzapine group."
    expect(cleanAbstract(text)).toBe(text)
    expect(cleanAbstract("Scores fell (p &lt; 0.05) in adults with BMI &gt; 30.")).toBe("Scores fell (p < 0.05) in adults with BMI > 30.")
  })
  it("still takes real markup out", () => {
    expect(cleanAbstract("We tested <i>CBT</i> and <sub>2</sub> doses.<br/>Scores fell in <jats:italic>both</jats:italic> groups and more text to pass.")).toBe("We tested CBT and 2 doses.Scores fell in both groups and more text to pass.")
  })
  it("leaves ordinary sentences that begin with a section word alone", () => {
    const text = "Adults were treated for 8 weeks. Participants were randomized to two groups. Results showed no difference between them. Findings suggest a class effect."
    expect(cleanAbstract(text)).toBe(text)
    expect(abstractSections(cleanAbstract(text))).toHaveLength(1)
  })
  it("does not break a sentence at a section word in lower case", () => {
    const text = "We compared two interventions: CBT and sertraline. The primary outcome: change in HAM-D at week 8."
    expect(cleanAbstract(text)).toBe(text)
  })
  it("still gives a label without a colon its colon, and a label after a sentence its own line", () => {
    expect(cleanAbstract("Background Depression is common. Methods: We randomised 200 adults.")).toBe("Background: Depression is common.\nMethods: We randomised 200 adults.")
  })
  it("takes off a leading 'Abstract' label only when it is one", () => {
    expect(cleanAbstract("Abstracting data from 12 trials, we found a small effect on depressive symptoms in adults.")).toMatch(/^Abstracting data/)
    expect(cleanAbstract("Abstract: We found a small effect on depressive symptoms in adults across twelve trials.")).toMatch(/^We found/)
  })
})

describe("a card summary belongs to its paper", () => {
  const lithium = paper({ title: "Lithium and suicide in bipolar disorder: a cohort study", abstract: "Methods: Cohort of 5000 patients with bipolar disorder.\nResults: Lithium was associated with fewer suicides than valproate.", ids: { pmid: "9" } })
  it("rejects a headline and takeaway about something the abstract does not mention", () => {
    const other = { headline: "Ketamine beat placebo for treatment-resistant depression", takeaway: "Ketamine infusions produced faster remission than placebo in adults with treatment-resistant depression.", source: 1 }
    expect(checkDigest(other, lithium)).toEqual({ reason: "not-about-this-paper" })
  })
  it("accepts a summary in the paper's own terms", () => {
    const own = { headline: "Lithium linked to fewer suicides than valproate", takeaway: "In a cohort of 5000 patients with bipolar disorder, lithium was associated with fewer suicides than valproate.", source: 2 }
    expect("digest" in checkDigest(own, lithium)).toBe(true)
  })
})

describe("the kind of a finding in the overview", () => {
  const papers = [
    { key: "k1", headline: "Omega-3 added nothing", takeaway: "Adding omega-3 did not reduce symptoms compared with placebo.", part: "focus" as const },
    { key: "k2", headline: "Vortioxetine matched sertraline", takeaway: "Vortioxetine was not inferior to sertraline and reduced symptoms.", part: "focus" as const },
  ]
  it("does not file a finding that says something did not work under benefit", () => {
    const { kept, problems } = judgeOverview([{ text: "did not reduce symptoms compared with placebo", sources: [1], kind: "benefit", treatment: "omega-3" }], papers)
    expect(kept[0].kind).toBe("other")
    expect(problems).toEqual(["kind-contradicted:benefit"])
  })
  it("does not take 'not inferior' for a finding of no benefit", () => {
    const { kept } = judgeOverview([{ text: "was not inferior to sertraline and reduced symptoms", sources: [2], kind: "no-benefit", treatment: "vortioxetine" }], papers)
    expect(kept[0].kind).toBe("other")
  })
  it("keeps one finding per paper", () => {
    const { kept } = judgeOverview([
      { text: "did not reduce symptoms compared with placebo", sources: [1], kind: "no-benefit", treatment: "omega-3" },
      { text: "reduced symptoms", sources: [1], kind: "benefit", treatment: "omega-3" },
    ], papers)
    expect(kept.map((entry) => entry.kind)).toEqual(["no-benefit"])
  })
  it("leaves an age range and a unit in the text", () => {
    expect(tidyOverviewSentence("reduced symptoms in adolescents (12-17) over 8 weeks")).toBe("reduced symptoms in adolescents (12-17) over 8 weeks.")
    expect(tidyOverviewSentence("lowered body mass index by 1.2 kg/m²")).toBe("lowered body mass index by 1.2 kg/m².")
  })
})

describe("the design gate reads 'protocol' in a title with care", () => {
  const design = (title: string) => classifyDesign(paper({ title, abstract: "Adults were randomised and symptoms were measured at week 6.", publicationTypes: ["Journal Article"] })).design
  it("does not take a trial of a treatment protocol for a study protocol", () => {
    expect(design("Accelerated intermittent theta burst stimulation protocol for treatment-resistant depression: a randomized controlled trial")).not.toBe("protocol")
    expect(design("Unified Protocol versus sertraline for anxiety disorders: a randomised trial")).not.toBe("protocol")
  })
  it("still knows a study protocol", () => {
    expect(design("Esketamine for adolescent depression: study protocol for a randomised controlled trial")).toBe("protocol")
    expect(design("Protocol for a systematic review of rTMS in schizophrenia")).toBe("protocol")
  })
})

describe("selecting the list", () => {
  const entry = watch({ id: "w1", condition: "Depression", treatment: "Esketamine" })
  const other = watch({ id: "w2", condition: "Schizophrenia" })
  const item = (key: string, title: string, score: number, over: { entryId?: string; band?: 1 | 2 | 3; grade?: number } = {}) => {
    const base = scored(key, title, over.entryId ?? "w1", over.grade ?? 4, score)
    return { ...base, grade: { ...base.grade, matched: "full" as const }, ...(over.band ? { journalBand: over.band } : {}) }
  }
  it("keeps two papers whose titles differ in one telling word", () => {
    const result = selectFeed([
      item("a", "Efficacy and safety of esketamine nasal spray in adults with treatment-resistant depression: a randomized controlled trial", 90),
      item("b", "Efficacy and safety of esketamine nasal spray in adolescents with treatment-resistant depression: a randomized controlled trial", 80),
    ], [entry])
    expect(result.items.map((kept) => kept.candidate.key)).toEqual(["a", "b"])
  })
  it("still drops the same title listed twice", () => {
    const result = selectFeed([item("a", "Esketamine nasal spray in depression.", 90), item("b", "Esketamine Nasal Spray in Depression", 80)], [entry])
    expect(result.items.map((kept) => kept.candidate.key)).toEqual(["a"])
  })
  it("orders one topic's papers by journal band, then score, even when another topic shares the list", () => {
    const mine = [...Array.from({ length: 8 }, (_, n) => item(`lead${n}`, `Leading journal paper number ${n} on esketamine`, 60 - n, { band: 1 })), item("plain", "Another journal paper on esketamine dosing", 95, { band: 3, grade: 3 })]
    const theirs = Array.from({ length: 8 }, (_, n) => item(`scz${n}`, `Clozapine paper number ${n} in schizophrenia`, 70 - n, { entryId: "w2", band: 2 }))
    const result = selectFeed([...mine, ...theirs], [entry, other])
    const tab = result.items.filter((kept) => kept.grade.entryId === "w1").map((kept) => kept.candidate.key)
    expect(tab).toEqual([...Array.from({ length: 8 }, (_, n) => `lead${n}`), "plain"])
  })
})

describe("an empty list", () => {
  it("is a failure only when nothing matched at all, not when every match has been shown before", () => {
    expect(emptyListIsFailure({ listed: 0, matchesAlreadySeen: 5, previousListed: 12 })).toBe(false)
    expect(emptyListIsFailure({ listed: 0, matchesAlreadySeen: 0, previousListed: 12 })).toBe(true)
    expect(emptyListIsFailure({ listed: 0, matchesAlreadySeen: 0, previousListed: 0 })).toBe(false)
    expect(emptyListIsFailure({ listed: 3, matchesAlreadySeen: 0, previousListed: 12 })).toBe(false)
  })
})

describe("records kept on disk", () => {
  it("asks PubMed again for an indexed record after a month, so that a retraction or a correction is seen", async () => {
    const storage = new MemoryVaultStorage()
    const now = new Date("2026-10-07T12:00:00.000Z")
    const record = paper({ title: "An indexed trial", ids: { pmid: "1" }, fields: ["Depression"], publicationTypes: ["Randomized Controlled Trial"] })
    const then = await loadRecordStore(storage, new Date(now.getTime() - 40 * 86_400_000))
    then.put(record)
    await then.save()
    expect((await loadRecordStore(storage, now)).get("1")).toBeUndefined()
    expect((await loadRecordStore(storage, new Date(now.getTime() - 20 * 86_400_000))).get("1")?.title).toBe("An indexed trial")
  })
})

describe("card summaries kept between runs", () => {
  it("does not reuse a summary accepted under earlier checks", () => {
    const record = paper({ title: "T", abstract: "A", ids: { pmid: "1" } })
    const value = { headline: "H", takeaway: "S", quote: "Q", tags: [] }
    const cache = (scheme?: number): FeedCache => ({ version: 1, entriesKey: "k", grades: {}, digests: { "pmid:1": { hash: textHash(record), at: "2026-10-07T00:00:00.000Z", value, ...(scheme ? { scheme } : {}) } }, overviews: {} })
    expect(cachedDigest(cache(DIGEST_SCHEME), "pmid:1", record)).toEqual(value)
    expect(cachedDigest(cache(), "pmid:1", record)).toBeUndefined()
  })
})
