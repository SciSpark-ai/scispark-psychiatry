import type { VaultStorage } from "../../vault/storage"
import type { Journal } from "../pack/schema"
import { normaliseJournalName } from "./score"

/**
 * Journals come in three bands (1 highest). A paper from a higher band is listed earlier within
 * its match layer; a band never moves a paper to another layer.
 *
 * The bands ship with the pack (`band` in journals.json), from a list made by hand
 * (journal-bands.json); no journal metric is used, so the pack can be distributed freely. A user
 * may overrule the bands with a file of their own in the vault, by ISSN. Whoever fills that file
 * from someone else's journal metric must keep to that source's terms of use.
 */
export const JOURNAL_TIERS_PATH = ".scispark/clinical/journal-tiers.json"
export type JournalTier = 1 | 2 | 3

/** Points added to a paper's score (0 to 100) by its journal's tier. Initial values. */
export const JOURNAL_TIER_BOOST: Record<JournalTier, number> = { 1: 12, 2: 6, 3: 0 }

export async function loadJournalTiers(storage: VaultStorage): Promise<Map<string, JournalTier>> {
  const tiers = new Map<string, JournalTier>()
  try {
    const raw = await storage.read(JOURNAL_TIERS_PATH)
    if (raw === null) return tiers
    const parsed = JSON.parse(raw) as { version?: unknown; tiers?: unknown }
    if (parsed.version !== 1 || !parsed.tiers || typeof parsed.tiers !== "object") return tiers
    for (const [issn, tier] of Object.entries(parsed.tiers as Record<string, unknown>)) {
      if (tier === 1 || tier === 2 || tier === 3) tiers.set(issn.toUpperCase(), tier)
    }
  } catch {
    // An unreadable file means no tiers; the feed then ranks as it does without one.
  }
  return tiers
}

/** The band of the journal a paper appeared in: the user's own file first, then the pack. Found by the title PubMed prints. */
export function journalTierOf(journals: Journal[], tiers: ReadonlyMap<string, JournalTier>, venue: string | undefined): JournalTier | null {
  if (!venue) return null
  const wanted = normaliseJournalName(venue)
  const journal = journals.find((entry) => normaliseJournalName(entry.name) === wanted)
  if (!journal) return null
  return tiers.get((journal.issn ?? "").toUpperCase()) ?? tiers.get((journal.eissn ?? "").toUpperCase()) ?? journal.band ?? null
}
