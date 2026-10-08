import { findWikilinkMatches } from "../../vault/wikilinks"
import { paperHref } from "./href"

// A note's text made ready for the wiki's Markdown renderer. Pure text: a page can use it.

/** What the page knows of the papers a note cites, from what the notes route gave it. */
export interface PreviewLinks {
  /** The cited papers that are known, by slug, with the label each is shown by. */
  papers: ReadonlyMap<string, string>
  /** The slugs that resolve to nothing. */
  missing: ReadonlySet<string>
  /** The mark behind a link that resolves to nothing. */
  notFound: string
}

/** A label as the text of a Markdown link: on one line, and with no bracket that would close the link early. */
const labelText = (label: string) => label.replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s+/g, " ").trim()
/** The address of a paper's page inside a Markdown link, where a bracket would end the address. */
const address = (slug: string) => paperHref(encodeURIComponent(slug)).replace(/\(/g, "%28").replace(/\)/g, "%29")

/**
 * The body of a note with its wiki links rewritten for the preview: a cited paper that is known becomes an ordinary
 * Markdown link to the paper's page (`/paper/<slug>`), under the label of the text, else the label it is known by; one
 * that resolves to nothing becomes its text and the mark, in italics; one nothing is known about yet (typed, not
 * saved) becomes its text. Wiki links inside a code span or a fence, and everything else, are left as typed.
 */
export function previewMarkdown(body: string, { papers, missing, notFound }: PreviewLinks): string {
  let out = ""
  let at = 0
  for (const link of findWikilinkMatches(body)) {
    const label = labelText(link.alias ?? papers.get(link.slug) ?? link.slug) || link.slug
    out += body.slice(at, link.start)
    out += missing.has(link.slug) ? `${label} *(${notFound})*` : papers.has(link.slug) ? `[${label}](${address(link.slug)})` : label
    at = link.end
  }
  return out + body.slice(at)
}
