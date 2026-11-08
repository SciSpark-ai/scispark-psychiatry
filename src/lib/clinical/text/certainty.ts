// Pure text check, kept apart from digest/card.ts so that it can be measured without the model runner.

/** A verb or word that states an effect outright: "X improved Y", "X is effective". */
const FLAT = /\b(?:improv(?:e|es|ed)|reduc(?:e|es|ed)|lower(?:s|ed)|increas(?:es|ed)|decreas(?:es|ed)|prevent(?:s|ed)|alleviat(?:es|ed)|enhanc(?:es|ed)|boost(?:s|ed)|reliev(?:es|ed)|effective(?:ly)?|efficacious|led to|leads to|resulted in|results in|produc(?:es|ed)|caus(?:es|ed)|influenc(?:es|ed)|affect(?:s|ed)|benefit(?:s|ed)|outperform(?:s|ed)|superior)\b/i
/** A word in the summary that already keeps the claim soft, or turns it into a finding of no effect. */
const SOFT = /\b(?:may|might|could|associated|association|linked|correlat\w+|suggest\w*|preliminary|possibl[ey]|potential(?:ly)?|appear(?:s|ed)?|pilot|uncontrolled|open-label|observational|not|no|without|neither|nor|fail(?:s|ed)?)\b/i
/** The abstract says the groups were not formed by random allocation, or that there was no comparison group. */
const WEAK_DESIGN = /\b(?:retrospective(?:ly)?|observational|cohort|cross-sectional|case-control|open-label|single-arm|uncontrolled|non-?randomi[sz]ed|quasi-experimental|pilot|chart review|naturalistic|registry|no control group|without a control)\b/i
/** The abstract reports its result as an association. */
const ASSOCIATION = /\b(?:was|were|is|are|been) (?:\w+ )?(?:associated|linked|correlated) with\b/i
/** The authors' own closing words hold the claim back. */
const HELD_BACK = /\b(?:may|might|preliminary|uncertain\w*|cautious(?:ly)?|caution|should be interpreted|requires? confirmation|needs? confirmation|need to be confirmed|warrants? (?:confirmation|further|prospective)|confirmation in)\b/i
const CLOSING_SENTENCES = 2

export type Overstatement = "weak-design" | "association" | "held-back"

/**
 * Flag unqualified effect wording where the abstract reports an association, a weak study design,
 * or a hedged conclusion. This lexical heuristic complements the number checks; it does not
 * establish whether a summary is semantically supported by its source.
 *
 * Returns why, or null. It reads only words, so it knows nothing of a claim that is surer in another
 * way: a result given for a wider population than was studied, or a comparison that was not made.
 */
export function overstated(summary: string, sentences: string[]): Overstatement | null {
  if (!FLAT.test(summary) || SOFT.test(summary)) return null
  const abstract = sentences.join(" ")
  if (ASSOCIATION.test(abstract)) return "association"
  if (HELD_BACK.test(sentences.slice(-CLOSING_SENTENCES).join(" "))) return "held-back"
  if (WEAK_DESIGN.test(abstract)) return "weak-design"
  return null
}
