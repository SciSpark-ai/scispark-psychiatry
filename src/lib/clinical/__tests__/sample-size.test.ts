// src/lib/clinical/__tests__/sample-size.test.ts
import { describe, expect, it } from "vitest"
import { sampleSizeStated } from "../text/sample-size"

// Final review I1, I2: the sample size is a count of participants, and a printed number is one only where the paper ties it to people.
describe("a sample size the paper ties to people", () => {
  it("is kept after n = and before a people word within three words", () => {
    expect(sampleSizeStated(42, "Sample: n = 42.")).toBe(true)
    expect(sampleSizeStated(42, "The cohort (N=42) was followed.")).toBe(true)
    expect(sampleSizeStated(1234, "Data from 1,234 adults.")).toBe(true)
    expect(sampleSizeStated(1234, "(n = 1,234)")).toBe(true)
    expect(sampleSizeStated(180, "We enrolled 180 treatment-resistant patients.")).toBe(true)
    expect(sampleSizeStated(180, "In 180 older depressed adult inpatients")).toBe(true)
    expect(sampleSizeStated(1, "A report of 1 patient.")).toBe(true)
    expect(sampleSizeStated(96, "96 children and 40 parents")).toBe(true)
    expect(sampleSizeStated(60, "a 60-participant pilot")).toBe(true)
    expect(sampleSizeStated(180, "Response in 42 of 180 patients.")).toBe(true)
    expect(sampleSizeStated(120, "120 older female patients")).toBe(true)
    // The fourth word is too far.
    expect(sampleSizeStated(120, "120 mostly older and female patients")).toBe(false)
  })
  it("is dropped for a year, a duration, an age, a share and a range of shares", () => {
    expect(sampleSizeStated(2019, "Recruited between 2019 and 2021 in patients with depression.")).toBe(false)
    expect(sampleSizeStated(12, "Followed for 12 weeks.")).toBe(false)
    expect(sampleSizeStated(12, "After 12 weeks in patients with depression.")).toBe(false)
    expect(sampleSizeStated(2021, "Recruited between 2019 and 2021 in patients with depression.")).toBe(false)
    expect(sampleSizeStated(42, "Response in 42 of 180 patients.")).toBe(false)
    expect(sampleSizeStated(65, "Aged 18-65 patients were eligible.")).toBe(false)
    expect(sampleSizeStated(18, "Adults aged 18 or older.")).toBe(false)
    expect(sampleSizeStated(18, "In 18-year-old patients.")).toBe(false)
    expect(sampleSizeStated(42, "Response was 42-45% across arms.")).toBe(false)
    expect(sampleSizeStated(45, "Response was 42-45% across arms.")).toBe(false)
    expect(sampleSizeStated(42, "Response was 42 to 45 % of patients.")).toBe(false)
    expect(sampleSizeStated(42, "Remission in 42% of patients.")).toBe(false)
    expect(sampleSizeStated(4, "Mean of 4.5 patients per site.")).toBe(false)
    expect(sampleSizeStated(5, "Mean of 4.5 patients per site.")).toBe(false)
  })
  it("is dropped for a count of studies and kept for the participants in them", () => {
    const review = "We pooled 52 studies (2856 participants)."
    expect(sampleSizeStated(52, review)).toBe(false)
    expect(sampleSizeStated(2856, review)).toBe(true)
    expect(sampleSizeStated(52, "We pooled 52 trials of depressed patients.")).toBe(false)
  })
  it("is kept when any one occurrence is tied to people, and never for a number that is not printed, not whole or not positive", () => {
    expect(sampleSizeStated(42, "Remission was 42% and 42 patients dropped out.")).toBe(true)
    expect(sampleSizeStated(180, "We enrolled 200 participants.")).toBe(false)
    expect(sampleSizeStated(34, "Data from 1,234 adults.")).toBe(false)
    expect(sampleSizeStated(0, "0 patients")).toBe(false)
    expect(sampleSizeStated(-5, "5 patients")).toBe(false)
    expect(sampleSizeStated(4.5, "4.5 patients")).toBe(false)
  })
})
