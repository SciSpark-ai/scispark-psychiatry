import { describe, expect, it } from "vitest"
import { CLINICAL_COPY } from "../copy"
import { conditionCodeOf, notesOf, replaceNotes } from "../records/notes"
import { conditionBlock } from "../records/query"
import { evidenceHref } from "../evidence/href"

const P = CLINICAL_COPY.records.conditionPage
const FRONT = "---\ntype: condition\ntitle: Schizophrenia\ntaxonomy: schizophrenia\n---\n"
const TOP = `${FRONT}## ${P.evidence}\n\n${conditionBlock("schizophrenia")}\n\n`
const page = (rest: string) => `${TOP}${rest}`

describe("the notes section of a condition page", () => {
  it("reads the text under the notes heading of a page with the block", () => {
    expect(notesOf(page(`## ${P.notes}\n\nClozapine after two failures.\n\nSecond paragraph.\n`))).toBe("Clozapine after two failures.\n\nSecond paragraph.")
  })

  it("reads the template's hint as no notes", () => {
    expect(notesOf(page(`## ${P.notes}\n\n${P.notesHint}\n`))).toBe("")
  })

  it("stops at the next heading of the same or a higher level", () => {
    expect(notesOf(page(`## ${P.notes}\n\nMine.\n\n## References\n\nOther text.\n`))).toBe("Mine.")
    expect(notesOf(page(`### ${P.notes}\n\nMine.\n\n## Higher\n\nOther text.\n`))).toBe("Mine.")
  })

  it("keeps a deeper heading inside the notes", () => {
    expect(notesOf(page(`## ${P.notes}\n\nMine.\n\n### Dosing\n\n300 mg.\n\n## After\n\nx\n`))).toBe("Mine.\n\n### Dosing\n\n300 mg.")
  })

  it("does not take a heading inside a fenced block for the end of the notes", () => {
    expect(notesOf(page(`## ${P.notes}\n\nMine.\n\n\`\`\`\n## not a heading\n\`\`\`\n\nMore.\n`))).toBe("Mine.\n\n```\n## not a heading\n```\n\nMore.")
  })

  it("is empty on a page with no notes heading", () => {
    expect(notesOf(TOP)).toBe("")
    expect(notesOf("")).toBe("")
  })

  it("replaces only the notes, on a page with the block and the heading", () => {
    expect(replaceNotes(page(`## ${P.notes}\n\n${P.notesHint}\n`), "Clozapine after two failures.")).toBe(page(`## ${P.notes}\n\nClozapine after two failures.\n`))
  })

  it("leaves the text after the notes as it is", () => {
    const after = replaceNotes(page(`## ${P.notes}\n\nOld.\n\n## References\n\nOther text.\n`), "New.\n\nTwo.")
    expect(after).toBe(page(`## ${P.notes}\n\nNew.\n\nTwo.\n\n## References\n\nOther text.\n`))
  })

  it("replaces a deeper heading that is inside the notes, with them", () => {
    const after = replaceNotes(page(`## ${P.notes}\n\nOld.\n\n### Dosing\n\n300 mg.\n\n## After\n\nx\n`), "New.")
    expect(after).toBe(page(`## ${P.notes}\n\nNew.\n\n## After\n\nx\n`))
  })

  it("adds the heading at the end of a page that has none", () => {
    expect(replaceNotes(`${TOP}Some text.\n\n\n`, "Mine.")).toBe(`${TOP}Some text.\n\n## ${P.notes}\n\nMine.\n`)
  })

  it("ends the file with one newline, and empties the section for no notes", () => {
    expect(replaceNotes(page(`## ${P.notes}\n\nOld.\n\n\n`), "  New.  \n\n\n")).toBe(page(`## ${P.notes}\n\nNew.\n`))
    expect(replaceNotes(page(`## ${P.notes}\n\nOld.\n`), "")).toBe(page(`## ${P.notes}\n`))
  })

  it("gives back what was written", () => {
    const text = "One.\n\n### Deeper\n\nTwo."
    expect(notesOf(replaceNotes(page(`## ${P.notes}\n\nOld.\n\n## After\n`), text))).toBe(text)
  })
})

describe("the condition a page is about", () => {
  it("is the one its evidence block names", () => {
    expect(conditionCodeOf({ body: `## ${P.evidence}\n\n${conditionBlock("schizophrenia")}\n\n## ${P.notes}\n`, frontmatter: { taxonomy: "other" } })).toBe("schizophrenia")
  })
  it("is the one its front matter holds, on a page with no block", () => {
    expect(conditionCodeOf({ body: "Text only.", frontmatter: { taxonomy: "depression" } })).toBe("depression")
  })
  it("is none when neither names one", () => {
    expect(conditionCodeOf({ body: "Text only.", frontmatter: {} })).toBeNull()
    expect(conditionCodeOf({ body: "```condition-evidence\nnothing\n```", frontmatter: { taxonomy: "Not An Id" } })).toBeNull()
  })
})

describe("the address of the Evidence view", () => {
  it("names the condition and leaves out what is the default", () => {
    expect(evidenceHref({ condition: "depression" })).toBe("/wiki?condition=depression")
    expect(evidenceHref({ condition: "depression", scope: "all", period: "all", tab: "summary" })).toBe("/wiki?condition=depression")
    expect(evidenceHref({ condition: "depression", scope: "saved", period: "6m", tab: "notes" })).toBe("/wiki?condition=depression&scope=saved&period=6m&tab=notes")
  })
})
