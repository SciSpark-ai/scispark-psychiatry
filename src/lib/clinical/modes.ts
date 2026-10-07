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
  // A fixed choice also ends a search over chosen dates.
  return key.endsWith("m")
    ? { mode: "catch-up", catchUpMonths: amount as CatchUpMonths, range: undefined }
    : { mode: "whats-new", windowDays: amount as NonNullable<ClinicalSettings["windowDays"]>, range: undefined }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The settings for a search over chosen dates, or null when the dates are not two valid days in order. */
export function settingsForRange(from: string, to: string): Pick<ClinicalSettings, "range"> | null {
  if (!DAY.test(from) || !DAY.test(to) || from > to) return null
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null
  return { range: { from, to } }
}

/** The name of what a list looked at: "7d", "6m", or "2026-09-01..2026-09-15" for chosen dates. */
export function lookBackOf(settings: Pick<ClinicalSettings, "mode" | "catchUpMonths" | "windowDays" | "range">): string {
  if (settings.range) return `${settings.range.from}..${settings.range.to}`
  return settings.mode === "catch-up" ? `${settings.catchUpMonths}m` : `${settings.windowDays ?? 30}d`
}

/** "1 week", "6 months", or "2026-09-01 to 2026-09-15". */
export function lookBackName(key: string): string {
  return (CLINICAL_COPY.feed.lookBackOptions as Record<string, string>)[key] ?? ((([from, to]) => (to ? CLINICAL_COPY.feed.dateRange(from, to) : key))(key.split("..")))
}

/** As it reads in a sentence: "last 1 week", or the dates themselves. */
export function lookBackPhrase(key: string): string {
  return key in CLINICAL_COPY.feed.lookBackOptions ? CLINICAL_COPY.feed.lastRange(lookBackName(key)) : lookBackName(key)
}

/** The dates a run searches, and the ranking parameters that go with their length. */
export function searchWindow(settings: Pick<ClinicalSettings, "mode" | "catchUpMonths" | "windowDays" | "range">, now: Date): { mode: FeedMode; window: DateWindow } {
  if (!settings.range) return { mode: settings.mode, window: windowFor(settings.mode, now, settings.catchUpMonths, settings.windowDays) }
  const window = { from: new Date(`${settings.range.from}T00:00:00.000Z`), to: new Date(`${settings.range.to}T23:59:59.000Z`) }
  const days = (window.to.getTime() - window.from.getTime()) / 86_400_000
  return { mode: days <= 31 ? "whats-new" : "catch-up", window }
}
