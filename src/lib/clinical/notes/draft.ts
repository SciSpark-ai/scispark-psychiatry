// src/lib/clinical/notes/draft.ts
// The text of a note that has not reached the server, kept by the browser for as long as its tab lives: what was typed
// outlives a reload, a closed lid and a save that failed. Browser only; every call is safe where there is no storage.

/** What was typed, and the revision of the stored note it was typed over. */
export interface NoteDraft { title: string; body: string; revision: string }

const key = (id: string) => `scispark:note-draft:${id}`
const store = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage
  } catch {
    return null
  }
}

/** The draft kept for a note, or null: none, one that does not read as a draft, or a browser that will not say. */
export function readDraft(id: string): NoteDraft | null {
  try {
    const raw = store()?.getItem(key(id))
    if (!raw) return null
    const held = JSON.parse(raw) as Partial<NoteDraft> | null
    if (!held || typeof held.title !== "string" || typeof held.body !== "string" || typeof held.revision !== "string") return null
    return { title: held.title, body: held.body, revision: held.revision }
  } catch {
    return null
  }
}

/** Keeps a draft. A browser that refuses (no room, storage blocked) is not an error: the note is still on the page. */
export function writeDraft(id: string, draft: NoteDraft): void {
  try {
    store()?.setItem(key(id), JSON.stringify({ title: draft.title, body: draft.body, revision: draft.revision }))
  } catch {
    // Nothing to do: the draft is a second copy.
  }
}

export function clearDraft(id: string): void {
  try {
    store()?.removeItem(key(id))
  } catch {
    // As above.
  }
}
