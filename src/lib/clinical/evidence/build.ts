// src/lib/clinical/evidence/build.ts
import type { Taxonomy, TaxonomyNode } from "../pack/schema"
import { withDescendants } from "../pack/taxonomy"
import type { Design } from "../types"
import { FINDING_KINDS, RESEARCH_TYPES, type Finding, type FindingKind, type ResearchType, type TreatmentClass } from "./schema"

/**
 * What the reader's feed has seen on one condition (spec D53 to D55), as classes of treatment, the
 * treatments in each and the studies on each; the safety findings; and the research that names no
 * treatment. Papers are counted, never pooled, and no effect size is shown. Pure: no storage, no
 * model, no clock (`now` comes in).
 */

export const RECENT_DAYS = 14
export const TIMELINE_MONTHS = 12
const TIMELINE_SERIES = 5
const SHORT_LIST = 4
const TOP_CLASSES = 3
/** The key of the timeline's series of everything that has no line of its own, and of the class of treatments no other class holds. */
const OTHER = "other"

export type Period = "all" | "12m" | "6m" | "3m"
/** Calendar-free: the last 365, 183 or 92 days. */
const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = { "12m": 365, "6m": 183, "3m": 92 }
export type Counts = Record<FindingKind | "unsorted", number>

export interface Study {
  key: string; slug: string; headline: string; takeaway: string
  /** "Smith 2026" from the first author's family name and the year; the year alone, or null, when they are missing. */
  label: string | null
  venue: string | null; date: string | null
  design: Design; designNamed: boolean
  population: string | null; sampleSize: number | null; comparator: string | null; outcome: string | null
  kind: FindingKind | null
  /** The paper's short finding: what the treatment did. */
  text: string | null
  treatment: string | null; isNew: boolean; saved: boolean
}
export interface TreatmentEvidence {
  key: string; name: string; papers: number; counts: Counts; newPapers: number
  /** What it did, from its benefit findings; what to watch for, from its safety, no-benefit and mixed findings. Each entry is one paper's own short finding with that paper's key. */
  did: Array<{ text: string; key: string }>; watch: Array<{ text: string; key: string; kind: FindingKind }>
  studies: Study[]
}
export interface ClassEvidence { key: string; label: string | null; papers: number; counts: Counts; newPapers: number; treatments: TreatmentEvidence[] }
export interface ResearchGroup { type: ResearchType; papers: number; newPapers: number; studies: Study[] }
export interface ConditionEvidence {
  condition: { code: string; name: string }
  period: Period
  /** Papers of the condition in the period, and in all. */
  total: number; collected: number
  /** The day the earliest paper of the condition was first listed (YYYY-MM-DD), or null. */
  since: string | null
  classes: ClassEvidence[]; safety: Study[]; research: ResearchGroup[]
  timeline: { months: string[]; series: Array<{ key: string; label: string | null; counts: number[] }> }
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
const day = (date: Date) => date.toISOString().slice(0, 10)
const daysBefore = (now: Date, days: number) => day(new Date(now.getTime() - days * 86_400_000))
const newestFirst = (a: Finding, b: Finding) => dayOf(b).localeCompare(dayOf(a)) || a.key.localeCompare(b.key)

/**
 * New: the later of the publication day and the day the paper entered PubMed is within RECENT_DAYS of
 * `now`. A publication day that has not come yet does not count (the entry day does); a paper with
 * neither date goes by the day it was first listed. The limit is inclusive: 14 days ago is new, 15 is not.
 */
function isNew(finding: Finding, now: Date): boolean {
  const pub = published(finding)
  const pubDay = pub && pub.length === 7 ? `${pub}-01` : pub
  const days = [pubDay && pubDay <= day(now) ? pubDay : null, finding.paper.addedDate?.slice(0, 10) || null].filter((entry): entry is string => !!entry)
  const latest = days.length > 0 ? days.reduce((a, b) => (a > b ? a : b)) : finding.firstListedAt.slice(0, 10)
  return latest >= daysBefore(now, RECENT_DAYS)
}

const emptyCounts = (): Counts => ({ ...Object.fromEntries(FINDING_KINDS.map((kind) => [kind, 0])), unsorted: 0 }) as Counts

/** "Smith 2026" from the first author and the year; the year alone; null. */
function studyLabel(finding: Finding): string | null {
  const name = finding.paper.authors?.[0]?.name?.trim() ?? ""
  const family = name.includes(",") ? name.split(",")[0].trim() : (name.split(/\s+/).at(-1) ?? "")
  const date = finding.paper.date
  const year = date && /^\d{4}/.test(date) ? date.slice(0, 4) : finding.paper.year ? String(finding.paper.year) : ""
  return [family, year].filter(Boolean).join(" ") || null
}

interface ClassRef { key: string; label: string | null }

/**
 * Where a finding that names a treatment belongs: the key of its treatment and the class of it. Null when it names none.
 * The class is null when the pack does not decide it (an uncoded name, a node of modality other): the caller then takes it
 * from the findings of that treatment, so one treatment is never in two classes.
 */
function classifier(taxonomy: Taxonomy): { classify: (finding: Finding) => { key: string; class: ClassRef | null } | null; byClass: (value: TreatmentClass | null) => ClassRef } {
  const nodeOf = new Map(taxonomy.nodes.map((node) => [node.id, node]))
  const treatmentNode = (id: string | null | undefined): TaxonomyNode | undefined => {
    const node = id ? nodeOf.get(id) : undefined
    return node?.type === "treatment" ? node : undefined
  }
  const parents = new Set(taxonomy.nodes.filter((node) => node.type === "treatment").flatMap((node) => node.parents.filter((id) => treatmentNode(id))))
  const topOf = (node: TaxonomyNode): TaxonomyNode | null => {
    const seen = new Set([node.id])
    let current = node
    for (;;) {
      const parent = current.parents.map(treatmentNode).find((entry): entry is TaxonomyNode => !!entry && !seen.has(entry.id))
      if (!parent) break
      seen.add(parent.id)
      current = parent
    }
    return current === node ? null : current
  }
  /** The pack's class of that id when it has one, else a class of that key with no label. */
  const packClass = (id: "psychotherapy" | "neuromodulation"): ClassRef => ({ key: id, label: treatmentNode(id)?.name ?? null })
  const byClass = (value: TreatmentClass | null): ClassRef => {
    switch (value) {
      case "medicine": return { key: "medicine", label: null }
      case "psychosocial": return packClass("psychotherapy")
      case "neuromodulation": return packClass("neuromodulation")
      case "digital": case "lifestyle": return { key: value, label: null }
      default: return { key: OTHER, label: null }
    }
  }
  const classify = (finding: Finding) => {
    const name = finding.treatment?.trim() || null
    const node = treatmentNode(finding.treatmentCode)
    if (!node) return name || finding.treatmentCode ? { key: `name:${(name ?? finding.treatmentCode ?? "").toLowerCase().replace(/\s+/g, " ")}`, class: null } : null
    const top = topOf(node)
    if (top) return { key: node.id, class: { key: top.id, label: top.name } }
    if (parents.has(node.id)) return { key: node.id, class: { key: node.id, label: node.name } }
    const cls: ClassRef | null =
      node.modality === "drug" ? { key: "medicine", label: null }
      : node.modality === "psychotherapy" ? packClass("psychotherapy")
      : node.modality === "neuromodulation" ? packClass("neuromodulation")
      : null
    return { key: node.id, class: cls }
  }
  return { classify, byClass }
}

const inCondition = (findings: Finding[], taxonomy: Taxonomy, code: string) => {
  const codes = new Set(withDescendants(taxonomy, code).map((node) => node.id))
  return findings.filter((finding) => finding.conditionCodes.some((entry) => codes.has(entry)))
}

interface Organised { classes: ClassEvidence[]; classOf: Map<string, string>; research: ResearchGroup[] }

/** The classes, treatments and studies of the findings, and the research with no treatment. `studyOf` is given each finding with the treatment it names. */
function organise(findings: Finding[], taxonomy: Taxonomy, now: Date, studyOf: (finding: Finding) => Study): Organised {
  const { classify, byClass } = classifier(taxonomy)
  // One class per treatment: where the pack does not decide it, the class of the earliest-listed finding of that treatment that has one.
  const named = new Map<string, Finding>()
  for (const finding of findings) {
    const ref = classify(finding)
    const held = ref ? named.get(ref.key) : undefined
    if (ref && ref.class === null && finding.treatmentClass && (!held || finding.firstListedAt < held.firstListedAt)) named.set(ref.key, finding)
  }
  const nodeOf = new Map(taxonomy.nodes.map((node) => [node.id, node]))
  const classes = new Map<string, ClassEvidence>()
  const slots = new Map<string, { evidence: TreatmentEvidence; first: Finding; findings: Finding[] }>()
  const classOf = new Map<string, string>()
  const researchFindings = new Map<ResearchType, Finding[]>()
  for (const finding of findings) {
    const ref = classify(finding)
    if (!ref) {
      const type = finding.researchType ?? "other"
      researchFindings.set(type, [...(researchFindings.get(type) ?? []), finding])
      continue
    }
    const cls = ref.class ?? byClass(named.get(ref.key)?.treatmentClass ?? null)
    classOf.set(finding.key, cls.key)
    const entry = classes.get(cls.key) ?? { key: cls.key, label: null, papers: 0, counts: emptyCounts(), newPapers: 0, treatments: [] }
    entry.label ??= cls.label
    const fresh = isNew(finding, now)
    const kind = finding.kind ?? "unsorted"
    entry.papers += 1
    entry.counts[kind] += 1
    if (fresh) entry.newPapers += 1
    classes.set(entry.key, entry)
    const id = `${cls.key}\u0000${ref.key}`
    let slot = slots.get(id)
    if (!slot) {
      slot = { evidence: { key: ref.key, name: nodeOf.get(ref.key)?.name ?? (finding.treatment?.trim() || finding.treatmentCode || ref.key), papers: 0, counts: emptyCounts(), newPapers: 0, did: [], watch: [], studies: [] }, first: finding, findings: [] }
      slots.set(id, slot)
      entry.treatments.push(slot.evidence)
    }
    // A treatment the pack does not know is named as its earliest-listed finding wrote it.
    if (!nodeOf.has(ref.key) && finding.firstListedAt < slot.first.firstListedAt) {
      slot.first = finding
      slot.evidence.name = finding.treatment?.trim() || finding.treatmentCode || slot.evidence.name
    }
    slot.evidence.papers += 1
    slot.evidence.counts[kind] += 1
    if (fresh) slot.evidence.newPapers += 1
    slot.findings.push(finding)
  }
  for (const slot of slots.values()) {
    const ordered = [...slot.findings].sort(newestFirst)
    const withText = ordered.filter((finding) => finding.text?.trim())
    slot.evidence.studies = ordered.map(studyOf)
    slot.evidence.did = withText.filter((finding) => finding.kind === "benefit").slice(0, SHORT_LIST).map((finding) => ({ text: finding.text as string, key: finding.key }))
    slot.evidence.watch = withText
      .filter((finding) => finding.kind === "safety" || finding.kind === "no-benefit" || finding.kind === "mixed")
      .slice(0, SHORT_LIST).map((finding) => ({ text: finding.text as string, key: finding.key, kind: finding.kind as FindingKind }))
  }
  const ordered = [...classes.values()].sort((a, b) => (a.key === OTHER ? 1 : 0) - (b.key === OTHER ? 1 : 0) || b.papers - a.papers || (a.label ?? a.key).localeCompare(b.label ?? b.key))
  for (const entry of ordered) entry.treatments.sort((a, b) => b.papers - a.papers || a.name.localeCompare(b.name))
  const research = RESEARCH_TYPES.filter((type) => researchFindings.has(type)).map((type) => {
    const mine = [...(researchFindings.get(type) as Finding[])].sort(newestFirst)
    return { type, papers: mine.length, newPapers: mine.filter((finding) => isNew(finding, now)).length, studies: mine.map(studyOf) }
  }).sort((a, b) => b.papers - a.papers)
  return { classes: ordered, classOf, research }
}

/** The last `count` calendar months ending with `now`'s, oldest first, as YYYY-MM. */
function monthsBefore(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, back) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - back), 1))
    return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

export function buildConditionEvidence(findings: Finding[], taxonomy: Taxonomy, conditionCode: string, opts: { now: Date; savedSlugs?: ReadonlySet<string>; period?: Period }): ConditionEvidence | null {
  const node = taxonomy.nodes.find((entry) => entry.id === conditionCode && entry.type === "condition")
  if (!node) return null
  const period = opts.period ?? "all"
  const all = inCondition(findings, taxonomy, conditionCode)
  const cutoff = period === "all" ? null : daysBefore(opts.now, PERIOD_DAYS[period])
  // A publication day that has not come yet is inside every period.
  const mine = cutoff === null ? all : all.filter((finding) => dayOf(finding) >= cutoff)
  const studyOf = (finding: Finding): Study => ({
    key: finding.key, slug: finding.slug, headline: finding.headline, takeaway: finding.takeaway, label: studyLabel(finding),
    venue: finding.paper.venue ?? null, date: shownDate(finding), design: finding.design, designNamed: designNamed(finding),
    population: finding.population, sampleSize: finding.sampleSize, comparator: finding.comparator, outcome: finding.outcome,
    kind: finding.kind, text: finding.text, treatment: finding.treatment?.trim() || null, isNew: isNew(finding, opts.now), saved: opts.savedSlugs?.has(finding.slug) ?? false,
  })
  const { classes, classOf, research } = organise(mine, taxonomy, opts.now, studyOf)
  const safety = mine.filter((finding) => finding.kind === "safety").sort(newestFirst).map(studyOf)

  const months = monthsBefore(opts.now, TIMELINE_MONTHS)
  const drawn = classes.filter((entry) => entry.key !== OTHER).slice(0, TIMELINE_SERIES)
  const drawnKeys = new Set(drawn.map((entry) => entry.key))
  const counts = (belongs: (finding: Finding) => boolean) => months.map((month) => mine.filter((finding) => belongs(finding) && monthOf(finding, opts.now) === month).length)
  const isRest = (finding: Finding) => !drawnKeys.has(classOf.get(finding.key) ?? "")
  const series = [
    ...drawn.map((entry) => ({ key: entry.key, label: entry.label, counts: counts((finding) => classOf.get(finding.key) === entry.key) })),
    ...(mine.some(isRest) ? [{ key: OTHER, label: null, counts: counts(isRest) }] : []),
  ]
  const since = all.length > 0 ? all.map((finding) => finding.firstListedAt.slice(0, 10)).reduce((a, b) => (a < b ? a : b)) : null
  return { condition: { code: node.id, name: node.name }, period, total: mine.length, collected: all.length, since, classes, safety, research, timeline: { months, series } }
}

/** The conditions to show on wiki home: those of the reader's topics and those with findings. */
export function followedConditions(findings: Finding[], taxonomy: Taxonomy, watched: string[], now: Date): Array<{ code: string; name: string; total: number; recent: number; treatments: Array<{ key: string; label: string | null }> }> {
  const codes = new Set([...watched, ...findings.flatMap((finding) => finding.conditionCodes)])
  return taxonomy.nodes
    .filter((node) => node.type === "condition" && codes.has(node.id))
    .map((node) => {
      const mine = inCondition(findings, taxonomy, node.id)
      // Only the classes are read here, so the studies are left empty.
      const { classes } = organise(mine, taxonomy, now, (finding) => ({ key: finding.key }) as Study)
      return {
        code: node.id, name: node.name, total: mine.length, recent: mine.filter((finding) => isNew(finding, now)).length,
        treatments: classes.slice(0, TOP_CLASSES).map((entry) => ({ key: entry.key, label: entry.label })),
      }
    })
    .sort((a, b) => b.recent - a.recent || b.total - a.total || a.name.localeCompare(b.name))
}
