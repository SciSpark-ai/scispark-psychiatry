import { CLINICAL_COPY } from "./copy"
import type { DateWindow } from "./plan/queries"
import type { CatchUpMonths, ClinicalSettings, FeedMode } from "./types"

export interface ModeParams {
  halfLifeDays: number
  /** Initial hypotheses (spec 6.10), to be tuned by the experiments. */
  weights: { relevance: number; impact: number; evidence: number; recency: number }
  /** Candidates sent to stage A at most. */
  candidateCap: number
  recallCheck: boolean
  snowballing: boolean
}

export const MODES: Record<FeedMode, ModeParams> = {
  "whats-new": { halfLifeDays: 21, weights: { relevance: 45, impact: 20, evidence: 15, recency: 20 }, candidateCap: 150, recallCheck: false, snowballing: false },
  "catch-up": { halfLifeDays: 180, weights: { relevance: 40, impact: 25, evidence: 30, recency: 5 }, candidateCap: 300, recallCheck: false, snowballing: true },
}

export const MODE_LABELS: Record<FeedMode, string> = CLINICAL_COPY.modes

/** The whats-new mode looks back `windowDays` days (30 by default); catch-up looks back `catchUpMonths` calendar months (6 by default, D35). */
export function windowFor(mode: FeedMode, now: Date, catchUpMonths: CatchUpMonths = 6, windowDays: number = 30): DateWindow {
  if (mode === "whats-new") return { from: new Date(now.getTime() - windowDays * 86_400_000), to: now }
  const from = new Date(now)
  from.setUTCMonth(from.getUTCMonth() - catchUpMonths)
  return { from, to: now }
}

/**
 * The one choice the user makes: how far back to look (owner decision 2026-10-07, replacing the
 * What's new / Catch up toggle). Up to 30 days the run uses the whats-new parameters (recency
 * matters); from 3 months it uses the catch-up ones (design and evidence matter more, recency hardly).
 */
export const LOOK_BACK = ["3d", "7d", "14d", "30d", "3m", "6m", "12m"] as const
export type LookBack = (typeof LOOK_BACK)[number]

export function settingsForLookBack(key: LookBack): Pick<ClinicalSettings, "mode"> & Partial<ClinicalSettings> {
  const amount = Number.parseInt(key, 10)
  return key.endsWith("m")
    ? { mode: "catch-up", catchUpMonths: amount as CatchUpMonths }
    : { mode: "whats-new", windowDays: amount as NonNullable<ClinicalSettings["windowDays"]> }
}

export function lookBackOf(settings: Pick<ClinicalSettings, "mode" | "catchUpMonths" | "windowDays">): LookBack {
  return (settings.mode === "catch-up" ? `${settings.catchUpMonths}m` : `${settings.windowDays ?? 30}d`) as LookBack
}
