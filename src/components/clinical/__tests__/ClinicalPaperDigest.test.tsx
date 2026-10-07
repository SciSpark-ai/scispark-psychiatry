// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { PAPER_DIGEST_ITEMS, type StoredPaperDigest } from "@/lib/clinical/digest/paper"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = vi.hoisted(() => ({ loadPaperDigestRemote: vi.fn(), writePaperDigestRemote: vi.fn() }))
vi.mock("@/lib/clinical/digest/paper-client", () => client)

import { ClinicalDigestButton, ClinicalPaperDigest, ClinicalPaperNav, DIGEST_GROUPS } from "../ClinicalPaperDigest"
import { usePaperDigest } from "../usePaperDigest"

const PAPER = { ids: { pmid: "42" }, title: "Drug A versus placebo", abstract: "We randomised 200 adults.", authors: [], fields: [], source: "pubmed" as const }
const ABSTRACT = { access: "abstract" as const, locator: "Abstract", checkedAt: "2026-10-07T10:00:00.000Z", truncated: false, notes: [] }
const digest = (over: Partial<StoredPaperDigest> = {}): StoredPaperDigest => ({
  version: 1, unverified: [],
  items: {
    question: "Does drug A improve response?", design: "Randomised double-blind trial over 8 weeks", population: "200 adults with depression",
    intervention: "Drug A 20 mg versus placebo", mainResult: "Response was 48% with drug A and 31% with placebo.",
    secondaryOutcomes: null, safety: null, limitations: "Short follow-up.", conclusion: "Drug A improved response.", funding: null,
  },
  source: { access: "full-text", locator: "PMC", checkedAt: "2026-10-07T10:00:00.000Z", truncated: false, notes: [] },
  ...over,
})

let container: HTMLDivElement
async function render(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(node) })
  await act(async () => {})
}
/** The button and the digest wired together the way the paper page wires them. */
function Page() {
  const state = usePaperDigest(PAPER)
  return <><ClinicalDigestButton state={state} /><ClinicalPaperDigest state={state} /></>
}
const button = (text: string) => [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text)) as HTMLButtonElement | undefined
beforeEach(() => { document.body.innerHTML = ""; client.loadPaperDigestRemote.mockReset(); client.writePaperDigestRemote.mockReset() })

describe("the digest on the paper page", () => {
  it("labels the items in the order the library writes them, in three groups", () => {
    expect(Object.keys(CLINICAL_COPY.paper.digest.labels)).toEqual([...PAPER_DIGEST_ITEMS])
    expect(DIGEST_GROUPS.flatMap((group) => group.items)).toEqual([...PAPER_DIGEST_ITEMS])
    expect(DIGEST_GROUPS.map((group) => CLINICAL_COPY.paper.digest.groups[group.id])).toEqual(["The study", "Results", "Appraisal"])
  })

  it("shows a stored digest in its groups, the main result set apart, and what was not stated on one line", async () => {
    client.loadPaperDigestRemote.mockResolvedValue(digest())
    await render(<Page />)
    expect([...container.querySelectorAll("[data-digest-group]")].map((group) => [group.querySelector("h3")!.textContent, [...group.querySelectorAll("[data-digest-item] dt")].map((label) => label.textContent)])).toEqual([
      ["The study", ["Research question", "Study design", "Population", "Intervention and comparator"]],
      ["Results", ["Main result"]],
      ["Appraisal", ["Limitations", "Authors' conclusion"]],
    ])
    expect(container.querySelector('[data-digest-item="mainResult"]')!.getAttribute("data-main")).toBe("true")
    expect(container.querySelector('[data-digest-item="mainResult"] dd')!.textContent).toBe("Response was 48% with drug A and 31% with placebo.")
    expect(container.querySelector("[data-testid=digest-not-stated]")!.textContent).toBe("Not stated in the paper: secondary outcomes, safety, funding and conflicts of interest.")
    expect(container.textContent).toContain("Written by AI from the full text")
    // Written from the full text already: nothing more to ask for, and nothing was asked for.
    expect(button("Digest written")!.disabled).toBe(true)
    expect(client.writePaperDigestRemote).not.toHaveBeenCalled()
  })

  it("shows nothing until a digest is asked for, then writes one", async () => {
    client.loadPaperDigestRemote.mockResolvedValue(null)
    client.writePaperDigestRemote.mockResolvedValue({ digest: digest({ source: ABSTRACT }), fromCache: false })
    await render(<Page />)
    expect(container.querySelector("[data-testid=paper-digest]")).toBeNull()
    expect(client.writePaperDigestRemote).not.toHaveBeenCalled()
    await act(async () => { button("Write digest")!.click() })
    expect(client.writePaperDigestRemote).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll("[data-digest-item]")).toHaveLength(7)
    expect(container.textContent).toContain("Written by AI from the abstract only")
    // From the abstract, the two items only a full text gives are not counted as missing.
    expect(container.querySelector("[data-testid=digest-not-stated]")!.textContent).toBe("Not stated in the abstract: safety, funding and conflicts of interest.")
    expect(button("Update from full text")!.disabled).toBe(false)
  })

  it("marks an item whose number was not found in the text, and shows a failure", async () => {
    client.loadPaperDigestRemote.mockResolvedValue(digest({ unverified: ["mainResult"] }))
    await render(<Page />)
    expect(container.querySelector('[data-digest-item="mainResult"]')!.textContent).toContain("Check this against the paper")
    expect(container.querySelector('[data-digest-item="design"]')!.textContent).not.toContain("Check this against the paper")

    document.body.innerHTML = ""
    client.loadPaperDigestRemote.mockResolvedValue(null)
    client.writePaperDigestRemote.mockRejectedValue(new Error("No API key"))
    await render(<Page />)
    await act(async () => { button("Write digest")!.click() })
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("No API key")
  })

  it("lists the parts of the page in the side navigation, in the order they are on the page", async () => {
    await render(<ClinicalPaperNav hasSummary digest={digest()} hasAbstract />)
    expect([...container.querySelectorAll("nav a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["AI summary", "#paper-summary"], ["Digest", "#paper-digest"], ["The study", "#digest-study"], ["Results", "#digest-results"], ["Appraisal", "#digest-appraisal"], ["Abstract", "#paper-abstract"],
    ])
    document.body.innerHTML = ""
    await render(<ClinicalPaperNav hasSummary={false} digest={null} hasAbstract />)
    expect([...container.querySelectorAll("nav a")].map((link) => link.textContent)).toEqual(["Abstract"])
  })
})
