import { describe, expect, it } from "vitest"
import { loadPsychiatryPack } from "../pack/load"
import { classifyDesign, designGate } from "../filter/gate"
import { candidate, paper, watch } from "./helpers"

describe("classifyDesign", () => {
  it("prefers publication types", () => {
    expect(classifyDesign(paper({ title: "t", publicationTypes: ["Journal Article", "Randomized Controlled Trial"] }))).toEqual({ design: "randomized-trial", source: "publication-type" })
    expect(classifyDesign(paper({ title: "t", publicationTypes: ["Journal Article", "Meta-Analysis", "Systematic Review"] })).design).toBe("meta-analysis")
    expect(classifyDesign(paper({ title: "t", publicationTypes: ["Clinical Trial, Phase III"] })).design).toBe("clinical-trial")
  })
  it("falls back to text rules when there are no specific types", () => {
    expect(classifyDesign(paper({ title: "Esketamine: a randomised trial", publicationTypes: ["Journal Article"] }))).toEqual({ design: "randomized-trial", source: "text-rule" })
    expect(classifyDesign(paper({ title: "A cohort of 4,000 adolescents", abstract: "Prospective follow-up." })).design).toBe("cohort")
  })
  it("lets text upgrade a bare Review type to a meta-analysis, but nothing else", () => {
    expect(classifyDesign(paper({ title: "A meta-analysis of rTMS", publicationTypes: ["Review"] })).design).toBe("meta-analysis")
    expect(classifyDesign(paper({ title: "A narrative overview", abstract: "A prospective cohort is discussed.", publicationTypes: ["Review"] })).design).toBe("review")
  })
  it("calls a record with nothing to go on unknown", () => {
    expect(classifyDesign(paper({ title: "Brand-new record" }))).toEqual({ design: "unknown", source: "none" })
  })
})

describe("designGate", () => {
  const rct = candidate({ title: "RCT of CBT", publicationTypes: ["Randomized Controlled Trial"] }, "k:rct")
  const cohort = candidate({ title: "Cohort study", publicationTypes: ["Observational Study"] }, "k:cohort")
  const editorial = candidate({ title: "Comment on trial", publicationTypes: ["Editorial"] }, "k:ed")
  const retracted = candidate({ title: "Retracted trial", isRetracted: true, publicationTypes: ["Randomized Controlled Trial"] }, "k:ret")
  const erratum = candidate({ title: "Erratum to: trial", publicationTypes: ["Published Erratum"] }, "k:err")
  const caseReport = candidate({ title: "Seizure after bupropion: a case report", abstract: "A patient on bupropion had a seizure.", publicationTypes: ["Case Reports"] }, "k:case")
  const narrative = candidate({ title: "An overview of lithium", abstract: "A narrative overview.", publicationTypes: ["Review"] }, "k:rev")
  const all = [rct, cohort, editorial, retracted, erratum, caseReport, narrative]

  it("strict keeps only trials, systematic reviews and guidelines", async () => {
    const pack = await loadPsychiatryPack()
    expect(designGate(pack, [], all, "strict").gated.map((c) => c.key)).toEqual(["k:rct"])
  })
  it("standard adds observational studies", async () => {
    const pack = await loadPsychiatryPack()
    expect(designGate(pack, [], all, "standard").gated.map((c) => c.key)).toEqual(["k:rct", "k:cohort"])
  })
  it("open adds narrative reviews, but never editorials, retractions or errata", async () => {
    const pack = await loadPsychiatryPack()
    const result = designGate(pack, [], all, "open")
    expect(result.gated.map((c) => c.key)).toEqual(["k:rct", "k:cohort", "k:rev"])
    expect(result.drops.map((d) => d.key)).toEqual(expect.arrayContaining(["k:ed", "k:ret", "k:err"]))
  })
  it("hides a case report unless it matches a safety-signal entry", async () => {
    const pack = await loadPsychiatryPack()
    expect(designGate(pack, [watch({ treatment: "bupropion" })], [caseReport], "standard").safety).toEqual([])
    const flagged = designGate(pack, [watch({ treatment: "bupropion", safetySignal: true })], [caseReport], "standard")
    expect(flagged.safety.map((c) => c.key)).toEqual(["k:case"])
    expect(flagged.gated).toEqual([])
  })
  it("records a reason for every drop", async () => {
    const pack = await loadPsychiatryPack()
    const { drops } = designGate(pack, [], all, "strict")
    expect(drops.map((d) => d.reason)).toEqual(expect.arrayContaining(["design:cohort", "design:review", "Non-article record: Editorial", "Retracted work", "case-report"]))
    expect(drops.every((d) => d.step === "gate")).toBe(true)
  })
})
