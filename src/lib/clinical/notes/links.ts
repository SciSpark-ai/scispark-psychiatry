// src/lib/clinical/notes/links.ts
import { findWikilinkMatches } from "../../vault/wikilinks"
import { evidenceHref } from "../evidence/href"
import { CLINICAL_COPY } from "../copy"

// What a note is about is read from the links in its body; nothing else records it. Pure text: this
// file, and the types of a note, can be used by a page as well as by the server.

/** What a note's body links: paper slugs, condition codes, and treatments of a condition. Each once, in the order of the text. */
export interface NoteLinks { papers: string[]; conditions: string[]; treatments: Array<{ condition: string; treatment: string }> }
export type NoteKind = "paper" | "topic" | "none"
export const NOTE_KINDS: readonly NoteKind[] = ["paper", "topic", "none"]

export interface NoteSummary {
  /** The file's name under the notes directory, without `.md`. */
  id: string
  title: string
  excerpt: string
  /** The days (YYYY-MM-DD) of the frontmatter. */
  updated: string
  created: string
  links: NoteLinks
  kind: NoteKind
  /** The linked conditions, those of the linked treatments, and those the findings store gives for the cited papers. */
  conditions: Array<{ code: string; name: string }>
  papers: Array<{ slug: string; label: string }>
  treatments: Array<{ condition: string; key: string; name: string }>
  /** Papers listed since the last edit on what the note links, that it does not cite. */
  newSince: number
  /** True for a note that belongs to a project. */
  project: boolean
}
export interface NewPaper { slug: string; label: string; headline: string; condition: string; firstListed: string }
export interface NoteDetail { summary: NoteSummary; body: string; revision: string }
export interface NoteAbout { paper?: string; condition?: string; treatment?: { condition: string; key: string } }
export interface NoteSaved { revision: string; unresolved: string[] }
export interface NoteConflict { conflict: true; title: string; body: string; revision: string }
export interface CitablePaper { slug: string; label: string; title: string; venue: string | null; year: number | null; saved: boolean }
export interface NoteReference { slug: string; text: string }

/** The title the Library's "New note" button writes. A note that still has it is read as having no title. */
export const UNTITLED_STORED = "Untitled note"

/** A pack id, as the links carry it. */
export const CODE_RE = /^[a-z0-9][a-z0-9-]*$/

// The same spans the wiki-link reader leaves out: a fence, closed or not, and an inline code span.
const FENCE_RE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE_RE = /`[^`\n]*`/g
const withoutCode = (body: string) => body.replace(FENCE_RE, (span) => " ".repeat(span.length)).replace(INLINE_CODE_RE, (span) => " ".repeat(span.length))
/** An ordinary link to the Evidence view. Not an image, and not a link to another site. */
const EVIDENCE_LINK_RE = /(?<!!)\[([^\]\n]*)\]\(\s*\/wiki\?([^)\s]*)\s*\)/g

export function noteLinks(body: string): NoteLinks {
  const links: NoteLinks = { papers: [], conditions: [], treatments: [] }
  for (const { slug } of findWikilinkMatches(body)) if (!links.papers.includes(slug)) links.papers.push(slug)
  for (const match of withoutCode(body).matchAll(EVIDENCE_LINK_RE)) {
    // What follows a `#` is a place on the page, not a parameter.
    const query = new URLSearchParams(match[2].split("#")[0])
    const condition = query.get("condition")
    if (!condition || !CODE_RE.test(condition)) continue
    if (!links.conditions.includes(condition)) links.conditions.push(condition)
    const treatment = query.get("treatment")
    if (!treatment || !CODE_RE.test(treatment)) continue
    if (!links.treatments.some((entry) => entry.condition === condition && entry.treatment === treatment)) links.treatments.push({ condition, treatment })
  }
  return links
}

/** One paper and nothing else is a note on a paper; a condition, a treatment or several papers make a note on a topic. */
export function noteKind(links: NoteLinks): NoteKind {
  if (links.conditions.length > 0 || links.treatments.length > 0 || links.papers.length >= 2) return "topic"
  return links.papers.length === 1 ? "paper" : "none"
}

/** `text` when it fits in `max` characters, else its start with an ellipsis, `max` characters in all. */
export function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

const HEADING_RE = /^\s{0,3}#{1,6}(?:\s|$)/
/** A line as plain text: links as their labels, no quote or list mark, no emphasis marks. */
function plain(line: string): string {
  return line
    .replace(/^\s*(?:>\s?)+/, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_whole, slug: string, alias?: string) => alias?.trim() || slug.trim())
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** A note's text as it is read, line by line: links as their labels, with no address, and no heading, quote or list marks. */
export function plainText(body: string): string {
  return body.split("\n").map((line) => plain(line.replace(/^\s{0,3}#{1,6}\s*/, ""))).filter(Boolean).join("\n")
}

/** The first text of a note that is not a heading, on one line, links shown as their labels. */
export function excerptOf(body: string, max = 160): string {
  const lines = body.split("\n").filter((line) => !HEADING_RE.test(line) && !/^\s*```/.test(line)).map(plain).filter(Boolean)
  return cut(lines.join(" "), max)
}

/** The title to show: the frontmatter's, else the first line of the body, else the wording for a note without one. */
export function titleOf(frontmatterTitle: string | null | undefined, body: string): string {
  const stored = (frontmatterTitle ?? "").trim()
  if (stored && stored !== UNTITLED_STORED) return stored
  const first = body.split("\n").map((line) => plain(line.replace(/^\s{0,3}#{1,6}\s*/, ""))).find(Boolean)
  return first ? cut(first, 80) : CLINICAL_COPY.notes.untitled
}

/**
 * How a paper is named in a note: the first author's family name and the year ("Lamsma 2026"), by the rule the
 * evidence tables use (the last word of the name, or what stands before its comma); the title, cut, when no author is known.
 */
export function paperLabel(paper: { title: string; authors: string[]; year?: number | string | null; date?: string | null }): string {
  const name = paper.authors[0]?.trim() ?? ""
  const family = name.includes(",") ? name.split(",")[0].trim() : (name.split(/\s+/).at(-1) ?? "")
  const year = paper.date && /^\d{4}/.test(paper.date) ? paper.date.slice(0, 4) : paper.year ? String(paper.year) : ""
  return family ? [family, year].filter(Boolean).join(" ") : cut(paper.title.replace(/\s+/g, " ").trim(), 60)
}

/** A label that cannot end its link early. */
const labelText = (label: string) => label.replace(/[[\]|\n]/g, " ").replace(/\s+/g, " ").trim()
/** The three links this edition writes into a note. */
export const paperLink = (slug: string, label: string) => (labelText(label) ? `[[${slug}|${labelText(label)}]]` : `[[${slug}]]`)
export const conditionLink = (code: string, name: string) => `[${labelText(name) || code}](${evidenceHref({ condition: code })})`
export const treatmentLink = (condition: string, key: string, name: string) => `[${labelText(name) || key}](${evidenceHref({ condition, treatment: key })})`

/** One reference: `Authors (the first three, then "et al."). Title. Journal. Year. doi:…`. What is not known is left out. */
export function referenceLine(paper: { title: string; authors: string[]; venue?: string | null; year?: number | string | null; doi?: string | null }): string {
  const names = paper.authors.map((name) => name.trim()).filter(Boolean)
  const authors = names.length > 3 ? `${names.slice(0, 3).join(", ")}, et al` : names.join(", ")
  const sentence = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`)
  const parts = [authors, paper.title.replace(/\s+/g, " ").trim(), paper.venue?.trim() ?? "", paper.year ? String(paper.year) : ""].filter(Boolean)
  // A title alone stands as it is written.
  const text = parts.length === 1 && !paper.doi ? parts[0] : parts.map(sentence).join(" ")
  return paper.doi ? `${text} doi:${paper.doi}`.trim() : text
}

/**
 * A short stable hash of a note file's text, as lower-case hex: what a save must name to show it began from the stored
 * text. Not a secret and not for security; plain arithmetic, so the browser can compute it too.
 */
export function revisionOf(text: string): string {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 2654435761)
    b = Math.imul(b ^ code, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0")
  return `${hex(b)}${hex(a)}${text.length.toString(16)}`
}
export const REVISION_RE = /^[a-f0-9]{17,40}$/
