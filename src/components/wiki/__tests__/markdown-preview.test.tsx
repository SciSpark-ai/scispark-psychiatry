// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { isValidElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { renderMarkdown } from "../markdown-preview"

/**
 * Regression guard (2026-07-18, found on Tong's SP2 live walk): the block
 * renderer incremented its `key` counter INSIDE children expressions
 * (`h-${key++}`) while the element's own key read `b-${key}`. Under the
 * automatic JSX runtime, `key` is jsx()'s third ARGUMENT and evaluates
 * AFTER the props/children — so the increment ran first and the element's
 * key collided with the next block's ("two children with the same key,
 * b-4"). Keys must be computed before any JSX side effects.
 */

function topLevelKeys(markdown: string): string[] {
  const fragment = renderMarkdown(markdown) as ReactElement<{ children: unknown }>
  const children = fragment.props.children
  const arr = Array.isArray(children) ? children : [children]
  return arr.filter(isValidElement).map((el) => String(el.key))
}

describe("renderMarkdown block keys", () => {
  it("assigns unique keys across heading/list/paragraph/code blocks", () => {
    const md = [
      "# Title",
      "",
      "- one",
      "- two",
      "",
      "A paragraph.",
      "",
      "## Section",
      "",
      "- three",
      "- four",
      "",
      "```",
      "code",
      "```",
      "",
      "1. ordered",
      "2. list",
    ].join("\n")
    const keys = topLevelKeys(md)
    expect(keys.length).toBeGreaterThanOrEqual(6)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("renders the walk-reported shape (heading directly followed by a list) without key collisions", () => {
    const keys = topLevelKeys("# H\n\n- a\n- b")
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("still renders content correctly", () => {
    const html = renderToStaticMarkup(<>{renderMarkdown("# H\n\npara **bold**\n\n- item")}</>)
    expect(html).toContain("H")
    expect(html).toContain("<strong>bold</strong>")
    expect(html).toContain("<li>item</li>")
  })
})

describe("a fenced block a caller knows how to draw", () => {
  it("hands the language and the body to the caller, and draws what it returns in place of the code block", () => {
    const seen: Array<[string, string]> = []
    const html = renderToStaticMarkup(<>{renderMarkdown("Before\n\n```evidence-table\ncondition: depression\n```\n\nAfter", {
      fence: (language, body) => { seen.push([language, body]); return <div data-drawn="yes">table here</div> },
    })}</>)
    expect(seen).toEqual([["evidence-table", "condition: depression"]])
    expect(html).toContain('<div data-drawn="yes">table here</div>')
    expect(html).not.toContain("<pre")
    expect(html.indexOf("Before")).toBeLessThan(html.indexOf("table here"))
    expect(html.indexOf("table here")).toBeLessThan(html.indexOf("After"))
  })
  it("draws an ordinary code block when the caller declines, or when there is no caller", () => {
    const declined = renderToStaticMarkup(<>{renderMarkdown("```js\nlet a = 1\n```", { fence: () => null })}</>)
    expect(declined).toContain("<pre")
    expect(declined).toContain("let a = 1")
    expect(renderToStaticMarkup(<>{renderMarkdown("```evidence-table\ncondition: depression\n```")}</>)).toContain("condition: depression")
  })
})
