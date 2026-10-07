/**
 * Source-agnostic cleaning of titles and abstracts. A TypeScript port of the 11 rules in the v1
 * pipeline (`recsys_v1/scripts/data_pipeline/_lib/text_cleaner.py`), applied when a candidate is
 * created so that grading and quote verification see exactly the same text.
 *
 * One difference from v1: HTML entities are decoded with a small built-in table plus numeric
 * references, not Python's full `html.unescape`. Unusual named entities pass through unchanged.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  minus: "−", plusmn: "±", times: "×", deg: "°", micro: "µ", alpha: "α",
  beta: "β", gamma: "γ", delta: "δ", ge: "≥", le: "≤",
}

export function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

const stripHtml = (text: string) => unescapeHtml(text).replace(/<[^>]+>/g, "")
const DASHES = /[‐-―−─]/g
const EXOTIC_SPACE = /[     　]/g

const LABELS = [
  "Background", "Objective", "Method", "Result", "Conclusion", "Introduction", "Discussion", "Purpose", "Aim",
  "Summary", "Significance", "Limitation", "Importance", "Design", "Setting", "Participant", "Intervention",
  "Outcome", "Finding", "Rationale", "Hypothesis", "Context", "Approach",
]
// The non-capturing group makes the optional plural "s" apply to whichever label matched.
const LABEL = `(?:${LABELS.join("|")})s?`

const LABEL_NO_SEPARATOR = new RegExp(`\\b(${LABEL})(?=[A-Z])`, "g")
const LABEL_SPACE_NO_COLON = new RegExp(`(?:^|(?<=\\. )|(?<=\\n))(${LABEL}) (?=[A-Z])`, "gmi")
const LABEL_MID_PARAGRAPH = new RegExp(`([^\\n]) (${LABEL})(?=:[ \\t])`, "gi")

/** A label of two or more words in capitals ("STUDY DESIGN:", "BACKGROUND AND HYPOTHESIS:"), at the start or after a sentence. */
const CAPITALS_LABEL = /(^|[.!?][ \t]+|\n)([A-Z]{2,}(?:[ \t]+(?:[A-Z]{2,}|&))+)(?=:[ \t])/g
const HELD = "\u0001"

function fixSectionLabels(text: string): string {
  // The rules below know single words; a label of several words in capitals is held together while they run,
  // or they would break it in two ("STUDY" / "DESIGN:").
  const held = text.replace(CAPITALS_LABEL, (_match, before: string, label: string) => `${before === "" || before === "\n" ? before : `${before.trimEnd()}\n`}${label.replace(/[ \t]+/g, HELD)}`)
  return held
    .replace(LABEL_NO_SEPARATOR, "$1: ")
    .replace(LABEL_SPACE_NO_COLON, "$1: ")
    .replace(LABEL_MID_PARAGRAPH, "$1\n$2")
    .replaceAll(HELD, " ")
}

function normaliseWhitespace(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.split(/\s+/).filter(Boolean).join(" "))
    .filter((line) => line.length > 0)
    .join("\n")
}

export function cleanTitle(title: string | undefined): string | undefined {
  if (!title) return title
  let text = stripHtml(title).replace(EXOTIC_SPACE, " ").replace(DASHES, "-")
  text = text.replace(/^\d+[.)]\s+/, "")
  text = text.trimEnd().replace(/(?<!\.)\.[ \t]*$/, "")
  text = text.split(/\s+/).filter(Boolean).join(" ")
  return text.length > 0 ? text : undefined
}

export function cleanAbstract(abstract: string | undefined): string | undefined {
  if (!abstract) return abstract
  let text = stripHtml(abstract).replace(EXOTIC_SPACE, " ").replace(DASHES, "-")
  text = text.replace(/^Abstract[:.]?\s*/i, "")
  text = fixSectionLabels(text)
  text = normaliseWhitespace(text)
  return text.length > 0 ? text : undefined
}

export const MIN_TITLE_LENGTH = 10
export const MIN_ABSTRACT_LENGTH = 100
const ABSTRACT_STUB =
  /^\[?(no abstract(?: available)?|n\/?a|not available|abstract not available|no abstract provided|none)\]?\.?$/i

/**
 * Soft quality flags for a cleaned record. Flags are stored on the candidate and never gate it,
 * with one addition to v1: a record without an abstract is kept and flagged `title-only`.
 */
export function qualityFlags(record: { title?: string; abstract?: string }): string[] {
  const flags: string[] = []
  const title = record.title ?? ""
  const abstract = record.abstract ?? ""
  if (title && title.length < MIN_TITLE_LENGTH) flags.push("title_too_short")
  if (/<[^>]+>/.test(title)) flags.push("title_html_remaining")
  if (!abstract) flags.push("title-only")
  if (abstract && abstract.length < MIN_ABSTRACT_LENGTH) flags.push("abstract_too_short")
  if (/<[^>]+>/.test(abstract)) flags.push("abstract_html_remaining")
  if (abstract && ABSTRACT_STUB.test(abstract.trim())) flags.push("abstract_stub")
  return flags
}
