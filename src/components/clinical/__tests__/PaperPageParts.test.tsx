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
import { ClinicalPaperHeader } from "../ClinicalPaperHeader"

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
  it("shows the AI summary of the card with its tags, marked as AI-written, and no line about its source", async () => {
    await render(<ClinicalPaperSummary digest={{ ...ITEM.digest!, tags: ["Depression", "Drug A"] }} />)
    expect(container.textContent).toContain("AI summary")
    expect(container.textContent).toContain("Drug A improved response at week 8.")
    expect([...container.querySelectorAll("[data-tag]")].map((tag) => tag.textContent)).toEqual(["Depression", "Drug A"])
    expect(container.textContent).not.toContain("Based on")
    // The source sentence is still there for whoever asks: on hover.
    expect(container.querySelector("[title]")!.getAttribute("title")).toContain("Drug A improved response.")
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

describe("the AI summary on the paper page", () => {
  it("is as wide as the title above it", async () => {
    await render(<ClinicalPaperSummary digest={{ headline: "H", takeaway: "T", quote: "Q" }} />)
    expect(container.querySelector("section")!.className).not.toMatch(/max-w-/)
  })
})

// Owner request 2026-10-07: the top of the paper page should be clearer, and say what kind of study it is.
describe("the clinical paper header", () => {
  const MANY = { ...PAPER, venue: "The Lancet Psychiatry", date: "2026-08-20", addedDate: "2026-09-30", ids: { pmid: "42", doi: "10.1000/x" }, authors: ["A", "B", "C", "D", "E", "F", "G"].map((name) => ({ name: `${name}. Author` })) }
  it("shows the kind of study and the topic, then the headline, the paper's own title, and the source on a line of its own", async () => {
    await render(<ClinicalPaperHeader paper={MANY} headline="Drug A beat placebo for depression" design="randomized-trial" designSource="publication-type" topic="Depression × Drug A" />)
    expect([...container.querySelectorAll("[data-chip]")].map((chip) => chip.textContent)).toEqual(["Randomized trial", "Depression × Drug A"])
    expect(container.querySelector("h1")!.textContent).toBe("Drug A beat placebo for depression")
    expect(container.querySelector("[data-original-title]")!.textContent).toBe(PAPER.title)
    expect(container.querySelector("[data-journal]")!.textContent).toBe("The Lancet Psychiatry")
    expect(container.querySelector("[data-dates]")!.textContent).toBe("Published 2026-08-20 · In PubMed 2026-09-30")
    expect([...container.querySelectorAll("[data-ids] a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["DOI 10.1000/x", "https://doi.org/10.1000/x"], ["PMID 42", "https://pubmed.ncbi.nlm.nih.gov/42/"]])
  })
  it("keeps the authors on one line: the first three and the last two, the rest folded between them and opened on request", async () => {
    await render(<ClinicalPaperHeader paper={MANY} />)
    const authors = () => container.querySelector("[data-authors]")!
    expect(authors().textContent).toBe("A. Author, B. Author, C. Author, … 2 more …, F. Author, G. Author")
    expect(authors().className).toContain("whitespace-nowrap")
    await act(async () => { (authors().querySelector("button") as HTMLButtonElement).click() })
    expect(authors().textContent).toBe("A. Author, B. Author, C. Author, D. Author, E. Author, F. Author, G. Author")
    expect(authors().className).not.toContain("whitespace-nowrap")
    expect(container.querySelector("h1")!.textContent).toBe(PAPER.title)
  })
  it("shows six authors or fewer in full", async () => {
    await render(<ClinicalPaperHeader paper={{ ...MANY, authors: MANY.authors.slice(0, 6) }} />)
    expect(container.querySelector("[data-authors] button")).toBeNull()
    expect(container.querySelector("[data-authors]")!.textContent).toBe("A. Author, B. Author, C. Author, D. Author, E. Author, F. Author")
  })
  it("shows no chip for a design nobody has named", async () => {
    await render(<ClinicalPaperHeader paper={PAPER} design="randomized-trial" designSource="none" />)
    expect(container.querySelectorAll("[data-chip]")).toHaveLength(0)
  })
})
