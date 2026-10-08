// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { NoteAnswer } from "@/lib/clinical/notes/client"
import type { NoteSummary } from "@/lib/clinical/notes/links"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => nav }))
const notes = vi.hoisted(() => ({ readNoteRemote: vi.fn(), saveNoteRemote: vi.fn(), searchCitableRemote: vi.fn() }))
vi.mock("@/lib/clinical/notes/client", () => notes)
const records = vi.hoisted(() => ({ listConditionsRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => records)
const evidence = vi.hoisted(() => ({ loadConditionEvidenceRemote: vi.fn() }))
vi.mock("@/lib/clinical/evidence/client", () => evidence)

import { NotePage, SAVE_DELAY_MS } from "../NotePage"
import { CITE_DELAY_MS } from "../CitePaper"
import { readDraft, writeDraft } from "@/lib/clinical/notes/draft"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const BODY = "On [[lee-2024|Lee 2024]] and [[ghost]].\n\n[Esketamine](/wiki?condition=depression&treatment=esketamine) helps.\n"
const summary = (extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id: "esk", title: "Esketamine in TRD", excerpt: "", updated: "2026-10-05", created: "2026-10-01",
  links: { papers: ["lee-2024", "ghost"], conditions: ["depression"], treatments: [{ condition: "depression", treatment: "esketamine" }] },
  kind: "topic",
  conditions: [{ code: "depression", name: "Major depressive disorder" }],
  papers: [{ slug: "lee-2024", label: "Lee 2024" }, { slug: "ghost", label: "ghost" }],
  treatments: [{ condition: "depression", key: "esketamine", name: "Esketamine" }],
  newSince: 1, project: false, ...extra,
})
const answer = (extra: Partial<NoteAnswer> = {}): NoteAnswer => ({
  summary: summary(), body: BODY, revision: "r1",
  newPapers: [{ slug: "new-1", label: "Park 2026", headline: "Esketamine beat placebo at four weeks", condition: "depression", firstListed: "2026-10-06" }],
  references: [{ slug: "lee-2024", text: "Lee A. A trial. 2024." }],
  ...extra,
})
const saved = (revision: string, unresolved: string[] = [], savedPapers: string[] = []) => ({ revision, unresolved, savedPapers })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot> | null = null
const onDelete = vi.fn()
/** Opens the note. A note with text opens on its preview: unless `asOpened`, the reader then goes to Edit, where the field is. */
async function open(props: { untitled?: boolean; confirm?: React.ReactNode; asOpened?: boolean } = {}) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<NotePage id="esk" untitled={props.untitled ?? false} onDelete={onDelete} confirm={props.confirm} />) })
  await act(async () => {})
  if (!props.asOpened && tabOn() === "preview") await act(async () => { tab("edit").click() })
}
const tab = (name: "edit" | "preview") => container.querySelector(`[data-note-tab="${name}"]`) as HTMLButtonElement
const tabOn = () => container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-note-tab") ?? null
const preview = () => container.querySelector("[data-note-preview]") as HTMLElement | null
const flush = async () => { await act(async () => {}) }
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click() }) }
const write = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const leaveField = async (field: Element) => { await act(async () => { field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })) }) }
const titleField = () => container.querySelector('input[type="text"]') as HTMLInputElement
const area = () => container.querySelector("textarea") as HTMLTextAreaElement
const button = (text: string) => [...container.querySelectorAll("button")].find((entry) => entry.textContent === text) as HTMLButtonElement
const anchor = (text: string) => [...container.querySelectorAll("a")].find((entry) => entry.textContent === text) as HTMLAnchorElement
const state = () => container.querySelector("[data-note-state]")?.getAttribute("data-note-state")
const notice = () => container.querySelector("[data-note-notice]")?.textContent ?? null
const saves = () => notes.saveNoteRemote.mock.calls.map((call) => call[0] as { id: string; title: string; body: string; revision: string })
const guarded = () => {
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  document.body.innerHTML = ""
  for (const mock of [nav.push, notes.readNoteRemote, notes.saveNoteRemote, notes.searchCitableRemote, records.listConditionsRemote, evidence.loadConditionEvidenceRemote, onDelete]) mock.mockReset()
  notes.readNoteRemote.mockResolvedValue(answer())
  notes.saveNoteRemote.mockResolvedValue(saved("r2"))
})
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  vi.useRealTimers()
})

describe("the page of a note", () => {
  it("shows the title, the text, what the note is about and the ways out, and writes nothing", async () => {
    await open()
    expect(notes.readNoteRemote).toHaveBeenCalledWith("esk")
    expect(titleField().value).toBe("Esketamine in TRD")
    expect(area().value).toBe(BODY)
    expect(anchor("← Notes").getAttribute("href")).toBe("/notes")
    const chips = [...container.querySelectorAll("[data-chip]")].map((chip) => [chip.getAttribute("data-chip"), chip.textContent, chip.getAttribute("href")])
    expect(chips).toEqual([
      ["condition", "Major depressive disorder", "/wiki?condition=depression"],
      ["treatment", "Esketamine", "/wiki?condition=depression&treatment=esketamine"],
      ["papers", "2 papers", "#note-links"],
    ])
    expect(anchor("Ask about this note").getAttribute("href")).toBe("/chat?new=1&note=esk")
    for (const label of ["Cite a paper", "Link a condition or treatment", "Copy with references", "Delete"]) expect(button(label)).toBeTruthy()
    expect(state()).toBe("saved")
    expect(container.textContent).toContain("Do not write anything about a patient.")
    expect(container.textContent).toContain("Asking sends this note and its cited papers to your model provider.")
    expect(area().className).not.toContain("font-mono")
    await tick(5 * SAVE_DELAY_MS)
    expect(notes.saveNoteRemote).not.toHaveBeenCalled()
    expect(guarded()).toBe(false)
  })

  it("says so when the Library has no such note, and shows a failure to read it", async () => {
    notes.readNoteRemote.mockResolvedValue(null)
    await open()
    expect(container.textContent).toContain("That note is not in your Library.")
    expect(container.querySelector("textarea")).toBeNull()
    act(() => root!.unmount())
    notes.readNoteRemote.mockRejectedValue(new Error("no vault"))
    await open()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("no vault")
  })

  it("saves once, three seconds after the last change, with the revision it read; the next save names the revision that one gave", async () => {
    expect(SAVE_DELAY_MS).toBe(3000)
    await open()
    await write(titleField(), "A new title")
    await tick(SAVE_DELAY_MS - 100)
    await write(area(), "New text.\n")
    expect(state()).toBe("saving")
    await tick(SAVE_DELAY_MS - 1)
    expect(notes.saveNoteRemote).not.toHaveBeenCalled()
    await tick(1)
    expect(saves()).toEqual([{ id: "esk", title: "A new title", body: "New text.\n", revision: "r1" }])
    expect(state()).toBe("saved")

    notes.saveNoteRemote.mockResolvedValue(saved("r3"))
    await write(area(), "Newer text.\n")
    await tick(SAVE_DELAY_MS)
    expect(saves()[1]).toEqual({ id: "esk", title: "A new title", body: "Newer text.\n", revision: "r2" })
    expect(saves()).toHaveLength(2)
  })

  it("saves at once when a field is left, and not again when the wait runs out", async () => {
    await open()
    await write(area(), "Left early.\n")
    await leaveField(area())
    expect(saves()).toHaveLength(1)
    await tick(2 * SAVE_DELAY_MS)
    expect(saves()).toHaveLength(1)
    await write(titleField(), "Then a title")
    await leaveField(titleField())
    expect(saves()[1]).toEqual({ id: "esk", title: "Then a title", body: "Left early.\n", revision: "r2" })
  })

  it("never has two saves under way: a change made during a save is saved after it, with its revision", async () => {
    const first = deferred<ReturnType<typeof saved>>()
    notes.saveNoteRemote.mockReturnValueOnce(first.promise).mockResolvedValue(saved("r3"))
    await open()
    await write(area(), "One.\n")
    await tick(SAVE_DELAY_MS)
    expect(saves()).toHaveLength(1)
    await write(area(), "One. Two.\n")
    await tick(SAVE_DELAY_MS)
    await leaveField(area())
    expect(saves()).toHaveLength(1)
    expect(state()).toBe("saving")
    await act(async () => { first.resolve(saved("r2")) })
    await flush()
    expect(saves()).toHaveLength(2)
    expect(saves()[1]).toEqual({ id: "esk", title: "Esketamine in TRD", body: "One. Two.\n", revision: "r2" })
    expect(state()).toBe("saved")
  })

  it("asks again for the chips and references only when a save changed what the note links", async () => {
    await open()
    await write(area(), `${BODY}More words.\n`)
    await tick(SAVE_DELAY_MS)
    expect(notes.readNoteRemote).toHaveBeenCalledTimes(1)
    notes.readNoteRemote.mockResolvedValue(answer({ summary: summary({ conditions: [{ code: "adhd", name: "ADHD" }], treatments: [], papers: [] }), body: "[ADHD](/wiki?condition=adhd)\n", references: [] }))
    await write(area(), "[ADHD](/wiki?condition=adhd)\n")
    await tick(SAVE_DELAY_MS)
    expect(notes.readNoteRemote).toHaveBeenCalledTimes(2)
    expect([...container.querySelectorAll("[data-chip]")].map((chip) => chip.textContent)).toEqual(["ADHD"])
    expect(area().value).toBe("[ADHD](/wiki?condition=adhd)\n")
  })
})

describe("a note that was changed somewhere else", () => {
  const stored = { conflict: true as const, title: "Stored title", untitled: false, body: "Stored text.\n", revision: "r9" }
  async function conflicted() {
    notes.saveNoteRemote.mockResolvedValueOnce(stored).mockResolvedValue(saved("r10"))
    await open()
    await write(area(), "Mine.\n")
    await tick(SAVE_DELAY_MS)
  }

  it("shows the stored version beside the reader's text and saves nothing until the reader chooses", async () => {
    await conflicted()
    expect(container.querySelector("[data-note-conflict]")?.textContent).toContain("This note was changed somewhere else since you opened it.")
    expect(container.querySelector("[data-note-stored]")?.textContent).toContain("Stored title")
    expect(container.querySelector("[data-note-stored]")?.textContent).toContain("Stored text.")
    expect(area().value).toBe("Mine.\n")
    await write(area(), "Mine, still.\n")
    await tick(3 * SAVE_DELAY_MS)
    expect(saves()).toHaveLength(1)
    expect(guarded()).toBe(true)
  })

  it("keeps the reader's text over the stored one on \"Keep mine\", then saves itself as before", async () => {
    await conflicted()
    await click(button("Keep mine"))
    await flush()
    expect(saves()[1]).toEqual({ id: "esk", title: "Esketamine in TRD", body: "Mine.\n", revision: "r9" })
    expect(container.querySelector("[data-note-conflict]")).toBeNull()
    expect(state()).toBe("saved")
    await write(area(), "Mine, later.\n")
    await tick(SAVE_DELAY_MS)
    expect(saves()[2]).toEqual({ id: "esk", title: "Esketamine in TRD", body: "Mine, later.\n", revision: "r10" })
  })

  it("takes the stored text on \"Use the stored one\" without a save, then saves itself as before", async () => {
    await conflicted()
    await click(button("Use the stored one"))
    await flush()
    expect(area().value).toBe("Stored text.\n")
    expect(titleField().value).toBe("Stored title")
    expect(container.querySelector("[data-note-conflict]")).toBeNull()
    expect(state()).toBe("saved")
    await tick(3 * SAVE_DELAY_MS)
    expect(saves()).toHaveLength(1)
    await write(area(), "Stored text. And more.\n")
    await tick(SAVE_DELAY_MS)
    expect(saves()[1]).toEqual({ id: "esk", title: "Stored title", body: "Stored text. And more.\n", revision: "r9" })
  })
})

describe("a save that fails, and leaving with unsaved text", () => {
  it("keeps the text, shows the reason, and saves again on Retry", async () => {
    notes.saveNoteRemote.mockRejectedValueOnce(new Error("The disk is full.")).mockResolvedValue(saved("r2"))
    await open()
    await write(area(), "Kept.\n")
    await tick(SAVE_DELAY_MS)
    expect(container.querySelector("[data-note-state]")?.textContent).toBe("The disk is full.")
    expect(area().value).toBe("Kept.\n")
    expect(guarded()).toBe(true)
    await tick(3 * SAVE_DELAY_MS)
    expect(saves()).toHaveLength(1)
    await click(button("Retry"))
    await flush()
    expect(saves()[1]).toEqual({ id: "esk", title: "Esketamine in TRD", body: "Kept.\n", revision: "r1" })
    expect(state()).toBe("saved")
    expect(guarded()).toBe(false)
  })

  it("saves again on the next change after a failure", async () => {
    notes.saveNoteRemote.mockRejectedValueOnce(new Error("The disk is full.")).mockResolvedValue(saved("r2"))
    await open()
    await write(area(), "Kept.\n")
    await tick(SAVE_DELAY_MS)
    await write(area(), "Kept, and more.\n")
    await tick(SAVE_DELAY_MS)
    expect(saves()[1]).toEqual({ id: "esk", title: "Esketamine in TRD", body: "Kept, and more.\n", revision: "r1" })
    expect(state()).toBe("saved")
  })

  it("asks before the browser leaves only while something is unsaved", async () => {
    await open()
    expect(guarded()).toBe(false)
    await write(area(), "Not yet saved.\n")
    expect(guarded()).toBe(true)
    await tick(SAVE_DELAY_MS)
    expect(guarded()).toBe(false)
  })

  it("sends what is unsaved when the page is left, in a request that outlives it", async () => {
    await open()
    await write(area(), "Typed and gone.\n")
    act(() => root!.unmount())
    root = null
    expect(notes.saveNoteRemote).toHaveBeenCalledTimes(1)
    expect(notes.saveNoteRemote.mock.calls[0]).toEqual([{ id: "esk", title: "Esketamine in TRD", body: "Typed and gone.\n", revision: "r1" }, undefined, { keepalive: true }])
    await tick(2 * SAVE_DELAY_MS)
    expect(notes.saveNoteRemote).toHaveBeenCalledTimes(1)
  })

  it("sends what was typed during a save after it when the page is left meanwhile", async () => {
    const first = deferred<ReturnType<typeof saved>>()
    notes.saveNoteRemote.mockReturnValueOnce(first.promise).mockResolvedValue(saved("r3"))
    await open()
    await write(area(), "One.\n")
    await tick(SAVE_DELAY_MS)
    await write(area(), "One. Two.\n")
    act(() => root!.unmount())
    root = null
    expect(notes.saveNoteRemote).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve(saved("r2")) })
    await flush()
    expect(notes.saveNoteRemote.mock.calls[1]).toEqual([{ id: "esk", title: "Esketamine in TRD", body: "One. Two.\n", revision: "r2" }, undefined, { keepalive: true }])
  })

  it("sends nothing when the page is left with nothing unsaved", async () => {
    await open()
    act(() => root!.unmount())
    root = null
    expect(notes.saveNoteRemote).not.toHaveBeenCalled()
  })

  it("lets a link away from the page wait for the save, and keeps the reader when it fails", async () => {
    const pending = deferred<ReturnType<typeof saved>>()
    notes.saveNoteRemote.mockReturnValueOnce(pending.promise)
    await open()
    await write(area(), "On my way out.\n")
    await click(anchor("Ask about this note"))
    expect(saves()).toHaveLength(1)
    expect(nav.push).not.toHaveBeenCalled()
    await act(async () => { pending.resolve(saved("r2")) })
    await flush()
    expect(nav.push).toHaveBeenCalledWith("/chat?new=1&note=esk")

    nav.push.mockReset()
    notes.saveNoteRemote.mockRejectedValueOnce(new Error("The disk is full."))
    await write(area(), "And again.\n")
    await click(anchor("← Notes"))
    await flush()
    expect(nav.push).not.toHaveBeenCalled()
    expect(container.querySelector("[data-note-state]")?.textContent).toBe("The disk is full.")
  })
})

describe("citing a paper and linking a condition or a treatment", () => {
  const KIM = { slug: "kim-2023", label: "Kim 2023", title: "Ketamine in older adults", venue: "JAMA Psychiatry", year: 2023, saved: false }
  const LEE = { slug: "lee-2024", label: "Lee 2024", title: "A trial", venue: null, year: 2024, saved: true }

  async function search(text: string) {
    await click(button("Cite a paper"))
    const field = container.querySelector('[data-cite-paper] input[type="search"]') as HTMLInputElement
    await write(field, text)
    await tick(CITE_DELAY_MS)
  }

  it("puts the paper where the caret is and says it was saved to the Library once the note is saved", async () => {
    notes.searchCitableRemote.mockResolvedValue([LEE, KIM])
    await open()
    await act(async () => { area().focus(); area().setSelectionRange(3, 3) })
    await search("ketamine")
    expect(notes.searchCitableRemote).toHaveBeenCalledWith("ketamine")
    const rows = [...container.querySelectorAll("[data-cite]")]
    expect(rows.map((row) => row.getAttribute("data-cite"))).toEqual(["lee-2024", "kim-2023"])
    expect(rows[0].textContent).toContain("In your Library")
    expect(rows[1].textContent).toContain("Ketamine in older adults")
    expect(rows[1].textContent).toContain("JAMA Psychiatry, 2023")
    expect(rows[1].textContent).not.toContain("In your Library")

    await click(rows[1])
    expect(container.querySelector("[data-cite-paper]")).toBeNull()
    expect(area().value).toBe(`On [[kim-2023|Kim 2023]] ${BODY.slice(3)}`)
    expect(area().selectionStart).toBe("On [[kim-2023|Kim 2023]] ".length)
    expect(notice()).toBeNull()
    notes.saveNoteRemote.mockResolvedValue(saved("r2", [], ["kim-2023"]))
    await tick(SAVE_DELAY_MS)
    expect(saves()[0].body).toBe(`On [[kim-2023|Kim 2023]] ${BODY.slice(3)}`)
    expect(notice()).toBe("Saved to your Library")
    expect(container.querySelector('[data-note-link="paper:kim-2023"] a')?.getAttribute("href")).toBe("/paper/kim-2023")
  })

  it("does not say so for a paper that was in the Library, or for one the save could not find", async () => {
    notes.searchCitableRemote.mockResolvedValue([LEE, KIM])
    await open()
    await search("lee")
    await click(container.querySelector('[data-cite="lee-2024"]') as Element)
    await tick(SAVE_DELAY_MS)
    expect(saves()).toHaveLength(1)
    expect(notice()).toBeNull()

    notes.saveNoteRemote.mockResolvedValue(saved("r3", ["kim-2023"]))
    await search("kim")
    await click(container.querySelector('[data-cite="kim-2023"]') as Element)
    await tick(SAVE_DELAY_MS)
    expect(notice()).toBeNull()
    expect(container.querySelector('[data-note-link="paper:kim-2023"]')?.textContent).toContain("not found")
  })

  it("searches from two characters, and closes on Close", async () => {
    notes.searchCitableRemote.mockResolvedValue([])
    await open()
    await search("k")
    expect(notes.searchCitableRemote).not.toHaveBeenCalled()
    await write(container.querySelector('[data-cite-paper] input[type="search"]') as HTMLInputElement, "kx")
    await tick(CITE_DELAY_MS)
    expect(container.querySelector("[data-cite-paper]")?.textContent).toContain("No paper matches.")
    await click(button("Close"))
    expect(container.querySelector("[data-cite-paper]")).toBeNull()
  })

  it("links a condition, and a treatment the feed has seen for it, each in its own form", async () => {
    records.listConditionsRemote.mockResolvedValue([{ code: "adhd", name: "ADHD" }, { code: "depression", name: "Major depressive disorder" }])
    evidence.loadConditionEvidenceRemote.mockResolvedValue({
      classes: [
        { treatments: [{ key: "ketamine", name: "Ketamine" }, { key: "A name, not an id", name: "Unfiled" }] },
        { treatments: [{ key: "ketamine", name: "Ketamine" }] },
      ],
    })
    await open()
    await click(button("Link a condition or treatment"))
    await flush()
    expect([...container.querySelectorAll("[data-condition]")].map((row) => row.textContent)).toEqual(["ADHD", "Major depressive disorder"])
    await click(container.querySelector('[data-condition="adhd"]') as Element)
    await flush()
    expect(evidence.loadConditionEvidenceRemote).toHaveBeenCalledWith("adhd", { period: "all", scope: "all" })
    await click(button("Link ADHD"))
    const withCondition = `${BODY.trimEnd()} [ADHD](/wiki?condition=adhd)\n`
    expect(area().value).toBe(withCondition)
    expect(container.querySelector("[data-link-topic]")).toBeNull()

    await click(button("Link a condition or treatment"))
    await flush()
    await click(container.querySelector('[data-condition="depression"]') as Element)
    await flush()
    expect(container.querySelector("[data-link-topic]")?.textContent).toContain("treatments your feed has seen for this condition")
    expect([...container.querySelectorAll("[data-treatment]")].map((row) => row.textContent)).toEqual(["Ketamine"])
    await click(container.querySelector('[data-treatment="ketamine"]') as Element)
    expect(area().value).toBe(`${BODY.trimEnd()} [ADHD](/wiki?condition=adhd) [Ketamine](/wiki?condition=depression&treatment=ketamine)\n`)
    expect(container.querySelector('[data-note-link="condition:adhd"] a')?.textContent).toBe("ADHD")
    expect(container.querySelector('[data-note-link="treatment:depression/ketamine"] a')?.getAttribute("href")).toBe("/wiki?condition=depression&treatment=ketamine")
  })

  it("still links the condition when its treatments cannot be read", async () => {
    records.listConditionsRemote.mockResolvedValue([{ code: "adhd", name: "ADHD" }])
    evidence.loadConditionEvidenceRemote.mockRejectedValue(new Error("no evidence"))
    await open()
    await click(button("Link a condition or treatment"))
    await flush()
    await click(container.querySelector('[data-condition="adhd"]') as Element)
    await flush()
    expect(container.querySelector('[data-link-topic] [role="alert"]')?.textContent).toBe("no evidence")
    await click(button("Link ADHD"))
    expect(area().value).toContain("[ADHD](/wiki?condition=adhd)")
  })
})

describe("what is under the text", () => {
  it("lists each link of the text as a working link, and a wiki link that resolves to nothing as not found", async () => {
    await open()
    const list = [...container.querySelectorAll("[data-note-link]")].map((item) => [item.getAttribute("data-note-link"), item.textContent, item.querySelector("a")?.getAttribute("href") ?? null])
    expect(list).toEqual([
      ["paper:lee-2024", "Lee 2024", "/paper/lee-2024"],
      ["paper:ghost", "ghost not found", null],
      ["condition:depression", "Major depressive disorder", "/wiki?condition=depression"],
      ["treatment:depression/esketamine", "Esketamine", "/wiki?condition=depression&treatment=esketamine"],
    ])
    expect(container.querySelector("#note-links h2")?.textContent).toBe("Links in this note")
  })

  it("marks a slug a save could not resolve as not found, and drops it when it leaves the text", async () => {
    notes.saveNoteRemote.mockResolvedValue(saved("r2", ["wrong-slug"]))
    await open()
    await write(area(), `${BODY}[[wrong-slug]]\n`)
    await tick(SAVE_DELAY_MS)
    expect(container.querySelector('[data-note-link="paper:wrong-slug"]')?.textContent).toBe("wrong-slug not found")
    await write(area(), BODY)
    expect(container.querySelector('[data-note-link="paper:wrong-slug"]')).toBeNull()
  })

  it("copies the title, the text with its links as labels, and the references, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    await open()
    await click(button("Copy with references"))
    await flush()
    expect(writeText).toHaveBeenCalledWith("# Esketamine in TRD\n\nOn Lee 2024 and ghost.\n\nEsketamine helps.\n\nReferences\n\n1. Lee A. A trial. 2024.\n")
    expect(notice()).toBe("Copied")
    expect(notes.saveNoteRemote).not.toHaveBeenCalled()
  })

  it("saves what is unsaved before it copies, and says when the browser will not copy", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    await open()
    await write(area(), "Short.\n")
    await click(button("Copy with references"))
    await flush()
    expect(saves()).toHaveLength(1)
    expect(writeText).toHaveBeenCalledWith("# Esketamine in TRD\n\nShort.\n")
    expect(notice()).toBe("This could not be copied.")
  })

  it("says how many papers are new since the last edit, lists them on Show, and cites one from there", async () => {
    await open()
    const block = () => container.querySelector("[data-new-papers]")
    expect(block()?.textContent).toContain("1 new paper on these since Oct 5, 2026")
    expect(container.querySelector("[data-new-paper]")).toBeNull()
    await click(button("Show"))
    const row = container.querySelector('[data-new-paper="new-1"]') as HTMLElement
    expect(row.textContent).toContain("Esketamine beat placebo at four weeks")
    expect(row.querySelector("a")?.textContent).toBe("Park 2026")
    expect(row.querySelector("a")?.getAttribute("href")).toBe("/paper/new-1")
    await click(button("Cite"))
    expect(area().value).toBe(`${BODY.trimEnd()} [[new-1|Park 2026]]\n`)
    expect(block()).toBeNull()
  })

  it("hands Delete to its owner once what is unsaved was sent, and shows what the owner asks", async () => {
    await open({ confirm: <div data-testid="confirm" /> })
    expect(container.querySelector("[data-testid=confirm]")).not.toBeNull()
    await write(area(), "Soon gone.\n")
    await click(button("Delete"))
    await flush()
    expect(saves()).toHaveLength(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe("Edit and Preview", () => {
  const empty = () => answer({ summary: summary({ links: { papers: [], conditions: [], treatments: [] }, conditions: [], papers: [], treatments: [], kind: "none" }), body: "", newPapers: [], references: [] })
  const previewLinks = () => [...preview()!.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])

  it("has the two tabs over the text; a note with text opens on Preview, with the field kept out of sight", async () => {
    await open({ asOpened: true })
    const list = container.querySelector('[role="tablist"]') as HTMLElement
    expect(list.getAttribute("aria-label")).toBe("How the text is shown")
    expect([...list.querySelectorAll('[role="tab"]')].map((entry) => entry.textContent)).toEqual(["Edit", "Preview"])
    expect(list.compareDocumentPosition(area()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tabOn()).toBe("preview")
    expect(area().hidden).toBe(true)
    expect(preview()).not.toBeNull()
    expect(notes.saveNoteRemote).not.toHaveBeenCalled()
  })

  it("opens a new or empty note on Edit, and says so when there is nothing to preview", async () => {
    notes.readNoteRemote.mockResolvedValue(empty())
    await open({ asOpened: true })
    expect(tabOn()).toBe("edit")
    expect(area().hidden).toBe(false)
    expect(preview()).toBeNull()
    await click(tab("preview"))
    expect(preview()!.textContent).toBe("Nothing to preview yet.")
  })

  it("shows a cited paper as a link to the paper's page, a wiki link that resolves to nothing marked, and the condition and treatment links", async () => {
    notes.readNoteRemote.mockResolvedValue(answer({ body: `${BODY}\nAlso [depression](/wiki?condition=depression).\n` }))
    await open({ asOpened: true })
    expect(previewLinks()).toEqual([
      ["Lee 2024", "/paper/lee-2024"],
      ["Esketamine", "/wiki?condition=depression&treatment=esketamine"],
      ["depression", "/wiki?condition=depression"],
    ])
    expect(preview()!.textContent).toContain("On Lee 2024 and ghost (not found).")
    expect(preview()!.querySelector("em")!.textContent).toBe("(not found)")
    expect(preview()!.textContent).not.toContain("[[")
  })

  it("marks a slug a save could not resolve in the preview too", async () => {
    notes.readNoteRemote.mockResolvedValue(empty())
    notes.saveNoteRemote.mockResolvedValue(saved("r2", ["nowhere"]))
    await open()
    await write(area(), "See [[nowhere|Nowhere 2020]].")
    await tick(SAVE_DELAY_MS)
    await click(tab("preview"))
    expect(preview()!.textContent).toBe("See Nowhere 2020 (not found).")
    expect(preview()!.querySelector("a")).toBeNull()
  })

  it("shows a formula as it was typed, and keeps the lines of the text", async () => {
    notes.readNoteRemote.mockResolvedValue(answer({ body: "Dose $\\frac{a}{b}$ mg\nthen $$E = mc^2$$.\n" }))
    await open({ asOpened: true })
    expect(preview()!.textContent).toBe("Dose $\\frac{a}{b}$ mg\nthen $$E = mc^2$$.")
    expect(preview()!.className).toContain("whitespace-pre-line")
  })

  it("keeps Links in this note under both tabs", async () => {
    await open({ asOpened: true })
    const under = () => [...container.querySelectorAll("[data-note-link]")].map((item) => item.getAttribute("data-note-link"))
    const both = ["paper:lee-2024", "paper:ghost", "condition:depression", "treatment:depression/esketamine"]
    expect(under()).toEqual(both)
    expect(preview()!.compareDocumentPosition(container.querySelector("#note-links")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await click(tab("edit"))
    expect(under()).toEqual(both)
  })

  it("shows what was typed on Edit when the reader goes to Preview, and saves it once", async () => {
    await open()
    expect(tabOn()).toBe("edit")
    expect(preview()).toBeNull()
    await write(area(), "A **new** line.")
    await click(tab("preview"))
    expect(preview()!.textContent).toBe("A new line.")
    expect(preview()!.querySelector("strong")!.textContent).toBe("new")
    expect(area().value).toBe("A **new** line.")
    expect(notes.saveNoteRemote).not.toHaveBeenCalled()
    await tick(SAVE_DELAY_MS)
    expect(saves()).toEqual([{ id: "esk", title: "Esketamine in TRD", body: "A **new** line.", revision: "r1" }])
    await click(tab("edit"))
    await click(tab("preview"))
    await tick(SAVE_DELAY_MS * 2)
    expect(notes.saveNoteRemote).toHaveBeenCalledTimes(1)
    expect(state()).toBe("saved")
  })

  it("saves nothing when the reader only goes from one tab to the other", async () => {
    await open({ asOpened: true })
    await click(tab("edit"))
    await leaveField(area())
    await click(tab("preview"))
    await tick(SAVE_DELAY_MS * 2)
    expect(notes.saveNoteRemote).not.toHaveBeenCalled()
    expect(area().value).toBe(BODY)
  })

  it("lets a save that is under way finish while the reader is on Preview", async () => {
    const first = deferred<ReturnType<typeof saved>>()
    notes.saveNoteRemote.mockReturnValueOnce(first.promise)
    await open()
    await write(area(), "Sent.")
    await tick(SAVE_DELAY_MS)
    await click(tab("preview"))
    expect(state()).toBe("saving")
    await act(async () => { first.resolve(saved("r2")) })
    await flush()
    expect(state()).toBe("saved")
    expect(preview()!.textContent).toBe("Sent.")
    expect(notes.saveNoteRemote).toHaveBeenCalledTimes(1)
  })

  it("goes to Edit when Cite a paper or Link a condition or treatment is pressed on Preview, and puts the link in the field", async () => {
    notes.searchCitableRemote.mockResolvedValue([{ slug: "kim-2023", label: "Kim 2023", title: "Ketamine in older adults", venue: "JAMA Psychiatry", year: 2023, saved: true }])
    records.listConditionsRemote.mockResolvedValue([])
    await open({ asOpened: true })
    await click(button("Link a condition or treatment"))
    expect(tabOn()).toBe("edit")
    expect(area().hidden).toBe(false)
    await click(tab("preview"))
    await click(button("Cite a paper"))
    expect(tabOn()).toBe("edit")
    expect(container.querySelector("[data-cite-paper]")).not.toBeNull()
    await write(container.querySelector('[data-cite-paper] input[type="search"]') as HTMLInputElement, "ket")
    await tick(CITE_DELAY_MS)
    await click(container.querySelector('[data-cite="kim-2023"]') as Element)
    expect(area().value).toContain("[[kim-2023|Kim 2023]]")
    expect(tabOn()).toBe("edit")
    await click(tab("preview"))
    expect(previewLinks()).toContainEqual(["Kim 2023", "/paper/kim-2023"])
  })

  it("goes to Edit when a new paper is cited from the list above the text on Preview", async () => {
    await open({ asOpened: true })
    await click(button("Show"))
    await click(button("Cite"))
    expect(tabOn()).toBe("edit")
    expect(area().value).toContain("[[new-1|Park 2026]]")
  })
})

describe("a note made by the old button, a captured passage or a project", () => {
  const OLD = "The first line of it\n\nAnd more.\n"
  const old = () => answer({ summary: summary({ title: "The first line of it", links: { papers: [], conditions: [], treatments: [] }, conditions: [], papers: [], treatments: [], kind: "none" }), body: OLD, newPapers: [], references: [] })

  it("opens with an empty title field that hints at the first line, and nothing is written by opening, leaving the fields or leaving the page", async () => {
    notes.readNoteRemote.mockResolvedValue(old())
    await open({ untitled: true })
    expect(titleField().value).toBe("")
    expect(titleField().placeholder).toBe("The first line of it")
    expect(area().value).toBe(OLD)
    expect(container.querySelector("[data-chip]")).toBeNull()
    expect(container.querySelector("#note-links")).toBeNull()
    await leaveField(titleField())
    await leaveField(area())
    await tick(3 * SAVE_DELAY_MS)
    expect(guarded()).toBe(false)
    act(() => root!.unmount())
    root = null
    expect(notes.saveNoteRemote).not.toHaveBeenCalled()
  })

  it("keeps having no title when only its text is edited", async () => {
    notes.readNoteRemote.mockResolvedValue(old())
    await open({ untitled: true })
    await write(area(), `${OLD}A new line.\n`)
    await tick(SAVE_DELAY_MS)
    expect(saves()).toEqual([{ id: "esk", title: "", body: `${OLD}A new line.\n`, revision: "r1" }])
  })

  it("keeps a real title that happens to equal the first line", async () => {
    notes.readNoteRemote.mockResolvedValue(old())
    await open({ untitled: false })
    expect(titleField().value).toBe("The first line of it")
    await write(area(), `${OLD}A new line.\n`)
    await tick(SAVE_DELAY_MS)
    expect(saves()[0].title).toBe("The first line of it")
  })
})

describe("the final fix wave: a note never loses text", () => {
  const stored = { conflict: true as const, title: "Stored title", untitled: false, body: "Stored text.\n", revision: "r9" }
  const ADHD = "[ADHD](/wiki?condition=adhd)\n"
  const press = async (element: Element) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
    await act(async () => { element.dispatchEvent(event) })
    return event
  }

  it("A1: saves what was typed while the chips were being read again, with no further keystroke", async () => {
    await open()
    const reading = deferred<NoteAnswer>()
    notes.readNoteRemote.mockReturnValueOnce(reading.promise)
    await write(area(), ADHD)
    await tick(SAVE_DELAY_MS)
    expect(saves()).toHaveLength(1)
    expect(notes.readNoteRemote).toHaveBeenCalledTimes(2)
    notes.saveNoteRemote.mockResolvedValue(saved("r3"))
    await write(area(), `${ADHD}More.\n`)
    await tick(SAVE_DELAY_MS)
    expect(saves()).toHaveLength(2)
    expect(saves()[1]).toEqual({ id: "esk", title: "Esketamine in TRD", body: `${ADHD}More.\n`, revision: "r2" })
    expect(state()).toBe("saved")
    await act(async () => { reading.resolve(answer({ body: ADHD })) })
    expect(area().value).toBe(`${ADHD}More.\n`)
  })

  it("A1: shows the newest reading of the chips when an older one answers last", async () => {
    await open()
    const first = deferred<NoteAnswer>()
    notes.readNoteRemote.mockReturnValueOnce(first.promise)
    await write(area(), ADHD)
    await tick(SAVE_DELAY_MS)
    notes.readNoteRemote.mockResolvedValueOnce(answer({ summary: summary({ conditions: [{ code: "ocd", name: "OCD" }], treatments: [], papers: [] }), body: "[OCD](/wiki?condition=ocd)\n", references: [] }))
    await write(area(), "[OCD](/wiki?condition=ocd)\n")
    await tick(SAVE_DELAY_MS)
    await act(async () => { first.resolve(answer({ summary: summary({ conditions: [{ code: "adhd", name: "ADHD" }], treatments: [], papers: [] }), body: ADHD, references: [] })) })
    expect([...container.querySelectorAll("[data-chip]")].map((chip) => chip.textContent)).toEqual(["OCD"])
  })

  it("A2: a link inside the page does not take the reader away while a conflict holds their text; the card is brought to them", async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    notes.saveNoteRemote.mockResolvedValueOnce(stored)
    await open()
    await write(area(), `${BODY}Mine.\n`)
    await tick(SAVE_DELAY_MS)
    const card = container.querySelector("[data-note-conflict]") as HTMLElement
    for (const text of ["← Notes", "Ask about this note", "Major depressive disorder"]) {
      scrolled.mockClear()
      ;(document.activeElement as HTMLElement | null)?.blur()
      const event = await press(anchor(text))
      expect(event.defaultPrevented, text).toBe(true)
      expect(scrolled, text).toHaveBeenCalledTimes(1)
      expect(document.activeElement, text).toBe(card)
    }
    await click(tab("preview"))
    const inPreview = preview()!.querySelector("a") as HTMLAnchorElement
    expect((await press(inPreview)).defaultPrevented).toBe(true)
    await click(button("Show"))
    expect((await press(container.querySelector("[data-new-paper] a, [data-new-papers] a") ?? anchor("← Notes"))).defaultPrevented).toBe(true)
    expect(nav.push).not.toHaveBeenCalled()
    expect(saves()).toHaveLength(1)
    // Once the reader has taken the stored text nothing of theirs is held, and the links work again.
    await click(button("Use the stored one"))
    expect((await press(anchor("← Notes"))).defaultPrevented).toBe(false)
  })

  it("A3: sends what is unsaved when the browser hides the page, in a request that outlives it", async () => {
    await open()
    await write(area(), "Typed, then the tab was closed.\n")
    await act(async () => { window.dispatchEvent(new Event("pagehide")) })
    expect(notes.saveNoteRemote.mock.calls[0]).toEqual([{ id: "esk", title: "Esketamine in TRD", body: "Typed, then the tab was closed.\n", revision: "r1" }, undefined, { keepalive: true }])
    await flush()
    // A page that is shown again (the back-forward cache) saves as before.
    await act(async () => { window.dispatchEvent(new Event("pageshow")) })
    await write(area(), "Back again.\n")
    await tick(SAVE_DELAY_MS)
    expect(notes.saveNoteRemote.mock.calls[1][2]).toEqual({})
    expect(guarded()).toBe(false)
  })

  it("A3: keeps a draft in the browser while text is unsaved or could not be saved, and drops it once saved", async () => {
    notes.saveNoteRemote.mockRejectedValueOnce(new Error("The disk is full.")).mockResolvedValue(saved("r2"))
    await open()
    expect(readDraft("esk")).toBeNull()
    await write(titleField(), "A draft title")
    await write(area(), "A draft.\n")
    expect(readDraft("esk")).toEqual({ title: "A draft title", body: "A draft.\n", revision: "r1" })
    await tick(SAVE_DELAY_MS)
    expect(container.querySelector("[data-note-state]")?.textContent).toBe("The disk is full.")
    expect(readDraft("esk")).toEqual({ title: "A draft title", body: "A draft.\n", revision: "r1" })
    await click(button("Retry"))
    await flush()
    expect(state()).toBe("saved")
    expect(readDraft("esk")).toBeNull()
    await write(area(), BODY)
    await write(titleField(), "A draft title")
    expect(readDraft("esk")).toEqual({ title: "A draft title", body: BODY, revision: "r2" })
  })

  it("A3: opens with a draft typed over the stored version as unsaved text, and saves it", async () => {
    writeDraft("esk", { title: "Esketamine in TRD", body: "Typed before the reload.\n", revision: "r1" })
    await open()
    expect(area().value).toBe("Typed before the reload.\n")
    expect(tabOn()).toBe("edit")
    expect(container.querySelector("[data-note-conflict]")).toBeNull()
    await flush()
    expect(saves()).toEqual([{ id: "esk", title: "Esketamine in TRD", body: "Typed before the reload.\n", revision: "r1" }])
    expect(state()).toBe("saved")
    expect(readDraft("esk")).toBeNull()
  })

  it("A3: opens with a draft typed over another version as a conflict, the draft as the reader's text", async () => {
    writeDraft("esk", { title: "My title", body: "Typed over an older version.\n", revision: "r0" })
    await open()
    expect(container.querySelector("[data-note-conflict]")).not.toBeNull()
    expect(area().value).toBe("Typed over an older version.\n")
    expect(titleField().value).toBe("My title")
    expect(container.querySelector("[data-note-stored]")?.textContent).toContain("Esketamine in TRD")
    expect(container.querySelector("[data-note-stored]")?.textContent).toContain("Esketamine")
    await tick(3 * SAVE_DELAY_MS)
    expect(saves()).toHaveLength(0)
    expect(guarded()).toBe(true)
    expect(readDraft("esk")).toEqual({ title: "My title", body: "Typed over an older version.\n", revision: "r0" })
    await click(button("Keep mine"))
    await flush()
    expect(saves()).toEqual([{ id: "esk", title: "My title", body: "Typed over an older version.\n", revision: "r1" }])
    expect(readDraft("esk")).toBeNull()
  })

  it("A3: takes the stored text over such a draft on \"Use the stored one\", and forgets the draft", async () => {
    writeDraft("esk", { title: "My title", body: "Typed over an older version.\n", revision: "r0" })
    await open()
    await click(button("Use the stored one"))
    await flush()
    expect(area().value).toBe(BODY)
    expect(titleField().value).toBe("Esketamine in TRD")
    expect(readDraft("esk")).toBeNull()
    expect(saves()).toHaveLength(0)
    expect(guarded()).toBe(false)
  })

  it("A3: forgets a draft that says what is stored, and opens as usual", async () => {
    writeDraft("esk", { title: "Esketamine in TRD", body: BODY, revision: "r0" })
    await open({ asOpened: true })
    expect(tabOn()).toBe("preview")
    expect(readDraft("esk")).toBeNull()
    expect(container.querySelector("[data-note-conflict]")).toBeNull()
    await tick(2 * SAVE_DELAY_MS)
    expect(saves()).toHaveLength(0)
  })

  it("A4: says a paper was saved to the Library whenever a save put one there: typed by hand, or cited from the new papers", async () => {
    notes.saveNoteRemote.mockResolvedValue(saved("r2", [], ["typed-2025"]))
    await open()
    await write(area(), `${BODY}And [[typed-2025]].\n`)
    expect(notice()).toBeNull()
    await tick(SAVE_DELAY_MS)
    expect(notice()).toBe("Saved to your Library")

    notes.saveNoteRemote.mockResolvedValue(saved("r3", [], ["new-1"]))
    await click(button("Show"))
    await click(button("Cite"))
    expect(notice()).toBeNull()
    await tick(SAVE_DELAY_MS)
    expect(saves()[1].body).toContain("[[new-1|Park 2026]]")
    expect(notice()).toBe("Saved to your Library")

    notes.saveNoteRemote.mockResolvedValue(saved("r4"))
    await write(area(), "Nothing cited.\n")
    await tick(SAVE_DELAY_MS)
    expect(notice()).toBeNull()
  })

  it("A6: \"Keep mine\" sends the reader's text even when it is what was last saved from here", async () => {
    await open()
    await write(area(), "A.\n")
    await tick(SAVE_DELAY_MS)
    notes.saveNoteRemote.mockResolvedValueOnce(stored).mockResolvedValue(saved("r10"))
    await write(area(), "A, more.\n")
    await tick(SAVE_DELAY_MS)
    expect(container.querySelector("[data-note-conflict]")).not.toBeNull()
    await write(area(), "A.\n")
    await click(button("Keep mine"))
    await flush()
    expect(saves()).toHaveLength(3)
    expect(saves()[2]).toEqual({ id: "esk", title: "Esketamine in TRD", body: "A.\n", revision: "r9" })
    expect(state()).toBe("saved")
  })

  it("A6: \"Use the stored one\" leaves the title empty for a stored note that has none, whatever its first line", async () => {
    notes.saveNoteRemote.mockResolvedValueOnce({ ...stored, title: "Stored text.", untitled: true })
    await open()
    await write(area(), "Mine.\n")
    await tick(SAVE_DELAY_MS)
    await click(button("Use the stored one"))
    expect(titleField().value).toBe("")
    expect(area().value).toBe("Stored text.\n")
  })

  it("A6: \"Use the stored one\" takes a real title that equals the first line, also for a note that had none here", async () => {
    notes.saveNoteRemote.mockResolvedValueOnce({ ...stored, title: "Stored text.", untitled: false })
    await open({ untitled: true })
    await write(area(), "Mine.\n")
    await tick(SAVE_DELAY_MS)
    await click(button("Use the stored one"))
    expect(titleField().value).toBe("Stored text.")
  })

  it("A6: a conflict that says what was just sent is a lost answer: the stored revision is taken and nothing is asked", async () => {
    notes.saveNoteRemote.mockResolvedValueOnce({ conflict: true as const, title: "Esketamine in TRD", untitled: false, body: "Sent once.\n", revision: "r5" }).mockResolvedValue(saved("r6"))
    await open()
    await write(area(), "Sent once.\n")
    await tick(SAVE_DELAY_MS)
    expect(container.querySelector("[data-note-conflict]")).toBeNull()
    expect(state()).toBe("saved")
    expect(saves()).toHaveLength(1)
    expect(readDraft("esk")).toBeNull()
    await write(area(), "Sent once. And more.\n")
    await tick(SAVE_DELAY_MS)
    expect(saves()[1]).toEqual({ id: "esk", title: "Esketamine in TRD", body: "Sent once. And more.\n", revision: "r5" })
  })

  it("A6: the same for a note without a title, and not when only the text is the same", async () => {
    notes.saveNoteRemote.mockResolvedValueOnce({ conflict: true as const, title: "Sent once.", untitled: true, body: "Sent once.\n", revision: "r5" })
    await open({ untitled: true })
    await write(area(), "Sent once.\n")
    await tick(SAVE_DELAY_MS)
    expect(container.querySelector("[data-note-conflict]")).toBeNull()
    act(() => root!.unmount())

    notes.saveNoteRemote.mockReset()
    notes.saveNoteRemote.mockResolvedValueOnce({ conflict: true as const, title: "Another title", untitled: false, body: "Sent once.\n", revision: "r5" })
    await open()
    await write(area(), "Sent once.\n")
    await tick(SAVE_DELAY_MS)
    expect(container.querySelector("[data-note-conflict]")).not.toBeNull()
  })

  it("A7: shows the route's words for a note that is too long, and keeps the text", async () => {
    notes.saveNoteRemote.mockRejectedValue(new Error(CLINICAL_COPY.notes.tooLong))
    await open()
    await write(area(), "Far too long.\n")
    await tick(SAVE_DELAY_MS)
    expect(container.querySelector('[data-note-state="failed"]')?.textContent).toBe("This note is too long to save. Shorten it, or move part of it to another note.")
    expect(area().value).toBe("Far too long.\n")
    expect(readDraft("esk")?.body).toBe("Far too long.\n")
  })

  it("A8: a paper linked by its path is a link in the list and in the preview", async () => {
    notes.readNoteRemote.mockResolvedValue(answer({ body: "On [[wiki/papers/lee-2024]] and [[wiki/papers/ghost.md|Ghost]].\n", summary: summary({ conditions: [], treatments: [] }) }))
    await open({ asOpened: true })
    expect(container.querySelector('[data-note-link="paper:lee-2024"] a')?.getAttribute("href")).toBe("/paper/lee-2024")
    expect(container.querySelector('[data-note-link="paper:ghost"]')?.textContent).toContain("not found")
    const links = [...preview()!.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])
    expect(links).toEqual([["Lee 2024", "/paper/lee-2024"]])
    expect(preview()!.textContent).toContain("Ghost (not found)")
  })

  it("A8: a label with the marks of emphasis or code is shown as text in the preview", async () => {
    notes.readNoteRemote.mockResolvedValue(answer({ body: "[[lee-2024|Lee *2024* `x`]] and [[ghost|*G* `g`]]\n", summary: summary({ conditions: [], treatments: [] }) }))
    await open({ asOpened: true })
    expect(preview()!.querySelector("code")).toBeNull()
    expect([...preview()!.querySelectorAll("em")].map((mark) => mark.textContent)).toEqual(["(not found)"])
    expect(preview()!.querySelector("a")?.getAttribute("href")).toBe("/paper/lee-2024")
  })
})
