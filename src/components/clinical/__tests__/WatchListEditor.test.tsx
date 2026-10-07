// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { loadClinicalSettings, loadWatchEntries, saveWatchEntries } from "@/lib/clinical/watch/store"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { vault } = vi.hoisted(() => ({ vault: { current: null as unknown } }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => vault.current }))

import { WatchListEditor } from "../WatchListEditor"

// The My topics page, redone on the owner's request of 2026-10-07: the topics you have and the form to
// add one are two separate sections; fields are short, suggest as you type, and Enter adds the topic.

const SUGGESTIONS = {
  conditions: ["Major depressive disorder", "Schizophrenia", "ADHD", "Autism spectrum disorder"],
  treatments: ["Esketamine", "Ketamine", "Methylphenidate"],
  populations: ["Adults", "Children and adolescents"],
  conditionAliases: ["depression", "autism", "attention deficit hyperactivity disorder"],
  treatmentAliases: ["Spravato"],
  aliasOf: { "attention deficit hyperactivity disorder": "ADHD", depression: "Major depressive disorder", autism: "Autism spectrum disorder", Spravato: "Esketamine" },
}

let container: HTMLDivElement
async function mount() {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<WatchListEditor suggestions={SUGGESTIONS} />) })
  await act(async () => {})
}
const storage = () => vault.current as MemoryVaultStorage
const field = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const button = (text: string) => [...container.querySelectorAll("button")].find((entry) => entry.textContent === text) as HTMLButtonElement
const type = async (input: HTMLInputElement | HTMLSelectElement, value: string) => act(async () => {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
})
const click = async (element: HTMLElement) => act(async () => { element.click() })
const enter = async (input: HTMLInputElement) => act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
const rows = () => [...container.querySelectorAll("[data-testid=topic-row]")]

beforeEach(() => { document.body.innerHTML = ""; vault.current = new MemoryVaultStorage() })

describe("My topics", () => {
  it("has two sections: the topics you follow, and adding one", async () => {
    await saveWatchEntries(storage(), [{ id: "w1", condition: "Schizophrenia", priority: "normal", safetySignal: false }])
    await mount()
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(["Your topics", "Add a topic", "Which studies to include"])
    expect(rows()).toHaveLength(1)
    expect(rows()[0].querySelector("[data-topic-name]")!.textContent).toBe("Schizophrenia")
  })

  it("says so when you follow nothing yet", async () => {
    await mount()
    expect(container.textContent).toContain("You are not following any topic yet")
  })

  it("adds a topic with a condition and a treatment, from the button", async () => {
    await mount()
    await type(field("Condition"), "Major depressive disorder")
    await type(field("Treatment (optional)"), "Esketamine")
    expect(container.querySelector("[data-testid=topic-preview]")!.textContent).toContain("Major depressive disorder × Esketamine")
    await click(button("Add topic"))
    expect(await loadWatchEntries(storage())).toMatchObject([{ condition: "Major depressive disorder", treatment: "Esketamine", priority: "normal" }])
    expect(rows()[0].querySelector("[data-topic-name]")!.textContent).toBe("Major depressive disorder × Esketamine")
    expect(field("Condition").value).toBe("")
  })

  it("adds a topic with only a condition, by pressing Enter", async () => {
    await mount()
    await type(field("Condition"), "Schizophrenia")
    await enter(field("Condition"))
    expect(await loadWatchEntries(storage())).toMatchObject([{ condition: "Schizophrenia" }])
    expect((await loadWatchEntries(storage()))[0].treatment).toBeUndefined()
  })

  it("refuses an empty topic", async () => {
    await mount()
    await click(button("Add topic"))
    expect(await loadWatchEntries(storage())).toEqual([])
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Enter a condition, a treatment, or both")
  })

  it("suggests names right under the field as you type, and fills the field when one is picked", async () => {
    await mount()
    await type(field("Treatment (optional)"), "ke")
    const options = [...container.querySelectorAll('[data-testid=suggestions-treatment] [role="option"]')] as HTMLElement[]
    expect(options.map((option) => option.textContent)).toEqual(["Ketamine", "Esketamine"])
    await act(async () => { options[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true })) })
    expect(field("Treatment (optional)").value).toBe("Esketamine")
    expect(container.querySelector("[data-testid=suggestions-treatment]")).toBeNull()
  })

  it("asks about a likely misspelling before adding, and uses the correction when told to", async () => {
    await mount()
    await type(field("Treatment (optional)"), "esketamin")
    await click(button("Add topic"))
    expect(await loadWatchEntries(storage())).toEqual([])
    expect(container.querySelector("[data-testid=spelling-check]")!.textContent).toContain("Did you mean Esketamine?")
    await click(button("Use Esketamine"))
    expect(await loadWatchEntries(storage())).toMatchObject([{ treatment: "Esketamine" }])
  })

  it("keeps an unusual term as typed when told to", async () => {
    await mount()
    await type(field("Condition"), "Schizophernia")
    await click(button("Add topic"))
    await click(button("Keep “Schizophernia”"))
    expect(await loadWatchEntries(storage())).toMatchObject([{ condition: "Schizophernia" }])
  })

  it("adds a second condition that must also be present, or either of the two", async () => {
    await mount()
    await type(field("Condition"), "ADHD")
    expect(container.querySelector('input[aria-label="Second condition"]')).toBeNull()
    await click(button("+ Add a second condition"))
    await type(field("Second condition"), "Autism spectrum disorder")
    expect(container.querySelector("[data-testid=topic-preview]")!.textContent).toContain("ADHD + Autism spectrum disorder")
    await click(button("Either one"))
    expect(container.querySelector("[data-testid=topic-preview]")!.textContent).toContain("ADHD or Autism spectrum disorder")
    await click(button("Add topic"))
    expect(await loadWatchEntries(storage())).toMatchObject([{ condition: "ADHD", condition2: "Autism spectrum disorder", conditionJoin: "or" }])
  })

  it("changes a topic's priority, pauses it and removes it from its row", async () => {
    await saveWatchEntries(storage(), [{ id: "w1", condition: "Schizophrenia", priority: "normal", safetySignal: false }, { id: "w2", condition: "ADHD", priority: "normal", safetySignal: false }])
    await mount()
    await type(rows()[0].querySelector("select") as HTMLSelectElement, "high")
    expect((await loadWatchEntries(storage()))[0].priority).toBe("high")
    await type(rows()[0].querySelector("select") as HTMLSelectElement, "paused")
    expect((await loadWatchEntries(storage()))[0].priority).toBe("paused")
    await click([...rows()[1].querySelectorAll("button")].find((entry) => entry.textContent === "Remove") as HTMLButtonElement)
    expect((await loadWatchEntries(storage())).map((entry) => entry.id)).toEqual(["w1"])
  })

  it("offers three plainly named choices of which studies to include, and saves the one picked", async () => {
    await mount()
    const group = container.querySelector('[role="group"][aria-label="Which studies to include"]')!
    const choices = [...group.querySelectorAll("button")] as HTMLButtonElement[]
    expect(choices.map((choice) => choice.querySelector("[data-choice-title]")!.textContent)).toEqual(["Strict", "Standard", "Everything"])
    expect(choices[1].getAttribute("aria-pressed")).toBe("true")
    await click(choices[0])
    expect(await loadClinicalSettings(storage())).toMatchObject({ strictness: "strict" })
    expect(choices[0].getAttribute("aria-pressed")).toBe("true")
  })

  it("keeps the fields short and the type large enough to read", async () => {
    await mount()
    expect(field("Condition").className).toContain("max-w-")
    expect(container.querySelector("h2")!.className).toContain("text-espresso")
  })

  // Owner follow-up 2026-10-07.
  it("shows every field of a new topic in one block, with no hidden options", async () => {
    await mount()
    expect(container.querySelector("details")).toBeNull()
    for (const label of ["Condition", "Treatment (optional)"]) expect(field(label)).not.toBeNull()
    expect(container.querySelector('select[aria-label="Patient group (optional)"]')).not.toBeNull()
    expect(container.querySelector('select[aria-label="Priority"]')).not.toBeNull()
    await type(field("Condition"), "Schizophrenia")
    await type(container.querySelector<HTMLSelectElement>('select[aria-label="Priority"]')!, "high")
    await type(container.querySelector<HTMLSelectElement>('select[aria-label="Patient group (optional)"]')!, "Adults")
    await click(button("Add topic"))
    expect(await loadWatchEntries(storage())).toMatchObject([{ condition: "Schizophrenia", priority: "high", population: "Adults" }])
  })

  it("finds a condition by its spelled-out name as well as by its short one", async () => {
    await mount()
    await type(field("Condition"), "attention def")
    const options = [...container.querySelectorAll('[data-testid=suggestions-condition] [role="option"]')] as HTMLElement[]
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain("ADHD")
    expect(options[0].textContent).toContain("attention deficit hyperactivity disorder")
    await act(async () => { options[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true })) })
    expect(field("Condition").value).toBe("ADHD")
  })
})
