import type { PoolRef, RunLog } from "../feed/run-log"

export interface GoldItem {
  pmid?: string
  doi?: string
  note?: string
}

export const STAGES = ["retrieved", "domain", "gated", "shortlisted", "listed"] as const
export type AuditStage = (typeof STAGES)[number]

export interface AuditReport {
  total: number
  /** Share of gold items still present after each stage (0–1). */
  recallByStage: Record<AuditStage, number>
  misses: Array<{ gold: GoldItem; lostAt: AuditStage | "never-retrieved"; reason?: string }>
}

const doiKey = (doi: string | undefined) => doi?.trim().toLowerCase().replace(/^https?:\/\/doi\.org\//, "")

function matches(gold: GoldItem, ref: PoolRef): boolean {
  return (gold.pmid !== undefined && gold.pmid === ref.pmid) || (gold.doi !== undefined && doiKey(gold.doi) === doiKey(ref.doi))
}

/** Where each gold item first drops out of the pipeline, and what share survives each stage. */
export function auditRecall(gold: GoldItem[], log: RunLog): AuditReport {
  const presence = (stage: AuditStage, item: GoldItem) => log.pool[stage].some((ref) => matches(item, ref))
  const recallByStage = Object.fromEntries(
    STAGES.map((stage) => [stage, gold.length === 0 ? 0 : gold.filter((item) => presence(stage, item)).length / gold.length]),
  ) as Record<AuditStage, number>

  const misses: AuditReport["misses"] = []
  for (const item of gold) {
    const lostAt = STAGES.find((stage) => !presence(stage, item))
    if (!lostAt) continue
    const lastSeen = lostAt === "retrieved" ? undefined : STAGES[STAGES.indexOf(lostAt) - 1]
    const ref = lastSeen ? log.pool[lastSeen].find((candidate) => matches(item, candidate)) : undefined
    const drop = ref ? log.drops.find((entry) => entry.key === ref.key) : undefined
    misses.push({ gold: item, lostAt: lostAt === "retrieved" ? "never-retrieved" : lostAt, reason: drop?.reason })
  }
  return { total: gold.length, recallByStage, misses }
}
