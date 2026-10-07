import type { PaperRecord } from "../../papers/types"
import type { VaultStorage } from "../../vault/storage"

/**
 * The PubMed records the feed has read, kept in the vault by PMID (owner request 2026-10-07: search
 * locally first, then fetch only what is missing). A run still asks PubMed which papers match its
 * queries, which is quick and returns ids only; the records, which are the slow part, are fetched
 * only for papers not held here.
 *
 * PubMed adds MeSH headings and publication types to a record some time after it first appears, and
 * the feed's topic and design checks read them. So a record that had neither when it was read is
 * asked for again once a week has passed, until it is 120 days old.
 */
export const RECORDS_PATH = ".scispark/clinical/papers.json"
const RECHECK_AFTER_DAYS = 7
const GIVE_UP_AFTER_DAYS = 120
const REFRESH_AFTER_DAYS = 30
const KEEP_DAYS = 400
const DAY_MS = 86_400_000

interface Held { record: PaperRecord; at: string; first: string }

export interface RecordStore {
  get(pmid: string): PaperRecord | undefined
  put(record: PaperRecord): void
  /** Writes the store back, without records not read for over a year. */
  save(): Promise<void>
}

const indexed = (record: PaperRecord) =>
  (record.fields ?? []).length > 0 || (record.publicationTypes ?? []).some((type) => type.toLowerCase() !== "journal article")

export async function loadRecordStore(storage: VaultStorage, now: Date): Promise<RecordStore> {
  let held: Record<string, Held> = {}
  try {
    const raw = await storage.read(RECORDS_PATH)
    const parsed = raw === null ? null : (JSON.parse(raw) as { version?: unknown; papers?: unknown })
    if (parsed && parsed.version === 2 && parsed.papers && typeof parsed.papers === "object") held = parsed.papers as Record<string, Held>
  } catch {
    // An unreadable store is an empty one: everything is fetched again.
  }
  const age = (iso: string) => (now.getTime() - new Date(iso).getTime()) / DAY_MS
  return {
    get(pmid) {
      const entry = held[pmid]
      if (!entry) return undefined
      const stale = !indexed(entry.record) && age(entry.at) > RECHECK_AFTER_DAYS && age(entry.first) <= GIVE_UP_AFTER_DAYS
      // An indexed record can still change: a retraction, a correction, a late abstract. It is read again once a month.
      return stale || age(entry.at) > REFRESH_AFTER_DAYS ? undefined : entry.record
    },
    put(record) {
      const pmid = record.ids.pmid
      if (!pmid) return
      held[pmid] = { record, at: now.toISOString(), first: held[pmid]?.first ?? now.toISOString() }
    },
    async save() {
      const kept = Object.fromEntries(Object.entries(held).filter(([, entry]) => age(entry.at) <= KEEP_DAYS))
      await storage.write(RECORDS_PATH, JSON.stringify({ version: 2, papers: kept }))
    },
  }
}
