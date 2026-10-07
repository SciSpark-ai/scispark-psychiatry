// src/lib/clinical/records/schema.ts
import { z } from "zod"
import { DESIGNS } from "../types"
import { PaperTextInfoSchema } from "../../papers/text-contract"
import type { PaperRecord } from "../../papers/types"

/**
 * A structured record of one trial (spec 7.7): its arms and, per outcome, the numbers reported for
 * each arm. Long format, raw arm-level numbers; effect sizes are computed by code (./effects.ts),
 * never stored and never written by a model. Every extracted value carries the sentence it was
 * read from and a state: how far a person has checked it. Unknown is null.
 *
 * Three things the model also writes decide what every effect means: which arm is the treatment
 * (`role`), which result is the better one (`lowerIsBetter`) and which outcome is the primary one.
 * Each has a state of its own and no quote; until a person has confirmed it, no direction is claimed.
 */

export const FIELD_STATES = ["unverified", "quote-verified", "human-confirmed", "human-edited"] as const
export type FieldState = (typeof FIELD_STATES)[number]

const field = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable(), quote: z.string().nullable(), state: z.enum(FIELD_STATES) })
export const TextFieldSchema = field(z.string())
export const NumberFieldSchema = field(z.number())
export type TextField = z.infer<typeof TextFieldSchema>
export type NumberField = z.infer<typeof NumberFieldSchema>
export const emptyField = () => ({ value: null, quote: null, state: "unverified" as const })

/** A person has looked at the value: confirmed it, or set it. */
export const isChecked = (state: FieldState | undefined) => state === "human-confirmed" || state === "human-edited"
/** The state of a value stored before states were kept for it: nobody has checked it. */
const state = z.enum(FIELD_STATES).default("unverified")

const ROLES = ["treatment", "control"] as const
const id = z.string().regex(/^[a-z][a-z0-9]{0,15}$/, "ids are short lowercase tokens")
export const ArmSchema = z.object({
  id, role: z.enum(ROLES), roleState: state, treatment: TextFieldSchema,
  /** The pack's taxonomy id for the treatment, when the pack knows it. */
  treatmentCode: z.string().nullable(), n: NumberFieldSchema,
})
export const ArmResultSchema = z.object({ armId: id, n: NumberFieldSchema, mean: NumberFieldSchema, sd: NumberFieldSchema, events: NumberFieldSchema })
export const OutcomeSchema = z.object({
  id, name: TextFieldSchema, instrument: TextFieldSchema, timepoint: TextFieldSchema,
  kind: z.enum(["continuous", "binary"]),
  /** True when a lower score, or fewer events, is the better result. Null when the paper does not make it clear. */
  lowerIsBetter: z.boolean().nullable(), lowerIsBetterState: state,
  primary: z.boolean(), primaryState: state, results: z.array(ArmResultSchema),
})
const isPaper = (value: unknown): value is PaperRecord => {
  const paper = value as Partial<PaperRecord> | null
  return typeof paper === "object" && paper !== null && typeof paper.title === "string" && typeof paper.ids === "object" && paper.ids !== null
    && Array.isArray(paper.authors) && Array.isArray(paper.fields) && typeof paper.source === "string"
}
export const TrialRecordSchema = z.object({
  version: z.literal(1), paperKey: z.string(), slug: z.string(), title: z.string(), year: z.number().nullable(),
  design: z.enum(DESIGNS), conditionCode: z.string().nullable(), condition: TextFieldSchema,
  arms: z.array(ArmSchema), outcomes: z.array(OutcomeSchema),
  source: PaperTextInfoSchema, extractedAt: z.string(), model: z.string(),
  /** How many values the model gave that failed a check and were dropped. */
  droppedFields: z.number().int().nonnegative(),
  /**
   * The paper the record was read from, so that its page can still be opened when the paper is no longer
   * in any feed. Absent in records stored before it was kept; one that is not a paper is read as absent.
   */
  paper: z.custom<PaperRecord>(isPaper).optional().catch(undefined),
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

/** One of the three choices: a value from a short list, with a state and no quote. */
export interface ChoiceField { value: boolean | Arm["role"] | null; quote: null; state: FieldState }
export type RecordField = TextField | NumberField | ChoiceField
export type ChoiceKind = "role" | "lowerIsBetter" | "primary"

const RESULT_KEYS = ["n", "mean", "sd", "events"] as const
type ResultKey = (typeof RESULT_KEYS)[number]

/** The paths that are not plain lowercase words, built in one place. */
export const PATHS = {
  role: (armId: string) => `arms.${armId}.role`,
  benefit: (outcomeId: string) => `outcomes.${outcomeId}.lowerIsBetter`,
  primary: (outcomeId: string) => `outcomes.${outcomeId}.primary`,
  result: (outcomeId: string, armId: string, key: ResultKey) => `outcomes.${outcomeId}.results.${armId}.${key}`,
  conditionCode: "conditionCode",
  treatmentCode: (armId: string) => `arms.${armId}.treatmentCode`,
} as const

/** Which of the three choices the path names, or null for a field with a quote. */
export function choiceKind(path: string): ChoiceKind | null {
  const parts = path.split(".")
  if (parts.length !== 3) return null
  if (parts[0] === "arms" && parts[2] === "role") return "role"
  if (parts[0] === "outcomes" && (parts[2] === "lowerIsBetter" || parts[2] === "primary")) return parts[2]
  return null
}
/** The values a choice may take. */
export const CHOICE_VALUES: Record<ChoiceKind, ReadonlyArray<ChoiceField["value"]>> = { role: ROLES, lowerIsBetter: [true, false, null], primary: [true, false] }

/** Every field of the record by its path, in reading order. */
export function fieldPaths(record: TrialRecord): string[] {
  return [
    "condition",
    ...record.arms.flatMap((arm) => [PATHS.role(arm.id), `arms.${arm.id}.treatment`, `arms.${arm.id}.n`]),
    ...record.outcomes.flatMap((outcome) => [
      `outcomes.${outcome.id}.name`, `outcomes.${outcome.id}.instrument`, `outcomes.${outcome.id}.timepoint`,
      PATHS.primary(outcome.id), PATHS.benefit(outcome.id),
      ...outcome.results.flatMap((result) => RESULT_KEYS.map((key) => PATHS.result(outcome.id, result.armId, key))),
    ]),
  ]
}

/** The numbers of a result the panel shows: a mean and an SD for a score, events for an event. */
export const resultKeys = (kind: Outcome["kind"]): readonly ResultKey[] => (kind === "continuous" ? ["n", "mean", "sd"] : ["n", "events"])

/** The fields a reader can see and so can check: a binary outcome has no mean to look at, a continuous one no events. */
export function shownFieldPaths(record: TrialRecord): string[] {
  const kinds = new Map(record.outcomes.map((outcome) => [outcome.id, outcome.kind]))
  return fieldPaths(record).filter((path) => {
    const parts = path.split(".")
    return parts.length !== 5 || (resultKeys(kinds.get(parts[1]) ?? "binary") as readonly string[]).includes(parts[4])
  })
}

/**
 * The shown fields no person has confirmed or set yet. A field without a value has nothing to check,
 * except the direction of benefit: "not clear from the paper" is an answer the model gave too.
 */
export function pathsToCheck(record: TrialRecord): string[] {
  return shownFieldPaths(record).filter((path) => {
    const field = getField(record, path)
    return field !== null && !isChecked(field.state) && (field.value !== null || choiceKind(path) === "lowerIsBetter")
  })
}

export function getField(record: TrialRecord, path: string): RecordField | null {
  const parts = path.split(".")
  if (path === "condition") return record.condition
  if (parts[0] === "arms" && parts.length === 3) {
    const arm = record.arms.find((entry) => entry.id === parts[1])
    if (!arm) return null
    if (parts[2] === "role") return { value: arm.role, quote: null, state: arm.roleState }
    return parts[2] === "treatment" || parts[2] === "n" ? arm[parts[2]] : null
  }
  if (parts[0] === "outcomes") {
    const outcome = record.outcomes.find((entry) => entry.id === parts[1])
    if (!outcome) return null
    if (parts.length === 3 && (parts[2] === "name" || parts[2] === "instrument" || parts[2] === "timepoint")) return outcome[parts[2]]
    if (parts.length === 3 && parts[2] === "lowerIsBetter") return { value: outcome.lowerIsBetter, quote: null, state: outcome.lowerIsBetterState }
    if (parts.length === 3 && parts[2] === "primary") return { value: outcome.primary, quote: null, state: outcome.primaryState }
    if (parts.length === 5 && parts[2] === "results" && (RESULT_KEYS as readonly string[]).includes(parts[4])) {
      return outcome.results.find((entry) => entry.armId === parts[3])?.[parts[4] as ResultKey] ?? null
    }
  }
  return null
}

/**
 * The record with one field replaced. Throws when the path names no field. A trial has one primary
 * outcome: marking one un-marks any other that was marked.
 */
export function withField(record: TrialRecord, path: string, next: RecordField): TrialRecord {
  if (getField(record, path) === null) throw new Error(`no such field: ${path}`)
  const parts = path.split(".")
  const choice = choiceKind(path)
  if (path === "condition") return { ...record, condition: next as TextField }
  if (parts[0] === "arms") {
    return { ...record, arms: record.arms.map((arm) => {
      if (arm.id !== parts[1]) return arm
      return choice === "role" ? { ...arm, role: next.value as Arm["role"], roleState: next.state } : { ...arm, [parts[2]]: next }
    }) }
  }
  return {
    ...record,
    outcomes: record.outcomes.map((outcome) => {
      if (outcome.id !== parts[1]) return choice === "primary" && next.value === true && outcome.primary ? { ...outcome, primary: false, primaryState: "human-edited" as const } : outcome
      if (choice === "lowerIsBetter") return { ...outcome, lowerIsBetter: next.value as boolean | null, lowerIsBetterState: next.state }
      if (choice === "primary") return { ...outcome, primary: next.value === true, primaryState: next.state }
      if (parts.length === 3) return { ...outcome, [parts[2]]: next }
      return { ...outcome, results: outcome.results.map((result) => (result.armId === parts[3] ? { ...result, [parts[4]]: next } : result)) }
    }),
  }
}

/** Whether the path is a number field, so an edit can be checked before it is stored. */
export const isNumberPath = (path: string) => /\.(?:n|mean|sd|events)$/.test(path)

/**
 * What the record is filed under: the pack's id of the condition, or of an arm's treatment. Null when
 * it is filed under nothing; undefined when the path names neither.
 */
export function getCode(record: TrialRecord, path: string): string | null | undefined {
  if (path === PATHS.conditionCode) return record.conditionCode
  const parts = path.split(".")
  if (parts.length !== 3 || parts[0] !== "arms" || path !== PATHS.treatmentCode(parts[1])) return undefined
  const arm = record.arms.find((entry) => entry.id === parts[1])
  return arm ? arm.treatmentCode : undefined
}
export function withCode(record: TrialRecord, path: string, code: string | null): TrialRecord {
  if (getCode(record, path) === undefined) throw new Error(`no such field: ${path}`)
  if (path === PATHS.conditionCode) return { ...record, conditionCode: code }
  return { ...record, arms: record.arms.map((arm) => (PATHS.treatmentCode(arm.id) === path ? { ...arm, treatmentCode: code } : arm)) }
}
