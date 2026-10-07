import { z } from "zod"
import type { PaperRecord } from "../../papers/types"
import type { VaultStorage } from "../../vault/storage"
import { DESIGNS, DESIGN_SOURCES, MATCHED_PARTS, FEED_MODES, GATE_STRICTNESS, PAGE_SIZE } from "../types"
import type { ScoredItem } from "../score/score"
import type { GatedCandidate } from "../types"

export const FEED_PATH = ".scispark/clinical/feed.json"

const PaperSchema = z.custom<PaperRecord>(
  (value) => typeof value === "object" && value !== null && typeof (value as PaperRecord).title === "string" && typeof (value as PaperRecord).ids === "object",
  "not a paper record",
)

export const StoredItemSchema = z.object({
  paper: PaperSchema,
  key: z.string(),
  design: z.enum(DESIGNS),
  designSource: z.enum(DESIGN_SOURCES),
  entryId: z.string().nullable(),
  grade: z.number(),
  topicGrade: z.number(),
  quote: z.string(),
  quoteVerified: z.boolean(),
  /** Which part of the watch entry the paper matches; the card names only that part. */
  matched: z.enum(MATCHED_PARTS).optional(),
  /** The journal's band (1 leading, 2 established, 3 other), when the journal is known. */
  journalBand: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  ungraded: z.boolean(),
  score: z.number(),
  flags: z.array(z.string()),
  /** AI-written headline and takeaway, present only when every code check passed (digest/card.ts). */
  digest: z.object({ headline: z.string(), takeaway: z.string(), quote: z.string(), tags: z.array(z.string()).optional() }).optional(),
})
export type StoredFeedItem = z.infer<typeof StoredItemSchema>

const StoredFeedSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  mode: z.enum(FEED_MODES),
  /** How far back this list looked ("7d", "6m", ...); see LOOK_BACK in modes.ts. */
  lookBack: z.string().optional(),
  strictness: z.enum(GATE_STRICTNESS),
  items: z.array(StoredItemSchema),
  lowerConfidence: z.array(StoredItemSchema),
  /** Matching papers that were already displayed on an earlier visit; not recommended again. */
  seenEarlier: z.array(StoredItemSchema).optional(),
  /** The active topics when the list was built, so an earlier list can be reopened with its own labels. */
  topics: z.array(z.object({
    id: z.string(), condition: z.string().optional(), condition2: z.string().optional(), conditionJoin: z.enum(["and", "or"]).optional(), treatment: z.string().optional(),
  })).optional(),
  /** AI overview of each topic's papers, by watch entry id: checked sentences with the papers they rest on. */
  topicOverviews: z.record(z.string(), z.array(z.object({
    text: z.string(), sources: z.array(z.string()), group: z.enum(["focus", "related"]).optional(), kind: z.enum(["benefit", "no-benefit", "safety", "other"]).optional(), emphasis: z.array(z.string()).optional(),
  }))).optional(),
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
    ...(item.grade.matched ? { matched: item.grade.matched } : {}),
  }
}

export const toSafetyRef = (candidate: GatedCandidate) => ({ paper: candidate.paper, key: candidate.key })

/** A stored list from its file text; null when the text is not a valid list. */
export function parseStoredFeed(raw: string): StoredFeed | null {
  try {
    const parsed = StoredFeedSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function loadClinicalFeed(storage: VaultStorage): Promise<StoredFeed | null> {
  const raw = await storage.read(FEED_PATH)
  return raw === null ? null : parseStoredFeed(raw)
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
