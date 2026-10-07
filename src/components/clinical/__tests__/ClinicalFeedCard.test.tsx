// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { readReaderHandoffBySlug } from "@/lib/reader/handoff"
import { paperSlug } from "@/lib/wiki/authoring"
import type { StoredFeedItem } from "@/lib/clinical/feed/stored"
import { loadFeedback } from "@/lib/clinical/feedback/store"

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
async function mount(item: StoredFeedItem, storage = new MemoryVaultStorage(), tone?: number) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<ClinicalFeedCard item={item} storage={storage} saved={false} onSave={() => {}} entryLabel="Depression × Drug A" tone={tone} />) })
  return storage
}

beforeEach(() => { document.body.innerHTML = ""; push.mockReset() })

describe("ClinicalFeedCard", () => {
  it("shows the authors' conclusion, not the background sentence", async () => {
    await mount(ITEM)
    const conclusion = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Drug A improved response at week 8.")!
    expect(conclusion.getAttribute("title")).toBe("Authors' conclusion")
    expect(container.textContent).not.toContain("Depression is common and often undertreated")
  })

  it("says in words how the paper matches the watch entry, and explains it on hover", async () => {
    await mount(ITEM)
    // The card names the topic only; how close the match is appears on hover, never as words on the card.
    expect(container.textContent).not.toContain("Direct match")
    expect(container.textContent).not.toContain("4/4")
    const tag = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Depression × Drug A")!
    expect(tag.getAttribute("title")).toContain("We randomised 200 adults")
    document.body.innerHTML = ""
    await mount({ ...ITEM, grade: 3 })
    expect(container.textContent).not.toContain("Close match")
    const close = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Depression × Drug A")!
    expect(close.getAttribute("title")).toContain("subtype")
  })

  it("hands the paper to the reader before opening it, so the paper page has content", async () => {
    const storage = await mount(ITEM)
    const title = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Drug A versus placebo"))!
    await act(async () => { title.click() })
    await act(async () => {})
    expect(await readReaderHandoffBySlug(storage, paperSlug(ITEM.paper))).toMatchObject({ title: ITEM.paper.title })
    expect(push).toHaveBeenCalledWith(`/paper/${paperSlug(ITEM.paper)}`)
  })

  const DIGEST = { headline: "Drug A beat placebo for depression", takeaway: "Drug A improved response at week 8.", quote: "CONCLUSIONS: Drug A improved response at week 8." }

  it("with an AI summary shows only the headline, journal and date, and the summary, in that order", async () => {
    await mount({ ...ITEM, paper: { ...ITEM.paper, venue: "The Lancet Psychiatry", year: 2026 }, digest: DIGEST })
    const text = container.textContent ?? ""
    expect(container.querySelector("h3")!.textContent).toBe(DIGEST.headline)
    expect(text.indexOf(DIGEST.headline)).toBeLessThan(text.indexOf("The Lancet Psychiatry · 2026-09-20"))
    expect(text.indexOf("The Lancet Psychiatry · 2026-09-20")).toBeLessThan(text.indexOf(DIGEST.takeaway))
    expect(text).not.toContain("Drug A versus placebo in adults with depression: a randomised trial")
    expect(text).not.toContain("AI summary")
    expect(text).not.toContain("Authors' conclusion")
    expect(text).not.toContain("Published")
  })

  it("says on hover that the summary is AI-written and which sentence it rests on", async () => {
    await mount({ ...ITEM, digest: DIGEST })
    const summary = [...container.querySelectorAll("[title]")].find((el) => el.textContent === DIGEST.takeaway)!
    expect(summary.getAttribute("title")).toContain("AI")
    expect(summary.getAttribute("title")).toContain("Drug A improved response at week 8.")
  })

  it("shows the date as precisely as the record gives it", async () => {
    await mount({ ...ITEM, paper: { ...ITEM.paper, venue: "CNS Drugs", date: "2026-10" }, digest: DIGEST })
    expect(container.textContent).toContain("CNS Drugs · 2026-10")
  })

  it("shows a PubMed design as it is, an inferred one marked as inferred, and nothing when the design is not known", async () => {
    await mount(ITEM)
    const assigned = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Randomized trial")!
    expect(assigned.getAttribute("title")).toContain("PubMed")
    document.body.innerHTML = ""
    await mount({ ...ITEM, designSource: "model" })
    const inferred = [...container.querySelectorAll("[title]")].find((el) => el.textContent?.includes("Randomized trial"))!
    expect(inferred.getAttribute("title")).toContain("not assigned by PubMed")
    expect(inferred.getAttribute("data-inferred")).toBe("true")
    document.body.innerHTML = ""
    await mount({ ...ITEM, design: "other", designSource: "none" })
    expect(container.textContent).not.toContain("Other design")
  })

  it("has a thumbs-up and a thumbs-down button without text, and records each", async () => {
    const storage = await mount(ITEM)
    const up = container.querySelector<HTMLButtonElement>('button[aria-label="Useful to me"]')!
    const down = container.querySelector<HTMLButtonElement>('button[aria-label="Not for me"]')!
    expect(up.textContent).toBe("")
    expect(down.textContent).toBe("")
    expect(container.textContent).not.toContain("Would change my practice")
    await act(async () => { down.click() })
    expect(down.getAttribute("aria-pressed")).toBe("true")
    expect((await loadFeedback(storage)).map((e) => e.kind)).toEqual(["not-relevant"])
    await act(async () => { up.click() })
    expect((await loadFeedback(storage)).map((e) => e.kind)).toEqual(["relevant"])
  })

  it("tints the card with the colour of its watch entry, and leaves a card without one plain", async () => {
    await mount(ITEM, new MemoryVaultStorage(), 2)
    const card = container.querySelector<HTMLElement>("[data-testid=clinical-feed-card]")!
    expect(card.getAttribute("data-tone")).toBe("2")
    expect(card.style.getPropertyValue("--card-tone")).toBe("var(--band-breakthrough)")
    document.body.innerHTML = ""
    await mount(ITEM)
    expect(container.querySelector("[data-testid=clinical-feed-card]")!.hasAttribute("data-tone")).toBe(false)
  })

  it("draws an inferred design tag exactly like a PubMed one; only the hover text differs", async () => {
    await mount(ITEM)
    const assigned = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Randomized trial")!
    const assignedClass = assigned.className
    document.body.innerHTML = ""
    await mount({ ...ITEM, designSource: "model" })
    const inferred = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Randomized trial")!
    expect(inferred.className).toBe(assignedClass)
    expect(inferred.getAttribute("title")).toContain("not assigned by PubMed")
  })

  it("puts the topic first, in the accent colour, and the study type after it in the normal text colour", async () => {
    await mount(ITEM)
    const text = container.textContent ?? ""
    expect(text.indexOf("Depression × Drug A")).toBeLessThan(text.indexOf("Randomized trial"))
    const topic = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Depression × Drug A")!
    const design = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Randomized trial")!
    expect(topic.className).toContain("text-accent-ink")
    expect(design.className).toContain("text-espresso")
    expect(design.className).not.toContain("uppercase")
  })

  it("writes the topic in a darker shade of the card's own tint, and in the accent colour when the card has no tint", async () => {
    await mount(ITEM, new MemoryVaultStorage(), 1)
    const toned = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Depression × Drug A")!
    expect(toned.getAttribute("data-toned")).toBe("true")
    document.body.innerHTML = ""
    await mount(ITEM)
    const plain = [...container.querySelectorAll("[title]")].find((el) => el.textContent === "Depression × Drug A")!
    expect(plain.hasAttribute("data-toned")).toBe(false)
    expect(plain.className).toContain("text-accent-ink")
  })

  // Owner decision 2026-10-07: a paper found in a two-week search may have been published months before.
  it("says when the paper was published and when it entered PubMed, if the two differ", async () => {
    await mount({ ...ITEM, paper: { ...ITEM.paper, venue: "Some Journal", date: "2026-08-20", addedDate: "2026-09-30" } })
    expect(container.querySelector("[data-testid=card-source]")!.textContent).toBe("Some Journal · published 2026-08-20 · in PubMed 2026-09-30")
    document.body.innerHTML = ""
    await mount({ ...ITEM, paper: { ...ITEM.paper, venue: "Some Journal", date: "2026-09-30", addedDate: "2026-09-30" } })
    expect(container.querySelector("[data-testid=card-source]")!.textContent).toBe("Some Journal · 2026-09-30")
  })
})
