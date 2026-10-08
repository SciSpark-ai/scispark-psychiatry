import type { NoteReference } from "./links"

// What the note page does to a note's text: putting a link where the caret is, and the text that is copied out. Pure.

/** Where a link goes when the reader has not put the caret anywhere: after the last text. */
export const endOfText = (text: string) => text.trimEnd().length

/**
 * `text` with `link` in place of what is between `start` and `end` (nothing, for a caret), and where the caret is
 * after it. A space is put between the link and a word it would otherwise touch.
 */
export function insertLink(text: string, link: string, start: number, end: number = start): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, end, text.length))
  const to = Math.min(text.length, Math.max(start, end, 0))
  const before = text.slice(0, from)
  const after = text.slice(to)
  const lead = before !== "" && !/[\s(]$/.test(before) ? " " : ""
  const trail = after !== "" && !/^[\s.,;:!?)]/.test(after) ? " " : ""
  const placed = `${before}${lead}${link}${trail}`
  return { text: `${placed}${after}`, caret: placed.length }
}

const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g
/** A link to a view of this app: an address that means nothing outside it. */
const APP_LINK_RE = /(?<!!)\[([^\]\n]*)\]\(\s*\/wiki\?[^)\s]*\s*\)/g

/** A note's text as it reads outside the app: each link to a paper, a condition or a treatment as its label. */
export function withoutLinks(body: string): string {
  return body.replace(WIKI_LINK_RE, (_whole, slug: string, alias?: string) => alias?.trim() || slug.trim()).replace(APP_LINK_RE, "$1")
}

/** What "Copy with references" copies: the title as a heading, the text with its links as labels, and the numbered references. */
export function copyText(title: string, body: string, references: NoteReference[], heading: string): string {
  const list = references.map((reference, index) => `${index + 1}. ${reference.text}`).join("\n")
  return `${[`# ${title}`, withoutLinks(body).trim(), list ? `${heading}\n\n${list}` : ""].filter(Boolean).join("\n\n")}\n`
}
