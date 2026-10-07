"use client"

import { useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { outcomeEffect } from "@/lib/clinical/records/effects"
import { fieldPaths, getField, isNumberPath, type TrialRecord } from "@/lib/clinical/records/schema"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import type { TrialRecordState } from "./useTrialRecord"

const R = CLINICAL_COPY.records
const two = (value: number) => value.toFixed(2)

/** One value: what was read, how far it has been checked, the sentence it came from, and the two things a person can do with it. */
function Field({ record, path, label, state }: { record: TrialRecord; path: string; label: string; state: TrialRecordState }) {
  const [draft, setDraft] = useState<string | null>(null)
  const field = getField(record, path)
  if (!field) return null
  const checked = field.state === "human-confirmed" || field.state === "human-edited"
  const save = () => {
    const text = (draft ?? "").trim()
    state.edit(path, isNumberPath(path) ? (text === "" ? null : Number(text)) : text === "" ? null : text)
    setDraft(null)
  }
  return (
    <div data-field={path} className="grid gap-x-3 gap-y-0.5 py-1.5 sm:grid-cols-[130px_1fr]">
      <span className="pt-0.5 text-[13px] font-semibold text-secondary-dark">{label}</span>
      <div>
        {draft === null ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span data-value="true" className={`text-[15px] ${field.value === null ? "text-muted-text" : "text-espresso"}`}>{field.value === null ? R.unknown : String(field.value)}</span>
            <span data-state="true" className={`text-[12px] ${checked ? "text-secondary-dark" : "text-accent-ink"}`}>{R.states[field.state]}</span>
            {!checked && field.value !== null && <button type="button" disabled={state.busy} onClick={() => state.confirm(path)} className="text-[12px] text-accent-ink underline decoration-dotted disabled:opacity-50">{R.confirm}</button>}
            <button type="button" disabled={state.busy} onClick={() => setDraft(field.value === null ? "" : String(field.value))} className="text-[12px] text-muted-text underline decoration-dotted disabled:opacity-50">{R.edit}</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label={label} value={draft} inputMode={isNumberPath(path) ? "decimal" : "text"} onChange={(event) => setDraft(event.target.value)}
              className="w-[220px] rounded-[8px] border border-border-warm bg-transparent px-2 py-1 text-[14px] text-espresso" />
            <button type="button" onClick={save} disabled={isNumberPath(path) && (draft ?? "").trim() !== "" && !Number.isFinite(Number(draft))} className="text-[12px] text-accent-ink underline decoration-dotted disabled:opacity-50">{R.save}</button>
            <button type="button" onClick={() => setDraft(null)} className="text-[12px] text-muted-text underline decoration-dotted">{R.cancel}</button>
          </div>
        )}
        {field.quote && (
          <details className="mt-0.5 text-[13px] text-muted-text">
            <summary className="cursor-pointer select-none text-[12px] hover:text-accent-ink">{R.sourceSentence}</summary>
            <blockquote className="mt-1 border-l-2 border-border-warm pl-3 italic leading-relaxed text-secondary-dark">{field.quote}</blockquote>
          </details>
        )}
      </div>
    </div>
  )
}

/**
 * The trial data of a paper, for checking against the paper (spec 7.12). Effects are computed here
 * from the stored numbers; nothing on this panel is a number a model wrote without its sentence.
 */
export function ClinicalTrialRecord({ state, canExtract }: { state: TrialRecordState; canExtract: boolean }) {
  const { record, error } = state
  const alert = error ? <div role="alert" className="mb-6"><LlmErrorMessage message={error} /></div> : null
  if (!record) {
    if (!canExtract) return alert
    return (
      <>
        {alert}
        <p className="mb-10">
          <button type="button" onClick={state.extract} disabled={state.busy} title={R.extractNote}
            className="rounded-pill border border-border-warm px-4 py-1.5 text-[13px] text-espresso hover:bg-card-surface/60 disabled:opacity-50">{state.busy ? R.extracting : R.extract}</button>
        </p>
      </>
    )
  }
  const toCheck = fieldPaths(record).filter((path) => { const field = getField(record, path); return field && field.value !== null && field.state !== "human-confirmed" && field.state !== "human-edited" }).length
  return (
    <>
      {alert}
      <section id="paper-trial-record" data-testid="trial-record" aria-labelledby="trial-record-title" tabIndex={-1} className="mb-10 scroll-mt-6 rounded-card border border-border-warm/70 bg-light-surface px-6 py-5">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="trial-record-title" className="font-heading text-[20px] font-semibold text-espresso">{R.heading}</h2>
          <span className="text-[12px] text-muted-text">{record.source.access === "full-text" ? R.fromFullText : R.fromAbstract}</span>
        </div>
        <p data-testid="record-to-check" className="text-[13px] font-medium text-accent-ink">{toCheck > 0 ? R.toCheck(toCheck) : R.allChecked}</p>
        {record.droppedFields > 0 && <p className="mt-0.5 text-[12px] text-muted-text">{R.dropped(record.droppedFields)}</p>}
        <div className="mt-3"><Field record={record} path="condition" label={R.fields.condition} state={state} /></div>

        <h3 className="mb-1 mt-4 border-t border-border-warm/60 pt-4 text-[12px] font-semibold uppercase tracking-wide text-accent-ink">{R.arms}</h3>
        {record.arms.map((arm) => (
          <div key={arm.id} data-arm={arm.id} className="mb-2">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-text">{R.roles[arm.role]}</p>
            <Field record={record} path={`arms.${arm.id}.treatment`} label={R.fields.treatment} state={state} />
            <Field record={record} path={`arms.${arm.id}.n`} label={R.fields.n} state={state} />
          </div>
        ))}

        <h3 className="mb-1 mt-4 border-t border-border-warm/60 pt-4 text-[12px] font-semibold uppercase tracking-wide text-accent-ink">{R.outcomes}</h3>
        {record.outcomes.map((outcome) => {
          const { effect, direction } = outcomeEffect(outcome, record.arms)
          return (
            <div key={outcome.id} data-outcome={outcome.id} className="mb-4">
              {outcome.primary && <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-text">{R.primary}</p>}
              {(["name", "instrument", "timepoint"] as const).map((part) => <Field key={part} record={record} path={`outcomes.${outcome.id}.${part}`} label={R.fields[part]} state={state} />)}
              {outcome.results.map((result) => (
                <div key={result.armId} className="ml-3 border-l border-border-warm/60 pl-3">
                  <p className="pt-1 text-[12px] text-muted-text">{record.arms.find((arm) => arm.id === result.armId)?.treatment.value ?? result.armId}</p>
                  {(outcome.kind === "continuous" ? (["n", "mean", "sd"] as const) : (["n", "events"] as const)).map((part) => (
                    <Field key={part} record={record} path={["outcomes", outcome.id, "results", result.armId, part].join(".")} label={R.fields[part]} state={state} />
                  ))}
                </div>
              ))}
              <p data-effect="true" title={R.effectNote} className="mt-1.5 rounded-[10px] bg-card-surface/70 px-3 py-2 text-[14px] font-medium text-espresso">
                {effect ? R.effect(R.measures[effect.measure], two(effect.estimate), two(effect.low), two(effect.high), R.directions[direction]) : R.directions["not-computable"]}
              </p>
            </div>
          )
        })}
      </section>
    </>
  )
}
