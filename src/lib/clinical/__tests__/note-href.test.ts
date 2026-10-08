import { describe, expect, it } from "vitest"
import { LIBRARY_TABS, libraryHref, libraryTabOf, movedNotesHref, noteHref, noteKindOf, notesHref } from "../notes/href"

describe("the addresses of the Library and of the Notes page", () => {
  it("leaves the Papers tab out, as it is the default", () => {
    expect(libraryHref()).toBe("/wiki?view=all")
    expect(libraryHref("papers")).toBe("/wiki?view=all")
  })

  it("names another tab", () => {
    expect(LIBRARY_TABS).toEqual(["papers", "read-later", "history", "chats"])
    expect(libraryHref("read-later")).toBe("/wiki?view=all&tab=read-later")
    expect(libraryHref("history")).toBe("/wiki?view=all&tab=history")
    expect(libraryHref("chats")).toBe("/wiki?view=all&tab=chats")
  })

  it("writes the filters of the notes on /notes, each only when it is set", () => {
    expect(notesHref()).toBe("/notes")
    expect(notesHref({ q: " keta mine ", condition: "depression", kind: "paper" })).toBe("/notes?q=keta+mine&condition=depression&kind=paper")
    expect(notesHref({ q: "  ", kind: "none" })).toBe("/notes?kind=none")
    expect(notesHref({ condition: "depression", treatment: "esketamine" })).toBe("/notes?condition=depression&treatment=esketamine")
  })

  it("leads an old address of the Notes tab to the same filters on /notes, and no other address", () => {
    expect(movedNotesHref(new URLSearchParams("view=all&tab=notes"))).toBe("/notes")
    expect(movedNotesHref(new URLSearchParams("view=all&tab=notes&q=keta&condition=depression&treatment=esketamine&kind=topic")))
      .toBe("/notes?q=keta&condition=depression&treatment=esketamine&kind=topic")
    expect(movedNotesHref(new URLSearchParams("view=all&tab=notes&kind=zzz"))).toBe("/notes")
    expect(movedNotesHref(new URLSearchParams("view=all"))).toBeNull()
    expect(movedNotesHref(new URLSearchParams("view=all&tab=chats&q=x"))).toBeNull()
  })

  it("reads a tab and a kind from an address, and falls back for what is neither", () => {
    expect(libraryTabOf("read-later")).toBe("read-later")
    expect(libraryTabOf("notes")).toBe("papers")
    expect(libraryTabOf("projects")).toBe("papers")
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
