import { describe, expect, it } from "vitest"
import { previewMarkdown } from "../notes/preview"

const links = (papers: Record<string, string> = {}, missing: string[] = []) => ({ papers: new Map(Object.entries(papers)), missing: new Set(missing), notFound: "not found" })

describe("a note's text made ready for its preview", () => {
  it("turns a cited paper into a link to the paper's page, keeping the label of the text", () => {
    expect(previewMarkdown("On [[lee-2024|Lee 2024]] today.", links({ "lee-2024": "Lee A 2024" }))).toBe("On [Lee 2024](/paper/lee-2024) today.")
  })

  it("names a paper cited without a label by the label it is known by", () => {
    expect(previewMarkdown("See [[lee-2024]] and [[lee-2024| ]].", links({ "lee-2024": "Lee 2024" }))).toBe("See [Lee 2024](/paper/lee-2024) and [Lee 2024](/paper/lee-2024).")
  })

  it("shows a wiki link that resolves to nothing as its text with a mark, and not as a link", () => {
    expect(previewMarkdown("On [[ghost]] and [[gone|Gone 2020]].", links({ ghost: "ghost" }, ["ghost", "gone"]))).toBe("On ghost *(not found)* and Gone 2020 *(not found)*.")
  })

  it("leaves a wiki link nothing is known about yet as its text", () => {
    expect(previewMarkdown("Typed [[just-now|Just now]] and [[bare]].", links())).toBe("Typed Just now and bare.")
  })

  it("takes a slug with characters a pattern or an address would read as its own", () => {
    const slug = "a.b+c(1)*[x"
    expect(previewMarkdown(`[[${slug}|A (1)]] and [[other]]`, links({ [slug]: "A", other: "Other" }))).toBe("[A (1)](/paper/a.b%2Bc%281%29*%5Bx) and [Other](/paper/other)")
    expect(previewMarkdown("[[a.b]] [[axb]]", links({ "a.b": "Dot" }, ["axb"]))).toBe("[Dot](/paper/a.b) axb *(not found)*")
  })

  it("keeps a label from closing the link it is in", () => {
    expect(previewMarkdown("[[p]]", links({ p: "Lee [2024]\ntrial" }))).toBe("[Lee (2024) trial](/paper/p)")
  })

  it("does not touch a wiki link inside a code span or a fence, closed or not", () => {
    const body = "`[[lee-2024]]` then\n\n```\n[[lee-2024|Lee]]\n```\n\n[[lee-2024]]\n\n```\n[[lee-2024]]"
    expect(previewMarkdown(body, links({ "lee-2024": "Lee 2024" }))).toBe("`[[lee-2024]]` then\n\n```\n[[lee-2024|Lee]]\n```\n\n[Lee 2024](/paper/lee-2024)\n\n```\n[[lee-2024]]")
  })

  it("leaves ordinary links, formulas and everything else as typed", () => {
    const body = "[Esketamine](/wiki?condition=depression&treatment=esketamine) helps; $\\frac{a}{b}$ and $$E = mc^2$$.\n"
    expect(previewMarkdown(body, links())).toBe(body)
  })
})
