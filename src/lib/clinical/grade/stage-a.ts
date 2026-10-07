import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import { addCosts } from "../../llm/pricing"
import type { LLMProvider, Tier } from "../../llm/types"
import type { LLMSettings } from "../../llm/settings"
import type { VaultStorage } from "../../vault/storage"
import type { Design, GatedCandidate, MatchedPart, StageAGrade, WatchEntry } from "../types"
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
    /** Does the paper concern the entry's condition? Its treatment? null when the entry has no such part. */
    conditionMatch: z.boolean().nullable().default(null),
    treatmentMatch: z.boolean().nullable().default(null),
    /** The kind of study, from MODEL_DESIGNS, or null. Checked against the list in code. */
    design: z.string().nullable().default(null),
  })),
})

/** The designs the model may name. PubMed's own type, when there is one, always wins over this. */
export const MODEL_DESIGNS: readonly Design[] = [
  "meta-analysis", "systematic-review", "randomized-trial", "guideline", "cohort", "clinical-trial",
  "review", "case-report", "editorial", "protocol", "preclinical", "other",
]

export interface StageAInput {
  entries: WatchEntry[]
  exemplars: string[]
  candidates: Array<{ index: number; title: string; abstract: string }>
}

const SYSTEM_PROMPT = () => `You triage new psychiatry literature for a clinician. For each candidate paper, find the ONE watch entry it matches best and grade the match.

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
- An entry may have a second condition ("condition2") with "conditionJoin": with "and" the paper must be about BOTH conditions for conditionMatch to be true; with "or" either one is enough.
- "conditionMatch": true if the paper is about the entry's condition (the condition itself or a subtype of it), false if not, null if the entry has no condition. "treatmentMatch": true if the paper studies the entry's treatment (the same treatment under any name, formulation or closely related form, such as ketamine for esketamine), false if it studies only other treatments, null if the entry has no treatment. Answer each on its own: a paper about the condition that studies a different treatment is conditionMatch true, treatmentMatch false. Pick the entry for which the most parts are true.
- "design" is the kind of study THIS paper reports, one of: ${MODEL_DESIGNS.join(", ")}. "randomized-trial" only if this paper reports a trial that allocated participants at random; "clinical-trial" for other interventional studies (single-arm, open-label, pilot); "cohort" for observational studies of patients; "review" for a narrative review; "protocol" for a study plan with no results; "preclinical" for animal or laboratory work; "other" when none fits. Use null if the text does not say.
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
          { role: "system", content: SYSTEM_PROMPT() },
          { role: "user", content: JSON.stringify({
            watchEntries: input.entries.map(({ id, condition, condition2, conditionJoin, treatment, population, outcome }) => ({ id, condition, condition2, conditionJoin: condition2 ? (conditionJoin ?? "and") : undefined, treatment, population, outcome })),
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
      const entry = knownEntry ? entries.find((candidateEntry) => candidateEntry.id === assessment.entryId) : undefined
      // The two answers, kept only for the parts the entry fills.
      const answered = assessment.conditionMatch !== null || assessment.treatmentMatch !== null
      const onCondition = Boolean(entry?.condition) && assessment.conditionMatch === true
      const onTreatment = Boolean(entry?.treatment) && assessment.treatmentMatch === true
      const wantsBoth = Boolean(entry?.condition) && Boolean(entry?.treatment)
      const matched: MatchedPart | undefined = !entry || !answered ? undefined
        : wantsBoth ? (onCondition && onTreatment ? "full" : onCondition ? "condition" : onTreatment ? "treatment" : undefined)
        : onCondition || onTreatment ? "full" : undefined
      const named = MODEL_DESIGNS.find((design) => design === assessment.design)
      const modelDesign = named ? { modelDesign: named } : {}
      const claimsMatch = assessment.grade > 0 || assessment.topicGrade > 0
      if (claimsMatch && !verified) {
        grades.set(candidate.key, { key: candidate.key, entryId: null, grade: 0, topicGrade: 0, quote: assessment.quote, quoteVerified: false, ungraded: false, modelGrade: assessment.grade, ...modelDesign })
        return
      }
      // The model answered both questions with "no": not a match, whatever grade it gave.
      const noPart = Boolean(entry) && answered && matched === undefined
      grades.set(candidate.key, {
        key: candidate.key,
        entryId: knownEntry && !noPart ? assessment.entryId : null,
        grade: knownEntry && !noPart ? assessment.grade : 0,
        topicGrade: assessment.topicGrade,
        quote: assessment.quote,
        quoteVerified: verified,
        ungraded: false,
        modelGrade: assessment.grade,
        ...(matched ? { matched } : {}),
        ...modelDesign,
      })
    })
  }
  if (batches > 0 && failedBatches === batches) throw new GradingFailedError()
  return { grades, costUsd, failedBatches }
}
