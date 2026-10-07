import type { TrialRecord } from "../records/schema"

export const num = (value: number | null, quote: string | null = value === null ? null : `n = ${value}`) => ({ value, quote, state: "quote-verified" as const })
export const text = (value: string) => ({ value, quote: value, state: "quote-verified" as const })
export const RECORD: TrialRecord = {
  version: 1, paperKey: "pmid:111", slug: "esketamine-versus-quetiapine", title: "Esketamine versus quetiapine", year: 2026,
  design: "randomized-trial", conditionCode: "treatment-resistant-depression", condition: text("treatment-resistant depression"),
  arms: [
    { id: "a1", role: "treatment", treatment: text("esketamine nasal spray"), treatmentCode: "esketamine", n: num(336) },
    { id: "a2", role: "control", treatment: text("quetiapine"), treatmentCode: "quetiapine", n: num(340) },
  ],
  outcomes: [
    { id: "o1", name: text("remission"), instrument: text("MADRS"), timepoint: text("week 8"), kind: "binary", lowerIsBetter: false, primary: true,
      results: [{ armId: "a1", n: num(336), mean: num(null), sd: num(null), events: num(91) }, { armId: "a2", n: num(340), mean: num(null), sd: num(null), events: num(60) }] },
    { id: "o2", name: text("depression severity"), instrument: text("MADRS"), timepoint: text("week 8"), kind: "continuous", lowerIsBetter: true, primary: false,
      results: [{ armId: "a1", n: num(336), mean: num(14.2), sd: num(9.1), events: num(null) }, { armId: "a2", n: num(340), mean: num(17.0), sd: num(9.4), events: num(null) }] },
  ],
  source: { access: "full-text", locator: "PMC", checkedAt: "2026-10-07T10:00:00.000Z", truncated: false, notes: [] },
  extractedAt: "2026-10-07T10:00:00.000Z", model: "test", droppedFields: 0,
}
