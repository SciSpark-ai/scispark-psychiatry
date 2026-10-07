import type { LLMProvider, Tier } from "../../llm/types"
import type { LLMSettings } from "../../llm/settings"
import { addCosts } from "../../llm/pricing"
import type { VaultStorage } from "../../vault/storage"
import { DESIGN_TIER, designAccepted, designGate, mentions } from "../filter/gate"
import { resolveFacet } from "../plan/queries"
import { domainFilter } from "../filter/prefilter"
import { gradeStageA } from "../grade/stage-a"
import { verifyMatchedParts } from "../grade/verify-parts"
import { MODES, lookBackOf, searchWindow } from "../modes"
import type { SpecialtyPack } from "../pack/schema"
import { planQueries } from "../plan/skill"
import { retrieve, type EnumerateFn } from "../retrieve/pool"
import { scoreCandidate, type ScoredItem } from "../score/score"
import { JOURNAL_TIER_BOOST, journalTierOf, loadJournalTiers, type JournalTier } from "../score/journal-tiers"
import { digestCards } from "../digest/card"
import { overviewTopics, writeTopicOverviews, type OverviewSentence } from "../digest/topic"
import { saveHistory } from "../history/store"
import { topicLabel } from "../topic-label"
import { displayVenue } from "../text/venue"
import { seenRecently } from "../seen/store"
import { cachedDigest, cachedGrade, keepsGrade, loadFeedCache, saveFeedCache, textHash } from "./cache"
import { layerOf, selectFeed } from "../select/select"
import type { Candidate, ClinicalStage, DropRecord, GatedCandidate, StageAGrade, WatchEntry } from "../types"
import { LIST_CAP } from "../types"
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
  /** Keep this search in the history (history/store.ts). Off unless asked. */
  keepHistory?: boolean
}

const ref = (candidate: Candidate): PoolRef => ({ key: candidate.key, pmid: candidate.paper.ids.pmid, doi: candidate.paper.ids.doi })

/** Places in the stored list for each active topic. */
const PER_TOPIC = 24
const JOURNALS = "journals"
const lower = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()

/** Keys of the candidates whose title or abstract names a condition or treatment of an active watch entry. */
function namesWatchedTerm(candidates: GatedCandidate[], entries: WatchEntry[], pack: SpecialtyPack): Set<string> {
  const terms = [...new Set(entries.filter((entry) => entry.priority !== "paused").flatMap((entry) => [
    ...(entry.condition ? resolveFacet(pack, entry.condition, "condition").words : []),
    ...(entry.condition2 ? resolveFacet(pack, entry.condition2, "condition").words : []),
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
  const { mode, window } = searchWindow(context.settings, now())

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

  // Journal names as they should be read, not as PubMed's catalogue prints them.
  for (const candidate of retrieved.candidates) {
    const venue = displayVenue(candidate.paper.venue, deps.pack.journals)
    if (venue) candidate.paper = { ...candidate.paper, venue }
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
  // What the model said about which part of the entry matches is checked against the paper's text.
  // Done here, on reused grades too, so the check can be improved without paying for grading again.
  const checkedGrades = new Map<string, StageAGrade>()
  for (const candidate of gate.gated) {
    const raw = reused.get(candidate.key) ?? graded.grades.get(candidate.key)
    if (raw) checkedGrades.set(candidate.key, verifyMatchedParts(raw, candidate, context.entries, deps.pack))
  }
  const gradeOf = (key: string) => checkedGrades.get(key) as StageAGrade
  const withGrade = gate.gated.filter((candidate) => reused.has(candidate.key) || graded.grades.has(candidate.key))

  // Where PubMed has not assigned a type, the design the model read from the text replaces the text
  // rule's guess. The same exclusions then apply: a paper the model identifies as, say, a narrative
  // review is left out like one PubMed labelled so.
  const modelDrops: DropRecord[] = []
  const assessed = withGrade.flatMap((candidate): GatedCandidate[] => {
    const named = gradeOf(candidate.key).modelDesign
    if (!named || candidate.designSource === "publication-type") return [candidate]
    if (!designAccepted(context.settings.strictness, named)) {
      modelDrops.push({ key: candidate.key, title: candidate.paper.title, step: "gate", reason: `design:${named}:model` })
      return []
    }
    return [{ ...candidate, design: named, designSource: "model" }]
  })

  deps.onStage?.("select")
  const journalTiers = await loadJournalTiers(storage)
  const bandOf = new Map<string, JournalTier>()
  const scored = assessed.map((candidate) => {
    const tier = journalTierOf(deps.pack.journals, journalTiers, candidate.paper.venue)
    if (tier) bandOf.set(candidate.key, tier)
    const item = scoreCandidate({ candidate, grade: gradeOf(candidate.key), mode, now: now(), journals: deps.pack.journals, journalBoost: tier ? JOURNAL_TIER_BOOST[tier] : 0 })
    return tier ? { ...item, journalBand: tier } : item
  })
  // A paper already displayed to the user is not recommended again: it leaves the list and, if it
  // still matches, is kept under "Seen earlier".
  // Papers are shown by topic, so the list has room for every topic: 24 places for each active one.
  const listCap = Math.max(LIST_CAP, PER_TOPIC * context.entries.length)
  const selected = selectFeed(scored.filter((item) => !context.seen.has(item.candidate.key)), context.entries, { listCap })
  const seenEarlier = scored
    .filter((item) => seenRecently(context.seenAt.get(item.candidate.key), now()) && layerOf(item, context.entries) !== null)
    .sort((a, b) => (layerOf(a, context.entries) as number) - (layerOf(b, context.entries) as number) || b.score - a.score).slice(0, LIST_CAP)

  const toDigest = selected.items.map((item) => ({ key: item.candidate.key, paper: item.candidate.paper, design: item.candidate.design }))
  const knownDigests = new Map(cache ? toDigest.flatMap((item) => { const digest = cachedDigest(cache, item.key, item.paper); return digest && digest.tags !== undefined ? [[item.key, digest] as const] : [] }) : [])
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
    const digest = summaries?.digests.get(item.candidate.key) ?? (cache ? cachedDigest(cache, item.candidate.key, item.candidate.paper) : undefined)
    const journalBand = bandOf.get(item.candidate.key)
    return { ...toStoredItem(item), ...(journalBand ? { journalBand } : {}), ...(digest ? { digest } : {}) }
  }

  // An AI overview per topic, written from the checked summaries of the listed papers (never from abstracts).
  const listedItems = selected.items.map(withDigest)
  const entryLabel = (id: string) => { const entry = context.entries.find((candidate) => candidate.id === id); return entry ? topicLabel(entry) : id }
  const topicOverviews: Record<string, OverviewSentence[]> = {}
  const overviewDrops: Array<{ entryId: string; reason: string }> = []
  if (deps.summarise) {
    const pending = []
    for (const topic of overviewTopics(listedItems)) {
      const hash = `v8|${topic.papers.map((paper) => paper.part[0]).join("")}|${topic.papers.map((paper) => paper.key).join("|")}`
      const kept = cache?.overviews?.[topic.entryId]
      if (kept && kept.hash === hash) topicOverviews[topic.entryId] = kept.value
      else pending.push({ ...topic, label: entryLabel(topic.entryId), hash })
    }
    if (pending.length > 0) {
      const written = await writeTopicOverviews(pending, runOpts)
      costUsd = addCosts(costUsd, written.costUsd)
      overviewDrops.push(...written.dropped)
      for (const topic of pending) {
        const overview = written.overviews[topic.entryId]
        if (!overview) continue
        topicOverviews[topic.entryId] = overview
        if (cache) (cache.overviews ??= {})[topic.entryId] = { hash: topic.hash, at: now().toISOString(), value: overview }
      }
      if (cache) await saveFeedCache(storage, cache, now())
    }
  }

  const generatedAt = now().toISOString()
  const feed: StoredFeed = {
    version: 1, generatedAt, mode, lookBack: lookBackOf(context.settings), strictness: context.settings.strictness,
    items: listedItems,
    topics: context.entries.map(({ id, condition, condition2, conditionJoin, treatment }) => ({
      id, ...(condition ? { condition } : {}), ...(condition2 ? { condition2, conditionJoin: conditionJoin ?? "and" } : {}), ...(treatment ? { treatment } : {}),
    })),
    ...(Object.keys(topicOverviews).length > 0 ? { topicOverviews } : {}),
    lowerConfidence: selected.lowerConfidence.map(toStoredItem),
    ...(seenEarlier.length > 0 ? { seenEarlier: seenEarlier.map(withDigest) } : {}),
    safetySignals: gate.safety.map(toSafetyRef),
    stats: { retrieved: retrieved.candidates.length, domain: domain.kept.length, gated: gate.gated.length, graded: assessed.length, listed: selected.items.length },
    costUsd, warnings,
  }

  const log: RunLog = {
    generatedAt, mode, queryLog: retrieved.queryLog,
    drops: [...retrieved.drops, ...domain.drops, ...gate.drops, ...capped.drops, ...modelDrops, ...selected.drops],
    pool: {
      retrieved: retrieved.candidates.map(ref), domain: domain.kept.map(ref), gated: gate.gated.map(ref),
      shortlisted: scored.filter((s) => layerOf(s, context.entries) !== null).map((s) => ref(s.candidate)),
      listed: selected.items.map((item) => ref(item.candidate)),
    },
    grades: assessed.map((candidate) => gradeOf(candidate.key)),
    ...(cache ? { reusedGrades: reused.size } : {}),
    ...(summaries ? { digestDrops: summaries.dropped } : {}),
    ...(deps.summarise ? { overviewDrops } : {}),
  }
  await saveRunLog(storage, log)

  // An earlier empty feed is not worth protecting; only a feed with papers in it is.
  // A list that is empty only because every match has been seen is a real result ("nothing new"), not a failed run.
  if (feed.items.length === 0 && seenEarlier.length === 0 && previous && previous.items.length > 0) {
    throw new Error(CLINICAL_COPY.run.nothingMatched)
  }
  await saveClinicalFeed(storage, feed)
  if (deps.keepHistory) await saveHistory(storage, feed)
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
