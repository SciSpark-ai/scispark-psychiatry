import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import { addCosts } from "../../llm/pricing"
import type { LLMProvider, Tier } from "../../llm/types"
import type { LLMSettings } from "../../llm/settings"
import type { VaultStorage } from "../../vault/storage"
import type { GatedCandidate, StageAGrade, WatchEntry } from "../types"
import { CLINICAL_COPY } from "../copy"
import { quoteInText } from "../text/quote"

export const STAGE_A_BATCH = 20
const ABSTRACT_LIMIT = 1800

const AssessmentsSchema = z.object({
  assessments: z.array(z.object({
    index: z.number().int(),
    entryId: z.string().nullable(),
    grade: z.number().int().min(0).max(4),
    topicGrade: z.number().int().min(0).max(4),
    quote: z.string(),
  })),
})

export interface StageAInput {
  entries: WatchEntry[]
  exemplars: string[]
  candidates: Array<{ index: number; title: string; abstract: string }>
}

const SYSTEM_PROMPT = `You triage new psychiatry literature for a clinician. For each candidate paper, find the ONE watch entry it matches best and grade the match.

Match grade for that entry (0-4). A watch entry has a condition, a treatment, or both; grade only the facets it fills:
4 = the paper's population/condition AND treatment both match the entry (population compatible)
3 = both match, but the population differs, or the match is by subtype or drug/treatment class
2 = one facet matches exactly and the other is related (same drug class, comorbid condition), including off-label or new-indication evidence
1 = one facet only
0 = no match

Also give a topic grade (0-4): how clearly the paper concerns psychiatric conditions or their treatment, independent of the watch entries.

Rules:
- "entryId" is the id of the best-matching entry, or null when nothing matches (then grade must be 0).
- "quote" must be copied VERBATIM from the paper's title or abstract (at least 8 characters) and must be the passage that justifies your grades. If you cannot quote support for a grade above 0, give 0.
- Judge only from the text given. Do not use outside knowledge about whether the paper is good.
- Return one assessment per candidate, using the candidate's index.
- The example papers show what this clinician has found useful. They can reveal extra interests, but do not match on them unless a watch entry or the topic grade supports it.`

export const stageASkill = defineSkill<StageAInput, z.infer<typeof AssessmentsSchema>>({
  name: "clinical-stage-a",
  version: "1",
  run: (ctx, input) =>
    ctx.llmStructured(
      "fast",
      {
        maxTokens: 8192,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({
            watchEntries: input.entries.map(({ id, condition, treatment, population, outcome }) => ({ id, condition, treatment, population, outcome })),
            examplePapers: input.exemplars,
            candidates: input.candidates,
          }) },
        ],
      },
      AssessmentsSchema,
    ),
})

/** A quote counts only if it appears in the cleaned title or abstract that grading saw. */
export function verifyQuote(quote: string, candidate: GatedCandidate): boolean {
  return quoteInText(quote, `${candidate.paper.title}\n${candidate.paper.abstract ?? ""}`)
}

const ungraded = (key: string): StageAGrade => ({ key, entryId: null, grade: 0, topicGrade: 0, quote: "", quoteVerified: false, ungraded: true })

export class GradingFailedError extends Error {
  constructor() {
    super(CLINICAL_COPY.run.gradingFailed)
  }
}

export interface GradeRunOpts {
  storage: VaultStorage
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
}

/**
 * Step 5: stage-A grading in batches of 20. A failed batch leaves its candidates ungraded (kept, not
 * dropped); if every batch fails the run throws, so a stored feed is never replaced by nothing.
 */
export async function gradeStageA(
  candidates: GatedCandidate[], entries: WatchEntry[], exemplars: string[], opts: GradeRunOpts,
): Promise<{ grades: Map<string, StageAGrade>; costUsd: number | null; failedBatches: number }> {
  const grades = new Map<string, StageAGrade>()
  const entryIds = new Set(entries.map((entry) => entry.id))
  let costUsd: number | null = 0
  let failedBatches = 0
  let batches = 0

  for (let offset = 0; offset < candidates.length; offset += STAGE_A_BATCH) {
    batches += 1
    const batch = candidates.slice(offset, offset + STAGE_A_BATCH)
    const run = await runSkill({
      skill: stageASkill,
      input: {
        entries,
        exemplars,
        candidates: batch.map((candidate, index) => ({
          index, title: candidate.paper.title, abstract: (candidate.paper.abstract ?? "").slice(0, ABSTRACT_LIMIT),
        })),
      },
      ...opts,
    })
    costUsd = addCosts(costUsd, run.costUsd)
    if (run.status !== "ok" || !run.output) {
      failedBatches += 1
      for (const candidate of batch) grades.set(candidate.key, ungraded(candidate.key))
      continue
    }
    const byIndex = new Map(run.output.assessments.map((assessment) => [assessment.index, assessment]))
    batch.forEach((candidate, index) => {
      const assessment = byIndex.get(index)
      if (!assessment) { grades.set(candidate.key, ungraded(candidate.key)); return }
      const knownEntry = assessment.entryId !== null && entryIds.has(assessment.entryId)
      const verified = verifyQuote(assessment.quote, candidate)
      const claimsMatch = assessment.grade > 0 || assessment.topicGrade > 0
      if (claimsMatch && !verified) {
        grades.set(candidate.key, { key: candidate.key, entryId: null, grade: 0, topicGrade: 0, quote: assessment.quote, quoteVerified: false, ungraded: false, modelGrade: assessment.grade })
        return
      }
      grades.set(candidate.key, {
        key: candidate.key,
        entryId: knownEntry ? assessment.entryId : null,
        grade: knownEntry ? assessment.grade : 0,
        topicGrade: assessment.topicGrade,
        quote: assessment.quote,
        quoteVerified: verified,
        ungraded: false,
        modelGrade: assessment.grade,
      })
    })
  }
  if (batches > 0 && failedBatches === batches) throw new GradingFailedError()
  return { grades, costUsd, failedBatches }
}
