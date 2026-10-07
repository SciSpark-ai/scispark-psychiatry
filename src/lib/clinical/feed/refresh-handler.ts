import { loadSettings, type LLMSettings } from "../../llm/settings"
import type { LLMProvider, Tier } from "../../llm/types"
import type { VaultStorage } from "../../vault/storage"
import type { SpecialtyPack } from "../pack/schema"
import type { EnumerateFn } from "../retrieve/pool"
import { loadRecordStore, type RecordStore } from "../retrieve/record-store"
import { runClinicalFeedSingleFlight } from "./run"
import type { StoredFeed } from "./stored"

export interface RefreshDeps {
  loadPack: () => Promise<SpecialtyPack>
  enumerate: EnumerateFn
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
  summarise?: boolean
  useCache?: boolean
  keepHistory?: boolean
  /** When given, the run searches through the vault's record store (retrieve/record-store.ts) instead of `enumerate`. */
  enumerateWithRecords?: (records: RecordStore) => EnumerateFn
}

/** The body of POST /api/clinical/feed/refresh: runs the funnel and streams each stage as a progress event. */
export async function handleRefresh(vault: VaultStorage, emit: (event: object) => void, deps: RefreshDeps): Promise<StoredFeed> {
  const settings = deps.settings ?? (await loadSettings(vault))
  const records = deps.enumerateWithRecords ? await loadRecordStore(vault, (deps.now ?? (() => new Date()))()) : null
  try {
    return await runClinicalFeedSingleFlight(vault, {
      pack: await deps.loadPack(),
      enumerate: records && deps.enumerateWithRecords ? deps.enumerateWithRecords(records) : deps.enumerate,
      settings,
      providerOverride: deps.providerOverride,
      now: deps.now,
      summarise: deps.summarise,
      useCache: deps.useCache,
      keepHistory: deps.keepHistory,
      onStage: (stage) => emit({ type: "progress", stage }),
    })
  } finally {
    // Whatever was read is kept, even when the run failed later on.
    await records?.save().catch(() => {})
  }
}
