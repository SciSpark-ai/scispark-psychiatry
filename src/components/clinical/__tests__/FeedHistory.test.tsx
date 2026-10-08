// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { loadClinicalFeed, type StoredFeed, type StoredFeedItem } from "@/lib/clinical/feed/stored"
import { listHistory, saveHistory } from "@/lib/clinical/history/store"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { vault, push } = vi.hoisted(() => ({ vault: { current: null as unknown }, push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => vault.current }))

import { FeedHistory } from "../FeedHistory"

const item = (n: number): StoredFeedItem => ({
  paper: { ids: { pmid: String(n) }, title: `Paper ${n}`, authors: [], fields: [], source: "pubmed" },
  key: `pmid:${n}`, design: "randomized-trial", designSource: "publication-type", entryId: "w1", grade: 4, topicGrade: 4,
  quote: "q", quoteVerified: true, ungraded: false, score: 90, flags: [],
})
const feedAt = (generatedAt: string, count: number, lookBack: string): StoredFeed => ({
  version: 1, generatedAt, mode: "whats-new", lookBack, strictness: "standard", items: Array.from({ length: count }, (_, n) => item(n + 1)),
  lowerConfidence: [], safetySignals: [], stats: { retrieved: 100, domain: 80, gated: 60, graded: 60, listed: count }, costUsd: null, warnings: [],
  topics: [{ id: "w1", condition: "Depression", treatment: "Esketamine" }],
})

let container: HTMLDivElement
async function mount(embedded = false) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<FeedHistory embedded={embedded} />) })
  await act(async () => {})
}
const rows = () => [...container.querySelectorAll("[data-testid=history-row]")]
const button = (row: Element, label: string) => [...row.querySelectorAll("button")].find((entry) => entry.textContent === label) as HTMLButtonElement

beforeEach(async () => {
  document.body.innerHTML = ""
  push.mockReset()
  const storage = new MemoryVaultStorage()
  await saveHistory(storage, feedAt("2026-10-06T10:00:00.000Z", 3, "30d"))
  await saveHistory(storage, feedAt("2026-10-07T09:00:00.000Z", 5, "7d"))
  vault.current = storage
})

describe("FeedHistory", () => {
  it("lists every search, newest first, with its time range, topics and number of papers", async () => {
    await mount()
    expect(rows()).toHaveLength(2)
    expect(rows()[0].textContent).toContain("1 week")
    expect(rows()[0].textContent).toContain("5 papers")
    expect(rows()[0].textContent).toContain("Depression × Esketamine")
    expect(rows()[1].textContent).toContain("30 days")
    expect(container.querySelector("h1")!.textContent).toBe("History")
  })

  it("is the same list without its own heading and margins as a tab of the Library", async () => {
    await mount(true)
    expect(container.querySelector("h1")).toBeNull()
    expect(container.firstElementChild!.className).not.toContain("p-7")
    expect(container.textContent).toContain("Every search you have run.")
    expect(rows()).toHaveLength(2)
  })

  it("reopens a search as the list on Home", async () => {
    await mount()
    await act(async () => { button(rows()[1], "Open").click() })
    expect((await loadClinicalFeed(vault.current as MemoryVaultStorage))?.generatedAt).toBe("2026-10-06T10:00:00.000Z")
    expect(push).toHaveBeenCalledWith("/")
  })

  it("deletes a search only after a second click, and keeps the others", async () => {
    await mount()
    await act(async () => { button(rows()[0], "Delete").click() })
    expect(await listHistory(vault.current as MemoryVaultStorage)).toHaveLength(2)
    await act(async () => { button(rows()[0], "Delete for good").click() })
    expect((await listHistory(vault.current as MemoryVaultStorage)).map((entry) => entry.generatedAt)).toEqual(["2026-10-06T10:00:00.000Z"])
    expect(rows()).toHaveLength(1)
  })

  it("says so when there is no history yet", async () => {
    vault.current = new MemoryVaultStorage()
    await mount()
    expect(container.textContent).toContain("No searches yet")
  })
})
