import type { DropRecord, WatchEntry } from "../types"
import { LIST_CAP, PAGE_SIZE } from "../types"
import type { ScoredItem } from "../score/score"

/** Stage-A entry grade at or above which an item joins the shortlist (spec 6.9 step 5, initial value). */
export const SHORTLIST_GRADE = 2
/** Grade needed to take a reserved coverage slot (spec 6.8). */
export const COVERAGE_GRADE = 3
export const LOWER_CONFIDENCE_CAP = 24

export interface SelectedFeed {
  items: ScoredItem[]
  lowerConfidence: ScoredItem[]
  drops: DropRecord[]
}

/**
 * Keeps the higher-scored of two records with the same title (a preprint and its journal version,
 * for example). Titles that differ by a word are different papers: "in adults" and "in adolescents"
 * were once taken for one (review finding, 2026-10-07).
 */
function suppressDuplicates(sorted: ScoredItem[]): { kept: ScoredItem[]; drops: DropRecord[] } {
  const kept: ScoredItem[] = []
  const titles = new Set<string>()
  const drops: DropRecord[] = []
  for (const item of sorted) {
    const title = (item.candidate.paper.title.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ")
    if (title && titles.has(title)) {
      drops.push({ key: item.candidate.key, title: item.candidate.paper.title, step: "select", reason: "same-title" })
      continue
    }
    kept.push(item)
    titles.add(title)
  }
  return { kept, drops }
}

/**
 * The order within a layer (owner decision 2026-10-07): leading journals first, then established
 * ones, then every other journal, known or not; within each of these, by score.
 */
const byBandThenScore = (a: ScoredItem, b: ScoredItem) => (a.journalBand ?? 3) - (b.journalBand ?? 3) || b.score - a.score

const reservedSlots = (entry: WatchEntry) => (entry.priority === "high" ? 2 : 1)

/**
 * The layer a paper is listed in: 1 matches a condition and a treatment together, 2 matches a
 * condition, 3 matches only a treatment; null is not a match. A watch entry that names only a
 * condition therefore sits in layer 2 with the other condition matches, and one that names only a
 * treatment in layer 3. A grade made before the model said which part matches has no layer of its
 * own and counts as layer 1 when its grade reaches the shortlist.
 */
export function layerOf(item: ScoredItem, entries: WatchEntry[] = []): 1 | 2 | 3 | null {
  const grade = item.grade
  if (grade.ungraded || grade.entryId === null) return null
  if (grade.matched === "condition") return 2
  if (grade.matched === "treatment") return 3
  if (grade.matched === "full") {
    const entry = entries.find((candidate) => candidate.id === grade.entryId)
    if (entry && !entry.treatment) return 2
    if (entry && !entry.condition) return 3
    return 1
  }
  return grade.grade >= SHORTLIST_GRADE ? 1 : null
}

/**
 * Orders the papers of one layer. In turns of `pageSize`, every active entry first gets its reserved
 * places (2 for High, 1 for Normal), filled only with full or strongly graded matches; unfilled
 * places return to the pool, which fills the rest by score. No entry takes more than half a turn
 * unless nothing else is left.
 */
function arrange(layer: ScoredItem[], active: WatchEntry[], limit: number, pageSize: number): ScoredItem[] {
  const halfPage = Math.floor(pageSize / 2)
  const pool = [...layer].sort(byBandThenScore)
  const items: ScoredItem[] = []
  while (pool.length > 0 && items.length < limit) {
    const size = Math.min(pageSize, limit - items.length)
    const page: ScoredItem[] = []
    const take = (item: ScoredItem) => {
      pool.splice(pool.indexOf(item), 1)
      page.push(item)
    }
    for (const entry of active) {
      const eligible = pool.filter((item) => item.grade.entryId === entry.id && (item.grade.matched === "full" || item.grade.grade >= COVERAGE_GRADE))
      for (const item of eligible.slice(0, Math.min(reservedSlots(entry), halfPage))) if (page.length < size) take(item)
    }
    const countFor = (id: string | null) => page.filter((item) => item.grade.entryId === id).length
    for (const item of [...pool]) {
      if (page.length >= size) break
      const id = item.grade.entryId
      const othersWaiting = pool.some((other) => other.grade.entryId !== id)
      if (countFor(id) >= halfPage && othersWaiting) continue
      take(item)
    }
    // Only capped entries were left: relax the cap rather than leave the turn short.
    for (const item of [...pool]) {
      if (page.length >= size) break
      take(item)
    }
    items.push(...page)
  }
  // The places each topic was given stay; inside a topic the papers go in order of journal band, then
  // score, so that a topic's own tab reads in that order from first to last.
  const queues = new Map<string | null, ScoredItem[]>()
  for (const item of [...items].sort(byBandThenScore)) queues.set(item.grade.entryId, [...(queues.get(item.grade.entryId) ?? []), item])
  return items.map((item) => (queues.get(item.grade.entryId) as ScoredItem[]).shift() as ScoredItem)
}

/**
 * Builds the stored list: full matches first, then papers that match only the condition of a watch
 * entry, then papers that match only its treatment (owner decision 2026-10-06). Each layer is
 * ordered by `arrange`; the list is cut at `listCap`, so the last layer is the first to be cut.
 */
export function selectFeed(
  scored: ScoredItem[],
  entries: WatchEntry[],
  opts: { listCap?: number; pageSize?: number; lowerCap?: number } = {},
): SelectedFeed {
  const listCap = opts.listCap ?? LIST_CAP
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  const { kept, drops } = suppressDuplicates(sorted)
  const cut = (item: ScoredItem, reason: string) =>
    drops.push({ key: item.candidate.key, title: item.candidate.paper.title, step: "select", reason })

  const shortlist = kept.filter((item) => layerOf(item, entries) !== null)
  // A paper graded 1 with no word on which part matches ("loosely related") is not shown anywhere.
  const loose = (item: ScoredItem) => !item.grade.ungraded && !item.grade.matched && item.grade.entryId !== null && item.grade.grade > 0 && item.grade.grade < SHORTLIST_GRADE
  // Graded non-matches are capped; a paper the grader failed on or skipped is always kept (spec 6.9 step 5).
  const lowerCap = opts.lowerCap ?? LOWER_CONFIDENCE_CAP
  const rest = kept.filter((item) => layerOf(item, entries) === null && !loose(item))
  const gradedRest = rest.filter((item) => !item.grade.ungraded)
  const lowerConfidence = [...gradedRest.slice(0, lowerCap), ...rest.filter((item) => item.grade.ungraded)]
  for (const item of gradedRest.slice(lowerCap)) cut(item, "lower-confidence-cap")
  for (const item of kept.filter(loose)) cut(item, "loosely-related")

  const active = entries
    .filter((entry) => entry.priority !== "paused")
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high"))
  const items: ScoredItem[] = []
  for (const layer of [1, 2, 3] as const) {
    items.push(...arrange(shortlist.filter((item) => layerOf(item, entries) === layer), active, listCap - items.length, pageSize))
  }
  for (const item of shortlist.filter((entry) => !items.includes(entry))) cut(item, "list-cap")
  return { items, lowerConfidence, drops }
}
