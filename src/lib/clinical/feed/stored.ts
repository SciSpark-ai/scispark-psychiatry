import { z } from "zod"
import type { PaperRecord } from "../../papers/types"
import type { VaultStorage } from "../../vault/storage"
import { DESIGNS, FEED_MODES, GATE_STRICTNESS, PAGE_SIZE } from "../types"
import type { ScoredItem } from "../score/score"
import type { GatedCandidate } from "../types"

export const FEED_PATH = ".scispark/clinical/feed.json"

const PaperSchema = z.custom<PaperRecord>(
  (value) => typeof value === "object" && value !== null && typeof (value as PaperRecord).title === "string" && typeof (value as PaperRecord).ids === "object",
  "not a paper record",
)

const StoredItemSchema = z.object({
  paper: PaperSchema,
  key: z.string(),
  design: z.enum(DESIGNS),
  designSource: z.enum(["publication-type", "text-rule", "none"]),
  entryId: z.string().nullable(),
  grade: z.number(),
  topicGrade: z.number(),
  quote: z.string(),
  quoteVerified: z.boolean(),
  ungraded: z.boolean(),
  score: z.number(),
  flags: z.array(z.string()),
})
export type StoredFeedItem = z.infer<typeof StoredItemSchema>

const StoredFeedSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  mode: z.enum(FEED_MODES),
  strictness: z.enum(GATE_STRICTNESS),
  items: z.array(StoredItemSchema),
  lowerConfidence: z.array(StoredItemSchema),
  safetySignals: z.array(z.object({ paper: PaperSchema, key: z.string() })),
  stats: z.object({ retrieved: z.number(), domain: z.number(), gated: z.number(), graded: z.number(), listed: z.number() }),
  costUsd: z.number().nullable(),
  warnings: z.array(z.string()),
})
export type StoredFeed = z.infer<typeof StoredFeedSchema>

export function toStoredItem(item: ScoredItem): StoredFeedItem {
  return {
    paper: item.candidate.paper, key: item.candidate.key, design: item.candidate.design, designSource: item.candidate.designSource,
    entryId: item.grade.entryId, grade: item.grade.grade, topicGrade: item.grade.topicGrade, quote: item.grade.quote,
    quoteVerified: item.grade.quoteVerified, ungraded: item.grade.ungraded, score: item.score, flags: item.candidate.flags,
  }
}

export const toSafetyRef = (candidate: GatedCandidate) => ({ paper: candidate.paper, key: candidate.key })

export async function loadClinicalFeed(storage: VaultStorage): Promise<StoredFeed | null> {
  const raw = await storage.read(FEED_PATH)
  if (raw === null) return null
  try {
    const parsed = StoredFeedSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function saveClinicalFeed(storage: VaultStorage, feed: StoredFeed): Promise<void> {
  await storage.write(FEED_PATH, JSON.stringify(StoredFeedSchema.parse(feed), null, 2))
}

export const pageCount = (feed: StoredFeed) => Math.max(1, Math.ceil(feed.items.length / PAGE_SIZE))

/** Zero-based page of the stored list; paging makes no model calls. */
export function feedPage(feed: StoredFeed, page: number): StoredFeedItem[] {
  const start = Math.max(0, page) * PAGE_SIZE
  return feed.items.slice(start, start + PAGE_SIZE)
}
