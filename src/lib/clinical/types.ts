import { z } from "zod"
import type { PaperRecord } from "../papers/types"

export const FEED_MODES = ["whats-new", "catch-up"] as const
export type FeedMode = (typeof FEED_MODES)[number]

export const GATE_STRICTNESS = ["strict", "standard", "open"] as const
export type GateStrictness = (typeof GATE_STRICTNESS)[number]

/** How far back Catch up looks (D35). Six months by default. */
export const CATCH_UP_MONTHS = [3, 6, 12] as const
export type CatchUpMonths = (typeof CATCH_UP_MONTHS)[number]

export const PRIORITIES = ["high", "normal", "paused"] as const
export type Priority = (typeof PRIORITIES)[number]

/** A tracked topic: a condition, a treatment, or both. Population and outcome are modifiers. */
export const WatchEntrySchema = z
  .object({
    id: z.string().min(1),
    condition: z.string().min(1).optional(),
    treatment: z.string().min(1).optional(),
    population: z.string().min(1).optional(),
    outcome: z.string().min(1).optional(),
    priority: z.enum(PRIORITIES).default("normal"),
    /** Case reports for this topic are shown in a collapsed "Safety signals" area. */
    safetySignal: z.boolean().default(false),
  })
  .refine((entry) => entry.condition !== undefined || entry.treatment !== undefined, {
    message: "a watch entry needs a condition or a treatment",
  })
export type WatchEntry = z.infer<typeof WatchEntrySchema>

export const ClinicalSettingsSchema = z.object({
  mode: z.enum(FEED_MODES).default("whats-new"),
  strictness: z.enum(GATE_STRICTNESS).default("standard"),
  catchUpMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]).default(6),
  /** Days looked back in the "whats-new" mode: 3, 7, 14 or 30. Absent means 30. See LOOK_BACK in modes.ts. */
  windowDays: z.union([z.literal(3), z.literal(7), z.literal(14), z.literal(30)]).optional(),
  defaultPopulation: z.string().min(1).optional(),
})
export type ClinicalSettings = z.infer<typeof ClinicalSettingsSchema>

export const DESIGNS = [
  "meta-analysis", "systematic-review", "randomized-trial", "guideline", "cohort",
  "clinical-trial", "review", "case-report", "editorial", "erratum", "retraction", "protocol", "preclinical", "other", "unknown",
] as const
export type Design = (typeof DESIGNS)[number]
/** Who named the design: PubMed's own indexing, the grading model, the text rules, or nobody. */
export const DESIGN_SOURCES = ["publication-type", "model", "text-rule", "none"] as const
export type DesignSource = (typeof DESIGN_SOURCES)[number]

/** Where a candidate came from; kept for the recall audit. */
export interface Provenance {
  query: string
  entryId?: string
  tier: "A" | "B" | "entry"
}

export interface Candidate {
  paper: PaperRecord
  key: string
  provenance: Provenance[]
  /** Soft quality flags (never a gate). */
  flags: string[]
}

export interface GatedCandidate extends Candidate {
  design: Design
  designSource: DesignSource
}

export type DropStep = "retrieve" | "prefilter" | "gate" | "cap" | "grade" | "select"

export interface DropRecord {
  key: string
  title: string
  step: DropStep
  reason: string
}

export const MATCHED_PARTS = ["full", "condition", "treatment"] as const
export type MatchedPart = (typeof MATCHED_PARTS)[number]

export interface StageAGrade {
  key: string
  /** Best-matching watch entry, or null when the paper matches none. */
  entryId: string | null
  /** 0–4 match grade against `entryId`; 0 when entryId is null. */
  grade: number
  /** 0–4 general topic grade (psychiatric relevance). */
  topicGrade: number
  quote: string
  /** False when the model's quote does not appear in the cleaned text; both grades are then 0. */
  quoteVerified: boolean
  /** The entry grade the model gave, before the quote check or an unknown entry id zeroed it (for the run log). */
  modelGrade?: number
  /**
   * Which part of the watch entry the paper matches: all of it, only its condition, or only its
   * treatment. Absent on grades made before the model was asked (those rank by `grade` alone).
   */
  matched?: MatchedPart
  /** The study design the model read from the title and abstract, when it named one from the list. */
  modelDesign?: Design
  /** True when the grading call failed or skipped this candidate; it is kept, ungraded. */
  ungraded: boolean
}

export type ClinicalStage = "context" | "plan" | "retrieve" | "filter" | "grade" | "select"

export const PAGE_SIZE = 12
export const LIST_CAP = 48
