import { z } from "zod"
import { defineSkill } from "../../skills/types"
import { runSkill } from "../../skills/runner"
import type { LLMProvider, Tier } from "../../llm/types"
import type { LLMSettings } from "../../llm/settings"
import type { VaultStorage } from "../../vault/storage"
import type { SpecialtyPack } from "../pack/schema"
import type { WatchEntry } from "../types"
import { DESIGN_HINT, deterministicPlan, isPlausiblePubmedQuery, windowClause, type DateWindow, type PlannedQuery } from "./queries"

const MAX_EXTRA_PER_ENTRY = 3
const MAX_EXTRA_TOTAL = 24

const ExtraQueriesSchema = z.object({
  queries: z.array(z.object({ entryId: z.string(), query: z.string(), rationale: z.string() })),
})

const SYSTEM_PROMPT = `You help a clinician find new psychiatry literature on PubMed. For each watch entry, write up to ${MAX_EXTRA_PER_ENTRY} EXTRA PubMed queries that would find relevant papers the standard query could miss.

The standard query already ANDs the entry's condition and treatment, using MeSH headings and the taxonomy's synonyms and brand names. Your extra queries should vary the phrasing: other names for the condition or treatment, a broader MeSH heading, outcome terms (response, remission, relapse), or a different framing of the same question. Favour recall over precision.

Rules:
- Use PubMed syntax with field tags, for example ("Depressive Disorder, Major"[MeSH Terms] OR depress*[Title/Abstract]) AND esketamine[Title/Abstract].
- Do NOT add date, journal or study-design filters. They are added for you.
- Balance every parenthesis and quotation mark.
- "entryId" must be the id of a watch entry you were given.`

export const planSkill = defineSkill<{ entries: WatchEntry[] }, z.infer<typeof ExtraQueriesSchema>>({
  name: "clinical-plan-queries",
  version: "1",
  run: (ctx, input) =>
    ctx.llmStructured(
      "strong",
      {
        maxTokens: 4096,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ watchEntries: input.entries.map(({ id, condition, treatment, population, outcome }) => ({ id, condition, treatment, population, outcome })) }) },
        ],
      },
      ExtraQueriesSchema,
    ),
})

export interface PlanRunOpts {
  storage: VaultStorage
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
}

/**
 * Step 1: the deterministic plan always runs; the model only adds extra entry queries. If the model
 * fails, the run continues with the deterministic plan and a warning.
 */
export async function planQueries(
  pack: SpecialtyPack, entries: WatchEntry[], window: DateWindow, opts: PlanRunOpts,
): Promise<{ plan: PlannedQuery[]; costUsd: number | null; warnings: string[] }> {
  const base = deterministicPlan(pack, entries, window)
  const active = entries.filter((entry) => entry.priority !== "paused")
  const run = await runSkill({ skill: planSkill, input: { entries: active }, ...opts })
  if (run.status !== "ok" || !run.output) {
    return { plan: base, costUsd: run.costUsd, warnings: ["AI query planning did not complete; used the standard queries only."] }
  }
  const known = new Set(active.map((entry) => entry.id))
  const perEntry = new Map<string, number>()
  const seen = new Set(base.map((planned) => planned.query))
  const extra: PlannedQuery[] = []
  for (const proposal of run.output.queries) {
    if (extra.length >= MAX_EXTRA_TOTAL) break
    if (!known.has(proposal.entryId) || !isPlausiblePubmedQuery(proposal.query)) continue
    if ((perEntry.get(proposal.entryId) ?? 0) >= MAX_EXTRA_PER_ENTRY) continue
    const query = `(${proposal.query.trim()}) AND ${windowClause(window)} AND ${DESIGN_HINT}`
    if (seen.has(query)) continue
    seen.add(query)
    perEntry.set(proposal.entryId, (perEntry.get(proposal.entryId) ?? 0) + 1)
    extra.push({ query, entryId: proposal.entryId, tier: "entry", rationale: proposal.rationale })
  }
  // Entry queries first, so a cap on the plan would never cut an entry's own queries before journal enumeration.
  const entryQueries = base.filter((planned) => planned.tier === "entry")
  const journalQueries = base.filter((planned) => planned.tier !== "entry")
  return { plan: [...entryQueries, ...extra, ...journalQueries], costUsd: run.costUsd, warnings: [] }
}
