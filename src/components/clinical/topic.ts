import type { StoredFeedItem } from "@/lib/clinical/feed/stored"
import type { WatchEntry } from "@/lib/clinical/types"
import { conditionLabel, topicLabel } from "@/lib/clinical/topic-label"

/** A watch entry as the user wrote it. */
export const entryLabel = (entry: WatchEntry) => topicLabel(entry)

/**
 * What a card says about why a paper is there, and which tint it takes. The card names only the
 * part of the watch entry the paper matches: both, the condition, or the treatment.
 */
export function topicLookup(entries: WatchEntry[]) {
  const byId = new Map<string, { entry: WatchEntry; index: number }>()
  entries.forEach((entry, index) => byId.set(entry.id, { entry, index }))
  return {
    topicOf(item: StoredFeedItem): string | undefined {
      const entry = item.entryId ? byId.get(item.entryId)?.entry : undefined
      if (!entry) return undefined
      if (item.matched === "condition" && entry.condition) return conditionLabel(entry)
      if (item.matched === "treatment" && entry.treatment) return entry.treatment
      return entryLabel(entry)
    },
    toneOf: (item: StoredFeedItem): number | undefined => (item.entryId ? byId.get(item.entryId)?.index : undefined),
  }
}
