import { CLINICAL_COPY } from "../copy"
import { CONDITION_FENCE, parseEvidenceQuery } from "./query"

// The reader's notes on a condition: one section of the condition's wiki page. Pure text; a page can use it.

const P = CLINICAL_COPY.records.conditionPage
/** An ATX heading, with or without closing hashes. */
const HEADING = /^#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/**
 * One pass over the page for the notes heading: where its line ends (before its line break), or null, and whether the
 * pass ended inside a fence that was never closed. Without `fences` every line is read as text.
 */
function scan(markdown: string, fences: boolean): { end: number | null; unclosed: boolean } {
  let fence: string | null = null
  let offset = 0
  for (const raw of markdown.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
    const marker = fences ? FENCE.exec(line) : null
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === "") fence = null
    } else if (marker) fence = marker[1]
    else if (HEADING.exec(line)?.[1] === P.notes) return { end: offset + line.length, unclosed: false }
    offset += raw.length + 1
  }
  return { end: null, unclosed: fence !== null }
}

/**
 * Where the notes heading's line ends (before its line break), or null when the page has none. It is the first
 * heading of that name outside a fenced block; a fence is closed only by its own marker, at least as long.
 * A fence that is never closed would hide every heading after it, and each save would add one more: the page is
 * then read again with no fences, and the first heading of that name anywhere is taken.
 * Line endings may be Windows ones.
 */
function headingEnd(markdown: string): number | null {
  const fenced = scan(markdown, true)
  return fenced.end === null && fenced.unclosed ? scan(markdown, false).end : fenced.end
}

const plain = (text: string) => text.replace(/\r\n/g, "\n")

/**
 * The reader's notes: the text from the page's notes heading to the end of the file, with plain line endings.
 * The notes heading is the last section the template writes, so whatever follows it is the reader's, headings
 * included. The template's hint is not notes.
 */
export function notesOf(markdown: string): string {
  const end = headingEnd(markdown)
  if (end === null) return ""
  const text = plain(markdown.slice(end)).trim()
  return text === P.notesHint ? "" : text
}

/**
 * The page with its notes replaced and everything up to the notes heading as it was, byte for byte; the heading is
 * added at the end of a page that has none. The file keeps its own line endings and ends with one.
 * `notesOf(replaceNotes(page, text))` is `text`, trimmed, whatever it holds.
 */
export function replaceNotes(markdown: string, notes: string): string {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n"
  const text = plain(notes).trim().replace(/\n/g, eol)
  const section = (heading: string) => (text === "" ? `${heading}${eol}` : `${heading}${eol}${eol}${text}${eol}`)
  const end = headingEnd(markdown)
  if (end !== null) return section(markdown.slice(0, end))
  const before = markdown.trimEnd()
  return `${before === "" ? "" : `${before}${eol}${eol}`}${section(`## ${P.notes}`)}`
}

/** The pack's id of the condition a condition page is about: the one its evidence block names, else the one its front matter holds; null when neither does. */
export function conditionCodeOf(page: { body: string; frontmatter: Record<string, unknown> }): string | null {
  const block = new RegExp(`^\`\`\`${CONDITION_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)^\`\`\``, "m").exec(page.body)
  const named = block ? parseEvidenceQuery(block[1]) : null
  if (named) return named.condition
  const stored = page.frontmatter.taxonomy
  return typeof stored === "string" ? parseEvidenceQuery(`condition: ${stored}`)?.condition ?? null : null
}
