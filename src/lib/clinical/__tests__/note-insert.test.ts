import { describe, expect, it } from "vitest"
import { copyText, endOfText, insertLink, withoutLinks } from "../notes/insert"
import { isUntitledStored } from "../notes/links"
import { noteChatHref, noteIdOf, paperHref } from "../notes/href"
import { saveNoteRemote } from "../notes/client"

describe("putting a link into a note's text", () => {
  it("puts it at the caret, with a space on a side where it would touch a word", () => {
    expect(insertLink("See  here", "[[p|Lee 2024]]", 4)).toEqual({ text: "See [[p|Lee 2024]] here", caret: 18 })
    expect(insertLink("Seehere", "[[p]]", 3)).toEqual({ text: "See [[p]] here", caret: 10 })
    expect(insertLink("", "[[p]]", 0)).toEqual({ text: "[[p]]", caret: 5 })
  })
  it("adds no space before punctuation or at the start of a line", () => {
    expect(insertLink("As shown.", "[[p]]", 8).text).toBe("As shown [[p]].")
    expect(insertLink("One\n\nTwo", "[[p]]", 5).text).toBe("One\n\n[[p]] Two")
  })
  it("replaces what is selected, whichever end the selection began at", () => {
    expect(insertLink("See THIS here", "[[p]]", 4, 8).text).toBe("See [[p]] here")
    expect(insertLink("See THIS here", "[[p]]", 8, 4).text).toBe("See [[p]] here")
  })
  it("keeps a caret that is outside the text inside it", () => {
    expect(insertLink("abc", "[[p]]", 99).text).toBe("abc [[p]]")
    expect(insertLink("abc", "[[p]]", -4).text).toBe("[[p]] abc")
  })
  it("names the end of the text before its last line break", () => {
    expect(endOfText("Some text.\n")).toBe(10)
    expect(endOfText("\n")).toBe(0)
  })
})

describe("the text that is copied out of a note", () => {
  const body = "On [[lee-2024|Lee 2024]] and [[bare-slug]].\n\nSee [Esketamine](/wiki?condition=depression&treatment=esketamine) for [MDD](/wiki?condition=depression), and [a site](https://example.org).\n"
  it("shows each link of the app as its label and leaves other links alone", () => {
    expect(withoutLinks(body)).toBe("On Lee 2024 and bare-slug.\n\nSee Esketamine for MDD, and [a site](https://example.org).\n")
  })
  it("is the title as a heading, the text, and the numbered references", () => {
    expect(copyText("My note", body, [{ slug: "lee-2024", text: "Lee A. A trial. 2024." }, { slug: "x", text: "Kim B. Another. 2023." }], "References")).toBe(
      "# My note\n\nOn Lee 2024 and bare-slug.\n\nSee Esketamine for MDD, and [a site](https://example.org).\n\nReferences\n\n1. Lee A. A trial. 2024.\n2. Kim B. Another. 2023.\n",
    )
  })
  it("has no references part when the note cites nothing", () => {
    expect(copyText("T", "Text.\n", [], "References")).toBe("# T\n\nText.\n")
  })
})

describe("the addresses and the title of a note's page", () => {
  it("reads a note's id from its wiki page id", () => {
    expect(noteIdOf("wiki/notes/esketamine-in-trd")).toBe("esketamine-in-trd")
    expect(noteIdOf("wiki/notes/sub/one")).toBe("sub/one")
    expect(noteIdOf("wiki/projects/x/notes")).toBeNull()
    expect(noteIdOf("wiki/notes/")).toBeNull()
  })
  it("starts a chat from a note, and names a paper's page", () => {
    expect(noteChatHref("a note/1")).toBe("/chat?new=1&note=a%20note%2F1")
    expect(paperHref("lee-2024")).toBe("/paper/lee-2024")
  })
  it("reads the old button's title, and no title, as untitled", () => {
    expect(isUntitledStored("Untitled note")).toBe(true)
    expect(isUntitledStored("  ")).toBe(true)
    expect(isUntitledStored(undefined)).toBe(true)
    expect(isUntitledStored("Esketamine in TRD")).toBe(false)
  })
})

describe("a save sent while the page is being left", () => {
  it("is sent with keepalive when asked, and without it otherwise", async () => {
    const inits: RequestInit[] = []
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      inits.push(init ?? {})
      return new Response(JSON.stringify({ result: { revision: "r2", unresolved: [] } }), { status: 200 })
    }) as unknown as typeof fetch
    const input = { id: "a", title: "T", body: "B", revision: "r1" }
    await saveNoteRemote(input, fetchFn, { keepalive: true })
    await saveNoteRemote(input, fetchFn)
    expect(inits[0].keepalive).toBe(true)
    expect(inits[0].method).toBe("PUT")
    expect(JSON.parse(inits[0].body as string)).toEqual(input)
    expect("keepalive" in inits[1]).toBe(false)
  })
})
