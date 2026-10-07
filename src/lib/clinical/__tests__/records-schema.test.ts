import { describe, expect, it } from "vitest"
import { TrialRecordSchema, emptyField, fieldPaths, getField, withField } from "../records/schema"
import { hedgesG, outcomeEffect, riskRatio } from "../records/effects"
import { RECORD, num } from "./records-fixture"

describe("the trial record", () => {
  it("parses, and rejects a record whose result names an arm it does not have", () => {
    expect(TrialRecordSchema.parse(RECORD).arms).toHaveLength(2)
    const broken = { ...RECORD, outcomes: [{ ...RECORD.outcomes[0], results: [{ ...RECORD.outcomes[0].results[0], armId: "zz" }] }] }
    expect(TrialRecordSchema.safeParse(broken).success).toBe(false)
  })
  it("names every field by a path, reads one, and replaces one without touching the rest", () => {
    expect(fieldPaths(RECORD)).toContain("outcomes.o2.results.a1.mean")
    expect(fieldPaths(RECORD)).toContain("arms.a2.treatment")
    expect(getField(RECORD, "outcomes.o2.results.a1.mean")?.value).toBe(14.2)
    expect(getField(RECORD, "outcomes.o9.name")).toBeNull()
    const edited = withField(RECORD, "arms.a1.n", { value: 337, quote: null, state: "human-edited" })
    expect(getField(edited, "arms.a1.n")).toEqual({ value: 337, quote: null, state: "human-edited" })
    expect(getField(RECORD, "arms.a1.n")?.value).toBe(336)
    expect(getField(edited, "arms.a2.n")?.value).toBe(340)
  })
  it("has an empty field that is unknown, not zero", () => {
    expect(emptyField()).toEqual({ value: null, quote: null, state: "unverified" })
  })
})

describe("effect sizes, computed by code", () => {
  it("gives Hedges g with its interval, positive when the treatment did better on a scale where lower is better", () => {
    const effect = hedgesG({ n: 336, mean: 14.2, sd: 9.1 }, { n: 340, mean: 17.0, sd: 9.4 }, true)!
    expect(effect.measure).toBe("g")
    expect(effect.estimate).toBeCloseTo(0.302, 2)
    expect(effect.low).toBeGreaterThan(0)
    expect(effect.high).toBeGreaterThan(effect.estimate)
  })
  it("gives a risk ratio with its interval, above 1 when a good event was more frequent with the treatment", () => {
    const effect = riskRatio({ n: 336, events: 91 }, { n: 340, events: 60 }, false)!
    expect(effect.estimate).toBeCloseTo(1.535, 2)
    expect(effect.low).toBeGreaterThan(1)
  })
  it("turns a risk ratio round when the event is a bad one", () => {
    expect(riskRatio({ n: 100, events: 10 }, { n: 100, events: 20 }, true)!.estimate).toBeCloseTo(2, 5)
  })
  it("says not computable instead of a number when something is missing or impossible", () => {
    expect(hedgesG({ n: 336, mean: 14.2, sd: 0 }, { n: 340, mean: 17.0, sd: 0 }, true)).toBeNull()
    expect(hedgesG({ n: 1, mean: 14.2, sd: 9 }, { n: 1, mean: 17.0, sd: 9 }, true)).toBeNull()
    expect(riskRatio({ n: 100, events: 0 }, { n: 100, events: 0 }, false)).toBeNull()
    expect(riskRatio({ n: 100, events: 120 }, { n: 100, events: 20 }, false)).toBeNull()
    const noDirection = { ...RECORD.outcomes[1], lowerIsBetter: null }
    expect(outcomeEffect(noDirection, RECORD.arms)).toEqual({ effect: null, direction: "not-computable" })
    const oneArm = { ...RECORD.outcomes[1], results: [RECORD.outcomes[1].results[0]] }
    expect(outcomeEffect(oneArm, RECORD.arms).direction).toBe("not-computable")
  })
  it("reads the direction from the interval, not from the point estimate", () => {
    expect(outcomeEffect(RECORD.outcomes[0], RECORD.arms).direction).toBe("favours-treatment")
    expect(outcomeEffect(RECORD.outcomes[1], RECORD.arms).direction).toBe("favours-treatment")
    const close = { ...RECORD.outcomes[1], results: [{ ...RECORD.outcomes[1].results[0], mean: num(16.8) }, RECORD.outcomes[1].results[1]] }
    expect(outcomeEffect(close, RECORD.arms).direction).toBe("no-clear-difference")
    const worse = { ...RECORD.outcomes[1], results: [{ ...RECORD.outcomes[1].results[0], mean: num(20.0) }, RECORD.outcomes[1].results[1]] }
    expect(outcomeEffect(worse, RECORD.arms).direction).toBe("favours-control")
  })
})
