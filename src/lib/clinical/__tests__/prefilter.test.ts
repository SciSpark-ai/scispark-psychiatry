import { describe, expect, it } from "vitest"
import { loadPsychiatryPack } from "../pack/load"
import { domainFilter } from "../filter/prefilter"
import { candidate } from "./helpers"

describe("domainFilter", () => {
  it("keeps a record with a psychiatric MeSH heading", async () => {
    const pack = await loadPsychiatryPack()
    const { kept } = domainFilter(pack, [candidate({ title: "Outcomes at one year", fields: ["Humans", "Bipolar Disorder"] })])
    expect(kept).toHaveLength(1)
  })
  it("keeps a not-yet-indexed record by text word, including truncation", async () => {
    const pack = await loadPsychiatryPack()
    const { kept } = domainFilter(pack, [candidate({ title: "Ketamine in adolescents", abstract: "Adolescents with depressive symptoms were randomised." })])
    expect(kept).toHaveLength(1)
  })
  it("drops and logs a non-psychiatric record", async () => {
    const pack = await loadPsychiatryPack()
    const { kept, drops } = domainFilter(pack, [candidate({ title: "Statin therapy and stroke", abstract: "Cardiovascular outcomes.", fields: ["Stroke"] }, "pmid:5")])
    expect(kept).toEqual([])
    expect(drops).toEqual([{ key: "pmid:5", title: "Statin therapy and stroke", step: "prefilter", reason: "not-psychiatric" }])
  })
  it("does not match a word fragment", async () => {
    const pack = await loadPsychiatryPack()
    const { kept } = domainFilter(pack, [candidate({ title: "Lithium-ion battery safety", abstract: "Electrochemical cells and thermal runaway." })])
    // "lithium" is a text word: the filter is deliberately recall-first, so this passes the pre-filter and is left to grading.
    expect(kept).toHaveLength(1)
    const { kept: none } = domainFilter(pack, [candidate({ title: "Environmental mentalities of builders", abstract: "Surveys of construction practice." })])
    expect(none).toHaveLength(0)
  })
})
