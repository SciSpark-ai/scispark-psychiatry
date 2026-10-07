"use client"

import { useEffect, useState, type KeyboardEvent } from "react"
import { getOpenVault } from "@/lib/vault/get-vault"
import type { VaultStorage } from "@/lib/vault/storage"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { topicLabel } from "@/lib/clinical/topic-label"
import { GATE_STRICTNESS, PRIORITIES, type ClinicalSettings, type Priority, type WatchEntry } from "@/lib/clinical/types"
import { loadClinicalSettings, loadWatchEntries, newEntryId, saveClinicalSettings, saveWatchEntries } from "@/lib/clinical/watch/store"
import { checkTerm, suggestTerms } from "@/lib/clinical/watch/suggest"

export interface WatchSuggestions {
  conditions: string[]
  treatments: string[]
  populations: string[]
  /** Other names the pack knows for its conditions and treatments (synonyms, brand names). */
  conditionAliases?: string[]
  treatmentAliases?: string[]
}

const W = CLINICAL_COPY.watch
const PRIORITY_LABEL: Record<Priority, string> = { high: W.high, normal: W.normal, paused: W.paused }
const STRICTNESS_LABEL = { strict: W.strict, standard: W.standard, open: W.open } as const
const input = "w-full max-w-[340px] rounded-btn border border-border-warm bg-light-surface px-3 py-2 text-[15px] text-espresso placeholder:text-muted-text/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange"
const heading = "mb-3 text-[19px] font-semibold text-espresso"
const fieldLabel = "mb-1 block text-[14px] font-medium text-espresso"

type FieldName = "condition" | "condition2" | "treatment"
const EMPTY = { condition: "", condition2: "", conditionJoin: "and" as "and" | "or", treatment: "", population: "", safetySignal: false }

/**
 * The My topics page: the topics you follow, and a short form to add one. A field offers the pack's
 * names right under it while you type; Enter adds the topic. A term the pack does not know is
 * allowed, but one that looks like a slip of a known name is asked about first.
 */
export function WatchListEditor({ suggestions }: { suggestions: WatchSuggestions }) {
  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [entries, setEntries] = useState<WatchEntry[]>([])
  const [settings, setSettings] = useState<ClinicalSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [second, setSecond] = useState(false)
  /** The field whose suggestions are open. */
  const [focused, setFocused] = useState<FieldName | null>(null)
  /** A likely misspelling waiting for the user's answer. */
  const [spelling, setSpelling] = useState<{ field: FieldName; typed: string; suggestion: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const [loaded, loadedSettings] = await Promise.all([loadWatchEntries(vault), loadClinicalSettings(vault)])
        if (cancelled) return
        setStorage(vault); setEntries(loaded); setSettings(loadedSettings)
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function persist(next: WatchEntry[]) {
    if (!storage) return
    setError(null)
    try { await saveWatchEntries(storage, next); setEntries(next) }
    catch (failure) { setError(failure instanceof Error ? failure.message : W.saveFailed) }
  }

  async function persistSettings(next: ClinicalSettings) {
    if (!storage) return
    setError(null)
    try { await saveClinicalSettings(storage, next); setSettings(next) }
    catch (failure) { setError(failure instanceof Error ? failure.message : W.settingsSaveFailed) }
  }

  const namesFor = (field: FieldName) => (field === "treatment" ? suggestions.treatments : suggestions.conditions)
  const aliasesFor = (field: FieldName) => (field === "treatment" ? suggestions.treatmentAliases : suggestions.conditionAliases) ?? []

  /** Adds the topic in `values`. `checked` lists the fields whose spelling the user has already settled. */
  async function add(values = draft, checked: FieldName[] = []) {
    const condition = values.condition.trim()
    const condition2 = second && condition ? values.condition2.trim() : ""
    const treatment = values.treatment.trim()
    if (!condition && !treatment) { setError(W.needFacet); return }
    const typed: Array<[FieldName, string]> = [["condition", condition], ["condition2", condition2], ["treatment", treatment]]
    for (const [field, text] of typed) {
      if (!text || checked.includes(field)) continue
      const check = checkTerm(namesFor(field), aliasesFor(field), text)
      if (check.status === "close") { setError(null); setSpelling({ field, typed: text, suggestion: check.suggestion }); return }
    }
    const entry: WatchEntry = {
      id: newEntryId(), priority: "normal", safetySignal: values.safetySignal,
      ...(condition ? { condition } : {}),
      // A second condition only means something next to a first one.
      ...(condition2 ? { condition2, conditionJoin: values.conditionJoin } : {}),
      ...(treatment ? { treatment } : {}),
      ...(values.population ? { population: values.population } : {}),
    }
    setSpelling(null)
    await persist([...entries, entry])
    setDraft(EMPTY)
    setSecond(false)
  }

  /** The user answered a spelling question: carry on adding with the chosen text. */
  const settleSpelling = (text: string) => {
    if (!spelling) return
    const values = { ...draft, [spelling.field]: text }
    setDraft(values)
    void add(values, [spelling.field])
  }

  const update = (id: string, patch: Partial<WatchEntry>) => persist(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); setFocused(null); void add() } }

  if (!storage || !settings) return <div className="p-7"><p className="text-[15px] text-muted-text">{error ?? CLINICAL_COPY.loading}</p></div>

  const preview = topicLabel({ condition: draft.condition.trim() || undefined, condition2: second ? draft.condition2.trim() || undefined : undefined, conditionJoin: draft.conditionJoin, treatment: draft.treatment.trim() || undefined })

  /** One short field with its own list of names right under it. */
  const termField = (field: FieldName, label: string, placeholder?: string) => {
    const options = focused === field ? suggestTerms(namesFor(field), draft[field]) : []
    return (
      <div className="relative max-w-[340px]">
        <label className={fieldLabel} htmlFor={`topic-${field}`}>{label}</label>
        <input id={`topic-${field}`} aria-label={label} autoComplete="off" className={input} placeholder={placeholder} value={draft[field]}
          onChange={(event) => { setDraft({ ...draft, [field]: event.target.value }); setFocused(field); setSpelling(null) }}
          onFocus={() => setFocused(field)} onBlur={() => setFocused((current) => (current === field ? null : current))} onKeyDown={onKey} />
        {options.length > 0 && (
          <ul role="listbox" data-testid={`suggestions-${field}`} className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-btn border border-border-warm bg-light-surface shadow-lg">
            {options.map((name) => (
              // mousedown, not click: the field must not lose focus (and close the list) before the pick lands.
              <li key={name} role="option" aria-selected={false} onMouseDown={(event) => { event.preventDefault(); setDraft({ ...draft, [field]: name }); setFocused(null) }}
                className="cursor-pointer px-3 py-2 text-[15px] text-espresso hover:bg-card-surface">{name}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-[860px] p-7">
      <div className="mb-7">
        <h1 className="font-heading text-[26px] font-semibold tracking-heading text-espresso">{W.heading}</h1>
        <p className="mt-1 text-[15px] leading-relaxed text-secondary-dark">{W.intro}</p>
      </div>
      {error && <p role="alert" className="mb-4 text-[15px] text-red-600">{error}</p>}

      <section className="mb-9">
        <h2 className={heading}>{W.yourTopics}</h2>
        {entries.length === 0 ? <p className="text-[15px] text-muted-text">{W.noTopics}</p> : (
          <ul className="divide-y divide-border-warm/70 rounded-card border border-border-warm bg-light-surface">
            {entries.map((entry) => (
              <li key={entry.id} data-testid="topic-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p data-topic-name="true" className={`text-[17px] font-semibold text-espresso ${entry.priority === "paused" ? "opacity-50" : ""}`}>{topicLabel(entry)}</p>
                  {(entry.population || entry.safetySignal) && (
                    <p className="text-[13px] text-muted-text">{[entry.population, entry.safetySignal ? W.caseReportsOn : ""].filter(Boolean).join(" · ")}</p>
                  )}
                </div>
                <select aria-label={`${W.priority}: ${topicLabel(entry)}`} value={entry.priority} onChange={(event) => void update(entry.id, { priority: event.target.value as Priority })}
                  className="rounded-btn border border-border-warm bg-transparent px-2.5 py-1.5 text-[14px] text-espresso">
                  {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
                </select>
                <button type="button" onClick={() => void persist(entries.filter((other) => other.id !== entry.id))} className="text-[14px] text-accent-ink underline">{W.remove}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-9">
        <h2 className={heading}>{W.addTopic}</h2>
        <p className="mb-4 max-w-[640px] text-[15px] leading-relaxed text-secondary-dark">{W.addHelp}</p>
        <div className="space-y-4 rounded-card border border-border-warm bg-light-surface p-5">
          {termField("condition", W.condition, W.conditionHint)}
          {second ? (
            <div className="space-y-2">
              {termField("condition2", W.condition2)}
              <div role="group" aria-label={W.conditionJoin} className="flex flex-wrap items-center gap-2">
                {(["and", "or"] as const).map((join) => (
                  <button key={join} type="button" aria-pressed={draft.conditionJoin === join} title={join === "and" ? W.joinAndNote : W.joinOrNote} onClick={() => setDraft({ ...draft, conditionJoin: join })}
                    className={`rounded-pill border px-3 py-1 text-[14px] ${draft.conditionJoin === join ? "border-orange bg-orange/10 font-semibold text-accent-ink" : "border-border-warm text-secondary-dark hover:bg-card-surface/60"}`}>{join === "and" ? W.joinAnd : W.joinOr}</button>
                ))}
                <span className="text-[13px] text-muted-text">{draft.conditionJoin === "and" ? W.joinAndNote : W.joinOrNote}</span>
                <button type="button" onClick={() => { setSecond(false); setDraft({ ...draft, condition2: "" }) }} className="text-[13px] text-accent-ink underline">{W.removeSecond}</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setSecond(true)} disabled={!draft.condition.trim()} className="text-[14px] text-accent-ink underline disabled:text-muted-text disabled:no-underline">{W.addSecond}</button>
          )}
          {termField("treatment", W.treatment, W.treatmentHint)}

          <details>
            <summary className="cursor-pointer text-[14px] text-secondary-dark">{W.moreOptions}</summary>
            <div className="mt-3 space-y-3">
              <div className="max-w-[340px]">
                <label className={fieldLabel} htmlFor="topic-population">{W.population}</label>
                <select id="topic-population" className={input} value={draft.population} onChange={(event) => setDraft({ ...draft, population: event.target.value })}>
                  <option value="">—</option>
                  {suggestions.populations.map((population) => <option key={population} value={population}>{population}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-[14px] text-espresso">
                <input type="checkbox" checked={draft.safetySignal} onChange={(event) => setDraft({ ...draft, safetySignal: event.target.checked })} />
                {W.safetySignal}
              </label>
            </div>
          </details>

          {preview && <p data-testid="topic-preview" className="text-[15px] text-secondary-dark">{W.preview} <span className="font-semibold text-espresso">{preview}</span></p>}
          {spelling && (
            <div data-testid="spelling-check" className="flex flex-wrap items-center gap-2 rounded-btn border border-border-warm bg-card-surface/50 px-3 py-2 text-[15px] text-espresso">
              <span>{W.spellingAsk(spelling.suggestion)}</span>
              <button type="button" onClick={() => settleSpelling(spelling.suggestion)} className="rounded-pill bg-orange px-3 py-1 text-[14px] font-medium text-on-accent">{W.spellingUse(spelling.suggestion)}</button>
              <button type="button" onClick={() => settleSpelling(spelling.typed)} className="rounded-pill border border-border-warm px-3 py-1 text-[14px] text-espresso">{W.spellingKeep(spelling.typed)}</button>
            </div>
          )}
          <button type="button" onClick={() => void add()} className="rounded-pill bg-orange px-5 py-2 text-[15px] font-medium text-on-accent hover:bg-orange/90">{W.add}</button>
        </div>
      </section>

      <section>
        <h2 className={heading}>{W.filterHeading}</h2>
        <select aria-label={W.strictness} value={settings.strictness} onChange={(event) => void persistSettings({ ...settings, strictness: event.target.value as ClinicalSettings["strictness"] })}
          className="w-full max-w-[640px] rounded-btn border border-border-warm bg-light-surface px-3 py-2 text-[15px] text-espresso">
          {GATE_STRICTNESS.map((strictness) => <option key={strictness} value={strictness}>{STRICTNESS_LABEL[strictness]}</option>)}
        </select>
      </section>
    </div>
  )
}
