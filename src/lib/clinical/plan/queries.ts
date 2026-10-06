import type { WatchEntry } from "../types"
import type { Journal, SpecialtyPack, TaxonomyNode } from "../pack/schema"
import { findNode, nodeTerms, withDescendants } from "../pack/taxonomy"

export interface PlannedQuery {
  /** Full PubMed query text, window included. */
  query: string
  /** The watch entry this query serves; null for journal enumeration. */
  entryId: string | null
  tier: "A" | "B" | "entry"
  rationale: string
}

export interface DateWindow {
  from: Date
  to: Date
}

/** Short acronyms that are ordinary English words or collide across fields; never used as text words. */
const AMBIGUOUS_TERMS = new Set(["act", "ba", "pe", "tbs", "mst", "gad", "asd", "ipt"])

const JOURNALS_PER_QUERY = 15

const quote = (term: string) => `"${term.replaceAll('"', "").trim()}"`
const pubmedDate = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "/")

/** `edat` is the date a record entered PubMed, which is what "new" means for enumeration. */
export function windowClause(window: DateWindow): string {
  return `(${quote(pubmedDate(window.from))}[edat] : ${quote(pubmedDate(window.to))}[edat])`
}

export interface Facet {
  label: string
  mesh: string[]
  words: string[]
}

/** Resolves a watch-entry label through the taxonomy, rolling up to subtypes. Unknown labels stay as plain text. */
export function resolveFacet(pack: SpecialtyPack, label: string, type: TaxonomyNode["type"]): Facet {
  const node = findNode(pack.taxonomy, label, type)
  if (!node) return { label, mesh: [], words: [label] }
  const nodes = withDescendants(pack.taxonomy, node.id)
  const mesh = [...new Set(nodes.flatMap((n) => (n.meshHeading ? [n.meshHeading] : [])))]
  const words = [...new Set(nodes.flatMap(nodeTerms))].filter((term) => !AMBIGUOUS_TERMS.has(term.toLowerCase()))
  return { label, mesh, words }
}

export function facetClause(facet: Facet): string {
  const parts = [
    ...facet.mesh.map((heading) => `${quote(heading)}[MeSH Terms]`),
    ...facet.words.map((word) => `${quote(word)}[Title/Abstract]`),
  ]
  return `(${parts.join(" OR ")})`
}

/**
 * Psychiatric text words as a PubMed clause, for tier B journals whose full output is far too large
 * to enumerate. Truncation (`*`) is applied to single words only.
 */
export function domainClause(pack: SpecialtyPack): string {
  const words = pack.textWords.flatMap((word) => {
    if (!word.includes(" ")) return [`${word.replaceAll('"', "")}[Title/Abstract]`]
    // PubMed does not truncate inside a quoted phrase, so a phrase ending in `*` becomes singular and plural.
    const base = word.replace(/\*$/, "")
    return (base === word ? [base] : [base, `${base}s`]).map((phrase) => `${quote(phrase)}[Title/Abstract]`)
  })
  return `(${[`"Mental Disorders"[MeSH Terms]`, `"Psychiatry"[MeSH Terms]`, ...words].join(" OR ")})`
}

/**
 * Design hint pushed into the query so that enumeration returns a manageable pool. It uses
 * publication types and the same words as the code gate, because recent records may not yet
 * carry publication types. The code gate still runs on everything returned.
 */
export const DESIGN_HINT =
  `("Randomized Controlled Trial"[pt] OR "Meta-Analysis"[pt] OR "Systematic Review"[pt] OR "Practice Guideline"[pt] OR "Guideline"[pt] ` +
  `OR "Observational Study"[pt] OR "Clinical Trial"[pt] OR randomized[Title/Abstract] OR randomised[Title/Abstract] ` +
  `OR "meta-analysis"[Title/Abstract] OR "systematic review"[Title/Abstract] OR guideline[Title/Abstract] OR cohort[Title/Abstract] ` +
  `OR trial[Title/Abstract])`

function journalIdentifier(journal: Journal): string {
  return (journal.issn ?? journal.eissn) as string
}

/** Batched, window-scoped enumeration queries for a journal tier. Muted journals are excluded. */
export function journalQueries(pack: SpecialtyPack, tier: "A" | "B", window: DateWindow): PlannedQuery[] {
  const journals = pack.journals.filter((journal) => journal.tier === tier && journal.state !== "muted")
  const queries: PlannedQuery[] = []
  for (let i = 0; i < journals.length; i += JOURNALS_PER_QUERY) {
    const batch = journals.slice(i, i + JOURNALS_PER_QUERY)
    const scope = `(${batch.map((journal) => `${quote(journalIdentifier(journal))}[Journal]`).join(" OR ")})`
    const clauses = [scope, windowClause(window), ...(tier === "B" ? [domainClause(pack)] : []), DESIGN_HINT]
    queries.push({
      query: clauses.join(" AND "),
      entryId: null,
      tier,
      rationale: `tier ${tier} journals ${i + 1}-${i + batch.length}`,
    })
  }
  return queries
}

/** One deterministic recall-first query per active watch entry: its filled facets ANDed, plus window and design hint. */
export function entryQuery(pack: SpecialtyPack, entry: WatchEntry, window: DateWindow): PlannedQuery | null {
  if (entry.priority === "paused") return null
  const clauses: string[] = []
  if (entry.condition) clauses.push(facetClause(resolveFacet(pack, entry.condition, "condition")))
  if (entry.treatment) clauses.push(facetClause(resolveFacet(pack, entry.treatment, "treatment")))
  if (clauses.length === 0) return null
  return {
    query: [...clauses, windowClause(window), DESIGN_HINT].join(" AND "),
    entryId: entry.id,
    tier: "entry",
    rationale: [entry.condition, entry.treatment].filter(Boolean).join(" × "),
  }
}

/** The whole deterministic plan: every active entry, then both journal tiers. */
export function deterministicPlan(pack: SpecialtyPack, entries: WatchEntry[], window: DateWindow): PlannedQuery[] {
  const entryQueries = entries.flatMap((entry) => entryQuery(pack, entry, window) ?? [])
  return [...entryQueries, ...journalQueries(pack, "A", window), ...journalQueries(pack, "B", window)]
}

/** Light validity check for model-written PubMed syntax: non-empty, bounded, balanced brackets and quotes. */
export function isPlausiblePubmedQuery(query: string): boolean {
  if (query.trim().length === 0 || query.length > 1500) return false
  let depth = 0
  for (const char of query) {
    if (char === "(") depth += 1
    if (char === ")") depth -= 1
    if (depth < 0) return false
  }
  const quotes = [...query].filter((char) => char === '"').length
  const squares = [...query].filter((char) => char === "[").length - [...query].filter((char) => char === "]").length
  return depth === 0 && quotes % 2 === 0 && squares === 0
}
