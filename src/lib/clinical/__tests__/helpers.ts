import type { PaperRecord } from "../../papers/types"
import type { Candidate, GatedCandidate, WatchEntry } from "../types"

export function paper(overrides: Partial<PaperRecord> & { title: string }): PaperRecord {
  return { ids: {}, authors: [], fields: [], source: "pubmed", ...overrides }
}

export function candidate(overrides: Partial<PaperRecord> & { title: string }, key?: string): Candidate {
  const p = paper(overrides)
  return { paper: p, key: key ?? `pmid:${p.ids.pmid ?? p.title}`, provenance: [{ query: "q", tier: "entry" }], flags: [] }
}

export function gated(overrides: Partial<PaperRecord> & { title: string }, design: GatedCandidate["design"] = "randomized-trial", key?: string): GatedCandidate {
  return { ...candidate(overrides, key), design, designSource: "publication-type" }
}

export const watch = (overrides: Partial<WatchEntry> = {}): WatchEntry => ({ id: "w1", priority: "normal", safetySignal: false, ...overrides })

import type { ScoredItem } from "../score/score"
import type { StageAGrade } from "../types"

export function grade(key: string, entryId: string | null, g: number, topicGrade = 3): StageAGrade {
  return { key, entryId, grade: g, topicGrade, quote: "q", quoteVerified: true, ungraded: false }
}

export function scored(key: string, title: string, entryId: string | null, g: number, score: number): ScoredItem {
  return {
    candidate: gated({ title, ids: { pmid: key } }, "randomized-trial", key),
    grade: grade(key, entryId, g),
    score,
    breakdown: { relevance: 0, evidence: 0, recency: 0, journalPrior: 0, weights: { relevance: 1, evidence: 0, recency: 0 } },
  }
}

import { MockProvider } from "../../llm/mock-provider"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import type { LLMResult } from "../../llm/types"

export const SETTINGS: LLMSettings = { ...DEFAULT_SETTINGS, keys: { anthropic: "sk-test" } }

export function llmResult(json: unknown, model: string): LLMResult {
  return { text: JSON.stringify(json), json, usage: { inputTokens: 500, outputTokens: 200 }, model, provider: "anthropic", stopReason: "end_turn" }
}

export const strongOk = (queries: Array<{ entryId: string; query: string; rationale: string }> = []) => new MockProvider([llmResult({ queries }, "claude-opus-4-8")])
export const fastOk = (assessments: unknown[]) => new MockProvider([llmResult({ assessments }, "claude-haiku-4-5")])
