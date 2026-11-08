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
import { gated, paper, scored, watch } from "./helpers"

const gatedOf = (title: string) => gated({ title, abstract: "Adults were studied in this trial.", ids: { pmid: title.length.toString() }, fields: [] }, "randomized-trial", `k${title.length}`)

// Findings of the independent review of 2026-10-07, each pinned here.

describe("cleaning an abstract does not change what it says", () => {
  it("keeps comparisons written with < and >", () => {
    const text = "Remission (HAM-D <7) occurred in 42% vs 21% (OR 2.6, p<0.001). Weight gain >7% was seen in 12% of the olanzapine group."
    expect(cleanAbstract(text)).toBe(text)
    expect(cleanAbstract("Scores fell (p &lt; 0.05) in adults with BMI &gt; 30.")).toBe("Scores fell (p < 0.05) in adults with BMI > 30.")
  })
  it("removes inline markup and preserves a space at a line break", () => {
    expect(cleanAbstract("We tested <i>CBT</i> and <sub>2</sub> doses.<br/>Scores fell in <jats:italic>both</jats:italic> groups and more text to pass.")).toBe("We tested CBT and 2 doses. Scores fell in both groups and more text to pass.")
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

// The four findings first left open, closed at the owner's request (2026-10-07).

describe("a number in a card summary keeps the company it has in the abstract", () => {
  const trial = paper({ title: "Sertraline versus placebo in depression", abstract: "Methods: Adults were randomised.\nResults: Response occurred in 42% with sertraline and 21% with placebo.", ids: { pmid: "3" } })
  it("rejects two numbers given to the wrong arms", () => {
    const swapped = { headline: "Sertraline versus placebo for depression", takeaway: "Response occurred in 21% with sertraline and 42% with placebo.", source: 2 }
    expect(checkDigest(swapped, trial)).toEqual({ reason: expect.stringMatching(/^number-context:(?:21|42)$/) })
  })
  it("accepts the numbers with their own arms, also when reworded", () => {
    expect("digest" in checkDigest({ headline: "Sertraline beat placebo for depression", takeaway: "Response occurred in 42% with sertraline and 21% with placebo.", source: 2 }, trial)).toBe(true)
    expect("digest" in checkDigest({ headline: "Sertraline beat placebo for depression", takeaway: "Response was more frequent with sertraline (42%) than with placebo (21%) in adults.", source: 2 }, trial)).toBe(true)
  })
  it("does not apply to a summary with one number", () => {
    expect("digest" in checkDigest({ headline: "Sertraline beat placebo for depression", takeaway: "Response to sertraline in randomised adults reached 42%.", source: 2 }, trial)).toBe(true)
  })
})

describe("the treatment an overview names", () => {
  const papers = [{ key: "k1", headline: "Esketamine beat quetiapine", takeaway: "Remission was more frequent with esketamine than with quetiapine.", abstract: "Patients had earlier received sertraline or venlafaxine.", part: "focus" as const }]
  it("must be named in the paper's summary, not only somewhere in its abstract", () => {
    const { kept, problems } = judgeOverview([{ text: "gave more remission than quetiapine", sources: [1], kind: "benefit", treatment: "sertraline" }], papers)
    expect(kept[0].treatment).toBeUndefined()
    expect(problems).toEqual(["treatment-not-in-source:sertraline"])
  })
  it("is not the comparator of the paper's own headline", () => {
    const { kept, problems } = judgeOverview([{ text: "gave less remission than esketamine", sources: [1], kind: "benefit", treatment: "quetiapine" }], papers)
    expect(kept[0].treatment).toBeUndefined()
    expect(problems).toEqual(["treatment-is-comparator:quetiapine"])
    expect(judgeOverview([{ text: "gave more remission than quetiapine", sources: [1], kind: "benefit", treatment: "Esketamine" }], papers).kept[0].treatment).toBe("Esketamine")
  })
})

describe("another form of a word, when a match is confirmed", () => {
  const entry = (condition: string, treatment?: string) => watch({ id: "w1", condition, ...(treatment ? { treatment } : {}) })
  const check = async (title: string, condition: string, treatment?: string) => {
    const { loadPsychiatryPack } = await import("../pack/load")
    const { verifyMatchedParts } = await import("../grade/verify-parts")
    const candidate = gatedOf(title)
    return verifyMatchedParts({ key: candidate.key, entryId: "w1", grade: 4, topicGrade: 4, quote: "q", quoteVerified: true, ungraded: false, matched: treatment ? "treatment" : "condition" } as never, candidate, [entry(condition, treatment)], await loadPsychiatryPack()).matched
  }
  it("does not take psychotherapy for psychosis, methylation for methylphenidate, or schizoaffective for schizophrenia", async () => {
    expect(await check("Psychotherapy and psychological support after stroke", "Psychosis")).toBeUndefined()
    expect(await check("DNA methylation in ageing adults", "ADHD", "Methylphenidate")).toBeUndefined()
    expect(await check("Lithium in schizoaffective presentations", "Schizophrenia")).toBeUndefined()
  })
  it("still takes depressive for depression and schizophrenic for schizophrenia", async () => {
    // A topic with a condition and no treatment is matched in full by a paper on the condition.
    expect(await check("Exercise for depressive symptoms in adults", "Depression")).toBe("full")
    expect(await check("Cognition in schizophrenic patients", "Schizophrenia")).toBe("full")
  })
})

describe("files that only grow", () => {
  it("keeps the newest 200 searches and lets the oldest go", async () => {
    const { saveHistory, listHistory, HISTORY_KEEP } = await import("../history/store")
    const storage = new MemoryVaultStorage()
    const feed = (n: number) => ({ version: 1 as const, generatedAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), mode: "whats-new" as const, strictness: "standard" as const, items: [], lowerConfidence: [], safetySignals: [], stats: { retrieved: n, domain: 0, gated: 0, graded: 0, listed: 0 }, costUsd: null, warnings: [] })
    expect(HISTORY_KEEP).toBe(200)
    for (let n = 0; n < HISTORY_KEEP + 3; n += 1) await saveHistory(storage, feed(n))
    const kept = await listHistory(storage)
    expect(kept).toHaveLength(HISTORY_KEEP)
    expect(kept.at(-1)?.found).toBe(3)
  })
  it("forgets papers seen more than 400 days ago, and custom date ranges not used for 90 days", async () => {
    const { recordSeen, loadSeenTimes } = await import("../seen/store")
    const storage = new MemoryVaultStorage()
    await recordSeen(storage, ["old"], new Date("2025-01-01T00:00:00.000Z"), "30d")
    await recordSeen(storage, ["ranged"], new Date("2026-05-01T00:00:00.000Z"), "2026-04-01..2026-04-15")
    await recordSeen(storage, ["new"], new Date("2026-10-07T00:00:00.000Z"), "30d")
    expect([...(await loadSeenTimes(storage, "30d")).keys()]).toEqual(["new"])
    expect((await loadSeenTimes(storage, "2026-04-01..2026-04-15")).size).toBe(0)
    expect([...(await loadSeenTimes(storage)).keys()]).toEqual(["new"])
  })
  it("keeps a copy of entries it cannot read before a list is written again", async () => {
    const { toggleReadLater, READ_LATER_PATH } = await import("../readlater/store")
    const { saveWatchEntries, loadWatchEntries } = await import("../watch/store")
    const storage = new MemoryVaultStorage()
    await storage.write(READ_LATER_PATH, JSON.stringify({ version: 1, items: [{ from: "a newer version", key: "pmid:9" }] }))
    await storage.write(".scispark/clinical/watch.json", JSON.stringify({ version: 1, entries: [{ id: "old", shape: "unknown" }, watch({ id: "w1", condition: "Depression" })] }))
    expect(await loadWatchEntries(storage)).toHaveLength(1)
    await saveWatchEntries(storage, [watch({ id: "w1", condition: "Depression" })])
    expect(JSON.parse((await storage.read(".scispark/clinical/watch.unreadable.json")) as string).entries).toEqual([{ id: "old", shape: "unknown" }])
    const item = { paper: paper({ title: "T", ids: { pmid: "1" } }), key: "pmid:1", design: "randomized-trial", designSource: "publication-type", entryId: null, grade: 0, topicGrade: 0, quote: "", quoteVerified: false, ungraded: false, score: 1, flags: [] }
    await toggleReadLater(storage, item as never)
    expect(JSON.parse((await storage.read(".scispark/clinical/read-later.unreadable.json")) as string).items).toEqual([{ from: "a newer version", key: "pmid:9" }])
  })
})
