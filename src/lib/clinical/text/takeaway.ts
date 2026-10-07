/**
 * The authors' own conclusion, taken from the abstract for the feed card. Nothing is generated: it is
 * the labelled conclusion section when the abstract has one, otherwise its last sentence.
 */

const CONCLUSION_LABEL =
  /^(?:authors'? ?conclusions?|(?:discussion and )?conclusions?(?: and [a-z ]+)?|interpretation|implications(?: for [a-z ]+)?)\s*:\s*/i
/** Lines after the conclusion that are not part of the paper's message. */
const TRAILER_LABEL = /^(?:funding|registration|registry|trial registration|clinical ?trials?[a-z. ]*|prospero[a-z ]*|copyright|keywords?)\s*:/i
const ANY_LABEL = /^[A-Z][A-Za-z' /&-]{2,40}:\s*/

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((sentence) => sentence.trim()).filter(Boolean)

export function conclusionOf(abstract: string | undefined): string | undefined {
  const lines = (abstract ?? "").split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return undefined
  const labelled = lines.findLast((line) => CONCLUSION_LABEL.test(line))
  if (labelled) {
    const text = sentences(labelled.replace(CONCLUSION_LABEL, "")).slice(0, 2).join(" ")
    if (text) return text
  }
  const body = lines.filter((line) => !TRAILER_LABEL.test(line))
  const last = body.at(-1)?.replace(ANY_LABEL, "")
  return last ? sentences(last).at(-1) : undefined
}
