// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { saveWatchEntries, loadClinicalSettings } from "@/lib/clinical/watch/store"
import { saveClinicalFeed, type StoredFeed, type StoredFeedItem } from "@/lib/clinical/feed/stored"
import { loadFeedback } from "@/lib/clinical/feedback/store"
import { loadReadLater } from "@/lib/clinical/readlater/store"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { vault, refreshMock } = vi.hoisted(() => ({ vault: { current: null as unknown }, refreshMock: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => vault.current }))
vi.mock("@/lib/clinical/feed/client", () => ({ refreshClinicalFeed: refreshMock }))
vi.mock("@/lib/papers/save-client", () => ({ savePaper: vi.fn(async () => ({ saved: true, slug: "s" })) }))

import { ClinicalHome } from "../ClinicalHome"

const item = (n: number, over: Partial<StoredFeedItem> = {}): StoredFeedItem => ({
  paper: { ids: { pmid: String(n) }, title: `Paper ${n}`, abstract: `Finding ${n}. More text.`, authors: [], fields: [], source: "pubmed", date: "2026-09-20" },
  key: `pmid:${n}`, design: "randomized-trial", designSource: "publication-type", entryId: "w1", grade: 4, topicGrade: 4,
  quote: "a verbatim quote", quoteVerified: true, ungraded: false, score: 90 - n, flags: [], ...over,
})
const feedOf = (items: StoredFeedItem[], extra: Partial<StoredFeed> = {}): StoredFeed => ({
  version: 1, generatedAt: "2026-10-06T10:00:00.000Z", mode: "whats-new", strictness: "standard", items, lowerConfidence: [], safetySignals: [],
  stats: { retrieved: 99, domain: 50, gated: 30, graded: 30, listed: items.length }, costUsd: 0.1, warnings: [], ...extra,
})

let container: HTMLDivElement
let root: Root
async function mount() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<ClinicalHome />) })
  await act(async () => {})
}
const buttons = () => [...container.querySelectorAll("button")]
const byText = (text: string) => buttons().find((button) => button.textContent?.includes(text))!

beforeEach(() => {
  document.body.innerHTML = ""
  refreshMock.mockReset()
  vault.current = new MemoryVaultStorage()
})

describe("ClinicalHome", () => {
  it("asks for a watch list when there are no entries", async () => {
    await mount()
    expect(container.textContent).toContain("Add the conditions and treatments you follow")
    expect(container.querySelector('a[href="/watch"]')).not.toBeNull()
    expect((byText("Refresh") as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows the stored list twelve at a time, with a design badge and the matched entry", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", treatment: "esketamine", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf(Array.from({ length: 30 }, (_, i) => item(i))))
    await mount()
    expect(container.querySelectorAll('[data-testid="clinical-feed-card"]')).toHaveLength(12)
    expect(container.textContent).toContain("Randomized trial")
    // Owner decision 2026-10-06: a direct match shows the watch entry alone; only weaker matches are worded.
    expect(container.textContent).toContain("depression × esketamine")
    expect(container.textContent).not.toContain("Direct match")
    expect(container.textContent).toContain("99 found")
    await act(async () => { byText("Show more").click() })
    expect(container.querySelectorAll('[data-testid="clinical-feed-card"]')).toHaveLength(24)
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("keeps safety signals collapsed and does not show lower-confidence matches", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)], { lowerConfidence: [item(2, { entryId: null, grade: 0 })], safetySignals: [{ key: "pmid:9", paper: item(9).paper }] }))
    await mount()
    const details = [...container.querySelectorAll("details")]
    expect(details).toHaveLength(1)
    expect(details.every((d) => !d.open)).toBe(true)
    // Owner decision 2026-10-06: the lower-confidence section is no longer shown.
    expect(container.textContent).not.toContain("Lower-confidence")
    expect(container.textContent).not.toContain("Paper 2")
    expect(container.textContent).toContain("Safety signals (1)")
  })

  it("refreshes, shows the stage, and replaces the list", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    let finish!: (feed: StoredFeed) => void
    refreshMock.mockImplementation((onStage: (s: string) => void) => { onStage("grade"); return new Promise<StoredFeed>((resolve) => { finish = resolve }) })
    await mount()
    await act(async () => { byText("Refresh").click() })
    expect(container.textContent).toContain("Matching papers to your watch list")
    await act(async () => { finish(feedOf([item(7)])) })
    expect(container.textContent).toContain("Paper 7")
    expect(container.textContent).not.toContain("Matching papers to your watch list")
  })

  it("shows a refresh error and keeps the old list", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)]))
    refreshMock.mockRejectedValue(new Error("AI grading did not complete."))
    await mount()
    await act(async () => { byText("Refresh").click() })
    expect(container.textContent).toContain("AI grading did not complete.")
    expect(container.textContent).toContain("Paper 1")
  })

  it("saves the mode when the toggle changes", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await mount()
    await act(async () => { byText("Catch up").click() })
    expect((await loadClinicalSettings(storage)).mode).toBe("catch-up")
    expect(byText("Catch up").getAttribute("aria-pressed")).toBe("true")
  })

  it("records a vote from the card and marks it pressed", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)]))
    await mount()
    // Owner decision 2026-10-06: two icon buttons (thumbs up, thumbs down) replace the three text buttons.
    const up = () => container.querySelector<HTMLButtonElement>('button[aria-label="Useful to me"]')!
    await act(async () => { up().click() })
    expect(up().getAttribute("aria-pressed")).toBe("true")
    expect((await loadFeedback(storage)).map((e) => [e.paperKey, e.kind])).toEqual([["pmid:1", "relevant"]])
  })

  it("shows under Seen earlier only the papers displayed in the last 24 hours", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)], { seenEarlier: [item(5), item(6)] }))
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
    await storage.write(".scispark/clinical/seen.json", JSON.stringify({ version: 1, seen: { "pmid:5": hoursAgo(2), "pmid:6": hoursAgo(72) } }))
    await mount()
    expect(container.textContent).toContain("Seen earlier today (1)")
    expect(container.textContent).toContain("Paper 5")
    expect(container.textContent).not.toContain("Paper 6")
  })

  it("has a bold heading, one status line, and the notes at the foot of the page", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)]))
    await mount()
    expect(container.querySelector("h1")!.className).toContain("font-semibold")
    const status = container.querySelector("[data-testid=clinical-feed-status]")!
    expect(status.textContent).toContain("1 paper from 99 found")
    expect(status.textContent).toContain("What's new")
    const note = container.querySelector("[data-testid=clinical-feed-note]")!
    expect(note.textContent).toContain("For literature awareness only")
    expect(note.textContent).toContain("written by AI")
    const order = container.textContent ?? ""
    expect(order.indexOf("Paper 1")).toBeLessThan(order.indexOf("For literature awareness only"))
  })

  it("names on the card only the part of the watch entry the paper matches", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "Depression", treatment: "Esketamine", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1, { matched: "full" }), item(2, { matched: "condition" }), item(3, { matched: "treatment" })]))
    await mount()
    const topics = [...container.querySelectorAll("[data-testid=clinical-feed-card] [data-topic]")].map((el) => el.textContent)
    expect(topics).toEqual(["Depression × Esketamine", "Depression", "Esketamine"])
  })

  it("lets the Catch up window be chosen on Home, and says when the list on screen is from the other mode", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)]))
    await mount()
    expect(container.querySelector('select[aria-label="Catch up looks back"]')).toBeNull()
    await act(async () => { byText("Catch up").click() })
    const months = container.querySelector<HTMLSelectElement>('select[aria-label="Catch up looks back"]')!
    await act(async () => {
      months.value = "12"
      months.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(await loadClinicalSettings(storage)).toMatchObject({ mode: "catch-up", catchUpMonths: 12 })
    expect(container.textContent).toContain("Press Refresh to rebuild the list")
  })

  it("puts a paper on the Read later list from its card, and takes it off again", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)]))
    await mount()
    const later = () => container.querySelector<HTMLButtonElement>('button[aria-label="Read later"], button[aria-label="Remove from Read later"]')!
    await act(async () => { later().click() })
    expect(later().getAttribute("aria-pressed")).toBe("true")
    expect((await loadReadLater(storage)).map((entry) => entry.key)).toEqual(["pmid:1"])
    await act(async () => { later().click() })
    expect(await loadReadLater(storage)).toEqual([])
  })
})
