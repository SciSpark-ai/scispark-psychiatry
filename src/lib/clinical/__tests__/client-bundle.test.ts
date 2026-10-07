import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// Seen on 2026-10-07: a clinical component imported a helper from a module that also runs the model
// (and so reads files). The unit tests passed, but the page could not be bundled for the browser
// and Home stopped loading. This follows the imports of every clinical client component and fails
// if any path reaches a module that needs Node.

const SRC = path.resolve(__dirname, "../../..")
const NODE_ONLY = /from\s+["'](?:node:[^"']+|fs|fs\/promises|path|os|child_process|crypto)["']/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : walk(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null
  if (!base) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    try { if (statSync(candidate).isFile()) return candidate } catch { /* try the next spelling */ }
  }
  return null
}

/** Value imports only: `import type` and `import { type X }` are erased and bundle nothing. */
function imports(file: string): string[] {
  const source = readFileSync(file, "utf8")
  const specs: string[] = []
  for (const match of source.matchAll(/^\s*import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {
    if (match[1]) continue
    const names = match[2].trim()
    const onlyTypes = names.startsWith("{") && names.slice(1, -1).split(",").every((name) => name.trim() === "" || name.trim().startsWith("type "))
    if (!onlyTypes) specs.push(match[3])
  }
  return specs
}

function pathToNode(entry: string): string[] | null {
  const seen = new Set<string>()
  const visit = (file: string, trail: string[]): string[] | null => {
    if (seen.has(file)) return null
    seen.add(file)
    const here = [...trail, path.relative(SRC, file)]
    if (NODE_ONLY.test(readFileSync(file, "utf8"))) return here
    for (const spec of imports(file)) {
      const next = resolve(file, spec)
      if (!next) continue
      const found = visit(next, here)
      if (found) return found
    }
    return null
  }
  return visit(entry, [])
}

describe("clinical client components can be bundled for the browser", () => {
  const clients = walk(path.join(SRC, "components/clinical")).filter((file) => readFileSync(file, "utf8").startsWith('"use client"'))
  it("finds the client components", () => {
    expect(clients.length).toBeGreaterThanOrEqual(5)
  })
  for (const file of clients) {
    it(`${path.relative(SRC, file)} reaches no module that needs Node`, () => {
      expect(pathToNode(file)).toBeNull()
    })
  }
})
