import Link from "next/link"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { Study, Tier } from "@/lib/clinical/evidence/build"
import { dotRadius, KIND_COLOUR, type EfficacyKind } from "./evidence-shapes"

const E = CLINICAL_COPY.evidence
const P = E.plot
const TIERS: readonly Tier[] = ["synthesis", "trial", "observational"]
const STROKE = 1.5
const directionOf = (study: Study): EfficacyKind => (study.kind === "benefit" || study.kind === "no-benefit" ? study.kind : "mixed")

/**
 * The papers of one treatment as dots: a row per tier of design, a dot per paper, coloured by what the paper found and
 * sized by its participants (hollow and small when the paper states none). Each dot is a link to its paper and says in
 * words what its colour and size say. Papers are shown one by one: nothing is pooled.
 */
export function DirectionPlot({ studies, name }: { studies: Study[]; name: string }) {
  // Every dot is worked out before any element is built.
  const rows = TIERS.map((tier) => ({
    tier,
    dots: studies.filter((study) => study.tier === tier).map((study) => {
      const direction = directionOf(study)
      const radius = dotRadius(study.sampleSize)
      return {
        key: study.key, href: `/paper/${study.slug}`, radius, box: 2 * (radius + STROKE), colour: KIND_COLOUR[direction], hollow: study.sampleSize === null,
        label: P.dot(study.label ?? study.headline, E.kindLabels[direction], study.text, study.sampleSize),
      }
    }),
  })).filter((row) => row.dots.length > 0)
  return (
    <div data-testid="direction-plot" role="group" aria-label={P.label(name)} className="mt-3 rounded-card border border-border-warm/60 px-3 py-2">
      {rows.map((row) => (
        <div key={row.tier} data-tier={row.tier} className="grid items-center gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[190px_1fr]">
          <span data-tier-label="true" className="text-[12px] text-secondary-dark">{P.tiers[row.tier]}</span>
          <div data-tier-dots="true" className="flex items-center gap-2 overflow-x-auto py-1">
            {row.dots.map((dot) => (
              <Link key={dot.key} data-dot={dot.key} href={dot.href} aria-label={dot.label} title={dot.label}
                className="block shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink">
                <svg aria-hidden="true" width={dot.box} height={dot.box} viewBox={`0 0 ${dot.box} ${dot.box}`} className="block">
                  <circle cx={dot.box / 2} cy={dot.box / 2} r={dot.radius} fill={dot.hollow ? "none" : dot.colour} stroke={dot.colour} strokeWidth={STROKE} />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      ))}
      <p data-plot-key="true" className="mt-1 text-[12px] text-muted-text">{P.key}</p>
    </div>
  )
}
