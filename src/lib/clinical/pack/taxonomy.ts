import type { Taxonomy, TaxonomyNode } from "./schema"

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()

/** All strings that name a node: canonical name, synonyms, generic and brand names. */
export function nodeTerms(node: TaxonomyNode): string[] {
  return [...new Set([node.name, ...node.synonyms, ...node.brands].map((term) => term.trim()).filter(Boolean))]
}

/** Finds the node a free-text label refers to (exact match on any of its terms), or null. */
export function findNode(taxonomy: Taxonomy, label: string, type?: TaxonomyNode["type"]): TaxonomyNode | null {
  const wanted = norm(label)
  for (const node of taxonomy.nodes) {
    if (type && node.type !== type) continue
    if (nodeTerms(node).some((term) => norm(term) === wanted)) return node
  }
  return null
}

/** A term this short ("ACT", "ECT", "BA") is also an English word or part of one: it is found only in upper case, or when the text is nothing else. */
const ABBREVIATION_MAX = 3
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

interface TermMatcher { node: TaxonomyNode; pattern: RegExp; /** The whole text a short abbreviation also matches, in any case. */ alone: string | null }
interface TreatmentIndex { matchers: TermMatcher[]; nodeOf: Map<string, TaxonomyNode>; found: Map<string, TaxonomyNode[]> }
/** The matchers of a taxonomy and what they found, kept while the taxonomy object lives: a page is built many times from one pack. */
const INDEXES = new WeakMap<Taxonomy, TreatmentIndex>()
/** The texts remembered per taxonomy before the memory is emptied: the names are few, but nothing may grow without end. */
const FOUND_MAX = 5000
/** For the tests: how many matchers were compiled and how many texts were searched (not answered from memory). */
export const treatmentMatcherStats = { compiled: 0, searched: 0 }

/**
 * A term as a pattern of whole words: no letter or digit on either side, any case, a hyphen or a space between its
 * words, and a plural "s" allowed on the last one. A short abbreviation is matched in upper case only.
 */
function matcherOf(node: TaxonomyNode, term: string): TermMatcher | null {
  const short = term.length <= ABBREVIATION_MAX
  const words = (short ? term.toUpperCase() : term).split(/[\s-]+/).filter(Boolean).map(escaped)
  if (words.length === 0) return null
  treatmentMatcherStats.compiled += 1
  return { node, alone: short ? norm(term) : null, pattern: new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[\\s-]+")}s?(?![\\p{L}\\p{N}])`, short ? "gu" : "giu") }
}

function indexOf(taxonomy: Taxonomy): TreatmentIndex {
  let index = INDEXES.get(taxonomy)
  if (!index) {
    const matchers = taxonomy.nodes.filter((node) => node.type === "treatment").flatMap((node) => nodeTerms(node).flatMap((term) => matcherOf(node, term) ?? []))
    index = { matchers, nodeOf: new Map(taxonomy.nodes.map((node) => [node.id, node])), found: new Map() }
    INDEXES.set(taxonomy, index)
  }
  return index
}

/**
 * Every treatment a free text names (owner decision 2026-10-08): the nodes one of whose terms is printed in it as whole
 * words, in the order of the text, each once. A term printed inside a longer term of another node is not counted
 * ("internet-delivered CBT" is guided self-help, not CBT), and a node is left out when one below it is named too
 * ("clozapine and other antipsychotics" is clozapine). The patterns are compiled once per taxonomy object and the
 * answer for a text is remembered with it; the taxonomy must not be changed after its first use here.
 */
export function findTreatments(taxonomy: Taxonomy, text: string): TaxonomyNode[] {
  if (!text.trim()) return []
  const index = indexOf(taxonomy)
  const held = index.found.get(text)
  if (held) return [...held]
  const found = search(index, text)
  if (index.found.size >= FOUND_MAX) index.found.clear()
  index.found.set(text, found)
  return [...found]
}

function search({ matchers, nodeOf }: TreatmentIndex, text: string): TaxonomyNode[] {
  treatmentMatcherStats.searched += 1
  const whole = norm(text)
  const spans: Array<{ node: TaxonomyNode; start: number; end: number }> = []
  for (const { node, pattern, alone } of matchers) {
    if (alone !== null && alone === whole) { spans.push({ node, start: 0, end: text.length }); continue }
    // matchAll works on a copy of the pattern, so the shared one keeps no position.
    for (const match of text.matchAll(pattern)) spans.push({ node, start: match.index, end: match.index + match[0].length })
  }
  const outer = spans.filter((span) => !spans.some((other) => other.node !== span.node && other.start <= span.start && other.end >= span.end && other.end - other.start > span.end - span.start))
  const first = new Map<string, { node: TaxonomyNode; start: number }>()
  for (const span of outer) {
    const held = first.get(span.node.id)
    if (!held || span.start < held.start) first.set(span.node.id, { node: span.node, start: span.start })
  }
  const ancestors = new Set<string>()
  for (const { node } of first.values()) {
    const queue = [...node.parents]
    const seen = new Set<string>([node.id])
    while (queue.length > 0) {
      const id = queue.shift() as string
      if (seen.has(id)) continue
      seen.add(id)
      ancestors.add(id)
      queue.push(...(nodeOf.get(id)?.parents ?? []))
    }
  }
  return [...first.values()].filter((entry) => !ancestors.has(entry.node.id)).sort((a, b) => a.start - b.start).map((entry) => entry.node)
}

/** A negation among the three words before a term, with no comma and no "or" or "and" between: "no ketamine", "without add-on lithium", "neither olanzapine nor lithium". */
const RULED_OUT_BEFORE = /(?<![\p{L}\p{N}])(?:no|non|not|without|absence of|neither|nor)[\s-]+(?:(?!(?:or|and)\s)[\p{L}\p{N}'-]+\s+){0,2}$/iu
/** What says after a term that it was not given: "antipsychotic-naive", "lithium naive", "lithium-free". */
const RULED_OUT_AFTER = /^(?:[\s-]*na[iï]ve|-free)(?![\p{L}\p{N}])/iu

/**
 * The pack treatments a comparator's text names as given to that arm. A treatment the text rules out is not one
 * (owner decision 2026-10-09): "placebo or no ketamine-class agent" names ketamine and gave none. A treatment named
 * once plainly and once ruled out was given.
 */
function comparatorTreatments(taxonomy: Taxonomy, text: string): string[] {
  const { matchers } = indexOf(taxonomy)
  const whole = norm(text)
  return findTreatments(taxonomy, text).filter((node) => {
    // The whole text as one short abbreviation has nothing before or after it.
    const mine = matchers.filter((matcher) => matcher.node === node)
    if (mine.some((matcher) => matcher.alone !== null && matcher.alone === whole)) return true
    const spans = mine.flatMap((matcher) => [...text.matchAll(matcher.pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length })))
    return spans.some((span) => !RULED_OUT_BEFORE.test(text.slice(0, span.start)) && !RULED_OUT_AFTER.test(text.slice(span.end)))
  }).map((node) => node.id)
}

/**
 * The two arms of a finding (owner decision 2026-10-09): the pack treatments its result is about, and the pack treatments
 * it was compared with, each as ids in the order of its text. A treatment named in both texts is a comparator only: an
 * answer that lists both arms as the treatment ("clozapine and olanzapine" against "olanzapine") is about the first.
 * A comparison that is not with a pack treatment (placebo, sham, usual care, a waiting list) gives no comparator, nor
 * does a treatment the comparator rules out ("no ketamine-class agent", "without lithium", "antipsychotic-naive"). When
 * every treatment named is also named as the comparator the answer cannot be read: the treatments stand as they were
 * given, so the paper is not lost, and only the comparators that are not among them are kept ("low-dose olanzapine"
 * against "standard-dose olanzapine or haloperidol" is olanzapine compared with haloperidol).
 */
export function armsOf(taxonomy: Taxonomy, treatment: string | null | undefined, comparator: string | null | undefined): { treatments: string[]; comparators: string[] } {
  const named = treatment ? findTreatments(taxonomy, treatment).map((node) => node.id) : []
  const against = comparator ? comparatorTreatments(taxonomy, comparator) : []
  const tested = named.filter((id) => !against.includes(id))
  if (named.length > 0 && tested.length === 0) return { treatments: named, comparators: against.filter((id) => !named.includes(id)) }
  return { treatments: tested, comparators: against }
}

/** The node and every node below it (tracking a condition includes its subtypes). */
export function withDescendants(taxonomy: Taxonomy, id: string): TaxonomyNode[] {
  const byParent = new Map<string, TaxonomyNode[]>()
  for (const node of taxonomy.nodes) {
    for (const parent of node.parents) byParent.set(parent, [...(byParent.get(parent) ?? []), node])
  }
  const root = taxonomy.nodes.find((node) => node.id === id)
  if (!root) return []
  const seen = new Set<string>([root.id])
  const out: TaxonomyNode[] = [root]
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift() as TaxonomyNode
    for (const child of byParent.get(current.id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      queue.push(child)
    }
  }
  return out
}
