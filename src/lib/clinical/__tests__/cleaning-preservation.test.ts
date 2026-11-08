import { describe, expect, it } from "vitest"
import { cleanAbstract } from "../text/clean"

describe("source text preservation regressions", () => {
  it.each([
    ["Results:<p>20</p><p>30</p>", "20 30"],
    ["Results:&lt;p&gt;20&lt;/p&gt;&lt;p&gt;30&lt;/p&gt;", "20 30"],
    ["Abstract reasoning was assessed in 30 participants.", "Abstract reasoning"],
    ["Abstractness was measured.", "Abstractness"],
    ["The result &ne; control.", "≠"],
    ["p<0.001 and p>0.05", "p<0.001 and p>0.05"],
    ["Results showed no benefit.", "Results showed no benefit."],
    ["H<sub>2</sub>O was measured.", "H2O"],
  ])("preserves content in %s", (source, expected) => {
    expect(cleanAbstract(source)?.replace(/\s+/g, " ")).toContain(expected)
  })
})
