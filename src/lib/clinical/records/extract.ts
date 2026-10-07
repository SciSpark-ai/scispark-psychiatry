// src/lib/clinical/records/extract.ts
import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import { headAndTail } from "../../text"
import { paperKey, type PaperRecord } from "../../papers/types"
import { paperSlug } from "../../wiki/authoring"
import type { PaperTextInfo } from "../../papers/text-contract"
import type { VaultStorage } from "../../vault/storage"
import type { LLMProvider, Tier } from "../../llm/types"
import type { LLMSettings } from "../../llm/settings"
import type { Taxonomy } from "../pack/schema"
import type { Design } from "../types"
import { CLINICAL_COPY } from "../copy"
import { numbers } from "../digest/card"
import { quoteInText } from "../text/quote"
import { TrialRecordSchema, emptyField, type Arm, type NumberField, type Outcome, type TextField, type TrialRecord } from "./schema"

/**
 * Reads a trial's arms and outcomes out of a paper (spec 7.7). The model proposes values, each with
 * the sentence it read it from; code keeps a value only when that sentence is in the paper word for
 * word and, for a number, only when the number is printed in that sentence. What fails is dropped,
 * not shown with a warning: a table is computed from these values.
 */

/** Only these designs have arms to extract. A meta-analysis or a cohort is refused before any model call. */
export const EXTRACTABLE_DESIGNS: readonly Design[] = ["randomized-trial", "clinical-trial"]
export class NotATrialError extends Error {}

const MAX_TEXT_CHARS = 45_000

const quoted = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable().default(null), quote: z.string().nullable().default(null) })
const text = quoted(z.string())
const number = quoted(z.number())
const ExtractionSchema = z.object({
  isTrial: z.boolean(),
  condition: text, conditionCode: z.string().nullable().default(null),
  arms: z.array(z.object({ id: z.string(), role: z.enum(["treatment", "control"]), treatment: text, treatmentCode: z.string().nullable().default(null), n: number })).default([]),
  outcomes: z.array(z.object({
    id: z.string(), name: text, instrument: text, timepoint: text, kind: z.enum(["continuous", "binary"]),
    lowerIsBetter: z.boolean().nullable().default(null), primary: z.boolean().default(false),
    results: z.array(z.object({ armId: z.string(), n: number, mean: number, sd: number, events: number })).default([]),
  })).default([]),
})
type Extraction = z.infer<typeof ExtractionSchema>

interface ExtractionInput { title: string; text: string; conditions: Array<{ code: string; name: string }>; treatments: Array<{ code: string; name: string }> }

const SYSTEM_PROMPT = `You extract the arms and outcomes of one clinical trial from its text, for a table a psychiatrist will check against the paper. You are given the title, the text (a mark "[...]" shows where the middle of a long paper was left out), and two lists of codes.

Return:
- "isTrial": true only if the text reports a trial that compares two or more groups of patients. A review, a meta-analysis, a cohort, a protocol without results: false, and leave the rest empty.
- "condition": the condition the patients had. "conditionCode": the code from the "conditions" list that fits it best, or null if none fits.
- "arms": one entry per group. "id": "a1", "a2", ... "role": "treatment" for a group that got the treatment under study, "control" for placebo, usual care, waiting list or an active comparator. "treatment": what the group received. "treatmentCode": the code from the "treatments" list, or null. "n": how many were randomised to the group.
- "outcomes": the primary outcome first, then up to four secondary outcomes. "id": "o1", "o2", ... "name": the outcome. "instrument": the scale or definition. "timepoint": when it was measured. "kind": "continuous" for a score, "binary" for an event (remission, response, relapse). "lowerIsBetter": true if a lower score or fewer events is the better result, false if the opposite, null if the text does not make it clear. "primary": true for the primary outcome. "results": for each arm that has numbers for this outcome, "armId" and "n" (analysed), "mean" and "sd" for a continuous outcome, "events" for a binary one.

Every value is an object {"value", "quote"}. "quote" is ONE sentence of the text, copied word for word, in which the value is printed. For a number, the number itself must be in the quote. If the text does not print a value, return {"value": null, "quote": null}; never estimate, convert or calculate (no standard deviation from a standard error or a confidence interval, no count from a percentage).

A value whose quote is not in the text word for word, or a number that is not in its quote, is thrown away. Add nothing from outside knowledge.`

export const trialExtractionSkill = defineSkill<ExtractionInput, Extraction>({
  name: "clinical-trial-extraction",
  version: "1",
  run: (ctx, input) =>
    ctx.llmStructured("strong", { maxTokens: 6144, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(input) }] }, ExtractionSchema),
})

/**
 * The numbers a quote prints, with their sign. A minus directly before digits is a sign unless a digit or a
 * closing bracket comes before it (then it is a range or a subtraction, as in "0.78-0.97"). Built on `numbers`,
 * so separators are read the same way.
 */
function signedNumbers(quote: string): number[] {
  const values = numbers(quote).map(Number)
  const negatives: number[] = []
  for (const match of quote.matchAll(/(?<![\d)\]])[-\u2212](?=\d)/g)) {
    const first = numbers(quote.slice(match.index + 1))[0]
    if (first !== undefined) negatives.push(Number(first))
  }
  for (const negative of negatives) {
    const at = values.indexOf(negative)
    if (at >= 0) values.splice(at, 1)
  }
  return [...values, ...negatives.map((value) => -value)]
}

const ARM_ID = /^[a-z][a-z0-9]{0,15}$/

/** Applies the checks. `dropped` counts values the model gave that did not pass. */
export function checkExtraction(output: Extraction, sourceText: string, taxonomy: Taxonomy): {
  condition: TextField; conditionCode: string | null; arms: Arm[]; outcomes: Outcome[]; dropped: number
} {
  let dropped = 0
  const textField = (given: { value: string | null; quote: string | null }): TextField => {
    const value = given.value?.replace(/\s+/g, " ").trim() ?? ""
    if (!value) return emptyField()
    if (given.quote && quoteInText(given.quote, sourceText)) return { value, quote: given.quote.replace(/\s+/g, " ").trim(), state: "quote-verified" }
    dropped++
    return emptyField()
  }
  const numberField = (given: { value: number | null; quote: string | null }): NumberField => {
    if (given.value === null || !Number.isFinite(given.value)) return emptyField()
    const printed = given.quote ? signedNumbers(given.quote) : []
    if (given.quote && quoteInText(given.quote, sourceText) && printed.includes(given.value)) return { value: given.value, quote: given.quote.replace(/\s+/g, " ").trim(), state: "quote-verified" }
    dropped++
    return emptyField()
  }
  const code = (value: string | null, type: "condition" | "treatment") => (value && taxonomy.nodes.some((node) => node.id === value && node.type === type) ? value : null)

  const seen = new Set<string>()
  const arms: Arm[] = output.arms.flatMap((arm) => {
    if (!ARM_ID.test(arm.id) || seen.has(arm.id)) return []
    const treatment = textField(arm.treatment)
    if (!treatment.value) return []
    seen.add(arm.id)
    return [{ id: arm.id, role: arm.role, treatment, treatmentCode: code(arm.treatmentCode, "treatment"), n: numberField(arm.n) }]
  })
  const outcomeIds = new Set<string>()
  const outcomes: Outcome[] = output.outcomes.flatMap((outcome) => {
    if (!ARM_ID.test(outcome.id) || outcomeIds.has(outcome.id)) return []
    const name = textField(outcome.name)
    if (!name.value) return []
    outcomeIds.add(outcome.id)
    const armsDone = new Set<string>()
    const results = outcome.results.flatMap((result) => {
      if (!seen.has(result.armId) || armsDone.has(result.armId)) return []
      armsDone.add(result.armId)
      return [{ armId: result.armId, n: numberField(result.n), mean: numberField(result.mean), sd: numberField(result.sd), events: numberField(result.events) }]
    })
    return [{ id: outcome.id, name, instrument: textField(outcome.instrument), timepoint: textField(outcome.timepoint), kind: outcome.kind, lowerIsBetter: outcome.lowerIsBetter, primary: outcome.primary, results }]
  })
  return { condition: textField(output.condition), conditionCode: code(output.conditionCode, "condition"), arms, outcomes, dropped }
}

/** Extracts and checks; returns the record without storing it. Throws NotATrialError, or an Error when the model call fails. */
export async function extractTrialRecord(storage: VaultStorage, paper: PaperRecord, opts: {
  design: Design; text: string; source: PaperTextInfo; taxonomy: Taxonomy
  settings?: LLMSettings; providerOverride?: Partial<Record<Tier, LLMProvider>>; now?: () => Date
}): Promise<TrialRecord> {
  if (!EXTRACTABLE_DESIGNS.includes(opts.design)) throw new NotATrialError(CLINICAL_COPY.records.notATrialDesign)
  const text = headAndTail(opts.text, MAX_TEXT_CHARS, 8_000)
  const codes = (type: "condition" | "treatment") => opts.taxonomy.nodes.filter((node) => node.type === type).map((node) => ({ code: node.id, name: node.name }))
  const run = await runSkill({
    skill: trialExtractionSkill, input: { title: paper.title, text, conditions: codes("condition"), treatments: codes("treatment") },
    storage, settings: opts.settings, providerOverride: opts.providerOverride, now: opts.now,
  })
  if (run.status !== "ok" || run.output === undefined) throw new Error(run.error ?? CLINICAL_COPY.records.extractFailed(run.status))
  if (!run.output.isTrial) throw new NotATrialError(CLINICAL_COPY.records.notATrial)
  const checked = checkExtraction(run.output, text, opts.taxonomy)
  if (checked.arms.length < 2) throw new NotATrialError(CLINICAL_COPY.records.tooFewArms)
  return TrialRecordSchema.parse({
    version: 1, paperKey: paperKey(paper), slug: paperSlug(paper), title: paper.title, year: paper.year ?? null, design: opts.design,
    conditionCode: checked.conditionCode, condition: checked.condition, arms: checked.arms, outcomes: checked.outcomes,
    source: opts.source, extractedAt: (opts.now?.() ?? new Date()).toISOString(), model: "strong", droppedFields: checked.dropped,
  })
}
