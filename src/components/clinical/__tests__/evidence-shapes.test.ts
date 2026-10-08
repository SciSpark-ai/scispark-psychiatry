import { describe, expect, it } from "vitest"
import { arcPath, bubbleRadius, KIND_TEXT_COLOUR, KIND_TINT, pieSlices, SAFETY_COLOUR } from "../evidence-shapes"

describe("the shapes of the evidence summary", () => {
  it("writes the word Safety in the colour of text, and keeps the violet for the ring", () => {
    expect(KIND_TEXT_COLOUR.safety).toBe("var(--text-primary)")
    expect(SAFETY_COLOUR).toBe("var(--viz-cat-3)")
  })

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

  it("tints the pill of a direction with its colour at 12%, the violet for safety and the muted text for a neutral kind", () => {
    expect(KIND_TINT.benefit).toBe("color-mix(in srgb, var(--clinical-benefit) 12%, transparent)")
    expect(KIND_TINT["no-benefit"]).toBe("color-mix(in srgb, var(--clinical-no-benefit) 12%, transparent)")
    expect(KIND_TINT.mixed).toBe("color-mix(in srgb, var(--text-muted) 12%, transparent)")
    expect(KIND_TINT.safety).toBe("color-mix(in srgb, var(--viz-cat-3) 12%, transparent)")
    expect(KIND_TINT.other).toBe("color-mix(in srgb, var(--text-muted) 12%, transparent)")
  })
})
