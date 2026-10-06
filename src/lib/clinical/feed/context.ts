import { paperKey } from "../../papers/types"
import { paperRecordFromFrontmatter } from "../../papers/resolve"
import type { VaultStorage } from "../../vault/storage"
import { loadBundle } from "../../vault/bundle"
import { dismissedKeys, exemplarTitles, loadFeedback } from "../feedback/store"
import { loadClinicalSettings, loadWatchEntries } from "../watch/store"
import type { ClinicalSettings, WatchEntry } from "../types"
import { CLINICAL_COPY } from "../copy"

export interface RunContext {
  entries: WatchEntry[]
  settings: ClinicalSettings
  /** Papers already in the knowledge base or marked not relevant. */
  exclude: Set<string>
  exemplars: string[]
}

/** Step 0: everything the run needs from the vault. */
export async function assembleContext(storage: VaultStorage): Promise<RunContext> {
  const entries = (await loadWatchEntries(storage)).filter((entry) => entry.priority !== "paused")
  if (entries.length === 0) throw new Error(CLINICAL_COPY.run.noEntries)
  const feedback = await loadFeedback(storage)
  const bundle = await loadBundle(storage)
  const saved = [...bundle.pages.values()]
    .filter((page) => page.frontmatter.type === "paper")
    .map((page) => paperKey(paperRecordFromFrontmatter(page.frontmatter)))
  return {
    entries,
    settings: await loadClinicalSettings(storage),
    exclude: new Set([...saved, ...dismissedKeys(feedback)]),
    exemplars: exemplarTitles(feedback),
  }
}
