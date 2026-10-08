import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { MockProvider } from "../../llm/mock-provider"
import type { LLMResult } from "../../llm/types"
import { FINDINGS_PATH } from "../../clinical/evidence/file"
import { loadPsychiatryPack } from "../../clinical/pack/load"
import type { Taxonomy } from "../../clinical/pack/schema"
import { CLINICAL_COPY } from "../../clinical/copy"
import { paper } from "../../clinical/__tests__/helpers"
import { askChat, ChatScopeError, parseAskChatInput } from "../orchestrator"
import { loadSession, saveSession, type ChatSession } from "../session"
import { captureNoteContext, renderNoteContext } from "../note-context"

const NOW = new Date("2026-10-07T12:00:00.000Z")
const settings = { keys: { openai: "fixture" }, tierModels: { fast: { provider: "openai", model: "m" }, strong: { provider: "openai", model: "m" } }, dailyBudgetUsd: 100, baseUrls: { openai: "https://fixture.invalid/v1" } } as const

const finding = (n: number, extra: Record<string, unknown> = {}) => ({
  key: `pmid:${n}`, slug: `paper-${n}`,
  paper: paper({ title: `Paper ${n}`, ids: { pmid: String(n) }, date: "2026-09-20", year: 2026, venue: "Lancet Psychiatry", authors: [{ name: `Ada Author${n}` }] }),
  headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, design: "randomized-trial", designSource: "publication-type", journalBand: null,
  conditionCodes: ["treatment-resistant-depression"], kind: "benefit", treatment: "esketamine", treatmentCode: null, treatmentClass: null, researchType: null, sampleSize: null,
  text: "reduced symptoms", population: null, comparator: null, outcome: null,
  firstListedAt: "2026-09-21T08:00:00.000Z", lastListedAt: "2026-09-21T08:00:00.000Z", ...extra,
})
const page = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n\n${body}`
const paperPage = (n: number, opts: { tldr?: string; abstract?: string } = {}) => page(
  `type: paper\ntitle: Paper ${n}\ncreated: 2026-09-21\nupdated: 2026-09-21\ntags: []\nrelated: []\nsources: []\nauthors:\n  - Ada Author${n}\nprojects: []\npmid: "${n}"\nyear: 2026\nvenue: Lancet Psychiatry\nstatus: saved${opts.tldr ? `\ntldr: ${opts.tldr}` : ""}`,
  `# Paper ${n}\n${opts.abstract ? `\n## Abstract\n\n${opts.abstract}\n\n## Links\n\n- none\n` : ""}`,
)
const note = (title: string, body: string) => page(`type: note\ntitle: ${title}\ncreated: 2026-10-01\nupdated: 2026-10-05\ntags: []\nrelated: []\nsources: []\nedited: 2026-10-05T09:00:00.000Z`, body)

const NOTE_ID = "esketamine-in-trd"
const NOTE_BODY = "[Esketamine](/wiki?condition=treatment-resistant-depression&treatment=esketamine)\n\nNOTE-MARKER works fast, see [[paper-1|Author1 2026]], [[paper-2]], [[nowhere-paper]], [[paper-7]], [[paper-8]] and [[paper-9]].\n"

let taxonomy: Taxonomy
let storage: MemoryVaultStorage
beforeAll(async () => { taxonomy = (await loadPsychiatryPack()).taxonomy })
beforeEach(async () => {
  storage = new MemoryVaultStorage()
  await storage.write(`wiki/notes/${NOTE_ID}.md`, note("Esketamine in TRD", NOTE_BODY))
  // paper-1: a page with a summary of its own and an abstract, and a finding. paper-2: a finding only (not saved).
  // paper-7: a page with a summary and no abstract anywhere. paper-8: a page with a long abstract and no summary.
  // paper-9: a page without an abstract whose record (in the findings store) has one.
  await storage.write("wiki/papers/paper-1.md", paperPage(1, { tldr: "PAGE-TLDR-1", abstract: "ABSTRACT-1 of the first paper." }))
  await storage.write("wiki/papers/paper-7.md", paperPage(7, { tldr: "PAGE-TLDR-7" }))
  await storage.write("wiki/papers/paper-8.md", paperPage(8, { abstract: `START ${"a ".repeat(2000)}UNSUPPLIED-END` }))
  await storage.write("wiki/papers/paper-9.md", paperPage(9))
  await storage.write("wiki/concepts/unrelated.md", page("type: concept\ntitle: Unrelated\ncreated: 2026-09-01\nupdated: 2026-09-01\ntags: []\nrelated: []\nsources: []", "UNRELATED-PRIVATE-MARKER\n"))
  const nine = finding(9)
  await storage.write(FINDINGS_PATH, JSON.stringify({ version: 2, findings: {
    "pmid:1": finding(1), "pmid:2": finding(2), "pmid:9": { ...nine, paper: { ...nine.paper, abstract: "RECORD-ABSTRACT-9" } },
  } }))
})

function answer(citedPageIds: string[] = []): LLMResult {
  const output = { answer: "The note says it works fast.", citedPageIds }
  return { text: JSON.stringify(output), json: output, usage: { inputTokens: 10, outputTokens: 5 }, model: "m", provider: "anthropic", stopReason: "end_turn" }
}
function providers(strong: LLMResult[]) {
  const fast = new MockProvider([])
  const strongProvider = new MockProvider(strong)
  return { fast, strong: strongProvider, opts: { settings, providerOverride: { fast, strong: strongProvider }, now: () => NOW } }
}
const promptOf = (provider: MockProvider, call = 0) => provider.calls[call].req.messages.map((m) => m.content).join("\n")
const input = { sessionId: "chat_note", question: "What does my note conclude?", readSourcesOnly: false, noteId: NOTE_ID }

describe("parseAskChatInput with a note", () => {
  it("accepts a note id", () => {
    expect(parseAskChatInput(input).noteId).toBe(NOTE_ID)
    expect(parseAskChatInput({ ...input, noteId: undefined }).noteId).toBeUndefined()
  })
  it("rejects an unsafe or empty id", () => {
    for (const noteId of ["", "../settings", "a/../b", 12, null, "x".repeat(301)]) expect(() => parseAskChatInput({ ...input, noteId })).toThrow()
  })
  it("rejects a note together with a paper or a project", () => {
    expect(() => parseAskChatInput({ ...input, paperSlug: "paper-1" })).toThrow(CLINICAL_COPY.notes.chatOneSubject)
    expect(() => parseAskChatInput({ ...input, projectId: "project" })).toThrow(CLINICAL_COPY.notes.chatOneSubject)
  })
  it("still rejects a context supplied by the caller", () => {
    expect(() => parseAskChatInput({ ...input, noteContext: { id: NOTE_ID, title: "x", body: "y", papers: [] } })).toThrow()
  })
})

describe("captureNoteContext", () => {
  it("keeps the note as stored and each saved paper it cites", async () => {
    const context = await captureNoteContext(storage, taxonomy, NOTE_ID, NOW)
    expect(context).toMatchObject({ id: NOTE_ID, title: "Esketamine in TRD", body: NOTE_BODY })
    expect(context.papers.map((entry) => entry.slug)).toEqual(["paper-1", "paper-7", "paper-8", "paper-9"])
    expect(context.papers[0]).toEqual({ slug: "paper-1", label: "Author1 2026", title: "Paper 1", summary: "Headline 1 Takeaway 1.", abstract: "ABSTRACT-1 of the first paper." })
  })
  it("uses the page's own summary when the findings store has none, and leaves a missing abstract out", async () => {
    const context = await captureNoteContext(storage, taxonomy, NOTE_ID, NOW)
    expect(context.papers[1]).toEqual({ slug: "paper-7", label: "Author7 2026", title: "Paper 7", summary: "PAGE-TLDR-7" })
  })
  it("leaves a missing summary out and cuts the abstract at 2,500 characters", async () => {
    const eight = (await captureNoteContext(storage, taxonomy, NOTE_ID, NOW)).papers[2]
    expect(eight.summary).toBeUndefined()
    expect(eight.abstract).toHaveLength(2500)
    expect(eight.abstract?.startsWith("START")).toBe(true)
    expect(eight.abstract).not.toContain("UNSUPPLIED-END")
  })
  it("takes the abstract from the paper's record when its page has none", async () => {
    expect((await captureNoteContext(storage, taxonomy, NOTE_ID, NOW)).papers[3]).toMatchObject({ slug: "paper-9", summary: "Headline 9 Takeaway 9.", abstract: "RECORD-ABSTRACT-9" })
  })
  it("skips a paper that is not saved and one nothing knows", async () => {
    const slugs = (await captureNoteContext(storage, taxonomy, NOTE_ID, NOW)).papers.map((entry) => entry.slug)
    expect(slugs).not.toContain("paper-2")
    expect(slugs).not.toContain("nowhere-paper")
  })
  it("keeps at most 12 papers, the first cited", async () => {
    const cited: string[] = []
    for (let n = 20; n < 35; n++) {
      await storage.write(`wiki/papers/paper-${n}.md`, paperPage(n, { abstract: `Abstract ${n}.` }))
      cited.push(`[[paper-${n}]]`)
    }
    await storage.write("wiki/notes/many.md", note("Many", `${cited.join(" ")}\n`))
    const context = await captureNoteContext(storage, taxonomy, "many", NOW)
    expect(context.papers.map((entry) => entry.slug)).toEqual(Array.from({ length: 12 }, (_, i) => `paper-${20 + i}`))
  })
  it("cuts a very long note and says so", async () => {
    await storage.write("wiki/notes/long.md", note("Long", `BEGIN ${"word ".repeat(5000)}NOTE-END\n`))
    const context = await captureNoteContext(storage, taxonomy, "long", NOW)
    expect(context.body.length).toBeLessThanOrEqual(16_000)
    expect(context.body).toContain("shortened")
    expect(context.body).not.toContain("NOTE-END")
  })
  it("writes nothing, and fails for a note that is not there", async () => {
    const before = storage.snapshot()
    await captureNoteContext(storage, taxonomy, NOTE_ID, NOW)
    expect(storage.snapshot()).toEqual(before)
    await expect(captureNoteContext(storage, taxonomy, "no-such-note", NOW)).rejects.toThrow(CLINICAL_COPY.notes.notFound)
  })
})

describe("renderNoteContext", () => {
  const context = { id: "n", title: "My note", body: "Body text.\n", papers: [
    { slug: "paper-1", label: "Author1 2026", title: "Paper 1", summary: "SUMMARY-1", abstract: "ABSTRACT-1" },
    { slug: "paper-7", label: "Author7 2026", title: "Paper 7" },
  ] }
  it("gives the note, then each paper under its slug", () => {
    const text = renderNoteContext(context, false)
    expect(text).toContain("My note")
    expect(text).toContain("Body text.")
    expect(text).toContain("### paper-1")
    expect(text).toContain("SUMMARY-1")
    expect(text).toContain("ABSTRACT-1")
    expect(text).toContain("### paper-7")
    expect(text.indexOf("Body text.")).toBeLessThan(text.indexOf("### paper-1"))
  })
  it("leaves the AI summaries out when only sources may be read", () => {
    const text = renderNoteContext(context, true)
    expect(text).not.toContain("SUMMARY-1")
    expect(text).toContain("ABSTRACT-1")
  })
  it("says so when the note cites no saved paper", () => {
    expect(renderNoteContext({ ...context, papers: [] }, false)).toContain("cites no paper")
  })
})

describe("a chat session with a note", () => {
  const base: ChatSession = { id: "chat_s", title: "T", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), messages: [] }
  const noteContext = { id: NOTE_ID, title: "Esketamine in TRD", body: "Body\n", papers: [{ slug: "paper-1", label: "Author1 2026", title: "Paper 1" }] }
  it("loads with the field and without it", async () => {
    await saveSession(storage, base)
    expect(await loadSession(storage, "chat_s")).toEqual(base)
    await saveSession(storage, { ...base, noteContext })
    expect((await loadSession(storage, "chat_s"))?.noteContext).toEqual(noteContext)
  })
  it("reads a damaged note context, or one beside another subject, as absent", async () => {
    await storage.write(".scispark/chats/chat_s.json", JSON.stringify({ ...base, noteContext: { id: NOTE_ID, title: 3 } }))
    expect(await loadSession(storage, "chat_s")).toBeNull()
    await storage.write(".scispark/chats/chat_s.json", JSON.stringify({ ...base, noteContext, projectId: "p", projectTitle: "P" }))
    expect(await loadSession(storage, "chat_s")).toBeNull()
  })
})

describe("askChat about a note", () => {
  it("answers from the note and its papers, without selecting pages", async () => {
    const { fast, strong, opts } = providers([answer(["paper-1", "invented", "paper-2"])])
    const stages: string[] = []
    const reply = await askChat(storage, { input, ...opts, onProgress: (stage) => stages.push(stage) })
    expect(fast.calls).toHaveLength(0)
    expect(strong.calls).toHaveLength(1)
    expect(stages).toEqual(["answering"])
    const prompt = promptOf(strong)
    expect(prompt).toContain(renderNoteContext((await loadSession(storage, "chat_note"))!.noteContext!, false))
    expect(prompt).toContain("NOTE-MARKER")
    expect(prompt).toContain("ABSTRACT-1 of the first paper.")
    expect(prompt).toContain("Headline 1 Takeaway 1.")
    expect(prompt).not.toContain("UNRELATED-PRIVATE-MARKER")
    expect(reply.message).toMatchObject({ role: "assistant", content: "The note says it works fast.", citedPageIds: ["wiki/papers/paper-1"], readSourcesOnly: false })
    const saved = await loadSession(storage, "chat_note")
    expect(saved?.noteContext).toMatchObject({ id: NOTE_ID, title: "Esketamine in TRD" })
    expect(saved?.messages).toHaveLength(2)
  })
  it("keeps answering from what it captured after the note is deleted", async () => {
    await askChat(storage, { input, ...providers([answer()]).opts })
    await storage.delete(`wiki/notes/${NOTE_ID}.md`)
    await storage.delete("wiki/papers/paper-1.md")
    const { fast, strong, opts } = providers([answer(["paper-1"])])
    const reply = await askChat(storage, { input: { sessionId: "chat_note", question: "And the dose?", readSourcesOnly: false }, ...opts })
    expect(fast.calls).toHaveLength(0)
    expect(promptOf(strong)).toContain("NOTE-MARKER")
    expect(promptOf(strong)).toContain("ABSTRACT-1 of the first paper.")
    expect(promptOf(strong)).toContain(input.question)
    // The paper's page is gone, so there is nothing to link the citation to.
    expect(reply.message.citedPageIds).toEqual([])
    expect((await loadSession(storage, "chat_note"))?.messages).toHaveLength(4)
  })
  it("leaves the AI summaries out when only sources may be read", async () => {
    const { strong, opts } = providers([answer()])
    await askChat(storage, { input: { ...input, readSourcesOnly: true }, ...opts })
    expect(promptOf(strong)).toContain("ABSTRACT-1 of the first paper.")
    expect(promptOf(strong)).not.toContain("Headline 1 Takeaway 1.")
  })
  it("takes a note only on the first message of a conversation", async () => {
    const { strong, opts } = providers([answer(), answer()])
    await askChat(storage, { input, ...opts })
    await expect(askChat(storage, { input: { ...input, question: "Again?" }, ...opts })).rejects.toThrow(ChatScopeError)
    await storage.write("wiki/notes/other.md", note("Other", "Other text.\n"))
    await expect(askChat(storage, { input: { ...input, question: "Again?", noteId: "other" }, ...opts })).rejects.toThrow(CLINICAL_COPY.notes.chatNoteFirst)
    expect(strong.calls).toHaveLength(1)
    expect((await loadSession(storage, "chat_note"))?.messages).toHaveLength(2)
  })
  it("does not let a conversation about a note take a paper or a project later", async () => {
    const { strong, opts } = providers([answer()])
    await askChat(storage, { input, ...opts })
    await expect(askChat(storage, { input: { sessionId: "chat_note", question: "Hi", readSourcesOnly: false, paperSlug: "paper-1" }, ...opts })).rejects.toThrow(/scope cannot be changed/)
    await expect(askChat(storage, { input: { sessionId: "chat_note", question: "Hi", readSourcesOnly: false, projectId: "p" }, ...opts })).rejects.toThrow(/scope cannot be changed/)
    expect(strong.calls).toHaveLength(1)
  })
  it("fails for a note that is not there, before any model call or saved turn", async () => {
    const { strong, opts } = providers([])
    await expect(askChat(storage, { input: { ...input, noteId: "no-such-note" }, ...opts })).rejects.toThrow(CLINICAL_COPY.notes.notFound)
    expect(strong.calls).toHaveLength(0)
    expect(await loadSession(storage, "chat_note")).toBeNull()
  })
  it("starts a session of its own when no id is given", async () => {
    const reply = await askChat(storage, { input: { ...input, sessionId: null }, ...providers([answer()]).opts })
    expect((await loadSession(storage, reply.sessionId))?.noteContext?.id).toBe(NOTE_ID)
  })
  it("says the answer failed and keeps the question", async () => {
    const fast = new MockProvider([])
    const strong = new MockProvider([new Error("model down")])
    const reply = await askChat(storage, { input, settings, providerOverride: { fast, strong }, now: () => NOW })
    expect(reply.message.content).toBe(CLINICAL_COPY.notes.chatAnswerFailed)
    expect(reply.message.error).toBeTruthy()
    expect((await loadSession(storage, "chat_note"))?.messages[0]).toMatchObject({ role: "user", content: input.question })
  })
})
