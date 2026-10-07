// src/lib/clinical/records/effects.ts
import { isChecked, type Arm, type Outcome } from "./schema"

/**
 * Effect sizes from arm-level numbers (spec 7.7). Null whenever the numbers do not allow one; a
 * caller shows "not computable".
 *
 * Hedges g is turned so that above 0 favours the treatment. A risk ratio is not turned: it is the
 * treatment's risk over the comparator's, as a paper prints it (relapse in 10 of 100 against 20 of
 * 100 is 0.50), and only the direction reads it on the side that fits the kind of event.
 *
 * The direction rests on three things a model wrote: which result is the better one and the role of
 * the two arms. Until a person has confirmed or set them, no effect and no direction is given.
 */

export interface Effect { measure: "g" | "rr"; estimate: number; low: number; high: number }
export type Direction = "favours-treatment" | "favours-control" | "no-clear-difference" | "not-computable" | "unconfirmed"
export interface OutcomeEffect {
  effect: Effect | null; direction: Direction
  /** The ids of the two arms that were compared, or null when the outcome has no such pair. */
  compared: { treatment: string; control: string } | null
}

const Z = 1.959964
const ok = (...values: Array<number | null | undefined>): boolean => values.every((value) => typeof value === "number" && Number.isFinite(value))

/** Standardised mean difference with the small-sample correction, and its 95% interval. Above 0 favours the treatment. */
export function hedgesG(
  treatment: { n: number | null; mean: number | null; sd: number | null }, control: { n: number | null; mean: number | null; sd: number | null }, lowerIsBetter: boolean,
): Effect | null {
  const { n: n1, mean: m1, sd: s1 } = treatment
  const { n: n2, mean: m2, sd: s2 } = control
  if (!ok(n1, m1, s1, n2, m2, s2) || n1! < 2 || n2! < 2 || s1! <= 0 || s2! <= 0) return null
  const df = n1! + n2! - 2
  const pooled = Math.sqrt(((n1! - 1) * s1! ** 2 + (n2! - 1) * s2! ** 2) / df)
  const d = ((m1! - m2!) / pooled) * (lowerIsBetter ? -1 : 1)
  const j = 1 - 3 / (4 * df - 1)
  const g = d * j
  const se = j * Math.sqrt((n1! + n2!) / (n1! * n2!) + d ** 2 / (2 * (n1! + n2!)))
  return ok(g, se) ? { measure: "g", estimate: g, low: g - Z * se, high: g + Z * se } : null
}

/** Risk ratio and its 95% interval: the treatment's risk over the comparator's, whatever the event. */
export function riskRatio(treatment: { n: number | null; events: number | null }, control: { n: number | null; events: number | null }): Effect | null {
  const { n: n1, events: e1 } = treatment
  const { n: n2, events: e2 } = control
  if (!ok(n1, e1, n2, e2) || n1! <= 0 || n2! <= 0 || e1! <= 0 || e2! <= 0 || e1! > n1! || e2! > n2!) return null
  const log = Math.log(e1! / n1! / (e2! / n2!))
  const se = Math.sqrt(1 / e1! - 1 / n1! + 1 / e2! - 1 / n2!)
  return ok(log, se) ? { measure: "rr", estimate: Math.exp(log), low: Math.exp(log - Z * se), high: Math.exp(log + Z * se) } : null
}

/**
 * The effect for one outcome: a treatment arm (the first, or the one named) against the first control
 * arm that has results. The direction is read from the interval: it favours a side only when the interval
 * excludes no difference.
 */
export function outcomeEffect(outcome: Outcome, arms: Arm[], treatmentArmId?: string): OutcomeEffect {
  const armOf = (armId: string) => arms.find((arm) => arm.id === armId)
  const resultOf = (role: Arm["role"]) => outcome.results.find((result) => armOf(result.armId)?.role === role)
  const t = treatmentArmId ? outcome.results.find((result) => result.armId === treatmentArmId) : resultOf("treatment")
  const c = resultOf("control")
  if (!t || !c) return { effect: null, direction: "not-computable", compared: null }
  const compared = { treatment: t.armId, control: c.armId }
  if (!isChecked(outcome.lowerIsBetterState) || !isChecked(armOf(t.armId)?.roleState) || !isChecked(armOf(c.armId)?.roleState)) return { effect: null, direction: "unconfirmed", compared }
  const lowerIsBetter = outcome.lowerIsBetter
  if (lowerIsBetter === null) return { effect: null, direction: "not-computable", compared }
  const effect = outcome.kind === "continuous"
    ? hedgesG({ n: t.n.value, mean: t.mean.value, sd: t.sd.value }, { n: c.n.value, mean: c.mean.value, sd: c.sd.value }, lowerIsBetter)
    : riskRatio({ n: t.n.value, events: t.events.value }, { n: c.n.value, events: c.events.value })
  if (!effect) return { effect: null, direction: "not-computable", compared }
  // Hedges g is already turned. A risk ratio is not: for a bad event the treatment did better below 1.
  const none = effect.measure === "g" ? 0 : 1
  const above = effect.low > none
  const below = effect.high < none
  const turned = effect.measure === "rr" && lowerIsBetter
  const direction: Direction = (turned ? below : above) ? "favours-treatment" : (turned ? above : below) ? "favours-control" : "no-clear-difference"
  return { effect, direction, compared }
}
