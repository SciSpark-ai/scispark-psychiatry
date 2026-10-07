// src/lib/clinical/__tests__/records-table.test.ts
import { describe, expect, it } from "vitest"
import { TaxonomySchema } from "../pack/schema"
import { fieldPaths, getField, withField, type TrialRecord } from "../records/schema"
import { buildTreatmentTable } from "../records/table"
import { evidenceBlock, parseEvidenceQuery } from "../records/query"
import { CLINICAL_COPY } from "../copy"
import { RECORD, num, unconfirmed } from "./records-fixture"

const TAXONOMY = TaxonomySchema.parse({ version: "t", nodes: [
  { id: "depression", type: "condition", name: "Major depressive disorder" },
  { id: "treatment-resistant-depression", type: "condition", name: "Treatment-resistant depression", parents: ["depression"] },
  { id: "schizophrenia", type: "condition", name: "Schizophrenia" },
  { id: "esketamine", type: "treatment", name: "Esketamine", modality: "drug" },
  { id: "quetiapine", type: "treatment", name: "Quetiapine", modality: "drug" },
] })
const second: TrialRecord = { ...RECORD, slug: "esketamine-versus-placebo", paperKey: "pmid:222", title: "Esketamine versus placebo", year: 2024,
  arms: [RECORD.arms[0], { ...RECORD.arms[1], treatment: { value: "placebo", quote: "placebo", state: "quote-verified" }, treatmentCode: null }],
  outcomes: [{ ...RECORD.outcomes[1], primary: true, results: [{ ...RECORD.outcomes[1].results[0], mean: { value: 16.9, quote: "16.9", state: "quote-verified" } }, RECORD.outcomes[1].results[1]] }] }
const allConfirmed = (record: TrialRecord) => fieldPaths(record).reduce((next, path) => { const field = getField(next, path)!; return field.value === null ? next : withField(next, path, { ...field, state: "human-confirmed" } as never) }, record)

describe("the treatment-options table", () => {
  it("has one row per treatment, counting trials by the direction of their primary outcome", () => {
    const [row, ...rest] = buildTreatmentTable([RECORD, second], TAXONOMY, "depression")
    expect(rest).toEqual([])
    expect(row).toMatchObject({ key: "esketamine", treatment: "Esketamine", modality: "drug", trials: 2, favours: 1, against: 0, unclear: 1, notComputable: 0, unconfirmed: 0, latestYear: 2026 })
    expect(row.comparators).toEqual(["Quetiapine", "placebo"])
    expect(row.outcomes).toEqual(["remission (MADRS)", "depression severity (MADRS)"])
    expect(row.papers.map((paper) => paper.slug)).toEqual([RECORD.slug, "esketamine-versus-placebo"])
  })
  it("takes in the subtypes of the condition and leaves other conditions out", () => {
    expect(buildTreatmentTable([RECORD], TAXONOMY, "treatment-resistant-depression")).toHaveLength(1)
    expect(buildTreatmentTable([RECORD], TAXONOMY, "schizophrenia")).toEqual([])
    expect(buildTreatmentTable([{ ...RECORD, conditionCode: null }], TAXONOMY, "depression")).toEqual([])
  })
  it("counts a trial whose primary outcome gives no effect as not computable, never as a result", () => {
    const noSd = withField(RECORD, "outcomes.o1.results.a2.events", { value: null, quote: null, state: "unverified" })
    expect(buildTreatmentTable([noSd], TAXONOMY, "depression")[0]).toMatchObject({ favours: 0, against: 0, unclear: 0, notComputable: 1 })
    expect(buildTreatmentTable([{ ...RECORD, outcomes: [] }], TAXONOMY, "depression")[0]).toMatchObject({ trials: 1, notComputable: 1, outcomes: [] })
  })
  it("gives a treatment the pack does not know a row of its own, under the name the paper uses", () => {
    const unknown = { ...RECORD, arms: [{ ...RECORD.arms[0], treatmentCode: null }, RECORD.arms[1]] }
    expect(buildTreatmentTable([unknown], TAXONOMY, "depression")[0]).toMatchObject({ key: "esketamine nasal spray", treatment: "esketamine nasal spray", modality: null })
  })
  it("says how many of a row's trials still have values to check", () => {
    expect(buildTreatmentTable([RECORD, allConfirmed(second)], TAXONOMY, "depression")[0].toCheck).toBe(1)
    expect(buildTreatmentTable([allConfirmed(RECORD)], TAXONOMY, "depression")[0].toCheck).toBe(0)
  })
  it("does not count a value in a field the panel does not show as one to check", () => {
    // A mean the model gave for a binary outcome: the panel shows events only, so nobody can confirm it.
    const hidden = withField(allConfirmed(RECORD), "outcomes.o1.results.a1.mean", num(3.1))
    expect(buildTreatmentTable([hidden], TAXONOMY, "depression")[0].toCheck).toBe(0)
  })
  it("claims no direction for a trial whose direction of benefit or roles nobody has confirmed, and counts it as such", () => {
    const [row] = buildTreatmentTable([unconfirmed(RECORD), second], TAXONOMY, "depression")
    expect(row).toMatchObject({ trials: 2, favours: 0, against: 0, unclear: 1, notComputable: 0, unconfirmed: 1 })
    // The trial is still one with something to check.
    expect(buildTreatmentTable([unconfirmed(allConfirmed(RECORD))], TAXONOMY, "depression")[0]).toMatchObject({ unconfirmed: 1, toCheck: 1 })
    const roleOnly = { ...RECORD, arms: [RECORD.arms[0], { ...RECORD.arms[1], roleState: "unverified" as const }] }
    expect(buildTreatmentTable([roleOnly], TAXONOMY, "depression")[0]).toMatchObject({ favours: 0, unconfirmed: 1 })
  })
  it("says so in the direction cell", () => {
    const T = CLINICAL_COPY.records.table
    expect(T.direction({ favours: 0, against: 0, unclear: 0, notComputable: 0, unconfirmed: 1, trials: 1 })).toBe("Direction not yet confirmed in 1")
    expect(T.direction({ favours: 2, against: 0, unclear: 1, notComputable: 0, unconfirmed: 2, trials: 5 })).toBe("Favours the treatment in 2 of 5 trials; no clear difference in 1; direction not yet confirmed in 2")
    expect(T.direction({ favours: 0, against: 1, unclear: 0, notComputable: 1, unconfirmed: 0, trials: 2 })).toBe("Favours the comparator in 1; not computable in 1")
  })
  it("counts a trial with two different treatments once in the row of each, and once for two arms of the same treatment", () => {
    const ketamine = { ...RECORD.arms[0], id: "a3", treatment: { value: "ketamine", quote: "ketamine", state: "quote-verified" as const }, treatmentCode: null }
    const withResults = (armId: string, events: number) => ({ ...RECORD.outcomes[0].results[0], armId, events: num(events) })
    const twoTreatments: TrialRecord = { ...RECORD, arms: [...RECORD.arms, ketamine], outcomes: [{ ...RECORD.outcomes[0], results: [...RECORD.outcomes[0].results, withResults("a3", 30)] }] }
    const rows = buildTreatmentTable([twoTreatments], TAXONOMY, "depression")
    expect(rows.map((row) => [row.key, row.trials, row.papers.length])).toEqual([["esketamine", 1, 1], ["ketamine", 1, 1]])
    // Each row is compared with the shared control group on its own arm's numbers.
    expect(rows[0]).toMatchObject({ favours: 1, against: 0 })
    expect(rows[1]).toMatchObject({ favours: 0, against: 1 })
    const twoDoses: TrialRecord = { ...twoTreatments, arms: [...RECORD.arms, { ...RECORD.arms[0], id: "a3" }] }
    expect(buildTreatmentTable([twoDoses], TAXONOMY, "depression").map((row) => [row.key, row.trials])).toEqual([["esketamine", 1]])
  })
})

describe("the block a page holds", () => {
  it("is read back as the query it was written from", () => {
    expect(evidenceBlock("depression")).toBe("```evidence-table\ncondition: depression\n```")
    expect(parseEvidenceQuery("condition: depression")).toEqual({ condition: "depression" })
    expect(parseEvidenceQuery("  condition:   treatment-resistant-depression  \n")).toEqual({ condition: "treatment-resistant-depression" })
  })
  it("reads anything else as no query", () => {
    expect(parseEvidenceQuery("")).toBeNull()
    expect(parseEvidenceQuery("condition: ../etc")).toBeNull()
    expect(parseEvidenceQuery("treatment: esketamine")).toBeNull()
  })
})
