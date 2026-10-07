import type { Journal } from "../pack/schema"
import { normaliseJournalName } from "../score/score"

/**
 * A journal's name as it should be read. PubMed prints titles in its own catalogue style
 * ("The lancet. Psychiatry", "BMJ (Clinical research ed.)", "X : official journal of Y"). A journal
 * the pack knows gets the pack's name; any other is tidied: the subtitle and the place in brackets
 * go, and the words are capitalised the usual way.
 */

const SMALL = new Set(["of", "and", "in", "the", "for", "on", "to", "a", "an", "de", "la", "et", "und", "der", "du", "des"])

function titleCase(name: string): string {
  return name.split(" ").map((word, index) => {
    if (!word) return word
    // A word that already carries capitals (JAMA, NeuroImage, BMC) is left as it is.
    if (/[A-Z]/.test(word.slice(1))) return word
    const lower = word.toLowerCase()
    if (index > 0 && SMALL.has(lower)) return lower
    const first = word.search(/[a-zA-Z\u00c0-\u024f]/)
    return first < 0 ? word : word.slice(0, first) + word.charAt(first).toUpperCase() + word.slice(first + 1)
  }).join(" ")
}

export function displayVenue(venue: string | undefined, journals: Journal[]): string | undefined {
  if (!venue) return undefined
  const wanted = normaliseJournalName(venue)
  const known = journals.find((journal) => normaliseJournalName(journal.name) === wanted)
  if (known) return known.name
  let name = venue.replace(/\s*\([^)]*\)/g, "").split(/\s[:=]\s/)[0].trim()
  // "A. B": a short second part is a section of the journal; a long one is the title in another language.
  const dot = name.indexOf(". ")
  if (dot > 0) {
    const rest = name.slice(dot + 2).trim()
    name = rest.split(/\s+/).length <= 2 && rest ? `${name.slice(0, dot)}: ${rest}` : name.slice(0, dot)
  }
  const again = journals.find((journal) => normaliseJournalName(journal.name) === normaliseJournalName(name))
  return again ? again.name : titleCase(name.replace(/\s+/g, " "))
}
