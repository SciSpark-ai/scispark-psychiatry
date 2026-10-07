/**
 * A structured abstract as its sections, for the paper page. PubMed prints each section on its own
 * line with a label in capitals ("METHODS: ..."); here the label becomes ordinary words ("Methods")
 * and the text stands on its own. An abstract without such labels is one section with no label.
 */
export interface AbstractSection { label?: string; text: string }

/** A line that starts a section: a short label in capitals, a colon, then the text. */
const LABELLED = /^([A-Z][A-Z0-9 ,/&'()-]{2,48}):\s*(.*)$/

const readable = (label: string) => {
  const lower = label.toLowerCase().replace(/\s+/g, " ").trim()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function abstractSections(abstract: string | undefined): AbstractSection[] {
  const lines = (abstract ?? "").split("\n").map((line) => line.trim()).filter(Boolean)
  const sections: AbstractSection[] = []
  for (const line of lines) {
    const match = LABELLED.exec(line)
    if (match) sections.push({ label: readable(match[1]), text: match[2].trim() })
    else if (sections.length > 0) sections[sections.length - 1].text = `${sections[sections.length - 1].text} ${line}`.trim()
    else sections.push({ text: line })
  }
  // PubMed sometimes splits "BACKGROUND AND OBJECTIVE" into "BACKGROUND: AND" and "OBJECTIVE: ...".
  const joined: AbstractSection[] = []
  for (const section of sections) {
    const previous = joined.at(-1)
    if (previous?.label && section.label && /^(?:and|&)$/i.test(previous.text)) {
      joined[joined.length - 1] = { label: `${previous.label} and ${section.label.toLowerCase()}`, text: section.text }
    } else joined.push(section)
  }
  return joined.filter((section) => section.text.length > 0 || section.label)
}
