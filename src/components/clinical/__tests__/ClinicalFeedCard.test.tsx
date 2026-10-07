// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { readReaderHandoffBySlug } from "@/lib/reader/handoff"
import { paperSlug } from "@/lib/wiki/authoring"
import type { StoredFeedItem } from "@/lib/clinical/feed/stored"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("@/lib/papers/save-client", () => ({ savePaper: vi.fn(async () => ({ saved: true, slug: "s" })) }))

import { ClinicalFeedCard } from "../ClinicalFeedCard"

const ITEM: StoredFeedItem = {
  paper: {
    ids: { pmid: "42" }, title: "Drug A versus placebo in adults with depression: a randomised trial",
    abstract: "BACKGROUND: Depression is common and often undertreated.\nMETHODS: We randomised 200 adults.\nCONCLUSIONS: Drug A improved response at week 8.\nFUNDING: A foundation.",
    authors: [], fields: [], source: "pubmed", date: "2026-09-20",
  },
  key: "pmid:42", design: "randomized-trial", designSource: "publication-type", entryId: "w1", grade: 4, topicGrade: 4,
  quote: "We randomised 200 adults", quoteVerified: true, ungraded: false, score: 90, flags: [],
}

let container: HTMLDivElement
async function mount(item: StoredFeedItem, storage = new MemoryVaultStorage()) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<ClinicalFeedCard item={item} storage={storage} saved={false} onSave={() => {}} entryLabel="Depression × Drug A" />) })
  return storage
}

beforeEach(() => { document.body.innerHTML = ""; push.mockReset() })

describe("ClinicalFeedCard", () => {
  it("shows the authors' conclusion, not the background sentence", async () => {
    await mount(ITEM)
    expect(container.textContent).toContain("Authors' conclusion")
    expect(container.textContent).toContain("Drug A improved response at week 8.")
    expect(container.textContent).not.toContain("Depression is common and often undertreated")
  })

  it("says in words how the paper matches the watch entry, and explains it on hover", async () => {
    await mount(ITEM)
    expect(container.textContent).toContain("Depression × Drug A · Direct match")
    expect(container.textContent).not.toContain("4/4")
    const chip = [...container.querySelectorAll("[title]")].find((el) => el.textContent?.includes("Direct match"))!
    expect(chip.getAttribute("title")).toContain("We randomised 200 adults")
  })

  it("hands the paper to the reader before opening it, so the paper page has content", async () => {
    const storage = await mount(ITEM)
    const title = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Drug A versus placebo"))!
    await act(async () => { title.click() })
    await act(async () => {})
    expect(await readReaderHandoffBySlug(storage, paperSlug(ITEM.paper))).toMatchObject({ title: ITEM.paper.title })
    expect(push).toHaveBeenCalledWith(`/paper/${paperSlug(ITEM.paper)}`)
  })
})
