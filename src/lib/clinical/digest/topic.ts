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
 * What survives is stored with the list as sentences and the keys of their papers.
 */

export const OVERVIEW_MIN_PAPERS = 2
const OVERVIEW_MAX_PAPERS = 20
const SENTENCE_MAX_WORDS = 30
const OVERVIEW_MAX_SENTENCES = 5

export interface OverviewSentence {
  text: string
  sources: string[]
  /** "focus": about papers that match the whole topic; "related": about papers that match only its condition (or only its treatment). */
  group?: "focus" | "related"
  /** Words of the sentence to mark, so the eye finds the point. Each is in `text` as written. */
  emphasis?: string[]
}
export interface OverviewPaper { key: string; headline: string; takeaway: string; part: "focus" | "related" }

const OverviewSchema = z.object({
  sentences: z.array(z.object({
    text: z.string(), sources: z.array(z.number().int()),
    group: z.enum(["focus", "related"]).nullable().default(null), emphasis: z.array(z.string()).default([]),
  })),
})

interface OverviewInput {
  topic: string
  papers: Array<{ n: number; part: "focus" | "related"; headline: string; takeaway: string }>
  /** Why sentences of the previous answer were rejected, when this is the second try. */
  problems?: string[]
}

const SYSTEM_PROMPT = `You write a very short overview of new papers on one topic for a busy psychiatrist, as separate points, not as a paragraph. You are given the topic and, for each paper, a number, a headline, a one-sentence takeaway, and "part": "focus" for a paper about the whole topic (its condition and its treatment), "related" for a paper about the condition with another treatment or none.

Return "sentences": at most 3 points about the focus papers and at most 2 about the related papers. Skip a part that has no papers. Each point:
- "text": ONE plain sentence of at most 22 words saying what the papers found. Name the treatment and the finding. Put the finding first. No filler ("recent papers explore", "various interventions"), no lists of everything.
- "group": "focus" or "related", the part its papers belong to. Do not mix the two parts in one point.
- "sources": the numbers of the papers the point rests on. At least one.
- "emphasis": one or two short phrases (one to three words each) copied exactly from your text, the words a reader should see first: usually the treatment and the result.

Rules:
- Use only the headlines and takeaways given. Add nothing from outside knowledge.
- Use a number only if it appears in the headline or takeaway of a paper you list as a source for that point. Copy it exactly; never calculate or round. Prefer no number to a long string of statistics.
- Do not write paper numbers, brackets with numbers, or phrases like "paper 2" inside the text.
- Do not rank the papers, do not say which is best, and do not tell the reader what to do with a patient. Keep each paper's own level of certainty; a single small study is not "evidence shows".
- If the input has "problems", your previous answer lost points for those reasons: write the overview again without them.`

export const topicOverviewSkill = defineSkill<OverviewInput, z.infer<typeof OverviewSchema>>({
  name: "clinical-topic-overview",
  version: "4",
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
  sentences: Array<{ text: string; sources: number[]; group?: "focus" | "related" | null; emphasis?: string[] }>, papers: Array<Omit<OverviewPaper, "part"> & { part?: OverviewPaper["part"] }>,
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
    kept.push({ text, sources: cited.map((paper) => paper.key), ...(sentence.group ? { group: sentence.group } : {}), ...(emphasis.length > 0 ? { emphasis } : {}) })
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
  if (kind === "too-long") return "A point was too long. Keep each point to one sentence of at most 22 words."
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
    const ask = async (problems?: string[]) => {
      const run = await runSkill({ skill: topicOverviewSkill, input: { topic: topic.label, papers, ...(problems ? { problems } : {}) }, ...opts })
      costUsd = addCosts(costUsd, run.costUsd)
      return run.status === "ok" && run.output ? judgeOverview(run.output.sentences, topic.papers) : null
    }
    try {
      let best = await ask()
      if (best && best.problems.length > 0) {
        const again = await ask([...new Set(best.problems.map(problemText))]).catch(() => null)
        if (again && again.kept.length >= best.kept.length) best = again
      }
      // An overview is a glance, not a second list: at most five sentences.
      if (best && best.kept.length > 0) overviews[topic.entryId] = best.kept.slice(0, OVERVIEW_MAX_SENTENCES)
      else dropped.push({ entryId: topic.entryId, reason: best?.problems[0] ?? "call-failed" })
    } catch {
      dropped.push({ entryId: topic.entryId, reason: "call-failed" })
    }
  }))
  return { overviews, costUsd, dropped }
}
