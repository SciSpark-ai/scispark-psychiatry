"use client"

import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { DIGEST_GROUPS, FULL_TEXT_ITEMS, MAIN_ITEM } from "@/lib/clinical/digest/paper-groups"
import type { StoredPaperDigest } from "@/lib/clinical/digest/paper"
import { Button } from "@/components/ui/Button"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import type { PaperDigestState } from "./usePaperDigest"

export { DIGEST_GROUPS }

const D = CLINICAL_COPY.paper.digest

/** The digest button of the paper page's top row: write one, update it once the full text can be read, or nothing left to do. */
export function ClinicalDigestButton({ state }: { state: PaperDigestState }) {
  const done = state.digest?.source.access === "full-text"
  return (
    <Button onClick={state.write} disabled={state.busy || done} title={done ? undefined : D.writeNote}>
      {state.busy ? D.writing : done ? D.written : state.digest ? D.update : D.write}
    </Button>
  )
}

/**
 * The digest as a card: the study, its results, its appraisal. The main result is set apart; items
 * the paper does not state are named on one line at the end instead of taking a row each.
 */
export function ClinicalPaperDigest({ state }: { state: PaperDigestState }) {
  const { digest, error } = state
  const alert = error ? <div role="alert" className="mb-6"><LlmErrorMessage message={error} /></div> : null
  if (!digest) return alert
  const fromFullText = digest.source.access === "full-text"
  const missing = DIGEST_GROUPS.flatMap((group) => group.items).filter((item) => !digest.items[item] && (fromFullText || !FULL_TEXT_ITEMS.includes(item)))
  return (
    <>
      {alert}
      <section id="paper-digest" data-testid="paper-digest" aria-labelledby="clinical-digest-title" tabIndex={-1} className="mb-10 scroll-mt-6 rounded-card border border-border-warm/70 bg-light-surface px-6 py-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="clinical-digest-title" className="font-heading text-[20px] font-semibold text-espresso">{D.heading}</h2>
          <span className="text-[12px] text-muted-text">{fromFullText ? (digest.source.truncated ? D.fromExcerpt : D.fromFullText) : D.fromAbstract}</span>
        </div>
        {DIGEST_GROUPS.map((group) => ({ group, items: group.items.filter((item) => digest.items[item]) })).filter((entry) => entry.items.length > 0).map(({ group, items }) => (
          <div key={group.id} id={`digest-${group.id}`} data-digest-group={group.id} tabIndex={-1} className="mt-5 scroll-mt-6 border-t border-border-warm/60 pt-4 first:mt-0 first:border-t-0 first:pt-0">
            <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-accent-ink">{D.groups[group.id]}</h3>
            <dl className="space-y-2.5">
              {items.map((item) => {
                const main = item === MAIN_ITEM
                return (
                  <div key={item} data-digest-item={item} {...(main ? { "data-main": "true" } : {})} className={main ? "rounded-[10px] bg-card-surface/70 px-3.5 py-3" : "grid gap-x-4 gap-y-0.5 sm:grid-cols-[170px_1fr]"}>
                    <dt className={`text-[13px] font-semibold text-secondary-dark ${main ? "mb-1" : "pt-0.5"}`}>{D.labels[item]}</dt>
                    <div>
                      <dd className={main ? "text-[16px] font-medium leading-relaxed text-espresso" : "text-[15px] leading-relaxed text-espresso"}>{digest.items[item]}</dd>
                      {digest.unverified.includes(item) && <p className="mt-0.5 text-[12px] text-accent-ink">{D.unverified}</p>}
                      {!digest.quotes?.[item] && <p className="mt-1 text-[12px] text-muted-text">{D.noSourceSentence}</p>}
                      {digest.quotes?.[item] && (
                        <details className="mt-1 text-[13px] text-muted-text">
                          <summary className="cursor-pointer select-none text-[12px] hover:text-accent-ink">{D.sourceSentence}</summary>
                          <blockquote className="mt-1 border-l-2 border-border-warm pl-3 italic leading-relaxed text-secondary-dark">{digest.quotes?.[item]}</blockquote>
                        </details>
                      )}
                    </div>
                  </div>
                )
              })}
            </dl>
          </div>
        ))}
        {missing.length > 0 && <p data-testid="digest-not-stated" className="mt-4 text-[13px] text-muted-text">{D.notStated(fromFullText, missing.map((item) => D.labels[item]))}</p>}
      </section>
    </>
  )
}

/** The side navigation of the paper page: its parts in the order they are on the page. */
export function ClinicalPaperNav({ hasSummary, digest, hasAbstract }: { hasSummary: boolean; digest: StoredPaperDigest | null; hasAbstract: boolean }) {
  const links = [
    ...(hasSummary ? [{ href: "#paper-summary", label: D.nav.summary, sub: false }] : []),
    ...(digest ? [
      { href: "#paper-digest", label: D.nav.digest, sub: false },
      ...DIGEST_GROUPS.filter((group) => group.items.some((item) => digest.items[item])).map((group) => ({ href: `#digest-${group.id}`, label: D.groups[group.id], sub: true })),
    ] : []),
    ...(hasAbstract ? [{ href: "#paper-abstract", label: D.nav.abstract, sub: false }] : []),
  ]
  if (links.length === 0) return null
  return (
    <nav aria-label={D.nav.label}>
      <p className="mb-2 text-[13px] font-medium text-espresso">{D.nav.label}</p>
      {links.map((link) => (
        <a key={link.href} href={link.href} className={`block py-1.5 text-[14px] leading-snug text-muted-text no-underline hover:text-accent-ink ${link.sub ? "pl-3" : ""}`}>{link.label}</a>
      ))}
    </nav>
  )
}
