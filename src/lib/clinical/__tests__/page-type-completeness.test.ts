import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { PAGE_TYPES } from "../../vault/types"
import { DEFAULT_ROUTING } from "../../wiki/schema-routing"
import { DISABLED_PAGE_TYPES, enabledPageTypes } from "../page-types"

const SRC = path.resolve(__dirname, "../../..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

/** True when the file names the type as a string literal or an object key. */
const mentions = (text: string, type: string) => new RegExp(`["']${type}["']|\\b${type}\\s*:`).test(text)

/**
 * Files that name two rarely-used page types are enumerating the types. Each of them must also
 * handle `condition`, or the new type silently disappears from that surface. Upstream has missed
 * enumeration sites before, so this scans the source instead of trusting a list.
 */
describe("page type completeness", () => {
  // The clinical folder itself lists the disabled types on purpose.
  const enumerating = sourceFiles(SRC).filter((file) => !file.includes(path.join("lib", "clinical") + path.sep)).filter((file) => {
    const text = readFileSync(file, "utf8")
    return mentions(text, "comparison") && mentions(text, "idea")
  })

  it("finds the enumeration sites it is meant to guard", () => {
    const names = enumerating.map((file) => path.relative(SRC, file))
    expect(names).toEqual(expect.arrayContaining([
      "lib/vault/types.ts", "lib/vault/scaffold.ts", "lib/vault/index-builder.ts", "lib/wiki/dashboard.ts",
      "components/wiki/Tree.tsx", "components/viz/FilterBar.tsx",
    ]))
  })

  it("handles condition at every enumeration site", () => {
    const missing = enumerating
      .filter((file) => !mentions(readFileSync(file, "utf8"), "condition"))
      .map((file) => path.relative(SRC, file))
    expect(missing).toEqual([])
  })

  it("routes every enabled type and no disabled type in the default schema", () => {
    expect(PAGE_TYPES).toContain("condition")
    expect(Object.keys(DEFAULT_ROUTING).sort()).toEqual([...enabledPageTypes()].sort())
    for (const type of DISABLED_PAGE_TYPES) expect(DEFAULT_ROUTING).not.toHaveProperty(type)
  })
})
