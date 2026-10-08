"use client"

import { useEffect, useId, useRef, useState } from "react"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { listConditionsRemote } from "@/lib/clinical/records/client"

const V = CLINICAL_COPY.evidence.page
type Pack = { conditions: Array<{ code: string; name: string }> | null; error: string | null }

/**
 * The button after the last tab of the Evidence view: it opens a list of the conditions of the pack that have no tab
 * yet, and tells its owner which one was chosen. It follows nothing and makes no page. Escape and a press outside
 * close the list; Escape puts the keyboard back on the button.
 */
export function AddCondition({ shown, onChoose }: { shown: string[]; onChoose: (code: string) => void }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [pack, setPack] = useState<Pack>({ conditions: null, error: null })
  const holder = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  // The pack's conditions are asked for the first time the list is opened.
  const asked = pack.conditions !== null || pack.error !== null
  useEffect(() => {
    if (!open || asked) return
    let cancelled = false
    listConditionsRemote()
      .then((conditions) => { if (!cancelled) setPack({ conditions, error: null }) })
      .catch((failure) => { if (!cancelled) setPack({ conditions: null, error: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { cancelled = true }
  }, [open, asked])
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!holder.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", outside)
    return () => document.removeEventListener("mousedown", outside)
  }, [open])
  // Once the list is drawn the keyboard is on its first condition.
  const listed = open && pack.conditions !== null
  useEffect(() => { if (listed) list.current?.querySelector("button")?.focus() }, [listed])

  const close = () => { setOpen(false); button.current?.focus() }
  const choices = (pack.conditions ?? []).filter((condition) => !shown.includes(condition.code))
  return (
    <span ref={holder} className="relative inline-flex" onKeyDown={(event) => { if (open && event.key === "Escape") close() }}>
      <button ref={button} type="button" data-add-condition="true" aria-label={V.addLabel} title={V.addLabel} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}
        className="px-3 py-2 text-[16px] leading-none text-secondary-dark hover:text-espresso">{V.add}</button>
      {open && (
        <div ref={list} id={id} data-add-menu="true" role="group" aria-label={V.addList}
          className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-card border border-border-warm bg-light-surface p-1 text-[14px] shadow-md">
          {pack.error !== null ? <p role="alert" className="px-3 py-2 text-accent-ink">{pack.error}</p>
            : pack.conditions === null ? <p className="px-3 py-2 text-muted-text">{V.addLoading}</p>
            : choices.length === 0 ? <p className="px-3 py-2 text-muted-text">{V.addNone}</p>
            : choices.map((condition) => (
              <button key={condition.code} type="button" onClick={() => { setOpen(false); onChoose(condition.code) }}
                className="block w-full rounded-sm px-3 py-1.5 text-left text-espresso hover:bg-card-surface focus-visible:bg-card-surface">{condition.name}</button>
            ))}
        </div>
      )}
    </span>
  )
}
