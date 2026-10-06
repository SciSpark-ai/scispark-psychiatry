import { describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import { GradingFailedError, STAGE_A_BATCH, gradeStageA, verifyQuote } from "../grade/stage-a"
import { fastOk, gated, llmResult, SETTINGS, watch } from "./helpers"

const entries = [watch({ id: "w1", condition: "depression", treatment: "esketamine" })]
const trial = gated({ title: "Esketamine nasal spray in treatment-resistant depression", abstract: "Adults with treatment-resistant depression received esketamine nasal spray or placebo.", ids: { pmid: "1" } }, "randomized-trial", "k1")

describe("verifyQuote", () => {
  it("accepts text that appears in the title or abstract, ignoring case and spacing", () => {
    expect(verifyQuote("received  ESKETAMINE nasal spray", trial)).toBe(true)
    expect(verifyQuote('"Esketamine nasal spray in treatment-resistant depression"', trial)).toBe(true)
  })
  it("rejects invented or too-short quotes", () => {
    expect(verifyQuote("a 40% remission rate was observed", trial)).toBe(false)
    expect(verifyQuote("spray", trial)).toBe(false)
    expect(verifyQuote("", trial)).toBe(false)
  })
})

describe("gradeStageA", () => {
  const opts = (fast: MockProvider) => ({ storage: new MemoryVaultStorage(), settings: SETTINGS, providerOverride: { fast } })

  it("keeps a verified grade", async () => {
    const fast = fastOk([{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "esketamine nasal spray or placebo" }])
    const { grades, failedBatches } = await gradeStageA([trial], entries, [], opts(fast))
    expect(failedBatches).toBe(0)
    expect(grades.get("k1")).toMatchObject({ entryId: "w1", grade: 4, topicGrade: 4, quoteVerified: true, ungraded: false })
  })

  it("zeroes a grade whose quote is not in the text", async () => {
    const fast = fastOk([{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "showed significant remission at week four" }])
    const { grades } = await gradeStageA([trial], entries, [], opts(fast))
    expect(grades.get("k1")).toMatchObject({ entryId: null, grade: 0, topicGrade: 0, quoteVerified: false, ungraded: false })
  })

  it("ignores an unknown entry id", async () => {
    const fast = fastOk([{ index: 0, entryId: "w-nope", grade: 4, topicGrade: 3, quote: "esketamine nasal spray or placebo" }])
    const { grades } = await gradeStageA([trial], entries, [], opts(fast))
    expect(grades.get("k1")).toMatchObject({ entryId: null, grade: 0, topicGrade: 3 })
  })

  it("leaves a candidate the model skipped ungraded, not dropped", async () => {
    const second = gated({ title: "Another esketamine study", abstract: "Text.", ids: { pmid: "2" } }, "randomized-trial", "k2")
    const fast = fastOk([{ index: 0, entryId: "w1", grade: 3, topicGrade: 3, quote: "esketamine nasal spray or placebo" }])
    const { grades } = await gradeStageA([trial, second], entries, [], opts(fast))
    expect(grades.get("k2")).toMatchObject({ ungraded: true, grade: 0 })
  })

  it("batches by 20 and survives one failed batch", async () => {
    const many = Array.from({ length: STAGE_A_BATCH + 5 }, (_, i) => gated({ title: `Esketamine paper ${i}`, abstract: "Esketamine nasal spray was tested.", ids: { pmid: String(i) } }, "randomized-trial", `k${i}`))
    const first = Array.from({ length: STAGE_A_BATCH }, (_, index) => ({ index, entryId: "w1", grade: 3, topicGrade: 3, quote: "esketamine nasal spray was tested" }))
    const fast = new MockProvider([llmResult({ assessments: first }, "claude-haiku-4-5")])
    const { grades, failedBatches } = await gradeStageA(many, entries, [], opts(fast))
    expect(failedBatches).toBe(1)
    expect(grades.get("k0")?.grade).toBe(3)
    expect(grades.get(`k${STAGE_A_BATCH}`)?.ungraded).toBe(true)
  })

  it("throws when every batch fails", async () => {
    await expect(gradeStageA([trial], entries, [], opts(new MockProvider([])))).rejects.toBeInstanceOf(GradingFailedError)
  })

  it("sends exemplar titles and entry ids to the model", async () => {
    const fast = fastOk([{ index: 0, entryId: "w1", grade: 4, topicGrade: 4, quote: "esketamine nasal spray or placebo" }])
    await gradeStageA([trial], entries, ["A paper the clinician liked"], opts(fast))
    const user = fast.calls[0].req.messages.find((message) => message.role === "user")!.content
    expect(user).toContain("A paper the clinician liked")
    expect(user).toContain('"id":"w1"')
  })
})
