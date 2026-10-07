import type { TrialRecord } from "../records/schema"

// The direction of benefit, the roles and "primary" are confirmed here, so that tests of the effect
// sizes mean what they say. The gate for unconfirmed ones has cases of its own (see `unconfirmed`).

export const num = (value: number | null, quote: string | null = value === null ? null : `n = ${value}`) => ({ value, quote, state: "quote-verified" as const })
export const text = (value: string) => ({ value, quote: value, state: "quote-verified" as const })
export const RECORD: TrialRecord = {
  version: 1, paperKey: "pmid:111", slug: "esketamine-versus-quetiapine", title: "Esketamine versus quetiapine", year: 2026,
  design: "randomized-trial", conditionCode: "treatment-resistant-depression", condition: text("treatment-resistant depression"),
  arms: [
    { id: "a1", role: "treatment", roleState: "human-confirmed", treatment: text("esketamine nasal spray"), treatmentCode: "esketamine", n: num(336) },
    { id: "a2", role: "control", roleState: "human-confirmed", treatment: text("quetiapine"), treatmentCode: "quetiapine", n: num(340) },
  ],
  outcomes: [
    { id: "o1", name: text("remission"), instrument: text("MADRS"), timepoint: text("week 8"), kind: "binary", lowerIsBetter: false, lowerIsBetterState: "human-confirmed", primary: true, primaryState: "human-confirmed",
      results: [{ armId: "a1", n: num(336), mean: num(null), sd: num(null), events: num(91) }, { armId: "a2", n: num(340), mean: num(null), sd: num(null), events: num(60) }] },
    { id: "o2", name: text("depression severity"), instrument: text("MADRS"), timepoint: text("week 8"), kind: "continuous", lowerIsBetter: true, lowerIsBetterState: "human-confirmed", primary: false, primaryState: "human-confirmed",
      results: [{ armId: "a1", n: num(336), mean: num(14.2), sd: num(9.1), events: num(null) }, { armId: "a2", n: num(340), mean: num(17.0), sd: num(9.4), events: num(null) }] },
  ],
  source: { access: "full-text", locator: "PMC", checkedAt: "2026-10-07T10:00:00.000Z", truncated: false, notes: [] },
  extractedAt: "2026-10-07T10:00:00.000Z", model: "test", droppedFields: 0,
}

/** The record as an extraction leaves it: nobody has confirmed the direction of benefit, a role or "primary". */
export const unconfirmed = (record: TrialRecord): TrialRecord => ({
  ...record,
  arms: record.arms.map((arm) => ({ ...arm, roleState: "unverified" as const })),
  outcomes: record.outcomes.map((outcome) => ({ ...outcome, lowerIsBetterState: "unverified" as const, primaryState: "unverified" as const })),
})
