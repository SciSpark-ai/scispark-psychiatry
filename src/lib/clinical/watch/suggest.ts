/**
 * Help with typing a topic on the My topics page: names to offer while typing, and a check of what
 * was typed against the names the pack knows. Plain string work, no model: it is instant and free,
 * and it never changes what the user typed without asking.
 */

const fold = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ")

/** Names to offer: those that start with what was typed, then those that contain it. The exact name is left out. */
export function suggestTerms(names: string[], typed: string, limit = 6): string[] {
  const wanted = fold(typed)
  if (!wanted) return []
  const others = names.filter((name) => fold(name) !== wanted)
  const starts = others.filter((name) => fold(name).startsWith(wanted))
  const contains = others.filter((name) => !fold(name).startsWith(wanted) && fold(name).includes(wanted))
  return [...starts, ...contains].slice(0, limit)
}

/** Edit distance: single-letter insertions, deletions and substitutions. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]
}

export type TermCheck =
  | { status: "known"; name: string }
  | { status: "close"; suggestion: string }
  | { status: "new" }

/**
 * `known` when the pack has this name (or another name for it); `close` when it is one or two
 * letters away from a known name, which is most likely a typing slip; `new` otherwise. A new term
 * is allowed: it is searched as typed.
 */
export function checkTerm(names: string[], aliases: string[], typed: string): TermCheck {
  const wanted = fold(typed)
  const known = [...names, ...aliases].find((name) => fold(name) === wanted)
  if (known) return { status: "known", name: known }
  // Short words are too easily "close" to something else (ADD is not a misspelt ADHD).
  if (wanted.length < 5) return { status: "new" }
  let best: { name: string; distance: number } | null = null
  for (const name of names) {
    const d = distance(wanted, fold(name))
    if (!best || d < best.distance) best = { name, distance: d }
  }
  return best && best.distance <= 2 && best.distance <= wanted.length / 4 ? { status: "close", suggestion: best.name } : { status: "new" }
}
