// src/lib/clinical/evidence/keys.ts
// The keys of the rows that stand for no single treatment. Pure constants: the builder and the page both read them.

/** The row of findings that name no treatment, or name something the pack does not know and claim no effect of it. */
export const NO_TREATMENT_ROW = "none"
/** The one row that holds every treatment the pack does not know and only one paper is on. */
export const FOLDED_ROW = "folded"
/** The timeline's series of everything that has no line of its own. */
export const OTHER_SERIES = "other"
