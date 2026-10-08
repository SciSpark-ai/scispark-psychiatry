import type { ReactNode } from "react"

/** A row of bubbles, named for a screen reader. It wraps when the screen is narrow. */
export function BubbleRow({ label, children }: { label: string; children: ReactNode }) {
  return <div role="group" aria-label={label} data-bubble-row="true" className="flex flex-wrap items-end gap-x-5 gap-y-4 py-2">{children}</div>
}
