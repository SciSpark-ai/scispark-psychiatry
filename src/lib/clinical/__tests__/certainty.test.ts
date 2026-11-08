import { describe, expect, it } from "vitest"
import { overstated } from "../text/certainty"
import { checkDigest } from "../digest/card"
import type { PaperRecord } from "../../papers/types"

const cohort = ["In this cohort study of 9,000 adults, ADHD was associated with a higher hazard of cognitive impairment.", "Findings warrant attention."]
const pilot = ["This open-label pilot enrolled 22 adults.", "Scores fell from 22 to 9.", "Probiotics may contribute to the reduction of symptoms."]
const trial = ["Participants were randomized to drug or placebo.", "Relapse was lower with drug than placebo (12% vs 30%).", "The drug lowered relapse."]

describe("overstated", () => {
  it("flags an effect stated outright where the abstract reports an association", () => {
    expect(overstated("ADHD increases risk of cognitive impairment in older adults", cohort)).toBe("association")
  })
  it("flags an effect stated outright where the authors hold their conclusion back", () => {
    expect(overstated("Probiotics reduced depressive and anxiety symptoms in adults", pilot)).toBe("held-back")
  })
  it("flags an effect stated outright for a study without random allocation", () => {
    expect(overstated("Health education improved symptoms", ["A retrospective review of 80 records.", "Scores were lower after the programme."])).toBe("weak-design")
  })
  it("leaves a summary that keeps the abstract's own wording", () => {
    expect(overstated("ADHD was associated with a higher hazard of cognitive impairment", cohort)).toBeNull()
    expect(overstated("Probiotics may reduce depressive symptoms", pilot)).toBeNull()
  })
  it("leaves a plain result of a randomized comparison, and a finding of no effect", () => {
    expect(overstated("Drug lowered relapse more than placebo", trial)).toBeNull()
    expect(overstated("Caffeine did not improve inhibition", pilot)).toBeNull()
  })
  it("leaves a summary that states no effect at all", () => {
    expect(overstated("Prevalence of ADHD among older adults", cohort)).toBeNull()
  })
})

describe("checkDigest", () => {
  const paper = { title: "ADHD and cognitive impairment", abstract: cohort.join(" ") } as PaperRecord
  it("rejects an overstated headline with the reason, and accepts the abstract's own wording", () => {
    expect(checkDigest({ headline: "ADHD increases risk of cognitive impairment", takeaway: "ADHD was associated with a higher hazard of cognitive impairment in adults.", source: 1 }, paper)).toEqual({ reason: "certainty:association" })
    expect(checkDigest({ headline: "ADHD linked to cognitive impairment", takeaway: "ADHD was associated with a higher hazard of cognitive impairment in adults.", source: 1 }, paper)).toHaveProperty("digest")
  })
})
