import { describe, expect, it } from "vitest"
import { cleanAbstract, cleanTitle, qualityFlags } from "../text/clean"

describe("cleanTitle", () => {
  it("unescapes entities and strips tags", () => {
    expect(cleanTitle("Effects of <i>CBT</i> &amp; sertraline &#x27;in&#39; adults")).toBe("Effects of CBT & sertraline 'in' adults")
  })
  it("normalises dashes and exotic spaces", () => {
    expect(cleanTitle("Placebo–controlled trial — a review")).toBe("Placebo-controlled trial - a review")
  })
  it("drops a list-number prefix and one trailing period, but keeps an ellipsis", () => {
    expect(cleanTitle("153. Ketamine for depression.")).toBe("Ketamine for depression")
    expect(cleanTitle("21) Lithium and suicide")).toBe("Lithium and suicide")
    expect(cleanTitle("Is it enough...")).toBe("Is it enough...")
  })
  it("returns undefined for empty input after cleaning", () => {
    expect(cleanTitle("<i></i>")).toBeUndefined()
    expect(cleanTitle(undefined)).toBeUndefined()
  })
})

describe("cleanAbstract", () => {
  it("removes a leading Abstract heading", () => {
    expect(cleanAbstract("Abstract: We studied 40 patients.")).toBe("We studied 40 patients.")
    expect(cleanAbstract("ABSTRACT We studied 40 patients.")).toBe("We studied 40 patients.")
  })
  it("repairs a section label glued to its content", () => {
    expect(cleanAbstract("BackgroundWe recruited adults.")).toBe("Background: We recruited adults.")
  })
  it("repairs a label with a space but no colon, only at a boundary", () => {
    expect(cleanAbstract("Background Adolescent anxiety is common.")).toBe("Background: Adolescent anxiety is common.")
    expect(cleanAbstract("We saw gains. Methods This study used trials.")).toBe("We saw gains.\nMethods: This study used trials.")
    expect(cleanAbstract("The methods We used were simple.")).toBe("The methods We used were simple.")
  })
  it("puts every section label on its own line and collapses spaces", () => {
    expect(cleanAbstract("Background: A  b.  Methods: C d. Results: E f.")).toBe("Background: A b.\nMethods: C d.\nResults: E f.")
  })
  it("handles plural labels", () => {
    expect(cleanAbstract("Objectives To test X. Results Y improved.")).toBe("Objectives: To test X.\nResults: Y improved.")
  })
})

describe("qualityFlags", () => {
  it("flags without gating", () => {
    expect(qualityFlags({ title: "Short", abstract: "N/A" })).toEqual(["title_too_short", "abstract_too_short", "abstract_stub"])
  })
  it("flags a missing abstract as title-only", () => {
    expect(qualityFlags({ title: "A perfectly fine title about depression" })).toEqual(["title-only"])
  })
  it("returns no flags for a clean record", () => {
    expect(qualityFlags({ title: "A perfectly fine title about depression", abstract: "x".repeat(150) })).toEqual([])
  })
})
