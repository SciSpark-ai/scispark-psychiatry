import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { loadPsychiatryPack } from "../pack/load"
import { classifyDesign, designGate } from "../filter/gate"
import { runClinicalFeed, type ClinicalFeedDeps } from "../feed/run"
import { loadLatestRunLog } from "../feed/run-log"
import { loadSeen, recordSeen } from "../seen/store"
import { selectFeed } from "../select/select"
import { saveWatchEntries } from "../watch/store"
import { candidate, llmResult, paper, scored, SETTINGS, strongOk, watch } from "./helpers"

// Owner decisions of 2026-10-06 after the fifth and sixth runs:
// papers already displayed are not recommended again; study design excludes rather than admits;
// design comes from PubMed, then the model, then tighter text rules; loosely related papers are not listed.

const design = (p: Parameters<typeof paper>[0]) => classifyDesign(paper(p))

describe("text rules for design are tighter", () => {
  it("does not call a paper a randomized trial because its abstract mentions that such trials are needed", () => {
    expect(design({ title: "Plant-derived compounds in schizophrenia: mechanisms and drug targets", abstract: "CONCLUSION: Further adequately powered randomized trials are required.", publicationTypes: ["Journal Article"] }).design).not.toBe("randomized-trial")
    expect(design({ title: "A single-group, 4-week pilot study of online psychoeducation", abstract: "RESULTS: Burden fell. Confirmation requires a randomized controlled trial.", publicationTypes: ["Journal Article"] }).design).toBe("clinical-trial")
  })
  it("still recognises a trial from its title or from how the abstract describes allocation", () => {
    expect(design({ title: "Esketamine versus quetiapine: a randomised trial", publicationTypes: ["Journal Article"] })).toEqual({ design: "randomized-trial", source: "text-rule" })
    expect(design({ title: "Drug A in depression", abstract: "METHODS: Adults were randomly assigned to drug A or placebo.", publicationTypes: ["Journal Article"] }).design).toBe("randomized-trial")
    expect(design({ title: "A double-blind, placebo-controlled trial of drug B in ADHD", publicationTypes: ["Journal Article"] }).design).toBe("randomized-trial")
  })
  it("does not call a paper a meta-analysis because its abstract cites one", () => {
    expect(design({ title: "A cohort of 4,000 adolescents", abstract: "Previous meta-analyses suggested a link. We followed a prospective cohort.", publicationTypes: ["Journal Article"] }).design).toBe("cohort")
    expect(design({ title: "Drug C for anxiety", abstract: "We conducted a systematic review and meta-analysis of 12 trials.", publicationTypes: ["Journal Article"] }).design).toBe("meta-analysis")
  })
  it("recognises study protocols, animal or laboratory studies and narrative reviews", () => {
    expect(design({ title: "CBT for insomnia in psychosis: study protocol for a randomised controlled trial", publicationTypes: ["Journal Article"] }).design).toBe("protocol")
    expect(design({ title: "Trial of drug D", publicationTypes: ["Clinical Trial Protocol"] })).toEqual({ design: "protocol", source: "publication-type" })
    expect(design({ title: "Ketamine reverses stress-induced deficits in mice", abstract: "Mice were exposed to chronic stress.", publicationTypes: ["Journal Article"] }).design).toBe("preclinical")
    expect(design({ title: "Lithium and the kidney", fields: ["Animals", "Rats", "Lithium"], publicationTypes: ["Journal Article"] }).design).toBe("preclinical")
    expect(design({ title: "Lithium and the kidney", fields: ["Animals", "Humans", "Lithium"], publicationTypes: ["Journal Article"] }).design).not.toBe("preclinical")
    expect(design({ title: "Negative symptoms in schizophrenia: a narrative review", publicationTypes: ["Journal Article"] }).design).toBe("review")
    expect(design({ title: "Machine learning in schizophrenia: a scoping review", publicationTypes: ["Journal Article"] }).design).toBe("systematic-review")
  })
})

describe("the standard filter excludes what is unwanted and lets everything else through", () => {
  const c = (title: string, key: string, extra: Partial<Parameters<typeof candidate>[0]> = {}) => candidate({ title, publicationTypes: ["Journal Article"], ...extra }, key)
  const pool = [
    c("A cross-sectional survey of sleep in depression", "k:other", { abstract: "We surveyed 300 outpatients." }),
    c("Brand-new record", "k:unknown", { publicationTypes: [] }),
    c("Negative symptoms in schizophrenia: a narrative review", "k:review"),
    c("CBT for psychosis: study protocol for a randomised controlled trial", "k:protocol"),
    c("Ketamine reverses stress-induced deficits in mice", "k:mice"),
    c("Drug A versus placebo: a randomised trial", "k:rct"),
  ]
  it("standard keeps designs it cannot name, and drops reviews, protocols and animal studies with a reason", async () => {
    const result = designGate(await loadPsychiatryPack(), [], pool, "standard")
    expect(result.gated.map((g) => g.key)).toEqual(["k:other", "k:unknown", "k:rct"])
    expect(result.drops.map((d) => [d.key, d.reason])).toEqual([["k:review", "design:review"], ["k:protocol", "design:protocol"], ["k:mice", "design:preclinical"]])
  })
  it("strict is still a short list of designs, and open lets everything through", async () => {
    const pack = await loadPsychiatryPack()
    expect(designGate(pack, [], pool, "strict").gated.map((g) => g.key)).toEqual(["k:rct"])
    expect(designGate(pack, [], pool, "open").gated).toHaveLength(6)
  })
})

describe("loosely related papers are not listed", () => {
  it("leaves a paper graded 1 out of both the list and the lower-confidence section, and logs it", () => {
    const entries = [watch({ id: "a", condition: "depression" })]
    const result = selectFeed([scored("k4", "Direct paper about esketamine alpha", "a", 4, 90), scored("k1", "Loose paper about sleep beta", "a", 1, 40), scored("k0", "Unmatched paper about gamma delta", null, 0, 30)], entries)
    expect(result.items.map((i) => i.candidate.key)).toEqual(["k4"])
    expect(result.lowerConfidence.map((i) => i.candidate.key)).toEqual(["k0"])
    expect(result.drops).toContainEqual({ key: "k1", title: "Loose paper about sleep beta", step: "select", reason: "loosely-related" })
  })
})

const NOW = () => new Date("2026-10-06T10:00:00.000Z")
const RCT = paper({
  title: "Esketamine nasal spray versus quetiapine in treatment-resistant depression", ids: { pmid: "111" },
  abstract: "METHODS: Adults with treatment-resistant depression were randomised to esketamine nasal spray or quetiapine.",
  publicationTypes: ["Journal Article", "Randomized Controlled Trial"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-28",
})
const NEW_RECORD = paper({
  title: "Intravenous ketamine in treatment-resistant depression: outcomes at one year", ids: { pmid: "112" },
  abstract: "RESULTS: Adults with treatment-resistant depression who received ketamine were followed for one year.",
  publicationTypes: ["Journal Article"], fields: ["Depressive Disorder, Treatment-Resistant"], date: "2026-09-27",
})
const ENTRY = watch({ id: "w1", condition: "treatment-resistant depression", treatment: "esketamine", priority: "high" })
const assess = (...list: unknown[]) => llmResult({ assessments: list }, "claude-haiku-4-5")
const A0 = { index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "randomised to esketamine nasal spray or quetiapine" }
const A1 = { index: 1, entryId: "w1", grade: 3, topicGrade: 4, quote: "received ketamine were followed for one year" }

async function setup() {
  const storage = new MemoryVaultStorage()
  await saveWatchEntries(storage, [ENTRY])
  const pack = await loadPsychiatryPack()
  const run = (fast: MockProvider, records = [RCT, NEW_RECORD], extra: Partial<ClinicalFeedDeps> = {}) =>
    runClinicalFeed(storage, { pack, enumerate: async () => ({ records, total: records.length, truncated: false }), settings: SETTINGS, now: NOW, providerOverride: { strong: strongOk(), fast }, ...extra })
  return { storage, run }
}

describe("the model names the design when PubMed has not", () => {
  it("uses the model's design for a record without a PubMed type, and never overrides a PubMed type", async () => {
    const { run } = await setup()
    const feed = await run(new MockProvider([assess({ ...A0, design: "cohort" }, { ...A1, design: "cohort" })]))
    const byPmid = Object.fromEntries(feed.items.map((item) => [item.paper.ids.pmid, item]))
    expect(byPmid["111"]).toMatchObject({ design: "randomized-trial", designSource: "publication-type" })
    expect(byPmid["112"]).toMatchObject({ design: "cohort", designSource: "model" })
  })
  it("drops a paper the model identifies as an excluded design, with a reason", async () => {
    const { storage, run } = await setup()
    const feed = await run(new MockProvider([assess(A0, { ...A1, design: "review" })]))
    expect(feed.items.map((item) => item.paper.ids.pmid)).toEqual(["111"])
    expect((await loadLatestRunLog(storage))!.drops).toContainEqual({ key: "pmid:112", title: NEW_RECORD.title, step: "gate", reason: "design:review:model" })
  })
  it("ignores a design word that is not on the list", async () => {
    const { run } = await setup()
    const feed = await run(new MockProvider([assess(A0, { ...A1, design: "amazing study" })]))
    expect(feed.items.find((item) => item.paper.ids.pmid === "112")?.designSource).not.toBe("model")
  })
})

describe("papers already displayed are not recommended again", () => {
  it("remembers which papers were displayed", async () => {
    const storage = new MemoryVaultStorage()
    await recordSeen(storage, ["pmid:1", "pmid:2"], NOW())
    await recordSeen(storage, ["pmid:2", "pmid:3"], NOW())
    expect([...(await loadSeen(storage))].sort()).toEqual(["pmid:1", "pmid:2", "pmid:3"])
    await storage.write(".scispark/clinical/seen.json", "{ not json")
    expect((await loadSeen(storage)).size).toBe(0)
  })
  it("moves a displayed paper out of the list into the seen-earlier section on the next run", async () => {
    const { storage, run } = await setup()
    const first = await run(new MockProvider([assess(A0, A1)]))
    expect(first.items).toHaveLength(2)
    await recordSeen(storage, ["pmid:111"], NOW())
    const second = await run(new MockProvider([assess(A0, A1)]))
    expect(second.items.map((item) => item.paper.ids.pmid)).toEqual(["112"])
    expect(second.seenEarlier?.map((item) => item.paper.ids.pmid)).toEqual(["111"])
  })
  it("stores an empty list, not an error, when every matching paper has been seen", async () => {
    const { storage, run } = await setup()
    await run(new MockProvider([assess(A0, A1)]))
    await recordSeen(storage, ["pmid:111", "pmid:112"], NOW())
    const second = await run(new MockProvider([assess(A0, A1)]))
    expect(second.items).toEqual([])
    expect(second.seenEarlier).toHaveLength(2)
  })
})
