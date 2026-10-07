import { describe, expect, it } from "vitest"
import { loadPsychiatryPack } from "../pack/load"
import { entriesKey } from "../feed/cache"
import { verifyMatchedParts } from "../grade/verify-parts"
import { entryQuery, type DateWindow } from "../plan/queries"
import { topicLabel } from "../topic-label"
import { WatchEntrySchema, type StageAGrade } from "../types"
import { gated, watch } from "./helpers"

// Owner decision 2026-10-07: a topic may name two conditions, joined by AND (a paper must be about
// both; a paper about only one is not listed) or OR (either is enough). The treatment keeps its own
// rule: papers about the condition and the treatment first, then papers about the condition alone.

const WINDOW: DateWindow = { from: new Date("2026-09-07T00:00:00.000Z"), to: new Date("2026-10-07T00:00:00.000Z") }
const BOTH = watch({ id: "b", condition: "ADHD", condition2: "Autism", conditionJoin: "and" })
const EITHER = watch({ id: "e", condition: "ADHD", condition2: "Autism", conditionJoin: "or" })
const grade = (entryId: string, matched: StageAGrade["matched"]): StageAGrade =>
  ({ key: "k", entryId, grade: 4, topicGrade: 4, quote: "q", quoteVerified: true, ungraded: false, modelGrade: 4, matched })
const p = (title: string, fields: string[] = []) => gated({ title, abstract: "An abstract.", fields }, "cohort", "k")

describe("a topic with two conditions", () => {
  it("is valid with a second condition, defaults to AND, and needs a first condition", () => {
    expect(WatchEntrySchema.safeParse({ id: "x", condition: "ADHD", condition2: "Autism", priority: "normal", safetySignal: false }).success).toBe(true)
    expect(WatchEntrySchema.safeParse({ id: "x", condition2: "Autism", treatment: "Methylphenidate", priority: "normal", safetySignal: false }).success).toBe(false)
  })

  it("is named with both conditions and how they are joined", () => {
    expect(topicLabel(BOTH)).toBe("ADHD + Autism")
    expect(topicLabel(EITHER)).toBe("ADHD or Autism")
    expect(topicLabel({ ...BOTH, conditionJoin: undefined })).toBe("ADHD + Autism")
    expect(topicLabel({ ...BOTH, treatment: "Methylphenidate" })).toBe("ADHD + Autism × Methylphenidate")
    expect(topicLabel(watch({ condition: "ADHD", treatment: "Methylphenidate" }))).toBe("ADHD × Methylphenidate")
  })

  it("searches PubMed for both conditions together, or for either", async () => {
    const pack = await loadPsychiatryPack()
    const and = entryQuery(pack, BOTH, WINDOW)!.query
    const or = entryQuery(pack, EITHER, WINDOW)!.query
    expect(and).toMatch(/"ADHD"\[Title\/Abstract\][^)]*\) AND \([^)]*autis/i)
    expect(or).toMatch(/"ADHD"\[Title\/Abstract\][^)]*\) OR \([^)]*autis/i)
    expect(entryQuery(pack, BOTH, WINDOW)!.rationale).toBe("ADHD + Autism")
  })

  it("AND: lists a paper only when its title or MeSH headings name both conditions", async () => {
    const pack = await loadPsychiatryPack()
    expect(verifyMatchedParts(grade("b", "full"), p("Sleep in children with ADHD and autism"), [BOTH], pack).matched).toBe("full")
    expect(verifyMatchedParts(grade("b", "full"), p("Sleep in children", ["Attention Deficit Disorder with Hyperactivity", "Autism Spectrum Disorder"]), [BOTH], pack).matched).toBe("full")
    expect(verifyMatchedParts(grade("b", "full"), p("Sleep in children with ADHD"), [BOTH], pack).entryId).toBeNull()
    expect(verifyMatchedParts(grade("b", "full"), p("Sleep in autistic children"), [BOTH], pack).entryId).toBeNull()
  })

  it("OR: lists a paper that names either condition", async () => {
    const pack = await loadPsychiatryPack()
    expect(verifyMatchedParts(grade("e", "full"), p("Sleep in children with ADHD"), [EITHER], pack).matched).toBe("full")
    expect(verifyMatchedParts(grade("e", "full"), p("Sleep in autistic children"), [EITHER], pack).matched).toBe("full")
    expect(verifyMatchedParts(grade("e", "full"), p("Sleep in children with epilepsy"), [EITHER], pack).entryId).toBeNull()
  })

  it("keeps the treatment rule: with both conditions but another treatment, the paper is a condition match", async () => {
    const pack = await loadPsychiatryPack()
    const entry = { ...BOTH, treatment: "Methylphenidate" }
    expect(verifyMatchedParts(grade("b", "full"), p("Melatonin for sleep in children with ADHD and autism"), [entry], pack).matched).toBe("condition")
    expect(verifyMatchedParts(grade("b", "full"), p("Methylphenidate in children with ADHD and autism"), [entry], pack).matched).toBe("full")
    expect(verifyMatchedParts(grade("b", "full"), p("Methylphenidate in children with ADHD"), [entry], pack).matched).toBe("treatment")
  })

  it("grades again when the second condition or the way they are joined changes", () => {
    expect(entriesKey([BOTH])).not.toBe(entriesKey([EITHER]))
    expect(entriesKey([BOTH])).not.toBe(entriesKey([watch({ id: "b", condition: "ADHD" })]))
  })
})
