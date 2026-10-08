import type { Period, Scope } from "./build"

// The address of the Evidence view. Pure text; a page can use it.

export type EvidenceTab = "summary" | "notes"
export const PERIODS: readonly Period[] = ["all", "12m", "6m", "3m"]
export const SCOPES: readonly Scope[] = ["all", "saved"]

/** `/wiki` on one condition. What is the default (everything listed, all time, the summary) is left out. */
export function evidenceHref(state: { condition: string; scope?: Scope; period?: Period; tab?: EvidenceTab }): string {
  const query = new URLSearchParams({ condition: state.condition })
  if (state.scope && state.scope !== "all") query.set("scope", state.scope)
  if (state.period && state.period !== "all") query.set("period", state.period)
  if (state.tab === "notes") query.set("tab", state.tab)
  return `/wiki?${query.toString()}`
}
