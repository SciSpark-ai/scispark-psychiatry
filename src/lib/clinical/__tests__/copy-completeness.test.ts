import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// All clinical wording lives in copy.ts (spec 8.1, 8.4). These scans are heuristics: they catch
// quoted sentences, JSX text and message literals, not every possible way to build a string.

const SRC = path.resolve(__dirname, "../../..")

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : walk(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}
const rel = (file: string) => path.relative(SRC, file)

/** A literal made only of identifiers, paths, class names or symbols is not wording. */
function isWording(literal: string): boolean {
  const text = literal.replace(/\$\{[^}]*\}/g, " ").trim()
  if (!/[A-Za-z]{3,}/.test(text)) return false
  return !text.split(/\s+/).every((token) => /^[a-z0-9\-_\[\]:/.%!@#]*$/.test(token))
}

function hardCodedWording(source: string): string[] {
  const found: string[] = []
  for (const line of source.split("\n")) {
    if (/^\s*(import |\/\/|\*|\/\*)/.test(line)) continue
    for (const match of line.matchAll(/"([^"\n]*)"|`([^`\n]*)`/g)) {
      const literal = match[1] ?? match[2] ?? ""
      if (isWording(literal)) found.push(literal)
    }
    // JSX text after a tag, and text between two JSX expressions.
    for (const match of line.matchAll(/>([^<>{}()=;"`]*[A-Za-z]{3,}[^<>{}()=;"`]*)(?:<\/|\{)/g)) found.push(match[1].trim())
    for (const match of line.matchAll(/\}([^<>{}()=;,"`]*[A-Za-z]{3,}[^<>{}()=;,"`]*)\{/g)) {
      if (!/^\s*(finally|else|catch|try)\s*$/.test(match[1])) found.push(match[1].trim())
    }
    const leading = line.match(/^\s*([A-Z][a-z]+ )\{/)
    if (leading) found.push(leading[1].trim())
  }
  return found
}

describe("clinical wording lives in copy.ts", () => {
  it("has no hard-coded wording in the clinical components and routes", () => {
    const files = [...walk(path.join(SRC, "components/clinical")), ...walk(path.join(SRC, "app/watch")), path.join(SRC, "app/page.tsx")]
    const offenders = files.flatMap((file) => hardCodedWording(readFileSync(file, "utf8")).map((text) => `${rel(file)}: ${text}`))
    expect(offenders).toEqual([])
  })

  it("has no message literal in the feed code that reaches the user", () => {
    // Errors and warnings of a run are shown on Home. Internal invariants (the pack loader, the id check) are not.
    const internal = new Set(["lib/clinical/copy.ts", "lib/clinical/pack/load.ts", "lib/clinical/watch/store.ts"])
    const offenders = walk(path.join(SRC, "lib/clinical"))
      .filter((file) => !internal.has(rel(file)))
      .flatMap((file) => readFileSync(file, "utf8").split("\n")
        .filter((line) => /(new Error\(|super\(|warnings\.push\(|warnings: \[|Record<FeedMode, string> = \{)\s*["`]/.test(line))
        .map((line) => `${rel(file)}: ${line.trim()}`))
    expect(offenders).toEqual([])
  })

  it("names the watch list in the navigation from the copy file", () => {
    const sidebar = readFileSync(path.join(SRC, "components/layout/Sidebar.tsx"), "utf8")
    expect(sidebar).not.toContain('label: "Watch list"')
    expect(sidebar).toContain("CLINICAL_COPY.watch.heading")
  })
})
