/**
 * Shared by every check that asks "is this quote in the paper's text?" (stage-A grades, card digests).
 * `squash` removes the differences a model introduces when it copies text: case, spacing, and the
 * kind of dash or quote mark. `quoteCore` also removes the model's framing around the passage:
 * surrounding quote marks and closing punctuation (a cleaned title, for one, has no final full stop).
 */
export const squash = (text: string) => text.toLowerCase()
  .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―−]/g, "-")
  .replace(/[\s ]+/g, " ").trim()

export const quoteCore = (quote: string) =>
  squash(quote).replace(/^["']+|["']+$/g, "").replace(/(?:\.\.\.|…)$/, "").replace(/[.,;:!?]+$/, "").trim()

export const MIN_QUOTE_LENGTH = 8

/** True when the quote, once normalised, is at least 8 characters and appears in the text. */
export function quoteInText(quote: string, text: string): boolean {
  const wanted = quoteCore(quote)
  return wanted.length >= MIN_QUOTE_LENGTH && squash(text).includes(wanted)
}
