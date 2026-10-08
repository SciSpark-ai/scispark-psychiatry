"use client"

import { useCallback, useEffect, useId, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import type { ConditionEvidence as Evidence, Period, Scope } from "@/lib/clinical/evidence/build"
import { listFollowedConditionsRemote, loadConditionEvidenceRemote } from "@/lib/clinical/evidence/client"
import { evidenceHref, PERIODS, SCOPES, type EvidenceTab } from "@/lib/clinical/evidence/href"
import { ConditionEvidence } from "./ConditionEvidence"
import { ConditionNotes } from "./ConditionNotes"

const E = CLINICAL_COPY.evidence
const V = E.page
const VIEWS: readonly EvidenceTab[] = ["summary", "notes"]
const SELECT = "rounded-pill border border-border-warm bg-light-surface px-3 py-1 text-[12px] text-espresso"
const TAB = "px-3 py-2 text-[14px] text-secondary-dark hover:text-espresso"
const TAB_ON = "border-b-2 border-accent-ink px-3 py-2 text-[14px] font-semibold text-espresso"

/** A condition of the view: one the reader follows, with its page when it has one, or the one the address names. */
interface Entry { code: string; name: string; pageId: string | null }
const oneOf = <T extends string>(values: readonly T[], value: string | null, fallback: T): T => (values as readonly string[]).includes(value ?? "") ? (value as T) : fallback

/**
 * The Evidence view (`/wiki`): the conditions the reader follows as tabs, and under the chosen one its
 * evidence summary or the reader's notes on it. The condition, which papers, of what time and which of
 * the two is open are kept in the address, so a reload and a link keep them. Notes that are typed and not
 * saved are kept here, by condition, while the reader looks at something else in the view; the browser asks
 * before the page is left with any.
 */
export function EvidencePage() {
  const router = useRouter()
  const params = useSearchParams()
  const id = useId()
  const views = useId()
  const wanted = params.get("condition")
  const scope = oneOf<Scope>(SCOPES, params.get("scope"), "all")
  const period = oneOf<Period>(PERIODS, params.get("period"), "all")
  const view: EvidenceTab = params.get("tab") === "notes" ? "notes" : "summary"

  const [followed, setFollowed] = useState<Entry[] | null>(null)
  // The condition the address names when the reader does not follow it: asked of the pack, with its page; null for one the pack lacks.
  const [extra, setExtra] = useState<{ code: string; entry: Entry | null } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // The pages that a first save of notes made, which the list of conditions does not know of yet.
  const [made, setMade] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ code: string; count: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    listFollowedConditionsRemote()
      .then((list) => { if (!cancelled) setFollowed(list.map(({ code, name, pageId }) => ({ code, name, pageId }))) })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { cancelled = true }
  }, [])

  const unfollowed = followed !== null && wanted !== null && !followed.some((entry) => entry.code === wanted)
  useEffect(() => {
    if (!unfollowed || wanted === null) return
    let cancelled = false
    // A condition that cannot be had is not shown: the first followed one is.
    loadConditionEvidenceRemote(wanted)
      .then((answer) => { if (!cancelled) setExtra({ code: wanted, entry: { code: answer.condition.code, name: answer.condition.name, pageId: answer.pageId ?? null } }) })
      .catch(() => { if (!cancelled) setExtra({ code: wanted, entry: null }) })
    return () => { cancelled = true }
  }, [unfollowed, wanted])

  const keepDraft = useCallback((code: string, text: string | null) => setDrafts((before) => {
    if (text !== null) return before[code] === text ? before : { ...before, [code]: text }
    if (!(code in before)) return before
    const next = { ...before }
    delete next[code]
    return next
  }), [])
  const keepPage = useCallback((code: string, pageId: string) => setMade((before) => ({ ...before, [code]: pageId })), [])
  const unsaved = Object.keys(drafts).length > 0
  useEffect(() => {
    if (!unsaved) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [unsaved])

  const noteSaved = useCallback((evidence: Evidence) => setSaved({ code: evidence.condition.code, count: evidence.savedCount }), [])

  if (error) return <p role="alert" className="mt-6 text-[13px] text-accent-ink">{error}</p>
  if (followed === null || (unfollowed && extra?.code !== wanted)) return <p className="mt-6 text-[13px] text-muted-text">{V.loading}</p>
  const added = unfollowed ? extra?.entry ?? null : null
  const conditions: Entry[] = added ? [...followed, added] : followed
  const selected = conditions.find((entry) => entry.code === wanted) ?? conditions[0]
  if (!selected) {
    return <p className="mt-6 text-[14px] text-muted-text">{V.none} <Link href="/watch" className="text-accent-ink underline">{V.addTopics}</Link></p>
  }
  const go = (next: { condition?: string; scope?: Scope; period?: Period; tab?: EvidenceTab }) =>
    router.replace(evidenceHref({ condition: selected.code, scope, period, tab: view, ...next }))
  const savedCount = saved?.code === selected.code ? saved.count : null

  return (
    <section className="mt-6">
      <div role="tablist" aria-label={V.conditionsLabel} className="flex flex-wrap gap-1 border-b border-border-warm">
        {conditions.map((entry) => (
          <button key={entry.code} type="button" role="tab" id={`${id}-${entry.code}`} aria-selected={entry.code === selected.code} aria-controls={`${id}-condition`}
            onClick={() => go({ condition: entry.code })} className={entry.code === selected.code ? TAB_ON : TAB}>
            {entry.name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-condition`} aria-labelledby={`${id}-${selected.code}`} className="pt-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="font-heading text-[22px] font-semibold tracking-heading text-espresso">{selected.name}</h2>
          {view === "summary" && (
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={V.scopeLabel} value={scope} onChange={(event) => go({ scope: event.target.value as Scope })} className={SELECT}>
                <option value="all">{V.scopes.all}</option>
                <option value="saved">{V.scopes.saved(savedCount)}</option>
              </select>
              <select aria-label={E.periodLabel} value={period} onChange={(event) => go({ period: event.target.value as Period })} className={SELECT}>
                {PERIODS.map((entry) => <option key={entry} value={entry}>{E.periods[entry]}</option>)}
              </select>
            </div>
          )}
        </div>
        <div role="tablist" aria-label={V.viewsLabel} className="mt-3 flex gap-1 border-b border-border-warm">
          {VIEWS.map((entry) => (
            <button key={entry} type="button" role="tab" id={`${views}-${entry}`} aria-selected={view === entry} aria-controls={`${views}-panel`}
              onClick={() => go({ tab: entry })} className={view === entry ? TAB_ON : TAB}>
              {V.views[entry]}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${views}-panel`} aria-labelledby={`${views}-${view}`}>
          {view === "summary"
            ? <ConditionEvidence condition={selected.code} scope={scope} period={period} onLoaded={noteSaved} />
            : <ConditionNotes key={selected.code} code={selected.code} pageId={made[selected.code] ?? selected.pageId} draft={drafts[selected.code]} onDraft={keepDraft} onPage={keepPage} />}
        </div>
      </div>
    </section>
  )
}
