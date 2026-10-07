// Pure text helper, kept apart from digest/topic.ts so that a page can use it without bundling the model runner.

/**
 * An overview sentence as plain prose. The sources are shown beside the sentence as links, so every
 * marker the model wrote into the text is taken out: "(1)", "[2, 3]", "（1）", "(papers 1 and 2)",
 * superscript digits. A bracket that holds a result, such as "(HR, 2.42)", is left alone. Spacing is
 * tidied and the sentence ends with a full stop. Also applied when a stored overview is shown.
 */
export function tidyOverviewSentence(text: string): string {
  const numberList = String.raw`\d{1,2}(?:\s*(?:[,;&-]|\band\b|\bto\b)\s*\d{1,2})*`
  const tidy = text
    .replace(new RegExp(String.raw`\s*[(\[（【]\s*(?:(?:papers?|stud(?:y|ies)|refs?|sources?)\s*)?${numberList}\s*[)\]）】]`, "gi"), "")
    .replace(/\s*[\u00b9\u00b2\u00b3\u2070-\u2079]+/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/([.,;:])\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
  if (!tidy) return ""
  return /[.!?]$/.test(tidy) ? tidy : `${tidy}.`
}

/**
 * The words that say in so many words that something did not work. A finding is filed under "no
 * benefit" or "mixed" only if it has one, and the page marks them there.
 */
export const negationWords = () => /\b(?:not|no|nor|neither|without|failed|fails|lacked|lack)\b/gi
