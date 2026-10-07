import { describe, expect, it } from "vitest"
import { PATHS, TrialRecordSchema, emptyField, fieldPaths, getCode, getField, pathsToCheck, shownFieldPaths, withCode, withField } from "../records/schema"
import { hedgesG, outcomeEffect, riskRatio } from "../records/effects"
import { RECORD, num, unconfirmed } from "./records-fixture"

const without = (value: object, ...keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))

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
  it("parses a record stored before the check states and the paper were kept, as unchecked", () => {
    const old = {
      ...RECORD,
      arms: RECORD.arms.map((arm) => without(arm, "roleState")),
      outcomes: RECORD.outcomes.map((outcome) => without(outcome, "lowerIsBetterState", "primaryState")),
    }
    const parsed = TrialRecordSchema.parse(JSON.parse(JSON.stringify(old)))
    expect(parsed.arms.map((arm) => arm.roleState)).toEqual(["unverified", "unverified"])
    expect(parsed.outcomes.map((outcome) => [outcome.lowerIsBetterState, outcome.primaryState])).toEqual([["unverified", "unverified"], ["unverified", "unverified"]])
    expect(parsed.paper).toBeUndefined()
    // A stored paper that is not a paper does not make the record unreadable.
    expect(TrialRecordSchema.parse({ ...old, paper: { hello: 1 } }).paper).toBeUndefined()
    const paper = { ids: { pmid: "111" }, title: "Esketamine versus quetiapine", authors: [], fields: [], source: "pubmed", abstract: "Kept." }
    expect(TrialRecordSchema.parse({ ...old, paper }).paper).toEqual(paper)
  })
  it("has the direction of benefit, the primary mark and the role of an arm as fields with a state and no quote", () => {
    expect(PATHS.benefit("o1")).toBe("outcomes.o1.lowerIsBetter")
    expect(PATHS.primary("o1")).toBe("outcomes.o1.primary")
    expect(PATHS.role("a1")).toBe("arms.a1.role")
    for (const path of ["outcomes.o1.lowerIsBetter", "outcomes.o2.primary", "arms.a2.role"]) expect(fieldPaths(RECORD)).toContain(path)
    const fresh = unconfirmed(RECORD)
    expect(getField(fresh, "outcomes.o2.lowerIsBetter")).toEqual({ value: true, quote: null, state: "unverified" })
    expect(getField(fresh, "outcomes.o1.primary")).toEqual({ value: true, quote: null, state: "unverified" })
    expect(getField(fresh, "arms.a2.role")).toEqual({ value: "control", quote: null, state: "unverified" })
    const set = withField(fresh, "outcomes.o2.lowerIsBetter", { value: false, quote: null, state: "human-edited" })
    expect(set.outcomes[1]).toMatchObject({ lowerIsBetter: false, lowerIsBetterState: "human-edited" })
    expect(set.outcomes[0]).toEqual(fresh.outcomes[0])
    const role = withField(fresh, "arms.a2.role", { value: "treatment", quote: null, state: "human-edited" })
    expect(role.arms[1]).toMatchObject({ role: "treatment", roleState: "human-edited" })
  })
  it("un-marks the other outcomes when one is marked primary", () => {
    const moved = withField(unconfirmed(RECORD), "outcomes.o2.primary", { value: true, quote: null, state: "human-edited" })
    expect(moved.outcomes.map((outcome) => [outcome.primary, outcome.primaryState])).toEqual([[false, "human-edited"], [true, "human-edited"]])
  })
  it("counts as values to check only what the panel shows, and the three choices among them", () => {
    const shown = shownFieldPaths(RECORD)
    // A binary outcome shows events; a continuous one shows a mean and an SD.
    expect(shown).toContain("outcomes.o1.results.a1.events")
    expect(shown).not.toContain("outcomes.o1.results.a1.mean")
    expect(shown).not.toContain("outcomes.o1.results.a1.sd")
    expect(shown).toContain("outcomes.o2.results.a1.sd")
    expect(shown).not.toContain("outcomes.o2.results.a1.events")
    // A value in a field that is not shown is not something the reader can check.
    const hidden = withField(RECORD, "outcomes.o1.results.a1.mean", num(3.1))
    expect(pathsToCheck(hidden)).toEqual(pathsToCheck(RECORD))
    const before = pathsToCheck(RECORD).length
    const fresh = pathsToCheck(unconfirmed(RECORD))
    expect(fresh.length).toBe(before + 6)
    for (const path of ["arms.a1.role", "outcomes.o1.primary", "outcomes.o2.lowerIsBetter"]) expect(fresh).toContain(path)
    // "Not clear from the paper" is an answer too: it stays to be checked until a person confirms or sets it.
    const unclear = withField(unconfirmed(RECORD), "outcomes.o2.lowerIsBetter", { value: null, quote: null, state: "unverified" })
    expect(pathsToCheck(unclear)).toContain("outcomes.o2.lowerIsBetter")
  })
  it("reads and replaces what the record is filed under", () => {
    expect(getCode(RECORD, PATHS.conditionCode)).toBe("treatment-resistant-depression")
    expect(getCode(RECORD, PATHS.treatmentCode("a1"))).toBe("esketamine")
    expect(getCode(RECORD, "arms.a1.n")).toBeUndefined()
    expect(getCode(RECORD, "arms.zz.treatmentCode")).toBeUndefined()
    expect(withCode(RECORD, PATHS.treatmentCode("a1"), null).arms[0].treatmentCode).toBeNull()
    expect(withCode(RECORD, PATHS.conditionCode, "depression").conditionCode).toBe("depression")
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
    const effect = riskRatio({ n: 336, events: 91 }, { n: 340, events: 60 })!
    expect(effect.estimate).toBeCloseTo(1.535, 2)
    expect(effect.low).toBeGreaterThan(1)
  })
  it("prints the risk ratio as a paper would, treatment over comparator, also when the event is a bad one", () => {
    const relapse = riskRatio({ n: 100, events: 10 }, { n: 100, events: 20 })!
    expect(relapse.estimate).toBeCloseTo(0.5, 5)
    expect(relapse.low).toBeLessThan(0.5)
    expect(relapse.high).toBeGreaterThan(0.5)
  })
  it("reads the direction of a risk ratio on the side that fits the kind of event", () => {
    const binary = (lowerIsBetter: boolean, treated: number, control: number) => ({ ...RECORD.outcomes[0], lowerIsBetter, results: [{ ...RECORD.outcomes[0].results[0], n: num(200), events: num(treated) }, { ...RECORD.outcomes[0].results[1], n: num(200), events: num(control) }] })
    // Relapse, a bad event: fewer with the treatment favours the treatment, and the ratio stays below 1.
    const fewerRelapses = outcomeEffect(binary(true, 20, 60), RECORD.arms)
    expect(fewerRelapses.effect!.estimate).toBeCloseTo(1 / 3, 5)
    expect(fewerRelapses.direction).toBe("favours-treatment")
    expect(outcomeEffect(binary(true, 60, 20), RECORD.arms).direction).toBe("favours-control")
    // Remission, a good event: fewer with the treatment favours the comparator.
    const fewerRemissions = outcomeEffect(binary(false, 20, 60), RECORD.arms)
    expect(fewerRemissions.effect!.estimate).toBeCloseTo(1 / 3, 5)
    expect(fewerRemissions.direction).toBe("favours-control")
    expect(outcomeEffect(binary(false, 58, 60), RECORD.arms).direction).toBe("no-clear-difference")
  })
  it("compares the treatment arm that is named, and says which two arms it compared", () => {
    const third = { ...RECORD.arms[0], id: "a3", treatment: { value: "ketamine", quote: "ketamine", state: "quote-verified" as const }, treatmentCode: null }
    const arms = [RECORD.arms[0], RECORD.arms[1], third]
    const outcome = { ...RECORD.outcomes[1], results: [...RECORD.outcomes[1].results, { ...RECORD.outcomes[1].results[0], armId: "a3", mean: num(20.0) }] }
    expect(outcomeEffect(outcome, arms)).toMatchObject({ direction: "favours-treatment", compared: { treatment: "a1", control: "a2" } })
    expect(outcomeEffect(outcome, arms, "a3")).toMatchObject({ direction: "favours-control", compared: { treatment: "a3", control: "a2" } })
    expect(outcomeEffect(outcome, arms, "zz")).toEqual({ effect: null, direction: "not-computable", compared: null })
  })
  it("says not computable instead of a number when something is missing or impossible", () => {
    expect(hedgesG({ n: 336, mean: 14.2, sd: 0 }, { n: 340, mean: 17.0, sd: 0 }, true)).toBeNull()
    expect(hedgesG({ n: 1, mean: 14.2, sd: 9 }, { n: 1, mean: 17.0, sd: 9 }, true)).toBeNull()
    expect(riskRatio({ n: 100, events: 0 }, { n: 100, events: 0 })).toBeNull()
    expect(riskRatio({ n: 100, events: 120 }, { n: 100, events: 20 })).toBeNull()
    const noDirection = { ...RECORD.outcomes[1], lowerIsBetter: null }
    expect(outcomeEffect(noDirection, RECORD.arms)).toEqual({ effect: null, direction: "not-computable", compared: { treatment: "a1", control: "a2" } })
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

describe("no direction until a person has confirmed what it rests on", () => {
  // Mean reductions from baseline: a larger number is the better result. The model said the opposite.
  const reductions = { ...RECORD.outcomes[1], lowerIsBetter: true, lowerIsBetterState: "unverified" as const,
    results: [{ ...RECORD.outcomes[1].results[0], mean: num(12.0), sd: num(8.0) }, { ...RECORD.outcomes[1].results[1], mean: num(8.0), sd: num(8.0) }] }
  it("claims nothing for an outcome whose direction of benefit was written by the model and not checked", () => {
    expect(outcomeEffect(reductions, RECORD.arms)).toEqual({ effect: null, direction: "unconfirmed", compared: { treatment: "a1", control: "a2" } })
    // Confirming every number changes nothing: the numbers were never what was wrong.
    expect(outcomeEffect(unconfirmed(RECORD).outcomes[0], RECORD.arms).direction).toBe("unconfirmed")
  })
  it("would have favoured the comparator had the model's direction been taken, and favours the treatment once the reader sets it", () => {
    expect(outcomeEffect({ ...reductions, lowerIsBetterState: "human-confirmed" }, RECORD.arms).direction).toBe("favours-control")
    const record = withField({ ...RECORD, outcomes: [RECORD.outcomes[0], reductions] }, "outcomes.o2.lowerIsBetter", { value: false, quote: null, state: "human-edited" })
    const set = outcomeEffect(record.outcomes[1], record.arms)
    expect(set.direction).toBe("favours-treatment")
    expect(set.effect!.estimate).toBeGreaterThan(0)
  })
  it("claims nothing while the role of either compared arm is unconfirmed", () => {
    const arms = (first: "unverified" | "human-confirmed", second: "unverified" | "human-confirmed" | "human-edited") => [{ ...RECORD.arms[0], roleState: first }, { ...RECORD.arms[1], roleState: second }]
    expect(outcomeEffect(RECORD.outcomes[0], arms("unverified", "human-confirmed")).direction).toBe("unconfirmed")
    expect(outcomeEffect(RECORD.outcomes[0], arms("human-confirmed", "unverified")).direction).toBe("unconfirmed")
    expect(outcomeEffect(RECORD.outcomes[0], arms("human-confirmed", "human-edited")).direction).toBe("favours-treatment")
  })
  it("says not computable, not unconfirmed, once a person has said the paper does not make the direction clear", () => {
    expect(outcomeEffect({ ...reductions, lowerIsBetter: null, lowerIsBetterState: "human-edited" }, RECORD.arms).direction).toBe("not-computable")
    expect(outcomeEffect({ ...reductions, lowerIsBetter: null }, RECORD.arms).direction).toBe("unconfirmed")
  })
})
