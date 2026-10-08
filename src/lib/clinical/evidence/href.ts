import type { Period, Scope } from "./build"

// The address of the Evidence view. Pure text; a page can use it.

export const PERIODS: readonly Period[] = ["all", "12m", "6m", "3m"]
export const SCOPES: readonly Scope[] = ["all", "saved"]

/**
 * `/wiki` on one condition, or on one treatment of it (`treatment` is the pack's id of the treatment). What is the
 * default (everything listed, all time) is left out.
 */
export function evidenceHref(state: { condition: string; treatment?: string; scope?: Scope; period?: Period }): string {
  const query = new URLSearchParams({ condition: state.condition })
  if (state.treatment) query.set("treatment", state.treatment)
  if (state.scope && state.scope !== "all") query.set("scope", state.scope)
  if (state.period && state.period !== "all") query.set("period", state.period)
  return `/wiki?${query.toString()}`
}
