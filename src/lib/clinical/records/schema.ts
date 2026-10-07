// src/lib/clinical/records/schema.ts
import { z } from "zod"
import { DESIGNS } from "../types"
import { PaperTextInfoSchema } from "../../papers/text-contract"

/**
 * A structured record of one trial (spec 7.7): its arms and, per outcome, the numbers reported for
 * each arm. Long format, raw arm-level numbers; effect sizes are computed by code (./effects.ts),
 * never stored and never written by a model. Every extracted value carries the sentence it was
 * read from and a state: how far a person has checked it. Unknown is null.
 */

export const FIELD_STATES = ["unverified", "quote-verified", "human-confirmed", "human-edited"] as const
export type FieldState = (typeof FIELD_STATES)[number]

const field = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable(), quote: z.string().nullable(), state: z.enum(FIELD_STATES) })
export const TextFieldSchema = field(z.string())
export const NumberFieldSchema = field(z.number())
export type TextField = z.infer<typeof TextFieldSchema>
export type NumberField = z.infer<typeof NumberFieldSchema>
export const emptyField = () => ({ value: null, quote: null, state: "unverified" as const })

const id = z.string().regex(/^[a-z][a-z0-9]{0,15}$/, "ids are short lowercase tokens")
export const ArmSchema = z.object({
  id, role: z.enum(["treatment", "control"]), treatment: TextFieldSchema,
  /** The pack's taxonomy id for the treatment, when the pack knows it. */
  treatmentCode: z.string().nullable(), n: NumberFieldSchema,
})
export const ArmResultSchema = z.object({ armId: id, n: NumberFieldSchema, mean: NumberFieldSchema, sd: NumberFieldSchema, events: NumberFieldSchema })
export const OutcomeSchema = z.object({
  id, name: TextFieldSchema, instrument: TextFieldSchema, timepoint: TextFieldSchema,
  kind: z.enum(["continuous", "binary"]),
  /** True when a lower score, or fewer events, is the better result. Null when the paper does not make it clear. */
  lowerIsBetter: z.boolean().nullable(), primary: z.boolean(), results: z.array(ArmResultSchema),
})
export const TrialRecordSchema = z.object({
  version: z.literal(1), paperKey: z.string(), slug: z.string(), title: z.string(), year: z.number().nullable(),
  design: z.enum(DESIGNS), conditionCode: z.string().nullable(), condition: TextFieldSchema,
  arms: z.array(ArmSchema), outcomes: z.array(OutcomeSchema),
  source: PaperTextInfoSchema, extractedAt: z.string(), model: z.string(),
  /** How many values the model gave that failed a check and were dropped. */
  droppedFields: z.number().int().nonnegative(),
}).superRefine((record, ctx) => {
  const arms = new Set(record.arms.map((arm) => arm.id))
  if (arms.size !== record.arms.length) ctx.addIssue({ code: "custom", message: "arm ids must be unique" })
  if (new Set(record.outcomes.map((outcome) => outcome.id)).size !== record.outcomes.length) ctx.addIssue({ code: "custom", message: "outcome ids must be unique" })
  for (const outcome of record.outcomes) for (const result of outcome.results) {
    if (!arms.has(result.armId)) ctx.addIssue({ code: "custom", message: `outcome ${outcome.id} names an arm the record does not have: ${result.armId}` })
  }
})
export type Arm = z.infer<typeof ArmSchema>
export type ArmResult = z.infer<typeof ArmResultSchema>
export type Outcome = z.infer<typeof OutcomeSchema>
export type TrialRecord = z.infer<typeof TrialRecordSchema>

const RESULT_KEYS = ["n", "mean", "sd", "events"] as const
type ResultKey = (typeof RESULT_KEYS)[number]

/** Every field of the record by its path, in reading order. */
export function fieldPaths(record: TrialRecord): string[] {
  return [
    "condition",
    ...record.arms.flatMap((arm) => [`arms.${arm.id}.treatment`, `arms.${arm.id}.n`]),
    ...record.outcomes.flatMap((outcome) => [
      `outcomes.${outcome.id}.name`, `outcomes.${outcome.id}.instrument`, `outcomes.${outcome.id}.timepoint`,
      ...outcome.results.flatMap((result) => RESULT_KEYS.map((key) => `outcomes.${outcome.id}.results.${result.armId}.${key}`)),
    ]),
  ]
}

export function getField(record: TrialRecord, path: string): TextField | NumberField | null {
  const parts = path.split(".")
  if (path === "condition") return record.condition
  if (parts[0] === "arms" && parts.length === 3) {
    const arm = record.arms.find((entry) => entry.id === parts[1])
    return arm && (parts[2] === "treatment" || parts[2] === "n") ? arm[parts[2]] : null
  }
  if (parts[0] === "outcomes") {
    const outcome = record.outcomes.find((entry) => entry.id === parts[1])
    if (!outcome) return null
    if (parts.length === 3 && (parts[2] === "name" || parts[2] === "instrument" || parts[2] === "timepoint")) return outcome[parts[2]]
    if (parts.length === 5 && parts[2] === "results" && (RESULT_KEYS as readonly string[]).includes(parts[4])) {
      return outcome.results.find((entry) => entry.armId === parts[3])?.[parts[4] as ResultKey] ?? null
    }
  }
  return null
}

/** The record with one field replaced. Throws when the path names no field. */
export function withField(record: TrialRecord, path: string, next: TextField | NumberField): TrialRecord {
  if (getField(record, path) === null) throw new Error(`no such field: ${path}`)
  const parts = path.split(".")
  if (path === "condition") return { ...record, condition: next as TextField }
  if (parts[0] === "arms") return { ...record, arms: record.arms.map((arm) => (arm.id === parts[1] ? { ...arm, [parts[2]]: next } : arm)) }
  return {
    ...record,
    outcomes: record.outcomes.map((outcome) => {
      if (outcome.id !== parts[1]) return outcome
      if (parts.length === 3) return { ...outcome, [parts[2]]: next }
      return { ...outcome, results: outcome.results.map((result) => (result.armId === parts[3] ? { ...result, [parts[4]]: next } : result)) }
    }),
  }
}

/** Whether the path is a number field, so an edit can be checked before it is stored. */
export const isNumberPath = (path: string) => /\.(?:n|mean|sd|events)$/.test(path)
