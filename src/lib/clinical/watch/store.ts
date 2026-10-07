import { z } from "zod"
import type { VaultStorage } from "../../vault/storage"
import { withVaultExclusive } from "../../vault/exclusive"
import { ClinicalSettingsSchema, WatchEntrySchema, type ClinicalSettings, type WatchEntry } from "../types"

export const WATCH_PATH = ".scispark/clinical/watch.json"
export const SETTINGS_PATH = ".scispark/clinical/settings.json"
const LOCK = "clinical-config"

async function readJson(storage: VaultStorage, path: string): Promise<unknown> {
  const raw = await storage.read(path)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Valid entries only; an entry that fails validation is skipped rather than blocking the feed. */
export async function loadWatchEntries(storage: VaultStorage): Promise<WatchEntry[]> {
  const parsed = z.object({ entries: z.array(z.unknown()) }).safeParse(await readJson(storage, WATCH_PATH))
  if (!parsed.success) return []
  return parsed.data.entries.flatMap((entry) => {
    const result = WatchEntrySchema.safeParse(entry)
    return result.success ? [result.data] : []
  })
}

/** Validates every entry and rejects duplicates before writing. */
export async function saveWatchEntries(storage: VaultStorage, entries: WatchEntry[]): Promise<void> {
  const valid = entries.map((entry) => WatchEntrySchema.parse(entry))
  if (new Set(valid.map((entry) => entry.id)).size !== valid.length) throw new Error("watch entry ids must be unique")
  await withVaultExclusive(storage, LOCK, async () => {
    // Entries the file holds that this version cannot read are copied aside before the file is written again.
    const held = z.object({ entries: z.array(z.unknown()) }).safeParse(await readJson(storage, WATCH_PATH))
    const unreadable = held.success ? held.data.entries.filter((entry) => !WatchEntrySchema.safeParse(entry).success) : []
    if (unreadable.length > 0) await storage.write(WATCH_PATH.replace(/\.json$/, ".unreadable.json"), JSON.stringify({ entries: unreadable }, null, 2))
    await storage.write(WATCH_PATH, JSON.stringify({ version: 1, entries: valid }, null, 2))
  })
}

export async function loadClinicalSettings(storage: VaultStorage): Promise<ClinicalSettings> {
  const parsed = ClinicalSettingsSchema.safeParse((await readJson(storage, SETTINGS_PATH)) ?? {})
  return parsed.success ? parsed.data : ClinicalSettingsSchema.parse({})
}

export async function saveClinicalSettings(storage: VaultStorage, settings: ClinicalSettings): Promise<void> {
  const valid = ClinicalSettingsSchema.parse(settings)
  await withVaultExclusive(storage, LOCK, () => storage.write(SETTINGS_PATH, JSON.stringify(valid, null, 2)))
}

export function newEntryId(): string {
  return `w-${crypto.randomUUID().slice(0, 8)}`
}
