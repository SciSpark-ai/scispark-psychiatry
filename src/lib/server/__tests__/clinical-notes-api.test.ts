import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { parseDocument } from "../../vault/frontmatter"
import { setServerVaultForTests } from "../vault"
import * as route from "../../../app/api/clinical/notes/route"
import { FINDINGS_PATH } from "../../clinical/evidence/file"
import { CLINICAL_COPY } from "../../clinical/copy"
import { revisionOf } from "../../clinical/notes/links"
import { paper } from "../../clinical/__tests__/helpers"

const finding = (n: number, conditionCodes: string[], firstListedAt: string) => ({
  key: `pmid:${n}`, slug: `paper-${n}`, paper: paper({ title: `Paper ${n}`, ids: { pmid: String(n) }, date: "2026-09-20", year: 2026, venue: "Lancet Psychiatry", authors: [{ name: `Ada Author${n}` }] }),
  headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, design: "randomized-trial", designSource: "publication-type", journalBand: null,
  conditionCodes, kind: "benefit", treatment: "esketamine", treatmentCode: "esketamine", treatmentClass: null, researchType: null, sampleSize: null, text: "reduced symptoms", population: null, comparator: null, outcome: null,
  firstListedAt, lastListedAt: firstListedAt,
})
const NOTE = "---\ntype: note\ntitle: Esketamine in TRD\ncreated: 2026-09-01\nupdated: 2026-09-05\ntags: []\nrelated: []\nsources: []\nedited: 2026-09-05T09:00:00.000Z\n---\n\n[Esketamine](/wiki?condition=treatment-resistant-depression&treatment=esketamine)\n\nSee [[paper-1|Author1 2026]].\n"
const OLD = "---\ntype: note\ntitle: Untitled note\ncreated: 2026-08-01\nupdated: 2026-08-01\ntags: []\nrelated: []\nsources: []\n---\n\nAn older thought.\n"

const url = "http://x/api/clinical/notes"
const get = (query = "") => route.GET(new Request(`${url}${query}`))
const send = (method: "POST" | "PUT", body: unknown) => route[method](new Request(url, { method, body: typeof body === "string" ? body : JSON.stringify(body) }))

let storage: MemoryVaultStorage
beforeEach(async () => {
  storage = new MemoryVaultStorage()
  setServerVaultForTests(storage)
  await storage.write("wiki/notes/esketamine-in-trd.md", NOTE)
  await storage.write("wiki/notes/note-1754000000000.md", OLD)
  await storage.write(FINDINGS_PATH, JSON.stringify({ version: 2, findings: {
    "pmid:1": finding(1, ["treatment-resistant-depression"], "2026-09-02T08:00:00.000Z"),
    "pmid:2": finding(2, ["treatment-resistant-depression"], "2026-09-20T08:00:00.000Z"),
  } }))
})
afterEach(() => setServerVaultForTests(null))

describe("/api/clinical/notes", () => {
  it("lists the notes, newest edit first, and passes the filters through", async () => {
    const all = await get()
    expect(all.status).toBe(200)
    const { result } = await all.json()
    expect(result.notes.map((note: { id: string }) => note.id)).toEqual(["esketamine-in-trd", "note-1754000000000"])
    expect(result.notes[0]).toMatchObject({ title: "Esketamine in TRD", kind: "topic", newSince: 1, conditions: [{ code: "treatment-resistant-depression", name: "Treatment-resistant depression" }] })
    const filtered = async (query: string) => (await (await get(query)).json()).result.notes.map((note: { id: string }) => note.id)
    expect(await filtered("?condition=depression")).toEqual(["esketamine-in-trd"])
    expect(await filtered("?kind=none")).toEqual(["note-1754000000000"])
    expect(await filtered("?q=older")).toEqual(["note-1754000000000"])
    expect(await filtered("?paper=paper-1")).toEqual(["esketamine-in-trd"])
    expect(await filtered("?condition=depression&treatment=esketamine&q=see")).toEqual(["esketamine-in-trd"])
    expect(await filtered("?condition=schizophrenia")).toEqual([])
  })
  it("gives one note with its body, revision, new papers and references", async () => {
    const { result } = await (await get("?id=esketamine-in-trd")).json()
    expect(result.summary.id).toBe("esketamine-in-trd")
    expect(result.body).toBe(parseDocument(NOTE).body)
    expect(result.revision).toBe(revisionOf(NOTE))
    expect(result.newPapers).toEqual([{ slug: "paper-2", label: "Author2 2026", headline: "Headline 2", condition: "treatment-resistant-depression", firstListed: "2026-09-20" }])
    expect(result.references).toEqual([{ slug: "paper-1", text: "Ada Author1. Paper 1. Lancet Psychiatry. 2026." }])
    expect(await storage.read("wiki/notes/esketamine-in-trd.md")).toBe(NOTE)
  })
  it("answers 404 for a note that is not there", async () => {
    const res = await get("?id=nope")
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe(CLINICAL_COPY.notes.notFound)
  })
  it("searches the papers that can be cited", async () => {
    const { result } = await (await get("?cite=author2")).json()
    expect(result.papers).toEqual([{ slug: "paper-2", label: "Author2 2026", title: "Paper 2", venue: "Lancet Psychiatry", year: 2026, saved: false }])
  })
  it("creates a note, about something when asked", async () => {
    const res = await send("POST", { title: "A new note", body: "Text.", about: { condition: "schizophrenia" } })
    expect(res.status).toBe(200)
    expect((await res.json()).result).toEqual({ id: "a-new-note" })
    expect(parseDocument(await storage.read("wiki/notes/a-new-note.md") as string).body).toBe("[Schizophrenia](/wiki?condition=schizophrenia)\n\nText.\n")
    const bare = await (await send("POST", {})).json()
    expect(bare.result.id).toMatch(/^note-\d{8}-[a-z0-9]{4}$/)
  })
  it("saves a note and gives the new revision", async () => {
    const res = await send("PUT", { id: "esketamine-in-trd", title: "Esketamine in TRD", body: "Rewritten, citing [[paper-2]] and [[made-up]].", revision: revisionOf(NOTE) })
    expect(res.status).toBe(200)
    const raw = await storage.read("wiki/notes/esketamine-in-trd.md") as string
    expect((await res.json()).result).toEqual({ revision: revisionOf(raw), unresolved: ["made-up"] })
    expect(parseDocument(raw).body).toBe("Rewritten, citing [[paper-2]] and [[made-up]].\n")
    expect(await storage.read("wiki/papers/paper-2.md")).not.toBeNull()
  })
  it("answers 409 with the stored version when the note changed since it was read", async () => {
    const res = await send("PUT", { id: "esketamine-in-trd", title: "Mine", body: "Mine.", revision: revisionOf("stale") })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: CLINICAL_COPY.notes.conflict, conflict: { title: "Esketamine in TRD", body: parseDocument(NOTE).body, revision: revisionOf(NOTE) } })
    expect(await storage.read("wiki/notes/esketamine-in-trd.md")).toBe(NOTE)
  })
  it("answers 404 when the note to save is not there", async () => {
    expect((await send("PUT", { id: "nope", title: "x", body: "x", revision: revisionOf("x") })).status).toBe(404)
  })
  it("answers 400, in the copy's words, for a treatment or a condition the pack lacks", async () => {
    const lacking = await send("POST", { about: { treatment: { condition: "depression", key: "no-such-treatment" } } })
    expect([lacking.status, (await lacking.json()).error]).toEqual([400, CLINICAL_COPY.notes.unknownTreatment])
    const wrong = await send("POST", { about: { treatment: { condition: "esketamine", key: "esketamine" } } })
    expect([wrong.status, (await wrong.json()).error]).toEqual([400, CLINICAL_COPY.notes.unknownCondition])
  })
  it("creates two notes of one title asked for at once", async () => {
    const answers = await Promise.all([send("POST", { title: "Twice" }), send("POST", { title: "Twice" })])
    expect(answers.map((res) => res.status)).toEqual([200, 200])
    expect((await Promise.all(answers.map(async (res) => (await res.json()).result.id))).sort()).toEqual(["twice", "twice-2"])
  })
  it("answers 400 for input it does not understand", async () => {
    for (const query of ["?kind=essay", "?condition=../etc", "?treatment=Bad%20Key", "?id=../papers/x", "?paper=a/b"]) expect((await get(query)).status, query).toBe(400)
    expect((await send("POST", "not json")).status).toBe(400)
    expect((await send("POST", { title: 5 })).status).toBe(400)
    expect((await send("POST", { about: { condition: "no-such-condition" } })).status).toBe(400)
    expect((await send("POST", { about: { paper: "no-such-paper" } })).status).toBe(400)
    expect((await send("PUT", { id: "esketamine-in-trd", title: "x", body: "x" })).status).toBe(400)
    expect((await send("PUT", { id: "../x", title: "x", body: "x", revision: revisionOf("x") })).status).toBe(400)
    const res = await send("PUT", "{")
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(CLINICAL_COPY.notes.badRequest)
  })
})
