// Clinical edition (not an upstream file): a conversation about one of the reader's notes.
// Server only: it reads the vault and the pack from disk. A client component never imports this; the browser sends
// just the note's id and reads the captured context back from the saved session.
import type { VaultStorage } from "../vault/storage"
import { loadBundle } from "../vault/bundle"
import { findPaperPage } from "../papers/page-state"
import { extractAbstractFromBody, resolvePaperBySlug } from "../papers/resolve"
import { readFindings } from "../clinical/evidence/file"
import { loadPsychiatryPack } from "../clinical/pack/load"
import type { Taxonomy } from "../clinical/pack/schema"
import { CLINICAL_COPY } from "../clinical/copy"
import { cut } from "../clinical/notes/links"
import { isNoteId, readNote } from "../clinical/notes/store"
import {
  NOTE_CHAT_ABSTRACT_MAX, NOTE_CHAT_BODY_MAX, NOTE_CHAT_MAX_PAPERS, NOTE_CHAT_SUMMARY_MAX, NOTE_CHAT_TITLE_MAX,
  NoteChatContextSchema, type NoteChatContext, type NoteChatPaper,
} from "../clinical/notes/chat-context"

export { isNoteId }
export type { NoteChatContext }

const SHORTENED = "\n[Note shortened; its later text is not supplied.]"
const noteBody = (body: string) => (body.length > NOTE_CHAT_BODY_MAX ? body.slice(0, NOTE_CHAT_BODY_MAX - SHORTENED.length) + SHORTENED : body)
const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined)

/**
 * The note as stored now and, for each paper it cites that has a page in the Library (the first 12), the paper's
 * title, its AI summary (the findings store's headline and takeaway, else the page's own) and its abstract (the
 * page's, else the one the finding's or a source's record still holds), cut at 2,500 characters. A piece that is not there is left
 * out; a paper with no page is skipped. Reads only: nothing is fetched, generated or written.
 */
export async function captureNoteContext(storage: VaultStorage, taxonomy: Taxonomy, id: string, now: Date): Promise<NoteChatContext> {
  const note = isNoteId(id) ? await readNote(storage, taxonomy, id, now) : null
  if (!note) throw new Error(CLINICAL_COPY.notes.notFound)
  const papers: NoteChatPaper[] = []
  if (note.summary.papers.length > 0) {
    const [bundle, findings] = await Promise.all([loadBundle(storage), readFindings(storage)])
    for (const { slug, label } of note.summary.papers) {
      if (papers.length === NOTE_CHAT_MAX_PAPERS) break
      const page = findPaperPage(bundle, slug)
      if (!page) continue
      const finding = findings.find((entry) => entry.slug === slug)
      const summary = text(finding ? `${finding.headline} ${finding.takeaway}` : page.frontmatter.tldr)
      // A saved page resolves to itself first, so the finding's own record is asked before the general resolver.
      const abstract = text(extractAbstractFromBody(page.body)) ?? text(finding?.paper.abstract) ?? text((await resolvePaperBySlug(storage, slug))?.abstract)
      papers.push({
        slug, label: cut(label, NOTE_CHAT_TITLE_MAX), title: cut(page.frontmatter.title, NOTE_CHAT_TITLE_MAX),
        ...(summary ? { summary: cut(summary, NOTE_CHAT_SUMMARY_MAX) } : {}),
        ...(abstract ? { abstract: cut(abstract, NOTE_CHAT_ABSTRACT_MAX) } : {}),
      })
    }
  }
  return NoteChatContextSchema.parse({ id, title: cut(note.summary.title, NOTE_CHAT_TITLE_MAX), body: noteBody(note.body), papers })
}

/** `captureNoteContext` with the pack this edition ships. */
export async function captureNoteContextForChat(storage: VaultStorage, id: string, now: Date): Promise<NoteChatContext> {
  return captureNoteContext(storage, (await loadPsychiatryPack()).taxonomy, id, now)
}

/**
 * What the model is given in place of a selection from the knowledge base: the note, then each paper under its slug
 * (the id an answer cites). With `readSourcesOnly` the AI summaries are left out, as a paper's digest is.
 */
export function renderNoteContext(context: NoteChatContext, readSourcesOnly: boolean): string {
  const papers = context.papers.map((paper) => [
    `### ${paper.slug}`,
    `Title: ${paper.title}`,
    `Cited in the note as: ${paper.label}`,
    ...(!readSourcesOnly && paper.summary ? [`AI-generated summary (secondary; check claims against the abstract): ${paper.summary}`] : []),
    `Abstract (source text; the full text is not supplied):\n${paper.abstract ?? "No abstract is stored for this paper."}`,
  ].join("\n"))
  return [
    `This conversation is about one note the user wrote, and the papers that note cites. By default "this", "my note" and "the note" mean this note. The note is the user's own writing, not source evidence; the papers' abstracts are the evidence.`,
    `### note\nTitle: ${context.title}\n\n${context.body.trim() || "(the note has no text)"}`,
    papers.length > 0
      ? `Papers the note cites (${papers.length}):\n\n${papers.join("\n\n---\n\n")}`
      : "The note cites no paper that is saved in the Library, so there is no paper text to answer from.",
  ].join("\n\n---\n\n")
}
