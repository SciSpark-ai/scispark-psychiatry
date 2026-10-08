// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }))
const projects = vi.hoisted(() => ({ listProjectsRemote: vi.fn(), createProjectRemote: vi.fn() }))
vi.mock("@/lib/projects/client", () => projects)

import OutputsPage from "../page"
import ProjectsPage from "../../projects/page"

const project = (id: string, title: string) => ({ id, title, description: `About ${title}`, counts: { papers: 2, conversations: 1 } })

let container: HTMLDivElement
async function render(page: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => { createRoot(container).render(page) })
  await act(async () => {})
}
const cards = () => [...container.querySelectorAll("h2")].map((heading) => heading.textContent)

beforeEach(() => {
  document.body.innerHTML = ""
  nav.push.mockReset()
  projects.listProjectsRemote.mockReset().mockResolvedValue([project("grand-rounds", "Grand rounds talk"), project("trd-review", "TRD review")])
})

describe("the Outputs page (/outputs)", () => {
  it("lists the projects under the heading Outputs and its one line", async () => {
    await render(<OutputsPage />)
    expect([...container.querySelectorAll("h1")].map((heading) => heading.textContent)).toEqual(["Outputs"])
    expect(container.textContent).toContain("Bring papers and notes together for a talk, a summary or a review.")
    expect(container.textContent).not.toContain("Organize vault papers")
    expect(projects.listProjectsRemote).toHaveBeenCalledTimes(1)
    expect(cards()).toEqual(["Grand rounds talk", "TRD review"])
  })

  it("opens a project on its own page, /projects/<id>", async () => {
    await render(<OutputsPage />)
    const card = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("TRD review")) as HTMLButtonElement
    await act(async () => { card.click() })
    expect(nav.push).toHaveBeenCalledWith("/projects/trd-review")
  })

  it("is the same list /projects draws, which keeps its own heading", async () => {
    await render(<ProjectsPage />)
    expect([...container.querySelectorAll("h1")].map((heading) => heading.textContent)).toEqual(["Projects"])
    expect(container.textContent).toContain("Organize vault papers, conversations, and notes by research question.")
    expect(cards()).toEqual(["Grand rounds talk", "TRD review"])
  })
})
