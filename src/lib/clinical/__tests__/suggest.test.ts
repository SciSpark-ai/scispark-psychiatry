import { describe, expect, it } from "vitest"
import { checkTerm, suggestTerms, suggestWithAliases } from "../watch/suggest"

const NAMES = ["Major depressive disorder", "Treatment-resistant depression", "Schizophrenia", "ADHD", "Autism spectrum disorder", "Esketamine", "Ketamine", "Methylphenidate"]
const ALIASES = ["depression", "MDD", "TRD", "autism", "Spravato"]

describe("suggestions while typing a topic", () => {
  it("offers names that start with what was typed, then names that contain it", () => {
    expect(suggestTerms(NAMES, "ke")).toEqual(["Ketamine", "Esketamine"])
    expect(suggestTerms(NAMES, "depress")).toEqual(["Major depressive disorder", "Treatment-resistant depression"])
    expect(suggestTerms(NAMES, "")).toEqual([])
    expect(suggestTerms(NAMES, "Ketamine")).toEqual(["Esketamine"])
  })
})

describe("checking what was typed", () => {
  it("accepts a known name or another name for it, whatever the capitals", () => {
    expect(checkTerm(NAMES, ALIASES, "esketamine")).toEqual({ status: "known", name: "Esketamine" })
    expect(checkTerm(NAMES, ALIASES, "trd")).toEqual({ status: "known", name: "TRD" })
  })
  it("asks about a likely misspelling", () => {
    expect(checkTerm(NAMES, ALIASES, "esketamin")).toEqual({ status: "close", suggestion: "Esketamine" })
    expect(checkTerm(NAMES, ALIASES, "Schizophernia")).toEqual({ status: "close", suggestion: "Schizophrenia" })
    expect(checkTerm(NAMES, ALIASES, "methylphenidat")).toEqual({ status: "close", suggestion: "Methylphenidate" })
  })
  it("lets through a term it does not know and that resembles nothing", () => {
    expect(checkTerm(NAMES, ALIASES, "Tourette syndrome")).toEqual({ status: "new" })
    expect(checkTerm(NAMES, ALIASES, "ADD")).toEqual({ status: "new" })
  })
})

describe("suggestions also search the other names of a term", () => {
  const aliasOf = { "attention deficit hyperactivity disorder": "ADHD", Spravato: "Esketamine", depression: "Major depressive disorder" }
  it("offers the term, and says which other name matched", () => {
    expect(suggestWithAliases(NAMES, aliasOf, "attention")).toEqual([{ name: "ADHD", via: "attention deficit hyperactivity disorder" }])
    expect(suggestWithAliases(NAMES, aliasOf, "sprav")).toEqual([{ name: "Esketamine", via: "Spravato" }])
  })
  it("lists a term once, by its own name first", () => {
    expect(suggestWithAliases(NAMES, aliasOf, "depress")).toEqual([{ name: "Major depressive disorder" }, { name: "Treatment-resistant depression" }])
  })
})

