// src/lib/clinical/notes/client.ts
import { readErrorMessage } from "../../http"
import { CLINICAL_COPY } from "../copy"
import type { CitablePaper, NewPaper, NoteAbout, NoteConflict, NoteDetail, NoteKind, NoteReference, NoteSaved, NoteSummary } from "./links"

// Browser-side callers of /api/clinical/notes. Types only from ./links; the pack and the vault stay on the server.

const URL = "/api/clinical/notes"
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await readErrorMessage(res, CLINICAL_COPY.notes.requestFailed(res.status)))
  return ((await res.json()) as { result: T }).result
}
const json = (method: "POST" | "PUT", body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

export interface NoteListFilters { q?: string; condition?: string; kind?: NoteKind; paper?: string; treatment?: string }
/** One note as the route gives it: with the papers listed since it was edited and the references of the papers it cites. */
export type NoteAnswer = NoteDetail & { newPapers: NewPaper[]; references: NoteReference[] }

/** The notes of the Library, last edited first. A filter that is empty is left out. */
export async function listNotesRemote(filters: NoteListFilters = {}, fetchFn: typeof fetch = fetch): Promise<NoteSummary[]> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (typeof value === "string" && value.trim() !== "") query.set(key, value)
  const text = query.toString()
  return (await unwrap<{ notes: NoteSummary[] }>(await fetchFn(text ? `${URL}?${text}` : URL, { method: "GET" }))).notes
}

/** One note, or null when the Library has no note of that id. */
export async function readNoteRemote(id: string, fetchFn: typeof fetch = fetch): Promise<NoteAnswer | null> {
  const res = await fetchFn(`${URL}?id=${encodeURIComponent(id)}`, { method: "GET" })
  return res.status === 404 ? null : unwrap<NoteAnswer>(res)
}

/** Makes a note and gives its id. */
export async function createNoteRemote(input: { title?: string; body?: string; about?: NoteAbout } = {}, fetchFn: typeof fetch = fetch): Promise<string> {
  return (await unwrap<{ id: string }>(await fetchFn(URL, json("POST", input)))).id
}

/** Saves a note. A note that changed since `revision` was read comes back as a value, the stored version in it, not as an error. */
export async function saveNoteRemote(
  input: { id: string; title: string; body: string; revision: string }, fetchFn: typeof fetch = fetch, opts: { keepalive?: boolean } = {},
): Promise<NoteSaved | NoteConflict> {
  // `keepalive` lets the request outlive the page that sent it: the save of a reader who is leaving.
  const res = await fetchFn(URL, opts.keepalive ? { ...json("PUT", input), keepalive: true } : json("PUT", input))
  if (res.status === 409) {
    const stored = ((await res.json()) as { conflict?: Omit<NoteConflict, "conflict"> }).conflict
    if (stored) return { conflict: true, title: stored.title, body: stored.body, revision: stored.revision }
    throw new Error(CLINICAL_COPY.notes.conflict)
  }
  return unwrap<NoteSaved>(res)
}

/** The papers that can be cited for a query: the Library's first. */
export async function searchCitableRemote(q: string, fetchFn: typeof fetch = fetch): Promise<CitablePaper[]> {
  return (await unwrap<{ papers: CitablePaper[] }>(await fetchFn(`${URL}?cite=${encodeURIComponent(q)}`, { method: "GET" }))).papers
}
