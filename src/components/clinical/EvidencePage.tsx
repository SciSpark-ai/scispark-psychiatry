"use client"

import { useCallback, useEffect, useId, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { ConditionEvidence as Evidence, Period, Scope } from "@/lib/clinical/evidence/build"
import { listFollowedConditionsRemote, loadConditionEvidenceRemote } from "@/lib/clinical/evidence/client"
import { evidenceHref, PERIODS, SCOPES } from "@/lib/clinical/evidence/href"
import { AddCondition } from "./AddCondition"
import { ConditionEvidence } from "./ConditionEvidence"

const E = CLINICAL_COPY.evidence
const V = E.page
/** A select is a pill, as the app's other pill buttons are. */
const SELECT = "rounded-pill border border-border-warm bg-light-surface px-3 py-1.5 text-[14px] text-espresso transition-colors hover:bg-card-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
/** A tab that is not chosen is muted; the chosen one is semibold over a line of the accent, 2 px thick. */
const TAB = `border-b-2 border-transparent px-3 py-2 text-[15px] leading-5 text-muted-text transition-colors hover:text-espresso ${FOCUS}`
const TAB_ON = `border-b-2 border-accent-ink px-3 py-2 text-[15px] font-semibold leading-5 text-espresso ${FOCUS}`

/** A condition of the view: one the reader follows, or the one the address names. */
interface Entry { code: string; name: string }
const oneOf = <T extends string>(values: readonly T[], value: string | null, fallback: T): T => (values as readonly string[]).includes(value ?? "") ? (value as T) : fallback

/**
 * The Evidence view (`/wiki`): one row with the conditions the reader follows as tabs, a button that adds a tab for
 * another condition of the pack, and at the right which papers and of what time; under it the evidence summary of the
 * chosen condition. The name of the condition is written in its tab only. The condition, which papers and of what
 * time are kept in the address, so a reload and a link keep them.
 */
export function EvidencePage() {
  const router = useRouter()
  const params = useSearchParams()
  const id = useId()
  const wanted = params.get("condition")
  const scope = oneOf<Scope>(SCOPES, params.get("scope"), "all")
  const period = oneOf<Period>(PERIODS, params.get("period"), "all")
  const treatment = params.get("treatment")

  const [followed, setFollowed] = useState<Entry[] | null>(null)
  // The condition the address names when the reader does not follow it: asked of the pack; null for one the pack lacks.
  const [extra, setExtra] = useState<{ code: string; entry: Entry | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ code: string; count: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    listFollowedConditionsRemote()
      .then((list) => { if (!cancelled) setFollowed(list.map(({ code, name }) => ({ code, name }))) })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { cancelled = true }
  }, [])

  const unfollowed = followed !== null && wanted !== null && !followed.some((entry) => entry.code === wanted)
  useEffect(() => {
    if (!unfollowed || wanted === null) return
    let cancelled = false
    // A condition that cannot be had is not shown: the first followed one is.
    loadConditionEvidenceRemote(wanted)
      .then((answer) => { if (!cancelled) setExtra({ code: wanted, entry: { code: answer.condition.code, name: answer.condition.name } }) })
      .catch(() => { if (!cancelled) setExtra({ code: wanted, entry: null }) })
    return () => { cancelled = true }
  }, [unfollowed, wanted])

  const noteSaved = useCallback((evidence: Evidence) => setSaved({ code: evidence.condition.code, count: evidence.savedCount }), [])

  if (error) return <p role="alert" className="mt-6 text-[15px] text-accent-ink">{error}</p>
  if (followed === null || (unfollowed && extra?.code !== wanted)) return <p className="mt-6 text-[15px] text-muted-text">{V.loading}</p>
  const added = unfollowed ? extra?.entry ?? null : null
  const conditions: Entry[] = added ? [...followed, added] : followed
  const selected = conditions.find((entry) => entry.code === wanted) ?? conditions[0]
  if (!selected) {
    return <p className="mt-6 text-[15px] text-muted-text">{V.none} <Link href="/watch" className="text-accent-ink underline">{V.addTopics}</Link></p>
  }
  // Another condition has no treatment of this one; a new scope or period keeps it.
  const go = (next: { condition?: string; scope?: Scope; period?: Period }) => router.replace(evidenceHref({ condition: selected.code, scope, period, treatment: next.condition ? undefined : treatment ?? undefined, ...next }))
  const choose = (key: string | null) => router.replace(evidenceHref({ condition: selected.code, scope, period, treatment: key ?? undefined }))
  const savedCount = saved?.code === selected.code ? saved.count : null
  const shown = conditions.map((entry) => entry.code)

  return (
    <section className="mt-6">
      <div data-control-row="true" className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border-warm">
        <div className="flex flex-wrap items-end gap-1">
          <div role="tablist" aria-label={V.conditionsLabel} className="flex flex-wrap gap-1">
            {conditions.map((entry) => (
              <button key={entry.code} type="button" role="tab" id={`${id}-${entry.code}`} aria-selected={entry.code === selected.code} aria-controls={`${id}-condition`}
                onClick={() => go({ condition: entry.code })} className={entry.code === selected.code ? TAB_ON : TAB}>
                {entry.name}
              </button>
            ))}
          </div>
          <AddCondition shown={shown} onChoose={(code) => go({ condition: code })} />
        </div>
        <div data-controls="true" className="flex flex-wrap items-center gap-2 pb-2">
          <select aria-label={V.scopeLabel} value={scope} onChange={(event) => go({ scope: event.target.value as Scope })} className={SELECT}>
            <option value="all">{V.scopes.all}</option>
            <option value="saved">{V.scopes.saved(savedCount)}</option>
          </select>
          <select aria-label={E.periodLabel} value={period} onChange={(event) => go({ period: event.target.value as Period })} className={SELECT}>
            {PERIODS.map((entry) => <option key={entry} value={entry}>{E.periods[entry]}</option>)}
          </select>
        </div>
      </div>
      {/* 24 px to the line of what the summary is built from: 8 here, and the 16 the summary has over it. */}
      <div role="tabpanel" id={`${id}-condition`} aria-labelledby={`${id}-${selected.code}`} className="pt-2">
        <ConditionEvidence condition={selected.code} scope={scope} period={period} onLoaded={noteSaved} treatment={treatment} onChoose={choose} />
      </div>
    </section>
  )
}
