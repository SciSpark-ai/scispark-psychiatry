import type { PaperRecord } from "../../papers/types"
import type { VaultStorage } from "../../vault/storage"
import type { CardDigest } from "../digest/card"
import type { OverviewSentence } from "../digest/topic"
import type { StageAGrade, WatchEntry } from "../types"

/**
 * What a run has already paid a model for, kept in the vault so the next run does not ask again:
 * stage-A grades and card summaries, by paper. A model gives the same paper a different grade from
 * one call to the next, so without this the list changes on every refresh.
 *
 * - A grade is reused only while the watch list is the same (a grade is a match to a watch entry)
 *   and the paper's title and abstract are the same (PubMed records gain abstracts later).
 * - A summary depends only on the paper's text.
 * - Not kept: a paper the model skipped, and a positive grade the quote check zeroed. Both are
 *   asked for again on the next run.
 */
export const CACHE_PATH = ".scispark/clinical/cache.json"
const KEEP_DAYS = 400

interface Kept<T> { hash: string; at: string; value: T; /** The checks the value passed (card summaries only). */ scheme?: number }
/** Raised when the checks on a card summary change, so that one accepted under earlier checks is written again. 2: the summary must share its words with the paper. */
export const DIGEST_SCHEME = 2
export interface FeedCache {
  version: 1
  /** The watch list the grades belong to. */
  entriesKey: string
  grades: Record<string, Kept<StageAGrade>>
  digests: Record<string, Kept<CardDigest>>
  /** Topic overviews by watch entry id; `hash` is the list of papers the overview was written for. */
  overviews?: Record<string, Kept<OverviewSentence[]>>
}

/** Everything about the active watch entries that a grade depends on. */
/** Raised when the grading question changes, so that grades of the earlier question are not reused. 2: the model says which part of the entry matches. */
const GRADE_SCHEME = 2

export function entriesKey(entries: WatchEntry[]): string {
  return `scheme ${GRADE_SCHEME} ` + JSON.stringify(entries
    .filter((entry) => entry.priority !== "paused")
    .map(({ id, condition, condition2, conditionJoin, treatment, population, outcome }) =>
      [id, condition ?? "", treatment ?? "", population ?? "", outcome ?? "", ...(condition2 ? [condition2, conditionJoin ?? "and"] : [])])
    .sort((a, b) => a[0].localeCompare(b[0])))
}

/** A short fingerprint of the text a model was shown. */
export function textHash(paper: PaperRecord): string {
  const text = `${paper.title}\n${paper.abstract ?? ""}`
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

const empty = (key: string): FeedCache => ({ version: 1, entriesKey: key, grades: {}, digests: {} })

/** The cache for this watch list. A missing or unreadable file is an empty cache; a different watch list drops the grades. */
export async function loadFeedCache(storage: VaultStorage, entries: WatchEntry[]): Promise<FeedCache> {
  const key = entriesKey(entries)
  try {
    const raw = await storage.read(CACHE_PATH)
    if (raw === null) return empty(key)
    const parsed = JSON.parse(raw) as Partial<FeedCache>
    if (parsed.version !== 1 || typeof parsed.grades !== "object" || typeof parsed.digests !== "object") return empty(key)
    return {
      version: 1, entriesKey: key, grades: parsed.entriesKey === key ? (parsed.grades ?? {}) : {}, digests: parsed.digests ?? {},
      overviews: parsed.entriesKey === key && parsed.overviews && typeof parsed.overviews === "object" ? parsed.overviews : {},
    }
  } catch {
    return empty(key)
  }
}

export async function saveFeedCache(storage: VaultStorage, cache: FeedCache, now: Date): Promise<void> {
  const oldest = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString()
  const fresh = <T>(kept: Record<string, Kept<T>>) => Object.fromEntries(Object.entries(kept).filter(([, entry]) => entry.at >= oldest))
  await storage.write(CACHE_PATH, JSON.stringify({ ...cache, grades: fresh(cache.grades), digests: fresh(cache.digests), overviews: fresh(cache.overviews ?? {}) }))
}

export function cachedGrade(cache: FeedCache, key: string, paper: PaperRecord): StageAGrade | undefined {
  const kept = cache.grades[key]
  return kept && kept.hash === textHash(paper) ? kept.value : undefined
}

export function cachedDigest(cache: FeedCache, key: string, paper: PaperRecord): CardDigest | undefined {
  const kept = cache.digests[key]
  return kept && kept.scheme === DIGEST_SCHEME && kept.hash === textHash(paper) ? kept.value : undefined
}

/** A grade worth keeping: the model answered, and its answer was not thrown out by the quote check. */
export const keepsGrade = (grade: StageAGrade): boolean =>
  !grade.ungraded && !((grade.modelGrade ?? 0) > 0 && grade.grade === 0 && !grade.quoteVerified)
