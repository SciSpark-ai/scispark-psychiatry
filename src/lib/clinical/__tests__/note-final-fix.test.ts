// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { parseDocument } from "../../vault/frontmatter"
import { commitChangeset } from "../../vault/mutations"
import { makeChangesetId } from "../../vault/changesets"
import { FINDINGS_PATH } from "../evidence/file"
import { loadPsychiatryPack } from "../pack/load"
import type { Taxonomy } from "../pack/schema"
import { saveNoteRemote } from "../notes/client"
import { clearDraft, readDraft, writeDraft } from "../notes/draft"
import { noteLinks, revisionOf } from "../notes/links"
import { previewMarkdown } from "../notes/preview"
import { listNotes, saveNote } from "../notes/store"
import { paper } from "./helpers"

const page = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n\n${body}`
const NOTE = page("type: note\ntitle: Plan\ncreated: 2026-10-01\nupdated: 2026-10-05\ntags: []\nrelated: []\nsources: []\nedited: 2026-10-05T09:00:00.000Z", "Start.\n")
const OTHER = page("type: note\ntitle: Other\ncreated: 2026-10-01\nupdated: 2026-10-02\ntags: []\nrelated: []\nsources: []", "Cites [[paper-1|Author1 2026]].\n")
const PAPER_1 = page("type: paper\ntitle: Paper 1\ncreated: 2026-09-21\nupdated: 2026-09-21\ntags: []\nrelated: []\nsources: []\nauthors:\n  - Ada Author1\nprojects: []\npmid: \"1\"\nyear: 2026\nstatus: saved", "# Paper 1\n")
const finding = (n: number) => ({
  key: `pmid:${n}`, slug: `paper-${n}`,
  paper: paper({ title: `Paper ${n}`, ids: { pmid: String(n) }, date: "2026-09-20", year: 2026, venue: "Lancet Psychiatry", authors: [{ name: `Ada Author${n}` }] }),
  headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, design: "randomized-trial", designSource: "publication-type", journalBand: null,
  conditionCodes: ["schizophrenia"], kind: "benefit", treatment: "clozapine", treatmentCode: null, treatmentClass: null, researchType: null, sampleSize: null, text: "reduced symptoms", population: null, comparator: null, outcome: null,
  firstListedAt: "2026-09-21T08:00:00.000Z", lastListedAt: "2026-09-21T08:00:00.000Z",
})

/** A vault whose reads of chosen paths fail. */
class Flaky extends MemoryVaultStorage {
  broken = new Set<string>()
  async read(path: string) {
    if (this.broken.has(path)) throw new Error("unreadable")
    return super.read(path)
  }
}

let taxonomy: Taxonomy
let storage: Flaky
beforeAll(async () => { taxonomy = (await loadPsychiatryPack()).taxonomy })
beforeEach(async () => {
  storage = new Flaky()
  await storage.write("wiki/notes/plan.md", NOTE)
  await storage.write("wiki/notes/other.md", OTHER)
  await storage.write("wiki/papers/paper-1.md", PAPER_1)
  await storage.write(FINDINGS_PATH, JSON.stringify({ version: 2, findings: { "pmid:1": finding(1), "pmid:2": finding(2) } }))
})
const at = (minutes: number) => new Date(Date.parse("2026-10-08T10:00:00.000Z") + minutes * 60_000)
const save = async (body: string, minutes: number, title = "Plan") => {
  const raw = await storage.read("wiki/notes/plan.md") as string
  return saveNote(storage, taxonomy, "plan", { title, body, revision: revisionOf(raw), now: at(minutes) })
}
const records = async () => {
  const out: Array<{ skill: string; timestamp: string; changes: Array<{ path: string; before: string | null; after: string | null }> }> = []
  for (const path of await storage.list(".scispark/changesets/")) out.push(JSON.parse(await storage.read(path) as string))
  return out.filter((record) => record.changes.some((change) => change.path === "wiki/notes/plan.md")).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
const logLines = async () => ((await storage.read("log.md")) ?? "").split("\n").filter((line) => line.includes("clinical-note-save"))

describe("A4: a save says which papers it put in the Library", () => {
  it("names the papers it saved in this call, and none that were there or that it could not find", async () => {
    const first = await save("See [[paper-2]], [[paper-1]] and [[made-up]].\n", 0)
    expect(first).toMatchObject({ savedPapers: ["paper-2"], unresolved: ["made-up"] })
    const second = await save("See [[paper-2]], [[paper-1]] and [[made-up]]. More.\n", 1)
    expect(second).toMatchObject({ savedPapers: [], unresolved: ["made-up"] })
  })
})

describe("A5: saves made close together are one record of the vault's history", () => {
  it("replaces the record of an autosave made less than ten minutes before, keeping its before text, and adds no log line", async () => {
    await save("One.\n", 0)
    const afterFirst = await storage.read("wiki/notes/plan.md") as string
    expect(await records()).toHaveLength(1)
    expect(await logLines()).toHaveLength(1)
    await save("One. Two.\n", 5)
    const afterSecond = await storage.read("wiki/notes/plan.md") as string
    expect(afterSecond).not.toBe(afterFirst)
    expect(parseDocument(afterSecond).body).toBe("One. Two.\n")
    const held = await records()
    expect(held).toHaveLength(1)
    expect(held[0].changes).toEqual([{ path: "wiki/notes/plan.md", before: NOTE, after: afterSecond }])
    expect(held[0].skill).toBe("clinical-note-save")
    expect(await logLines()).toHaveLength(1)
    await save("One. Two. Three.\n", 9)
    expect(await records()).toHaveLength(1)
    expect((await records())[0].changes[0].before).toBe(NOTE)
  })
  it("starts a new record ten minutes after the one before was made", async () => {
    await save("One.\n", 0)
    await save("One. Two.\n", 9)
    const middle = await storage.read("wiki/notes/plan.md") as string
    await save("One. Two. Three.\n", 10)
    const held = await records()
    expect(held).toHaveLength(2)
    expect(held[1].changes[0].before).toBe(middle)
    expect(await logLines()).toHaveLength(2)
  })
  it("does not replace a record that is not an autosave of this note, nor one the note has moved on from", async () => {
    await save("One.\n", 0)
    const raw = await storage.read("wiki/notes/plan.md") as string
    const edited = raw.replace("One.", "One, edited in the wiki.")
    await commitChangeset(storage, { id: makeChangesetId(), skill: "wiki-edit", model: "none", timestamp: at(1).toISOString(), changes: [{ path: "wiki/notes/plan.md", before: raw, after: edited }] })
    await save("Mine again.\n", 2)
    const held = await records()
    expect(held.map((record) => record.skill)).toEqual(["clinical-note-save", "wiki-edit", "clinical-note-save"])
    expect(held[2].changes[0].before).toBe(edited)
    // An autosave of another note in between does not stand in the way, and is not replaced.
    const other = await storage.read("wiki/notes/other.md") as string
    await saveNote(storage, taxonomy, "other", { title: "Other", body: "Other text.\n", revision: revisionOf(other), now: at(3) })
    await save("Mine again, more.\n", 4)
    expect(await records()).toHaveLength(3)
    expect((await storage.list(".scispark/changesets/")).length).toBe(4)
  })
  it("can still be undone as one step: the record's after text is the stored text", async () => {
    await save("One.\n", 0)
    await save("One. Two.\n", 3)
    const [record] = await records()
    expect(record.changes[0].after).toBe(await storage.read("wiki/notes/plan.md"))
  })
})

describe("A7: one bad note or paper page, and a change that is none", () => {
  it("leaves a note that cannot be read out of the list and lists the others", async () => {
    storage.broken.add("wiki/notes/plan.md")
    expect((await listNotes(storage, taxonomy, { now: at(0) })).map((note) => note.id)).toEqual(["other"])
  })
  it("names a cited paper by the label of the text when its page cannot be read", async () => {
    storage.broken.add("wiki/papers/paper-1.md")
    const notes = await listNotes(storage, taxonomy, { now: at(0) })
    expect(notes.find((note) => note.id === "other")?.papers).toEqual([{ slug: "paper-1", label: "Author1 2026" }])
  })
  it("writes nothing and keeps the edit time when only white space around the title changed", async () => {
    const before = storage.snapshot()
    const result = await save("Start.\n", 0, "  Plan  ")
    expect(result).toMatchObject({ revision: revisionOf(NOTE), unresolved: [], savedPapers: [] })
    expect(storage.snapshot()).toEqual(before)
  })
})

describe("A6: a conflict says whether the stored note has a title", () => {
  it("is untitled for the old button's title and titled otherwise", async () => {
    const stale = revisionOf("stale")
    expect(await saveNote(storage, taxonomy, "plan", { title: "x", body: "x", revision: stale, now: at(0) })).toMatchObject({ conflict: true, title: "Plan", untitled: false })
    await storage.write("wiki/notes/plan.md", NOTE.replace("title: Plan", "title: Untitled note"))
    expect(await saveNote(storage, taxonomy, "plan", { title: "x", body: "x", revision: stale, now: at(0) })).toMatchObject({ conflict: true, title: "Start.", untitled: true })
  })
})

describe("A3 and A6: the notes client", () => {
  const capture = (status: number, body: unknown) => {
    const inits: RequestInit[] = []
    const fetchFn = (async (_url: string, init?: RequestInit) => { inits.push(init ?? {}); return new Response(JSON.stringify(body), { status }) }) as unknown as typeof fetch
    return { inits, fetchFn }
  }
  it("asks for keepalive only when what it sends is under 60,000 bytes", async () => {
    const { inits, fetchFn } = capture(200, { result: { revision: "r2", unresolved: [], savedPapers: [] } })
    const input = (body: string) => ({ id: "a", title: "T", body, revision: "r1" })
    await saveNoteRemote(input("x".repeat(50_000)), fetchFn, { keepalive: true })
    await saveNoteRemote(input("x".repeat(60_000)), fetchFn, { keepalive: true })
    // Bytes, not characters: 30,000 two-byte letters are 60,000 bytes.
    await saveNoteRemote(input("é".repeat(30_000)), fetchFn, { keepalive: true })
    expect(inits.map((init) => init.keepalive === true)).toEqual([true, false, false])
    expect(JSON.parse(inits[1].body as string).body).toHaveLength(60_000)
  })
  it("gives the papers a save put in the Library, and a conflict with whether the stored note has a title", async () => {
    const ok = capture(200, { result: { revision: "r2", unresolved: [], savedPapers: ["p"] } })
    expect(await saveNoteRemote({ id: "a", title: "T", body: "B", revision: "r1" }, ok.fetchFn)).toEqual({ revision: "r2", unresolved: [], savedPapers: ["p"] })
    const clash = capture(409, { error: "changed", conflict: { title: "First line", untitled: true, body: "First line", revision: "r9" } })
    expect(await saveNoteRemote({ id: "a", title: "T", body: "B", revision: "r1" }, clash.fetchFn)).toEqual({ conflict: true, title: "First line", untitled: true, body: "First line", revision: "r9" })
  })
  it("throws the route's own words for a note that is too long", async () => {
    const { fetchFn } = capture(413, { error: "too long" })
    await expect(saveNoteRemote({ id: "a", title: "T", body: "B", revision: "r1" }, fetchFn)).rejects.toThrow("too long")
  })
})

describe("A8: a paper linked by its path, and labels in the preview", () => {
  it("reads [[wiki/papers/x]] as the paper x", () => {
    expect(noteLinks("On [[wiki/papers/lee-2024|Lee 2024]], [[wiki/papers/kim-2023.md]] and [[lee-2024]]; not [[wiki/concepts/glutamate]].").papers).toEqual(["lee-2024", "kim-2023", "wiki/concepts/glutamate"])
  })
  it("links a paper linked by its path in the preview, and marks one that is missing", () => {
    const links = { papers: new Map([["lee-2024", "Lee 2024"]]), missing: new Set(["gone"]), notFound: "not found" }
    expect(previewMarkdown("[[wiki/papers/lee-2024]] and [[wiki/papers/gone|Gone]]", links)).toBe("[Lee 2024](/paper/lee-2024) and Gone *(not found)*")
  })
  it("keeps the marks of emphasis and code in a label from being read as such", () => {
    const links = { papers: new Map([["p", "a *b* `c` _d_"]]), missing: new Set(["m"]), notFound: "not found" }
    const out = previewMarkdown("x [[p]] y [[m|*M* `m`]] z [[typed|*T*]]", links)
    expect(out.replace(/\*\(not found\)\*/g, "")).not.toMatch(/[*`]/)
    expect(out).toContain("](/paper/p)")
    expect(out).toContain("_d_")
  })
})

describe("A3: the draft of a note kept by the browser", () => {
  beforeEach(() => sessionStorage.clear())
  it("keeps one draft per note, and forgets it", () => {
    expect(readDraft("a")).toBeNull()
    writeDraft("a", { title: "T", body: "B", revision: "r1" })
    writeDraft("b/c", { title: "", body: "Other", revision: "r7" })
    expect(readDraft("a")).toEqual({ title: "T", body: "B", revision: "r1" })
    expect(readDraft("b/c")).toEqual({ title: "", body: "Other", revision: "r7" })
    clearDraft("a")
    expect(readDraft("a")).toBeNull()
    expect(readDraft("b/c")).not.toBeNull()
  })
  it("reads a damaged draft as none, and never throws when the browser refuses", () => {
    writeDraft("a", { title: "T", body: "B", revision: "r1" })
    const key = sessionStorage.key(0) as string
    sessionStorage.setItem(key, "{not json")
    expect(readDraft("a")).toBeNull()
    sessionStorage.setItem(key, JSON.stringify({ title: 5 }))
    expect(readDraft("a")).toBeNull()
    const refusing = () => { throw new Error("blocked") }
    vi.stubGlobal("sessionStorage", { getItem: refusing, setItem: refusing, removeItem: refusing })
    expect(() => writeDraft("a", { title: "T", body: "B", revision: "r1" })).not.toThrow()
    expect(() => clearDraft("a")).not.toThrow()
    expect(readDraft("a")).toBeNull()
    vi.unstubAllGlobals()
  })
})
