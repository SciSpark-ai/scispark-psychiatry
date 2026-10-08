"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/Card"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { loadConditionEvidenceRemote } from "@/lib/clinical/evidence/client"
import { CODE_RE } from "@/lib/clinical/notes/links"
import { listConditionsRemote } from "@/lib/clinical/records/client"

const P = CLINICAL_COPY.notes.page
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
const ROW = `block w-full rounded-sm px-2 py-1.5 text-left text-espresso transition-colors hover:bg-card-surface focus-visible:bg-card-surface ${FOCUS}`
const QUIET = `rounded-pill px-3 py-1.5 text-[13px] text-muted-text transition-colors hover:text-espresso ${FOCUS}`
const messageOf = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))

/** What the dialog gives its owner: a condition of the pack, or a treatment of one. */
export type Topic = { kind: "condition"; code: string; name: string } | { kind: "treatment"; condition: string; key: string; name: string }
type Named = { code: string; name: string }
type Treatments = { code: string; list: Array<{ key: string; name: string }> | null; error: string | null }

/**
 * The small dialog of "Link a condition or treatment": the conditions of the pack, and once one is chosen, the link to
 * it or to one of the treatments the reader's feed has seen for it. It tells its owner what was chosen and writes
 * nothing itself. Escape and "Close" close it.
 */
export function LinkTopic({ onChoose, onClose }: { onChoose: (topic: Topic) => void; onClose: () => void }) {
  const [pack, setPack] = useState<{ conditions: Named[] | null; error: string | null }>({ conditions: null, error: null })
  const [text, setText] = useState("")
  const [chosen, setChosen] = useState<Named | null>(null)
  const [answer, setAnswer] = useState<Treatments | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    let cancelled = false
    listConditionsRemote()
      .then((conditions) => { if (!cancelled) setPack({ conditions, error: null }) })
      .catch((failure) => { if (!cancelled) setPack({ conditions: null, error: messageOf(failure) }) })
    return () => { cancelled = true }
  }, [])
  const code = chosen?.code ?? null
  useEffect(() => {
    if (code === null) return
    let cancelled = false
    loadConditionEvidenceRemote(code, { period: "all", scope: "all" })
      .then((evidence) => {
        if (cancelled) return
        const list: Array<{ key: string; name: string }> = []
        for (const group of evidence.classes) for (const treatment of group.treatments) {
          if (CODE_RE.test(treatment.key) && !list.some((entry) => entry.key === treatment.key)) list.push({ key: treatment.key, name: treatment.name })
        }
        setAnswer({ code, list, error: null })
      })
      .catch((failure) => { if (!cancelled) setAnswer({ code, list: null, error: messageOf(failure) }) })
    return () => { cancelled = true }
  }, [code])

  const wanted = text.trim().toLowerCase()
  const conditions = (pack.conditions ?? []).filter((condition) => condition.name.toLowerCase().includes(wanted))
  const treatments = chosen && answer?.code === chosen.code ? answer : null
  return (
    <Card role="dialog" aria-label={P.linkTopic} data-link-topic="true" className="mt-3 px-4 py-3 text-[14px]" onKeyDown={(event) => { if (event.key === "Escape") onClose() }}>
      {chosen === null ? (
        <>
          <div className="flex items-center gap-2">
            <input ref={input} type="search" aria-label={P.topicFilter} placeholder={P.topicFilter} autoComplete="off" value={text} onChange={(event) => setText(event.target.value)}
              className={`min-w-0 flex-1 rounded-pill border border-border-warm bg-light-surface px-3 py-1.5 text-[14px] text-espresso ${FOCUS}`} />
            <button type="button" onClick={onClose} className={QUIET}>{P.close}</button>
          </div>
          <div className="mt-2 max-h-72 overflow-y-auto">
            {pack.error !== null ? <p role="alert" className="px-1 py-1.5 text-accent-ink">{pack.error}</p>
              : pack.conditions === null ? <p className="px-1 py-1.5 text-muted-text">{P.topicLoading}</p>
              : conditions.length === 0 ? <p className="px-1 py-1.5 text-muted-text">{P.topicNone}</p>
              : conditions.map((condition) => <button key={condition.code} type="button" data-condition={condition.code} onClick={() => setChosen(condition)} className={ROW}>{condition.name}</button>)}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => setChosen(null)} className={QUIET}>{P.backToConditions}</button>
            <button type="button" onClick={onClose} className={QUIET}>{P.close}</button>
          </div>
          <button type="button" data-link-condition={chosen.code} onClick={() => onChoose({ kind: "condition", code: chosen.code, name: chosen.name })}
            className={`mt-2 rounded-pill border border-border-warm px-4 py-1.5 text-[13px] font-medium text-espresso transition-colors hover:bg-card-surface ${FOCUS}`}>{P.linkCondition(chosen.name)}</button>
          <div className="mt-3 max-h-72 overflow-y-auto">
            {treatments === null ? <p className="px-1 py-1.5 text-muted-text">{P.topicLoading}</p>
              : treatments.error !== null ? <p role="alert" className="px-1 py-1.5 text-accent-ink">{treatments.error}</p>
              : (treatments.list ?? []).length === 0 ? <p className="px-1 py-1.5 text-muted-text">{P.noTreatments}</p>
              : (
                <>
                  <p className="px-1 pb-1 text-[13px] text-muted-text">{P.treatmentsHint}</p>
                  {(treatments.list ?? []).map((treatment) => (
                    <button key={treatment.key} type="button" data-treatment={treatment.key} className={ROW}
                      onClick={() => onChoose({ kind: "treatment", condition: chosen.code, key: treatment.key, name: treatment.name })}>{treatment.name}</button>
                  ))}
                </>
              )}
          </div>
        </>
      )}
    </Card>
  )
}
