// src/lib/clinical/__tests__/records-extract.test.ts
import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { TaxonomySchema } from "../pack/schema"
import { headAndTail } from "../../text"
import { EXTRACTABLE_DESIGNS, NotATrialError, checkExtraction, extractTrialRecord } from "../records/extract"
import { getField } from "../records/schema"
import { llmResult, paper, SETTINGS } from "./helpers"

const TEXT = [
  "Adults with treatment-resistant depression were randomised to esketamine nasal spray (n = 336) or quetiapine (n = 340).",
  "The primary outcome was remission at week 8 on the MADRS.",
  "Remission occurred in 91 of 336 patients with esketamine and 60 of 340 with quetiapine.",
  "The mean MADRS score at week 8 was 14.2 (SD 9.1) with esketamine and 17.0 (SD 9.4) with quetiapine.",
].join(" ")
const PAPER = paper({ title: "Esketamine versus quetiapine in treatment-resistant depression", ids: { pmid: "111" }, year: 2026 })
const TAXONOMY = TaxonomySchema.parse({ version: "t", nodes: [
  { id: "treatment-resistant-depression", type: "condition", name: "Treatment-resistant depression" },
  { id: "esketamine", type: "treatment", name: "Esketamine", modality: "drug" },
  { id: "quetiapine", type: "treatment", name: "Quetiapine", modality: "drug" },
] })
const SOURCE = { access: "full-text" as const, locator: "PMC", checkedAt: "2026-10-07T10:00:00.000Z", truncated: false, notes: [] }
const q = (value: string | number | null, quote: string | null) => ({ value, quote })
const S1 = "Adults with treatment-resistant depression were randomised to esketamine nasal spray (n = 336) or quetiapine (n = 340)."
const S3 = "Remission occurred in 91 of 336 patients with esketamine and 60 of 340 with quetiapine."
const S4 = "The mean MADRS score at week 8 was 14.2 (SD 9.1) with esketamine and 17.0 (SD 9.4) with quetiapine."
const none = q(null, null)
const ANSWER = {
  isTrial: true, condition: q("treatment-resistant depression", S1), conditionCode: "treatment-resistant-depression",
  arms: [
    { id: "a1", role: "treatment", treatment: q("esketamine nasal spray", S1), treatmentCode: "esketamine", n: q(336, S1) },
    { id: "a2", role: "control", treatment: q("quetiapine", S1), treatmentCode: "quetiapine", n: q(340, S1) },
  ],
  outcomes: [
    { id: "o1", name: q("remission", "The primary outcome was remission at week 8 on the MADRS."), instrument: q("MADRS", "The primary outcome was remission at week 8 on the MADRS."), timepoint: q("week 8", "The primary outcome was remission at week 8 on the MADRS."),
      kind: "binary", lowerIsBetter: false, primary: true,
      results: [{ armId: "a1", n: q(336, S3), mean: none, sd: none, events: q(91, S3) }, { armId: "a2", n: q(340, S3), mean: none, sd: none, events: q(60, S3) }] },
    { id: "o2", name: q("MADRS score", S4), instrument: q("MADRS", S4), timepoint: q("week 8", S4), kind: "continuous", lowerIsBetter: true, primary: false,
      results: [{ armId: "a1", n: none, mean: q(14.2, S4), sd: q(9.1, S4), events: none }, { armId: "a2", n: none, mean: q(17.0, S4), sd: q(9.4, S4), events: none }] },
  ],
}
const strong = (...answers: unknown[]) => new MockProvider(answers.map((answer) => llmResult(answer, "claude-sonnet-5")))
const run = (provider: MockProvider, design: "randomized-trial" | "meta-analysis" = "randomized-trial", text = TEXT) =>
  extractTrialRecord(new MemoryVaultStorage(), PAPER, { design, text, source: SOURCE, taxonomy: TAXONOMY, settings: SETTINGS, providerOverride: { strong: provider }, now: () => new Date("2026-10-07T10:00:00.000Z") })

describe("extracting a trial record", () => {
  it("keeps values whose quote is in the paper, marks them quote-verified, and records what it was read from", async () => {
    const record = await run(strong(ANSWER))
    expect(record.slug).toBe("esketamine-versus-quetiapine-in-treatment-resistant-depression")
    expect(record.paperKey).toBe("pmid:111")
    expect(record.conditionCode).toBe("treatment-resistant-depression")
    expect(record.arms.map((arm) => [arm.role, arm.treatmentCode, arm.n.value])).toEqual([["treatment", "esketamine", 336], ["control", "quetiapine", 340]])
    expect(getField(record, "outcomes.o1.results.a1.events")).toEqual({ value: 91, quote: S3, state: "quote-verified" })
    expect(getField(record, "outcomes.o2.results.a2.sd")?.value).toBe(9.4)
    // Not reported is unknown, not zero.
    expect(getField(record, "outcomes.o2.results.a1.events")).toEqual({ value: null, quote: null, state: "unverified" })
    expect(record.source.access).toBe("full-text")
    expect(record.droppedFields).toBe(0)
  })

  it("leaves the role of each arm, the direction of benefit and the primary mark unchecked: the model wrote them", async () => {
    const record = await run(strong(ANSWER))
    expect(record.arms.map((arm) => arm.roleState)).toEqual(["unverified", "unverified"])
    expect(record.outcomes.map((outcome) => [outcome.lowerIsBetterState, outcome.primaryState])).toEqual([["unverified", "unverified"], ["unverified", "unverified"]])
  })

  it("keeps the paper with the record, so its page can be opened when no feed has it any more", async () => {
    expect((await run(strong(ANSWER))).paper).toEqual(PAPER)
  })

  it("takes a quote of at most 400 characters only", () => {
    const sites = Array.from({ length: 40 }, (_, index) => `site ${index + 1}`).join(", ")
    const long = `Patients were enrolled at ${sites}, and of these 336 were given esketamine nasal spray in the double-blind phase of the study that is described in this report and its supplement.`
    expect(long.length).toBeGreaterThan(400)
    const answer = { ...ANSWER, arms: [{ ...ANSWER.arms[0], n: q(336, long) }, ANSWER.arms[1]] }
    const checked = checkExtraction(answer as never, `${TEXT} ${long}`, TAXONOMY)
    expect(checked.arms[0].n).toEqual({ value: null, quote: null, state: "unverified" })
    expect(checked.dropped).toBe(1)
    const short = long.slice(long.indexOf("and of these"))
    expect(checkExtraction({ ...ANSWER, arms: [{ ...ANSWER.arms[0], n: q(336, short) }, ANSWER.arms[1]] } as never, `${TEXT} ${long}`, TAXONOMY).arms[0].n.value).toBe(336)
  })

  it("does not take a paragraph as a quote: at most one sentence boundary inside it", () => {
    // The whole text holds every number, so it would pass the number-in-quote check for any of them.
    const paragraph = { ...ANSWER, arms: [{ ...ANSWER.arms[0], n: q(91, TEXT) }, ANSWER.arms[1]] }
    const checked = checkExtraction(paragraph as never, TEXT, TAXONOMY)
    expect(checked.arms[0].n.value).toBeNull()
    expect(checked.dropped).toBe(1)
    const three = { ...ANSWER, arms: [{ ...ANSWER.arms[0], n: q(336, TEXT.slice(0, TEXT.indexOf("The mean MADRS")).trim()) }, ANSWER.arms[1]] }
    expect(checkExtraction(three as never, TEXT, TAXONOMY).arms[0].n.value).toBeNull()
    // A sentence boundary may fall inside a quote once (an abbreviation, or a number split over two sentences).
    const two = { ...ANSWER, arms: [{ ...ANSWER.arms[0], n: q(336, `${S1} The primary outcome was remission at week 8 on the MADRS.`) }, ANSWER.arms[1]] }
    expect(checkExtraction(two as never, TEXT, TAXONOMY).arms[0].n.value).toBe(336)
    // A closing bracket or quote mark after the full stop is still a boundary.
    const bracketed = "Esketamine was given (n = 336.) Quetiapine was given (n = 340.) Both were continued. Follow-up was eight weeks."
    const many = { ...ANSWER, arms: [{ ...ANSWER.arms[0], n: q(336, bracketed) }, ANSWER.arms[1]] }
    expect(checkExtraction(many as never, `${TEXT} ${bracketed}`, TAXONOMY).arms[0].n.value).toBeNull()
  })

  it("tells the model the limit", async () => {
    const provider = strong(ANSWER)
    await run(provider)
    expect(provider.calls[0].req.messages[0].content).toContain("one sentence, at most 400 characters")
  })

  it("drops the name of an arm, or of the condition, that its quote does not print", () => {
    const unrelated = "The primary outcome was remission at week 8 on the MADRS."
    const invented = { ...ANSWER, condition: q("schizophrenia", unrelated), arms: [ANSWER.arms[0], { ...ANSWER.arms[1], treatment: q("placebo", unrelated) }] }
    const checked = checkExtraction(invented as never, TEXT, TAXONOMY)
    expect(checked.condition).toEqual({ value: null, quote: null, state: "unverified" })
    expect(checked.conditionCode).toBeNull()
    expect(checked.arms.map((arm) => arm.id)).toEqual(["a1"])
    expect(checked.dropped).toBe(2)
    // Every word of four letters or more must be there, in any case; shorter words are not asked for.
    const partly = { ...ANSWER, arms: [{ ...ANSWER.arms[0], treatment: q("Esketamine nasal spray plus an SSRI", S1) }, ANSWER.arms[1]] }
    expect(checkExtraction(partly as never, TEXT, TAXONOMY).arms.map((arm) => arm.id)).toEqual(["a2"])
    const cased = { ...ANSWER, arms: [{ ...ANSWER.arms[0], treatment: q("Esketamine Nasal Spray", S1) }, ANSWER.arms[1]] }
    expect(checkExtraction(cased as never, TEXT, TAXONOMY).arms[0].treatment.value).toBe("Esketamine Nasal Spray")
    // A name of short words only (an abbreviation) must be in the quote as it is.
    const abbreviation = "Patients received ECT (n = 40) or sham stimulation (n = 41)."
    const short = (name: string) => checkExtraction({ ...ANSWER, arms: [{ ...ANSWER.arms[0], treatment: q(name, abbreviation), n: none }, ANSWER.arms[1]], outcomes: [] } as never, `${TEXT} ${abbreviation}`, TAXONOMY).arms.map((arm) => arm.id)
    expect(short("ECT")).toEqual(["a1", "a2"])
    expect(short("TMS")).toEqual(["a2"])
  })

  it("refuses a single-group study for which the model invents a control group from an unrelated sentence", async () => {
    const single = "Adults with treatment-resistant depression received open-label esketamine nasal spray (n = 50). Symptoms were rated at week 4 by assessors who did not know the dose. Remission occurred in 20 of 50 patients."
    const first = "Adults with treatment-resistant depression received open-label esketamine nasal spray (n = 50)."
    const answer = { ...ANSWER, condition: q("treatment-resistant depression", first), outcomes: [], arms: [
      { id: "a1", role: "treatment", treatment: q("esketamine nasal spray", first), treatmentCode: "esketamine", n: q(50, first) },
      { id: "a2", role: "control", treatment: q("placebo", "Symptoms were rated at week 4 by assessors who did not know the dose."), treatmentCode: null, n: none },
    ] }
    await expect(run(strong(answer), "randomized-trial", single)).rejects.toBeInstanceOf(NotATrialError)
    await expect(run(strong(answer), "randomized-trial", single)).rejects.toThrow(/Fewer than two groups/)
  })

  it("rejects a quote that runs across the place where the middle of a long paper was left out", async () => {
    const filler = Array.from({ length: 9000 }, (_, index) => `depression study word${index}`).join(" ")
    const long = `${TEXT} ${filler}`
    const cut = headAndTail(long, 45_000, 8_000)
    const gap = cut.indexOf("[...]")
    expect(gap).toBeGreaterThan(0)
    const before = cut.slice(0, gap).trim().split(" ").slice(-6).join(" ")
    const after = cut.slice(gap + "[...]".length).trim().split(" ").slice(0, 6).join(" ")
    // With the mark copied in, the quote is "in the text" word for word; without it, it is not.
    const across = await run(strong({ ...ANSWER, condition: q("depression", `${before} [...] ${after}`) }), "randomized-trial", long)
    expect(across.condition.value).toBeNull()
    expect(across.droppedFields).toBe(1)
    const joined = await run(strong({ ...ANSWER, condition: q("depression", `${before} ${after}`) }), "randomized-trial", long)
    expect(joined.condition.value).toBeNull()
    // A quote that lies on one side of the gap is kept.
    const tail = await run(strong({ ...ANSWER, condition: q("depression", after) }), "randomized-trial", long)
    expect(tail.condition).toEqual({ value: "depression", quote: after, state: "quote-verified" })
    // The arms are in the part that was read.
    expect(across.arms).toHaveLength(2)
  })

  it("drops a value whose quote is not in the paper", () => {
    const invented = { ...ANSWER, arms: [{ ...ANSWER.arms[0], n: q(336, "A total of 336 patients received esketamine.") }, ANSWER.arms[1]] }
    const checked = checkExtraction(invented as never, TEXT, TAXONOMY)
    expect(checked.arms[0].n).toEqual({ value: null, quote: null, state: "unverified" })
    expect(checked.dropped).toBe(1)
  })

  it("drops a number that is in the paper but not in the sentence quoted for it", () => {
    const wrongSentence = { ...ANSWER, arms: [{ ...ANSWER.arms[0], n: q(336, "The primary outcome was remission at week 8 on the MADRS.") }, ANSWER.arms[1]] }
    expect(checkExtraction(wrongSentence as never, TEXT, TAXONOMY).arms[0].n.value).toBeNull()
    const wrongNumber = { ...ANSWER, arms: [{ ...ANSWER.arms[0], n: q(363, S1) }, ANSWER.arms[1]] }
    expect(checkExtraction(wrongNumber as never, TEXT, TAXONOMY).arms[0].n.value).toBeNull()
  })

  it("compares numbers with their sign", () => {
    const withMean = (value: number, quote: string) => checkExtraction({ ...ANSWER, outcomes: [{ ...ANSWER.outcomes[1], results: [{ ...ANSWER.outcomes[1].results[0], mean: q(value, quote) }] }] } as never, `${TEXT} ${quote}`, TAXONOMY).outcomes[0].results[0].mean
    expect(withMean(-3.2, "The mean change was -3.2 points with esketamine.").value).toBe(-3.2)
    expect(withMean(-3.2, "The mean change was \u22123.2 points with esketamine.").value).toBe(-3.2)
    expect(withMean(3.2, "The mean change was -3.2 points with esketamine.").value).toBeNull()
    expect(withMean(-3.2, "The mean change was 3.2 points with esketamine.").value).toBeNull()
    expect(withMean(0.97, "The hazard ratio was 0.84 (95% CI 0.78-0.97) with esketamine.").value).toBe(0.97)
    expect(withMean(-0.97, "The hazard ratio was 0.84 (95% CI 0.78-0.97) with esketamine.").value).toBeNull()
  })

  it("keeps a code only if the pack has it, with the right type", () => {
    const codes = { ...ANSWER, conditionCode: "esketamine", arms: [{ ...ANSWER.arms[0], treatmentCode: "made-up-drug" }, ANSWER.arms[1]] }
    const checked = checkExtraction(codes as never, TEXT, TAXONOMY)
    expect(checked.conditionCode).toBeNull()
    expect(checked.arms[0].treatmentCode).toBeNull()
    expect(checked.arms[0].treatment.value).toBe("esketamine nasal spray")
  })

  it("removes an arm with no checked treatment name, and the results that named it", () => {
    const noName = { ...ANSWER, arms: [ANSWER.arms[0], { ...ANSWER.arms[1], treatment: q("quetiapine", "Patients in the control group received quetiapine XR.") }, { id: "a3", role: "control", treatment: q("quetiapine", S1), treatmentCode: "quetiapine", n: q(340, S1) }] }
    const checked = checkExtraction(noName as never, TEXT, TAXONOMY)
    expect(checked.arms.map((arm) => arm.id)).toEqual(["a1", "a3"])
    expect(checked.outcomes[0].results.map((result) => result.armId)).toEqual(["a1"])
    expect(checked.dropped).toBe(1)
  })

  it("keeps three arms", () => {
    const three = { ...ANSWER, arms: [...ANSWER.arms, { id: "a3", role: "control", treatment: q("quetiapine", S1), treatmentCode: null, n: none }] }
    expect(checkExtraction(three as never, TEXT, TAXONOMY).arms).toHaveLength(3)
  })

  it("refuses a paper that is not a trial, before and after asking the model", async () => {
    expect(EXTRACTABLE_DESIGNS).toEqual(["randomized-trial", "clinical-trial"])
    const never = strong()
    await expect(run(never, "meta-analysis")).rejects.toBeInstanceOf(NotATrialError)
    expect(never.calls).toHaveLength(0)
    await expect(run(strong({ ...ANSWER, isTrial: false }))).rejects.toBeInstanceOf(NotATrialError)
    await expect(run(strong({ ...ANSWER, arms: [ANSWER.arms[0]] }))).rejects.toBeInstanceOf(NotATrialError)
  })

  it("gives the model the paper's text and the pack's codes, and fails loudly when the call fails", async () => {
    const provider = strong(ANSWER)
    await run(provider)
    const sent = provider.calls[0].req.messages.at(-1)!.content as string
    expect(sent).toContain("Remission occurred in 91 of 336 patients")
    expect(sent).toContain("treatment-resistant-depression")
    await expect(run(new MockProvider([new Error("No API key")]))).rejects.toThrow(/No API key/)
  })
})
