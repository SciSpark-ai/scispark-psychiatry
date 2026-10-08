import { describe, expect, it } from "vitest"
import { evidenceHref } from "../evidence/href"
import { CLINICAL_COPY } from "../copy"
import {
  UNTITLED_STORED, conditionLink, excerptOf, noteKind, noteLinks, paperLabel, paperLink, plainText, referenceLine, revisionOf, titleOf, treatmentLink,
} from "../notes/links"

describe("evidenceHref with a treatment", () => {
  it("puts the treatment after the condition and leaves it out when there is none", () => {
    expect(evidenceHref({ condition: "depression", treatment: "esketamine" })).toBe("/wiki?condition=depression&treatment=esketamine")
    expect(evidenceHref({ condition: "depression", treatment: "esketamine", scope: "saved", period: "6m" })).toBe("/wiki?condition=depression&treatment=esketamine&scope=saved&period=6m")
    expect(evidenceHref({ condition: "depression" })).toBe("/wiki?condition=depression")
  })
})

describe("noteLinks", () => {
  it("reads a paper link, with and without a label", () => {
    expect(noteLinks("See [[10-1000-abc|Lamsma 2026]] and [[paper-2]].")).toEqual({ papers: ["10-1000-abc", "paper-2"], conditions: [], treatments: [] })
  })
  it("reads a condition link", () => {
    expect(noteLinks("On [Schizophrenia](/wiki?condition=schizophrenia).")).toEqual({ papers: [], conditions: ["schizophrenia"], treatments: [] })
  })
  it("reads a treatment link, which also counts its condition", () => {
    expect(noteLinks("[Esketamine](/wiki?condition=depression&treatment=esketamine)")).toEqual({
      papers: [], conditions: ["depression"], treatments: [{ condition: "depression", treatment: "esketamine" }],
    })
  })
  it("reads the three forms mixed, each list in the order of the text", () => {
    const body = [
      "# Heading",
      "[Clozapine](/wiki?condition=schizophrenia&treatment=clozapine) against [[paper-2|Smith 2025]],",
      "then [Major depressive disorder](/wiki?condition=depression) and [[paper-1]].",
    ].join("\n")
    expect(noteLinks(body)).toEqual({
      papers: ["paper-2", "paper-1"], conditions: ["schizophrenia", "depression"], treatments: [{ condition: "schizophrenia", treatment: "clozapine" }],
    })
  })
  it("does not read a link inside a code span or a fence, closed or not", () => {
    const body = "`[[paper-1]]` and `[x](/wiki?condition=depression)`\n\n```\n[[paper-2]]\n[y](/wiki?condition=schizophrenia&treatment=clozapine)\n```\n\n[[paper-3]]\n\n```\n[[paper-4]]"
    expect(noteLinks(body)).toEqual({ papers: ["paper-3"], conditions: [], treatments: [] })
  })
  it("gives each link once", () => {
    const body = "[[paper-1]] [[paper-1|again]] [a](/wiki?condition=depression) [b](/wiki?condition=depression) [c](/wiki?condition=depression&treatment=esketamine) [d](/wiki?condition=depression&treatment=esketamine)"
    expect(noteLinks(body)).toEqual({ papers: ["paper-1"], conditions: ["depression"], treatments: [{ condition: "depression", treatment: "esketamine" }] })
  })
  it("reads the same treatment under two conditions as two links", () => {
    const body = "[a](/wiki?condition=depression&treatment=lithium) [b](/wiki?condition=schizophrenia&treatment=lithium)"
    expect(noteLinks(body).treatments).toEqual([{ condition: "depression", treatment: "lithium" }, { condition: "schizophrenia", treatment: "lithium" }])
  })
  it("ignores other links, the Library view, an image and a malformed code", () => {
    const body = "[site](https://example.org/wiki?condition=depression) [all](/wiki?view=all) ![img](/wiki?condition=depression) [bad](/wiki?condition=../etc) [page](/wiki/wiki/notes/x)"
    expect(noteLinks(body)).toEqual({ papers: [], conditions: [], treatments: [] })
  })
  it("reads a link with a fragment after its parameters", () => {
    expect(noteLinks("[a](/wiki?condition=depression&treatment=esketamine#table) [b](/wiki?condition=schizophrenia#top)")).toEqual({
      papers: [], conditions: ["depression", "schizophrenia"], treatments: [{ condition: "depression", treatment: "esketamine" }],
    })
  })
  it("reads the links this module writes", () => {
    const body = [paperLink("paper-1", "Lamsma [2026] | x"), conditionLink("depression", "Major depressive disorder"), treatmentLink("depression", "esketamine", "Esketamine")].join(" ")
    expect(body).toContain("[[paper-1|Lamsma 2026 x]]")
    expect(body).toContain("[Esketamine](/wiki?condition=depression&treatment=esketamine)")
    expect(noteLinks(body)).toEqual({ papers: ["paper-1"], conditions: ["depression"], treatments: [{ condition: "depression", treatment: "esketamine" }] })
  })
})

describe("noteKind", () => {
  const links = (papers: string[], conditions: string[] = [], treatments: Array<{ condition: string; treatment: string }> = []) => ({ papers, conditions, treatments })
  it("is paper for exactly one paper and nothing else", () => expect(noteKind(links(["a"]))).toBe("paper"))
  it("is topic for a condition", () => expect(noteKind(links([], ["depression"]))).toBe("topic"))
  it("is topic for a treatment", () => expect(noteKind(links([], ["depression"], [{ condition: "depression", treatment: "esketamine" }]))).toBe("topic"))
  it("is topic for one paper and a condition", () => expect(noteKind(links(["a"], ["depression"]))).toBe("topic"))
  it("is topic for two or more papers", () => expect(noteKind(links(["a", "b"]))).toBe("topic"))
  it("is none with no link", () => expect(noteKind(links([]))).toBe("none"))
})

describe("excerptOf", () => {
  it("gives the first text that is not a heading, with links as their labels", () => {
    expect(excerptOf("# Title\n\n## Sub\n\nSee [[paper-1|Lamsma 2026]] on [Esketamine](/wiki?condition=depression&treatment=esketamine) and [[paper-2]].\n")).toBe("See Lamsma 2026 on Esketamine and paper-2.")
  })
  it("joins lines, drops quote and list marks and emphasis", () => {
    expect(excerptOf("A **bold** thought.\n\n> quoted text\n- an item\n")).toBe("A bold thought. quoted text an item")
  })
  it("cuts at the length given, 160 when none is", () => {
    const long = "word ".repeat(100)
    expect(excerptOf(long).length).toBeLessThanOrEqual(160)
    expect(excerptOf(long).endsWith("…")).toBe(true)
    expect(excerptOf("abcdefghij", 5)).toBe("abcd…")
  })
  it("is empty for an empty body or one of headings only", () => {
    expect(excerptOf("")).toBe("")
    expect(excerptOf("# Only a heading\n")).toBe("")
  })
})

describe("titleOf", () => {
  it("is the frontmatter title when there is one", () => expect(titleOf("  Esketamine in TRD ", "body")).toBe("Esketamine in TRD"))
  it("is the first line of the body when the title is empty or the old button's", () => {
    expect(titleOf(UNTITLED_STORED, "\n# First thoughts on [[paper-1|Lamsma 2026]]\n\nMore.")).toBe("First thoughts on Lamsma 2026")
    expect(titleOf("", "A line.\nAnother.")).toBe("A line.")
    expect(titleOf(undefined, "x".repeat(200)).length).toBe(80)
  })
  it("is the copy's untitled wording when the body is empty too", () => {
    expect(titleOf(UNTITLED_STORED, "  \n")).toBe(CLINICAL_COPY.notes.untitled)
    expect(titleOf(null, "")).toBe(CLINICAL_COPY.notes.untitled)
  })
})

describe("paperLabel", () => {
  it("is the first author's family name and the year", () => {
    expect(paperLabel({ title: "A trial", authors: ["Jelle Lamsma", "B Other"], year: 2026 })).toBe("Lamsma 2026")
    expect(paperLabel({ title: "A trial", authors: ["Lamsma, Jelle"], date: "2025-03-01", year: 2026 })).toBe("Lamsma 2025")
    expect(paperLabel({ title: "A trial", authors: ["Lamsma J"], year: null })).toBe("J")
  })
  it("is the title cut at 60 characters when there is no author", () => {
    expect(paperLabel({ title: "A short title", authors: [], year: 2026 })).toBe("A short title")
    const label = paperLabel({ title: "t".repeat(100), authors: [] })
    expect(label.length).toBe(60)
    expect(label.endsWith("…")).toBe(true)
  })
})

describe("referenceLine", () => {
  it("gives authors, title, journal, year and doi", () => {
    expect(referenceLine({ title: "A trial of esketamine", authors: ["Lamsma J", "Smith A"], venue: "Lancet Psychiatry", year: 2026, doi: "10.1000/abc" }))
      .toBe("Lamsma J, Smith A. A trial of esketamine. Lancet Psychiatry. 2026. doi:10.1000/abc")
  })
  it("gives the first three authors and then et al.", () => {
    expect(referenceLine({ title: "Title.", authors: ["A", "B", "C", "D"], year: 2026 })).toBe("A, B, C, et al. Title. 2026.")
  })
  it("leaves out what is missing", () => {
    expect(referenceLine({ title: "Only a title?", authors: [] })).toBe("Only a title?")
  })
})

describe("plainText", () => {
  it("gives the text as read: links as their labels, no addresses, headings kept", () => {
    expect(plainText("# Head\n\n[Esketamine](/wiki?condition=depression&treatment=esketamine) and [[paper-1|Lamsma 2026]]\n> quoted **bold**\n"))
      .toBe("Head\nEsketamine and Lamsma 2026\nquoted bold")
  })
})

describe("revisionOf", () => {
  it("is the same for the same text and differs for another", () => {
    expect(revisionOf("abc")).toBe(revisionOf("abc"))
    expect(revisionOf("abc")).not.toBe(revisionOf("abd"))
    expect(revisionOf("")).toMatch(/^[a-f0-9]{16,40}$/)
    expect(revisionOf("x".repeat(5000))).toMatch(/^[a-f0-9]{16,40}$/)
  })
})
