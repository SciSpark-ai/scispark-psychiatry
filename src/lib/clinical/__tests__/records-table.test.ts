// src/lib/clinical/__tests__/records-table.test.ts
import { describe, expect, it } from "vitest"
import { TaxonomySchema } from "../pack/schema"
import { fieldPaths, getField, withField, type TrialRecord } from "../records/schema"
import { buildTreatmentTable } from "../records/table"
import { evidenceBlock, parseEvidenceQuery } from "../records/query"
import { RECORD } from "./records-fixture"

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
    expect(row).toMatchObject({ key: "esketamine", treatment: "Esketamine", modality: "drug", trials: 2, favours: 1, against: 0, unclear: 1, notComputable: 0, latestYear: 2026 })
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
