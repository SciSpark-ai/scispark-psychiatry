import { describe, expect, it } from "vitest"
import { libraryHref, libraryTabOf, noteHref, noteKindOf } from "../notes/href"

describe("the addresses of the Library", () => {
  it("leaves the Papers tab out, as it is the default", () => {
    expect(libraryHref()).toBe("/wiki?view=all")
    expect(libraryHref("papers", { q: "x", condition: "depression" })).toBe("/wiki?view=all")
  })

  it("names another tab", () => {
    expect(libraryHref("notes")).toBe("/wiki?view=all&tab=notes")
    expect(libraryHref("projects")).toBe("/wiki?view=all&tab=projects")
    expect(libraryHref("chats", { q: "x" })).toBe("/wiki?view=all&tab=chats")
  })

  it("writes the filters of the notes, each only when it is set", () => {
    expect(libraryHref("notes", { q: " keta mine ", condition: "depression", kind: "paper" })).toBe("/wiki?view=all&tab=notes&q=keta+mine&condition=depression&kind=paper")
    expect(libraryHref("notes", { q: "  ", kind: "none" })).toBe("/wiki?view=all&tab=notes&kind=none")
    expect(libraryHref("notes", { condition: "depression", treatment: "esketamine" })).toBe("/wiki?view=all&tab=notes&condition=depression&treatment=esketamine")
  })

  it("reads a tab and a kind from an address, and falls back for what is neither", () => {
    expect(libraryTabOf("notes")).toBe("notes")
    expect(libraryTabOf(null)).toBe("papers")
    expect(libraryTabOf("zzz")).toBe("papers")
    expect(noteKindOf("topic")).toBe("topic")
    expect(noteKindOf("all")).toBeUndefined()
    expect(noteKindOf(null)).toBeUndefined()
  })

  it("gives a note its wiki address", () => {
    expect(noteHref("esketamine-in-trd")).toBe("/wiki/notes/esketamine-in-trd")
  })
})
