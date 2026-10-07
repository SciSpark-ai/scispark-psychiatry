import type { VaultStorage } from "../../vault/storage"
import { withVaultExclusive } from "../../vault/exclusive"

/**
 * Papers that have been displayed to the user: on a page of the list they opened, or in a section
 * they expanded. A displayed paper is not recommended again; later runs move it to "Seen earlier".
 * Papers in the stored list that were never displayed (pages not opened) are not in here.
 */
export const SEEN_PATH = ".scispark/clinical/seen.json"

interface SeenFile { version: 1; seen: Record<string, string> }

async function read(storage: VaultStorage): Promise<SeenFile> {
  try {
    const raw = await storage.read(SEEN_PATH)
    const parsed = raw === null ? null : (JSON.parse(raw) as Partial<SeenFile>)
    if (parsed && parsed.version === 1 && parsed.seen && typeof parsed.seen === "object") return { version: 1, seen: parsed.seen }
  } catch {
    // An unreadable file is treated as "nothing seen": the worst case is a repeat, never a lost paper.
  }
  return { version: 1, seen: {} }
}

export async function loadSeen(storage: VaultStorage): Promise<Set<string>> {
  return new Set(Object.keys((await read(storage)).seen))
}

/** When each paper was first displayed. */
export async function loadSeenTimes(storage: VaultStorage): Promise<Map<string, string>> {
  return new Map(Object.entries((await read(storage)).seen))
}

/**
 * How long a displayed paper stays under "Seen earlier" (owner decision 2026-10-06: about a day, so
 * the section does not pile up). After that it is still remembered as seen, and so never recommended
 * again, but it is no longer shown.
 */
export const SEEN_EARLIER_HOURS = 24

export function seenRecently(seenAt: string | undefined, now: Date): boolean {
  return seenAt !== undefined && now.getTime() - new Date(seenAt).getTime() < SEEN_EARLIER_HOURS * 3_600_000
}

/** Records the first time each paper was displayed. */
export async function recordSeen(storage: VaultStorage, keys: string[], at: Date = new Date()): Promise<void> {
  if (keys.length === 0) return
  await withVaultExclusive(storage, "clinical-seen", async () => {
    const file = await read(storage)
    const fresh = keys.filter((key) => !(key in file.seen))
    if (fresh.length === 0) return
    for (const key of fresh) file.seen[key] = at.toISOString()
    await storage.write(SEEN_PATH, JSON.stringify(file))
  })
}
