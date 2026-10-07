import type { LLMProvider, Tier } from "../../llm/types"
import type { LLMSettings } from "../../llm/settings"
import { addCosts } from "../../llm/pricing"
import type { VaultStorage } from "../../vault/storage"
import { DESIGN_TIER, designGate, mentions } from "../filter/gate"
import { resolveFacet } from "../plan/queries"
import { domainFilter } from "../filter/prefilter"
import { gradeStageA } from "../grade/stage-a"
import { MODES, windowFor } from "../modes"
import type { SpecialtyPack } from "../pack/schema"
import { planQueries } from "../plan/skill"
import { retrieve, type EnumerateFn } from "../retrieve/pool"
import { scoreCandidate, type ScoredItem } from "../score/score"
import { digestCards } from "../digest/card"
import { cachedDigest, cachedGrade, keepsGrade, loadFeedCache, saveFeedCache, textHash } from "./cache"
import { selectFeed, SHORTLIST_GRADE } from "../select/select"
import type { Candidate, ClinicalStage, DropRecord, GatedCandidate, StageAGrade, WatchEntry } from "../types"
import { assembleContext } from "./context"
import { saveRunLog, type PoolRef, type RunLog } from "./run-log"
import { loadClinicalFeed, saveClinicalFeed, toSafetyRef, toStoredItem, type StoredFeed, type StoredFeedItem } from "./stored"
import { CLINICAL_COPY } from "../copy"

export interface ClinicalFeedDeps {
  pack: SpecialtyPack
  enumerate: EnumerateFn
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
  onStage?: (stage: ClinicalStage) => void
  /** Write an AI headline and takeaway for each listed paper (one more `fast` call per 12 papers). Off unless asked. */
  summarise?: boolean
  /** Reuse grades and summaries from earlier runs (feed/cache.ts). Off unless asked. */
  useCache?: boolean
}

const ref = (candidate: Candidate): PoolRef => ({ key: candidate.key, pmid: candidate.paper.ids.pmid, doi: candidate.paper.ids.doi })

const JOURNALS = "journals"
const lower = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()

/** Keys of the candidates whose title or abstract names a condition or treatment of an active watch entry. */
function namesWatchedTerm(candidates: GatedCandidate[], entries: WatchEntry[], pack: SpecialtyPack): Set<string> {
  const terms = [...new Set(entries.filter((entry) => entry.priority !== "paused").flatMap((entry) => [
    ...(entry.condition ? resolveFacet(pack, entry.condition, "condition").words : []),
    ...(entry.treatment ? resolveFacet(pack, entry.treatment, "treatment").words : []),
  ]).map(lower))]
  return new Set(candidates
    .filter((candidate) => { const text = lower(`${candidate.paper.title} ${candidate.paper.abstract ?? ""}`); return terms.some((term) => mentions(text, term)) })
    .map((candidate) => candidate.key))
}

/**
 * Step 4 cap: when the pool exceeds the mode's cap, places are shared in turns between the watch
 * entries (two per turn for a High entry, one otherwise) and the journal pool, so that one broad
 * entry cannot use up the cap. Within a source, stronger designs and newer papers go first; in the
 * journal pool, papers that name a watched condition or treatment go before the rest.
 */
export function capCandidates(
  candidates: GatedCandidate[], cap: number, opts: { entries?: WatchEntry[]; pack?: SpecialtyPack } = {},
): { kept: GatedCandidate[]; drops: DropRecord[] } {
  if (candidates.length <= cap) return { kept: candidates, drops: [] }
  const byQuality = (a: GatedCandidate, b: GatedCandidate) =>
    DESIGN_TIER[b.design] - DESIGN_TIER[a.design] || (b.paper.date ?? "").localeCompare(a.paper.date ?? "")
  const named = opts.entries && opts.pack ? namesWatchedTerm(candidates, opts.entries, opts.pack) : new Set<string>()

  const sources = new Map<string, GatedCandidate[]>()
  for (const candidate of candidates) {
    const hit = candidate.provenance.find((p) => p.tier === "entry")
    const source = hit ? `entry:${hit.entryId ?? ""}` : JOURNALS
    sources.set(source, [...(sources.get(source) ?? []), candidate])
  }
  const journals = (sources.get(JOURNALS) ?? []).sort((a, b) => Number(named.has(b.key)) - Number(named.has(a.key)) || byQuality(a, b))
  sources.delete(JOURNALS)
  const priority = new Map((opts.entries ?? []).map((entry) => [`entry:${entry.id}`, entry.priority]))
  const turns = [
    ...[...sources].map(([source, pool]) => ({ pool: pool.sort(byQuality), places: priority.get(source) === "high" ? 2 : 1 })),
    { pool: journals, places: 1 },
  ]

  const kept: GatedCandidate[] = []
  while (kept.length < cap) {
    for (const turn of turns) kept.push(...turn.pool.splice(0, Math.min(turn.places, cap - kept.length)))
  }
  return {
    kept,
    drops: turns.flatMap((turn) => turn.pool).map((candidate) => ({ key: candidate.key, title: candidate.paper.title, step: "cap", reason: `over-cap:${cap}` })),
  }
}

/**
 * One recall-first run (spec 6.9, steps 0–5 and 9–10; stage A only). Writes the stored list and a run log.
 * A run that fails, or finds nothing while a previous list exists, leaves the previous list untouched.
 */
export async function runClinicalFeed(storage: VaultStorage, deps: ClinicalFeedDeps): Promise<StoredFeed> {
  const now = deps.now ?? (() => new Date())
  const runOpts = { storage, settings: deps.settings, providerOverride: deps.providerOverride, now }
  const warnings: string[] = []
  let costUsd: number | null = 0

  deps.onStage?.("context")
  const context = await assembleContext(storage)
  const mode = context.settings.mode
  const window = windowFor(mode, now(), context.settings.catchUpMonths)

  deps.onStage?.("plan")
  const planned = await planQueries(deps.pack, context.entries, window, runOpts)
  warnings.push(...planned.warnings)
  costUsd = addCosts(costUsd, planned.costUsd)

  deps.onStage?.("retrieve")
  const retrieved = await retrieve(deps.enumerate, planned.plan, { exclude: context.exclude })
  for (const entry of retrieved.queryLog) {
    if (entry.error) warnings.push(CLINICAL_COPY.run.queryFailed(entry.error))
    if (entry.truncated) warnings.push(CLINICAL_COPY.run.truncated(entry.total, entry.returned, entry.rationale))
  }
  // A run in which half or more of the searches failed would replace a full list with a thin one.
  // Stop here, before any grading is paid for, when there is a list worth protecting.
  const previous = await loadClinicalFeed(storage)
  const failedQueries = retrieved.queryLog.filter((entry) => entry.error).length
  if (previous && previous.items.length > 0 && failedQueries * 2 >= retrieved.queryLog.length) {
    throw new Error(CLINICAL_COPY.run.tooManyQueriesFailed(failedQueries, retrieved.queryLog.length))
  }

  deps.onStage?.("filter")
  const domain = domainFilter(deps.pack, retrieved.candidates)
  const gate = designGate(deps.pack, context.entries, domain.kept, context.settings.strictness)
  // Papers graded on an earlier run keep their grade and take no place under the cap, so each run
  // spends the cap on papers that have not been graded yet.
  const cache = deps.useCache ? await loadFeedCache(storage, context.entries) : null
  const reused = new Map<string, StageAGrade>()
  if (cache) {
    for (const candidate of gate.gated) {
      const grade = cachedGrade(cache, candidate.key, candidate.paper)
      if (grade) reused.set(candidate.key, grade)
    }
  }
  const capped = capCandidates(gate.gated.filter((candidate) => !reused.has(candidate.key)), MODES[mode].candidateCap, { entries: context.entries, pack: deps.pack })

  deps.onStage?.("grade")
  const graded = await gradeStageA(capped.kept, context.entries, context.exemplars, runOpts)
  costUsd = addCosts(costUsd, graded.costUsd)
  if (graded.failedBatches > 0) warnings.push(CLINICAL_COPY.run.gradingBatchesFailed(graded.failedBatches))
  const gradeOf = (key: string) => (reused.get(key) ?? graded.grades.get(key)) as StageAGrade
  const assessed = gate.gated.filter((candidate) => reused.has(candidate.key) || graded.grades.has(candidate.key))

  deps.onStage?.("select")
  const scored = assessed.map((candidate) =>
    scoreCandidate({ candidate, grade: gradeOf(candidate.key), mode, now: now(), journals: deps.pack.journals }))
  const selected = selectFeed(scored, context.entries)

  const toDigest = selected.items.map((item) => ({ key: item.candidate.key, paper: item.candidate.paper, design: item.candidate.design }))
  const knownDigests = new Map(cache ? toDigest.flatMap((item) => { const digest = cachedDigest(cache, item.key, item.paper); return digest ? [[item.key, digest] as const] : [] }) : [])
  const summaries = deps.summarise ? await digestCards(toDigest, { ...runOpts, known: knownDigests }) : null
  if (summaries) {
    costUsd = addCosts(costUsd, summaries.costUsd)
    if (summaries.failed) warnings.push(CLINICAL_COPY.run.summariesFailed)
  }

  if (cache) {
    // Saved before anything below can stop the run: these answers are paid for.
    const at = now().toISOString()
    for (const candidate of capped.kept) {
      const grade = graded.grades.get(candidate.key)
      if (grade && keepsGrade(grade)) cache.grades[candidate.key] = { hash: textHash(candidate.paper), at, value: grade }
    }
    for (const item of toDigest) {
      const digest = summaries?.digests.get(item.key)
      if (digest && !knownDigests.has(item.key)) cache.digests[item.key] = { hash: textHash(item.paper), at, value: digest }
    }
    await saveFeedCache(storage, cache, now())
  }
  const withDigest = (item: ScoredItem): StoredFeedItem => {
    const digest = summaries?.digests.get(item.candidate.key)
    return digest ? { ...toStoredItem(item), digest } : toStoredItem(item)
  }

  const generatedAt = now().toISOString()
  const feed: StoredFeed = {
    version: 1, generatedAt, mode, strictness: context.settings.strictness,
    items: selected.items.map(withDigest),
    lowerConfidence: selected.lowerConfidence.map(toStoredItem),
    safetySignals: gate.safety.map(toSafetyRef),
    stats: { retrieved: retrieved.candidates.length, domain: domain.kept.length, gated: gate.gated.length, graded: assessed.length, listed: selected.items.length },
    costUsd, warnings,
  }

  const log: RunLog = {
    generatedAt, mode, queryLog: retrieved.queryLog,
    drops: [...retrieved.drops, ...domain.drops, ...gate.drops, ...capped.drops, ...selected.drops],
    pool: {
      retrieved: retrieved.candidates.map(ref), domain: domain.kept.map(ref), gated: gate.gated.map(ref),
      shortlisted: scored.filter((s) => s.grade.entryId !== null && s.grade.grade >= SHORTLIST_GRADE).map((s) => ref(s.candidate)),
      listed: selected.items.map((item) => ref(item.candidate)),
    },
    grades: assessed.map((candidate) => gradeOf(candidate.key)),
    ...(cache ? { reusedGrades: reused.size } : {}),
    ...(summaries ? { digestDrops: summaries.dropped } : {}),
  }
  await saveRunLog(storage, log)

  // An earlier empty feed is not worth protecting; only a feed with papers in it is.
  if (feed.items.length === 0 && previous && previous.items.length > 0) {
    throw new Error(CLINICAL_COPY.run.nothingMatched)
  }
  await saveClinicalFeed(storage, feed)
  return feed
}

const inFlight = new WeakMap<VaultStorage, Promise<StoredFeed>>()

/** A second refresh while one is running joins it instead of paying for duplicate work. */
export function runClinicalFeedSingleFlight(storage: VaultStorage, deps: ClinicalFeedDeps): Promise<StoredFeed> {
  const existing = inFlight.get(storage)
  if (existing) return existing
  const run = runClinicalFeed(storage, deps).finally(() => inFlight.delete(storage))
  inFlight.set(storage, run)
  return run
}
