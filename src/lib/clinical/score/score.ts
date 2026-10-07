import type { Journal } from "../pack/schema"
import { DESIGN_TIER } from "../filter/gate"
import { MODES } from "../modes"
import type { FeedMode, GatedCandidate, StageAGrade } from "../types"

export interface ScoreBreakdown {
  relevance: number
  evidence: number
  recency: number
  journalPrior: number
  journalBoost?: number
  /** Weights actually applied, normalised over the signals available in this slice (no practice impact yet). */
  weights: { relevance: number; evidence: number; recency: number }
}

export interface ScoredItem {
  /** The journal's band (1 leading, 2 established, 3 other); absent when the journal is not known. */
  journalBand?: 1 | 2 | 3
  candidate: GatedCandidate
  grade: StageAGrade
  score: number
  breakdown: ScoreBreakdown
}

/** 0–100, halving every `halfLifeDays`. A record with no usable date gets a neutral 50. */
export function recencyScore(date: string | undefined, now: Date, halfLifeDays: number): number {
  const published = date ? Date.parse(date) : Number.NaN
  if (Number.isNaN(published)) return 50
  const ageDays = Math.max(0, (now.getTime() - published) / 86_400_000)
  return 100 * Math.pow(0.5, ageDays / halfLifeDays)
}

/**
 * Journal names as PubMed prints them differ from the pack's ("Lancet (London, England)", "CMAJ :
 * Canadian Medical Association journal = journal de l'Association..."). Drop parentheticals and
 * anything after " : " or " = ", the leading "The", case and punctuation before comparing.
 */
export function normaliseJournalName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s[:=]\s/)[0]
    .toLowerCase()
    .replace(/^the\s+/, "")
    // "&" and "and" are the same word in a journal's name.
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** +5 for a pinned journal, −5 for a demoted one, matched by normalised name. */
export function journalPrior(journals: Journal[], venue: string | undefined): number {
  if (!venue) return 0
  const wanted = normaliseJournalName(venue)
  const match = journals.find((journal) => normaliseJournalName(journal.name) === wanted)
  if (!match) return 0
  return match.state === "pinned" ? 5 : match.state === "demoted" ? -5 : 0
}

/** Mean of the entry and topic grades when an entry matched; otherwise the topic grade, capped at 2. */
export function relevanceScore(grade: StageAGrade): number {
  const outOfFour = grade.entryId === null ? Math.min(grade.topicGrade, 2) : (grade.grade + grade.topicGrade) / 2
  return outOfFour * 25
}

export function scoreCandidate(input: {
  candidate: GatedCandidate
  grade: StageAGrade
  mode: FeedMode
  now: Date
  journals: Journal[]
  /** Points for the journal's tier, from the user's own tiers file (score/journal-tiers.ts). */
  journalBoost?: number
}): ScoredItem {
  const params = MODES[input.mode]
  const { relevance: wr, evidence: we, recency: wc } = params.weights
  const total = wr + we + wc
  const weights = { relevance: wr / total, evidence: we / total, recency: wc / total }
  const prior = journalPrior(input.journals, input.candidate.paper.venue)
  const relevance = relevanceScore(input.grade)
  const evidence = Math.max(0, Math.min(100, DESIGN_TIER[input.candidate.design] + prior))
  const recency = recencyScore(input.candidate.paper.date, input.now, params.halfLifeDays)
  const journalBoost = input.journalBoost ?? 0
  const score = Math.min(100, weights.relevance * relevance + weights.evidence * evidence + weights.recency * recency + journalBoost)
  return { candidate: input.candidate, grade: input.grade, score, breakdown: { relevance, evidence, recency, journalPrior: prior, weights, ...(journalBoost ? { journalBoost } : {}) } }
}
