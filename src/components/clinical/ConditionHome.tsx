"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { listFollowedConditionsRemote, type FollowedCondition } from "@/lib/clinical/evidence/client"
import { createConditionPageRemote } from "@/lib/clinical/records/client"
import { wikiHref } from "@/lib/wiki/href"
import { classNameOf } from "./evidence-labels"

const H = CLINICAL_COPY.evidence.home

/** Wiki home in the clinical edition (spec D53): the conditions the reader follows, each leading to its evidence page. */
export function ConditionHome() {
  const router = useRouter()
  const [conditions, setConditions] = useState<FollowedCondition[] | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    listFollowedConditionsRemote().then((list) => { if (!cancelled) setConditions(list) }).catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { cancelled = true }
  }, [])
  const open = async (condition: FollowedCondition) => {
    setOpening(condition.code)
    setError(null)
    try {
      // The page is made the first time it is asked for (decision D19: by the reader, on request). The call is made
      // every time: it changes nothing on a page that has its evidence block, and gives the block to an older page.
      router.push(wikiHref((await createConditionPageRemote(condition.code)).id))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setOpening(null)
    }
  }
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-[13px] font-medium tracking-body text-espresso">{H.heading}</h2>
      {error && <p role="alert" className="mb-3 text-[13px] text-accent-ink">{error}</p>}
      {conditions === null && !error && <p className="text-[13px] text-muted-text">{H.loading}</p>}
      {conditions !== null && conditions.length === 0 && (
        <p className="text-[14px] text-muted-text">{H.none} <Link href="/watch" className="text-accent-ink underline">{H.addTopics}</Link></p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(conditions ?? []).map((condition) => (
          <div key={condition.code} data-condition={condition.code} className="rounded-card border border-border-warm/70 bg-light-surface px-5 py-4">
            <h3 className="font-heading text-[19px] font-semibold text-espresso">{condition.name}</h3>
            <p data-count="true" className="mt-1 text-[13px] text-secondary-dark">{H.count(condition.total, condition.recent)}</p>
            {condition.treatments.length > 0 && <p data-treatments="true" className="mt-1 text-[13px] text-muted-text">{condition.treatments.map((entry) => classNameOf(entry.key, entry.label)).join(", ")}</p>}
            <button type="button" onClick={() => void open(condition)} disabled={opening !== null}
              className="mt-3 rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso hover:bg-card-surface/60 disabled:opacity-50">
              {opening === condition.code ? H.opening : H.open}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
