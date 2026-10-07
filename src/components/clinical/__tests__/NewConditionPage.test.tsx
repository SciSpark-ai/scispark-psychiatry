// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
const client = vi.hoisted(() => ({ listConditionsRemote: vi.fn(), createConditionPageRemote: vi.fn() }))
vi.mock("@/lib/clinical/records/client", () => client)

import { NewConditionPage } from "../NewConditionPage"

let container: HTMLDivElement
async function render() {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(<NewConditionPage />) })
  await act(async () => {})
}
beforeEach(() => { document.body.innerHTML = ""; push.mockReset(); client.listConditionsRemote.mockReset(); client.createConditionPageRemote.mockReset() })

describe("the control that makes a condition page", () => {
  it("lists the pack's conditions, makes the page of the chosen one and opens it", async () => {
    client.listConditionsRemote.mockResolvedValue([{ code: "depression", name: "Major depressive disorder" }, { code: "schizophrenia", name: "Schizophrenia" }])
    client.createConditionPageRemote.mockResolvedValue({ id: "wiki/conditions/schizophrenia", created: true })
    await render()
    const select = container.querySelector("select") as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual(["Choose a condition…", "Major depressive disorder", "Schizophrenia"])
    const button = container.querySelector("button") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await act(async () => { select.value = "schizophrenia"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    await act(async () => { button.click() })
    expect(client.createConditionPageRemote).toHaveBeenCalledWith("schizophrenia")
    expect(push).toHaveBeenCalledWith("/wiki/conditions/schizophrenia")
  })
  it("shows why a page could not be made", async () => {
    client.listConditionsRemote.mockResolvedValue([{ code: "depression", name: "Major depressive disorder" }])
    client.createConditionPageRemote.mockRejectedValue(new Error("The vault could not be written."))
    await render()
    const select = container.querySelector("select") as HTMLSelectElement
    await act(async () => { select.value = "depression"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    await act(async () => { (container.querySelector("button") as HTMLButtonElement).click() })
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("could not be written")
    expect(push).not.toHaveBeenCalled()
  })
})
