import type { PaperRecord } from "../../papers/types"
import { feedExclusionReason } from "../../papers/eligibility"
import type { SpecialtyPack } from "../pack/schema"
import { resolveFacet } from "../plan/queries"
import type { Candidate, Design, DesignSource, DropRecord, GatedCandidate, GateStrictness, WatchEntry } from "../types"

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()

function fromPublicationTypes(types: string[]): Design | null {
  const set = types.map(norm)
  const has = (...names: string[]) => names.some((name) => set.includes(name))
  const startsWith = (prefix: string) => set.some((type) => type.startsWith(prefix))
  if (has("retracted publication", "retraction of publication")) return "retraction"
  if (has("published erratum", "erratum", "corrected and republished article")) return "erratum"
  if (has("clinical trial protocol")) return "protocol"
  if (has("meta-analysis")) return "meta-analysis"
  if (has("systematic review")) return "systematic-review"
  if (has("practice guideline", "guideline")) return "guideline"
  if (has("randomized controlled trial")) return "randomized-trial"
  if (has("case reports")) return "case-report"
  if (has("editorial", "letter", "comment", "news", "biography", "interview", "lecture", "newspaper article", "personal narrative")) return "editorial"
  if (startsWith("clinical trial") || has("pragmatic clinical trial", "controlled clinical trial")) return "clinical-trial"
  if (has("observational study", "multicenter study")) return "cohort"
  if (has("review")) return "review"
  return null
}

/** MeSH marks animal work with "Animals"; a human study that also used animals carries "Humans" too. */
function animalsOnly(fields: string[]): boolean {
  const set = fields.map(norm)
  return set.includes("animals") && !set.includes("humans")
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n/)
/** "We conducted a meta-analysis", not "previous meta-analyses suggested". */
const OWN_WORK = /\b(?:we|this|our|present|current)\b/i
const OTHERS_WORK = /\b(?:previous|prior|earlier|recent|published|existing)\b/i

/**
 * Design from the wording, used only when PubMed has not assigned a type. A word must describe
 * this paper to count: in the title, or in a sentence of the abstract that says what the authors
 * did. An abstract that ends "randomized trials are needed" is not a randomized trial.
 */
function fromText(paper: PaperRecord): Design | null {
  const title = paper.title
  const abstract = paper.abstract ?? ""
  const own = sentencesOf(abstract).filter((sentence) => OWN_WORK.test(sentence) && !OTHERS_WORK.test(sentence)).join(" ")
  // A study protocol says so; a trial of a treatment protocol ("theta burst stimulation protocol", "Unified Protocol") does not.
  if (/\b(?:study|trial|review|research) protocol\b|\bprotocol (?:for|of) (?:a|an|the)\b|:\s*(?:a |the )?protocol\b/i.test(title)) return "protocol"
  if (/\b(?:mice|mouse|rats?|murine|rodents?|zebrafish|in vitro|animal model)\b/i.test(title)) return "preclinical"
  if (/\bmeta-?analy(?:sis|ses|tic)\b/i.test(`${title} ${own}`)) return "meta-analysis"
  if (/\b(?:systematic (?:literature )?|scoping |umbrella |rapid )review\b/i.test(`${title} ${own}`)) return "systematic-review"
  if (/\b(?:guidelines?|consensus statement)\b/i.test(title)) return "guideline"
  if (/\b(?:single[- ](?:group|arm)|uncontrolled)\b/i.test(title)) return "clinical-trial"
  if (/\brandomi[sz]ed\b|\bdouble-blind\b|\bplacebo-controlled\b/i.test(title)) return "randomized-trial"
  if (/\b(?:were|was) (?:then )?randomi[sz]ed\b|\brandomly (?:assigned|allocated)\b|\brandomi[sz]ed (?:to|into|in a|1:1|2:1)\b/i.test(abstract)) return "randomized-trial"
  if (/\bcase (?:report|series)\b/i.test(title) || /\bwe (?:report|describe) (?:a|the|an) (?:\w+ ){0,3}case\b/i.test(abstract)) return "case-report"
  if (/\b(?:cohort|prospective|longitudinal|registry-based|nationwide)\b/i.test(`${title} ${abstract}`)) return "cohort"
  if (/\breview\b|\boverview\b/i.test(title)) return "review"
  return null
}

/** Design from PubMed's publication types first, then from the wording. Not a quality judgement. */
export function classifyDesign(paper: PaperRecord): { design: Design; source: DesignSource } {
  const byType = fromPublicationTypes(paper.publicationTypes ?? [])
  const generic = byType === null || byType === "review"
  if (!generic) return { design: byType as Design, source: "publication-type" }
  if (animalsOnly(paper.fields ?? [])) return { design: "preclinical", source: "publication-type" }
  const byText = fromText(paper)
  // A bare "Review" type may still be a meta-analysis or systematic review; other text findings only fill a gap.
  if (byText && (byType === null || byText === "meta-analysis" || byText === "systematic-review")) return { design: byText, source: "text-rule" }
  if (byType) return { design: byType, source: "publication-type" }
  const hasEvidence = (paper.publicationTypes ?? []).length > 0 || Boolean(paper.abstract)
  return hasEvidence ? { design: "other", source: "none" } : { design: "unknown", source: "none" }
}

/** Strict admits a short list of designs. */
const STRICT: ReadonlySet<Design> = new Set(["meta-analysis", "systematic-review", "randomized-trial", "guideline"])
/**
 * Standard excludes rather than admits (owner decision, 2026-10-06): a paper is left out only when its
 * design is known to be one the feed does not want. A design nobody could name stays in, so a
 * wrong or missing label cannot remove a paper.
 */
export const STANDARD_EXCLUDED: ReadonlySet<Design> = new Set(["review", "editorial", "case-report", "protocol", "preclinical", "erratum", "retraction"])
const NEVER: ReadonlySet<Design> = new Set(["erratum", "retraction"])

export function designAccepted(strictness: GateStrictness, design: Design): boolean {
  if (strictness === "strict") return STRICT.has(design)
  if (strictness === "standard") return !STANDARD_EXCLUDED.has(design)
  return !NEVER.has(design)
}

/** Evidence signal by design (spec 6.10): design only, not study quality. */
export const DESIGN_TIER: Record<Design, number> = {
  "meta-analysis": 100, "systematic-review": 100, "randomized-trial": 90, guideline: 85, cohort: 60,
  "clinical-trial": 60, review: 40, "case-report": 40, editorial: 40, erratum: 0, retraction: 0, protocol: 20, preclinical: 20, other: 40, unknown: 50,
}

export interface GateResult {
  gated: GatedCandidate[]
  /** Case reports that match a safety-signal watch entry; shown collapsed, ungraded. */
  safety: GatedCandidate[]
  drops: DropRecord[]
}

/**
 * A case report is a safety signal for an entry when it mentions the entry's treatment (or, for a
 * condition-only entry, its condition). It need not mention both: an adverse event in a patient
 * whose condition is described differently is still a signal about the treatment.
 */
/** Whole-word match: "ect" must not match inside "effect", nor "mania" inside "Romania". */
export function mentions(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text)
}

function matchesSafetyEntry(pack: SpecialtyPack, entries: WatchEntry[], candidate: Candidate): boolean {
  const text = norm(`${candidate.paper.title} ${candidate.paper.abstract ?? ""}`)
  return entries.some((entry) => {
    if (!entry.safetySignal || entry.priority === "paused") return false
    const facet = entry.treatment
      ? resolveFacet(pack, entry.treatment, "treatment")
      : entry.condition ? resolveFacet(pack, entry.condition, "condition") : null
    return facet !== null && facet.words.some((word) => mentions(text, norm(word)))
  })
}

/** Step 4: exclude non-articles and retractions, classify design, apply the strictness setting. */
export function designGate(
  pack: SpecialtyPack, entries: WatchEntry[], candidates: Candidate[], strictness: GateStrictness,
): GateResult {
  const gated: GatedCandidate[] = []
  const safety: GatedCandidate[] = []
  const drops: DropRecord[] = []
  const drop = (candidate: Candidate, reason: string) =>
    drops.push({ key: candidate.key, title: candidate.paper.title, step: "gate", reason })

  for (const candidate of candidates) {
    const excluded = feedExclusionReason(candidate.paper)
    if (excluded) { drop(candidate, excluded); continue }
    const { design, source } = classifyDesign(candidate.paper)
    const withDesign: GatedCandidate = { ...candidate, design, designSource: source }
    if (design === "retraction" || design === "erratum") { drop(candidate, design); continue }
    if (design === "case-report") {
      if (matchesSafetyEntry(pack, entries, candidate)) safety.push(withDesign)
      else drop(candidate, "case-report")
      continue
    }
    if (designAccepted(strictness, design)) gated.push(withDesign)
    else drop(candidate, `design:${design}`)
  }
  return { gated, safety, drops }
}
