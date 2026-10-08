import { wikiHref } from "../../wiki/href"
import { NOTE_KINDS, type NoteKind } from "./links"

// The addresses of the Library view and of a note. Pure text; a page can use it.

export const LIBRARY_TABS = ["papers", "notes", "projects", "chats"] as const
export type LibraryTab = (typeof LIBRARY_TABS)[number]

/** What the Notes tab keeps in the address. `treatment` is the pack's id of a treatment. */
export interface NotesAddress { q?: string; condition?: string; kind?: NoteKind; treatment?: string }

/** The tab an address names; Papers when it names none or one that is not a tab. */
export function libraryTabOf(value: string | null): LibraryTab {
  return (LIBRARY_TABS as readonly string[]).includes(value ?? "") ? (value as LibraryTab) : "papers"
}

/** The kind of note an address names, or undefined for all kinds. */
export function noteKindOf(value: string | null): NoteKind | undefined {
  return (NOTE_KINDS as readonly string[]).includes(value ?? "") ? (value as NoteKind) : undefined
}

/**
 * `/wiki?view=all` on one tab. Papers is the default and is left out; the filters of the notes are written for the
 * Notes tab only, each only when it is set.
 */
export function libraryHref(tab: LibraryTab = "papers", notes: NotesAddress = {}): string {
  const query = new URLSearchParams({ view: "all" })
  if (tab !== "papers") query.set("tab", tab)
  if (tab === "notes") {
    if (notes.q?.trim()) query.set("q", notes.q.trim())
    if (notes.condition) query.set("condition", notes.condition)
    if (notes.treatment) query.set("treatment", notes.treatment)
    if (notes.kind) query.set("kind", notes.kind)
  }
  return `/wiki?${query.toString()}`
}

/** The directory the wiki keeps its notes in, unless the vault's routing says another. */
const NOTES_DIR = "wiki/notes"

/** The page of a note: its wiki address. `id` is the note's id as the notes route gives it. */
export function noteHref(id: string): string {
  return wikiHref(`${NOTES_DIR}/${id}`)
}
