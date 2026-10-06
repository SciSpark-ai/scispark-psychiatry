import { describe, expect, it } from "vitest"
import { buildTierA } from "../pack/build-journals"
import { JournalSchema } from "../pack/schema"

const row = (id: string, name: string, issnL: string | null, issn: string[] | null) => ({ id: `https://openalex.org/${id}`, display_name: name, issn_l: issnL, issn })

describe("buildTierA", () => {
  const v1 = { "BIOLOGICAL PSYCHIATRY": "S1", "World Psychiatry": "S2", "No issn journal": "S3", "Missing from OpenAlex": "S4", "Duplicate of S1": "S5" }
  const rows = [
    row("S1", "Biological Psychiatry", "0006-3223", ["0006-3223", "1873-2402"]),
    row("S2", "World Psychiatry", null, ["1723-8617"]),
    row("S3", "No issn journal", null, null),
    row("S5", "Biological Psychiatry (dup)", "0006-3223", ["0006-3223"]),
  ]

  it("uses OpenAlex's name, the linking ISSN, and a different ISSN as the eISSN", () => {
    const { journals } = buildTierA(v1, rows)
    expect(journals.find((j) => j.openalexSourceId === "S1")).toEqual({
      name: "Biological Psychiatry", issn: "0006-3223", eissn: "1873-2402", openalexSourceId: "S1", tier: "A", state: "normal",
    })
    expect(journals.find((j) => j.openalexSourceId === "S2")).toMatchObject({ issn: "1723-8617" })
  })
  it("reports unusable sources instead of guessing, and drops a repeated ISSN", () => {
    const { journals, unresolved } = buildTierA(v1, rows)
    expect(unresolved).toEqual(["No issn journal", "Missing from OpenAlex"])
    expect(journals).toHaveLength(2)
  })
  it("produces entries the pack schema accepts, sorted by name", () => {
    const { journals } = buildTierA(v1, rows)
    for (const journal of journals) expect(JournalSchema.safeParse(journal).success).toBe(true)
    expect(journals.map((j) => j.name)).toEqual(["Biological Psychiatry", "World Psychiatry"])
  })
})
