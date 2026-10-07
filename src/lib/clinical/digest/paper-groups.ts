import type { PaperDigestItem } from "./paper"

// How the digest is laid out on the paper page. Types only from ./paper, so a page can use this file.

/** The items in three groups, in reading order. */
export const DIGEST_GROUPS: ReadonlyArray<{ id: "study" | "results" | "appraisal"; items: readonly PaperDigestItem[] }> = [
  { id: "study", items: ["question", "design", "population", "intervention", "primaryOutcome"] },
  { id: "results", items: ["mainResult", "secondaryOutcomes", "safety"] },
  { id: "appraisal", items: ["limitations", "conclusion", "funding"] },
]

/** The item set apart on the page. */
export const MAIN_ITEM: PaperDigestItem = "mainResult"

/** Items an abstract rarely gives; a digest written from the abstract does not report them as missing. */
export const FULL_TEXT_ITEMS: readonly PaperDigestItem[] = ["primaryOutcome", "secondaryOutcomes"]
