import { paperKey, type PaperRecord } from "../../papers/types"
import type { VaultStorage } from "../../vault/storage"
import { CACHE_PATH } from "../feed/cache"
import { FEED_PATH } from "../feed/stored"
import type { CardDigest } from "./card"

/**
 * The AI headline and summary of one paper, for the paper page: from the list on Home, or from the
 * stored summaries when the paper was opened from an earlier list or from Read later. Reads files
 * only, so a page can use it.
 */
export async function findCardDigest(storage: VaultStorage, paper: PaperRecord): Promise<CardDigest | null> {
  const key = paperKey(paper)
  const isDigest = (value: unknown): value is CardDigest =>
    typeof value === "object" && value !== null && typeof (value as CardDigest).headline === "string" && typeof (value as CardDigest).takeaway === "string"
  const read = async (path: string): Promise<unknown> => {
    try { const raw = await storage.read(path); return raw === null ? null : JSON.parse(raw) } catch { return null }
  }
  const feed = (await read(FEED_PATH)) as { items?: Array<{ key?: string; digest?: unknown }>; seenEarlier?: Array<{ key?: string; digest?: unknown }> } | null
  const listed = [...(feed?.items ?? []), ...(feed?.seenEarlier ?? [])].find((item) => item.key === key)?.digest
  const tidy = (digest: CardDigest): CardDigest => {
    const tags = Array.isArray(digest.tags) ? digest.tags.filter((tag) => typeof tag === "string") : []
    return { headline: digest.headline, takeaway: digest.takeaway, quote: typeof digest.quote === "string" ? digest.quote : "", ...(tags.length > 0 ? { tags } : {}) }
  }
  if (isDigest(listed)) return tidy(listed)
  const cache = (await read(CACHE_PATH)) as { digests?: Record<string, { value?: unknown }> } | null
  const kept = cache?.digests?.[key]?.value
  return isDigest(kept) ? tidy(kept) : null
}
