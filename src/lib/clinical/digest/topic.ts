import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import { addCosts } from "../../llm/pricing"
import type { CardDigest, DigestRunOpts } from "./card"
import { numbers } from "./card"

/**
 * A short AI overview of the papers listed under one topic (owner request 2026-10-07). A statement
 * about several papers is easier to get wrong than a summary of one, so:
 *
 * - The model sees only the headline and takeaway already checked for each paper, never the abstracts.
 * - Every sentence must name the papers it rests on, by number; a sentence without a valid source is dropped.
 * - A sentence may use only numbers that appear in the headline or takeaway of the papers it names.
 * - A sentence must be short.
 *
 * What survives is stored with the list as sentences and the keys of their papers.
 */

export const OVERVIEW_MIN_PAPERS = 2
const OVERVIEW_MAX_PAPERS = 20
const SENTENCE_MAX_WORDS = 40

export interface OverviewSentence { text: string; sources: string[] }
export interface OverviewPaper { key: string; headline: string; takeaway: string }

const OverviewSchema = z.object({ sentences: z.array(z.object({ text: z.string(), sources: z.array(z.number().int()) })) })

interface OverviewInput {
  topic: string
  papers: Array<{ n: number; headline: string; takeaway: string }>
}

const SYSTEM_PROMPT = `You write a short overview of new papers on one topic for a busy psychiatrist. You are given the topic and, for each paper, a numbered headline and a one-sentence takeaway. Return 2 to 4 sentences that say what this batch of papers is about and what it found: group papers that point the same way, and say where they differ.

Rules:
- Use only the headlines and takeaways given. Add nothing from outside knowledge.
- Each sentence has "sources": the numbers of the papers it rests on. Every sentence needs at least one.
- Use a number only if it appears in the headline or takeaway of a paper you list as a source for that sentence. Copy it exactly; never calculate or round.
- Do not rank the papers, do not say which is best, and do not tell the reader what to do with a patient. Keep each paper's own level of certainty; a single small study is not "evidence shows".
- Do not write the paper numbers inside the sentence; they go only in "sources".
- Each sentence at most 35 words, plain language.`

export const topicOverviewSkill = defineSkill<OverviewInput, z.infer<typeof OverviewSchema>>({
  name: "clinical-topic-overview",
  version: "1",
  run: (ctx, input) =>
    ctx.llmStructured(
      "fast",
      { maxTokens: 1024, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(input) }] },
      OverviewSchema,
    ),
})

/** The topics worth an overview: those with at least two listed papers that have a checked summary. */
export function overviewTopics(items: Array<{ key: string; entryId: string | null; digest?: CardDigest }>): Array<{ entryId: string; papers: OverviewPaper[] }> {
  const byTopic = new Map<string, OverviewPaper[]>()
  for (const item of items) {
    if (!item.entryId || !item.digest) continue
    const papers = byTopic.get(item.entryId) ?? []
    if (papers.length < OVERVIEW_MAX_PAPERS) papers.push({ key: item.key, headline: item.digest.headline, takeaway: item.digest.takeaway })
    byTopic.set(item.entryId, papers)
  }
  return [...byTopic].filter(([, papers]) => papers.length >= OVERVIEW_MIN_PAPERS).map(([entryId, papers]) => ({ entryId, papers }))
}

/** Keeps the sentences that pass the checks; `sources` become the keys of the papers. */
export function checkOverview(sentences: Array<{ text: string; sources: number[] }>, papers: OverviewPaper[]): OverviewSentence[] {
  return sentences.flatMap((sentence) => {
    // The sources are shown beside the sentence; markers the model also wrote into it ("(1)", "[2, 3]") are removed.
    const text = sentence.text.replace(/\s*[([]\s*\d{1,2}(?:\s*[,;]\s*\d{1,2})*\s*[)\]]/g, "").replace(/\s+([.,;:])/g, "$1").trim()
    const cited = [...new Set(sentence.sources)].map((n) => papers[n - 1]).filter((paper): paper is OverviewPaper => paper !== undefined)
    if (!text || cited.length === 0) return []
    if (text.split(/\s+/).length > SENTENCE_MAX_WORDS) return []
    const printed = new Set(cited.flatMap((paper) => numbers(`${paper.headline} ${paper.takeaway}`)))
    if (numbers(text).some((value) => !printed.has(value))) return []
    return [{ text, sources: cited.map((paper) => paper.key) }]
  })
}

/** One overview per topic, written side by side. Never throws: a failed call means no overview for that topic. */
export async function writeTopicOverviews(
  topics: Array<{ entryId: string; label: string; papers: OverviewPaper[] }>, opts: Omit<DigestRunOpts, "known">,
): Promise<{ overviews: Record<string, OverviewSentence[]>; costUsd: number | null }> {
  const overviews: Record<string, OverviewSentence[]> = {}
  let costUsd: number | null = 0
  await Promise.all(topics.map(async (topic) => {
    try {
      const run = await runSkill({
        skill: topicOverviewSkill,
        input: { topic: topic.label, papers: topic.papers.map((paper, index) => ({ n: index + 1, headline: paper.headline, takeaway: paper.takeaway })) },
        ...opts,
      })
      costUsd = addCosts(costUsd, run.costUsd)
      if (run.status !== "ok" || !run.output) return
      const kept = checkOverview(run.output.sentences, topic.papers)
      if (kept.length > 0) overviews[topic.entryId] = kept
    } catch {
      // No overview for this topic; the list is unaffected.
    }
  }))
  return { overviews, costUsd }
}
