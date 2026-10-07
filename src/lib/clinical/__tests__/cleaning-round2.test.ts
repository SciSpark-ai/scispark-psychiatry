import { describe, expect, it } from "vitest"
import { loadPsychiatryPack } from "../pack/load"
import { abstractSections } from "../text/abstract-sections"
import { displayVenue } from "../text/venue"
import { journalTierOf } from "../score/journal-tiers"

// Owner report 2026-10-07: sections such as "Background" in ordinary capitals were not recognised, and
// journal names were shown the way PubMed prints them ("The lancet. Psychiatry").

describe("abstract sections in ordinary capitals", () => {
  it("recognises the usual section words however they are capitalised", () => {
    expect(abstractSections("Background: Fitness is reduced.\nMethods: We tested 40 adults.\nResults: Scores rose.\nConclusions: The test is valid.")).toEqual([
      { label: "Background", text: "Fitness is reduced." },
      { label: "Methods", text: "We tested 40 adults." },
      { label: "Results", text: "Scores rose." },
      { label: "Conclusions", text: "The test is valid." },
    ])
    expect(abstractSections("Background/Objectives: This study evaluated esketamine.\nMethods: A cohort.")[0]).toEqual({ label: "Background/objectives", text: "This study evaluated esketamine." })
    expect(abstractSections("Objective: To evaluate an app.")[0]).toEqual({ label: "Objective", text: "To evaluate an app." })
  })
  it("finds sections that follow one another on a single line", () => {
    expect(abstractSections("Background: Fitness is reduced. Methods: We tested 40 adults. Results: Scores rose. Conclusion: The test is valid.").map((section) => section.label)).toEqual(["Background", "Methods", "Results", "Conclusion"])
  })
  it("still does not take an ordinary sentence for a section", () => {
    expect(abstractSections("We found three things: a, b and c. Results were mixed.")).toEqual([{ text: "We found three things: a, b and c. Results were mixed." }])
    expect(abstractSections("Note: this was a pilot.")).toEqual([{ text: "Note: this was a pilot." }])
  })
})

describe("displayVenue", () => {
  it("uses the pack's name for a journal the pack knows", async () => {
    const { journals } = await loadPsychiatryPack()
    expect(displayVenue("The lancet. Psychiatry", journals)).toBe("The Lancet Psychiatry")
    expect(displayVenue("The British journal of psychiatry : the journal of mental science", journals)).toBe("The British Journal of Psychiatry")
    expect(displayVenue("BMJ (Clinical research ed.)", journals)).toBe("BMJ")
    expect(displayVenue("BMC psychiatry", journals)).toBe("BMC Psychiatry")
  })
  it("tidies the name of a journal the pack does not know", async () => {
    const { journals } = await loadPsychiatryPack()
    expect(displayVenue("Journal of investigative surgery : the official journal of the Academy of Surgical Research", journals)).toBe("Journal of Investigative Surgery")
    expect(displayVenue("NeuroImage. Clinical", journals)).toBe("NeuroImage: Clinical")
    expect(displayVenue("Psychotherapy (Chicago, Ill.)", journals)).toBe("Psychotherapy")
    expect(displayVenue("Canadian journal of psychiatry. Revue canadienne de psychiatrie", journals)).toBe("The Canadian Journal of Psychiatry")
    expect(displayVenue("Archives of women's mental health", journals)).toBe("Archives of Women's Mental Health")
    expect(displayVenue("JAMA network open", journals)).toBe("JAMA Network Open")
    expect(displayVenue("Brain, behavior, & immunity - health", journals)).toBe("Brain, Behavior, & Immunity - Health")
    expect(displayVenue(undefined, journals)).toBeUndefined()
  })
  // Seen on the run of 2026-10-07: this journal is in the pack, written with "and", and was not recognised.
  it("knows a journal whether its name is written with & or with and", async () => {
    const { journals } = await loadPsychiatryPack()
    expect(displayVenue("Progress in neuro-psychopharmacology & biological psychiatry", journals)).toBe("Progress in Neuro-Psychopharmacology and Biological Psychiatry")
    expect(journalTierOf(journals, new Map(), "Progress in neuro-psychopharmacology & biological psychiatry")).toBe(2)
    expect(journalTierOf(journals, new Map(), "The Australian and New Zealand journal of psychiatry")).toBe(2)
  })
})

