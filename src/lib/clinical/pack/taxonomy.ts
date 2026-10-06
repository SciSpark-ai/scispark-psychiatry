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
