// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { saveWatchEntries } from "@/lib/clinical/watch/store"
import { loadReadLater, toggleReadLater } from "@/lib/clinical/readlater/store"
import type { StoredFeedItem } from "@/lib/clinical/feed/stored"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { vault } = vi.hoisted(() => ({ vault: { current: null as unknown } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => vault.current }))
vi.mock("@/lib/papers/save-client", () => ({ savePaper: vi.fn(async () => ({ saved: true, slug: "s" })) }))

import { ReadLaterList } from "../ReadLaterList"

const item = (n: number): StoredFeedItem => ({
  paper: { ids: { pmid: String(n) }, title: `Paper ${n}`, abstract: `Finding ${n}.`, authors: [], fields: [], source: "pubmed", date: "2026-09-20" },
  key: `pmid:${n}`, design: "randomized-trial", designSource: "publication-type", entryId: "w1", grade: 4, topicGrade: 4,
  quote: "q", quoteVerified: true, ungraded: false, score: 90, flags: [], matched: "condition",
  digest: { headline: `Headline ${n}`, takeaway: `Takeaway ${n}.`, quote: `Finding ${n}.` },
})

let container: HTMLDivElement
async function mount(embedded = false) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<ReadLaterList embedded={embedded} />) })
  await act(async () => {})
}

beforeEach(() => { document.body.innerHTML = ""; vault.current = new MemoryVaultStorage() })

describe("the Read later store", () => {
  it("adds a paper, newest first, and removes it when toggled again", async () => {
    const storage = new MemoryVaultStorage()
    expect(await toggleReadLater(storage, item(1))).toBe(true)
    expect(await toggleReadLater(storage, item(2))).toBe(true)
    expect((await loadReadLater(storage)).map((entry) => entry.key)).toEqual(["pmid:2", "pmid:1"])
    expect(await toggleReadLater(storage, item(1))).toBe(false)
    expect((await loadReadLater(storage)).map((entry) => entry.key)).toEqual(["pmid:2"])
    await storage.write(".scispark/clinical/read-later.json", "{ not json")
    expect(await loadReadLater(storage)).toEqual([])
  })
})

describe("ReadLaterList", () => {
  it("shows the papers put aside as the same cards, with the topic they matched", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "Depression", treatment: "Esketamine", priority: "normal", safetySignal: false }])
    await toggleReadLater(storage, item(1))
    await toggleReadLater(storage, item(2))
    await mount()
    const cards = [...container.querySelectorAll("[data-testid=clinical-feed-card]")]
    expect(cards.map((card) => card.querySelector("h3")!.textContent)).toEqual(["Headline 2", "Headline 1"])
    expect(cards[0].querySelector("[data-topic]")!.textContent).toBe("Depression")
    expect(container.querySelector("h1")!.textContent).toBe("Read later")
  })

  it("is the same list without its own heading and margins as a tab of the Library", async () => {
    await toggleReadLater(vault.current as MemoryVaultStorage, item(1))
    await mount(true)
    expect(container.querySelector("h1")).toBeNull()
    expect(container.firstElementChild!.className).not.toContain("p-7")
    expect(container.textContent).toContain("Papers you put aside from your feed.")
    expect(container.querySelectorAll("[data-testid=clinical-feed-card]")).toHaveLength(1)
  })

  it("drops a card from the page when the paper is taken off the list", async () => {
    const storage = vault.current as MemoryVaultStorage
    await toggleReadLater(storage, item(1))
    await mount()
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Remove from Read later"]')!.click() })
    expect(container.querySelectorAll("[data-testid=clinical-feed-card]")).toHaveLength(0)
    expect(container.textContent).toContain("Nothing put aside yet")
  })
})
