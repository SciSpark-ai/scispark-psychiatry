import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { CLINICAL_COPY } from "../copy"

// The safety statements have one source each, and every place that must show one reads it from there.

const SRC = path.resolve(__dirname, "../../..")
const source = (file: string) => readFileSync(path.join(SRC, file), "utf8")
const count = (text: string, part: string) => text.split(part).length - 1

describe("the safety statements", () => {
  it("are three short sentences in the copy file", () => {
    expect(CLINICAL_COPY.disclaimerShort).toBe("For literature awareness only — not medical advice.")
    expect(CLINICAL_COPY.aiCanBeWrong).toBe("AI summaries can be wrong.")
    expect(CLINICAL_COPY.noPatientData).toBe("Do not enter patient information.")
    expect(CLINICAL_COPY.disclaimerGrades).toContain("not whether a treatment is right for a patient")
  })

  it("are on every page: the shell draws the footer note, which reads all three keys", () => {
    expect(source("components/layout/AppShell.tsx")).toContain("<ClinicalFooterNote />")
    const note = source("components/clinical/ClinicalFooterNote.tsx")
    for (const key of ["disclaimerShort", "aiCanBeWrong", "noPatientData"]) expect(note).toContain(`CLINICAL_COPY.${key}`)
  })

  it("the home page's foot does not repeat the footer's first sentence", () => {
    const home = source("components/clinical/ClinicalHome.tsx")
    expect(home).not.toContain("CLINICAL_COPY.disclaimerShort")
    expect(home).toContain("CLINICAL_COPY.disclaimerGrades")
  })

  it("Ask shows the patient line by both of its input boxes", () => {
    expect(count(source("components/chat/ChatWorkspace.tsx"), "{CLINICAL_COPY.noPatientData}")).toBe(2)
  })

  it("the note editor shows the same line, from the same key", () => {
    expect(source("components/clinical/NotePage.tsx")).toContain("{CLINICAL_COPY.noPatientData}")
    expect(Object.keys(CLINICAL_COPY.notes.page)).not.toContain("noPatient")
  })
})
