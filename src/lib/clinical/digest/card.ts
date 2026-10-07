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
 * the abstract. This is generated text in a clinical tool, so code checks every one before it is
 * shown: the supporting quote must be in the abstract, no number may appear that the paper's text
 * does not contain, and both must be short. A digest that fails a check is dropped, and the card
 * falls back to the paper's own title and the authors' conclusion.
 */

export const CARD_DIGEST_BATCH = 12
const ABSTRACT_LIMIT = 2400
const HEADLINE_MAX_WORDS = 16
const TAKEAWAY_MAX_WORDS = 45

export interface CardDigest {
  headline: string
  takeaway: string
  quote: string
}

const DigestsSchema = z.object({
  digests: z.array(z.object({ index: z.number().int(), headline: z.string(), takeaway: z.string(), quote: z.string() })),
})

interface DigestInput {
  papers: Array<{ index: number; title: string; design: string; abstract: string }>
}

const SYSTEM_PROMPT = `You write card text that lets a busy psychiatrist scan new papers. For each paper return:

- "headline": at most 12 words, plain language, saying what the study found or, if it reports no result, what it examined. Name the treatment and the condition. No hype, no advice, no words like "breakthrough" or "promising" unless the abstract uses them.
- "takeaway": ONE sentence, at most 35 words, giving the main result with its key numbers exactly as the abstract states them, and the comparison group if there is one. If the abstract gives no result, say what was studied and that no result is reported.
- "quote": the ONE sentence copied VERBATIM from the abstract that your takeaway rests on.

Rules:
- Use only the title and abstract given. Add nothing from outside knowledge.
- Never state a number that is not in the abstract. Never turn an association into a causal claim. Keep the abstract's own level of certainty.
- Do not tell the reader what to do with a patient.
- Return one entry per paper, using the paper's index.`

export const cardDigestSkill = defineSkill<DigestInput, z.infer<typeof DigestsSchema>>({
  name: "clinical-card-digest",
  version: "1",
  run: (ctx, input) =>
    ctx.llmStructured(
      "fast",
      { maxTokens: 4096, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(input) }] },
      DigestsSchema,
    ),
})

const squash = (text: string) => text.toLowerCase().replace(/[\s ]+/g, " ").trim()
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
const numbers = (text: string) => text.match(/\d+(?:[.,]\d+)*/g) ?? []

/** The code checks a digest must pass before it is shown. */
export function acceptDigest(digest: CardDigest, paper: PaperRecord): boolean {
  const headline = digest.headline.trim()
  const takeaway = digest.takeaway.trim()
  if (!headline || !takeaway) return false
  if (wordCount(headline) > HEADLINE_MAX_WORDS || wordCount(takeaway) > TAKEAWAY_MAX_WORDS) return false
  const abstract = squash(paper.abstract ?? "")
  const quote = squash(digest.quote).replace(/^["'“”]+|["'“”]+$/g, "").trim()
  if (quote.length < 8 || !abstract.includes(quote)) return false
  const source = squash(`${paper.title} ${paper.abstract ?? ""}`)
  return numbers(`${headline} ${takeaway}`).every((value) => source.includes(value))
}

export interface DigestRunOpts {
  storage: VaultStorage
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
}

/** Digests for the listed papers, keyed like the papers. Never throws: a failed call means fewer digests. */
export async function digestCards(
  items: Array<{ key: string; paper: PaperRecord; design: Design }>, opts: DigestRunOpts,
): Promise<{ digests: Map<string, CardDigest>; costUsd: number | null; failed: boolean }> {
  const digests = new Map<string, CardDigest>()
  const withAbstract = items.filter((item) => (item.paper.abstract ?? "").trim().length > 0)
  let costUsd: number | null = 0
  let failed = false
  for (let offset = 0; offset < withAbstract.length; offset += CARD_DIGEST_BATCH) {
    const batch = withAbstract.slice(offset, offset + CARD_DIGEST_BATCH)
    try {
      const run = await runSkill({
        skill: cardDigestSkill,
        input: { papers: batch.map((item, index) => ({ index, title: item.paper.title, design: item.design, abstract: (item.paper.abstract ?? "").slice(0, ABSTRACT_LIMIT) })) },
        ...opts,
      })
      costUsd = addCosts(costUsd, run.costUsd)
      if (run.status !== "ok" || !run.output) { failed = true; continue }
      for (const entry of run.output.digests) {
        const item = batch[entry.index]
        if (!item) continue
        const digest = { headline: entry.headline.trim(), takeaway: entry.takeaway.trim(), quote: entry.quote.trim() }
        if (acceptDigest(digest, item.paper)) digests.set(item.key, digest)
      }
    } catch {
      failed = true
    }
  }
  return { digests, costUsd, failed }
}
