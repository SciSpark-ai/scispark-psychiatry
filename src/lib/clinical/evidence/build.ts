// src/lib/clinical/evidence/build.ts
import type { Taxonomy } from "../pack/schema"
import { withDescendants } from "../pack/taxonomy"
import type { Design } from "../types"
import { FINDING_KINDS, type Finding, type FindingKind } from "./schema"

/**
 * The evidence the reader's feed has seen on one condition (spec D53 to D55): which treatments, how
 * many studies each, in which directions and of which designs; when the papers came out; and the
 * findings themselves. Studies are counted, never pooled. Pure: no storage, no model.
 */

export const RECENT_DAYS = 14
export const TIMELINE_MONTHS = 12
const TIMELINE_SERIES = 5
const RECENT_MAX = 8
const NO_TREATMENT = "none"
const OTHER = "other"

export interface EvidenceRow {
  key: string; treatment: string | null; modality: string | null; studies: number
  kinds: Record<FindingKind | "unsorted", number>; designs: Array<{ design: Design; count: number }>
  latest: string | null; papers: string[]
}
export interface EvidenceItem {
  key: string; slug: string; headline: string; takeaway: string; kind: FindingKind | null; treatment: string | null; rowKey: string
  population: string | null; comparator: string | null; outcome: string | null
  design: Design; designNamed: boolean; venue: string | null; date: string | null; listedAt: string; saved: boolean
}
export interface ConditionEvidence {
  condition: { code: string; name: string }; total: number; rows: EvidenceRow[]
  timeline: { months: string[]; series: Array<{ key: string; label: string | null; counts: number[] }> }
  recent: EvidenceItem[]; items: EvidenceItem[]
}

const rowKeyOf = (finding: Finding) => finding.treatmentCode ?? (finding.treatment ? `name:${finding.treatment.toLowerCase()}` : NO_TREATMENT)
/** The day a finding is placed on: its publication date when that names at least a month, else the day it entered PubMed, else the day it was first listed. */
const dayOf = (finding: Finding) => {
  const published = finding.paper.date
  if (published && /^\d{4}-\d{2}/.test(published)) return published.length === 7 ? `${published}-01` : published.slice(0, 10)
  return finding.paper.addedDate?.slice(0, 10) || finding.firstListedAt.slice(0, 10)
}
const designNamed = (finding: Finding) => finding.designSource !== "none" && finding.design !== "other" && finding.design !== "unknown"
const inCondition = (findings: Finding[], taxonomy: Taxonomy, code: string) => {
  const codes = new Set(withDescendants(taxonomy, code).map((node) => node.id))
  return findings.filter((finding) => finding.conditionCodes.some((entry) => codes.has(entry)))
}

function rowsOf(findings: Finding[], taxonomy: Taxonomy): EvidenceRow[] {
  const nodeOf = new Map(taxonomy.nodes.map((node) => [node.id, node]))
  const rows = new Map<string, EvidenceRow>()
  for (const finding of findings) {
    const key = rowKeyOf(finding)
    const node = finding.treatmentCode ? nodeOf.get(finding.treatmentCode) : undefined
    const row = rows.get(key) ?? {
      key, treatment: node?.name ?? finding.treatment, modality: node?.modality ?? null, studies: 0,
      kinds: { ...Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0])), unsorted: 0 } as EvidenceRow["kinds"], designs: [], latest: null, papers: [],
    }
    row.studies += 1
    row.kinds[finding.kind ?? "unsorted"] += 1
    if (designNamed(finding)) {
      const counted = row.designs.find((entry) => entry.design === finding.design)
      if (counted) counted.count += 1
      else row.designs.push({ design: finding.design, count: 1 })
    }
    const day = dayOf(finding)
    if (row.latest === null || day > row.latest) row.latest = day
    row.papers.push(finding.key)
    rows.set(key, row)
  }
  const ordered = [...rows.values()].sort((a, b) => Number(a.key === NO_TREATMENT) - Number(b.key === NO_TREATMENT) || b.studies - a.studies || (a.treatment ?? "").localeCompare(b.treatment ?? ""))
  for (const row of ordered) row.designs.sort((a, b) => b.count - a.count)
  return ordered
}

/** The last `count` calendar months ending with `now`'s, oldest first, as YYYY-MM. */
function monthsBefore(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, back) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - back), 1))
    return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

export function buildConditionEvidence(findings: Finding[], taxonomy: Taxonomy, conditionCode: string, opts: { now: Date; savedSlugs?: ReadonlySet<string> }): ConditionEvidence | null {
  const node = taxonomy.nodes.find((entry) => entry.id === conditionCode && entry.type === "condition")
  if (!node) return null
  const mine = inCondition(findings, taxonomy, conditionCode)
  const rows = rowsOf(mine, taxonomy)
  const order = new Map(rows.map((row, index) => [row.key, index]))
  const itemOf = (finding: Finding): EvidenceItem => ({
    key: finding.key, slug: finding.slug, headline: finding.headline, takeaway: finding.takeaway, kind: finding.kind, treatment: finding.treatment, rowKey: rowKeyOf(finding),
    population: finding.population, comparator: finding.comparator, outcome: finding.outcome,
    design: finding.design, designNamed: designNamed(finding), venue: finding.paper.venue ?? null, date: dayOf(finding), listedAt: finding.firstListedAt,
    saved: opts.savedSlugs?.has(finding.slug) ?? false,
  })
  const items = [...mine].sort((a, b) => (order.get(rowKeyOf(a)) ?? 0) - (order.get(rowKeyOf(b)) ?? 0) || dayOf(b).localeCompare(dayOf(a))).map(itemOf)
  const since = new Date(opts.now.getTime() - RECENT_DAYS * 86_400_000).toISOString()
  const recent = mine.filter((finding) => finding.firstListedAt >= since).sort((a, b) => b.firstListedAt.localeCompare(a.firstListedAt)).slice(0, RECENT_MAX).map(itemOf)

  const months = monthsBefore(opts.now, TIMELINE_MONTHS)
  const drawn = rows.filter((row) => row.key !== NO_TREATMENT).slice(0, TIMELINE_SERIES)
  const drawnKeys = new Set(drawn.map((row) => row.key))
  const counts = (belongs: (finding: Finding) => boolean) => months.map((month) => mine.filter((finding) => belongs(finding) && dayOf(finding).startsWith(month)).length)
  const rest = counts((finding) => !drawnKeys.has(rowKeyOf(finding)))
  const series = [
    ...drawn.map((row) => ({ key: row.key, label: row.treatment, counts: counts((finding) => rowKeyOf(finding) === row.key) })),
    ...(mine.some((finding) => !drawnKeys.has(rowKeyOf(finding))) ? [{ key: OTHER, label: null, counts: rest }] : []),
  ]
  return { condition: { code: node.id, name: node.name }, total: mine.length, rows, timeline: { months, series }, recent, items }
}

/** The conditions to show on wiki home: those of the reader's topics and those with findings. */
export function followedConditions(findings: Finding[], taxonomy: Taxonomy, watched: string[], now: Date): Array<{ code: string; name: string; total: number; recent: number; treatments: string[] }> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString()
  const codes = new Set([...watched, ...findings.flatMap((finding) => finding.conditionCodes)])
  return taxonomy.nodes
    .filter((node) => node.type === "condition" && codes.has(node.id))
    .map((node) => {
      const mine = inCondition(findings, taxonomy, node.id)
      return {
        code: node.id, name: node.name, total: mine.length, recent: mine.filter((finding) => finding.firstListedAt >= since).length,
        treatments: rowsOf(mine, taxonomy).filter((row) => row.treatment !== null).slice(0, 3).map((row) => row.treatment as string),
      }
    })
    .sort((a, b) => b.recent - a.recent || b.total - a.total || a.name.localeCompare(b.name))
}
