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

/**
 * Where a term is printed in a text as whole words: no letter or digit on either side, any case, a hyphen or a space
 * between its words, and a plural "s" allowed on the last one. A short abbreviation is matched in upper case only.
 */
function termSpans(term: string, text: string): Array<[number, number]> {
  const short = term.length <= ABBREVIATION_MAX
  if (short && norm(text) === norm(term)) return [[0, text.length]]
  const words = (short ? term.toUpperCase() : term).split(/[\s-]+/).filter(Boolean).map(escaped)
  if (words.length === 0) return []
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[\\s-]+")}s?(?![\\p{L}\\p{N}])`, short ? "gu" : "giu")
  return [...text.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length])
}

/**
 * Every treatment a free text names (owner decision 2026-10-08): the nodes one of whose terms is printed in it as whole
 * words, in the order of the text, each once. A term printed inside a longer term of another node is not counted
 * ("internet-delivered CBT" is guided self-help, not CBT), and a node is left out when one below it is named too
 * ("clozapine and other antipsychotics" is clozapine).
 */
export function findTreatments(taxonomy: Taxonomy, text: string): TaxonomyNode[] {
  if (!text.trim()) return []
  const spans: Array<{ node: TaxonomyNode; start: number; end: number }> = []
  for (const node of taxonomy.nodes) {
    if (node.type !== "treatment") continue
    for (const term of nodeTerms(node)) for (const [start, end] of termSpans(term, text)) spans.push({ node, start, end })
  }
  const outer = spans.filter((span) => !spans.some((other) => other.node !== span.node && other.start <= span.start && other.end >= span.end && other.end - other.start > span.end - span.start))
  const first = new Map<string, { node: TaxonomyNode; start: number }>()
  for (const span of outer) {
    const held = first.get(span.node.id)
    if (!held || span.start < held.start) first.set(span.node.id, { node: span.node, start: span.start })
  }
  const nodeOf = new Map(taxonomy.nodes.map((node) => [node.id, node]))
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
