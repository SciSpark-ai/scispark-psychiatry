import type { SpecialtyPack } from "../pack/schema"
import type { Candidate, DropRecord } from "../types"

/** MeSH headings that mark a psychiatric record even when no taxonomy node lists them. */
const MESH_PATTERN = /mental|psychiatr|psycho|depress|schizophren|bipolar|anxiety|autis|attention deficit|stress disorders|suicid|mood|obsessive|neurodevelopmental/i

function wordPattern(word: string): string {
  const escaped = word.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&")
  return escaped.endsWith("*") ? `\\b${escaped.slice(0, -1)}\\w*` : `\\b${escaped}\\b`
}

export type DomainReason = "mesh" | "text-word"

/** Builds the domain test from the pack: taxonomy MeSH labels, a psychiatric MeSH pattern, and the pack's text words. */
export function buildDomainMatcher(pack: SpecialtyPack): (candidate: Candidate) => DomainReason | null {
  const taxonomyMesh = new Set(pack.taxonomy.nodes.flatMap((node) => (node.meshHeading ? [node.meshHeading.toLowerCase()] : [])))
  const words = new RegExp(pack.textWords.map(wordPattern).join("|"), "i")
  return (candidate) => {
    const headings = candidate.paper.fields
    if (headings.some((heading) => taxonomyMesh.has(heading.toLowerCase()) || MESH_PATTERN.test(heading))) return "mesh"
    const text = `${candidate.paper.title}\n${candidate.paper.abstract ?? ""}`
    return words.test(text) ? "text-word" : null
  }
}

/** Step 3: keep psychiatric records; log the reason for every drop. */
export function domainFilter(pack: SpecialtyPack, candidates: Candidate[]): { kept: Candidate[]; drops: DropRecord[] } {
  const matches = buildDomainMatcher(pack)
  const kept: Candidate[] = []
  const drops: DropRecord[] = []
  for (const candidate of candidates) {
    if (matches(candidate)) kept.push(candidate)
    else drops.push({ key: candidate.key, title: candidate.paper.title, step: "prefilter", reason: "not-psychiatric" })
  }
  return { kept, drops }
}
