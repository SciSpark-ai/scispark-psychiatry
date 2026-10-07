import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import { addCosts } from "../../llm/pricing"
import type { LLMProvider, Tier } from "../../llm/types"
import type { LLMSettings } from "../../llm/settings"
import type { PaperRecord } from "../../papers/types"
import type { VaultStorage } from "../../vault/storage"
import type { Design } from "../types"

/**
 * A short headline and a one-sentence takeaway for a listed paper, written by the `fast` model from
 * the abstract. This is generated text in a clinical tool, so code checks every one before it is shown:
 *
 * - The model does not quote. Code splits the abstract into numbered sentences and the model names
 *   the number of the sentence its takeaway rests on; code looks that sentence up. (Asking for a
 *   verbatim quote lost a quarter of the summaries to small copying differences.)
 * - No number may appear that the paper's text does not contain.
 * - Both texts must be short.
 *
 * A paper whose answer fails a check is asked for once more, with the reason. If it fails again it
 * has no digest, and the card falls back to the paper's own title and the authors' conclusion.
 */

export const CARD_DIGEST_BATCH = 12
const SENTENCE_LIMIT = 60
const HEADLINE_MAX_WORDS = 16
const TAKEAWAY_MAX_WORDS = 45

export interface CardDigest {
  headline: string
  takeaway: string
  /** The abstract sentence the takeaway rests on, copied by code. */
  quote: string
}

const DigestsSchema = z.object({
  digests: z.array(z.object({ index: z.number().int(), headline: z.string(), takeaway: z.string(), source: z.number().int() })),
})
type DigestAnswer = z.infer<typeof DigestsSchema>["digests"][number]

interface DigestInput {
  papers: Array<{ index: number; title: string; design: string; sentences: Array<{ n: number; text: string }>; problem?: string }>
}

const SYSTEM_PROMPT = `You write card text that lets a busy psychiatrist scan new papers. Each paper comes with its title and its abstract split into numbered sentences. For each paper return:

- "headline": at most 12 words, plain language, saying what the study found or, if it reports no result, what it examined. Name the treatment and the condition. Say the finding itself ("X lowered relapse more than Y"), not that something "was evaluated" or "was analysed". No hype, no advice.
- "takeaway": ONE full sentence, at most 35 words, giving the main result with its key numbers exactly as the abstract prints them, and the comparison group if there is one. If the abstract gives no result, say what was studied and that no result is reported.
- "source": the number of the ONE abstract sentence your takeaway rests on.

Rules:
- Use only the title and the numbered sentences. Add nothing from outside knowledge.
- Copy numbers exactly. Never calculate a new number (no differences, ratios or rounding) and never state a number that is not printed in the abstract.
- Never turn an association into a causal claim. Keep the abstract's own level of certainty.
- Do not tell the reader what to do with a patient.
- Return one entry per paper, using the paper's index. If a paper has a "problem" field, your previous answer for it was rejected for that reason: fix exactly that.`

export const cardDigestSkill = defineSkill<DigestInput, z.infer<typeof DigestsSchema>>({
  name: "clinical-card-digest",
  version: "2",
  run: (ctx, input) =>
    ctx.llmStructured(
      "fast",
      { maxTokens: 4096, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(input) }] },
      DigestsSchema,
    ),
})

/** The abstract as sentences, in order, section labels kept. The numbers the model sees are 1-based positions here. */
export function abstractSentences(abstract: string | undefined): string[] {
  return (abstract ?? "").split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"\u201c(\[])/))
    .map((sentence) => sentence.trim()).filter(Boolean).slice(0, SENTENCE_LIMIT)
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
/**
 * Numbers as plain digits with a point: journals print 0·74 and 21 025 where a model writes 0.74 and 21,025.
 * Only separators between digits are touched, so the comparison is still exact on the digits.
 */
const plainNumbers = (text: string) => text
  .replace(/(\d)[\u00b7\u2027\u2219](?=\d)/g, "$1.")
  .replace(/(\d)[,\u00a0\u2009\u202f ](?=\d{3}(?!\d))/g, "$1")
const numbers = (text: string) => plainNumbers(text).match(/\d+(?:\.\d+)?/g) ?? []

/** Checks one answer. Returns the digest, or the reason it is rejected. */
export function checkDigest(answer: Pick<DigestAnswer, "headline" | "takeaway" | "source">, paper: PaperRecord): { digest: CardDigest } | { reason: string } {
  const headline = answer.headline.trim()
  const takeaway = answer.takeaway.trim()
  if (!headline || !takeaway) return { reason: "empty" }
  if (wordCount(headline) > HEADLINE_MAX_WORDS || wordCount(takeaway) > TAKEAWAY_MAX_WORDS) return { reason: "too-long" }
  const quote = abstractSentences(paper.abstract)[answer.source - 1]
  if (!quote) return { reason: `no-such-sentence:${answer.source}` }
  const printed = new Set(numbers(`${paper.title} ${paper.abstract ?? ""}`))
  const invented = numbers(`${headline} ${takeaway}`).find((value) => !printed.has(value))
  if (invented) return { reason: `number-not-in-text:${invented}` }
  return { digest: { headline, takeaway, quote } }
}

/** What the model is told when it is asked again. */
function problemText(reason: string): string | undefined {
  const [kind, detail] = reason.split(":")
  if (kind === "number-not-in-text") return `You used the number ${detail}, which is not printed in the abstract. Use only numbers printed in the abstract, copied exactly.`
  if (kind === "no-such-sentence") return `There is no sentence number ${detail}. Give the number of an existing sentence.`
  if (kind === "too-long") return "The headline must be at most 12 words and the takeaway at most 35 words."
  if (kind === "empty") return "The headline and the takeaway must both be filled in."
  return undefined
}

export interface DigestRunOpts {
  storage: VaultStorage
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
  /** Digests already written for these papers (from the local cache); they are reused, not asked for again. */
  known?: ReadonlyMap<string, CardDigest>
}

type DigestItem = { key: string; paper: PaperRecord; design: Design }

/** Digests for the listed papers, keyed like the papers. Never throws: a failed call means fewer digests. */
export async function digestCards(
  items: DigestItem[], opts: DigestRunOpts,
): Promise<{ digests: Map<string, CardDigest>; costUsd: number | null; failed: boolean; dropped: Array<{ key: string; reason: string }> }> {
  const { known, ...runOpts } = opts
  const digests = new Map<string, CardDigest>()
  for (const item of items) { const cached = known?.get(item.key); if (cached) digests.set(item.key, cached) }
  const problems = new Map<string, string>()
  let costUsd: number | null = 0

  /** One round: batches run side by side; each paper ends with a digest or a reason. */
  async function round(todo: DigestItem[]): Promise<void> {
    const batches: DigestItem[][] = []
    for (let offset = 0; offset < todo.length; offset += CARD_DIGEST_BATCH) batches.push(todo.slice(offset, offset + CARD_DIGEST_BATCH))
    await Promise.all(batches.map(async (batch) => {
      const fail = () => { for (const item of batch) if (!problems.has(item.key)) problems.set(item.key, "call-failed") }
      try {
        const run = await runSkill({
          skill: cardDigestSkill,
          input: { papers: batch.map((item, index) => {
            const problem = problemText(problems.get(item.key) ?? "")
            return {
              index, title: item.paper.title, design: item.design,
              sentences: abstractSentences(item.paper.abstract).map((text, i) => ({ n: i + 1, text })),
              ...(problem ? { problem } : {}),
            }
          }) },
          ...runOpts,
        })
        costUsd = addCosts(costUsd, run.costUsd)
        if (run.status !== "ok" || !run.output) { fail(); return }
        const byIndex = new Map(run.output.digests.map((entry) => [entry.index, entry]))
        batch.forEach((item, index) => {
          const entry = byIndex.get(index)
          const result = entry ? checkDigest(entry, item.paper) : { reason: "not-returned" }
          if ("digest" in result) { digests.set(item.key, result.digest); problems.delete(item.key) }
          else problems.set(item.key, result.reason)
        })
      } catch {
        fail()
      }
    }))
  }

  const todo = items.filter((item) => !digests.has(item.key) && abstractSentences(item.paper.abstract).length > 0)
  await round(todo)
  const again = todo.filter((item) => problems.has(item.key))
  if (again.length > 0) await round(again)

  const dropped = todo.filter((item) => problems.has(item.key)).map((item) => ({ key: item.key, reason: problems.get(item.key) as string }))
  return { digests, costUsd, failed: dropped.some((drop) => drop.reason === "call-failed"), dropped }
}
