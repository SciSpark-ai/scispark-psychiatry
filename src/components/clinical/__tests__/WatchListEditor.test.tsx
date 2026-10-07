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

  // Owner decision 2026-10-06: What's new / Catch up and its window are chosen on Home, not here.
  it("saves the design filter, and no longer offers the feed mode", async () => {
    await mount()
    expect(container.querySelector('input[name="mode"]')).toBeNull()
    const strictness = container.querySelector<HTMLSelectElement>('select[aria-label="Study design filter"]')!
    await act(async () => { type(strictness, "strict") })
    expect(await loadClinicalSettings(vault.current as MemoryVaultStorage)).toMatchObject({ strictness: "strict" })
  })

  // Owner decision 2026-10-07: a topic may name two conditions, joined by AND or OR.
  it("adds a topic with two conditions that must both be present, by default", async () => {
    await mount()
    const condition = container.querySelector<HTMLInputElement>("input[list]")!
    await act(async () => { type(condition, "ADHD") })
    const second = container.querySelector<HTMLInputElement>('input[aria-label="Second condition (optional)"]')!
    await act(async () => { type(second, "Autism") })
    await act(async () => { button("Add entry").click() })
    const saved = await loadWatchEntries(vault.current as MemoryVaultStorage)
    expect(saved[0]).toMatchObject({ condition: "ADHD", condition2: "Autism", conditionJoin: "and" })
    expect(container.textContent).toContain("ADHD + Autism")
  })

  it("adds a topic where either of two conditions is enough", async () => {
    await mount()
    await act(async () => { type(container.querySelector<HTMLInputElement>("input[list]")!, "ADHD") })
    await act(async () => { type(container.querySelector<HTMLInputElement>('input[aria-label="Second condition (optional)"]')!, "Autism") })
    await act(async () => { type(container.querySelector<HTMLSelectElement>('select[aria-label="How the two conditions combine"]')!, "or") })
    await act(async () => { button("Add entry").click() })
    expect((await loadWatchEntries(vault.current as MemoryVaultStorage))[0]).toMatchObject({ condition2: "Autism", conditionJoin: "or" })
    expect(container.textContent).toContain("ADHD or Autism")
  })

  it("does not keep a second condition without a first", async () => {
    await mount()
    const treatment = ([...container.querySelectorAll("input[list]")] as HTMLInputElement[])[1]
    await act(async () => { type(treatment, "Methylphenidate") })
    await act(async () => { button("Add entry").click() })
    const saved = await loadWatchEntries(vault.current as MemoryVaultStorage)
    expect(saved[0].condition2).toBeUndefined()
    expect(saved[0].conditionJoin).toBeUndefined()
  })
})
