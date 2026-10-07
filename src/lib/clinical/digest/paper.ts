import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import { truncateAtWhitespace } from "../../text"
import { paperSlug, slugifyTitle } from "../../wiki/authoring"
import { PaperTextInfoSchema, type PaperTextInfo } from "../../papers/text-contract"
import type { PaperRecord } from "../../papers/types"
import type { VaultStorage } from "../../vault/storage"
import type { LLMProvider, Tier } from "../../llm/types"
import type { LLMSettings } from "../../llm/settings"
import { numbers } from "./card"

/**
 * The digest on the paper page (owner decision 2026-10-07): nine short items in a fixed order, in
 * place of upstream's long prose digest. Written from the full text when it can be read, from the
 * abstract otherwise; which of the two is recorded by code and shown with the digest.
 *
 * - An item the paper does not state is empty. The model is told to return null, and an answer such
 *   as "Not reported" is read as empty too.
 * - A number in an item must be printed in the text the model was given. If one is not, the model is
 *   asked once more; an item that still fails is kept but listed in `unverified`, so the page can say so.
 */

export const PAPER_DIGEST_ITEMS = ["question", "design", "population", "intervention", "mainResult", "safety", "limitations", "conclusion", "funding"] as const
export type PaperDigestItem = (typeof PAPER_DIGEST_ITEMS)[number]

const item = z.string().nullable().default(null)
const PaperDigestOutputSchema = z.object({
  question: item, design: item, population: item, intervention: item, mainResult: item, safety: item, limitations: item, conclusion: item, funding: item,
})
type PaperDigestOutput = z.infer<typeof PaperDigestOutputSchema>

const StoredPaperDigestSchema = z.object({
  version: z.literal(1),
  items: z.object(Object.fromEntries(PAPER_DIGEST_ITEMS.map((key) => [key, z.string().nullable()])) as Record<PaperDigestItem, z.ZodNullable<z.ZodString>>),
  unverified: z.array(z.enum(PAPER_DIGEST_ITEMS)),
  source: PaperTextInfoSchema,
})
export type StoredPaperDigest = z.infer<typeof StoredPaperDigestSchema>

/** How much of the full text goes to the model (characters). The same cap as upstream's digest. */
const MAX_FULL_TEXT_CHARS = 40_000

interface PaperDigestInput { title: string; journal?: string; abstract?: string; fullText?: string; problems?: string[] }

const SYSTEM_PROMPT = `You write a short structured digest of one clinical research paper for a psychiatrist. You are given the title, the abstract and, when it could be read, the full text.

Return these nine items. Each is one or two plain sentences, at most 45 words, or null when the paper does not state it. Never write "not reported" or a guess: use null.
- "question": the research question, as a question.
- "design": how the study was done: the design (for example randomised double-blind trial, cohort, meta-analysis of N trials), setting, duration or follow-up.
- "population": who was studied: number of participants, diagnosis, age group, key inclusion criteria.
- "intervention": what was compared: the intervention or exposure with its dose, and the comparator.
- "mainResult": the primary result with its key numbers exactly as printed, and the comparison.
- "safety": adverse events, harms, dropouts due to adverse events.
- "limitations": the main limitations the authors state.
- "conclusion": the authors' conclusion, in their level of certainty.
- "funding": the funder and any conflicts of interest declared.

Rules:
- Use only the text given. Add nothing from outside knowledge.
- Copy numbers exactly as printed. Never calculate a new number (no differences, ratios or rounding) and never state a number that is not printed in the text.
- Do not tell the reader what to do with a patient and do not judge the study's quality beyond what the authors say.
- If the input has "problems", your previous answer broke these rules there: write the digest again without them.`

export const paperDigestSkill = defineSkill<PaperDigestInput, PaperDigestOutput>({
  name: "clinical-paper-digest",
  version: "1",
  run: (ctx, input) =>
    ctx.llmStructured("strong", { maxTokens: 2048, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(input) }] }, PaperDigestOutputSchema),
})

const EMPTY_ANSWER = /^(?:n\/?a|none|null|not (?:reported|stated|mentioned|described|available|applicable|specified|provided)|no (?:information|data)[^.]*|unknown)\.?$/i

/** Each item tidied, with the items whose numbers are not printed in `sourceText`. */
export function checkPaperDigest(output: PaperDigestOutput, sourceText: string): { items: StoredPaperDigest["items"]; unverified: PaperDigestItem[]; problems: string[] } {
  const printed = new Set(numbers(sourceText))
  const items = {} as StoredPaperDigest["items"]
  const unverified: PaperDigestItem[] = []
  const problems: string[] = []
  for (const key of PAPER_DIGEST_ITEMS) {
    const text = output[key]?.replace(/\s+/g, " ").trim() ?? ""
    items[key] = text && !EMPTY_ANSWER.test(text) ? text : null
    const invented = items[key] ? numbers(items[key]).find((value) => !printed.has(value)) : undefined
    if (invented) {
      unverified.push(key)
      problems.push(`"${key}" used the number ${invented}, which is not printed in the text. Use only numbers printed in the text, or none.`)
    }
  }
  return { items, unverified, problems }
}

const cachePath = (slug: string) => `.scispark/clinical/paper-digests/${slug}.json`

/** The stored digest of a paper, or null. Never calls a model. A slug that is not a paper slug reads as nothing. */
export async function loadCachedPaperDigest(storage: VaultStorage, slug: string): Promise<StoredPaperDigest | null> {
  if (!slug || slug !== slugifyTitle(slug)) return null
  const raw = await storage.read(cachePath(slug))
  if (raw === null) return null
  try {
    const parsed = StoredPaperDigestSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * The digest of a paper: the stored one when it was written from the full text (or when there is
 * still no full text), otherwise a new one. Throws when the model call fails.
 */
export async function generatePaperDigest(
  storage: VaultStorage, paper: PaperRecord,
  opts: { fullText?: string; source?: PaperTextInfo; settings?: LLMSettings; providerOverride?: Partial<Record<Tier, LLMProvider>>; now?: () => Date } = {},
): Promise<{ digest: StoredPaperDigest; fromCache: boolean; costUsd?: number | null }> {
  const slug = paperSlug(paper)
  const hasFullText = Boolean(opts.fullText?.trim())
  const cached = await loadCachedPaperDigest(storage, slug)
  if (cached && (cached.source.access === "full-text" || !hasFullText)) return { digest: cached, fromCache: true }

  const truncated = hasFullText && (opts.fullText as string).length > MAX_FULL_TEXT_CHARS
  const fullText = hasFullText ? (truncated ? truncateAtWhitespace(opts.fullText as string, MAX_FULL_TEXT_CHARS) : (opts.fullText as string)) : undefined
  const input: PaperDigestInput = { title: paper.title, ...(paper.venue ? { journal: paper.venue } : {}), ...(paper.abstract ? { abstract: paper.abstract } : {}), ...(fullText ? { fullText } : {}) }
  const sourceText = `${paper.title} ${paper.abstract ?? ""} ${fullText ?? ""}`
  let costUsd: number | null | undefined
  const ask = async (problems?: string[]) => {
    const run = await runSkill({ skill: paperDigestSkill, input: { ...input, ...(problems ? { problems } : {}) }, storage, settings: opts.settings, providerOverride: opts.providerOverride, now: opts.now })
    if (run.status !== "ok" || run.output === undefined) throw new Error(run.error ?? `The digest could not be written (${run.status}).`)
    costUsd = costUsd === undefined ? run.costUsd : costUsd === null || run.costUsd === null ? null : costUsd + (run.costUsd ?? 0)
    return checkPaperDigest(run.output, sourceText)
  }
  let best = await ask()
  if (best.unverified.length > 0) {
    const again = await ask(best.problems).catch(() => null)
    if (again && again.unverified.length <= best.unverified.length) best = again
  }
  const digest: StoredPaperDigest = {
    version: 1, items: best.items, unverified: best.unverified,
    source: {
      ...(opts.source ?? { locator: hasFullText ? "Supplied full text" : "Abstract", checkedAt: (opts.now?.() ?? new Date()).toISOString(), notes: [] }),
      access: hasFullText ? "full-text" : "abstract", truncated: Boolean(opts.source?.truncated) || truncated,
    },
  }
  // The digest is returned even if it could not be stored.
  await storage.write(cachePath(slug), JSON.stringify(digest, null, 2)).catch(() => {})
  return { digest, fromCache: false, costUsd }
}
