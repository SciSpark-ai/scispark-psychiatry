import { abstractSections } from "@/lib/clinical/text/abstract-sections"

/** The abstract on the paper page: each section on its own, its label in bold as ordinary words. */
export function ClinicalAbstract({ text }: { text: string | undefined }) {
  const sections = abstractSections(text)
  if (sections.length === 0) return null
  return (
    <div className="mt-4 max-w-[720px] space-y-4 text-[16px] leading-[1.7] text-espresso">
      {sections.map((section, index) => (
        <p key={index} data-section="true">
          {section.label && <strong className="font-semibold">{section.label}</strong>}
          {section.label && <br />}
          {section.text}
        </p>
      ))}
    </div>
  )
}
