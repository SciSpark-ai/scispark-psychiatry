"use client"

import { useEffect, useState } from "react"
import { getOpenVault } from "@/lib/vault/get-vault"
import type { VaultStorage } from "@/lib/vault/storage"
import { Card } from "@/components/ui/Card"
import { PageHeader } from "@/components/ui/PageHeader"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { topicLabel } from "@/lib/clinical/topic-label"
import {
  GATE_STRICTNESS, PRIORITIES, type ClinicalSettings, type Priority, type WatchEntry,
} from "@/lib/clinical/types"
import { loadClinicalSettings, loadWatchEntries, newEntryId, saveClinicalSettings, saveWatchEntries } from "@/lib/clinical/watch/store"

export interface WatchSuggestions {
  conditions: string[]
  treatments: string[]
  populations: string[]
}

const W = CLINICAL_COPY.watch
const PRIORITY_LABEL: Record<Priority, string> = { high: W.high, normal: W.normal, paused: W.paused }
const STRICTNESS_LABEL = { strict: W.strict, standard: W.standard, open: W.open } as const
const field = "rounded-btn border border-border-warm bg-light-surface px-3 py-1.5 text-[13px] text-espresso"

const label = (entry: WatchEntry) => topicLabel(entry)

export function WatchListEditor({ suggestions }: { suggestions: WatchSuggestions }) {
  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [entries, setEntries] = useState<WatchEntry[]>([])
  const [settings, setSettings] = useState<ClinicalSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ condition: "", condition2: "", conditionJoin: "and" as "and" | "or", treatment: "", population: "", priority: "normal" as Priority, safetySignal: false })

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

  async function add() {
    const condition = draft.condition.trim()
    const treatment = draft.treatment.trim()
    if (!condition && !treatment) { setError(W.needFacet); return }
    const entry: WatchEntry = {
      id: newEntryId(), priority: draft.priority, safetySignal: draft.safetySignal,
      ...(condition ? { condition } : {}), ...(treatment ? { treatment } : {}),
      // A second condition only means something next to a first one.
      ...(condition && draft.condition2.trim() ? { condition2: draft.condition2.trim(), conditionJoin: draft.conditionJoin } : {}),
      ...(draft.population ? { population: draft.population } : {}),
    }
    await persist([...entries, entry])
    setDraft({ condition: "", condition2: "", conditionJoin: "and", treatment: "", population: "", priority: "normal", safetySignal: false })
  }

  const update = (id: string, patch: Partial<WatchEntry>) => persist(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))

  if (!storage || !settings) return <div className="p-7"><p className="text-[14px] text-muted-text">{error ?? CLINICAL_COPY.loading}</p></div>

  return (
    <div className="p-7">
      <PageHeader title={W.heading} description={W.intro} />
      {error && <p role="alert" className="mb-4 text-[13px] text-red-600">{error}</p>}

      <ul className="mb-6 space-y-3" aria-label={W.entriesLabel}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <Card className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1 text-[14px] text-espresso">{label(entry)}{entry.population ? ` · ${entry.population}` : ""}</span>
              <select aria-label={`${W.priority}: ${label(entry)}`} className={field} value={entry.priority}
                onChange={(event) => void update(entry.id, { priority: event.target.value as Priority })}>
                {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-[12px] text-muted-text">
                <input type="checkbox" checked={entry.safetySignal} onChange={(event) => void update(entry.id, { safetySignal: event.target.checked })} />
                {W.safetySignal}
              </label>
              <button type="button" onClick={() => void persist(entries.filter((other) => other.id !== entry.id))} className="text-[12px] text-accent-ink underline">
                {W.remove}
              </button>
            </Card>
          </li>
        ))}
      </ul>

      <Card className="mb-8 space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] text-muted-text">{W.condition}
            <input className={`${field} mt-1 w-full`} list="watch-conditions" value={draft.condition} onChange={(event) => setDraft({ ...draft, condition: event.target.value })} />
          </label>
          <label className="text-[12px] text-muted-text">{W.treatment}
            <input className={`${field} mt-1 w-full`} list="watch-treatments" value={draft.treatment} onChange={(event) => setDraft({ ...draft, treatment: event.target.value })} />
          </label>
          <label className="text-[12px] text-muted-text">{W.population}
            <select className={`${field} mt-1 w-full`} value={draft.population} onChange={(event) => setDraft({ ...draft, population: event.target.value })}>
              <option value="">—</option>
              {suggestions.populations.map((population) => <option key={population} value={population}>{population}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-muted-text">{W.priority}
            <select className={`${field} mt-1 w-full`} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}>
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
            </select>
          </label>
        </div>
        {/* Two conditions in one topic: both required, or either. The treatment is not combined this way. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] text-muted-text">{W.condition2}
            <input aria-label={W.condition2} className={`${field} mt-1 w-full`} list="watch-conditions" value={draft.condition2} disabled={!draft.condition.trim()}
              onChange={(event) => setDraft({ ...draft, condition2: event.target.value })} />
          </label>
          <label className="text-[12px] text-muted-text">{W.conditionJoin}
            <select aria-label={W.conditionJoin} className={`${field} mt-1 w-full`} value={draft.conditionJoin} disabled={!draft.condition2.trim()}
              onChange={(event) => setDraft({ ...draft, conditionJoin: event.target.value as "and" | "or" })}>
              <option value="and">{W.joinAnd}</option>
              <option value="or">{W.joinOr}</option>
            </select>
          </label>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-text">
          <input type="checkbox" checked={draft.safetySignal} onChange={(event) => setDraft({ ...draft, safetySignal: event.target.checked })} />
          {W.safetySignal}
        </label>
        <datalist id="watch-conditions">{suggestions.conditions.map((name) => <option key={name} value={name} />)}</datalist>
        <datalist id="watch-treatments">{suggestions.treatments.map((name) => <option key={name} value={name} />)}</datalist>
        <button type="button" onClick={() => void add()} className="rounded-pill bg-orange px-4 py-1.5 text-[13px] font-medium text-on-accent hover:bg-orange/90">{W.add}</button>
      </Card>

      <Card className="space-y-4 p-4">
        <label className="block text-[13px] text-espresso">{W.strictness}
          <select aria-label={W.strictness} className={`${field} mt-1 block`} value={settings.strictness} onChange={(event) => void persistSettings({ ...settings, strictness: event.target.value as ClinicalSettings["strictness"] })}>
            {GATE_STRICTNESS.map((strictness) => <option key={strictness} value={strictness}>{STRICTNESS_LABEL[strictness]}</option>)}
          </select>
        </label>
      </Card>
    </div>
  )
}
