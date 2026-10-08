import { describe, expect, it } from "vitest"
import { loadPsychiatryPack } from "../pack/load"
import { verifyMatchedParts } from "../grade/verify-parts"
import type { StageAGrade } from "../types"
import { gated, watch } from "./helpers"

// Seen on the run of 2026-10-06 after the layers were added: the model called trazodone, probiotics and rTMS
// papers a full match for "Major depressive disorder × Esketamine", and an OCD paper a full match for
// "ADHD × Methylphenidate". As with quotes, a claim the paper's own text does not bear out is not kept.

const MDD_ESK = watch({ id: "m", condition: "Major depressive disorder", treatment: "Esketamine" })
const ADHD_MPH = watch({ id: "a", condition: "ADHD", treatment: "Methylphenidate" })
const SCZ = watch({ id: "s", condition: "Schizophrenia" })
const grade = (entryId: string, matched: StageAGrade["matched"]): StageAGrade =>
  ({ key: "k", entryId, grade: 4, topicGrade: 4, quote: "q", quoteVerified: true, ungraded: false, modelGrade: 4, matched })
const p = (title: string, abstract = "", fields: string[] = []) => gated({ title, abstract, fields }, "randomized-trial", "k")

describe("verifyMatchedParts", () => {
  it("keeps a full match when the text names both the condition and the treatment", async () => {
    const pack = await loadPsychiatryPack()
    expect(verifyMatchedParts(grade("m", "full"), p("Esketamine nasal spray in major depressive disorder"), [MDD_ESK], pack).matched).toBe("full")
    expect(verifyMatchedParts(grade("m", "full"), p("Spravato in depressed adults", "Adults with treatment-resistant depression."), [MDD_ESK], pack).matched).toBe("full")
  })

  it("lowers a claimed full match to a condition match when the text never names the treatment", async () => {
    const pack = await loadPsychiatryPack()
    expect(verifyMatchedParts(grade("m", "full"), p("Trazodone improves sleep architecture in depressed patients"), [MDD_ESK], pack).matched).toBe("condition")
    expect(verifyMatchedParts(grade("m", "full"), p("Probiotics reduced depressive symptoms in adults"), [MDD_ESK], pack).matched).toBe("condition")
  })

  it("does not take the bare abbreviation EPA or DHA for omega-3", async () => {
    const pack = await loadPsychiatryPack()
    const omega = watch({ id: "o", condition: "Major depressive disorder", treatment: "Omega-3 fatty acids" })
    expect(verifyMatchedParts(grade("o", "full"), p("Air quality and major depressive disorder", "EPA monitoring data and DHA levels were linked to admissions."), [omega], pack).matched).toBe("condition")
    expect(verifyMatchedParts(grade("o", "full"), p("Fish oil in major depressive disorder"), [omega], pack).matched).toBe("full")
  })

  it("lowers it to a treatment match when the text never names the condition", async () => {
    const pack = await loadPsychiatryPack()
    expect(verifyMatchedParts(grade("m", "full"), p("Esketamine for anxiety after colorectal surgery"), [MDD_ESK], pack).matched).toBe("treatment")
  })

  it("removes the match altogether when the text names neither", async () => {
    const pack = await loadPsychiatryPack()
    const checked = verifyMatchedParts(grade("a", "full"), p("Microbiome profiles show no correlation with SSRI response in OCD"), [ADHD_MPH], pack)
    expect(checked).toMatchObject({ entryId: null, grade: 0 })
    expect(checked.matched).toBeUndefined()
    expect(verifyMatchedParts(grade("a", "condition"), p("Characteristics of methamphetamine use disorder"), [ADHD_MPH], pack).entryId).toBeNull()
  })

  it("accepts the condition from a MeSH heading, and other forms of the same word", async () => {
    const pack = await loadPsychiatryPack()
    expect(verifyMatchedParts(grade("s", "full"), p("Clozapine and neutropenia", "", ["Schizophrenia"]), [SCZ], pack).matched).toBe("full")
    expect(verifyMatchedParts(grade("s", "full"), p("Cognition in schizophrenic inpatients"), [SCZ], pack).matched).toBe("full")
    expect(verifyMatchedParts(grade("s", "full"), p("Lithium in bipolar disorder: a prospective study"), [SCZ], pack).entryId).toBeNull()
  })

  it("leaves alone a grade that makes no claim about parts, and a paper that was not graded", async () => {
    const pack = await loadPsychiatryPack()
    const legacy = { ...grade("m", undefined) }
    expect(verifyMatchedParts(legacy, p("Trazodone in depressed patients"), [MDD_ESK], pack)).toEqual(legacy)
  })

  // Owner decisions 2026-10-06.
  it("counts ketamine as the treatment of an esketamine entry, through the taxonomy's related treatments", async () => {
    const pack = await loadPsychiatryPack()
    expect(verifyMatchedParts(grade("m", "full"), p("Rapamycin with ketamine in depression"), [MDD_ESK], pack).matched).toBe("full")
    expect(verifyMatchedParts(grade("m", "full"), p("Intravenous ketamine after surgery"), [MDD_ESK], pack).matched).toBe("treatment")
  })

  it("needs the condition in the title or the MeSH headings; a mention in the abstract is not enough", async () => {
    const pack = await loadPsychiatryPack()
    const passing = p("Older age and trauma linked to poor lithium response in bipolar disorder", "Patients also had episodes of depression.")
    expect(verifyMatchedParts(grade("m", "condition"), passing, [MDD_ESK], pack).entryId).toBeNull()
    const indexed = p("Lithium response and clinical course", "A cohort study.", ["Depressive Disorder, Major"])
    expect(verifyMatchedParts(grade("m", "condition"), indexed, [MDD_ESK], pack).matched).toBe("condition")
    // The treatment may still be named only in the abstract.
    const treated = p("A new option for major depressive disorder", "Adults received esketamine nasal spray.")
    expect(verifyMatchedParts(grade("m", "full"), treated, [MDD_ESK], pack).matched).toBe("full")
  })
})
