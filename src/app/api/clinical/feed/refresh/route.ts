import { enumeratePubmed } from "@/lib/papers/pubmed"
import { getSkillTestOverrides, ndjsonSkillRoute } from "@/lib/server/skill-route"
import { loadPsychiatryPack } from "@/lib/clinical/pack/load"
import { handleRefresh } from "@/lib/clinical/feed/refresh-handler"

/**
 * POST /api/clinical/feed/refresh — body `{}`, streaming NDJSON progress, then the stored feed.
 * A second request while a run is in progress joins it (single-flight per vault).
 */
export const POST = ndjsonSkillRoute<Record<string, never>>(async (_input, vault, emit) =>
  handleRefresh(vault, emit, {
    loadPack: () => loadPsychiatryPack(),
    enumerate: (query) => enumeratePubmed(query, { apiKey: process.env.NCBI_API_KEY }),
    enumerateWithRecords: (records) => (query) => enumeratePubmed(query, { apiKey: process.env.NCBI_API_KEY, records }),
    providerOverride: getSkillTestOverrides().providerOverride,
    summarise: true,
    useCache: true,
    keepHistory: true,
  }),
)
