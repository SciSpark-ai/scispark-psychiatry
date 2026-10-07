import type { SpecialtyPack } from "../pack/schema"
import { resolveFacet } from "../plan/queries"
import { mentions } from "../filter/gate"
import type { GatedCandidate, MatchedPart, StageAGrade, WatchEntry } from "../types"

/**
 * The model says which part of a watch entry a paper matches; this checks the claim against the
 * paper's own text, as the quote check does for grades. A part counts only if the title, abstract
 * or MeSH headings name it: one of the terms the taxonomy gives for it (names, synonyms, brands,
 * subtypes), or another form of a long single-word term ("depressed" for "depression").
 *
 * The check only ever lowers a claim: full to condition or treatment, or to no match at all. It
 * does not use related drugs: ketamine is not counted as esketamine.
 */

const lower = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()
const STEM = 6

function names(text: string, headings: string[], terms: string[], mesh: string[]): boolean {
  if (mesh.some((heading) => headings.includes(lower(heading)))) return true
  return terms.map(lower).some((term) => {
    if (mentions(text, term)) return true
    // Another form of the same word: only for one long word, and only at the start of a word.
    if (term.includes(" ") || term.length < STEM + 2) return false
    return new RegExp(`(?<![a-z0-9])${term.slice(0, STEM).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]*`).test(text)
  })
}

export function verifyMatchedParts(grade: StageAGrade, candidate: GatedCandidate, entries: WatchEntry[], pack: SpecialtyPack): StageAGrade {
  if (!grade.matched || grade.entryId === null) return grade
  const entry = entries.find((candidateEntry) => candidateEntry.id === grade.entryId)
  if (!entry) return grade
  const text = lower(`${candidate.paper.title} ${candidate.paper.abstract ?? ""}`)
  const headings = (candidate.paper.fields ?? []).map(lower)
  const part = (label: string | undefined, type: "condition" | "treatment") => {
    if (!label) return false
    const facet = resolveFacet(pack, label, type)
    return names(text, headings, facet.words, facet.mesh)
  }
  const claimsCondition = grade.matched !== "treatment"
  const claimsTreatment = grade.matched !== "condition"
  const onCondition = claimsCondition && part(entry.condition, "condition")
  const onTreatment = claimsTreatment && part(entry.treatment, "treatment")
  const wantsBoth = Boolean(entry.condition) && Boolean(entry.treatment)
  const matched: MatchedPart | undefined = wantsBoth
    ? (onCondition && onTreatment ? "full" : onCondition ? "condition" : onTreatment ? "treatment" : undefined)
    : onCondition || onTreatment ? "full" : undefined
  if (matched === grade.matched) return grade
  if (matched) return { ...grade, matched }
  const { matched: _claimed, ...rest } = grade
  void _claimed
  return { ...rest, entryId: null, grade: 0 }
}
