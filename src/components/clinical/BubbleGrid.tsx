import type { ReactNode } from "react"
import { bubbleRadius } from "./evidence-shapes"

const GRID = "grid items-start gap-x-3 gap-y-4 py-2"
/** As many equal columns as fit (`fill`, at every width), or two. */
const COLUMNS = { fill: "evidence-tiles", two: "grid-cols-2" } as const

/** The height of the box every disc of a grid sits in: the largest disc of `papers`, and room for a ring around it. */
export const discBoxHeight = (papers: number[]): number => 2 * Math.max(0, ...papers.map(bubbleRadius)) + 8

/**
 * A grid of bubbles in tiles of one width, named for a screen reader. Each bubble is given the same `discHeight`, so
 * the circles share a centre line and the names under them a baseline.
 */
export function BubbleGrid({ label, columns = "fill", children }: { label: string; columns?: keyof typeof COLUMNS; children: ReactNode }) {
  return <div role="group" aria-label={label} data-bubble-grid={columns} className={`${GRID} ${COLUMNS[columns]}`}>{children}</div>
}
