import { z } from "zod"
import type { VaultStorage } from "../../vault/storage"
import { withVaultExclusive } from "../../vault/exclusive"

export const FEEDBACK_PATH = ".scispark/clinical/feedback.json"
export const FEEDBACK_KINDS = ["relevant", "practice-change", "not-relevant"] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const FeedbackEventSchema = z.object({
  paperKey: z.string().min(1),
  title: z.string(),
  kind: z.enum(FEEDBACK_KINDS),
  at: z.string(),
})
export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>

export async function loadFeedback(storage: VaultStorage): Promise<FeedbackEvent[]> {
  const raw = await storage.read(FEEDBACK_PATH)
  if (raw === null) return []
  try {
    const parsed = z.object({ events: z.array(z.unknown()) }).parse(JSON.parse(raw))
    return parsed.events.flatMap((event) => {
      const result = FeedbackEventSchema.safeParse(event)
      return result.success ? [result.data] : []
    })
  } catch {
    return []
  }
}

/** One current opinion per paper: a new vote replaces the old one. */
export async function recordFeedback(storage: VaultStorage, event: FeedbackEvent): Promise<FeedbackEvent[]> {
  const valid = FeedbackEventSchema.parse(event)
  return withVaultExclusive(storage, "clinical-feedback", async () => {
    const events = [...(await loadFeedback(storage)).filter((existing) => existing.paperKey !== valid.paperKey), valid]
    await storage.write(FEEDBACK_PATH, JSON.stringify({ version: 1, events }, null, 2))
    return events
  })
}

/** Titles of papers the user marked relevant or practice-changing, newest first. They anchor stage-A grading. */
export function exemplarTitles(events: FeedbackEvent[], limit = 10): string[] {
  return events
    .filter((event) => event.kind !== "not-relevant")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((event) => event.title)
}

/** Papers the user marked not relevant are left out of later runs. */
export function dismissedKeys(events: FeedbackEvent[]): Set<string> {
  return new Set(events.filter((event) => event.kind === "not-relevant").map((event) => event.paperKey))
}
