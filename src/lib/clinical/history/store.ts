import type { VaultStorage } from "../../vault/storage"
import { FEED_PATH, parseStoredFeed, type StoredFeed } from "../feed/stored"
import { topicLabel } from "../topic-label"

/**
 * Every search is kept: one file per run, holding the list exactly as it was (papers, summaries,
 * order, topics). An earlier search can be reopened as the list on Home, or deleted. Votes, saved
 * papers and the Read later list live in their own files and are not frozen here.
 */
export const HISTORY_DIR = ".scispark/clinical/history/"

export interface HistoryEntry {
  id: string
  generatedAt: string
  lookBack: string
  listed: number
  found: number
  topics: string[]
}

const idOf = (generatedAt: string) => generatedAt.replaceAll(":", "-")
const pathOf = (id: string) => `${HISTORY_DIR}${id}.json`

export async function saveHistory(storage: VaultStorage, feed: StoredFeed): Promise<void> {
  await storage.write(pathOf(idOf(feed.generatedAt)), JSON.stringify(feed))
}

export async function loadHistory(storage: VaultStorage, id: string): Promise<StoredFeed | null> {
  const raw = await storage.read(pathOf(id))
  return raw === null ? null : parseStoredFeed(raw)
}

/** Newest first. A file that cannot be read is left out of the list, not deleted. */
export async function listHistory(storage: VaultStorage): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = []
  for (const path of await storage.list(HISTORY_DIR)) {
    const id = path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "")
    const feed = await loadHistory(storage, id)
    if (!feed) continue
    entries.push({
      id, generatedAt: feed.generatedAt, lookBack: feed.lookBack ?? (feed.mode === "catch-up" ? "6m" : "30d"),
      listed: feed.items.length, found: feed.stats.retrieved,
      topics: (feed.topics ?? []).map(topicLabel),
    })
  }
  return entries.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
}

export async function deleteHistory(storage: VaultStorage, id: string): Promise<void> {
  await storage.delete(pathOf(id))
}

/** Makes an earlier search the list on Home again. The list it replaces is itself in the history. */
export async function restoreHistory(storage: VaultStorage, id: string): Promise<StoredFeed | null> {
  const feed = await loadHistory(storage, id)
  if (feed) await storage.write(FEED_PATH, JSON.stringify(feed))
  return feed
}
