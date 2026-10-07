import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import { headAndTail } from "../../text"
import { paperSlug, slugifyTitle } from "../../wiki/authoring"
import { PaperTextInfoSchema, type PaperTextInfo } from "../../papers/text-contract"
import { paperKey, type PaperRecord } from "../../papers/types"
import { CLINICAL_COPY } from "../copy"
import type { VaultStorage } from "../../vault/storage"
import type { LLMProvider, Tier } from "../../llm/types"
import type { LLMSettings } from "../../llm/settings"
import { numbers } from "./card"
import { quoteInText } from "../text/quote"

/**
 * The digest on the paper page (owner decision 2026-10-07): short items in a fixed order (nine, and
 * one more that mostly only a full text gives, the secondary outcomes; the primary outcome is named
 * inside the main result, not as an item of its own), in
 * place of upstream's long prose digest. Written from the full text when it can be read, from the
 * abstract otherwise; which of the two is recorded by code and shown with the digest.
 *
 * - An item the paper does not state is empty. The model is told to return null, and an answer such
 *   as "Not reported" is read as empty too.
 * - Each item names the one sentence of the paper it rests on; the sentence is kept only if it is in
 *   the text word for word (spec 5.4), and a quote that is not is treated like a wrong number.
 * - A number in an item must be printed in the text the model was given. If one is not, the model is
 *   asked once more; an item that still fails is kept but listed in `unverified`, so the page can say so.
 */

export const PAPER_DIGEST_ITEMS = ["question", "design", "population", "intervention", "mainResult", "secondaryOutcomes", "safety", "limitations", "conclusion", "funding"] as const
export type PaperDigestItem = (typeof PAPER_DIGEST_ITEMS)[number]

const item = z.string().nullable().default(null)
const ITEM_SHAPE = { question: item, design: item, population: item, intervention: item, mainResult: item, secondaryOutcomes: item, safety: item, limitations: item, conclusion: item, funding: item }
const NO_QUOTES = Object.fromEntries(PAPER_DIGEST_ITEMS.map((key) => [key, null])) as Record<PaperDigestItem, string | null>
const PaperDigestOutputSchema = z.object({
  ...ITEM_SHAPE,
  /** For each item, the one sentence of the text it rests on, copied word for word. */
  quotes: z.object(ITEM_SHAPE).default(NO_QUOTES),
})
type PaperDigestOutput = z.infer<typeof PaperDigestOutputSchema>

const StoredPaperDigestSchema = z.object({
  version: z.literal(1),
  /** The paper the digest was written for. Two papers can share a file name (same title, no DOI); a digest is used only for its own paper. */
  paperKey: z.string().optional(),
  // An item added later is empty in a digest stored before it existed.
  items: z.object(Object.fromEntries(PAPER_DIGEST_ITEMS.map((key) => [key, item])) as Record<PaperDigestItem, typeof item>),
  /** The sentence of the paper each item rests on, where the model gave one that is in the text word for word. */
  quotes: z.object(Object.fromEntries(PAPER_DIGEST_ITEMS.map((key) => [key, item])) as Record<PaperDigestItem, typeof item>).default(NO_QUOTES),
  unverified: z.array(z.enum(PAPER_DIGEST_ITEMS)),
  source: PaperTextInfoSchema,
})
export type StoredPaperDigest = z.infer<typeof StoredPaperDigestSchema>

/** How much of the full text goes to the model (characters): all that upstream's reader keeps, which is the beginning and the end of a long paper. */
const MAX_FULL_TEXT_CHARS = 45_000

interface PaperDigestInput { title: string; journal?: string; abstract?: string; fullText?: string; problems?: string[] }

const SYSTEM_PROMPT = `You write a short structured digest of one clinical research paper for a psychiatrist. You are given the title, the abstract and, when it could be read, the full text.

Return these ten items. Each is one or two plain sentences, at most 45 words (at most 70 for "mainResult" and "secondaryOutcomes" when you have the full text), or null when the text does not state it. Never write "not reported" or a guess: use null.
- "question": the research question, as a question.
- "design": how the study was done: the design (for example randomised double-blind trial, cohort, meta-analysis of N trials), setting, duration or follow-up.
- "population": who was studied: number of participants, diagnosis, age group, key inclusion criteria.
- "intervention": what was compared: the intervention or exposure with its dose, and the comparator.
- "mainResult": the result on the primary outcome: name the outcome (the scale or definition and the time point) and give the result in each group, with the effect size, confidence interval and p value exactly as printed when the text gives them.
- "secondaryOutcomes": the key secondary outcomes with their results.
- "safety": adverse events, harms, dropouts due to adverse events.
- "limitations": the main limitations the authors state.
- "conclusion": the authors' conclusion, in their level of certainty.
- "funding": the funder and any conflicts of interest declared.

Also return "quotes": for every item you filled, the ONE sentence of the text that the item rests on most, copied word for word, without changing a character; null for an item you left null. A quote that is not in the text word for word is rejected.

Rules:
- Use only the text given. Add nothing from outside knowledge. A mark "[...]" in the full text shows where the middle of a long paper was left out.
- Copy numbers exactly as printed. Never calculate a new number (no differences, ratios or rounding) and never state a number that is not printed in the text.
- Do not tell the reader what to do with a patient and do not judge the study's quality beyond what the authors say.
- If the input has "problems", your previous answer broke these rules there: write the digest again without them.`

export const paperDigestSkill = defineSkill<PaperDigestInput, PaperDigestOutput>({
  name: "clinical-paper-digest",
  version: "4",
  run: (ctx, input) =>
    ctx.llmStructured("strong", { maxTokens: 4096, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(input) }] }, PaperDigestOutputSchema),
})

const EMPTY_ANSWER = /^(?:n\/?a|none|null|not (?:reported|stated|mentioned|described|available|applicable|specified|provided)|no (?:information|data)[^.]*|unknown)\.?$/i

/**
 * Each item tidied, with the sentence it rests on when that sentence is in `sourceText` word for word,
 * and the items that failed a check: a number the text does not print, or a quote that is not in it.
 */
export function checkPaperDigest(output: PaperDigestOutput, sourceText: string): { items: StoredPaperDigest["items"]; quotes: StoredPaperDigest["quotes"]; unverified: PaperDigestItem[]; problems: string[] } {
  const printed = new Set(numbers(sourceText))
  const items = {} as StoredPaperDigest["items"]
  const quotes = { ...NO_QUOTES }
  const unverified: PaperDigestItem[] = []
  const problems: string[] = []
  for (const key of PAPER_DIGEST_ITEMS) {
    const text = output[key]?.replace(/\s+/g, " ").trim() ?? ""
    items[key] = text && !EMPTY_ANSWER.test(text) ? text : null
    if (!items[key]) continue
    const invented = numbers(items[key]).find((value) => !printed.has(value))
    if (invented) problems.push(`"${key}" used the number ${invented}, which is not printed in the text. Use only numbers printed in the text, or none.`)
    const quote = output.quotes?.[key]?.replace(/\s+/g, " ").trim() ?? ""
    const quoted = quote.length > 0 && quoteInText(quote, sourceText)
    if (quoted) quotes[key] = quote
    else if (quote.length > 0) problems.push(`The quote given for "${key}" is not in the text word for word. Copy one sentence exactly as it is printed.`)
    if (invented || (quote.length > 0 && !quoted)) unverified.push(key)
  }
  return { items, quotes, unverified, problems }
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
  const stored = await loadCachedPaperDigest(storage, slug)
  const cached = stored && (stored.paperKey === undefined || stored.paperKey === paperKey(paper)) ? stored : null
  if (cached && (cached.source.access === "full-text" || !hasFullText)) return { digest: cached, fromCache: true }

  const truncated = hasFullText && (opts.fullText as string).length > MAX_FULL_TEXT_CHARS
  const fullText = hasFullText ? (truncated ? headAndTail(opts.fullText as string, MAX_FULL_TEXT_CHARS, 8_000) : (opts.fullText as string)) : undefined
  const input: PaperDigestInput = { title: paper.title, ...(paper.venue ? { journal: paper.venue } : {}), ...(paper.abstract ? { abstract: paper.abstract } : {}), ...(fullText ? { fullText } : {}) }
  const sourceText = `${paper.title} ${paper.abstract ?? ""} ${fullText ?? ""}`
  let costUsd: number | null | undefined
  const ask = async (problems?: string[]) => {
    const run = await runSkill({ skill: paperDigestSkill, input: { ...input, ...(problems ? { problems } : {}) }, storage, settings: opts.settings, providerOverride: opts.providerOverride, now: opts.now })
    if (run.status !== "ok" || run.output === undefined) throw new Error(run.error ?? CLINICAL_COPY.paper.digest.failed(run.status))
    costUsd = costUsd === undefined ? run.costUsd : costUsd === null || run.costUsd === null ? null : costUsd + (run.costUsd ?? 0)
    return checkPaperDigest(run.output, sourceText)
  }
  let best = await ask()
  if (best.unverified.length > 0) {
    const again = await ask(best.problems).catch(() => null)
    // The second answer wins only if it fails fewer checks without having emptied items to get there.
    const filled = (answer: typeof best) => PAPER_DIGEST_ITEMS.filter((key) => answer.items[key]).length
    if (again && again.unverified.length <= best.unverified.length && filled(again) >= filled(best)) best = again
  }
  const digest: StoredPaperDigest = {
    version: 1, paperKey: paperKey(paper), items: best.items, quotes: best.quotes, unverified: best.unverified,
    source: {
      ...(opts.source ?? { locator: hasFullText ? "Supplied full text" : "Abstract", checkedAt: (opts.now?.() ?? new Date()).toISOString(), notes: [] }),
      access: hasFullText ? "full-text" : "abstract", truncated: Boolean(opts.source?.truncated) || truncated,
    },
  }
  // The digest is returned even if it could not be stored.
  await storage.write(cachePath(slug), JSON.stringify(digest, null, 2)).catch(() => {})
  return { digest, fromCache: false, costUsd }
}
