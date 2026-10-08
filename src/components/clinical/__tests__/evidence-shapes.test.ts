import { describe, expect, it } from "vitest"
import { arcPath, bubbleRadius, dotRadius, pieSlices } from "../evidence-shapes"

describe("the shapes of the evidence summary", () => {
  it("sizes a bubble by the square root of its papers, never over 72", () => {
    expect(bubbleRadius(1)).toBe(27)
    expect(bubbleRadius(4)).toBe(36)
    expect(bubbleRadius(40)).toBe(72)
    expect(bubbleRadius(400)).toBe(72)
    expect(bubbleRadius(2)).toBeGreaterThan(bubbleRadius(1))
  })

  it("divides a pie by benefit, no benefit and mixed, in that order, leaving out a kind with no paper", () => {
    expect(pieSlices({ benefit: 3, "no-benefit": 1, mixed: 0 })).toEqual([{ kind: "benefit", fraction: 0.75 }, { kind: "no-benefit", fraction: 0.25 }])
    expect(pieSlices({ benefit: 1, "no-benefit": 1, mixed: 2 }).map((slice) => [slice.kind, slice.fraction])).toEqual([["benefit", 0.25], ["no-benefit", 0.25], ["mixed", 0.5]])
    expect(pieSlices({ benefit: 0, "no-benefit": 0, mixed: 5 })).toEqual([{ kind: "mixed", fraction: 1 }])
    expect(pieSlices({ benefit: 0, "no-benefit": 0, mixed: 0 })).toEqual([])
  })

  it("draws a slice clockwise from 12 o'clock, as a wedge from the centre", () => {
    // The first quarter of a circle of radius 10 around (10, 10): from the top to the right.
    expect(arcPath(10, 10, 10, 0, 0.25)).toBe("M 10 10 L 10 0 A 10 10 0 0 1 20 10 Z")
    // Three quarters is the large arc.
    expect(arcPath(10, 10, 10, 0, 0.75)).toBe("M 10 10 L 10 0 A 10 10 0 1 1 0 10 Z")
    expect(arcPath(10, 10, 10, 0.75, 1)).toBe("M 10 10 L 0 10 A 10 10 0 0 1 10 0 Z")
  })

  it("sizes a dot by the logarithm of its participants, never over 16, and 5 when they are not known", () => {
    expect(dotRadius(null)).toBe(5)
    expect(dotRadius(9)).toBeCloseTo(8.6, 5)
    expect(dotRadius(120)).toBeGreaterThan(dotRadius(20))
    expect(dotRadius(120)).toBeLessThan(16)
    expect(dotRadius(10_000_000)).toBe(16)
  })
})
