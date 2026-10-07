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

  // Owner decision 2026-10-07: the History page replaces the "Seen earlier" section.
  it("has no Seen earlier section; earlier lists are in the History", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)], { seenEarlier: [item(5)] }))
    await storage.write(".scispark/clinical/seen.json", JSON.stringify({ version: 1, seen: { "pmid:5": new Date().toISOString() } }))
    await mount()
    expect(container.textContent).not.toContain("Seen earlier")
    expect(container.textContent).not.toContain("Paper 5")
  })

  it("has a bold heading, one status line, and the notes at the foot of the page", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)]))
    await mount()
    expect(container.querySelector("h1")!.className).toContain("font-semibold")
    const status = container.querySelector("[data-testid=clinical-feed-status]")!
    expect(status.textContent).toContain("1 paper from 99 found")
    expect(status.textContent).toContain("last 30 days")
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

  // Owner decisions 2026-10-07: one "look back" choice replaces What's new / Catch up; papers are shown by topic.
  const lookBack = () => container.querySelector<HTMLSelectElement>('select[aria-label="Look back"]')!
  const choose = async (value: string) => act(async () => {
    lookBack().value = value
    lookBack().dispatchEvent(new Event("change", { bubbles: true }))
  })

  it("offers one look-back choice, from 3 days to 12 months, in place of the two modes", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)]))
    await mount()
    expect([...lookBack().options].map((option) => option.textContent)).toEqual(["3 days", "1 week", "2 weeks", "30 days", "3 months", "6 months", "12 months", "Custom dates"])
    expect(lookBack().value).toBe("30d")
    expect(container.textContent).not.toContain("Catch up")
    await choose("7d")
    expect(await loadClinicalSettings(storage)).toMatchObject({ mode: "whats-new", windowDays: 7 })
    expect(container.textContent).toContain("Press Refresh to rebuild the list")
    await choose("12m")
    expect(await loadClinicalSettings(storage)).toMatchObject({ mode: "catch-up", catchUpMonths: 12 })
  })

  it("shows the papers by topic: a tab for all and one for each topic, with its count", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [
      { id: "w1", condition: "Depression", treatment: "Esketamine", priority: "normal", safetySignal: false },
      { id: "w2", condition: "ADHD", priority: "normal", safetySignal: false },
    ])
    await saveClinicalFeed(storage, feedOf([item(1), item(2, { entryId: "w2" }), item(3)]))
    await mount()
    const tabs = () => [...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
    expect(tabs().map((tab) => tab.textContent)).toEqual(["All 3", "Depression × Esketamine 2", "ADHD 1"])
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true")
    const shown = () => [...container.querySelectorAll("[data-testid=clinical-feed-card] h3")].map((heading) => heading.textContent)
    expect(shown()).toEqual(["Paper 1", "Paper 2", "Paper 3"])
    await act(async () => { tabs()[2].click() })
    expect(shown()).toEqual(["Paper 2"])
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true")
  })

  it("gives each tab a short count of what is in it: designs, leading journals, full matches", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "Depression", treatment: "Esketamine", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([
      item(1, { matched: "full", journalBand: 1 }),
      item(2, { matched: "condition", design: "meta-analysis", journalBand: 1 }),
      item(3, { matched: "condition", designSource: "none", design: "other" }),
    ]))
    await mount()
    const overview = container.querySelector("[data-testid=clinical-feed-overview]")!
    const parts = [...overview.querySelectorAll("[data-stat]")].map((part) => part.textContent)
    expect(parts).toEqual(["3 papers", "Condition and treatment 1", "Leading journals 2", "Meta-analysis 1", "Randomized trial 1"])
  })

  it("marks as seen only the papers of the tab that is on screen", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [
      { id: "w1", condition: "Depression", priority: "normal", safetySignal: false },
      { id: "w2", condition: "ADHD", priority: "normal", safetySignal: false },
    ])
    await saveClinicalFeed(storage, feedOf([...Array.from({ length: 13 }, (_, n) => item(n + 1)), item(50, { entryId: "w2" })]))
    await mount()
    await act(async () => {})
    const seen = async () => Object.keys(JSON.parse((await storage.read(".scispark/clinical/seen.json")) ?? '{"seen":{}}').seen)
    expect(await seen()).toHaveLength(12)
    expect(await seen()).not.toContain("pmid:50")
    await act(async () => { ([...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[])[2].click() })
    await act(async () => {})
    expect(await seen()).toContain("pmid:50")
  })

  it("shows a topic's AI overview on its tab, marked as AI-written, with the papers each sentence rests on", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "Depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1), item(2)], { topicOverviews: { w1: [{ text: "Two trials reported benefit.", sources: ["pmid:1", "pmid:2"] }] } }))
    await mount()
    expect(container.querySelector("[data-testid=clinical-topic-overview]")).toBeNull()
    await act(async () => { ([...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[])[1].click() })
    const overview = container.querySelector("[data-testid=clinical-topic-overview]")!
    expect(overview.textContent).toContain("AI overview")
    expect(overview.textContent).toContain("Two trials reported benefit")
    expect([...overview.querySelectorAll("[data-source]")].map((source) => source.getAttribute("title"))).toEqual(["Paper 1", "Paper 2"])
  })

  it("labels an earlier list with the topics it was built for, even after the topics have changed", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "new", condition: "ADHD", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)], { topics: [{ id: "w1", condition: "Depression", treatment: "Esketamine" }] }))
    await mount()
    expect(([...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]).map((tab) => tab.textContent)).toEqual(["All 1", "Depression × Esketamine 1"])
    expect(container.querySelector("[data-topic]")!.textContent).toBe("Depression × Esketamine")
  })

  it("records what was displayed under the time range of the list on screen", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)], { lookBack: "7d" }))
    await mount()
    await act(async () => {})
    const file = JSON.parse((await storage.read(".scispark/clinical/seen.json")) as string)
    expect(Object.keys(file.byLookBack["7d"])).toEqual(["pmid:1"])
    expect(file.byLookBack["30d"] ?? {}).toEqual({})
  })

  it("numbers the cards of a tab in order, and uses the same numbers for the sources of the AI overview", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "Depression", priority: "normal", safetySignal: false }, { id: "w2", condition: "ADHD", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1), item(2, { entryId: "w2" }), item(3)], { topicOverviews: { w1: [{ text: "Two trials reported benefit.", sources: ["pmid:1", "pmid:3"] }] } }))
    await mount()
    const numbers = () => [...container.querySelectorAll("[data-testid=clinical-feed-card] [data-position]")].map((el) => el.textContent)
    expect(numbers()).toEqual(["1", "2", "3"])
    await act(async () => { ([...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[])[1].click() })
    expect(numbers()).toEqual(["1", "2"])
    expect([...container.querySelectorAll("[data-testid=clinical-topic-overview] [data-source]")].map((el) => el.textContent)).toEqual(["1", "2"])
  })

  it("jumps from a source of the overview to its card, opening more of the list when the card is further down", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "Depression", priority: "normal", safetySignal: false }])
    const items = Array.from({ length: 14 }, (_, n) => item(n + 1))
    await saveClinicalFeed(storage, feedOf(items, { topicOverviews: { w1: [{ text: "A later trial agreed.", sources: ["pmid:14"] }] } }))
    await mount()
    await act(async () => { ([...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[])[1].click() })
    expect(container.querySelectorAll("[data-testid=clinical-feed-card]")).toHaveLength(12)
    const source = container.querySelector<HTMLButtonElement>("[data-testid=clinical-topic-overview] [data-source]")!
    expect(source.tagName).toBe("BUTTON")
    await act(async () => { source.click() })
    expect(container.querySelectorAll("[data-testid=clinical-feed-card]")).toHaveLength(14)
    expect(container.querySelector("#paper-14")).not.toBeNull()
  })

  it("offers a search over chosen dates: two date fields appear and the range is saved once both are filled in", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)]))
    await mount()
    expect(container.querySelector('input[aria-label="From"]')).toBeNull()
    await choose("custom")
    const field = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
    const set = async (label: string, value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(label), value)
      field(label).dispatchEvent(new Event("input", { bubbles: true }))
    })
    await set("From", "2026-09-01")
    expect((await loadClinicalSettings(storage)).range).toBeUndefined()
    await set("To", "2026-09-15")
    expect((await loadClinicalSettings(storage)).range).toEqual({ from: "2026-09-01", to: "2026-09-15" })
    expect(container.textContent).toContain("Press Refresh to rebuild the list for 2026-09-01 to 2026-09-15")
    await choose("30d")
    expect((await loadClinicalSettings(storage)).range).toBeUndefined()
    expect(container.querySelector('input[aria-label="From"]')).toBeNull()
  })

  // Owner request 2026-10-07: the overview as short points with the key words marked, in two parts.
  it("shows the overview one kind of finding to a line, papers on the same treatment joined, the treatment and the word not marked", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "Depression", treatment: "Esketamine", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1, { matched: "full" }), item(2, { matched: "full" }), item(3, { matched: "full" }), item(4, { matched: "full" }), item(5, { matched: "full" }), item(6, { matched: "condition" })], { topicOverviews: { w1: [
      { text: "reduced sadness and suicidal thoughts", sources: ["pmid:1"], group: "focus", kind: "benefit", treatment: "Ketamine" },
      { text: "gave a 58% response against 29% with placebo", sources: ["pmid:2"], group: "focus", kind: "benefit", treatment: "ketamine" },
      { text: "did not reduce symptoms", sources: ["pmid:3"], group: "focus", kind: "no-benefit", treatment: "Omega-3" },
      { text: "improved adherence but not symptoms", sources: ["pmid:4"], group: "focus", kind: "mixed", treatment: "A phone app" },
      { text: "older age was linked to slower improvement", sources: ["pmid:5"], group: "focus", kind: "other" },
      { text: "lowered symptoms in adolescents", sources: ["pmid:6"], group: "related", kind: "benefit", treatment: "Exercise" },
    ] } }))
    await mount()
    await act(async () => { ([...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[])[1].click() })
    const overview = container.querySelector("[data-testid=clinical-topic-overview]")!
    expect(overview.querySelector("[data-testid=overview-counts]")!.textContent).toBe("6 papers: 3 benefit, 1 no benefit, 1 mixed")
    const groups = [...overview.querySelectorAll("[data-overview-group]")]
    expect(groups.map((group) => group.getAttribute("data-overview-group"))).toEqual(["focus", "related"])
    expect(groups[1].querySelector("[data-group-title]")!.textContent).toBe("Also on Depression")
    // One line per kind, each a block of its own with its label in front.
    const rows = [...groups[0].querySelectorAll("[data-kind]")]
    expect(rows.map((row) => [row.tagName, row.getAttribute("data-kind"), row.querySelector("[data-kind-label]")!.textContent])).toEqual([["P", "benefit", "Benefit"], ["P", "no-benefit", "No benefit"], ["P", "mixed", "Mixed"], ["P", "other", "Other"]])
    // Two papers on ketamine: the treatment once, each paper's outcome after it with its own number.
    expect(rows[0].querySelectorAll("mark[data-treatment]")).toHaveLength(1)
    expect(rows[0].textContent).toBe("BenefitKetamine reduced sadness and suicidal thoughts1; gave a 58% response against 29% with placebo2. ")
    expect(rows[3].textContent).toBe("OtherOlder age was linked to slower improvement5. ")
    expect(overview.querySelectorAll("strong")).toHaveLength(0)
    expect([...groups[0].querySelectorAll("mark[data-negation]")].map((mark) => mark.textContent)).toEqual(["not", "not"])
    expect(rows[0].querySelector("mark[data-negation]")).toBeNull()
  })

  it("still shows an overview stored as whole sentences", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "Depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1), item(2)], { topicOverviews: { w1: [{ text: "Esketamine gave more remission than quetiapine.", sources: ["pmid:1", "pmid:2"], kind: "benefit", emphasis: ["Esketamine"] }] } }))
    await mount()
    await act(async () => { ([...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[])[1].click() })
    const row = container.querySelector('[data-testid=clinical-topic-overview] [data-kind="benefit"]')!
    expect(row.textContent).toBe("BenefitEsketamine gave more remission than quetiapine12. ")
    expect(row.querySelector("mark[data-treatment]")!.textContent).toBe("Esketamine")
  })

  it("offers to show seen papers again, forgets them for this time range, and asks for a refresh", async () => {
    const storage = vault.current as MemoryVaultStorage
    await saveWatchEntries(storage, [{ id: "w1", condition: "depression", priority: "normal", safetySignal: false }])
    await saveClinicalFeed(storage, feedOf([item(1)], { lookBack: "30d" }))
    await storage.write(".scispark/clinical/seen.json", JSON.stringify({ version: 1, seen: { "pmid:7": "2026-10-06T10:00:00.000Z" }, byLookBack: { "30d": { "pmid:7": "2026-10-06T10:00:00.000Z" }, "7d": { "pmid:9": "2026-10-06T10:00:00.000Z" } } }))
    await mount()
    await act(async () => {})
    await act(async () => { byText("Show seen papers again").click() })
    await act(async () => {})
    const file = JSON.parse((await storage.read(".scispark/clinical/seen.json")) as string)
    expect(file.byLookBack["30d"]).toBeUndefined()
    expect(Object.keys(file.byLookBack["7d"])).toEqual(["pmid:9"])
    expect(container.textContent).toContain("Press Refresh to list them")
  })
})

