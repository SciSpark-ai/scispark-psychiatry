// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { PAPER_DIGEST_ITEMS, type StoredPaperDigest } from "@/lib/clinical/digest/paper"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = vi.hoisted(() => ({ loadPaperDigestRemote: vi.fn(), writePaperDigestRemote: vi.fn() }))
vi.mock("@/lib/clinical/digest/paper-client", () => client)

import { ClinicalPaperDigest } from "../ClinicalPaperDigest"

const PAPER = { ids: { pmid: "42" }, title: "Drug A versus placebo", abstract: "We randomised 200 adults.", authors: [], fields: [], source: "pubmed" as const }
const digest = (over: Partial<StoredPaperDigest> = {}): StoredPaperDigest => ({
  version: 1, unverified: [],
  items: {
    question: "Does drug A improve response?", design: "Randomised double-blind trial over 8 weeks", population: "200 adults with depression",
    intervention: "Drug A 20 mg versus placebo", mainResult: "Response was 48% with drug A and 31% with placebo.", safety: null,
    limitations: "Short follow-up.", conclusion: "Drug A improved response.", funding: null,
  },
  source: { access: "full-text", locator: "PMC", checkedAt: "2026-10-07T10:00:00.000Z", truncated: false, notes: [] },
  ...over,
})

let container: HTMLDivElement
async function render() {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<ClinicalPaperDigest paper={PAPER} />) })
  await act(async () => {})
}
const button = (text: string) => [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text)) as HTMLButtonElement | undefined
beforeEach(() => { document.body.innerHTML = ""; client.loadPaperDigestRemote.mockReset(); client.writePaperDigestRemote.mockReset() })

describe("the digest on the paper page", () => {
  it("labels the items in the order the library writes them", () => {
    expect(Object.keys(CLINICAL_COPY.paper.digest.labels)).toEqual([...PAPER_DIGEST_ITEMS])
  })

  it("shows a stored digest as nine labelled items in the agreed order, and says what it was written from", async () => {
    client.loadPaperDigestRemote.mockResolvedValue(digest())
    await render()
    expect([...container.querySelectorAll("[data-digest-item]")].map((row) => row.querySelector("dt")!.textContent)).toEqual([
      "Research question", "Study design", "Population", "Intervention and comparator", "Main result", "Safety", "Limitations", "Authors' conclusion", "Funding and conflicts of interest",
    ])
    expect(container.querySelector('[data-digest-item="mainResult"] dd')!.textContent).toBe("Response was 48% with drug A and 31% with placebo.")
    expect(container.querySelector('[data-digest-item="safety"] dd')!.textContent).toBe("Not stated in the paper.")
    expect(container.textContent).toContain("Written by AI from the full text")
    // Written from the full text already: nothing more to ask for.
    expect(button("Update from full text")).toBeUndefined()
    expect(client.writePaperDigestRemote).not.toHaveBeenCalled()
  })

  it("writes a digest only when asked", async () => {
    client.loadPaperDigestRemote.mockResolvedValue(null)
    client.writePaperDigestRemote.mockResolvedValue({ digest: digest({ source: { access: "abstract", locator: "Abstract", checkedAt: "2026-10-07T10:00:00.000Z", truncated: false, notes: [] } }), fromCache: false })
    await render()
    expect(container.querySelectorAll("[data-digest-item]")).toHaveLength(0)
    expect(client.writePaperDigestRemote).not.toHaveBeenCalled()
    await act(async () => { button("Write digest")!.click() })
    expect(client.writePaperDigestRemote).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll("[data-digest-item]")).toHaveLength(9)
    expect(container.textContent).toContain("Written by AI from the abstract only")
    expect(container.querySelector('[data-digest-item="safety"] dd')!.textContent).toBe("Not stated in the abstract.")
    expect(button("Update from full text")).toBeDefined()
  })

  it("marks an item whose number was not found in the text, and shows a failure", async () => {
    client.loadPaperDigestRemote.mockResolvedValue(digest({ unverified: ["mainResult"] }))
    await render()
    expect(container.querySelector('[data-digest-item="mainResult"]')!.textContent).toContain("Check this against the paper")
    expect(container.querySelector('[data-digest-item="design"]')!.textContent).not.toContain("Check this against the paper")

    document.body.innerHTML = ""
    client.loadPaperDigestRemote.mockResolvedValue(null)
    client.writePaperDigestRemote.mockRejectedValue(new Error("No API key"))
    await render()
    await act(async () => { button("Write digest")!.click() })
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("No API key")
  })
})
