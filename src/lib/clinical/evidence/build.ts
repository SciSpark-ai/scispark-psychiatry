// src/lib/clinical/evidence/build.ts
import type { Taxonomy } from "../pack/schema"
import { withDescendants } from "../pack/taxonomy"
import type { Design } from "../types"
import { FOLDED_ROW, NO_TREATMENT_ROW, OTHER_SERIES } from "./keys"
import { FINDING_KINDS, type Finding, type FindingKind } from "./schema"

/**
 * The evidence the reader's feed has seen on one condition (spec D53 to D55): which treatments, how
 * many papers each, in which directions and of which designs; when the papers came out; and the
 * findings themselves. Papers are counted, never pooled. Pure: no storage, no model.
 *
 * Rows. A treatment of the pack always has a row. A treatment the pack does not know has a row of its
 * own once two papers are on it; those with one paper each share the folded row. A finding that names
 * no treatment, or names something the pack does not know and claims no effect of it (an exposure, a
 * tool, a programme), is in the row without a treatment.
 */

export const RECENT_DAYS = 14
export const TIMELINE_MONTHS = 12
const TIMELINE_SERIES = 5
const RECENT_MAX = 8

export interface EvidenceRow {
  /** A pack code, `name:<treatment>` for a treatment the pack does not know, FOLDED_ROW or NO_TREATMENT_ROW. */
  key: string; treatment: string | null; modality: string | null; studies: number
  kinds: Record<FindingKind | "unsorted", number>; designs: Array<{ design: Design; count: number }>
  /** The newest publication date among the row's papers, as the paper gives it: a day, or a month when it names no day. */
  latest: string | null; papers: string[]
}
export interface EvidenceItem {
  /** `treatment` is what the paper's answer named, also when the item is in the folded row or the row without a treatment. */
  key: string; slug: string; headline: string; takeaway: string; kind: FindingKind | null; treatment: string | null; rowKey: string
  population: string | null; comparator: string | null; outcome: string | null
  design: Design; designNamed: boolean; venue: string | null; date: string | null; listedAt: string; saved: boolean
}
export interface ConditionEvidence {
  condition: { code: string; name: string }; total: number; rows: EvidenceRow[]
  timeline: { months: string[]; series: Array<{ key: string; label: string | null; counts: number[] }> }
  /** The newest of the findings first listed in the last two weeks, and how many there are in all. */
  recent: EvidenceItem[]; recentTotal: number; items: EvidenceItem[]
}

/** The row a finding would have by itself, before single papers are folded. */
const ownRowOf = (finding: Finding) => {
  if (finding.treatmentCode) return finding.treatmentCode
  const claimsAnEffect = finding.kind !== null && finding.kind !== "other"
  return finding.treatment && claimsAnEffect ? `name:${finding.treatment.trim().toLowerCase()}` : NO_TREATMENT_ROW
}
/** The row of each finding: a treatment the pack does not know with a single paper goes to the folded row. */
function rowKeys(findings: Finding[]): (finding: Finding) => string {
  const papers = new Map<string, number>()
  for (const finding of findings) papers.set(ownRowOf(finding), (papers.get(ownRowOf(finding)) ?? 0) + 1)
  return (finding) => {
    const own = ownRowOf(finding)
    return own.startsWith("name:") && papers.get(own) === 1 ? FOLDED_ROW : own
  }
}
const published = (finding: Finding) => {
  const date = finding.paper.date
  return date && /^\d{4}-\d{2}/.test(date) ? (date.length === 7 ? date : date.slice(0, 10)) : null
}
const listedDay = (finding: Finding) => finding.paper.addedDate?.slice(0, 10) || finding.firstListedAt.slice(0, 10)
/** The date shown for a finding: its publication date when that names at least a month (a month alone stays a month), else the day it entered PubMed, else the day it was first listed. */
const shownDate = (finding: Finding) => published(finding) ?? listedDay(finding)
/** The day a finding is ordered by: a month alone counts as its first day. Never shown. */
const dayOf = (finding: Finding) => {
  const shown = shownDate(finding)
  return shown.length === 7 ? `${shown}-01` : shown
}
/** The month a finding is drawn in. A journal issue dated in a coming month is drawn where the paper appeared: the day it entered PubMed, else the day it was first listed. */
const monthOf = (finding: Finding, now: Date) => {
  const month = dayOf(finding).slice(0, 7)
  return month > now.toISOString().slice(0, 7) ? listedDay(finding).slice(0, 7) : month
}
const designNamed = (finding: Finding) => finding.designSource !== "none" && finding.design !== "other" && finding.design !== "unknown"
const inCondition = (findings: Finding[], taxonomy: Taxonomy, code: string) => {
  const codes = new Set(withDescendants(taxonomy, code).map((node) => node.id))
  return findings.filter((finding) => finding.conditionCodes.some((entry) => codes.has(entry)))
}
/** Rows of one treatment first, then the folded row, then the row without a treatment. */
const rank = (key: string) => (key === NO_TREATMENT_ROW ? 2 : key === FOLDED_ROW ? 1 : 0)

function rowsOf(findings: Finding[], taxonomy: Taxonomy): { rows: EvidenceRow[]; keyOf: (finding: Finding) => string } {
  const nodeOf = new Map(taxonomy.nodes.map((node) => [node.id, node]))
  const keyOf = rowKeys(findings)
  const rows = new Map<string, EvidenceRow>()
  const latestDay = new Map<string, string>()
  for (const finding of findings) {
    const key = keyOf(finding)
    const node = finding.treatmentCode ? nodeOf.get(finding.treatmentCode) : undefined
    const row = rows.get(key) ?? {
      key, treatment: rank(key) > 0 ? null : node?.name ?? finding.treatment, modality: node?.modality ?? null, studies: 0,
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
    if (day > (latestDay.get(key) ?? "")) {
      latestDay.set(key, day)
      row.latest = shownDate(finding)
    }
    row.papers.push(finding.key)
    rows.set(key, row)
  }
  const ordered = [...rows.values()].sort((a, b) => rank(a.key) - rank(b.key) || b.studies - a.studies || (a.treatment ?? "").localeCompare(b.treatment ?? ""))
  for (const row of ordered) row.designs.sort((a, b) => b.count - a.count)
  return { rows: ordered, keyOf }
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
  const { rows, keyOf } = rowsOf(mine, taxonomy)
  const order = new Map(rows.map((row, index) => [row.key, index]))
  const itemOf = (finding: Finding): EvidenceItem => ({
    key: finding.key, slug: finding.slug, headline: finding.headline, takeaway: finding.takeaway, kind: finding.kind, treatment: finding.treatment, rowKey: keyOf(finding),
    population: finding.population, comparator: finding.comparator, outcome: finding.outcome,
    design: finding.design, designNamed: designNamed(finding), venue: finding.paper.venue ?? null, date: shownDate(finding), listedAt: finding.firstListedAt,
    saved: opts.savedSlugs?.has(finding.slug) ?? false,
  })
  const items = [...mine].sort((a, b) => (order.get(keyOf(a)) ?? 0) - (order.get(keyOf(b)) ?? 0) || dayOf(b).localeCompare(dayOf(a))).map(itemOf)
  const since = new Date(opts.now.getTime() - RECENT_DAYS * 86_400_000).toISOString()
  const firstListed = mine.filter((finding) => finding.firstListedAt >= since).sort((a, b) => b.firstListedAt.localeCompare(a.firstListedAt))
  const recent = firstListed.slice(0, RECENT_MAX).map(itemOf)

  const months = monthsBefore(opts.now, TIMELINE_MONTHS)
  const drawn = rows.filter((row) => rank(row.key) === 0).slice(0, TIMELINE_SERIES)
  const drawnKeys = new Set(drawn.map((row) => row.key))
  const counts = (belongs: (finding: Finding) => boolean) => months.map((month) => mine.filter((finding) => belongs(finding) && monthOf(finding, opts.now) === month).length)
  const rest = counts((finding) => !drawnKeys.has(keyOf(finding)))
  const series = [
    ...drawn.map((row) => ({ key: row.key, label: row.treatment, counts: counts((finding) => keyOf(finding) === row.key) })),
    ...(mine.some((finding) => !drawnKeys.has(keyOf(finding))) ? [{ key: OTHER_SERIES, label: null, counts: rest }] : []),
  ]
  return { condition: { code: node.id, name: node.name }, total: mine.length, rows, timeline: { months, series }, recent, recentTotal: firstListed.length, items }
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
        // Only rows of one treatment: one of the pack, or one two or more papers are on.
        treatments: rowsOf(mine, taxonomy).rows.filter((row) => rank(row.key) === 0 && row.treatment !== null).slice(0, 3).map((row) => row.treatment as string),
      }
    })
    .sort((a, b) => b.recent - a.recent || b.total - a.total || a.name.localeCompare(b.name))
}
