// Pure text check, kept apart from digest/topic.ts so that the evidence builder can use it without the model runner.

/** A whole number as a paper prints it, with or without thousands separators: "180", "1,234". */
const PRINTED_NUMBER = /\d{1,3}(?:,\d{3})+|\d+/g
/** The words that say a number counts people, singular or plural. */
const PEOPLE = new Set([
  "participant", "participants", "patient", "patients", "adult", "adults", "child", "children", "adolescent", "adolescents", "youth", "youths",
  "individual", "individuals", "people", "person", "persons", "subject", "subjects", "case", "cases", "inpatient", "inpatients", "outpatient", "outpatients",
  "caregiver", "caregivers", "veteran", "veterans", "woman", "women", "man", "men", "student", "students", "resident", "residents",
  "volunteer", "volunteers", "respondent", "respondents", "user", "users", "offspring", "twin", "twins", "birth", "births", "pregnancy", "pregnancies",
])
/** A word right after a number that says the number counts something else: time, a dose, or papers ("12 weeks in patients", "52 studies of adults"). */
const OTHER_UNIT = new Set([
  "year", "years", "month", "months", "week", "weeks", "day", "days", "hour", "hours", "minute", "minutes", "mg", "g", "kg", "ml", "hz",
  "session", "sessions", "dose", "doses", "point", "points", "item", "items", "studies", "trials", "rcts", "reviews", "articles", "papers", "publications", "reports",
  "site", "sites", "centre", "centres", "center", "centers", "country", "countries",
])
/** A word that ends the phrase the number counts: what follows it is about something else ("2021 in patients", "42 of 180 patients"). */
const PHRASE_END = new Set(["in", "of", "among", "with", "for", "from", "at", "to", "on", "by", "per", "into", "across", "between", "during", "after", "before", "versus", "vs", "than"])
const WORDS_AFTER = 3
const N_EQUALS_BEFORE = /\bn\s*=\s*$/i
/** "%" after the number, or the rest of a range that ends in one: "42%", "42 %", "42-45%", "42 to 45 %". */
const SHARE_AFTER = /^\s*(?:(?:-|–|—|to)\s*\d+(?:\.\d+)?\s*)?%/
/** The number is part of a decimal, of a longer number, or the end of a range ("18-65"). */
const DIGITS_BEFORE = /(?:\d[.,\u2013\u2014-]?|\.)$/
const DIGITS_AFTER = /^(?:[.,]\d|\d)/

/** Is this one printed number a count of people? `before` and `after` are the text around it. */
function tiedToPeople(before: string, after: string): boolean {
  if (DIGITS_BEFORE.test(before) || DIGITS_AFTER.test(after) || SHARE_AFTER.test(after)) return false
  if (N_EQUALS_BEFORE.test(before)) return true
  // "60-participant pilot" counts people; "18-year-old patients" and "12-week trial in adults" do not.
  const compound = after.match(/^-([A-Za-z]+)/)
  if (compound) return PEOPLE.has(compound[1].toLowerCase())
  // The people word must come before the next number and inside the same clause: "52 studies (2856 participants)" ties 2856, not 52.
  const clause = after.split(/[\d.;:()[\]]/)[0]
  const words = (clause.toLowerCase().match(/[a-z]+(?:[-'][a-z]+)*/g) ?? []).slice(0, WORDS_AFTER)
  if (words.length === 0 || OTHER_UNIT.has(words[0])) return false
  for (const word of words) {
    if (PHRASE_END.has(word)) return false
    if (PEOPLE.has(word)) return true
  }
  return false
}

/**
 * Does the paper's own text print `size` as a number of participants? Final review I1, I2 (2026-10-08).
 *
 * True only for a positive whole number of which some occurrence in `text` (thousands separators
 * ignored) is tied to people: straight after "n =" or "N=", or followed within three words by a
 * people word ("180 treatment-resistant patients"). Never a share ("42%", "42-45%"), a year, a
 * duration, or a count of studies. A model's number that fails this is not shown as a sample size.
 */
export function sampleSizeStated(size: number | null | undefined, text: string): boolean {
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return false
  for (const match of text.matchAll(PRINTED_NUMBER)) {
    if (Number(match[0].replace(/,/g, "")) !== size) continue
    const at = match.index
    if (tiedToPeople(text.slice(Math.max(0, at - 12), at), text.slice(at + match[0].length, at + match[0].length + 120))) return true
  }
  return false
}
