import { z } from "zod"
import type { VaultStorage } from "../../vault/storage"
import { withVaultExclusive } from "../../vault/exclusive"
import { StoredItemSchema, type StoredFeedItem } from "../feed/stored"

/**
 * Papers the user put aside from the feed to read later. Each is kept as the card it was (with its
 * headline and summary), so the list still shows it after the feed has moved on.
 */
export const READ_LATER_PATH = ".scispark/clinical/read-later.json"

const FileSchema = z.object({ version: z.literal(1), items: z.array(z.unknown()) })

/** Newest first. An unreadable file is an empty list; an unreadable entry is skipped. */
export async function loadReadLater(storage: VaultStorage): Promise<StoredFeedItem[]> {
  try {
    const raw = await storage.read(READ_LATER_PATH)
    if (raw === null) return []
    const file = FileSchema.safeParse(JSON.parse(raw))
    if (!file.success) return []
    return file.data.items.flatMap((entry) => { const item = StoredItemSchema.safeParse(entry); return item.success ? [item.data] : [] })
  } catch {
    return []
  }
}

/** Adds the paper, or removes it if it is already there. Returns whether it is on the list afterwards. */
export async function toggleReadLater(storage: VaultStorage, item: StoredFeedItem): Promise<boolean> {
  return withVaultExclusive(storage, "clinical-read-later", async () => {
    const items = await loadReadLater(storage)
    const present = items.some((entry) => entry.key === item.key)
    const next = present ? items.filter((entry) => entry.key !== item.key) : [item, ...items]
    await storage.write(READ_LATER_PATH, JSON.stringify({ version: 1, items: next }))
    return !present
  })
}
