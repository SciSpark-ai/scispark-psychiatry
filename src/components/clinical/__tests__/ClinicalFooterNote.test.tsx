// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { ClinicalFooterNote } from "../ClinicalFooterNote"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("ClinicalFooterNote", () => {
  it("says, in one line made of the copy file's keys, what the app is not and what not to type", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ClinicalFooterNote />))
      const note = container.querySelector("[data-testid=clinical-footer-note]")!
      expect(note.textContent).toBe("For literature awareness only — not medical advice. AI summaries can be wrong. Do not enter patient information.")
      expect(note.textContent).toBe([CLINICAL_COPY.disclaimerShort, CLINICAL_COPY.aiCanBeWrong, CLINICAL_COPY.noPatientData].join(" "))
      // A footer of the page, not an alert: it must not interrupt a screen reader on every navigation.
      expect(note.closest("footer")).not.toBeNull()
      expect(note.getAttribute("role")).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
