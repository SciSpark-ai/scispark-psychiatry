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
 * Since 2026-10-07 the overview is a synthesis rather than a list of points: each finding is a short
 * clause with a kind (benefit, no benefit, safety, other), and papers that found the same share one
 * finding. The page groups the findings by kind. What the findings rest on (how many papers, of which
 * designs) is counted by the page from the listed papers; the model does not write it.
 *
 * What survives is stored with the list as sentences and the keys of their papers.
 */

export const OVERVIEW_MIN_PAPERS = 2
const OVERVIEW_MAX_PAPERS = 20
/** A finding is a clause, not a sentence about several things. The model is asked for fewer words than this. */
const SENTENCE_MAX_WORDS = 18
const OVERVIEW_MAX_SENTENCES = 8

/** What a finding says: a treatment helped, did not help, raised a safety concern, or something else was found. */
export const OVERVIEW_KINDS = ["benefit", "no-benefit", "safety", "other"] as const
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
  /** Why sentences of the previous answer were rejected, when this is the second try. */
  problems?: string[]
}

const SYSTEM_PROMPT = `You write the synthesis a busy psychiatrist reads before the paper list of one topic: what the new papers found to help, what they found not to help, what safety concerns they raise, and what else they found. It is a synthesis, not a list of the papers. You are given the topic and, for each paper, a number, a headline, a one-sentence takeaway, and "part": "focus" for a paper about the whole topic (its condition and its treatment), "related" for a paper about the condition with another treatment or none.

Return "sentences": at most 5 findings from the focus papers and at most 3 from the related papers. Skip a part that has no papers. Leave out papers that add nothing a clinician would want (protocols, methods papers); you need not use every paper. Each finding:
- "text": ONE short clause of at most 14 words that names the treatment or exposure and what was found, in lower case unless a name, with no full stop. Examples of the form: "adjunctive X lowered relapse compared with placebo", "X did not improve remission over usual care", "X was linked to weight gain". No filler ("recent papers explore"), no study-design words unless they are the point.
- "kind": "benefit" if a treatment or intervention did better than its comparator or improved the outcome; "no-benefit" if it made no difference, did worse, or the trial failed; "safety" if the finding is a harm, adverse effect or risk of a treatment; "other" for everything else (risk factors, mechanisms, prediction, prevalence, service use).
- "group": "focus" or "related", the part its papers belong to. Never mix the two parts in one finding.
- "sources": the numbers of the papers the finding rests on. At least one. When two or more papers found the same thing, write ONE finding and list them all; do not repeat it per paper.
- "emphasis": one or two short phrases (one to three words each) copied exactly from your text: the treatment, and the result if it is short.

Rules:
- Use only the headlines and takeaways given. Add nothing from outside knowledge.
- Keep each paper's own level of certainty: an association is "was linked to", not "caused"; a pilot or single small study "suggested". Never write "evidence shows".
- Use a number only if it appears in the headline or takeaway of a paper you list as a source for that finding. Copy it exactly; never calculate or round. Prefer no number.
- Do not write paper numbers, brackets with numbers, or phrases like "paper 2" inside the text.
- Do not rank the papers, do not say which is best, and do not tell the reader what to do with a patient.
- If the input has "problems", your previous answer lost findings for those reasons: write it again without them.`

export const topicOverviewSkill = defineSkill<OverviewInput, z.infer<typeof OverviewSchema>>({
  name: "clinical-topic-overview",
  version: "5",
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
  if (kind === "too-long") return "A finding was too long. Keep each finding to one clause of at most 14 words; put a second result in a finding of its own."
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
      // An overview is a glance, not a second list.
      if (best && best.kept.length > 0) overviews[topic.entryId] = best.kept.slice(0, OVERVIEW_MAX_SENTENCES)
      else dropped.push({ entryId: topic.entryId, reason: best?.problems[0] ?? "call-failed" })
    } catch {
      dropped.push({ entryId: topic.entryId, reason: "call-failed" })
    }
  }))
  return { overviews, costUsd, dropped }
}
