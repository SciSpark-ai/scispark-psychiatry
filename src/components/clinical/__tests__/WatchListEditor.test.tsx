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

const suggestions = { conditions: ["Major depressive disorder"], treatments: ["Esketamine"], populations: ["Adults", "Older adults"] }
let container: HTMLDivElement

async function mount() {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<WatchListEditor suggestions={suggestions} />) })
  await act(async () => {})
}
const type = (input: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
}
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text)!

beforeEach(() => { document.body.innerHTML = ""; vault.current = new MemoryVaultStorage() })

describe("WatchListEditor", () => {
  it("adds an entry with a condition, a treatment and a priority", async () => {
    await mount()
    const [condition, treatment] = [...container.querySelectorAll("input[list]")] as HTMLInputElement[]
    await act(async () => { type(condition, "depression"); type(treatment, "esketamine") })
    await act(async () => { type(container.querySelectorAll("select")[1] as HTMLSelectElement, "high") })
    await act(async () => { button("Add entry").click() })
    const saved = await loadWatchEntries(vault.current as MemoryVaultStorage)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ condition: "depression", treatment: "esketamine", priority: "high" })
    expect(container.textContent).toContain("depression × esketamine")
  })

  it("refuses an empty entry", async () => {
    await mount()
    await act(async () => { button("Add entry").click() })
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/condition, a treatment, or both/)
    expect(await loadWatchEntries(vault.current as MemoryVaultStorage)).toEqual([])
  })

  it("pauses and removes entries", async () => {
    await saveWatchEntries(vault.current as MemoryVaultStorage, [{ id: "w1", condition: "ptsd", priority: "normal", safetySignal: false }])
    await mount()
    await act(async () => { type(container.querySelector('select[aria-label^="Priority: ptsd"]') as HTMLSelectElement, "paused") })
    expect((await loadWatchEntries(vault.current as MemoryVaultStorage))[0].priority).toBe("paused")
    await act(async () => { button("Remove").click() })
    expect(await loadWatchEntries(vault.current as MemoryVaultStorage)).toEqual([])
  })

  it("saves the mode, the catch up window and the design filter", async () => {
    await mount()
    await act(async () => { (container.querySelectorAll('input[name="mode"]')[1] as HTMLInputElement).click() })
    const [months, strictness] = [...container.querySelectorAll("fieldset ~ label select")] as HTMLSelectElement[]
    await act(async () => { type(months, "3") })
    await act(async () => { type(strictness, "strict") })
    expect(await loadClinicalSettings(vault.current as MemoryVaultStorage)).toMatchObject({ mode: "catch-up", strictness: "strict", catchUpMonths: 3 })
  })
})
