import { CLINICAL_COPY } from "../copy"
import { CONDITION_FENCE, parseEvidenceQuery } from "./query"

// The reader's notes on a condition: one section of the condition's wiki page. Pure text; a page can use it.

const P = CLINICAL_COPY.records.conditionPage
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/
const FENCE = /^[ \t]*(```|~~~)/

/** The lines of the page, the line of the notes heading, and the line after the section (the number of lines when it runs to the end). */
function locate(markdown: string): { lines: string[]; start: number; end: number } | null {
  const lines = markdown.split("\n")
  let fenced = false
  let start = -1
  let level = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (FENCE.test(lines[index])) { fenced = !fenced; continue }
    if (fenced) continue
    const heading = HEADING.exec(lines[index])
    if (!heading) continue
    if (start === -1) {
      if (heading[2] === P.notes) { start = index; level = heading[1].length }
    } else if (heading[1].length <= level) return { lines, start, end: index }
  }
  return start === -1 ? null : { lines, start, end: lines.length }
}

/** The text under the page's notes heading, up to the next heading of the same or a higher level. The template's hint is not notes. */
export function notesOf(markdown: string): string {
  const found = locate(markdown)
  if (!found) return ""
  const text = found.lines.slice(found.start + 1, found.end).join("\n").trim()
  return text === P.notesHint ? "" : text
}

/** The page with its notes replaced and nothing else of it changed; the heading is added at the end of a page that has none. The file ends with one newline. */
export function replaceNotes(markdown: string, notes: string): string {
  const text = notes.trim()
  const found = locate(markdown)
  const section = (heading: string) => (text === "" ? heading : `${heading}\n\n${text}`)
  if (!found) {
    const before = markdown.trimEnd()
    return `${before === "" ? "" : `${before}\n\n`}${section(`## ${P.notes}`)}\n`
  }
  const before = found.lines.slice(0, found.start + 1).join("\n")
  const after = found.lines.slice(found.end).join("\n").trimEnd()
  return `${section(before)}${after === "" ? "" : `\n\n${after}`}\n`
}

/** The pack's id of the condition a condition page is about: the one its evidence block names, else the one its front matter holds; null when neither does. */
export function conditionCodeOf(page: { body: string; frontmatter: Record<string, unknown> }): string | null {
  const block = new RegExp(`^\`\`\`${CONDITION_FENCE}[ \\t]*\\n([\\s\\S]*?)^\`\`\``, "m").exec(page.body)
  const named = block ? parseEvidenceQuery(block[1]) : null
  if (named) return named.condition
  const stored = page.frontmatter.taxonomy
  return typeof stored === "string" ? parseEvidenceQuery(`condition: ${stored}`)?.condition ?? null : null
}
