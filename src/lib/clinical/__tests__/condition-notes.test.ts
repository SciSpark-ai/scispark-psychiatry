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

  it("runs to the end of the file: a heading after the notes heading is notes, whatever its level", () => {
    expect(notesOf(page(`## ${P.notes}\n\nMine.\n\n## References\n\nOther text.\n`))).toBe("Mine.\n\n## References\n\nOther text.")
    expect(notesOf(page(`### ${P.notes}\n\nMine.\n\n# Higher\n\nOther text.\n`))).toBe("Mine.\n\n# Higher\n\nOther text.")
  })

  it("finds a notes heading written with closing hashes", () => {
    expect(notesOf(page(`## ${P.notes} ##\n\nMine.\n`))).toBe("Mine.")
    expect(replaceNotes(page(`## ${P.notes} ##\n\nMine.\n`), "New.")).toBe(page(`## ${P.notes} ##\n\nNew.\n`))
  })

  it("starts at the first notes heading outside a fenced block, the fence closed only by its own marker", () => {
    const fenced = `~~~text\n## ${P.notes}\n\`\`\`\nstill inside\n~~~\n\n`
    expect(notesOf(page(`${fenced}## ${P.notes}\n\nMine.\n`))).toBe("Mine.")
    expect(replaceNotes(page(`${fenced}## ${P.notes}\n\nMine.\n`), "New.")).toBe(page(`${fenced}## ${P.notes}\n\nNew.\n`))
    expect(notesOf(page(`\`\`\`\`\n## ${P.notes}\n\`\`\`\nstill inside\n\`\`\`\`\n`))).toBe("")
  })

  it("is empty on a page with no notes heading", () => {
    expect(notesOf(TOP)).toBe("")
    expect(notesOf("")).toBe("")
  })

  it("replaces only the notes, on a page with the block and the heading", () => {
    expect(replaceNotes(page(`## ${P.notes}\n\n${P.notesHint}\n`), "Clozapine after two failures.")).toBe(page(`## ${P.notes}\n\nClozapine after two failures.\n`))
  })

  it("gives back any text that was written, and keeps one notes heading over two saves", () => {
    const text = `# One\n\nText.\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n\`\`\`js\n## in a fence\n\`\`\`\n\n## ${P.notes}\n\nA line under a second heading of that name.\n\n~~~\nunclosed`
    const start = page(`## ${P.notes}\n\nOld.\n`)
    const once = replaceNotes(start, text)
    expect(once).toBe(page(`## ${P.notes}\n\n${text}\n`))
    expect(notesOf(once)).toBe(text)
    const twice = replaceNotes(once, notesOf(once))
    expect(twice).toBe(once)
    expect(replaceNotes(twice, "Short.")).toBe(page(`## ${P.notes}\n\nShort.\n`))
  })

  it("keeps one heading on a page that had none, saved twice", () => {
    const once = replaceNotes(`${TOP}Some text.\n`, "Mine.\n\n## A heading of mine\n\nMore.")
    const twice = replaceNotes(once, `${notesOf(once)}\n\nAdded.`)
    expect(twice).toBe(`${TOP}Some text.\n\n## ${P.notes}\n\nMine.\n\n## A heading of mine\n\nMore.\n\nAdded.\n`)
    expect(twice.split(`## ${P.notes}`)).toHaveLength(2)
  })

  it("keeps one heading over two saves when a fence before the notes heading is never closed", () => {
    const start = page(`\`\`\`text\nnever closed\n\n## ${P.notes}\n\nOld.\n`)
    expect(notesOf(start)).toBe("Old.")
    const once = replaceNotes(start, "One.")
    const twice = replaceNotes(once, "Two.")
    expect(twice).toBe(page(`\`\`\`text\nnever closed\n\n## ${P.notes}\n\nTwo.\n`))
    expect(twice.split(`## ${P.notes}`)).toHaveLength(2)
    // And on a page that has the open fence and no heading yet.
    const bare = replaceNotes(replaceNotes(page("~~~\nnever closed\n"), "One."), "Two.")
    expect(bare.split(`## ${P.notes}`)).toHaveLength(2)
    expect(notesOf(bare)).toBe("Two.")
  })

  it("adds the heading at the end of a page that has none", () => {
    expect(replaceNotes(`${TOP}Some text.\n\n\n`, "Mine.")).toBe(`${TOP}Some text.\n\n## ${P.notes}\n\nMine.\n`)
  })

  it("ends the file with one newline, and empties the section for no notes", () => {
    expect(replaceNotes(page(`## ${P.notes}\n\nOld.\n\n\n`), "  New.  \n\n\n")).toBe(page(`## ${P.notes}\n\nNew.\n`))
    expect(replaceNotes(page(`## ${P.notes}\n\nOld.\n`), "")).toBe(page(`## ${P.notes}\n`))
  })

})

describe("the notes section of a page with Windows line endings", () => {
  const crlf = (text: string) => text.replace(/\n/g, "\r\n")
  const FRONT_CRLF = crlf(FRONT)
  it("is found, and read with plain line endings", () => {
    expect(notesOf(crlf(page(`## ${P.notes}\n\nMine.\n\nTwo.\n`)))).toBe("Mine.\n\nTwo.")
    expect(notesOf(crlf(page(`## ${P.notes}\n\n${P.notesHint}\n`)))).toBe("")
  })
  it("is replaced with one heading, the file's line endings, and the front matter byte for byte", () => {
    const after = replaceNotes(crlf(page(`## ${P.notes}\n\nOld.\n`)), "New.\n\nTwo.")
    expect(after).toBe(crlf(page(`## ${P.notes}\n\nNew.\n\nTwo.\n`)))
    expect(after.startsWith(FRONT_CRLF)).toBe(true)
    expect(after.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/)
  })
  it("never gets a second heading, saved twice", () => {
    const once = replaceNotes(crlf(page(`## ${P.notes}\n\n${P.notesHint}\n`)), "First.")
    const twice = replaceNotes(once, `${notesOf(once)}\r\n\r\nSecond.`)
    expect(twice).toBe(crlf(page(`## ${P.notes}\n\nFirst.\n\nSecond.\n`)))
    expect(twice.split(`## ${P.notes}`)).toHaveLength(2)
  })
  it("gets the heading at the end, with its line endings, when it has none", () => {
    expect(replaceNotes(crlf(`${TOP}Some text.\n`), "Mine.")).toBe(crlf(`${TOP}Some text.\n\n## ${P.notes}\n\nMine.\n`))
  })
})

describe("the condition a page is about", () => {
  it("is the one its evidence block names", () => {
    expect(conditionCodeOf({ body: `## ${P.evidence}\n\n${conditionBlock("schizophrenia")}\n\n## ${P.notes}\n`, frontmatter: { taxonomy: "other" } })).toBe("schizophrenia")
  })
  it("is the one its block names on a page with Windows line endings", () => {
    expect(conditionCodeOf({ body: `## ${P.evidence}\r\n\r\n${conditionBlock("schizophrenia").replace(/\n/g, "\r\n")}\r\n`, frontmatter: {} })).toBe("schizophrenia")
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
