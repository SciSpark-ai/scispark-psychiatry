import type { VaultStorage } from "../../vault/storage"
import { slugifyTitle } from "../../wiki/authoring"
import { TrialRecordSchema, type TrialRecord } from "./schema"

// Where a trial record is stored and how its file is read. No writes here and nothing that needs the
// server: the paper resolver, which also runs in the browser, reads a record through this.

export const RECORDS_DIR = "records"
export const recordPath = (slug: string) => `${RECORDS_DIR}/${slug}.json`
/** A slug as `paperSlug` makes them. Anything else (a path, an empty string) names no record. */
export const isRecordSlug = (slug: string) => slug.length > 0 && slug === slugifyTitle(slug)

/** The record a file holds, or null when the file is missing, damaged or something else. */
export function parseRecord(raw: string | null): TrialRecord | null {
  if (raw === null) return null
  try {
    const parsed = TrialRecordSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The record under a slug, and whether a file is stored there at all: `stored` with no record is a file that cannot be read. */
export async function readRecord(storage: VaultStorage, slug: string): Promise<{ stored: boolean; record: TrialRecord | null }> {
  if (!isRecordSlug(slug)) return { stored: false, record: null }
  const raw = await storage.read(recordPath(slug))
  return { stored: raw !== null, record: parseRecord(raw) }
}
