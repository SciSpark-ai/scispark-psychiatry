"use client"

import { useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { outcomeEffect } from "@/lib/clinical/records/effects"
import { PATHS, getCode, getField, isChecked, isNumberPath, pathsToCheck, resultKeys, type ChoiceField, type Outcome, type TrialRecord } from "@/lib/clinical/records/schema"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import type { TrialRecordState } from "./useTrialRecord"

const R = CLINICAL_COPY.records
const two = (value: number) => value.toFixed(2)
const LINK = "text-[12px] underline decoration-dotted disabled:opacity-50"
const SELECT = "max-w-full rounded-[8px] border border-border-warm bg-transparent px-2 py-1 text-[14px] text-espresso disabled:opacity-50"

type Option = { value: ChoiceField["value"]; label: string }
const ROLE_OPTIONS: Option[] = [{ value: "treatment", label: R.roles.treatment }, { value: "control", label: R.roles.control }]
const BENEFIT_OPTIONS: Option[] = [{ value: true, label: R.benefit.lower }, { value: false, label: R.benefit.higher }, { value: null, label: R.benefit.unclear }]
const PRIMARY_OPTIONS: Option[] = [{ value: true, label: R.primaryChoice.yes }, { value: false, label: R.primaryChoice.no }]

/** One value: what was read, how far it has been checked, the sentence it came from, and the two things a person can do with it. */
function Field({ record, path, label, state }: { record: TrialRecord; path: string; label: string; state: TrialRecordState }) {
  const [draft, setDraft] = useState<string | null>(null)
  const field = getField(record, path)
  if (!field) return null
  const checked = isChecked(field.state)
  // The draft stays until the change is taken: a refused one is still there to be sent again or changed.
  const save = async () => {
    const text = (draft ?? "").trim()
    if (await state.edit(path, isNumberPath(path) ? (text === "" ? null : Number(text)) : text === "" ? null : text)) setDraft(null)
  }
  return (
    <div data-field={path} className="grid gap-x-3 gap-y-0.5 py-1.5 sm:grid-cols-[130px_1fr]">
      <span className="pt-0.5 text-[13px] font-semibold text-secondary-dark">{label}</span>
      <div>
        {draft === null ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span data-value="true" className={`text-[15px] ${field.value === null ? "text-muted-text" : "text-espresso"}`}>{field.value === null ? R.unknown : String(field.value)}</span>
            <span data-state="true" className={`text-[12px] ${checked ? "text-secondary-dark" : "text-accent-ink"}`}>{R.states[field.state]}</span>
            {!checked && field.value !== null && <button type="button" disabled={state.busy} onClick={() => void state.confirm(path)} className={`${LINK} text-accent-ink`}>{R.confirm}</button>}
            <button type="button" disabled={state.busy} onClick={() => setDraft(field.value === null ? "" : String(field.value))} className={`${LINK} text-muted-text`}>{R.edit}</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label={label} value={draft} inputMode={isNumberPath(path) ? "decimal" : "text"} onChange={(event) => setDraft(event.target.value)}
              className="w-[220px] rounded-[8px] border border-border-warm bg-transparent px-2 py-1 text-[14px] text-espresso" />
            <button type="button" onClick={() => void save()} disabled={state.busy || (isNumberPath(path) && (draft ?? "").trim() !== "" && !Number.isFinite(Number(draft)))} className={`${LINK} text-accent-ink`}>{R.save}</button>
            <button type="button" onClick={() => setDraft(null)} className={`${LINK} text-muted-text`}>{R.cancel}</button>
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
 * One of the three choices a model wrote and no sentence proves: the role of a group, which result is
 * the better one, whether an outcome is the primary one. Shown with its state; confirmed, or set to
 * another of its values.
 */
function Choice({ record, path, label, options, state }: { record: TrialRecord; path: string; label: string; options: Option[]; state: TrialRecordState }) {
  const field = getField(record, path)
  if (!field) return null
  const checked = isChecked(field.state)
  const at = options.findIndex((option) => option.value === field.value)
  return (
    <div data-field={path} className="grid gap-x-3 gap-y-0.5 py-1.5 sm:grid-cols-[130px_1fr]">
      <span className="pt-0.5 text-[13px] font-semibold text-secondary-dark">{label}</span>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <select aria-label={label} value={String(at)} disabled={state.busy} onChange={(event) => void state.edit(path, options[Number(event.target.value)].value)} className={SELECT}>
          {options.map((option, index) => <option key={option.label} value={String(index)}>{option.label}</option>)}
        </select>
        <span data-state="true" className={`text-[12px] ${checked ? "text-secondary-dark" : "text-accent-ink"}`}>{R.states[field.state]}</span>
        {!checked && <button type="button" disabled={state.busy} onClick={() => void state.confirm(path)} className={`${LINK} text-accent-ink`}>{R.confirm}</button>}
      </div>
    </div>
  )
}

/** What the condition or a group is filed under in the pack, by name, and a way to file it elsewhere or nowhere. */
function Filing({ record, path, label, ofCondition, state }: { record: TrialRecord; path: string; label: string; ofCondition: boolean; state: TrialRecordState }) {
  const code = getCode(record, path) ?? null
  const terms = ofCondition ? state.filing.conditions : state.filing.treatments
  // A code the list does not have (the pack changed) is still shown as what it is.
  const listed = code === null || terms.some((term) => term.code === code) ? terms : [{ code, name: state.names[code] ?? code }, ...terms]
  const text = code !== null ? R.filedUnder(state.names[code] ?? code) : ofCondition ? R.notFiledCondition : R.notFiled
  return (
    <div data-filed={path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1.5 sm:pl-[142px]">
      <span data-filed-text="true" className={`text-[12px] ${code !== null ? "text-secondary-dark" : "text-accent-ink"}`}>{text}</span>
      <select aria-label={R.fileUnder(label)} value={code ?? ""} disabled={state.busy} onChange={(event) => void state.file(path, event.target.value === "" ? null : event.target.value)} className={`${SELECT} text-[12px]`}>
        <option value="">{R.notFiled}</option>
        {listed.map((term) => <option key={term.code} value={term.code}>{term.name}</option>)}
      </select>
    </div>
  )
}

/** The effect of one outcome in a line: the measure, its interval, the two groups compared, and the direction in words. */
function effectLine(record: TrialRecord, outcome: Outcome): string {
  const { effect, direction, compared } = outcomeEffect(outcome, record.arms)
  if (!effect || !compared) return R.directions[direction]
  const nameOf = (armId: string) => record.arms.find((arm) => arm.id === armId)?.treatment.value ?? armId
  return R.effect(R.measures[effect.measure], two(effect.estimate), two(effect.low), two(effect.high), R.intervalNotes[effect.measure], R.versus(nameOf(compared.treatment), nameOf(compared.control)), R.directions[direction])
}

/**
 * The trial data of a paper, for checking against the paper (spec 7.12). Effects are computed here
 * from the stored numbers; nothing on this panel is a number a model wrote without its sentence, and
 * no direction is shown that rests on a choice of the model's nobody has confirmed.
 */
export function ClinicalTrialRecord({ state, canExtract }: { state: TrialRecordState; canExtract: boolean }) {
  const { record, error } = state
  const alert = error ? <div role="alert" className="mb-6"><LlmErrorMessage message={error} /></div> : null
  if (!record) {
    // A record that could not be loaded may be there: nothing is extracted over it.
    if (!canExtract || state.loadFailed) return alert
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
  const toCheck = pathsToCheck(record).length
  const source = record.source.access === "full-text" ? R.fromFullText : R.fromAbstract
  return (
    <>
      {alert}
      <section id="paper-trial-record" data-testid="trial-record" aria-labelledby="trial-record-title" tabIndex={-1} className="mb-10 scroll-mt-6 rounded-card border border-border-warm/70 bg-light-surface px-6 py-5">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="trial-record-title" className="font-heading text-[20px] font-semibold text-espresso">{R.heading}</h2>
          <span data-testid="record-source" className="text-[12px] text-muted-text">{record.source.truncated ? R.truncated(source) : source}</span>
        </div>
        <p data-testid="record-to-check" className="text-[13px] font-medium text-accent-ink">{toCheck > 0 ? R.toCheck(toCheck) : R.allChecked}</p>
        {record.droppedFields > 0 && <p className="mt-0.5 text-[12px] text-muted-text">{R.dropped(record.droppedFields)}</p>}
        <div className="mt-3">
          <Field record={record} path="condition" label={R.fields.condition} state={state} />
          <Filing record={record} path={PATHS.conditionCode} label={R.fields.condition} ofCondition state={state} />
        </div>

        <h3 className="mb-1 mt-4 border-t border-border-warm/60 pt-4 text-[12px] font-semibold uppercase tracking-wide text-accent-ink">{R.arms}</h3>
        {record.arms.map((arm) => (
          <div key={arm.id} data-arm={arm.id} className="mb-2">
            <Choice record={record} path={PATHS.role(arm.id)} label={R.fields.role} options={ROLE_OPTIONS} state={state} />
            <Field record={record} path={`arms.${arm.id}.treatment`} label={R.fields.treatment} state={state} />
            <Filing record={record} path={PATHS.treatmentCode(arm.id)} label={R.fields.treatment} ofCondition={false} state={state} />
            <Field record={record} path={`arms.${arm.id}.n`} label={R.fields.n} state={state} />
          </div>
        ))}

        <h3 className="mb-1 mt-4 border-t border-border-warm/60 pt-4 text-[12px] font-semibold uppercase tracking-wide text-accent-ink">{R.outcomes}</h3>
        {record.outcomes.map((outcome) => (
          <div key={outcome.id} data-outcome={outcome.id} className="mb-4">
            {outcome.primary && <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-text">{R.primary}</p>}
            {(["name", "instrument", "timepoint"] as const).map((part) => <Field key={part} record={record} path={`outcomes.${outcome.id}.${part}`} label={R.fields[part]} state={state} />)}
            <Choice record={record} path={PATHS.primary(outcome.id)} label={R.fields.primary} options={PRIMARY_OPTIONS} state={state} />
            <Choice record={record} path={PATHS.benefit(outcome.id)} label={R.fields.benefit} options={BENEFIT_OPTIONS} state={state} />
            {outcome.results.map((result) => (
              <div key={result.armId} className="ml-3 border-l border-border-warm/60 pl-3">
                <p className="pt-1 text-[12px] text-muted-text">{record.arms.find((arm) => arm.id === result.armId)?.treatment.value ?? result.armId}</p>
                {resultKeys(outcome.kind).map((part) => (
                  <Field key={part} record={record} path={PATHS.result(outcome.id, result.armId, part)} label={R.fields[part]} state={state} />
                ))}
              </div>
            ))}
            <p data-effect="true" title={R.effectNote} className="mt-1.5 rounded-[10px] bg-card-surface/70 px-3 py-2 text-[14px] font-medium text-espresso">{effectLine(record, outcome)}</p>
          </div>
        ))}
      </section>
    </>
  )
}
