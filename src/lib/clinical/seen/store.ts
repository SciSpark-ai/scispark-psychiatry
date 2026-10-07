import type { VaultStorage } from "../../vault/storage"
import { withVaultExclusive } from "../../vault/exclusive"

/**
 * Papers that have been displayed to the user: on a page of the list they opened, or in a section
 * they expanded. A displayed paper is not recommended again; later runs move it to "Seen earlier".
 * Papers in the stored list that were never displayed (pages not opened) are not in here.
 */
export const SEEN_PATH = ".scispark/clinical/seen.json"

/**
 * `seen` holds every displayed paper with the first time it was shown. `byLookBack` holds the same
 * per time range ("30d", "7d", ...): a paper is left out of a new list only when it was already
 * shown under the same range (owner decision 2026-10-07), so choosing another range shows it again.
 */
interface SeenFile { version: 1; seen: Record<string, string>; byLookBack?: Record<string, Record<string, string>> }
const DEFAULT_LOOK_BACK = "30d"

async function read(storage: VaultStorage): Promise<SeenFile> {
  try {
    const raw = await storage.read(SEEN_PATH)
    const parsed = raw === null ? null : (JSON.parse(raw) as Partial<SeenFile>)
    if (parsed && parsed.version === 1 && parsed.seen && typeof parsed.seen === "object") {
      return { version: 1, seen: parsed.seen, ...(parsed.byLookBack && typeof parsed.byLookBack === "object" ? { byLookBack: parsed.byLookBack } : {}) }
    }
  } catch {
    // An unreadable file is treated as "nothing seen": the worst case is a repeat, never a lost paper.
  }
  return { version: 1, seen: {} }
}

/** A file written before ranges were kept apart counts as seen under the default range. */
const ranges = (file: SeenFile): Record<string, Record<string, string>> => file.byLookBack ?? { [DEFAULT_LOOK_BACK]: { ...file.seen } }

export async function loadSeen(storage: VaultStorage): Promise<Set<string>> {
  return new Set(Object.keys((await read(storage)).seen))
}

/** When each paper was first displayed: under one time range, or under any when none is given. */
export async function loadSeenTimes(storage: VaultStorage, lookBack?: string): Promise<Map<string, string>> {
  const file = await read(storage)
  return new Map(Object.entries(lookBack === undefined ? file.seen : (ranges(file)[lookBack] ?? {})))
}

/** Records the first time each paper was displayed, overall and under the list's time range. */
export async function recordSeen(storage: VaultStorage, keys: string[], at: Date = new Date(), lookBack: string = DEFAULT_LOOK_BACK): Promise<void> {
  if (keys.length === 0) return
  await withVaultExclusive(storage, "clinical-seen", async () => {
    const file = await read(storage)
    const byLookBack = ranges(file)
    const range = (byLookBack[lookBack] ??= {})
    const fresh = keys.filter((key) => !(key in range))
    if (fresh.length === 0) return
    for (const key of fresh) {
      range[key] = at.toISOString()
      file.seen[key] ??= at.toISOString()
    }
    await storage.write(SEEN_PATH, JSON.stringify({ version: 1, seen: file.seen, byLookBack }))
  })
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

/**
 * Forgets which papers were shown under one time range, so the next search of that range lists them
 * again. Returns how many were forgotten. Other ranges are untouched.
 */
export async function clearSeen(storage: VaultStorage, lookBack: string): Promise<number> {
  return withVaultExclusive(storage, "clinical-seen", async () => {
    const file = await read(storage)
    const byLookBack = ranges(file)
    const forgotten = Object.keys(byLookBack[lookBack] ?? {}).length
    if (forgotten === 0) return 0
    delete byLookBack[lookBack]
    // `seen` keeps only what is still seen under some range.
    const still = new Set(Object.values(byLookBack).flatMap((range) => Object.keys(range)))
    const seen = Object.fromEntries(Object.entries(file.seen).filter(([key]) => still.has(key)))
    await storage.write(SEEN_PATH, JSON.stringify({ version: 1, seen, byLookBack }))
    return forgotten
  })
}
