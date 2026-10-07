"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { createConditionPageRemote, listConditionsRemote } from "@/lib/clinical/records/client"
import { wikiHref } from "@/lib/wiki/href"

const P = CLINICAL_COPY.records.conditionPage

/** Lets the reader make the wiki page of a condition the pack knows. Pages are made on request only. */
export function NewConditionPage() {
  const router = useRouter()
  const [conditions, setConditions] = useState<Array<{ code: string; name: string }>>([])
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    listConditionsRemote().then((list) => { if (!cancelled) setConditions(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const create = async () => {
    setBusy(true)
    setError(null)
    try { router.push(wikiHref((await createConditionPageRemote(code)).id)) } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) } finally { setBusy(false) }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select aria-label={P.label} title={P.note} value={code} onChange={(event) => setCode(event.target.value)} className="rounded-pill border border-border-warm bg-transparent px-3 py-1.5 text-[13px] text-espresso">
        <option value="">{P.choose}</option>
        {conditions.map((condition) => <option key={condition.code} value={condition.code}>{condition.name}</option>)}
      </select>
      <button type="button" onClick={() => void create()} disabled={busy || code === ""} className="rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso hover:bg-card-surface/60 disabled:opacity-50">{busy ? P.creating : P.create}</button>
      {error && <span role="alert" className="text-[13px] text-accent-ink">{error}</span>}
    </span>
  )
}
