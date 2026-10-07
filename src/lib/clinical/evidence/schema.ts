// src/lib/clinical/evidence/schema.ts
import { z } from "zod"
import type { PaperRecord } from "../../papers/types"
import { DESIGNS, DESIGN_SOURCES } from "../types"

/**
 * A finding: what one paper the feed listed reports (spec D52, D55). The AI headline and summary,
 * the direction of the result, the PICO line and the design. It is the unit the condition pages are
 * built from. Nothing here is a number a model wrote without its check; there are no effect sizes.
 */
export const FINDING_KINDS = ["benefit", "no-benefit", "mixed", "safety", "other"] as const
export type FindingKind = (typeof FINDING_KINDS)[number]

const text = z.string().nullable().default(null)
export const FindingSchema = z.object({
  key: z.string(), slug: z.string(),
  /** The record itself, so the paper's page can be opened long after the paper has left the feed. */
  paper: z.custom<PaperRecord>((value) => typeof value === "object" && value !== null && typeof (value as PaperRecord).title === "string" && typeof (value as PaperRecord).ids === "object"),
  headline: z.string(), takeaway: z.string(),
  design: z.enum(DESIGNS), designSource: z.enum(DESIGN_SOURCES),
  journalBand: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().default(null),
  /** The pack's ids of the conditions of the topics the paper was listed under. */
  conditionCodes: z.array(z.string()).default([]),
  kind: z.enum(FINDING_KINDS).nullable().default(null),
  treatment: text, treatmentCode: text,
  /** The short finding: what the treatment did, or a statement when there is no treatment. */
  text, population: text, comparator: text, outcome: text,
  firstListedAt: z.string(), lastListedAt: z.string(),
})
export type Finding = z.infer<typeof FindingSchema>
/**
 * Version 2: a paper that matched only its topic's treatment is filed under no condition. Version 1
 * filed it under the topic's condition, so a version-1 file is not read: it is copied aside and the
 * store is built again from the kept searches.
 */
export const FINDINGS_VERSION = 2
export const FindingsFileSchema = z.object({ version: z.literal(FINDINGS_VERSION), findings: z.record(z.string(), FindingSchema) })
