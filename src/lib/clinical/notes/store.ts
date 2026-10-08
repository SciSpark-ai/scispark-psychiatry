// src/lib/clinical/notes/store.ts
import type { VaultStorage } from "../../vault/storage"
import type { Frontmatter } from "../../vault/types"
import { asStringArray, parseDocument, serializeDocument } from "../../vault/frontmatter"
import { ChangesetConflictError, makeChangesetId } from "../../vault/changesets"
import { commitChangeset } from "../../vault/mutations"
import { findWikilinkMatches } from "../../vault/wikilinks"
import { loadRouting } from "../../wiki/schema-routing"
import { slugifyTitle } from "../../wiki/authoring"
import { buildSaveStubChangeset } from "../../papers/save"
import { paperRecordFromFrontmatter, resolvePaperBySlug } from "../../papers/resolve"
import type { PaperRecord } from "../../papers/types"
import { CLINICAL_COPY } from "../copy"
import { readFindings } from "../evidence/file"
import type { Finding } from "../evidence/schema"
import type { Taxonomy, TaxonomyNode } from "../pack/schema"
import { armsOf, withDescendants } from "../pack/taxonomy"
import {
  UNTITLED_STORED, conditionLink, excerptOf, noteKind, noteLinks, paperLabel, paperLink, referenceLine, revisionOf, titleOf, treatmentLink,
  type CitablePaper, type NewPaper, type NoteAbout, type NoteConflict, type NoteDetail, type NoteKind, type NoteLinks, type NoteReference, type NoteSaved, type NoteSummary,
} from "./links"

// Notes on the server. A note is a page of type `note` under the wiki's notes directory, whoever made it: this
// edition, the Library's "New note" button, a passage captured while reading, or a project. Reading never writes.
// Every write is a changeset. Nothing here calls a model or the network, and the time always comes in as `now`.

const N = CLINICAL_COPY.notes
/** What was asked cannot be done as asked: a paper, condition or treatment that is not known. */
export class NoteInputError extends Error {}
export class NoteNotFoundError extends Error {
  constructor() {
    super(N.notFound)
  }
}

const TITLE_MAX = 200
/** A name of a note or of a paper page, as one or more path segments: nothing that leaves its directory. */
const SEGMENT_RE = /^[^/\\\s.][^/\\\n]*$/
export const isNoteId = (id: string) => id.length <= 300 && id.split("/").every((part) => SEGMENT_RE.test(part) && part !== "..")
export const isPaperSlug = (slug: string) => slug.length <= 200 && SEGMENT_RE.test(slug)

const day = (date: Date) => date.toISOString().slice(0, 10)
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()
const words = (q: string | undefined) => (q ?? "").toLowerCase().split(/\s+/).filter(Boolean)
const hasAll = (wanted: string[], text: string) => {
  const lower = text.toLowerCase()
  return wanted.every((word) => lower.includes(word))
}

/** A paper as a note names it and as a reference prints it, from a paper page or from a stored record. */
interface PaperFacts { title: string; authors: string[]; venue: string | null; year: number | null; date: string | null; doi: string | null }
const factsOf = (paper: PaperRecord): PaperFacts => ({
  title: paper.title, authors: paper.authors.map((author) => author.name), venue: paper.venue ?? null, year: paper.year ?? null, date: paper.date ?? null, doi: paper.ids.doi ?? null,
})

/** What one call reads once: where notes and papers are, which pages the wiki has, and the findings. */
interface Vault {
  storage: VaultStorage
  taxonomy: Taxonomy
  noteDir: string
  paperDir: string
  /** The slugs of the Library's paper pages. */
  saved: Set<string>
  /** The file names (without `.md`) of the wiki pages that are not paper pages. */
  otherPages: Set<string>
  findings: Finding[]
  /** One finding per paper, by slug. */
  findingOf: Map<string, Finding>
  nodeOf: Map<string, TaxonomyNode>
  /** A condition's code and those of its subtypes, kept per call. */
  codesUnder: (code: string) => Set<string>
  /** A paper page's facts, read once per call; null when the paper has no page. */
  pageFacts: (slug: string) => Promise<PaperFacts | null>
}

async function openVault(storage: VaultStorage, taxonomy: Taxonomy): Promise<Vault> {
  const [routing, paths, findings] = await Promise.all([loadRouting(storage), storage.list("wiki/"), readFindings(storage)])
  const noteDir = routing.note ?? "wiki/notes"
  const paperDir = routing.paper ?? "wiki/papers"
  const saved = new Set<string>()
  const otherPages = new Set<string>()
  for (const path of paths) {
    if (!path.endsWith(".md")) continue
    if (path.startsWith(`${paperDir}/`)) saved.add(path.slice(paperDir.length + 1, -3))
    else otherPages.add(path.slice(path.lastIndexOf("/") + 1, -3))
  }
  const findingOf = new Map<string, Finding>()
  for (const finding of findings) if (!findingOf.has(finding.slug)) findingOf.set(finding.slug, finding)
  const under = new Map<string, Set<string>>()
  const facts = new Map<string, Promise<PaperFacts | null>>()
  return {
    storage, taxonomy, noteDir, paperDir, saved, otherPages, findings, findingOf,
    nodeOf: new Map(taxonomy.nodes.map((node) => [node.id, node])),
    codesUnder: (code) => {
      let held = under.get(code)
      if (!held) under.set(code, held = new Set(withDescendants(taxonomy, code).map((node) => node.id)))
      return held
    },
    pageFacts: (slug) => {
      let held = facts.get(slug)
      if (!held) facts.set(slug, held = readPaperPage(storage, paperDir, slug))
      return held
    },
  }
}

async function readPaperPage(storage: VaultStorage, paperDir: string, slug: string): Promise<PaperFacts | null> {
  const raw = await storage.read(`${paperDir}/${slug}.md`)
  if (raw === null) return null
  try {
    return factsOf(paperRecordFromFrontmatter(parseDocument(raw).frontmatter))
  } catch {
    return null
  }
}

/**
 * The paper a wiki link points to, as a slug, or null when it points to a page that is not a paper. A bare name is a
 * paper unless the wiki has a page of that name that is not one (a concept, an author): a note may link those too, and
 * they are not citations. A paper that has no page yet is still a paper: it is cited before it is saved.
 */
function paperOfLink(vault: Vault, target: string): string | null {
  const name = target.endsWith(".md") ? target.slice(0, -3) : target
  if (name.includes("/")) {
    const slug = name.startsWith(`${vault.paperDir}/`) ? name.slice(vault.paperDir.length + 1) : null
    return slug !== null && isPaperSlug(slug) ? slug : null
  }
  if (!isPaperSlug(name)) return null
  return vault.saved.has(name) || !vault.otherPages.has(name) ? name : null
}

/** A note's links with its wiki links narrowed to papers, and the label each paper link was written with. */
function linksOf(vault: Vault, body: string): { links: NoteLinks; aliases: Map<string, string> } {
  const raw = noteLinks(body)
  const papers: string[] = []
  const aliases = new Map<string, string>()
  for (const match of findWikilinkMatches(body)) {
    const slug = paperOfLink(vault, match.slug)
    if (slug === null) continue
    if (!papers.includes(slug)) papers.push(slug)
    if (match.alias && !aliases.has(slug)) aliases.set(slug, match.alias)
  }
  return { links: { ...raw, papers }, aliases }
}

/** When a note was last edited: the `edited` key this edition writes on every save, else the end of its `updated` day. */
function editTime(frontmatter: Frontmatter): number {
  const edited = frontmatter.edited
  const stamp = edited instanceof Date ? edited.getTime() : typeof edited === "string" ? Date.parse(edited) : Number.NaN
  if (Number.isFinite(stamp)) return stamp
  // An old note never shows the papers of its own day as new.
  return Date.parse(`${frontmatter.updated}T23:59:59.999Z`)
}

/**
 * The papers listed since a note was last edited, on what it links, that it does not cite. A linked treatment gives
 * the findings filed under its condition that name it as a treatment (not as what another was compared with); a
 * condition linked with no treatment of its own gives every finding filed under it. Newest first, each paper once,
 * under the first linked condition that gives it. Nothing listed after `now` counts.
 */
function newPapers(vault: Vault, links: NoteLinks, edited: number, now: Date): NewPaper[] {
  if (links.conditions.length === 0 || !Number.isFinite(edited)) return []
  const cited = new Set(links.papers)
  const found = new Map<string, { paper: NewPaper; listed: number }>()
  for (const finding of vault.findings) {
    const listed = Date.parse(finding.firstListedAt)
    if (!(listed > edited) || listed > now.getTime() || cited.has(finding.slug) || found.has(finding.slug)) continue
    const condition = links.conditions.find((code) => {
      const codes = vault.codesUnder(code)
      if (!finding.conditionCodes.some((entry) => codes.has(entry))) return false
      const treatments = links.treatments.filter((entry) => entry.condition === code)
      if (treatments.length === 0) return true
      const arms = armsOf(vault.taxonomy, finding.treatment, finding.comparator).treatments
      return treatments.some((entry) => arms.includes(entry.treatment))
    })
    if (condition === undefined) continue
    found.set(finding.slug, { listed, paper: { slug: finding.slug, label: paperLabel(factsOf(finding.paper)), headline: finding.headline, condition, firstListed: finding.firstListedAt.slice(0, 10) } })
  }
  return [...found.values()].sort((a, b) => b.listed - a.listed || a.paper.slug.localeCompare(b.paper.slug)).map((entry) => entry.paper)
}

interface Loaded { id: string; raw: string; frontmatter: Frontmatter; body: string; summary: NoteSummary; edited: number }

async function summarise(vault: Vault, id: string, raw: string, now: Date): Promise<Loaded | null> {
  let parsed: ReturnType<typeof parseDocument>
  try {
    parsed = parseDocument(raw)
  } catch {
    return null
  }
  const { frontmatter, body } = parsed
  if (frontmatter.type !== "note") return null
  const { links, aliases } = linksOf(vault, body)
  const edited = editTime(frontmatter)

  const codes = [...links.conditions]
  for (const slug of links.papers) for (const code of vault.findingOf.get(slug)?.conditionCodes ?? []) if (!codes.includes(code)) codes.push(code)
  const named = (code: string, type: TaxonomyNode["type"]) => {
    const node = vault.nodeOf.get(code)
    return node && node.type === type ? node.name : null
  }
  const papers = await Promise.all(links.papers.map(async (slug) => {
    const facts = (await vault.pageFacts(slug)) ?? (vault.findingOf.has(slug) ? factsOf((vault.findingOf.get(slug) as Finding).paper) : null)
    return { slug, label: facts ? paperLabel(facts) : aliases.get(slug) ?? slug }
  }))
  const summary: NoteSummary = {
    id, title: titleOf(frontmatter.title, body), excerpt: excerptOf(body), updated: frontmatter.updated, created: frontmatter.created,
    links, kind: noteKind(links),
    conditions: codes.flatMap((code) => { const name = named(code, "condition"); return name ? [{ code, name }] : [] }),
    papers,
    treatments: links.treatments.flatMap((entry) => { const name = named(entry.treatment, "treatment"); return name ? [{ condition: entry.condition, key: entry.treatment, name }] : [] }),
    newSince: newPapers(vault, links, edited, now).length,
    project: asStringArray(frontmatter.projects).length > 0,
  }
  return { id, raw, frontmatter, body, summary, edited }
}

async function load(vault: Vault, id: string, now: Date): Promise<Loaded | null> {
  if (!isNoteId(id)) return null
  const raw = await vault.storage.read(`${vault.noteDir}/${id}.md`)
  return raw === null ? null : summarise(vault, id, raw, now)
}

export interface NoteFilters {
  /** Every word of it is in the title or the body, in any case. */
  q?: string
  /** A condition code: the note is on it or on one of its subtypes. */
  condition?: string
  kind?: NoteKind
  /** A paper slug the note links. */
  paper?: string
  /** A treatment the note links; with `condition`, for that condition or one of its subtypes. */
  treatment?: string
  now: Date
}

/** Every note of the Library, last edited first. */
export async function listNotes(storage: VaultStorage, taxonomy: Taxonomy, filters: NoteFilters): Promise<NoteSummary[]> {
  const vault = await openVault(storage, taxonomy)
  const prefix = `${vault.noteDir}/`
  const paths = (await storage.list(prefix)).filter((path) => path.endsWith(".md"))
  const loaded = (await Promise.all(paths.map((path) => load(vault, path.slice(prefix.length, -3), filters.now)))).filter((note): note is Loaded => note !== null)
  const wanted = words(filters.q)
  const under = filters.condition ? vault.codesUnder(filters.condition) : null
  return loaded
    .filter(({ summary, body }) => {
      if (wanted.length > 0 && !hasAll(wanted, `${summary.title}\n${body}`)) return false
      if (under && !summary.conditions.some((entry) => under.has(entry.code))) return false
      if (filters.kind && summary.kind !== filters.kind) return false
      if (filters.paper && !summary.links.papers.includes(filters.paper)) return false
      if (filters.treatment && !summary.links.treatments.some((entry) => entry.treatment === filters.treatment && (!under || under.has(entry.condition)))) return false
      return true
    })
    .sort((a, b) => (Number.isFinite(b.edited) ? b.edited : 0) - (Number.isFinite(a.edited) ? a.edited : 0) || a.id.localeCompare(b.id))
    .map((note) => note.summary)
}

/** The papers `newSince` counts for one note, newest first. Nothing for a note that is not there. */
export async function newPapersFor(storage: VaultStorage, taxonomy: Taxonomy, id: string, now: Date): Promise<NewPaper[]> {
  const vault = await openVault(storage, taxonomy)
  const note = await load(vault, id, now)
  return note ? newPapers(vault, note.summary.links, note.edited, now) : []
}

/** One note with its body and the revision a save must name, or null when there is no such note. */
export async function readNote(storage: VaultStorage, taxonomy: Taxonomy, id: string, now: Date): Promise<NoteDetail | null> {
  const note = await load(await openVault(storage, taxonomy), id, now)
  return note ? { summary: note.summary, body: note.body, revision: revisionOf(note.raw) } : null
}

/**
 * Saves a paper to the Library as the Save button does (the same deterministic page, no model), when it is known
 * and has no page yet. `unknown` when no source knows a paper of that slug.
 */
export async function ensurePaperSaved(storage: VaultStorage, slug: string, now: Date): Promise<"saved" | "already" | "unknown"> {
  if (!isPaperSlug(slug)) return "unknown"
  const routing = await loadRouting(storage)
  if ((await storage.read(`${routing.paper ?? "wiki/papers"}/${slug}.md`)) !== null) return "already"
  const paper = await resolvePaperBySlug(storage, slug)
  if (!paper) return "unknown"
  const changeset = await buildSaveStubChangeset(storage, paper, day(now))
  if (!changeset) return "already"
  await commitChangeset(storage, changeset, { op: "save", summary: slug })
  return "saved"
}

export interface CreateNoteInput { title?: string; body?: string; about?: NoteAbout; now: Date }

/** Makes a note and gives its id. With `about`, its body starts with the link that says what it is about. */
export async function createNote(storage: VaultStorage, taxonomy: Taxonomy, input: CreateNoteInput): Promise<string> {
  const { now, about } = input
  const node = (id: string, type: TaxonomyNode["type"]) => taxonomy.nodes.find((entry) => entry.id === id && entry.type === type) ?? null
  // Everything is checked before anything is written.
  const condition = about?.condition ? node(about.condition, "condition") : null
  if (about?.condition && !condition) throw new NoteInputError(N.unknownCondition)
  const treatment = about?.treatment ? node(about.treatment.key, "treatment") : null
  if (about?.treatment && !treatment) throw new NoteInputError(N.unknownTreatment)
  if (about?.treatment && !node(about.treatment.condition, "condition")) throw new NoteInputError(N.unknownCondition)

  const lead: string[] = []
  if (about?.paper) {
    // The paper is saved first, so the link the note starts with leads to a page of the Library.
    if ((await ensurePaperSaved(storage, about.paper, now)) === "unknown") throw new NoteInputError(N.unknownPaper)
    const routing = await loadRouting(storage)
    const facts = await readPaperPage(storage, routing.paper ?? "wiki/papers", about.paper)
    lead.push(paperLink(about.paper, facts ? paperLabel(facts) : ""))
  }
  if (about?.treatment && treatment) lead.push(treatmentLink(about.treatment.condition, treatment.id, treatment.name))
  if (condition && about?.treatment?.condition !== condition.id) lead.push(conditionLink(condition.id, condition.name))

  const routing = await loadRouting(storage)
  const noteDir = routing.note ?? "wiki/notes"
  const taken = new Set((await storage.list(`${noteDir}/`)).map((path) => path.slice(noteDir.length + 1)))
  const changesetId = makeChangesetId()
  const title = oneLine(input.title ?? "").slice(0, TITLE_MAX)
  // Without a title: the day and four characters of the changeset's own random part.
  const base = title ? slugifyTitle(title) : `note-${day(now).replace(/-/g, "")}-${changesetId.slice(-4)}`
  let id = base
  for (let n = 2; taken.has(`${id}.md`); n++) id = `${base}-${n}`

  const text = (input.body ?? "").replace(/\r\n/g, "\n")
  const body = [lead.join(" · "), text].filter((part) => part.trim() !== "").join("\n\n")
  const frontmatter: Frontmatter = { type: "note", title: title || UNTITLED_STORED, created: day(now), updated: day(now), tags: [], related: [], sources: [], edited: now.toISOString() }
  await commitChangeset(
    storage,
    { id: changesetId, skill: "clinical-note-create", model: "none", timestamp: now.toISOString(), changes: [{ path: `${noteDir}/${id}.md`, before: null, after: serializeDocument(frontmatter, body) }] },
    { op: "clinical-note-create", summary: id },
  )
  return id
}

export interface SaveNoteInput { title: string; body: string; revision: string; now: Date }

/**
 * Saves a note's title and body. Only `title`, `updated`, `edited` and the body change: every other frontmatter key
 * stays, and the file keeps its name. When the stored text is not the one the save began from, nothing is written and
 * the stored version is given back. Every paper the body cites that has no Library page is saved; one that no source
 * knows is left as written and named in `unresolved`.
 */
export async function saveNote(storage: VaultStorage, taxonomy: Taxonomy, id: string, input: SaveNoteInput): Promise<NoteSaved | NoteConflict> {
  const vault = await openVault(storage, taxonomy)
  const note = await load(vault, id, input.now)
  if (!note) throw new NoteNotFoundError()
  const stored = (raw: string): NoteConflict => {
    const { frontmatter, body } = parseDocument(raw)
    return { conflict: true, title: frontmatter.title, body, revision: revisionOf(raw) }
  }
  if (revisionOf(note.raw) !== input.revision) return stored(note.raw)

  const body = input.body.replace(/\r\n/g, "\n")
  const title = oneLine(input.title).slice(0, TITLE_MAX)
  const frontmatter: Frontmatter = { ...note.frontmatter, title: title || UNTITLED_STORED, updated: day(input.now), edited: input.now.toISOString() }
  const after = serializeDocument(frontmatter, body)
  const path = `${vault.noteDir}/${id}.md`
  if (after !== note.raw) {
    try {
      await commitChangeset(
        storage,
        { id: makeChangesetId(), skill: "clinical-note-save", model: "none", timestamp: input.now.toISOString(), changes: [{ path, before: note.raw, after }] },
        { op: "clinical-note-save", summary: id },
      )
    } catch (error) {
      // The file changed between the read above and the write: the same answer as a stale revision.
      if (!(error instanceof ChangesetConflictError)) throw error
      const raw = await storage.read(path)
      if (raw === null) throw new NoteNotFoundError()
      return stored(raw)
    }
  }
  const unresolved: string[] = []
  for (const slug of linksOf(vault, body).links.papers) {
    if (vault.saved.has(slug)) continue
    if ((await ensurePaperSaved(storage, slug, input.now)) === "unknown") unresolved.push(slug)
  }
  return { revision: revisionOf(after), unresolved }
}

/**
 * The papers that can be cited for a query: the Library's paper pages and the papers of the findings store whose
 * title, first author or journal hold every word of it. The Library first, then the newest.
 */
export async function searchCitable(storage: VaultStorage, q: string, limit = 12): Promise<CitablePaper[]> {
  const routing = await loadRouting(storage)
  const paperDir = routing.paper ?? "wiki/papers"
  const wanted = words(q)
  const matches = (facts: PaperFacts) => hasAll(wanted, [facts.title, facts.authors[0] ?? "", facts.venue ?? ""].join("\n"))
  const entry = (slug: string, facts: PaperFacts, saved: boolean) => ({ slug, label: paperLabel(facts), title: facts.title, venue: facts.venue, year: facts.year, saved, when: facts.date ?? (facts.year ? String(facts.year) : "") })
  const found = new Map<string, ReturnType<typeof entry>>()
  const slugs = (await storage.list(`${paperDir}/`)).filter((path) => path.endsWith(".md")).map((path) => path.slice(paperDir.length + 1, -3))
  for (const slug of slugs) {
    const facts = await readPaperPage(storage, paperDir, slug)
    if (facts && matches(facts)) found.set(slug, entry(slug, facts, true))
  }
  for (const finding of await readFindings(storage)) {
    if (found.has(finding.slug) || slugs.includes(finding.slug)) continue
    const facts = factsOf(finding.paper)
    if (matches(facts)) found.set(finding.slug, entry(finding.slug, facts, false))
  }
  return [...found.values()]
    .sort((a, b) => Number(b.saved) - Number(a.saved) || b.when.localeCompare(a.when) || a.title.localeCompare(b.title))
    .slice(0, Math.max(0, limit))
    .map(({ slug, label, title, venue, year, saved }) => ({ slug, label, title, venue, year, saved }))
}

/**
 * One reference per cited paper, in the order cited: from the paper's page in the Library, else from the record a
 * source still holds. A slug that is no paper anywhere gives no line.
 */
export async function referencesOf(storage: VaultStorage, slugs: string[]): Promise<NoteReference[]> {
  const routing = await loadRouting(storage)
  const paperDir = routing.paper ?? "wiki/papers"
  const out: NoteReference[] = []
  for (const slug of slugs) {
    if (!isPaperSlug(slug) || out.some((entry) => entry.slug === slug)) continue
    const page = await readPaperPage(storage, paperDir, slug)
    const resolved = page ? null : await resolvePaperBySlug(storage, slug)
    const facts = page ?? (resolved ? factsOf(resolved) : null)
    if (facts) out.push({ slug, text: referenceLine(facts) })
  }
  return out
}
