import { z } from "zod"
import { getServerVault } from "@/lib/server/vault"
import { loadPsychiatryPack } from "@/lib/clinical/pack/load"
import { CODE_RE, NOTE_KINDS, REVISION_RE, type NoteKind } from "@/lib/clinical/notes/links"
import {
  NoteInputError, NoteNotFoundError, createNote, isNoteId, isPaperSlug, listNotes, newPapersFor, readNote, referencesOf, saveNote, searchCitable,
} from "@/lib/clinical/notes/store"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const N = CLINICAL_COPY.notes
const BODY_MAX = 200_000
const fail = (status: number, error: unknown) => Response.json({ error: error instanceof Error ? error.message : String(error) }, { status })
const ok = (result: unknown) => Response.json({ result }, { status: 200 })
/** What a failed call answers: 400 for something asked that is not known, 404 for a note that is not there, else 500. */
const failed = (error: unknown) => fail(error instanceof NoteInputError ? 400 : error instanceof NoteNotFoundError ? 404 : 500, error)

const code = z.string().regex(CODE_RE)
const CreateSchema = z.object({
  title: z.string().max(500).optional(),
  body: z.string().max(BODY_MAX).optional(),
  about: z.object({
    paper: z.string().refine(isPaperSlug).optional(),
    condition: code.optional(),
    treatment: z.object({ condition: code, key: code }).optional(),
  }).optional(),
})
const SaveSchema = z.object({ id: z.string().refine(isNoteId), title: z.string().max(500), body: z.string().max(BODY_MAX), revision: z.string().regex(REVISION_RE) })

/** What was sent, checked: the data, `long` for a text over the limit (it has its own answer), or null. */
async function input<T>(request: Request, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): Promise<T | "long" | null> {
  try {
    const sent: unknown = await request.json()
    const text = typeof sent === "object" && sent !== null ? (sent as { body?: unknown }).body : undefined
    if (typeof text === "string" && text.length > BODY_MAX) return "long"
    const parsed = schema.safeParse(sent)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * GET: the notes of the Library, last edited first, filtered by `q`, `condition`, `kind`, `paper` and `treatment`.
 * GET ?id=: one note with its body, its revision, the papers listed since it was edited and its references.
 * GET ?cite=: the papers that can be cited for that query. Nothing is written and no model is called by any of them.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const id = params.get("id")
  const cite = params.get("cite")
  const condition = params.get("condition") ?? undefined
  const treatment = params.get("treatment") ?? undefined
  const kind = params.get("kind") ?? undefined
  const paper = params.get("paper") ?? undefined
  if (id !== null && !isNoteId(id)) return fail(400, N.badRequest)
  if ((condition !== undefined && !CODE_RE.test(condition)) || (treatment !== undefined && !CODE_RE.test(treatment))) return fail(400, N.badRequest)
  if (kind !== undefined && !(NOTE_KINDS as readonly string[]).includes(kind)) return fail(400, N.badRequest)
  if (paper !== undefined && !isPaperSlug(paper)) return fail(400, N.badRequest)
  try {
    const vault = await getServerVault()
    if (cite !== null) return ok({ papers: await searchCitable(vault, cite) })
    const { taxonomy } = await loadPsychiatryPack()
    const now = new Date()
    if (id !== null) {
      const note = await readNote(vault, taxonomy, id, now)
      if (!note) return fail(404, N.notFound)
      const [newPapers, references] = await Promise.all([newPapersFor(vault, taxonomy, id, now), referencesOf(vault, note.summary.links.papers)])
      return ok({ ...note, newPapers, references })
    }
    return ok({ notes: await listNotes(vault, taxonomy, { q: params.get("q") ?? undefined, condition, kind: kind as NoteKind | undefined, paper, treatment, now }) })
  } catch (error) {
    return failed(error)
  }
}

/** POST { title?, body?, about?: { paper?, condition?, treatment?: { condition, key } } }: makes a note and answers its id. */
export async function POST(request: Request): Promise<Response> {
  const data = await input(request, CreateSchema)
  if (data === "long") return fail(413, N.tooLong)
  if (!data) return fail(400, N.badRequest)
  try {
    const vault = await getServerVault()
    const { taxonomy } = await loadPsychiatryPack()
    return ok({ id: await createNote(vault, taxonomy, { ...data, now: new Date() }) })
  } catch (error) {
    return failed(error)
  }
}

/**
 * PUT { id, title, body, revision }: saves a note and answers the new revision, the cited papers it put in the Library
 * and those no source knows. 409 with the stored title (and whether it is one), body and revision when the note
 * changed since `revision` was read; nothing is written then. 413 for a text over the limit.
 */
export async function PUT(request: Request): Promise<Response> {
  const data = await input(request, SaveSchema)
  if (data === "long") return fail(413, N.tooLong)
  if (!data) return fail(400, N.badRequest)
  try {
    const vault = await getServerVault()
    const { taxonomy } = await loadPsychiatryPack()
    const result = await saveNote(vault, taxonomy, data.id, { title: data.title, body: data.body, revision: data.revision, now: new Date() })
    if ("conflict" in result) return Response.json({ error: N.conflict, conflict: { title: result.title, untitled: result.untitled, body: result.body, revision: result.revision } }, { status: 409 })
    return ok(result)
  } catch (error) {
    return failed(error)
  }
}
