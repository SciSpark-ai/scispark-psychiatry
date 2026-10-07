import { paperKey, type PaperRecord } from "../../papers/types"
import { cleanAbstract, cleanTitle, qualityFlags, unescapeHtml } from "../text/clean"
import type { PlannedQuery } from "../plan/queries"
import type { Candidate, DropRecord, Provenance } from "../types"
import { CLINICAL_COPY } from "../copy"

export interface EnumerateResult {
  records: PaperRecord[]
  total: number
  truncated: boolean
}
export type EnumerateFn = (q: { query: string; maxRecords: number }) => Promise<EnumerateResult>

/** Per-query ceilings on records fetched; a query that hits its ceiling is logged as truncated. */
export const MAX_RECORDS: Record<PlannedQuery["tier"], number> = { A: 2000, B: 500, entry: 300 }

export interface QueryLogEntry {
  tier: PlannedQuery["tier"]
  entryId: string | null
  rationale: string
  returned: number
  total: number
  truncated: boolean
  error?: string
}

export interface RetrieveResult {
  candidates: Candidate[]
  drops: DropRecord[]
  queryLog: QueryLogEntry[]
}

/** Cleans the text of a record (so grading and quote checks see the same text) and flags quality. */
export function toCandidate(paper: PaperRecord, provenance: Provenance): Candidate | null {
  const title = cleanTitle(paper.title)
  if (!title) return null
  const abstract = cleanAbstract(paper.abstract)
  // PubMed sends accented letters in names as character codes ("M&#xf8;llegaard"); show the letters.
  const authors = (paper.authors ?? []).map((author) => ({ ...author, name: unescapeHtml(author.name) }))
  const cleaned: PaperRecord = { ...paper, title, abstract, authors }
  return { paper: cleaned, key: paperKey(cleaned), provenance: [provenance], flags: qualityFlags({ title, abstract }) }
}

/**
 * Runs the plan, merges duplicates (keeping every provenance entry for the recall audit) and
 * drops what the user has already handled. A failed query is logged and skipped; the run only
 * fails when every query failed.
 */
export async function retrieve(
  enumerate: EnumerateFn,
  plan: PlannedQuery[],
  opts: { exclude?: ReadonlySet<string> } = {},
): Promise<RetrieveResult> {
  const byKey = new Map<string, Candidate>()
  const drops: DropRecord[] = []
  const queryLog: QueryLogEntry[] = []
  let failures = 0

  for (const planned of plan) {
    const base = { tier: planned.tier, entryId: planned.entryId, rationale: planned.rationale }
    let result: EnumerateResult
    try {
      result = await enumerate({ query: planned.query, maxRecords: MAX_RECORDS[planned.tier] })
    } catch (error) {
      failures += 1
      queryLog.push({ ...base, returned: 0, total: 0, truncated: false, error: error instanceof Error ? error.message : String(error) })
      continue
    }
    queryLog.push({ ...base, returned: result.records.length, total: result.total, truncated: result.truncated })
    const provenance: Provenance = { query: planned.query, entryId: planned.entryId ?? undefined, tier: planned.tier }
    for (const paper of result.records) {
      const candidate = toCandidate(paper, provenance)
      if (!candidate) {
        drops.push({ key: paperKey(paper), title: paper.title ?? "", step: "retrieve", reason: "no-title" })
        continue
      }
      if (opts.exclude?.has(candidate.key)) {
        drops.push({ key: candidate.key, title: candidate.paper.title, step: "retrieve", reason: "already-handled" })
        continue
      }
      const existing = byKey.get(candidate.key)
      if (existing) existing.provenance.push(provenance)
      else byKey.set(candidate.key, candidate)
    }
  }

  if (plan.length > 0 && failures === plan.length) throw new Error(CLINICAL_COPY.run.everyQueryFailed)
  return { candidates: [...byKey.values()], drops, queryLog }
}
