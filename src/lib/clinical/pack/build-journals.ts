// Pure and import-free on purpose: scripts/build-journal-list.mjs runs this file directly with Node's
// built-in TypeScript support, so it may use only syntax that can be erased (no enums, no parameter properties).

export interface OpenAlexSourceRow {
  id: string
  display_name: string
  issn_l?: string | null
  issn?: string[] | null
}

export interface TierAJournal {
  name: string
  issn: string
  eissn?: string
  openalexSourceId: string
  tier: "A"
  state: "normal"
}

const ISSN = /^\d{4}-\d{3}[\dX]$/

/**
 * Turns v1's `{journal name: OpenAlex source id}` map plus OpenAlex's rows for those ids into pack
 * journals. A source with no valid ISSN cannot be used to enumerate PubMed, so it is reported as
 * unresolved instead of being guessed.
 */
export function buildTierA(
  v1: Record<string, string>,
  rows: OpenAlexSourceRow[],
): { journals: TierAJournal[]; unresolved: string[] } {
  const byId = new Map(rows.map((row) => [row.id.replace("https://openalex.org/", ""), row]))
  const seen = new Set<string>()
  const journals: TierAJournal[] = []
  const unresolved: string[] = []

  for (const [v1Name, sourceId] of Object.entries(v1)) {
    const row = byId.get(sourceId)
    const issns = [row?.issn_l, ...(row?.issn ?? [])].filter((value): value is string => typeof value === "string" && ISSN.test(value))
    if (!row || issns.length === 0) {
      unresolved.push(v1Name)
      continue
    }
    const issn = issns[0]
    if (seen.has(issn)) continue
    seen.add(issn)
    const eissn = issns.find((value) => value !== issn)
    journals.push({ name: row.display_name, issn, ...(eissn ? { eissn } : {}), openalexSourceId: sourceId, tier: "A", state: "normal" })
  }
  journals.sort((a, b) => a.name.localeCompare(b.name))
  return { journals, unresolved }
}
