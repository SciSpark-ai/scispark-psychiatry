// src/components/clinical/__tests__/ConditionHome.test.tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
const evidence = vi.hoisted(() => ({ listFollowedConditionsRemote: vi.fn() }))
vi.mock("@/lib/clinical/evidence/client", () => evidence)
const records = vi.hoisted(() => ({ createConditionPageRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => records)

import { ConditionHome } from "../ConditionHome"

let container: HTMLDivElement
async function render() {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<ConditionHome />) })
  await act(async () => {})
}
beforeEach(() => { document.body.innerHTML = ""; push.mockReset(); evidence.listFollowedConditionsRemote.mockReset(); records.createConditionPageRemote.mockReset() })

describe("wiki home", () => {
  it("shows a card for each condition the reader follows, with its papers, what is new and its main treatments", async () => {
    evidence.listFollowedConditionsRemote.mockResolvedValue([
      { code: "depression", name: "Major depressive disorder", total: 22, recent: 5, treatments: ["Ketamine", "Lithium"], pageId: "wiki/conditions/major-depressive-disorder" },
      { code: "adhd", name: "ADHD", total: 0, recent: 0, treatments: [], pageId: null },
    ])
    await render()
    const cards = [...container.querySelectorAll("[data-condition]")]
    expect(cards.map((card) => card.getAttribute("data-condition"))).toEqual(["depression", "adhd"])
    expect(cards[0].textContent).toContain("Major depressive disorder")
    expect(cards[0].querySelector("[data-count]")!.textContent).toBe("22 papers · 5 new in the last two weeks")
    expect(cards[0].querySelector("[data-treatments]")!.textContent).toBe("Ketamine, Lithium")
    expect(cards[1].querySelector("[data-count]")!.textContent).toBe("No papers yet")
    expect(cards[1].querySelector("[data-treatments]")).toBeNull()
  })

  it("opens a condition's page, making it first when there is none", async () => {
    evidence.listFollowedConditionsRemote.mockResolvedValue([{ code: "adhd", name: "ADHD", total: 3, recent: 0, treatments: [], pageId: null }])
    records.createConditionPageRemote.mockResolvedValue({ id: "wiki/conditions/adhd", created: true })
    await render()
    await act(async () => { (container.querySelector("[data-condition] button") as HTMLButtonElement).click() })
    expect(records.createConditionPageRemote).toHaveBeenCalledWith("adhd")
    expect(push).toHaveBeenCalledWith("/wiki/conditions/adhd")
  })

  it("says what to do when no condition is followed, and why when the list cannot be had", async () => {
    evidence.listFollowedConditionsRemote.mockResolvedValue([])
    await render()
    expect(container.textContent).toContain("You are not following a condition yet")
    expect(container.querySelector('a[href="/watch"]')).not.toBeNull()
    document.body.innerHTML = ""
    evidence.listFollowedConditionsRemote.mockRejectedValue(new Error("The vault is closed."))
    await render()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("The vault is closed.")
  })
})
