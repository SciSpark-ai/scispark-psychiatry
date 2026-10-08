import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { CLINICAL_COPY } from "../copy"
import { createNoteRemote, listNotesRemote, readNoteRemote, saveNoteRemote, searchCitableRemote } from "../notes/client"

type Call = { url: string; init?: RequestInit }
function fake(status: number, body: unknown): { calls: Call[]; fetchFn: typeof fetch } {
  const calls: Call[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

describe("the notes client", () => {
  it("lists with the filters that are set, and with none", async () => {
    const { calls, fetchFn } = fake(200, { result: { notes: [{ id: "a" }] } })
    expect(await listNotesRemote({ q: "two words", condition: "depression", kind: "topic", paper: "", treatment: undefined }, fetchFn)).toEqual([{ id: "a" }])
    expect(calls[0].url).toBe("/api/clinical/notes?q=two+words&condition=depression&kind=topic")
    await listNotesRemote({}, fetchFn)
    expect(calls[1].url).toBe("/api/clinical/notes")
  })
  it("reads one note, null when there is none", async () => {
    const found = fake(200, { result: { summary: { id: "a b" }, body: "x", revision: "r", newPapers: [], references: [] } })
    expect((await readNoteRemote("a b", found.fetchFn))?.body).toBe("x")
    expect(found.calls[0].url).toBe("/api/clinical/notes?id=a%20b")
    expect(await readNoteRemote("nope", fake(404, { error: "gone" }).fetchFn)).toBeNull()
  })
  it("creates a note and gives its id", async () => {
    const { calls, fetchFn } = fake(200, { result: { id: "new-note" } })
    expect(await createNoteRemote({ title: "New note", about: { condition: "depression" } }, fetchFn)).toBe("new-note")
    expect(calls[0].init?.method).toBe("POST")
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ title: "New note", about: { condition: "depression" } })
  })
  it("saves a note, and gives a conflict back as a value", async () => {
    const input = { id: "a", title: "T", body: "B", revision: "r1" }
    const saved = fake(200, { result: { revision: "r2", unresolved: [] } })
    expect(await saveNoteRemote(input, saved.fetchFn)).toEqual({ revision: "r2", unresolved: [] })
    expect(saved.calls[0].init?.method).toBe("PUT")
    const conflict = fake(409, { error: "changed", conflict: { title: "Stored", body: "Stored body", revision: "r9" } })
    expect(await saveNoteRemote(input, conflict.fetchFn)).toEqual({ conflict: true, title: "Stored", body: "Stored body", revision: "r9" })
  })
  it("searches the papers to cite", async () => {
    const { calls, fetchFn } = fake(200, { result: { papers: [{ slug: "p" }] } })
    expect(await searchCitableRemote("lamsma 2026", fetchFn)).toEqual([{ slug: "p" }])
    expect(calls[0].url).toBe("/api/clinical/notes?cite=lamsma%202026")
  })
  it("throws the route's message, else the copy's, when a call fails", async () => {
    await expect(listNotesRemote({}, fake(500, { error: "broken" }).fetchFn)).rejects.toThrow("broken")
    await expect(createNoteRemote({}, fake(500, {}).fetchFn)).rejects.toThrow(CLINICAL_COPY.notes.requestFailed(500))
  })
  it("brings nothing of the server into the browser: its only value imports are the http helper and the copy", () => {
    const source = readFileSync(path.resolve(__dirname, "../notes/client.ts"), "utf8")
    const valueImports = [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1])
    expect(valueImports).toEqual(["../../http", "../copy"])
  })
})
