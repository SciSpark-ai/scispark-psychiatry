import type { VaultStorage } from "../../vault/storage"
import type { QueryLogEntry } from "../retrieve/pool"
import type { DropRecord, FeedMode, StageAGrade } from "../types"

export const RUN_LOG_DIR = ".scispark/clinical/runs/"
const KEEP_RUNS = 20

/** Enough identifiers to match a gold item by PMID or DOI, whatever key the record ended up with. */
export interface PoolRef {
  key: string
  pmid?: string
  doi?: string
}

/** What each stage kept, written for every run so the recall audit can say where a paper was lost. */
export interface RunLog {
  generatedAt: string
  mode: FeedMode
  queryLog: QueryLogEntry[]
  drops: DropRecord[]
  pool: { retrieved: PoolRef[]; domain: PoolRef[]; gated: PoolRef[]; shortlisted: PoolRef[]; listed: PoolRef[] }
  grades: StageAGrade[]
  /** Listed papers whose AI summary was not shown, and the check it failed. */
  digestDrops?: Array<{ key: string; reason: string }>
  /** How many of `grades` came from the local cache instead of a model call in this run. */
  reusedGrades?: number
}

export async function saveRunLog(storage: VaultStorage, log: RunLog): Promise<void> {
  await storage.write(`${RUN_LOG_DIR}${log.generatedAt.replaceAll(":", "-")}.json`, JSON.stringify(log))
  const paths = (await storage.list(RUN_LOG_DIR)).sort()
  for (const path of paths.slice(0, Math.max(0, paths.length - KEEP_RUNS))) await storage.delete(path)
}

export async function loadLatestRunLog(storage: VaultStorage): Promise<RunLog | null> {
  const latest = (await storage.list(RUN_LOG_DIR)).sort().at(-1)
  if (!latest) return null
  const raw = await storage.read(latest)
  return raw === null ? null : (JSON.parse(raw) as RunLog)
}
