import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import { addCosts } from "../../llm/pricing"
import type { CardDigest, DigestRunOpts } from "./card"
import { numbers } from "./card"
import { negationWords, tidyOverviewSentence } from "../text/overview-text"

export { tidyOverviewSentence }

/**
 * A short AI overview of the papers listed under one topic (owner request 2026-10-07). A statement
 * about several papers is easier to get wrong than a summary of one, so:
 *
 * - The model sees the headline and takeaway already checked for each paper and, since 2026-10-07, its
 *   abstract, which it needs to tell whether the illness improved in the end.
 * - Every sentence must name the papers it rests on, by number; a sentence without a valid source is dropped.
 * - A sentence may use only numbers that appear in the headline or takeaway of the papers it names.
 * - A sentence must be short.
 *
 * Since 2026-10-07 the model no longer writes the overview as text. It sorts each paper: a kind
 * (benefit, no benefit, mixed, safety, other), the treatment, and a short outcome. The page joins the
 * answers: one line per kind, papers on the same treatment together, every paper with its number.
 * Asked to join papers itself, the model either wrote one sentence per paper or joined unrelated ones
 * (docs/psychiatry/first-run-2026-10-06.md). "No benefit" and "mixed" are kept only for an outcome
 * that says in words that something did not work.
 *
 * What survives is stored with the list as sentences and the keys of their papers.
 */

export const OVERVIEW_MIN_PAPERS = 2
// One short answer per paper, so a long list is still one modest call.
const OVERVIEW_MAX_PAPERS = 40
/** One sentence about one thing. The model is asked for fewer words than this. */
// Tried and taken out on 2026-10-07: a limit on the number of sentences below the number of papers, to
// force papers to share a sentence. With gpt-4o it left papers out (8 of 15 cited) and joined unrelated
// findings into one sentence under the wrong kind. See docs/psychiatry/first-run-2026-10-06.md.
const SENTENCE_MAX_WORDS = 28
const OVERVIEW_MAX_SENTENCES = OVERVIEW_MAX_PAPERS

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
  /** The treatment or exposure the finding is about, as the paper names it. The page joins findings on the same one. */
  treatment?: string
  /** Words of the sentence to mark, so the eye finds the point. Each is in `text` as written. */
  emphasis?: string[]
}
export interface OverviewPaper {
  key: string; headline: string; takeaway: string; part: "focus" | "related"
  /** The abstract, which the model reads to sort the paper. Absent in older callers. */
  abstract?: string
}

/** How much of an abstract the model is given to sort a paper by (characters). */
const ABSTRACT_MAX_CHARS = 2000

const OverviewSchema = z.object({
  sentences: z.array(z.object({
    text: z.string(), sources: z.array(z.number().int()),
    group: z.enum(["focus", "related"]).nullable().default(null), kind: z.enum(OVERVIEW_KINDS).nullable().default(null), treatment: z.string().nullable().default(null), emphasis: z.array(z.string()).default([]),
  })),
})

interface OverviewInput {
  topic: string
  papers: Array<{ n: number; part: "focus" | "related"; headline: string; takeaway: string; abstract?: string }>
  /** Why sentences of the previous answer were rejected, when this is the second try. */
  problems?: string[]
}

const SYSTEM_PROMPT = `You sort the new papers on one topic for a psychiatrist, one answer per paper. Code will then join your answers into an overview, so do not join papers yourself. You are given the topic and, for each paper, a number, a headline, a one-sentence takeaway, its abstract when there is one, and "part" (ignore it). Read the abstract, above all its results and conclusion, before you choose the kind.

Return "sentences": exactly one entry for every paper. Each entry:
- "sources": a list with the one number of the paper.
- "treatment": the treatment, intervention or exposure the paper is about, as its shortest usual name copied from the paper ("ketamine", not "repeated ketamine infusions"; "rTMS"; "exercise"; "nature exposure", never half a name). When the paper compares two treatments or doses, name both ("methylphenidate and risperidone", "low-dose antipsychotics"). null when the paper is not about a treatment or exposure (genetics, prediction models, prevalence, scales).
- "text": what the paper found, at most 14 words, lower case, no full stop.
  - With a treatment: start with a verb and do NOT repeat the treatment name, so that "<treatment> <text>" reads as a sentence: "reduced suicidal thoughts in treatment-resistant depression", "did not reduce symptoms compared with placebo".
  - Without a treatment: a complete short statement: "older age was linked to slower improvement".
- "kind": decide by what happened to the illness or the clinical outcome in the end, as the abstract reports it:
  - "benefit": the treatment improved the illness or a clinical outcome, or did better than its comparator. This includes a comparison of two active treatments or two doses in which patients improved: say so ("improved symptoms as much as standard doses", "both reduced ADHD symptoms"). An improvement in one outcome, with nothing said to have failed, is a benefit.
  - "no-benefit": ONLY when the paper says in so many words that the illness or outcome did not improve: no effect, did not improve, not better than placebo or control, the trial failed. In a comparison of two active treatments, only if neither improved the outcome. Your text must contain "not" or "no".
  - "mixed": ONLY when the same treatment improved one clinical outcome AND the paper says it did not improve another. Your text must name both and contain "not" or "no".
  - "safety": the main finding is a harm, adverse effect or risk of a treatment (for example a drug lengthening the QTc interval, weight gain, misuse potential). Name the drug as the treatment.
  - "other": everything that is not about whether a treatment works or harms: associations, risk factors and mechanisms ("was linked to"), biomarkers, prediction, prevalence, measurement, and reviews that only say the evidence is uncertain.
  "benefit", "no-benefit" and "mixed" are about the illness and the patient: symptoms, remission, relapse, functioning, survival, adherence. A result on a brain measure, a biomarker, a blood level or a mechanism ("did not alter brain function for reward processing", "lowered C4A levels") is "other", whatever its direction.
  When the abstract does not let you tell whether the outcome improved, choose "other", never "no-benefit".
- "group": null. "emphasis": an empty list.

Rules:
- Use only that paper's headline, takeaway and abstract. Add nothing from outside knowledge.
- Keep the paper's own level of certainty: an association is "was linked to", not "caused"; "may" stays "may".
- Use a number only if it is printed for that paper. Copy it exactly; never calculate or round. Prefer no number.
- Do not write paper numbers inside the text, do not rank the papers, and do not tell the reader what to do with a patient.
- If the input has "problems", your previous answer had them: write it again without them.`

export const topicOverviewSkill = defineSkill<OverviewInput, z.infer<typeof OverviewSchema>>({
  name: "clinical-topic-overview",
  version: "10",
  run: (ctx, input) =>
    ctx.llmStructured(
      // The stronger model: weighing several papers against each other is where the small one writes filler.
      "strong",
      { maxTokens: 6144, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(input) }] },
      OverviewSchema,
    ),
})

/** The topics worth an overview: those with at least two listed papers that have a checked summary. */
export function overviewTopics(
  items: Array<{ key: string; entryId: string | null; digest?: CardDigest; matched?: "full" | "condition" | "treatment"; abstract?: string }>,
): Array<{ entryId: string; papers: OverviewPaper[] }> {
  const byTopic = new Map<string, OverviewPaper[]>()
  for (const item of items) {
    if (!item.entryId || !item.digest) continue
    const papers = byTopic.get(item.entryId) ?? []
    // A paper that matches only part of the topic is summarised apart from those that match all of it.
    const part = item.matched === "condition" || item.matched === "treatment" ? "related" : "focus"
    papers.push({ key: item.key, headline: item.digest.headline, takeaway: item.digest.takeaway, part, ...(item.abstract ? { abstract: item.abstract } : {}) })
    byTopic.set(item.entryId, papers)
  }
  return [...byTopic]
    .map(([entryId, papers]) => ({ entryId, papers: [...papers.filter((paper) => paper.part === "focus"), ...papers.filter((paper) => paper.part === "related")].slice(0, OVERVIEW_MAX_PAPERS) }))
    .filter((topic) => topic.papers.length >= OVERVIEW_MIN_PAPERS)
}

/** Checks each sentence. `kept` have the keys of their papers as sources; `problems` say why the others were rejected. */
export function judgeOverview(
  sentences: Array<{ text: string; sources: number[]; group?: "focus" | "related" | null; kind?: OverviewKind | null; treatment?: string | null; emphasis?: string[] }>, papers: Array<Omit<OverviewPaper, "part"> & { part?: OverviewPaper["part"] }>,
): { kept: OverviewSentence[]; problems: string[] } {
  const kept: OverviewSentence[] = []
  const problems: string[] = []
  for (const sentence of sentences) {
    const text = tidyOverviewSentence(sentence.text)
    const cited = [...new Set(sentence.sources)].flatMap((n) => papers[n - 1] ?? [])
    if (!text) { problems.push("empty"); continue }
    if (cited.length === 0) { problems.push("no-source"); continue }
    if (text.split(/\s+/).length > SENTENCE_MAX_WORDS) { problems.push("too-long"); continue }
    const printed = new Set(cited.flatMap((paper) => numbers(`${paper.headline} ${paper.takeaway} ${paper.abstract ?? ""}`)))
    const invented = numbers(text).find((value) => !printed.has(value))
    if (invented) { problems.push(`number-not-in-sources:${invented}`); continue }
    // Only words that are in the sentence as written can be marked in it.
    const emphasis = (sentence.emphasis ?? []).map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 1 && phrase.split(/\s+/).length <= 4 && text.includes(phrase)).slice(0, 2)
    // The part of the topic is a fact about the papers, so it is taken from them when they say.
    const group = cited[0].part ?? sentence.group ?? undefined
    // "No benefit" and "mixed" are strong words: only for a finding that says in words that something did not work.
    let kind = sentence.kind ?? undefined
    if ((kind === "no-benefit" || kind === "mixed") && !negationWords().test(text)) { problems.push(`kind-not-stated:${kind}`); kind = "other" }
    // The treatment must be named in the summaries of the papers the finding rests on.
    const sourceWords = new Set(cited.flatMap((paper) => `${paper.headline} ${paper.takeaway} ${paper.abstract ?? ""}`.toLowerCase().match(/[a-z0-9]+/g) ?? []))
    let treatment = sentence.treatment?.replace(/\s+/g, " ").trim() || undefined
    if (treatment && !(treatment.toLowerCase().match(/[a-z0-9]+/g) ?? []).every((word) => sourceWords.has(word))) { problems.push(`treatment-not-in-source:${treatment}`); treatment = undefined }
    kept.push({ text, sources: cited.map((paper) => paper.key), ...(group ? { group } : {}), ...(kind ? { kind } : {}), ...(treatment ? { treatment } : {}), ...(emphasis.length > 0 ? { emphasis } : {}) })
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
  if (kind === "kind-not-stated") return `An entry was filed under "${detail}" but its text does not say in words that something did not work. Use "${detail}" only when the paper says so, with "not" or "no" in the text; otherwise use "benefit" or "other".`
  if (kind === "treatment-not-in-source") return `The treatment "${detail}" is not named in the headline or takeaway of its paper. Copy the name from there.`
  if (kind === "too-long") return "A sentence was too long. Keep each sentence to at most 24 words; put a second result in a sentence of its own."
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
    const papers = topic.papers.map((paper, index) => ({ n: index + 1, part: paper.part, headline: paper.headline, takeaway: paper.takeaway, ...(paper.abstract ? { abstract: paper.abstract.slice(0, ABSTRACT_MAX_CHARS) } : {}) }))
    const ask = async (problems?: string[]) => {
      const run = await runSkill({ skill: topicOverviewSkill, input: { topic: topic.label, papers, ...(problems ? { problems } : {}) }, ...opts })
      costUsd = addCosts(costUsd, run.costUsd)
      return run.status === "ok" && run.output ? judgeOverview(run.output.sentences, topic.papers) : null
    }
    try {
      // The overview is about the whole list: a paper no sentence rests on is a reason to ask again.
      const leftOut = (answer: { kept: OverviewSentence[] }) => topic.papers.flatMap((paper, index) => (answer.kept.some((sentence) => sentence.sources.includes(paper.key)) ? [] : index + 1))
      let best = await ask()
      if (best && (best.problems.length > 0 || leftOut(best).length > 0)) {
        const missing = leftOut(best)
        const problems = [...new Set(best.problems.map(problemText)), ...(missing.length > 0 ? [`No sentence listed ${missing.length === 1 ? "paper" : "papers"} ${missing.join(", ")} as a source. Every paper must be a source of at least one sentence; join papers that found related things.`] : [])]
        const again = await ask(problems).catch(() => null)
        if (again && (leftOut(again).length < missing.length || (leftOut(again).length === missing.length && again.kept.length >= best.kept.length))) best = again
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
