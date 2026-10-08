// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { conditionBlock } from "@/lib/clinical/records/query"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const vault = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => vault }))
const records = vi.hoisted(() => ({ createConditionPageRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => records)

import { ConditionNotes } from "../ConditionNotes"

const P = CLINICAL_COPY.records.conditionPage
const ID = "wiki/conditions/schizophrenia"
const TOP = `---\ntype: condition\ntitle: Schizophrenia\n---\n## ${P.evidence}\n\n${conditionBlock("schizophrenia")}\n\n`
const pageWith = (notes: string) => `${TOP}## ${P.notes}\n\n${notes}\n`

let container: HTMLDivElement
async function render(pageId: string | null) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<ConditionNotes code="schizophrenia" pageId={pageId} />) })
  await act(async () => {})
}
const area = () => container.querySelector("textarea") as HTMLTextAreaElement
const button = () => container.querySelector("button") as HTMLButtonElement
async function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  await act(async () => { setter.call(area(), text); area().dispatchEvent(new Event("input", { bubbles: true })) })
}
const save = async () => { await act(async () => { button().click() }); await act(async () => {}) }
beforeEach(() => { document.body.innerHTML = ""; vault.read.mockReset(); vault.write.mockReset(); records.createConditionPageRemote.mockReset() })

describe("the notes on a condition", () => {
  it("loads the notes of the condition's page, with Save disabled while nothing changed", async () => {
    vault.read.mockResolvedValue(pageWith("Clozapine after two failures."))
    await render(ID)
    expect(vault.read).toHaveBeenCalledWith(`${ID}.md`)
    expect(area().value).toBe("Clozapine after two failures.")
    expect(area().getAttribute("aria-label")).toBe("My notes")
    expect(button().textContent).toBe("Save")
    expect(button().disabled).toBe(true)
  })

  it("shows the template's hint as a placeholder, not as notes", async () => {
    vault.read.mockResolvedValue(pageWith(P.notesHint))
    await render(ID)
    expect(area().value).toBe("")
    expect(area().placeholder).toBe(P.notesHint)
  })

  it("saves the edited notes into the page as it now stands, changing nothing else, and says so", async () => {
    vault.read.mockResolvedValue(pageWith("Old."))
    vault.write.mockResolvedValue(undefined)
    await render(ID)
    await type("New notes.")
    expect(button().disabled).toBe(false)
    await save()
    expect(vault.write).toHaveBeenCalledWith(`${ID}.md`, pageWith("New notes."))
    expect(container.querySelector('[role="status"]')!.textContent).toBe("Saved")
    expect(button().disabled).toBe(true)
    expect(records.createConditionPageRemote).not.toHaveBeenCalled()
  })

  it("makes the page on the first save when the condition has none", async () => {
    await render(null)
    expect(vault.read).not.toHaveBeenCalled()
    expect(area().value).toBe("")
    records.createConditionPageRemote.mockResolvedValue({ id: ID, created: true })
    vault.read.mockResolvedValue(pageWith(P.notesHint))
    vault.write.mockResolvedValue(undefined)
    await type("First note.")
    await save()
    expect(records.createConditionPageRemote).toHaveBeenCalledWith("schizophrenia")
    expect(vault.write).toHaveBeenCalledWith(`${ID}.md`, pageWith("First note."))
    // the page is there now: a second save does not ask for it again
    vault.read.mockResolvedValue(pageWith("First note."))
    await type("Second note.")
    await save()
    expect(records.createConditionPageRemote).toHaveBeenCalledTimes(1)
    expect(vault.write).toHaveBeenLastCalledWith(`${ID}.md`, pageWith("Second note."))
  })

  it("shows the message of a save that failed and keeps the reader's text", async () => {
    vault.read.mockResolvedValue(pageWith("Old."))
    vault.write.mockRejectedValue(new Error("The page was changed by someone else (version conflict)."))
    await render(ID)
    await type("My long text.")
    await save()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("version conflict")
    expect(area().value).toBe("My long text.")
    expect(button().disabled).toBe(false)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it("does not write over notes that changed since they were opened: it says so, shows them, and keeps the reader's text", async () => {
    vault.read.mockResolvedValue(pageWith("Old."))
    await render(ID)
    await type("Mine.")
    vault.read.mockResolvedValue(pageWith("Written elsewhere."))
    await save()
    expect(vault.write).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(CLINICAL_COPY.evidence.notes.conflict)
    expect(container.querySelector("[data-stored-notes]")!.textContent).toBe("Written elsewhere.")
    expect(area().value).toBe("Mine.")
    // pressing Save again replaces the version that was shown
    vault.write.mockResolvedValue(undefined)
    await save()
    expect(vault.write).toHaveBeenCalledWith(`${ID}.md`, pageWith("Mine."))
    expect(container.querySelector("[data-stored-notes]")).toBeNull()
  })

  it("shows no text area when the page cannot be loaded", async () => {
    vault.read.mockRejectedValue(new Error("The vault could not be reached."))
    await render(ID)
    expect(container.querySelector("textarea")).toBeNull()
    expect(container.querySelector("button")).toBeNull()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("The vault could not be reached.")
  })
})
