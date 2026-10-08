import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { parseDocument } from "../../vault/frontmatter"
import { FINDINGS_PATH } from "../evidence/file"
import { loadPsychiatryPack } from "../pack/load"
import type { Taxonomy } from "../pack/schema"
import { CLINICAL_COPY } from "../copy"
import { noteLinks, revisionOf } from "../notes/links"
import {
  NoteInputError, NoteNotFoundError, createNote, ensurePaperSaved, listNotes, newPapersFor, readNote, referencesOf, saveNote, searchCitable,
} from "../notes/store"
import { paper } from "./helpers"

const NOW = new Date("2026-10-07T12:00:00.000Z")

const finding = (n: number, conditionCodes: string[], treatment: string | null, firstListedAt: string, extra: Record<string, unknown> = {}) => ({
  key: `pmid:${n}`, slug: `paper-${n}`,
  paper: paper({ title: `Paper ${n}`, ids: { pmid: String(n) }, date: "2026-09-20", year: 2026, venue: "Lancet Psychiatry", authors: [{ name: `Ada Author${n}` }] }),
  headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, design: "randomized-trial", designSource: "publication-type", journalBand: null,
  conditionCodes, kind: "benefit", treatment, treatmentCode: null, treatmentClass: null, researchType: null, sampleSize: null, text: "reduced symptoms", population: null, comparator: null, outcome: null,
  firstListedAt, lastListedAt: firstListedAt, ...extra,
})

const page = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n\n${body}`
const NOTE_PLAN = page(
  "type: note\ntitle: Esketamine in TRD\ncreated: 2026-10-01\nupdated: 2026-10-05\ntags: []\nrelated: []\nsources: []\nedited: 2026-10-05T09:00:00.000Z",
  "[Esketamine](/wiki?condition=treatment-resistant-depression&treatment=esketamine)\n\nWorks fast, see [[paper-1|Author1 2026]].\n",
)
const NOTE_BUTTON = page("type: note\ntitle: Untitled note\ncreated: 2026-09-01\nupdated: 2026-09-01\ntags: []\nrelated: []\nsources: []", "First thoughts on clozapine dosing.\n")
const NOTE_CAPTURE = page(
  "type: note\ntitle: Dose finding looks weak\ncreated: 2026-09-10\nupdated: 2026-09-10\ntags: []\nrelated:\n  - paper-2\nsources: []",
  "Dose finding looks weak\n\n> The trial used a fixed dose.\n",
)
const NOTE_PROJECT = page(
  "type: note\ntitle: Project plan\ncreated: 2026-09-20\nupdated: 2026-09-20\ntags:\n  - plan\nrelated: []\nsources:\n  - https://example.org/a\nprojects:\n  - proj-1",
  "Plan for [Schizophrenia](/wiki?condition=schizophrenia).\n",
)
const PAPER_1 = page(
  "type: paper\ntitle: Paper 1\ncreated: 2026-09-21\nupdated: 2026-09-21\ntags: []\nrelated: []\nsources: []\nauthors:\n  - Ada Author1\n  - Bo Second\nprojects: []\npmid: \"1\"\ndoi: 10.1000/one\nyear: 2026\nvenue: Lancet Psychiatry\nstatus: saved",
  "# Paper 1\n",
)
const NOTE_FILES = {
  "wiki/notes/esketamine-in-trd.md": NOTE_PLAN,
  "wiki/notes/note-1756684800000.md": NOTE_BUTTON,
  "wiki/notes/note-dose-finding-looks-weak-ab12cd34.md": NOTE_CAPTURE,
  "wiki/notes/project-plan.md": NOTE_PROJECT,
}

let taxonomy: Taxonomy
let storage: MemoryVaultStorage
beforeAll(async () => { taxonomy = (await loadPsychiatryPack()).taxonomy })
beforeEach(async () => {
  storage = new MemoryVaultStorage()
  for (const [path, raw] of Object.entries(NOTE_FILES)) await storage.write(path, raw)
  await storage.write("wiki/papers/paper-1.md", PAPER_1)
  await storage.write("wiki/concepts/glutamate.md", page("type: concept\ntitle: Glutamate\ncreated: 2026-09-01\nupdated: 2026-09-01\ntags: []\nrelated: []\nsources: []", "A concept.\n"))
  await storage.write(FINDINGS_PATH, JSON.stringify({ version: 2, findings: {
    "pmid:1": finding(1, ["treatment-resistant-depression"], "esketamine", "2026-09-21T08:00:00.000Z"),
    "pmid:2": finding(2, ["schizophrenia"], "clozapine", "2026-09-10T08:00:00.000Z"),
    "pmid:3": finding(3, ["treatment-resistant-depression"], "esketamine", "2026-10-06T08:00:00.000Z"),
    "pmid:4": finding(4, ["treatment-resistant-depression"], "lithium", "2026-10-06T09:00:00.000Z"),
    "pmid:5": finding(5, ["schizophrenia"], "clozapine", "2026-10-06T10:00:00.000Z"),
    "pmid:6": finding(6, ["treatment-resistant-depression"], "placebo", "2026-10-06T11:00:00.000Z", { comparator: "esketamine" }),
  } }))
})
const list = (opts: Omit<Parameters<typeof listNotes>[2], "now"> = {}) => listNotes(storage, taxonomy, { ...opts, now: NOW })
const ids = async (opts: Omit<Parameters<typeof listNotes>[2], "now"> = {}) => (await list(opts)).map((note) => note.id)
const put = (id: string, frontmatter: string, body: string) => storage.write(`wiki/notes/${id}.md`, page(`type: note\ntitle: ${id}\ncreated: 2026-10-01\nupdated: 2026-10-01\ntags: []\nrelated: []\nsources: []${frontmatter}`, body))

describe("listNotes", () => {
  it("lists every note page, whoever made it, newest edit first, and rewrites none", async () => {
    const before = storage.snapshot()
    const notes = await list()
    expect(notes.map((note) => note.id)).toEqual(["esketamine-in-trd", "project-plan", "note-dose-finding-looks-weak-ab12cd34", "note-1756684800000"])
    expect(storage.snapshot()).toEqual(before)
  })
  it("leaves out a page of another type and a file that cannot be parsed", async () => {
    await storage.write("wiki/notes/a-concept.md", page("type: concept\ntitle: X\ncreated: 2026-09-01\nupdated: 2026-09-01\ntags: []\nrelated: []\nsources: []", "x\n"))
    await storage.write("wiki/notes/broken.md", "no frontmatter")
    expect(await ids()).toHaveLength(4)
  })
  it("describes a note made by this plan", async () => {
    const [note] = await list()
    expect(note).toMatchObject({
      id: "esketamine-in-trd", title: "Esketamine in TRD", updated: "2026-10-05", created: "2026-10-01", kind: "topic", project: false,
      links: { papers: ["paper-1"], conditions: ["treatment-resistant-depression"], treatments: [{ condition: "treatment-resistant-depression", treatment: "esketamine" }] },
      conditions: [{ code: "treatment-resistant-depression", name: "Treatment-resistant depression" }],
      papers: [{ slug: "paper-1", label: "Author1 2026" }],
      treatments: [{ condition: "treatment-resistant-depression", key: "esketamine", name: "Esketamine" }],
    })
    expect(note.excerpt).toBe("Esketamine Works fast, see Author1 2026.")
  })
  it("titles the old button's note from its body, and marks a project note", async () => {
    const notes = await list()
    const button = notes.find((note) => note.id === "note-1756684800000")
    expect(button).toMatchObject({ title: "First thoughts on clozapine dosing.", kind: "none", project: false, newSince: 0 })
    expect(notes.find((note) => note.id === "project-plan")).toMatchObject({ project: true, kind: "topic" })
    expect(notes.find((note) => note.id === "note-dose-finding-looks-weak-ab12cd34")).toMatchObject({ title: "Dose finding looks weak", kind: "none", project: false })
  })
  it("gives the conditions of a cited paper through the findings store", async () => {
    await put("on-paper-2", "", "Read [[paper-2]].\n")
    const note = (await list()).find((entry) => entry.id === "on-paper-2")
    expect(note).toMatchObject({ kind: "paper", conditions: [{ code: "schizophrenia", name: "Schizophrenia" }], papers: [{ slug: "paper-2", label: "Author2 2026" }], newSince: 0 })
  })
  it("does not count a wiki link to a page that is not a paper as a paper", async () => {
    await put("on-glutamate", "", "About [[glutamate]] and [[wiki/concepts/glutamate|the concept]], and [[wiki/papers/paper-1|one paper]].\n")
    const note = (await list()).find((entry) => entry.id === "on-glutamate")
    expect(note?.links.papers).toEqual(["paper-1"])
    expect(note?.kind).toBe("paper")
  })

  it("filters by the words of a query, in the title or the body, in any case", async () => {
    expect(await ids({ q: "ESKETAMINE fast" })).toEqual(["esketamine-in-trd"])
    expect(await ids({ q: "plan" })).toEqual(["project-plan"])
    expect(await ids({ q: "esketamine clozapine" })).toEqual([])
    expect(await ids({ q: "  " })).toHaveLength(4)
  })
  it("filters by a condition, its subtypes included", async () => {
    expect(await ids({ condition: "depression" })).toEqual(["esketamine-in-trd"])
    expect(await ids({ condition: "treatment-resistant-depression" })).toEqual(["esketamine-in-trd"])
    expect(await ids({ condition: "schizophrenia" })).toEqual(["project-plan"])
    expect(await ids({ condition: "adhd" })).toEqual([])
  })
  it("filters by kind", async () => {
    expect(await ids({ kind: "topic" })).toEqual(["esketamine-in-trd", "project-plan"])
    expect(await ids({ kind: "none" })).toEqual(["note-dose-finding-looks-weak-ab12cd34", "note-1756684800000"])
    expect(await ids({ kind: "paper" })).toEqual([])
  })
  it("filters by a paper and by a treatment of a condition", async () => {
    expect(await ids({ paper: "paper-1" })).toEqual(["esketamine-in-trd"])
    expect(await ids({ paper: "paper-2" })).toEqual([])
    expect(await ids({ condition: "treatment-resistant-depression", treatment: "esketamine" })).toEqual(["esketamine-in-trd"])
    expect(await ids({ condition: "depression", treatment: "esketamine" })).toEqual(["esketamine-in-trd"])
    expect(await ids({ condition: "schizophrenia", treatment: "esketamine" })).toEqual([])
    expect(await ids({ condition: "treatment-resistant-depression", treatment: "lithium" })).toEqual([])
  })
  it("combines the filters", async () => {
    expect(await ids({ q: "plan", condition: "schizophrenia", kind: "topic" })).toEqual(["project-plan"])
    expect(await ids({ q: "plan", condition: "depression" })).toEqual([])
    expect(await ids({ kind: "topic", paper: "paper-1", q: "fast" })).toEqual(["esketamine-in-trd"])
  })
})

describe("newSince and newPapersFor", () => {
  it("counts the papers of a linked treatment listed after the last edit, not one already cited, not one that only compares with it", async () => {
    // paper-3 names esketamine after the edit; paper-1 is cited and earlier; paper-4 is lithium; paper-6 has esketamine as its comparator.
    expect((await list())[0].newSince).toBe(1)
    expect(await newPapersFor(storage, taxonomy, "esketamine-in-trd", NOW)).toEqual([
      { slug: "paper-3", label: "Author3 2026", headline: "Headline 3", condition: "treatment-resistant-depression", firstListed: "2026-10-06" },
    ])
  })
  it("does not count a paper the note already cites", async () => {
    await put("cites-3", "\nedited: 2026-10-05T09:00:00.000Z", "[Esketamine](/wiki?condition=treatment-resistant-depression&treatment=esketamine) [[paper-3]]\n")
    expect((await list()).find((note) => note.id === "cites-3")?.newSince).toBe(0)
  })
  it("counts every new paper of a condition linked with no treatment, subtypes included, newest first", async () => {
    await put("on-depression", "\nedited: 2026-10-05T09:00:00.000Z", "[Major depressive disorder](/wiki?condition=depression)\n")
    expect((await list()).find((note) => note.id === "on-depression")?.newSince).toBe(3)
    expect((await newPapersFor(storage, taxonomy, "on-depression", NOW)).map((entry) => entry.slug)).toEqual(["paper-6", "paper-4", "paper-3"])
  })
  it("is 0 for a note that links only papers", async () => {
    await put("only-papers", "\nedited: 2026-09-01T09:00:00.000Z", "[[paper-1]] and [[paper-2]]\n")
    expect((await list()).find((note) => note.id === "only-papers")).toMatchObject({ kind: "topic", newSince: 0 })
    expect(await newPapersFor(storage, taxonomy, "only-papers", NOW)).toEqual([])
  })
  it("takes an old note without an edit time as edited at the end of its updated day", async () => {
    // project-plan: updated 2026-09-20, links schizophrenia. paper-2 was listed on 2026-09-10 (before), paper-5 on 2026-10-06 (after).
    expect((await list()).find((note) => note.id === "project-plan")?.newSince).toBe(1)
    await put("same-day", "", "[Schizophrenia](/wiki?condition=schizophrenia)\n")
    await storage.write("wiki/notes/same-day.md", (await storage.read("wiki/notes/same-day.md") as string).replace("updated: 2026-10-01", "updated: 2026-10-06"))
    expect((await list()).find((note) => note.id === "same-day")?.newSince).toBe(0)
  })
  it("does not count a paper listed after now", async () => {
    expect((await listNotes(storage, taxonomy, { now: new Date("2026-10-06T08:30:00.000Z") }))[0].newSince).toBe(1)
    expect((await listNotes(storage, taxonomy, { now: new Date("2026-10-06T07:00:00.000Z") }))[0].newSince).toBe(0)
  })
  it("gives nothing for a note that does not exist", async () => {
    expect(await newPapersFor(storage, taxonomy, "no-such-note", NOW)).toEqual([])
  })
})

describe("readNote", () => {
  it("gives the summary, the body and a revision of the file's text, and changes nothing", async () => {
    const before = storage.snapshot()
    const note = await readNote(storage, taxonomy, "esketamine-in-trd", NOW)
    expect(note?.summary.id).toBe("esketamine-in-trd")
    expect(note?.body).toBe(parseDocument(NOTE_PLAN).body)
    expect(note?.revision).toBe(revisionOf(NOTE_PLAN))
    expect(storage.snapshot()).toEqual(before)
  })
  it("is null for a note that is not there, a page of another type and an unsafe id", async () => {
    expect(await readNote(storage, taxonomy, "nope", NOW)).toBeNull()
    expect(await readNote(storage, taxonomy, "../papers/paper-1", NOW)).toBeNull()
    await storage.write("wiki/notes/a-concept.md", page("type: concept\ntitle: X\ncreated: 2026-09-01\nupdated: 2026-09-01\ntags: []\nrelated: []\nsources: []", "x\n"))
    expect(await readNote(storage, taxonomy, "a-concept", NOW)).toBeNull()
  })
})

describe("createNote", () => {
  it("names the file from the title and writes the frontmatter the wiki requires, with the edit time", async () => {
    const id = await createNote(storage, taxonomy, { title: "Clozapine: monitoring", body: "Weekly counts.", now: NOW })
    expect(id).toBe("clozapine-monitoring")
    const { frontmatter, body } = parseDocument(await storage.read("wiki/notes/clozapine-monitoring.md") as string)
    expect(frontmatter).toEqual({ type: "note", title: "Clozapine: monitoring", created: "2026-10-07", updated: "2026-10-07", tags: [], related: [], sources: [], edited: "2026-10-07T12:00:00.000Z" })
    expect(body).toBe("Weekly counts.\n")
  })
  it("adds -2 and -3 when the name is taken", async () => {
    expect(await createNote(storage, taxonomy, { title: "Project plan", now: NOW })).toBe("project-plan-2")
    expect(await createNote(storage, taxonomy, { title: "Project plan", now: NOW })).toBe("project-plan-3")
    expect(await storage.read("wiki/notes/project-plan.md")).toBe(NOTE_PROJECT)
  })
  it("names a note without a title by the day and four characters", async () => {
    const id = await createNote(storage, taxonomy, { now: NOW })
    expect(id).toMatch(/^note-20261007-[a-z0-9]{4}$/)
    const note = await readNote(storage, taxonomy, id, NOW)
    expect(note?.summary.title).toBe(CLINICAL_COPY.notes.untitled)
    expect(note?.body.trim()).toBe("")
  })
  it("starts a note about a condition with its link", async () => {
    const id = await createNote(storage, taxonomy, { body: "Thoughts.", about: { condition: "schizophrenia" }, now: NOW })
    const note = await readNote(storage, taxonomy, id, NOW)
    expect(note?.body).toBe("[Schizophrenia](/wiki?condition=schizophrenia)\n\nThoughts.\n")
    expect(note?.summary).toMatchObject({ kind: "topic", conditions: [{ code: "schizophrenia", name: "Schizophrenia" }] })
  })
  it("starts a note about a treatment with its link", async () => {
    const id = await createNote(storage, taxonomy, { title: "Esketamine", about: { treatment: { condition: "depression", key: "esketamine" } }, now: NOW })
    const note = await readNote(storage, taxonomy, id, NOW)
    expect(note?.body).toBe("[Esketamine](/wiki?condition=depression&treatment=esketamine)\n")
    expect(note?.summary.treatments).toEqual([{ condition: "depression", key: "esketamine", name: "Esketamine" }])
  })
  it("starts a note about a paper with its link, and saves the paper to the Library first", async () => {
    expect(await storage.read("wiki/papers/paper-3.md")).toBeNull()
    const id = await createNote(storage, taxonomy, { about: { paper: "paper-3" }, now: NOW })
    const saved = parseDocument(await storage.read("wiki/papers/paper-3.md") as string)
    expect(saved.frontmatter).toMatchObject({ type: "paper", title: "Paper 3", status: "saved" })
    const note = await readNote(storage, taxonomy, id, NOW)
    expect(note?.body).toBe("[[paper-3|Author3 2026]]\n")
    expect(note?.summary).toMatchObject({ kind: "paper", papers: [{ slug: "paper-3", label: "Author3 2026" }] })
  })
  it("refuses a paper, a condition or a treatment it does not know, and writes nothing", async () => {
    const before = storage.snapshot()
    await expect(createNote(storage, taxonomy, { about: { paper: "no-such-paper" }, now: NOW })).rejects.toBeInstanceOf(NoteInputError)
    await expect(createNote(storage, taxonomy, { about: { condition: "esketamine" }, now: NOW })).rejects.toBeInstanceOf(NoteInputError)
    await expect(createNote(storage, taxonomy, { about: { treatment: { condition: "depression", key: "no-such" } }, now: NOW })).rejects.toBeInstanceOf(NoteInputError)
    expect(storage.snapshot()).toEqual(before)
  })
})

describe("saveNote", () => {
  const later = new Date("2026-10-08T10:30:00.000Z")
  it("changes the title, the dates and the body, and keeps every other frontmatter key", async () => {
    const result = await saveNote(storage, taxonomy, "project-plan", { title: "Project plan, revised", body: "New body.\n", revision: revisionOf(NOTE_PROJECT), now: later })
    const raw = await storage.read("wiki/notes/project-plan.md") as string
    expect(result).toEqual({ revision: revisionOf(raw), unresolved: [] })
    const { frontmatter, body } = parseDocument(raw)
    expect(frontmatter).toEqual({
      type: "note", title: "Project plan, revised", created: "2026-09-20", updated: "2026-10-08", tags: ["plan"], related: [], sources: ["https://example.org/a"], projects: ["proj-1"],
      edited: "2026-10-08T10:30:00.000Z",
    })
    expect(body).toBe("New body.\n")
    expect((await storage.list("wiki/notes/")).sort()).toEqual([...Object.keys(NOTE_FILES)].sort())
  })
  it("answers a stale revision with the stored version and writes nothing", async () => {
    const before = storage.snapshot()
    const result = await saveNote(storage, taxonomy, "project-plan", { title: "Mine", body: "Mine.", revision: revisionOf("something else"), now: later })
    expect(result).toEqual({ conflict: true, title: "Project plan", body: parseDocument(NOTE_PROJECT).body, revision: revisionOf(NOTE_PROJECT) })
    expect(storage.snapshot()).toEqual(before)
  })
  it("saves a newly cited paper to the Library and reports one it cannot resolve", async () => {
    const body = "See [[paper-2|Author2 2026]], [[paper-1]], [[made-up-paper]] and [[glutamate]].\n"
    const result = await saveNote(storage, taxonomy, "note-1756684800000", { title: "", body, revision: revisionOf(NOTE_BUTTON), now: later })
    expect(result).toMatchObject({ unresolved: ["made-up-paper"] })
    expect(parseDocument(await storage.read("wiki/papers/paper-2.md") as string).frontmatter).toMatchObject({ type: "paper", title: "Paper 2", status: "saved" })
    expect(await storage.read("wiki/papers/paper-1.md")).toBe(PAPER_1)
    expect(await storage.read("wiki/papers/made-up-paper.md")).toBeNull()
    const note = await readNote(storage, taxonomy, "note-1756684800000", later)
    expect(note?.body).toBe(body)
    expect(noteLinks(note?.body ?? "").papers).toContain("made-up-paper")
    expect(parseDocument(await storage.read("wiki/notes/note-1756684800000.md") as string).frontmatter.title).toBe("Untitled note")
  })
  it("moves a saved note to the top of the list", async () => {
    await saveNote(storage, taxonomy, "note-1756684800000", { title: "Clozapine", body: "x", revision: revisionOf(NOTE_BUTTON), now: later })
    expect((await listNotes(storage, taxonomy, { now: later }))[0]).toMatchObject({ id: "note-1756684800000", title: "Clozapine", updated: "2026-10-08" })
  })
  it("throws for a note that is not there", async () => {
    await expect(saveNote(storage, taxonomy, "nope", { title: "x", body: "x", revision: revisionOf("x"), now: later })).rejects.toBeInstanceOf(NoteNotFoundError)
  })
})

describe("ensurePaperSaved", () => {
  it("says saved, already or unknown", async () => {
    expect(await ensurePaperSaved(storage, "paper-1", NOW)).toBe("already")
    expect(await ensurePaperSaved(storage, "paper-5", NOW)).toBe("saved")
    expect(await ensurePaperSaved(storage, "paper-5", NOW)).toBe("already")
    expect(await ensurePaperSaved(storage, "no-such-paper", NOW)).toBe("unknown")
    expect(await ensurePaperSaved(storage, "../notes/project-plan", NOW)).toBe("unknown")
  })
})

describe("searchCitable", () => {
  it("finds Library pages and findings papers by title, first author or journal, the Library first, then newest", async () => {
    const all = await searchCitable(storage, "paper")
    expect(all[0]).toEqual({ slug: "paper-1", label: "Author1 2026", title: "Paper 1", venue: "Lancet Psychiatry", year: 2026, saved: true })
    expect(all.map((entry) => entry.slug)).toHaveLength(6)
    expect(all.filter((entry) => entry.saved).map((entry) => entry.slug)).toEqual(["paper-1"])
    expect((await searchCitable(storage, "author3")).map((entry) => entry.slug)).toEqual(["paper-3"])
    expect((await searchCitable(storage, "LANCET paper 4")).map((entry) => entry.slug)).toEqual(["paper-4"])
    expect(await searchCitable(storage, "nothing-like-this")).toEqual([])
  })
  it("keeps to the limit", async () => {
    expect(await searchCitable(storage, "paper", 2)).toHaveLength(2)
  })
})

describe("referencesOf", () => {
  it("gives one line per cited paper in the order cited, from the paper page, else the resolved record", async () => {
    expect(await referencesOf(storage, ["paper-2", "paper-1", "no-such-paper"])).toEqual([
      { slug: "paper-2", text: "Ada Author2. Paper 2. Lancet Psychiatry. 2026." },
      { slug: "paper-1", text: "Ada Author1, Bo Second. Paper 1. Lancet Psychiatry. 2026. doi:10.1000/one" },
    ])
  })
})
