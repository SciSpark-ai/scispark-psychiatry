import { useLayoutEffect, useState } from "react"

/** What the element is given as its `ref`, and its width. */
type Measured = [(element: HTMLElement | null) => void, number]

/**
 * The width in px of an element, as the browser measures it: `fallback` until it is measured, and where there is
 * nothing to measure with. The first value is what the caller gives to the element as its `ref`. A width of nothing
 * (an element that is not shown) is not kept.
 */
export function useMeasuredWidth(fallback: number): Measured {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    if (element === null || typeof ResizeObserver === "undefined") return
    // The observer tells the width once when it starts to watch, and then at every change of it.
    const observer = new ResizeObserver((entries) => {
      const measured = Math.round(entries[entries.length - 1]?.contentRect.width ?? 0)
      if (measured > 0) setWidth(measured)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, width]
}
