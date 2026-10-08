// src/lib/clinical/evidence/build.ts
import type { Taxonomy, TaxonomyNode } from "../pack/schema"
import { armsOf, withDescendants } from "../pack/taxonomy"
import { sampleSizeStated } from "../text/sample-size"
import type { Design } from "../types"
import { RESEARCH_TYPES, type Finding, type FindingKind, type ResearchType, type TreatmentClass } from "./schema"

/**
 * What the reader's feed has seen on one condition (spec D53 to D55), in three sections. Treatments: classes of
 * treatment, the treatments in each and the studies that report whether each worked. Safety: the safety papers, by
 * treatment. Other research: the papers that name no treatment, by type of research, and the papers on a treatment
 * that report no efficacy result. Papers are counted, never pooled, and no effect size is shown. Pure: no storage, no
 * model, no clock (`now` comes in).
 *
 * A treatment is found by its words (owner decision 2026-10-08): a finding is under every pack treatment its text
 * names, so findings stored before that are read the same way with no migration. A paper has one kind, so it is in one
 * section, under each treatment it names. A pack treatment the paper names as its comparator is not one of them (owner
 * decision 2026-10-09): the paper's direction is of the treatment it tested, so the comparator does not count the paper
 * and only shows it as a comparison. The counting rule: a treatment counts each paper under it once; a class
 * counts its DISTINCT papers, so a paper that names three antipsychotics adds 1 to each of the three and 1 to
 * Antipsychotics, and a class is not the sum of its treatments; a paper under two classes adds 1 to each; `total` and
 * `sections` count distinct papers.
 */

export const RECENT_DAYS = 14
export const TIMELINE_MONTHS = 12
const TIMELINE_SERIES = 5
const SHORT_LIST = 4
const TOP_CLASSES = 3
/** The key of the timeline's series of everything that has no line of its own, and of the class of treatments no other class holds. */
const OTHER = "other"
/** The class of a pack treatment whose modality is "other", when none of its findings names one (final review M2). */
const CLASS_BY_ID: Readonly<Record<string, TreatmentClass>> = { exercise: "lifestyle", "light-therapy": "lifestyle", "digital-interventions": "digital", "mdma-assisted-therapy": "medicine", "omega-3": "lifestyle", probiotics: "lifestyle" }

export type Period = "all" | "12m" | "6m" | "3m"
/** Calendar-free: the last 365, 183 or 92 days. */
const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = { "12m": 365, "6m": 183, "3m": 92 }
/** What is shown: everything the feed listed on the condition, or only the papers the reader saved. */
export type Scope = "all" | "saved"
/** The design tier of a study, for the direction plot. */
export type Tier = "synthesis" | "trial" | "observational"
/** The papers that report whether a treatment worked, by what they found. */
export interface Efficacy { benefit: number; "no-benefit": number; mixed: number }
type EfficacyKind = keyof Efficacy
const isEfficacy = (kind: FindingKind | null): kind is EfficacyKind => kind === "benefit" || kind === "no-benefit" || kind === "mixed"
/** The research group of the papers on a treatment that report no efficacy result. */
const NO_EFFICACY = "no-efficacy"

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
  /** The treatment as the paper itself named it, whichever treatment the row is under. */
  treatment: string | null
  /** The paper's text names more than one pack treatment, so the row is under each of them. */
  severalTreatments: boolean
  tier: Tier
  isNew: boolean; saved: boolean
}
/** One paper's own short finding, with that paper's key. */
export interface Line { text: string; key: string }
export interface TreatmentEvidence {
  key: string; name: string
  /** Papers with an efficacy result on this treatment. */
  papers: number; efficacy: Efficacy; newPapers: number
  /** How many safety papers and how many papers without an efficacy result name this treatment (shown as marks, listed elsewhere). */
  safetyPapers: number; unreportedPapers: number
  /**
   * The efficacy papers of ANOTHER treatment that this one was the comparator in, newest first, and how many they are.
   * Their direction is of the treatment they tested: they are in none of `papers`, `efficacy`, `lines` and `studies`.
   */
  comparatorPapers: number; comparedIn: Study[]
  /** At most 4 per kind, newest first. The safety lines come from the safety papers of the same treatment. */
  lines: { benefit: Line[]; "no-benefit": Line[]; mixed: Line[]; safety: Line[] }
  /** The efficacy studies, newest first. */
  studies: Study[]
}
/** A class is here only when one of its treatments has an efficacy paper; its numbers count distinct efficacy papers. */
export interface ClassEvidence { key: string; label: string | null; papers: number; efficacy: Efficacy; newPapers: number; treatments: TreatmentEvidence[] }
/** The safety papers of one treatment, newest first. `classKey` is the class the treatment has (or would have) under Treatments. */
export interface SafetyGroup { key: string; name: string; classKey: string; papers: number; newPapers: number; studies: Study[] }
/** `no-efficacy`: the papers that name a treatment and report no efficacy result, all treatments together. */
export interface ResearchGroup { type: ResearchType | typeof NO_EFFICACY; papers: number; newPapers: number; studies: Study[] }
export interface ConditionEvidence {
  condition: { code: string; name: string }
  period: Period; scope: Scope
  /** Distinct papers of the condition in the scope and the period; all the condition's papers; and how many of those are saved, whatever the scope. */
  total: number; collected: number; savedCount: number
  /** The day the earliest paper of the condition was first listed (YYYY-MM-DD), or null. */
  since: string | null
  /** Distinct papers in each section; a paper is in one. */
  sections: { treatments: number; safety: number; research: number }
  classes: ClassEvidence[]; safety: SafetyGroup[]; research: ResearchGroup[]
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
 * Is the finding inside the period that starts on `cutoff` (YYYY-MM-DD)? A publication day that has not come yet is
 * inside every period. A publication date that is only a year is outside when that year is before the cutoff's; in
 * the cutoff's year or later the year cannot tell, so the day the paper entered PubMed (else was first listed) decides.
 */
const inPeriod = (finding: Finding, cutoff: string) => {
  const date = finding.paper.date
  if (date && /^\d{4}$/.test(date) && date < cutoff.slice(0, 4)) return false
  return dayOf(finding) >= cutoff
}

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

const efficacyOf = (findings: Finding[]): Efficacy => {
  const count = (kind: EfficacyKind) => findings.filter((finding) => finding.kind === kind).length
  return { benefit: count("benefit"), "no-benefit": count("no-benefit"), mixed: count("mixed") }
}
/** A review of trials or a guideline is a synthesis; a randomised or other clinical trial is a trial; everything else is observational. */
const tierOf = (design: Design): Tier =>
  design === "systematic-review" || design === "meta-analysis" || design === "guideline" ? "synthesis" : design === "randomized-trial" || design === "clinical-trial" ? "trial" : "observational"

/** "Smith 2026" from the first author and the year; the year alone; null. */
function studyLabel(finding: Finding): string | null {
  const name = finding.paper.authors?.[0]?.name?.trim() ?? ""
  const family = name.includes(",") ? name.split(",")[0].trim() : (name.split(/\s+/).at(-1) ?? "")
  const date = finding.paper.date
  const year = date && /^\d{4}/.test(date) ? date.slice(0, 4) : finding.paper.year ? String(finding.paper.year) : ""
  return [family, year].filter(Boolean).join(" ") || null
}

/**
 * The sample size to show: the stored number only when the paper's own text (its title and abstract, the headline and
 * the takeaway) prints it as a count of people. A number stored before that check (a year, "12 weeks") is not shown.
 */
const shownSampleSize = (finding: Finding): number | null => {
  const size = finding.sampleSize
  if (size === null) return null
  return sampleSizeStated(size, [finding.paper.title, finding.paper.abstract ?? "", finding.headline, finding.takeaway].join(" . ")) ? size : null
}

const studyOf = (finding: Finding, now: Date, saved: ReadonlySet<string> | undefined, several: boolean): Study => ({
  key: finding.key, slug: finding.slug, headline: finding.headline, takeaway: finding.takeaway, label: studyLabel(finding),
  venue: finding.paper.venue ?? null, date: shownDate(finding), design: finding.design, designNamed: designNamed(finding),
  population: finding.population, sampleSize: shownSampleSize(finding), comparator: finding.comparator, outcome: finding.outcome,
  kind: finding.kind, text: finding.text, treatment: finding.treatment?.trim() || null, severalTreatments: several, tier: tierOf(finding.design), isNew: isNew(finding, now), saved: saved?.has(finding.slug) ?? false,
})

interface ClassRef { key: string; label: string | null }

interface TreatmentRef { key: string; class: ClassRef | null }
/** The treatments a finding is under, and the pack treatments it was compared with (never one of the former). */
interface Arms { refs: TreatmentRef[]; compared: TreatmentRef[] }
const NO_ARMS: Arms = { refs: [], compared: [] }

/**
 * Where a finding that names a treatment belongs: for each treatment, its key and the class of it. Empty when it names none.
 * The treatments are the pack's that the finding's text names as whole words, less those its comparator names; when it
 * names none, the stored code; when there is neither, the name itself. `compared` are the pack treatments its comparator
 * names: empty for a finding under no treatment, and never a treatment the finding is under. The class is null when the pack does not decide it (an uncoded name, a node of
 * modality other): the caller then takes it from the findings of that treatment, so one treatment is never in two classes.
 */
function classifier(taxonomy: Taxonomy): { classify: (finding: Finding) => Arms; byClass: (value: TreatmentClass | null) => ClassRef } {
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
  const ofNode = (node: TaxonomyNode): TreatmentRef => {
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
  const refsOf = (ids: string[]) => ids.flatMap((id) => { const node = treatmentNode(id); return node ? [ofNode(node)] : [] })
  const classify = (finding: Finding): Arms => {
    // A paper filed under a type of research, with no class and no code of a treatment, is research: the treatment an earlier answer named is not what it is about.
    if (finding.researchType !== null && finding.treatmentClass === null && !finding.treatmentCode) return NO_ARMS
    const name = finding.treatment?.trim() || null
    // The same texts come again for every period and every condition: findTreatments, under armsOf, remembers them with the taxonomy.
    const arms = armsOf(taxonomy, name, finding.comparator)
    const found = refsOf(arms.treatments)
    const node = treatmentNode(finding.treatmentCode)
    const refs: TreatmentRef[] =
      found.length > 0 ? found
      : node ? [ofNode(node)]
      : name || finding.treatmentCode ? [{ key: `name:${(name ?? finding.treatmentCode ?? "").toLowerCase().replace(/\s+/g, " ")}`, class: null }] : []
    if (refs.length === 0) return NO_ARMS
    return { refs, compared: refsOf(arms.comparators).filter((ref) => !refs.some((entry) => entry.key === ref.key)) }
  }
  return { classify, byClass }
}

const inCondition = (findings: Finding[], taxonomy: Taxonomy, code: string) => {
  const codes = new Set(withDescendants(taxonomy, code).map((node) => node.id))
  return findings.filter((finding) => finding.conditionCodes.some((entry) => codes.has(entry)))
}

/** The order of two classes: `other` last, then by papers, then by label. */
const classOrder = (a: { key: string; label: string | null; papers: number }, b: { key: string; label: string | null; papers: number }) =>
  (a.key === OTHER ? 1 : 0) - (b.key === OTHER ? 1 : 0) || b.papers - a.papers || (a.label ?? a.key).localeCompare(b.label ?? b.key)
/** The order of the research groups when they have as many papers: the types, then the papers with no efficacy result, then `other`. */
const RESEARCH_ORDER: ReadonlyArray<ResearchGroup["type"]> = [...RESEARCH_TYPES.filter((type) => type !== OTHER), NO_EFFICACY, OTHER]

interface Organised {
  classes: ClassEvidence[]; safety: SafetyGroup[]; research: ResearchGroup[]; sections: ConditionEvidence["sections"]
  /** The keys of the classes each finding that names a treatment is under, by the finding's key, whatever its kind. */
  classOf: Map<string, Set<string>>
  /** Every class with a paper that names one of its treatments, whatever the paper's kind, in the order of the classes. */
  named: Array<{ key: string; label: string | null; papers: number }>
}
/** What one treatment holds: its efficacy papers, its safety papers, and how many of its papers report no efficacy result. */
interface Slot { key: string; name: string; cls: ClassRef; efficacy: Finding[]; safety: Finding[]; unreported: number; /** The efficacy papers of other treatments it was the comparator in. */ compared: Finding[] }

/**
 * The three sections of `findings`. The class and the spelling of a treatment the pack does not decide are taken from
 * `all` the condition's findings, of which `findings` are those of the scope and the period, so neither changes with them.
 */
function organise(findings: Finding[], all: Finding[], taxonomy: Taxonomy, now: Date, saved?: ReadonlySet<string>): Organised {
  const { classify, byClass } = classifier(taxonomy)
  // One class per treatment: where the pack does not decide it, the class of the earliest-listed finding of that treatment that has one.
  const classGiver = new Map<string, Finding>()
  // A treatment the pack does not know is named as its earliest-listed finding wrote it.
  const firstOf = new Map<string, Finding>()
  for (const finding of all) {
    const { refs } = classify(finding)
    for (const ref of refs) {
      const held = classGiver.get(ref.key)
      // The one class a paper names is the class of its one treatment: with several treatments it says nothing of each.
      if (refs.length === 1 && ref.class === null && finding.treatmentClass && (!held || finding.firstListedAt < held.firstListedAt)) classGiver.set(ref.key, finding)
      const first = firstOf.get(ref.key)
      if (!first || finding.firstListedAt < first.firstListedAt) firstOf.set(ref.key, finding)
    }
  }
  const nodeOf = new Map(taxonomy.nodes.map((node) => [node.id, node]))
  const slots = new Map<string, Slot>()
  const classOf = new Map<string, Set<string>>()
  const labels = new Map<string, string | null>()
  const several = new Set<string>()
  const researchFindings = new Map<ResearchGroup["type"], Finding[]>()
  const sections = { treatments: 0, safety: 0, research: 0 }
  const slotOf = (ref: TreatmentRef, finding: Finding): Slot => {
    const held = slots.get(ref.key)
    if (held) return held
    const first = firstOf.get(ref.key) ?? finding
    const cls = ref.class ?? byClass(classGiver.get(ref.key)?.treatmentClass ?? CLASS_BY_ID[ref.key] ?? null)
    const slot: Slot = { key: ref.key, name: nodeOf.get(ref.key)?.name ?? (first.treatment?.trim() || first.treatmentCode || ref.key), cls, efficacy: [], safety: [], unreported: 0, compared: [] }
    slots.set(ref.key, slot)
    return slot
  }
  for (const finding of findings) {
    const { refs, compared } = classify(finding)
    const efficacy = isEfficacy(finding.kind)
    const safety = finding.kind === "safety"
    if (refs.length === 0 || (!efficacy && !safety)) {
      // No treatment: by the type of research. A treatment and no efficacy or safety result: the one group for all treatments.
      const type = refs.length === 0 ? finding.researchType ?? OTHER : NO_EFFICACY
      researchFindings.set(type, [...(researchFindings.get(type) ?? []), finding])
      sections.research += 1
    } else sections[efficacy ? "treatments" : "safety"] += 1
    if (refs.length === 0) continue
    if (refs.length > 1) several.add(finding.key)
    const mine = new Set<string>()
    classOf.set(finding.key, mine)
    // A comparator counts nothing of the paper: it is in no class for it, and has a bubble only through papers of its own.
    if (efficacy) for (const ref of compared) slotOf(ref, finding).compared.push(finding)
    for (const ref of refs) {
      const slot = slotOf(ref, finding)
      mine.add(slot.cls.key)
      if (!labels.get(slot.cls.key)) labels.set(slot.cls.key, slot.cls.label)
      if (efficacy) slot.efficacy.push(finding)
      else if (safety) slot.safety.push(finding)
      else slot.unreported += 1
    }
  }
  const fresh = (list: Finding[]) => list.filter((finding) => isNew(finding, now)).length
  const studies = (list: Finding[]) => list.map((finding) => studyOf(finding, now, saved, several.has(finding.key)))
  const linesOf = (list: Finding[], kind: FindingKind): Line[] =>
    list.filter((finding) => finding.kind === kind && finding.text?.trim()).slice(0, SHORT_LIST).map((finding) => ({ text: finding.text as string, key: finding.key }))

  // A class counts a paper once, however many of its treatments the paper names.
  const held = new Map<string, { treatments: TreatmentEvidence[]; papers: Map<string, Finding> }>()
  const safetyGroups: SafetyGroup[] = []
  for (const slot of slots.values()) {
    const harms = [...slot.safety].sort(newestFirst)
    if (harms.length > 0) safetyGroups.push({ key: slot.key, name: slot.name, classKey: slot.cls.key, papers: harms.length, newPapers: fresh(harms), studies: studies(harms) })
    if (slot.efficacy.length === 0) continue
    const ordered = [...slot.efficacy].sort(newestFirst)
    const compared = [...slot.compared].sort(newestFirst)
    const entry = held.get(slot.cls.key) ?? { treatments: [], papers: new Map<string, Finding>() }
    held.set(slot.cls.key, entry)
    for (const finding of ordered) entry.papers.set(finding.key, finding)
    entry.treatments.push({
      key: slot.key, name: slot.name, papers: ordered.length, efficacy: efficacyOf(ordered), newPapers: fresh(ordered), safetyPapers: harms.length, unreportedPapers: slot.unreported,
      comparatorPapers: compared.length, comparedIn: studies(compared),
      lines: { benefit: linesOf(ordered, "benefit"), "no-benefit": linesOf(ordered, "no-benefit"), mixed: linesOf(ordered, "mixed"), safety: linesOf(harms, "safety") },
      studies: studies(ordered),
    })
  }
  const classes = [...held].map(([key, entry]): ClassEvidence => {
    const papers = [...entry.papers.values()]
    return { key, label: labels.get(key) ?? null, papers: papers.length, efficacy: efficacyOf(papers), newPapers: fresh(papers), treatments: entry.treatments.sort((a, b) => b.papers - a.papers || a.name.localeCompare(b.name)) }
  }).sort(classOrder)
  safetyGroups.sort((a, b) => b.papers - a.papers || a.name.localeCompare(b.name))
  const research = [...researchFindings].map(([type, list]): ResearchGroup => {
    const mine = [...list].sort(newestFirst)
    return { type, papers: mine.length, newPapers: fresh(mine), studies: studies(mine) }
  }).sort((a, b) => b.papers - a.papers || RESEARCH_ORDER.indexOf(a.type) - RESEARCH_ORDER.indexOf(b.type))
  const tally = new Map<string, number>()
  for (const keys of classOf.values()) for (const key of keys) tally.set(key, (tally.get(key) ?? 0) + 1)
  const named = [...tally].map(([key, papers]) => ({ key, label: labels.get(key) ?? null, papers })).sort(classOrder)
  return { classes, safety: safetyGroups, research, sections, classOf, named }
}

/** The last `count` calendar months ending with `now`'s, oldest first, as YYYY-MM. */
function monthsBefore(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, back) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - back), 1))
    return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

export function buildConditionEvidence(findings: Finding[], taxonomy: Taxonomy, conditionCode: string, opts: { now: Date; savedSlugs?: ReadonlySet<string>; period?: Period; scope?: Scope }): ConditionEvidence | null {
  const node = taxonomy.nodes.find((entry) => entry.id === conditionCode && entry.type === "condition")
  if (!node) return null
  const period = opts.period ?? "all"
  const scope = opts.scope ?? "all"
  const all = inCondition(findings, taxonomy, conditionCode)
  const isSaved = (finding: Finding) => opts.savedSlugs?.has(finding.slug) ?? false
  // The scope first, then the period.
  const scoped = scope === "saved" ? all.filter(isSaved) : all
  const cutoff = period === "all" ? null : daysBefore(opts.now, PERIOD_DAYS[period])
  const mine = cutoff === null ? scoped : scoped.filter((finding) => inPeriod(finding, cutoff))
  const { classes, safety, research, sections, classOf, named } = organise(mine, all, taxonomy, opts.now, opts.savedSlugs)

  const months = monthsBefore(opts.now, TIMELINE_MONTHS)
  // A series per class over every paper that names one of its treatments, whatever the paper found.
  const drawn = named.filter((entry) => entry.key !== OTHER).slice(0, TIMELINE_SERIES)
  const drawnKeys = new Set(drawn.map((entry) => entry.key))
  const counts = (belongs: (finding: Finding) => boolean) => months.map((month) => mine.filter((finding) => belongs(finding) && monthOf(finding, opts.now) === month).length)
  // A paper under two classes is drawn once in each; it is in the rest only when none of its classes has a series.
  const isRest = (finding: Finding) => ![...(classOf.get(finding.key) ?? [])].some((key) => drawnKeys.has(key))
  const series = [
    ...drawn.map((entry) => ({ key: entry.key, label: entry.label, counts: counts((finding) => classOf.get(finding.key)?.has(entry.key) ?? false) })),
    ...(mine.some(isRest) ? [{ key: OTHER, label: null, counts: counts(isRest) }] : []),
  ]
  const since = all.length > 0 ? all.map((finding) => finding.firstListedAt.slice(0, 10)).reduce((a, b) => (a < b ? a : b)) : null
  return {
    condition: { code: node.id, name: node.name }, period, scope, total: mine.length, collected: all.length, savedCount: all.filter(isSaved).length, since,
    sections, classes, safety, research, timeline: { months, series },
  }
}

/** The conditions to show on wiki home: those of the reader's topics and those with findings, each with its three largest classes by efficacy papers. */
export function followedConditions(findings: Finding[], taxonomy: Taxonomy, watched: string[], now: Date): Array<{ code: string; name: string; total: number; recent: number; treatments: Array<{ key: string; label: string | null }> }> {
  const codes = new Set([...watched, ...findings.flatMap((finding) => finding.conditionCodes)])
  return taxonomy.nodes
    .filter((node) => node.type === "condition" && codes.has(node.id))
    .map((node) => {
      const mine = inCondition(findings, taxonomy, node.id)
      const { classes } = organise(mine, mine, taxonomy, now)
      return {
        code: node.id, name: node.name, total: mine.length, recent: mine.filter((finding) => isNew(finding, now)).length,
        treatments: classes.slice(0, TOP_CLASSES).map((entry) => ({ key: entry.key, label: entry.label })),
      }
    })
    .sort((a, b) => b.recent - a.recent || b.total - a.total || a.name.localeCompare(b.name))
}
