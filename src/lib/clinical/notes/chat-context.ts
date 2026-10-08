import { z } from "zod"

// What a conversation about a note keeps: the note and the papers it cites, as they were when the conversation
// started. Pure: the chat session file is checked against this in the browser too.

/** At most this many cited papers travel with the conversation. */
export const NOTE_CHAT_MAX_PAPERS = 12
/** A paper's abstract is cut at this length. */
export const NOTE_CHAT_ABSTRACT_MAX = 2_500
/** The note's own text is cut at this length. */
export const NOTE_CHAT_BODY_MAX = 16_000
export const NOTE_CHAT_SUMMARY_MAX = 2_000
export const NOTE_CHAT_TITLE_MAX = 500

export const NoteChatPaperSchema = z.object({
  slug: z.string().min(1).max(200),
  /** The short name the note shows for the paper, e.g. "Author 2026". */
  label: z.string().max(NOTE_CHAT_TITLE_MAX),
  title: z.string().max(NOTE_CHAT_TITLE_MAX),
  /** The AI summary, when the findings store or the paper's page has one. */
  summary: z.string().max(NOTE_CHAT_SUMMARY_MAX).optional(),
  abstract: z.string().max(NOTE_CHAT_ABSTRACT_MAX).optional(),
})
export type NoteChatPaper = z.infer<typeof NoteChatPaperSchema>

export const NoteChatContextSchema = z.object({
  id: z.string().min(1).max(300),
  title: z.string().max(NOTE_CHAT_TITLE_MAX),
  body: z.string().max(NOTE_CHAT_BODY_MAX),
  papers: z.array(NoteChatPaperSchema).max(NOTE_CHAT_MAX_PAPERS),
})
export type NoteChatContext = z.infer<typeof NoteChatContextSchema>
