import { CLINICAL_COPY } from "./copy"
import type { DateWindow } from "./plan/queries"
import type { CatchUpMonths, FeedMode } from "./types"

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

/** What's new looks back 30 days; Catch up looks back `catchUpMonths` calendar months (6 by default, D35). */
export function windowFor(mode: FeedMode, now: Date, catchUpMonths: CatchUpMonths = 6): DateWindow {
  if (mode === "whats-new") return { from: new Date(now.getTime() - 30 * 86_400_000), to: now }
  const from = new Date(now)
  from.setUTCMonth(from.getUTCMonth() - catchUpMonths)
  return { from, to: now }
}
