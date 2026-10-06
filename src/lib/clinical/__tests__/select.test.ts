import { describe, expect, it } from "vitest"
import { selectFeed } from "../select/select"
import { scored, watch } from "./helpers"

const entries = [watch({ id: "a", condition: "depression", priority: "high" }), watch({ id: "b", condition: "ptsd" }), watch({ id: "c", condition: "adhd", priority: "paused" })]

function many(entryId: string, count: number, startScore: number, g = 3) {
  return Array.from({ length: count }, (_, i) => scored(`${entryId}${i}`, `Distinct ${entryId} study number ${i} ${"xyz".repeat(i % 3)} unique${entryId}${i}`, entryId, g, startScore - i))
}

describe("selectFeed", () => {
  it("separates the shortlist from lower-confidence items, keeping both", () => {
    const result = selectFeed([...many("a", 2, 90), scored("x", "Unmatched general paper about mood", null, 0, 95), scored("y", "Weak match to entry b here", "b", 1, 60)], entries)
    expect(result.items.map((i) => i.candidate.key)).toEqual(["a0", "a1"])
    expect(result.lowerConfidence.map((i) => i.candidate.key)).toEqual(["x", "y"])
  })

  it("reserves slots per entry so a loud entry cannot crowd out a quiet one", () => {
    const loud = many("a", 30, 100)
    const quiet = many("b", 2, 40)
    const { items } = selectFeed([...loud, ...quiet], entries)
    const firstPage = items.slice(0, 12).map((i) => i.grade.entryId)
    expect(firstPage.filter((id) => id === "b")).toHaveLength(2)
    expect(firstPage.filter((id) => id === "a").length).toBeLessThanOrEqual(10)
  })

  it("gives a High entry two reserved slots and a Normal entry one", () => {
    const { items } = selectFeed([...many("a", 20, 50), ...many("b", 20, 50)].map((i) => ({ ...i, score: i.grade.entryId === "a" ? i.score - 40 : i.score - 49 })), entries)
    const page = items.slice(0, 12)
    expect(page.filter((i) => i.grade.entryId === "a").length).toBeGreaterThanOrEqual(2)
    expect(page.filter((i) => i.grade.entryId === "b").length).toBeGreaterThanOrEqual(1)
  })

  it("returns unfilled reservations to the pool", () => {
    const { items } = selectFeed(many("a", 12, 90), entries)
    expect(items).toHaveLength(12)
  })

  it("caps one entry at half a page while others have items, and relaxes it when alone", () => {
    const mixed = selectFeed([...many("a", 20, 100), ...many("b", 3, 10)], entries).items.slice(0, 12)
    expect(mixed.filter((i) => i.grade.entryId === "a").length).toBeLessThanOrEqual(9)
    const alone = selectFeed(many("a", 20, 100), entries).items
    expect(alone.slice(0, 12).every((i) => i.grade.entryId === "a")).toBe(true)
  })

  it("never lists more than 48 items", () => {
    expect(selectFeed(many("a", 100, 200), entries).items).toHaveLength(48)
  })

  it("suppresses a near-duplicate title and logs it", () => {
    const first = scored("p1", "Esketamine versus quetiapine augmentation in treatment-resistant depression", "a", 4, 90)
    const twin = scored("p2", "Esketamine versus quetiapine augmentation in treatment-resistant depression.", "a", 4, 80)
    const result = selectFeed([first, twin], entries)
    expect(result.items.map((i) => i.candidate.key)).toEqual(["p1"])
    expect(result.drops).toEqual([{ key: "p2", title: twin.candidate.paper.title, step: "select", reason: "near-duplicate" }])
  })
})
