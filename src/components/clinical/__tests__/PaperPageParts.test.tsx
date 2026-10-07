// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import type { StoredFeedItem } from "@/lib/clinical/feed/stored"
import { PaperHeader } from "@/components/paper/PaperHeader"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("@/lib/papers/save-client", () => ({ savePaper: vi.fn(async () => ({ saved: true, slug: "s" })) }))

import { ClinicalAbstract } from "../ClinicalAbstract"
import { ClinicalFeedCard } from "../ClinicalFeedCard"
import { ClinicalPaperSummary } from "../ClinicalPaperSummary"

let container: HTMLDivElement
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(node) })
}
beforeEach(() => { document.body.innerHTML = ""; push.mockReset() })

const PAPER = { ids: { pmid: "42" }, title: "Drug A versus placebo in adults with depression: a randomised trial", abstract: "BACKGROUND: Depression is common.\nMETHODS: We randomised 200 adults.\nCONCLUSIONS: Drug A improved response.", authors: [{ name: "A. Author" }], fields: [], source: "pubmed" as const, date: "2026-09-20" }
const ITEM: StoredFeedItem = {
  paper: PAPER, key: "pmid:42", design: "randomized-trial", designSource: "publication-type", entryId: "w1", grade: 4, topicGrade: 4,
  quote: "q", quoteVerified: true, ungraded: false, score: 90, flags: [],
  digest: { headline: "Drug A beat placebo for depression", takeaway: "Drug A improved response at week 8.", quote: "CONCLUSIONS: Drug A improved response." },
}

describe("the abstract on the paper page", () => {
  it("shows each section on its own, with its label in bold and not in capitals", async () => {
    await render(<ClinicalAbstract text={PAPER.abstract} />)
    const sections = [...container.querySelectorAll("[data-section]")]
    expect(sections).toHaveLength(3)
    expect(sections.map((section) => section.querySelector("strong")!.textContent)).toEqual(["Background", "Methods", "Conclusions"])
    expect(container.textContent).not.toContain("BACKGROUND")
    expect(sections[1].textContent).toContain("We randomised 200 adults.")
  })
  it("shows an abstract without sections as plain paragraphs", async () => {
    await render(<ClinicalAbstract text="We studied 40 patients. Symptoms fell by half." />)
    expect(container.querySelector("strong")).toBeNull()
    expect(container.textContent).toContain("Symptoms fell by half.")
  })
})

describe("the top of the paper page", () => {
  it("leads with the AI headline and puts the paper's own title beneath it", async () => {
    await render(<PaperHeader paper={PAPER} headline="Drug A beat placebo for depression" />)
    expect(container.querySelector("h1")!.textContent).toBe("Drug A beat placebo for depression")
    expect(container.querySelector("[data-original-title]")!.textContent).toBe(PAPER.title)
  })
  it("shows the paper's own title as the heading when there is no AI headline", async () => {
    await render(<PaperHeader paper={PAPER} />)
    expect(container.querySelector("h1")!.textContent).toBe(PAPER.title)
    expect(container.querySelector("[data-original-title]")).toBeNull()
  })
  it("shows the AI summary of the card, marked as AI-written with the sentence it rests on", async () => {
    await render(<ClinicalPaperSummary digest={ITEM.digest!} />)
    expect(container.textContent).toContain("AI summary")
    expect(container.textContent).toContain("Drug A improved response at week 8.")
    expect(container.textContent).toContain("Drug A improved response.")
  })
})

describe("a card", () => {
  it("opens its paper from a click anywhere on it, but not from its buttons", async () => {
    await render(<ClinicalFeedCard item={ITEM} storage={new MemoryVaultStorage()} saved={false} onSave={() => {}} entryLabel="Depression" />)
    const card = container.querySelector<HTMLElement>("[data-testid=clinical-feed-card]")!
    await act(async () => { card.querySelector("p")!.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    await act(async () => {})
    expect(push).toHaveBeenCalledTimes(1)
    await act(async () => { card.querySelector<HTMLButtonElement>('button[aria-label="Useful to me"]')!.click() })
    await act(async () => { card.querySelector<HTMLButtonElement>('button[aria-label="Read later"]')!.click() })
    await act(async () => {})
    expect(push).toHaveBeenCalledTimes(1)
  })

  // Owner decision 2026-10-07: a card stands out by a slightly deeper tint and a lift, not by a border.
  it("lifts and deepens under the pointer, and the same way, more strongly, when jumped to", async () => {
    await render(<ClinicalFeedCard item={ITEM} storage={new MemoryVaultStorage()} saved={false} onSave={() => {}} entryLabel="Depression" tone={0} />)
    const plain = container.querySelector<HTMLElement>("[data-testid=clinical-feed-card]")!
    expect(plain.className).toContain("hover:-translate-y-0.5")
    expect(plain.className).toContain("hover:[--card-strength:6%]")
    expect(plain.hasAttribute("data-highlighted")).toBe(false)
    document.body.innerHTML = ""
    await render(<ClinicalFeedCard item={ITEM} storage={new MemoryVaultStorage()} saved={false} onSave={() => {}} entryLabel="Depression" tone={0} highlighted />)
    const jumped = container.querySelector<HTMLElement>("[data-testid=clinical-feed-card]")!
    expect(jumped.getAttribute("data-highlighted")).toBe("true")
    expect(jumped.className).toContain("[--card-strength:10%]")
    // ...and a thicker border in the card's own colour, which a hover does not have.
    expect(jumped.className).toContain("border-2")
    expect(plain.className).not.toContain("border-2")
    expect(jumped.className).not.toContain("ring-")
  })
})
