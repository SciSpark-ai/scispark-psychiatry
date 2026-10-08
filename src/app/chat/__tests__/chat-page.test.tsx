// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import type { ChatSession } from "@/lib/chat/session"
import type { AskChatResult } from "@/lib/chat/orchestrator"
import type { Bundle } from "@/lib/vault/bundle"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const observeSkillJobMock = vi.fn()
const getOpenVaultMock = vi.fn()
const listSessionsMock = vi.fn()
const loadSessionMock = vi.fn()
const loadBundleMock = vi.fn()
const askChatRemoteMock = vi.fn()
const saveAnswerAsQueryRemoteMock = vi.fn()
const getProjectRemoteMock = vi.fn()
const routerPushMock = vi.fn()
const routerMock = { push: routerPushMock, replace: vi.fn() }
let searchParamsValue = new URLSearchParams("new=1")
let paramsValue: { id?: string } = {}

vi.mock("@/lib/skills/job-client", () => ({
  observeSkillJob: (...args: unknown[]) => observeSkillJobMock(...args),
}))
vi.mock("@/lib/vault/get-vault", () => ({
  getOpenVault: (...args: unknown[]) => getOpenVaultMock(...args),
}))
// Only the two pure/session functions the pages need — NOT the whole real
// module, which would pull VaultStorage plumbing along for the ride.
vi.mock("@/lib/chat/session", () => ({
  listSessions: (...args: unknown[]) => listSessionsMock(...args),
  loadSession: (...args: unknown[]) => loadSessionMock(...args),
}))
vi.mock("@/lib/vault/bundle", () => ({
  loadBundle: (...args: unknown[]) => loadBundleMock(...args),
}))
vi.mock("@/lib/chat/client", async importOriginal => ({
  ...await importOriginal<object>(),
  askChatRemote: (...args: unknown[]) => askChatRemoteMock(...args),
}))
vi.mock("@/lib/chat/save-query-client", () => ({
  saveAnswerAsQueryRemote: (...args: unknown[]) => saveAnswerAsQueryRemoteMock(...args),
}))
vi.mock("@/lib/projects/client", () => ({
  getProjectRemote: (...args: unknown[]) => getProjectRemoteMock(...args),
  ProjectApiError: class ProjectApiError extends Error {
    constructor(public status: number, message: string) {
      super(message)
    }
  },
}))
const readNoteRemoteMock = vi.fn()
vi.mock("@/lib/clinical/notes/client", () => ({ readNoteRemote: (...args: unknown[]) => readNoteRemoteMock(...args) }))
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useParams: () => paramsValue,
  useSearchParams: () => searchParamsValue,
}))

import ChatEntryPage from "../page"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import ChatSessionPage from "../[id]/page"

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "chat_1",
    title: "What is a TRF?",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    messages: [
      { role: "user", content: "What is a TRF?" },
      { role: "assistant", content: "A TRF is a temporal response function.", citedPageIds: [] },
    ],
    ...overrides,
  }
}

function emptyBundle(): Bundle {
  return { pages: new Map(), links: [], errors: [] }
}

async function renderPage(el: React.ReactElement): Promise<{ container: HTMLElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(el)
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function findByText(container: HTMLElement, selector: string, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll(selector)).find((e) => (e.getAttribute("aria-label") ?? e.textContent?.trim()) === text) as
    | HTMLElement
    | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  observeSkillJobMock.mockReset().mockResolvedValue(undefined)
  readNoteRemoteMock.mockReset().mockResolvedValue(null)
  paramsValue = {}
  searchParamsValue = new URLSearchParams("new=1")
  sessionStorage.clear()
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ enabledSources: ["openalex"] })))
  getOpenVaultMock.mockResolvedValue({})
  listSessionsMock.mockResolvedValue([])
  loadSessionMock.mockResolvedValue(null)
  loadBundleMock.mockResolvedValue(emptyBundle())
  getProjectRemoteMock.mockResolvedValue({ id: "auditory-biomarkers" })
})
afterEach(() => vi.unstubAllGlobals())

describe("ChatEntryPage (/chat)", () => {
  it("renders the composer and no clinical suggestion chips", async () => {
    const { container, cleanup } = await renderPage(<ChatEntryPage />)

    expect(container.querySelector("textarea")).toBeTruthy()
    expect(container.textContent).not.toContain("Compare treatments")
    expect(container.textContent).not.toContain("Summarize RCT")
    expect(container.textContent).not.toContain("Find guidelines")
    expect(container.textContent).not.toContain("Risk vs benefit")

    cleanup()
  })

  it("renders the Saved papers only toggle", async () => {
    const { container, cleanup } = await renderPage(<ChatEntryPage />)
    expect(container.textContent).toMatch(/saved papers only/i)
    cleanup()
  })

  it("lists recent sessions from the vault", async () => {
    listSessionsMock.mockResolvedValue([session(), session({ id: "chat_2", title: "Second question" })])

    const { container, cleanup } = await renderPage(<ChatEntryPage />)

    expect(container.textContent).toContain("What is a TRF?")
    expect(container.textContent).toContain("Second question")

    cleanup()
  })

  it("submitting calls the orchestrator client and routes to the returned session id", async () => {
    const result: AskChatResult = {
      sessionId: "chat_42",
      message: { role: "assistant", content: "A TRF is...", citedPageIds: [] },
    }
    askChatRemoteMock.mockResolvedValue(result)

    const { container, cleanup } = await renderPage(<ChatEntryPage />)

    const textarea = container.querySelector("textarea")! as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(textarea, "What is a TRF?")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const sendButton = findByText(container, "button", "Send")!
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(askChatRemoteMock).toHaveBeenCalledTimes(1)
    const [input] = askChatRemoteMock.mock.calls[0]
    expect(input).toMatchObject({ sessionId: expect.stringMatching(/^chat_/), operationId: expect.any(String), question: "What is a TRF?", readSourcesOnly: false })
    expect(routerPushMock).toHaveBeenCalledWith("/chat/chat_42")

    cleanup()
  })

  it("shows the request error inline and does not route when the orchestrator call rejects", async () => {
    askChatRemoteMock.mockRejectedValue(new Error("network down"))

    const { container, cleanup } = await renderPage(<ChatEntryPage />)

    const textarea = container.querySelector("textarea")! as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(textarea, "What is a TRF?")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const sendButton = findByText(container, "button", "Send")!
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(container.textContent).toContain("network down")
    expect(routerPushMock).not.toHaveBeenCalled()

    cleanup()
  })
})

describe("ChatSessionPage (/chat/[id])", () => {
  it("restores the draft and Read Sources Only choice without widening its context", async () => {
    paramsValue = { id: "chat_1" }
    loadSessionMock.mockResolvedValue(session())
    sessionStorage.setItem("scispark:chat-draft:chat_1", "Compare the papers")
    sessionStorage.setItem("scispark:chat-draft:chat_1:options", JSON.stringify({ mode: "chat", readSourcesOnly: true }))
    const { container, cleanup } = await renderPage(<ChatSessionPage />)
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Compare the papers")
    expect(container.querySelector<HTMLInputElement>('[role="switch"]')?.checked).toBe(true)
    expect(askChatRemoteMock).not.toHaveBeenCalled()
    cleanup()
  })

  it("restores search mode but never replaces a disabled draft source with broader indexes", async () => {
    paramsValue = { id: "chat_1" }
    loadSessionMock.mockResolvedValue(session())
    // Only OpenAlex is currently enabled. The draft requested PubMed alone.
    sessionStorage.setItem("scispark:chat-draft:chat_1", "Find adult EEG studies")
    sessionStorage.setItem("scispark:chat-draft:chat_1:options", JSON.stringify({ mode: "search", readSourcesOnly: false, sources: ["pubmed"] }))
    const { container, cleanup } = await renderPage(<ChatSessionPage />)
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Chat mode"]')?.value).toBe("search")
    expect((findByText(container, "button", "Send") as HTMLButtonElement).disabled).toBe(true)
    await act(async () => findByText(container, "button", "Search scope")!.click())
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    expect(askChatRemoteMock).not.toHaveBeenCalled()
    cleanup()
  })

  it("renders a persisted session's turns", async () => {
    paramsValue = { id: "chat_1" }
    loadSessionMock.mockResolvedValue(session())

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toContain("What is a TRF?")
    expect(container.textContent).toContain("A TRF is a temporal response function.")

    cleanup()
  })

  it("labels a project-scoped transcript and verifies its live scope", async () => {
    paramsValue = { id: "chat_project" }
    loadSessionMock.mockResolvedValue(session({
      id: "chat_project",
      projectId: "auditory-biomarkers",
      projectTitle: "Auditory Biomarkers",
    }))

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toContain("Project · Auditory Biomarkers")
    expect(getProjectRemoteMock).toHaveBeenCalledWith("auditory-biomarkers")
    cleanup()
  })

  it("keeps a deleted-project transcript readable and disables continuation", async () => {
    paramsValue = { id: "chat_deleted" }
    loadSessionMock.mockResolvedValue(session({
      id: "chat_deleted",
      projectId: "deleted-project",
      projectTitle: "Deleted Project",
    }))
    const { ProjectApiError } = await import("@/lib/projects/client")
    getProjectRemoteMock.mockRejectedValue(new ProjectApiError(404, "not found"))

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toContain("The transcript is preserved")
    expect(container.textContent).toContain("A TRF is a temporal response function")
    expect((container.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true)
    cleanup()
  })

  it("renders a not-found state instead of crashing when the session id does not resolve", async () => {
    paramsValue = { id: "chat_missing" }
    loadSessionMock.mockResolvedValue(null)

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toMatch(/not found|doesn.t exist|couldn.t find/i)

    cleanup()
  })

  // The case above mocks a RESOLVED null with a valid-shaped id, so it passes
  // whether or not the load is error-handled. This one covers the other exit:
  // `loadSession` REJECTS for an id that isn't a legal path segment (the
  // `sessionPath` guard), and `sessionId` comes straight off the URL — so a
  // stale or hand-typed `/chat/<id>` must still land on the not-found card
  // rather than spinning on "Loading conversation…" forever.
  it("renders not-found (never a permanent spinner) when loading the session rejects", async () => {
    paramsValue = { id: "bad id" }
    loadSessionMock.mockRejectedValue(new Error("invalid session id: bad id"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    expect(container.textContent).toMatch(/not found|doesn.t exist|couldn.t find/i)
    expect(container.textContent).not.toMatch(/Loading conversation/i)

    warn.mockRestore()
    cleanup()
  })

  it("appends the new turn returned by the orchestrator client after a follow-up submit", async () => {
    paramsValue = { id: "chat_1" }
    loadSessionMock.mockResolvedValueOnce(session())

    const { container, cleanup } = await renderPage(<ChatSessionPage />)
    expect(container.textContent).toContain("A TRF is a temporal response function.")

    const followUp = session({
      messages: [
        ...session().messages,
        { role: "user", content: "And what modulates it?" },
        { role: "assistant", content: "Attention modulates TRF amplitude.", citedPageIds: [] },
      ],
    })
    loadSessionMock.mockResolvedValueOnce(followUp)
    askChatRemoteMock.mockResolvedValue({
      sessionId: "chat_1",
      message: { role: "assistant", content: "Attention modulates TRF amplitude.", citedPageIds: [] },
    })

    const textarea = container.querySelector("textarea")! as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(textarea, "And what modulates it?")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const sendButton = findByText(container, "button", "Send")!
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(askChatRemoteMock).toHaveBeenCalledTimes(1)
    const [input] = askChatRemoteMock.mock.calls[0]
    expect(input).toMatchObject({ sessionId: "chat_1", question: "And what modulates it?" })
    expect(container.textContent).toContain("Attention modulates TRF amplitude.")

    cleanup()
  })

  it("routes a Save click through saveAnswerAsQueryRemote with the cited page ids", async () => {
    paramsValue = { id: "chat_1" }
    loadSessionMock.mockResolvedValue(
      session({
        messages: [
          { role: "user", content: "What is a TRF?" },
          { role: "assistant", content: "A TRF is...", citedPageIds: ["wiki/concepts/trf"] },
        ],
      }),
    )
    saveAnswerAsQueryRemoteMock.mockResolvedValue({ changesetId: "cs_1", pageId: "wiki/queries/what-is-a-trf" })

    const { container, cleanup } = await renderPage(<ChatSessionPage />)

    const saveButton = findByText(container, "button", "Save to knowledge base")!
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(saveAnswerAsQueryRemoteMock).toHaveBeenCalledTimes(1)
    const [opts] = saveAnswerAsQueryRemoteMock.mock.calls[0]
    expect(opts).toMatchObject({
      question: "What is a TRF?",
      answer: "A TRF is...",
      sessionId: "chat_1",
      citedPageIds: ["wiki/concepts/trf"],
    })
    expect(container.innerHTML).toMatch(/href="\/wiki\/queries\/what-is-a-trf"/)

    cleanup()
  })
})

// Clinical edition: a conversation that starts from a note (`/chat?new=1&note=<id>`).
describe("a conversation about a note", () => {
  async function send(container: HTMLElement, text: string) {
    const textarea = container.querySelector("textarea")! as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(textarea, text)
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      findByText(container, "button", "Send")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 0))
    })
  }
  const noteContext = { id: "esketamine-in-trd", title: "Esketamine in TRD", body: "Works fast.\n", papers: [] }

  it("sends the note with the first message of the new conversation", async () => {
    searchParamsValue = new URLSearchParams("new=1&note=esketamine-in-trd")
    askChatRemoteMock.mockResolvedValue({ sessionId: "chat_42", message: { role: "assistant", content: "It says…", citedPageIds: [] } })
    const { container, cleanup } = await renderPage(<ChatEntryPage />)
    await send(container, "What does my note conclude?")
    expect(askChatRemoteMock).toHaveBeenCalledTimes(1)
    expect(askChatRemoteMock.mock.calls[0][0]).toMatchObject({ sessionId: expect.stringMatching(/^chat_/), question: "What does my note conclude?", noteId: "esketamine-in-trd" })
    expect(routerPushMock).toHaveBeenCalledWith("/chat/chat_42")
    cleanup()
  })

  it("sends no note from a plain new chat", async () => {
    askChatRemoteMock.mockResolvedValue({ sessionId: "chat_42", message: { role: "assistant", content: "…", citedPageIds: [] } })
    const { container, cleanup } = await renderPage(<ChatEntryPage />)
    await send(container, "What is a TRF?")
    expect(askChatRemoteMock.mock.calls[0][0]).not.toHaveProperty("noteId")
    cleanup()
  })

  it("says which note the conversation is about, and sends the note no second time", async () => {
    paramsValue = { id: "chat_42" }
    // Even with the parameter still in the address, a conversation that exists does not send it again.
    searchParamsValue = new URLSearchParams("new=1&note=esketamine-in-trd")
    loadSessionMock.mockResolvedValue(session({ id: "chat_42", noteContext }))
    askChatRemoteMock.mockResolvedValue({ sessionId: "chat_42", message: { role: "assistant", content: "…", citedPageIds: [] } })
    const { container, cleanup } = await renderPage(<ChatSessionPage />)
    expect(container.textContent).toContain("About your note: Esketamine in TRD")
    await send(container, "And the dose?")
    expect(askChatRemoteMock).toHaveBeenCalledTimes(1)
    expect(askChatRemoteMock.mock.calls[0][0]).toMatchObject({ sessionId: "chat_42", question: "And the dose?" })
    expect(askChatRemoteMock.mock.calls[0][0]).not.toHaveProperty("noteId")
    cleanup()
  })

  it("says which note it is about on the start screen, before the first message, with one read of the note", async () => {
    searchParamsValue = new URLSearchParams("new=1&note=esketamine-in-trd")
    readNoteRemoteMock.mockResolvedValue({ summary: { title: "Esketamine in TRD" } })
    const { container, cleanup } = await renderPage(<ChatEntryPage />)
    expect(container.querySelector("[data-chat-start]")).toBeTruthy()
    expect(container.querySelector("[data-chat-note]")?.textContent).toBe("About your note: Esketamine in TRD")
    expect(readNoteRemoteMock).toHaveBeenCalledTimes(1)
    expect(readNoteRemoteMock).toHaveBeenCalledWith("esketamine-in-trd")
    expect(askChatRemoteMock).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain(CLINICAL_COPY.notes.chatQuestionsOnly)
    cleanup()
  })

  it("says so on the start screen when the note is not in the Library", async () => {
    searchParamsValue = new URLSearchParams("new=1&note=gone")
    readNoteRemoteMock.mockResolvedValue(null)
    const { container, cleanup } = await renderPage(<ChatEntryPage />)
    expect(container.querySelector("[data-chat-note]")?.textContent).toBe("That note is not in your Library.")
    cleanup()
  })

  it("reads no note and shows no line on a plain start screen", async () => {
    const { container, cleanup } = await renderPage(<ChatEntryPage />)
    expect(readNoteRemoteMock).not.toHaveBeenCalled()
    expect(container.querySelector("[data-chat-note]")).toBeNull()
    await act(async () => { findByText(container, "button", "Find papers")!.click() })
    expect(container.textContent).not.toContain(CLINICAL_COPY.notes.chatQuestionsOnly)
    cleanup()
  })

  it("says the note is only used for questions when the reader chooses to search or to review, and sends no note then", async () => {
    searchParamsValue = new URLSearchParams("new=1&note=esketamine-in-trd")
    readNoteRemoteMock.mockResolvedValue({ summary: { title: "Esketamine in TRD" } })
    askChatRemoteMock.mockResolvedValue({ sessionId: "chat_42", message: { role: "assistant", content: "…", citedPageIds: [] } })
    const { container, cleanup } = await renderPage(<ChatEntryPage />)
    await act(async () => { findByText(container, "button", "Deep literature review")!.click() })
    expect(container.querySelector("[data-chat-note-mode]")?.textContent).toBe("Your note is only used for questions. A paper search or a deep review does not read it.")
    await act(async () => { findByText(container, "button", "Find papers")!.click() })
    expect(container.querySelector("[data-chat-note-mode]")).not.toBeNull()
    await send(container, "esketamine trials")
    expect(askChatRemoteMock).toHaveBeenCalledTimes(1)
    expect(askChatRemoteMock.mock.calls[0][0]).toMatchObject({ mode: "search", question: "esketamine trials" })
    expect(askChatRemoteMock.mock.calls[0][0]).not.toHaveProperty("noteId")
    cleanup()
  })

  it("shows no such line for the mode once the reader is back on a plain question, and sends the note", async () => {
    searchParamsValue = new URLSearchParams("new=1&note=esketamine-in-trd")
    readNoteRemoteMock.mockResolvedValue({ summary: { title: "Esketamine in TRD" } })
    askChatRemoteMock.mockResolvedValue({ sessionId: "chat_42", message: { role: "assistant", content: "…", citedPageIds: [] } })
    const { container, cleanup } = await renderPage(<ChatEntryPage />)
    await act(async () => { findByText(container, "button", "Find papers")!.click() })
    await act(async () => { findByText(container, "button", "Discuss research")!.click() })
    expect(container.querySelector("[data-chat-note-mode]")).toBeNull()
    await send(container, "What does my note conclude?")
    expect(askChatRemoteMock.mock.calls[0][0]).toMatchObject({ mode: "chat", noteId: "esketamine-in-trd" })
    cleanup()
  })

  it("shows no such line for a conversation that is not about a note", async () => {
    paramsValue = { id: "chat_1" }
    loadSessionMock.mockResolvedValue(session())
    const { container, cleanup } = await renderPage(<ChatSessionPage />)
    expect(container.textContent).not.toContain("About your note")
    cleanup()
  })
})
