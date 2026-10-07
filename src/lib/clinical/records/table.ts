// src/lib/clinical/records/table.ts
import type { Taxonomy } from "../pack/schema"
import { withDescendants } from "../pack/taxonomy"
import { outcomeEffect } from "./effects"
import { pathsToCheck, type TrialRecord } from "./schema"

/**
 * The treatment-options table of a condition page (spec 7.6): one row per treatment, counted from the
 * stored records. Trials are counted by the direction of their primary outcome; nothing is pooled and
 * sample sizes are not summed, because the rows of one trial can share a control group. A trial whose
 * direction of benefit or roles no person has confirmed is counted under `unconfirmed`, never under a direction.
 */

export interface TreatmentRow {
  key: string; treatment: string; modality: string | null; trials: number
  comparators: string[]; outcomes: string[]
  favours: number; against: number; unclear: number; notComputable: number; unconfirmed: number
  latestYear: number | null; toCheck: number; papers: Array<{ slug: string; title: string }>
}

const unchecked = (record: TrialRecord) => pathsToCheck(record).length > 0

export function buildTreatmentTable(records: TrialRecord[], taxonomy: Taxonomy, conditionCode: string): TreatmentRow[] {
  const conditions = new Set(withDescendants(taxonomy, conditionCode).map((node) => node.id))
  const nodeOf = new Map(taxonomy.nodes.map((node) => [node.id, node]))
  const nameOf = (arm: TrialRecord["arms"][number]) => (arm.treatmentCode ? nodeOf.get(arm.treatmentCode)?.name : undefined) ?? arm.treatment.value ?? ""
  const rows = new Map<string, TreatmentRow>()
  const add = (list: string[], value: string) => { if (value && !list.includes(value)) list.push(value) }
  for (const record of records) {
    if (!record.conditionCode || !conditions.has(record.conditionCode)) continue
    const primary = record.outcomes.find((outcome) => outcome.primary) ?? record.outcomes[0]
    const counted = new Set<string>()
    for (const arm of record.arms.filter((entry) => entry.role === "treatment")) {
      const key = arm.treatmentCode ?? (arm.treatment.value ?? "").toLowerCase()
      if (!key || counted.has(key)) continue
      counted.add(key)
      const row = rows.get(key) ?? { key, treatment: nameOf(arm), modality: (arm.treatmentCode ? nodeOf.get(arm.treatmentCode)?.modality : undefined) ?? null, trials: 0, comparators: [], outcomes: [], favours: 0, against: 0, unclear: 0, notComputable: 0, unconfirmed: 0, latestYear: null, toCheck: 0, papers: [] }
      row.trials += 1
      for (const control of record.arms.filter((entry) => entry.role === "control")) add(row.comparators, nameOf(control))
      if (primary?.name.value) add(row.outcomes, primary.instrument.value ? `${primary.name.value} (${primary.instrument.value})` : primary.name.value)
      const direction = primary ? outcomeEffect(primary, record.arms, arm.id).direction : "not-computable"
      if (direction === "favours-treatment") row.favours += 1
      else if (direction === "favours-control") row.against += 1
      else if (direction === "no-clear-difference") row.unclear += 1
      else if (direction === "unconfirmed") row.unconfirmed += 1
      else row.notComputable += 1
      if (record.year !== null) row.latestYear = Math.max(row.latestYear ?? record.year, record.year)
      if (unchecked(record)) row.toCheck += 1
      row.papers.push({ slug: record.slug, title: record.title })
      rows.set(key, row)
    }
  }
  return [...rows.values()].sort((a, b) => b.trials - a.trials || a.treatment.localeCompare(b.treatment))
}
