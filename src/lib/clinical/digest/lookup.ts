import { paperKey, type PaperRecord } from "../../papers/types"
import type { VaultStorage } from "../../vault/storage"
import { CACHE_PATH } from "../feed/cache"
import { FEED_PATH } from "../feed/stored"
import type { CardDigest } from "./card"
import { classifyDesign } from "../filter/gate"
import { topicLabel } from "../topic-label"
import { DESIGNS, DESIGN_SOURCES, type Design, type DesignSource } from "../types"

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

export interface PaperCardInfo { digest: CardDigest | null; design?: Design; designSource?: DesignSource; topic?: string }

/**
 * What the list knows about a paper, for the top of the paper page: its AI summary, the kind of study
 * and the topic it was listed under. A paper that is not on the list still gets its kind of study,
 * read from the record the same way the feed reads it.
 */
export async function findPaperCardInfo(storage: VaultStorage, paper: PaperRecord): Promise<PaperCardInfo> {
  const digest = await findCardDigest(storage, paper)
  const key = paperKey(paper)
  let feed: { items?: Array<{ key?: string; design?: unknown; designSource?: unknown; entryId?: unknown }>; topics?: Array<{ id?: string; condition?: string; condition2?: string; conditionJoin?: "and" | "or"; treatment?: string }> } | null = null
  try { const raw = await storage.read(FEED_PATH); feed = raw === null ? null : JSON.parse(raw) } catch { feed = null }
  const listed = feed?.items?.find((item) => item.key === key)
  const design = (DESIGNS as readonly unknown[]).includes(listed?.design) ? (listed?.design as Design) : undefined
  const designSource = (DESIGN_SOURCES as readonly unknown[]).includes(listed?.designSource) ? (listed?.designSource as DesignSource) : undefined
  if (design && designSource) {
    const entry = feed?.topics?.find((topic) => topic.id === listed?.entryId)
    const topic = entry ? topicLabel(entry) : ""
    return { digest, design, designSource, ...(topic ? { topic } : {}) }
  }
  const read = classifyDesign(paper)
  return { digest, design: read.design, designSource: read.source }
}
