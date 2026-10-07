import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import { addCosts } from "../../llm/pricing"
import type { CardDigest, DigestRunOpts } from "./card"
import { numbers } from "./card"
import { tidyOverviewSentence } from "../text/overview-text"

export { tidyOverviewSentence }

/**
 * A short AI overview of the papers listed under one topic (owner request 2026-10-07). A statement
 * about several papers is easier to get wrong than a summary of one, so:
 *
 * - The model sees only the headline and takeaway already checked for each paper, never the abstracts.
 * - Every sentence must name the papers it rests on, by number; a sentence without a valid source is dropped.
 * - A sentence may use only numbers that appear in the headline or takeaway of the papers it names.
 * - A sentence must be short.
 *
 * Since 2026-10-07 the overview is a synthesis rather than a list of points: each sentence has a kind
 * (benefit, no benefit, mixed, safety, other), papers that found related things share a sentence, and
 * every listed paper must be a source of some sentence. The page sets the sentences as running text by
 * kind and counts the papers of each kind itself; the model does not write the counts.
 *
 * What survives is stored with the list as sentences and the keys of their papers.
 */

export const OVERVIEW_MIN_PAPERS = 2
const OVERVIEW_MAX_PAPERS = 20
/** One sentence about one thing. The model is asked for fewer words than this. */
const SENTENCE_MAX_WORDS = 36

/**
 * How many sentences an overview of this many papers may have. Fewer than the papers, so that those
 * which found related things have to share a sentence; otherwise the overview is the list again.
 */
export function overviewSentenceLimit(papers: number): number {
  return Math.min(8, Math.max(3, Math.ceil(papers * 0.6)))
}

/** What a finding says: a treatment helped, did not help, did both, raised a safety concern, or something else was found. */
export const OVERVIEW_KINDS = ["benefit", "no-benefit", "mixed", "safety", "other"] as const
export type OverviewKind = (typeof OVERVIEW_KINDS)[number]

export interface OverviewSentence {
  text: string
  sources: string[]
  /** "focus": about papers that match the whole topic; "related": about papers that match only its condition (or only its treatment). */
  group?: "focus" | "related"
  /** What the finding says about benefit. Absent in overviews written before 2026-10-07. */
  kind?: OverviewKind
  /** Words of the sentence to mark, so the eye finds the point. Each is in `text` as written. */
  emphasis?: string[]
}
export interface OverviewPaper { key: string; headline: string; takeaway: string; part: "focus" | "related" }

const OverviewSchema = z.object({
  sentences: z.array(z.object({
    text: z.string(), sources: z.array(z.number().int()),
    group: z.enum(["focus", "related"]).nullable().default(null), kind: z.enum(OVERVIEW_KINDS).nullable().default(null), emphasis: z.array(z.string()).default([]),
  })),
})

interface OverviewInput {
  topic: string
  papers: Array<{ n: number; part: "focus" | "related"; headline: string; takeaway: string }>
  /** The most sentences the answer may have. */
  maxSentences: number
  /** Why sentences of the previous answer were rejected, when this is the second try. */
  problems?: string[]
}

const SYSTEM_PROMPT = `You write the short overview a busy psychiatrist reads before the paper list of one topic: which treatments the new papers found to help, which they found not to help, where the result was mixed, what safety concerns they raise, and what else they found. It reads as running text, not as a list of the papers. You are given the topic and, for each paper, a number, a headline, a one-sentence takeaway, and "part": "focus" for a paper about the whole topic (its condition and its treatment), "related" for a paper about the condition with another treatment or none.

Return "sentences": at most "maxSentences" of them, and every paper must be a source of at least one. That is fewer sentences than papers, so you must join: papers on the same treatment, or with the same kind of result, share ONE sentence that lists them all as sources (for example "Ketamine improved depressive symptoms and suicidal thoughts in treatment-resistant depression" for three ketamine papers, or "Psychoeducation and arts therapy improved coping and hope" for two). Never write one sentence per paper. Each sentence:
- "text": one plain sentence of at most 30 words, starting with a capital letter and ending with a full stop. Name the treatment or exposure and what was found, with the patient group when it matters. No filler ("recent papers explore"), no study-design words unless they are the point.
- "kind": "benefit" if a treatment or intervention did better than its comparator or improved the outcome; "no-benefit" if it made no difference, did worse, or the trial failed; "mixed" if it helped on one outcome and not on another; "safety" if the finding is a harm, adverse effect or risk of a treatment; "other" for everything that is not about whether a treatment works (risk factors, mechanisms, prediction, prevalence, service use, protocols).
- "group": "focus" or "related", the part its papers belong to. Never mix the two parts in one sentence.
- "sources": the numbers of the papers the sentence rests on. At least one.
- "emphasis": exactly one phrase of one to four words copied exactly from your text: the name of the treatment or exposure. An empty list if the sentence has none.

Rules:
- Use only the headlines and takeaways given. Add nothing from outside knowledge.
- Keep each paper's own level of certainty: an association is "was linked to", not "caused"; a pilot or single small study "suggested". Never write "evidence shows".
- When a treatment did not help, say so with the word "not" or "no".
- Use a number only if it appears in the headline or takeaway of a paper you list as a source for that sentence. Copy it exactly; never calculate or round. Prefer no number.
- Do not write paper numbers, brackets with numbers, or phrases like "paper 2" inside the text.
- Do not rank the papers, do not say which is best, and do not tell the reader what to do with a patient.
- If the input has "problems", your previous answer had them: write it again without them.`

export const topicOverviewSkill = defineSkill<OverviewInput, z.infer<typeof OverviewSchema>>({
  name: "clinical-topic-overview",
  version: "7",
  run: (ctx, input) =>
    ctx.llmStructured(
      // The stronger model: weighing several papers against each other is where the small one writes filler.
      "strong",
      { maxTokens: 1024, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(input) }] },
      OverviewSchema,
    ),
})

/** The topics worth an overview: those with at least two listed papers that have a checked summary. */
export function overviewTopics(
  items: Array<{ key: string; entryId: string | null; digest?: CardDigest; matched?: "full" | "condition" | "treatment" }>,
): Array<{ entryId: string; papers: OverviewPaper[] }> {
  const byTopic = new Map<string, OverviewPaper[]>()
  for (const item of items) {
    if (!item.entryId || !item.digest) continue
    const papers = byTopic.get(item.entryId) ?? []
    // A paper that matches only part of the topic is summarised apart from those that match all of it.
    const part = item.matched === "condition" || item.matched === "treatment" ? "related" : "focus"
    papers.push({ key: item.key, headline: item.digest.headline, takeaway: item.digest.takeaway, part })
    byTopic.set(item.entryId, papers)
  }
  return [...byTopic]
    .map(([entryId, papers]) => ({ entryId, papers: [...papers.filter((paper) => paper.part === "focus"), ...papers.filter((paper) => paper.part === "related")].slice(0, OVERVIEW_MAX_PAPERS) }))
    .filter((topic) => topic.papers.length >= OVERVIEW_MIN_PAPERS)
}

/** Checks each sentence. `kept` have the keys of their papers as sources; `problems` say why the others were rejected. */
export function judgeOverview(
  sentences: Array<{ text: string; sources: number[]; group?: "focus" | "related" | null; kind?: OverviewKind | null; emphasis?: string[] }>, papers: Array<Omit<OverviewPaper, "part"> & { part?: OverviewPaper["part"] }>,
): { kept: OverviewSentence[]; problems: string[] } {
  const kept: OverviewSentence[] = []
  const problems: string[] = []
  for (const sentence of sentences) {
    const text = tidyOverviewSentence(sentence.text)
    const cited = [...new Set(sentence.sources)].flatMap((n) => papers[n - 1] ?? [])
    if (!text) { problems.push("empty"); continue }
    if (cited.length === 0) { problems.push("no-source"); continue }
    if (text.split(/\s+/).length > SENTENCE_MAX_WORDS) { problems.push("too-long"); continue }
    const printed = new Set(cited.flatMap((paper) => numbers(`${paper.headline} ${paper.takeaway}`)))
    const invented = numbers(text).find((value) => !printed.has(value))
    if (invented) { problems.push(`number-not-in-sources:${invented}`); continue }
    // Only words that are in the sentence as written can be marked in it.
    const emphasis = (sentence.emphasis ?? []).map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 1 && phrase.split(/\s+/).length <= 4 && text.includes(phrase)).slice(0, 2)
    kept.push({ text, sources: cited.map((paper) => paper.key), ...(sentence.group ? { group: sentence.group } : {}), ...(sentence.kind ? { kind: sentence.kind } : {}), ...(emphasis.length > 0 ? { emphasis } : {}) })
  }
  return { kept, problems }
}

/** Keeps the sentences that pass the checks; `sources` become the keys of the papers. */
export function checkOverview(sentences: Parameters<typeof judgeOverview>[0], papers: Parameters<typeof judgeOverview>[1]): OverviewSentence[] {
  return judgeOverview(sentences, papers).kept
}

/** What the model is told on the second try. */
function problemText(reason: string): string {
  const [kind, detail] = reason.split(":")
  if (kind === "number-not-in-sources") return `A sentence used the number ${detail}, which is not in the headline or takeaway of the papers it listed as sources. Use only numbers from the sources of that sentence, or no number.`
  if (kind === "no-source") return "A sentence listed no valid paper number in its sources. Every sentence needs at least one."
  if (kind === "too-long") return "A sentence was too long. Keep each sentence to at most 30 words."
  return "A sentence was empty."
}

/**
 * One overview per topic, written side by side. A topic whose first answer lost sentences to the
 * checks is asked once more, with the reasons; the answer with more sentences left is kept. Never
 * throws: a topic without an overview is listed in `dropped` with the reason.
 */
export async function writeTopicOverviews(
  topics: Array<{ entryId: string; label: string; papers: OverviewPaper[] }>, opts: Omit<DigestRunOpts, "known">,
): Promise<{ overviews: Record<string, OverviewSentence[]>; costUsd: number | null; dropped: Array<{ entryId: string; reason: string }> }> {
  const overviews: Record<string, OverviewSentence[]> = {}
  const dropped: Array<{ entryId: string; reason: string }> = []
  let costUsd: number | null = 0
  await Promise.all(topics.map(async (topic) => {
    const papers = topic.papers.map((paper, index) => ({ n: index + 1, part: paper.part, headline: paper.headline, takeaway: paper.takeaway }))
    const limit = overviewSentenceLimit(topic.papers.length)
    const ask = async (problems?: string[]) => {
      const run = await runSkill({ skill: topicOverviewSkill, input: { topic: topic.label, papers, maxSentences: limit, ...(problems ? { problems } : {}) }, ...opts })
      costUsd = addCosts(costUsd, run.costUsd)
      return run.status === "ok" && run.output ? judgeOverview(run.output.sentences, topic.papers) : null
    }
    try {
      // The overview is about the whole list: a paper no sentence rests on is a reason to ask again.
      const leftOut = (answer: { kept: OverviewSentence[] }) => topic.papers.flatMap((paper, index) => (answer.kept.some((sentence) => sentence.sources.includes(paper.key)) ? [] : index + 1))
      let best = await ask()
      if (best && (best.problems.length > 0 || leftOut(best).length > 0 || best.kept.length > limit)) {
        const missing = leftOut(best)
        const tooMany = best.kept.length > limit ? [`You wrote ${best.kept.length} sentences; write at most ${limit}. Join papers on the same treatment or with the same kind of result into one sentence.`] : []
        const problems = [...new Set(best.problems.map(problemText)), ...tooMany, ...(missing.length > 0 ? [`No sentence listed ${missing.length === 1 ? "paper" : "papers"} ${missing.join(", ")} as a source. Every paper must be a source of at least one sentence; join papers that found related things.`] : [])]
        const again = await ask(problems).catch(() => null)
        // Better: leaves out fewer papers; then, is within the limit; then, loses fewer sentences to the checks.
        const worse = (answer: NonNullable<typeof best>) => [leftOut(answer).length, answer.kept.length > limit ? 1 : 0, answer.problems.length]
        const [a, b] = [again ? worse(again) : null, worse(best)]
        if (again && again.kept.length > 0 && a && (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2]))))) best = again
      }
      // An overview is a glance, not a second list.
      if (best && best.kept.length > 0) overviews[topic.entryId] = best.kept
      else dropped.push({ entryId: topic.entryId, reason: best?.problems[0] ?? "call-failed" })
    } catch {
      dropped.push({ entryId: topic.entryId, reason: "call-failed" })
    }
  }))
  return { overviews, costUsd, dropped }
}
