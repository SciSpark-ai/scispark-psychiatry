import type { DropRecord, WatchEntry } from "../types"
import { LIST_CAP, PAGE_SIZE } from "../types"
import type { ScoredItem } from "../score/score"

/** Stage-A entry grade at or above which an item joins the shortlist (spec 6.9 step 5, initial value). */
export const SHORTLIST_GRADE = 2
/** Grade needed to take a reserved coverage slot (spec 6.8). */
export const COVERAGE_GRADE = 3
export const LOWER_CONFIDENCE_CAP = 24
const NEAR_DUPLICATE = 0.8

export interface SelectedFeed {
  items: ScoredItem[]
  lowerConfidence: ScoredItem[]
  drops: DropRecord[]
}

const words = (title: string) => new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3))

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** Keeps the higher-scored of any pair of near-identical titles (preprint and journal version, for example). */
function suppressDuplicates(sorted: ScoredItem[]): { kept: ScoredItem[]; drops: DropRecord[] } {
  const kept: ScoredItem[] = []
  const keptWords: Array<Set<string>> = []
  const drops: DropRecord[] = []
  for (const item of sorted) {
    const itemWords = words(item.candidate.paper.title)
    if (keptWords.some((existing) => similarity(existing, itemWords) >= NEAR_DUPLICATE)) {
      drops.push({ key: item.candidate.key, title: item.candidate.paper.title, step: "select", reason: "near-duplicate" })
      continue
    }
    kept.push(item)
    keptWords.push(itemWords)
  }
  return { kept, drops }
}

const reservedSlots = (entry: WatchEntry) => (entry.priority === "high" ? 2 : 1)

/**
 * Builds the stored list page by page. On each page of `pageSize`, every active entry first gets its
 * reserved slots (2 for High, 1 for Normal), filled only with items graded 3 or more for that entry;
 * unfilled slots return to the pool, which fills the rest by score. No entry takes more than half a
 * page unless nothing else is left.
 */
export function selectFeed(
  scored: ScoredItem[],
  entries: WatchEntry[],
  opts: { listCap?: number; pageSize?: number; lowerCap?: number } = {},
): SelectedFeed {
  const listCap = opts.listCap ?? LIST_CAP
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const halfPage = Math.floor(pageSize / 2)
  const sorted = [...scored].sort((a, b) => b.score - a.score)
  const { kept, drops } = suppressDuplicates(sorted)

  const shortlist = kept.filter((item) => item.grade.entryId !== null && item.grade.grade >= SHORTLIST_GRADE)
  // Graded non-matches are capped; a paper the grader failed on or skipped is always kept (spec 6.9 step 5).
  const lowerCap = opts.lowerCap ?? LOWER_CONFIDENCE_CAP
  const rest = kept.filter((item) => !shortlist.includes(item))
  const gradedRest = rest.filter((item) => !item.grade.ungraded)
  const lowerConfidence = [...gradedRest.slice(0, lowerCap), ...rest.filter((item) => item.grade.ungraded)]
  const cut = (item: ScoredItem, reason: string) =>
    drops.push({ key: item.candidate.key, title: item.candidate.paper.title, step: "select", reason })
  for (const item of gradedRest.slice(lowerCap)) cut(item, "lower-confidence-cap")

  const active = entries
    .filter((entry) => entry.priority !== "paused")
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high"))
  const pool = [...shortlist]
  const items: ScoredItem[] = []

  while (pool.length > 0 && items.length < listCap) {
    const size = Math.min(pageSize, listCap - items.length)
    const page: ScoredItem[] = []
    const take = (item: ScoredItem) => {
      pool.splice(pool.indexOf(item), 1)
      page.push(item)
    }
    for (const entry of active) {
      const eligible = pool.filter((item) => item.grade.entryId === entry.id && item.grade.grade >= COVERAGE_GRADE)
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
    // Only capped entries were left: relax the cap rather than leave the page short.
    for (const item of [...pool]) {
      if (page.length >= size) break
      take(item)
    }
    items.push(...page.sort((a, b) => b.score - a.score))
  }
  for (const item of pool) cut(item, "list-cap")
  return { items, lowerConfidence, drops }
}
