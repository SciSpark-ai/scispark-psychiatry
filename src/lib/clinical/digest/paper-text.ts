import type { PaperText } from "../../papers/text-contract"

/** Notes upstream's reader leaves when a source failed for a reason that may pass: a server error, a time-out, a failed lookup. */
const PASSING = /returned 5\d\d|lookup failed|timed? ?out/i

/**
 * Reads the paper with upstream's reader and, when the full text was not had for a passing reason,
 * once more. A paper with no open full text is not asked for twice.
 */
export async function readPaperTextPatiently(read: () => Promise<PaperText>): Promise<PaperText> {
  const first = await read()
  if (first.access === "full-text" || !first.notes.some((note) => PASSING.test(note))) return first
  const second = await read().catch(() => null)
  return second?.access === "full-text" ? second : first
}
