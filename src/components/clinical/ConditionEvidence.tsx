"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { loadConditionEvidenceRemote } from "@/lib/clinical/evidence/client"
import type { Design } from "@/lib/clinical/types"
import type { FindingKind } from "@/lib/clinical/evidence/schema"
import { parseEvidenceQuery } from "@/lib/clinical/records/query"

const E = CLINICAL_COPY.evidence

// Rewritten in the next task. Until then this component keeps drawing the flat rows the builder used to
// give; the builder now gives classes, treatments and studies, so these are the old shapes, kept here only.
const NO_TREATMENT_ROW = "none"
const FOLDED_ROW = "folded"
const OTHER_SERIES = "other"
export interface EvidenceRow {
  key: string; treatment: string | null; modality: string | null; studies: number
  kinds: Record<FindingKind | "unsorted", number>; designs: Array<{ design: Design; count: number }>
  latest: string | null; papers: string[]
}
export interface EvidenceItem {
  key: string; slug: string; headline: string; takeaway: string; kind: FindingKind | null; treatment: string | null; rowKey: string
  population: string | null; comparator: string | null; outcome: string | null
  design: Design; designNamed: boolean; venue: string | null; date: string | null; listedAt: string; saved: boolean
}
export interface Evidence {
  condition: { code: string; name: string }; total: number; rows: EvidenceRow[]
  timeline: { months: string[]; series: Array<{ key: string; label: string | null; counts: number[] }> }
  recent: EvidenceItem[]; recentTotal: number; items: EvidenceItem[]
}
const KIND_ORDER = ["benefit", "no-benefit", "mixed", "safety", "other", "unsorted"] as const
const KIND_COLOUR: Record<(typeof KIND_ORDER)[number], string> = {
  benefit: "var(--clinical-benefit)", "no-benefit": "var(--clinical-no-benefit)", mixed: "var(--viz-cat-6)", safety: "var(--viz-cat-3)", other: "var(--border)", unsorted: "var(--border)",
}
const SERIES_COLOURS = ["var(--viz-cat-1)", "var(--viz-cat-2)", "var(--viz-cat-3)", "var(--viz-cat-5)", "var(--viz-cat-7)"]
const OTHER_COLOUR = "var(--border)"
const ROW_PLAIN = "grid w-full items-center gap-x-4 gap-y-1 border-b border-border-warm/60 px-2 py-3 text-left hover:bg-card-surface sm:grid-cols-[1.1fr_90px_1.4fr_1.2fr]"
const ROW_SELECTED = `${ROW_PLAIN} bg-card-surface`
// The track has a border and another ground than a chosen or hovered row, so it never disappears into the row.
const TRACK = "flex h-2.5 w-full overflow-hidden rounded-full border border-border-warm bg-light-surface"
const percent = (part: number, whole: number) => `${Number(((part / whole) * 100).toFixed(4))}%`
const rowName = (row: EvidenceRow) => (row.key === FOLDED_ROW ? E.folded(row.studies) : row.treatment ?? E.noTreatment)

function Row({ row, selected, onPick }: { row: EvidenceRow; selected: boolean; onPick: () => void }) {
  const kinds = KIND_ORDER.filter((kind) => row.kinds[kind] > 0)
  // The row without a treatment is not one thing with a direction: it shows its papers and designs only.
  const directions = row.key !== NO_TREATMENT_ROW
  return (
    <button
      type="button" aria-pressed={selected} data-selected={selected ? "true" : undefined} data-evidence-row={row.key} onClick={onPick}
      title={row.key === FOLDED_ROW ? E.foldedNote : undefined} className={selected ? ROW_SELECTED : ROW_PLAIN}
    >
      <span className="block">
        <span data-row-name="true" className="block text-[15px] font-semibold text-espresso">{rowName(row)}</span>
        {row.modality && <span className="block text-[12px] text-muted-text">{E.modalities[row.modality as keyof typeof E.modalities] ?? row.modality}</span>}
      </span>
      <span data-row-studies="true" className="block text-[14px] text-espresso">{E.papers(row.studies)}</span>
      <span className="block">
        {directions && (
          <span data-bar="true" className={TRACK}>
            {kinds.map((kind) => <span key={kind} data-kind={kind} style={{ width: percent(row.kinds[kind], row.studies), backgroundColor: KIND_COLOUR[kind] }} />)}
          </span>
        )}
        {directions && <span data-row-directions="true" className="mt-1 block text-[12px] text-secondary-dark">{kinds.map((kind) => `${row.kinds[kind]} ${E.kinds[kind]}`).join(", ")}</span>}
      </span>
      <span className="block text-[12px] text-secondary-dark">
        <span data-row-designs="true" className="block">{row.designs.map((entry) => `${entry.count} ${E.designPlurals[entry.design][entry.count === 1 ? 0 : 1]}`).join(", ")}</span>
        {row.latest && <span className="block text-muted-text">{E.latest(row.latest)}</span>}
      </span>
    </button>
  )
}

function Timeline({ evidence }: { evidence: Evidence }) {
  const { months, series } = evidence.timeline
  const totals = months.map((_, index) => series.reduce((sum, entry) => sum + entry.counts[index], 0))
  const peak = Math.max(1, ...totals)
  const [width, height, gap] = [640, 150, 6]
  const bar = (width - gap * (months.length - 1)) / Math.max(1, months.length)
  const colourOf = (key: string, index: number) => (key === OTHER_SERIES ? OTHER_COLOUR : SERIES_COLOURS[index % SERIES_COLOURS.length])
  // Every rectangle is worked out before any element is built: one per month and series with papers in it.
  const rects = months.flatMap((month, at) => {
    let top = height
    return series.flatMap((entry, index) => {
      const count = entry.counts[at]
      if (count === 0) return []
      const tall = (count / peak) * height
      top -= tall
      return [{ id: `${month}-${entry.key}`, month, count, x: at * (bar + gap), y: top, tall, colour: colourOf(entry.key, index) }]
    })
  })
  return (
    <div data-testid="evidence-timeline">
      <svg viewBox={`0 0 ${width} ${height + 18}`} role="img" aria-label={E.timelineLabel(evidence.condition.name)} className="w-full max-w-[720px]">
        {rects.map((rect) => <rect key={rect.id} data-month={rect.month} data-count={rect.count} x={rect.x} y={rect.y} width={bar} height={rect.tall} rx={2} fill={rect.colour}><title>{`${rect.month}: ${rect.count}`}</title></rect>)}
        {months.map((month, at) => (at % 3 === 0 || at === months.length - 1 ? <text key={month} x={at * (bar + gap) + bar / 2} y={height + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{month}</text> : null))}
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-secondary-dark">
        {series.map((entry, index) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: colourOf(entry.key, index) }} />
            <span data-legend="true">{entry.label ?? E.otherSeries}</span>
          </span>
        ))}
      </p>
    </div>
  )
}

/** `treatment` is given where the group's heading does not name it: in the folded row and the row without a treatment. */
function Finding({ item, treatment }: { item: EvidenceItem; treatment: string | null }) {
  const pico = [
    item.population ? `${E.pico.population}: ${item.population}` : "", item.comparator ? `${E.pico.comparator}: ${item.comparator}` : "", item.outcome ? `${E.pico.outcome}: ${item.outcome}` : "",
  ].filter(Boolean)
  const source = [item.designNamed ? CLINICAL_COPY.designLabels[item.design] : "", item.venue ?? "", item.date ?? ""].filter(Boolean).join(E.picoJoin)
  return (
    <li data-finding={item.key} className="border-b border-border-warm/50 py-3 last:border-b-0">
      <p className="flex flex-wrap items-baseline gap-x-2.5">
        <Link href={`/paper/${item.slug}`} className="text-[15px] font-semibold text-espresso hover:text-accent-ink">{item.headline}</Link>
        {item.kind && item.kind !== "other" && <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: KIND_COLOUR[item.kind] }}>{E.kindLabels[item.kind]}</span>}
        {treatment && <span data-finding-treatment="true" className="text-[12px] text-secondary-dark">{treatment}</span>}
        {item.saved && <span className="rounded-pill border border-border-warm px-2 py-0.5 text-[11px] text-secondary-dark">{E.saved}</span>}
      </p>
      {item.takeaway && <p className="mt-0.5 text-[14px] leading-relaxed text-espresso">{item.takeaway}</p>}
      {pico.length > 0 && <p data-pico="true" className="mt-1 text-[13px] text-secondary-dark">{pico.join(E.picoJoin)}</p>}
      {source && <p className="mt-0.5 text-[12px] text-muted-text">{source}</p>}
    </li>
  )
}

/**
 * The evidence the reader's feed has seen on one condition, drawn from the page's fenced block
 * (spec D53): what is new, the treatments (each filters the findings), the safety findings, the
 * findings, and, folded away, when the papers came out. Counted on the server from the stored
 * findings each time the page is shown.
 */
export function ConditionEvidence({ body }: { body: string }) {
  const condition = parseEvidenceQuery(body)?.condition ?? null
  // The answer is kept with the condition it was asked for, so a change of condition shows "Counting…" without a set in the effect.
  const [loaded, setLoaded] = useState<{ condition: string; evidence: Evidence | null; error: string | null } | null>(null)
  // The chosen row is kept with its condition too, so another condition starts with none chosen.
  const [picked, setPicked] = useState<{ condition: string; key: string } | null>(null)
  useEffect(() => {
    if (!condition) return
    let cancelled = false
    const request = loadConditionEvidenceRemote(condition) as unknown as Promise<Evidence>
    request
      .then((next) => { if (!cancelled) setLoaded({ condition, evidence: next, error: null }) })
      .catch((failure) => { if (!cancelled) setLoaded({ condition, evidence: null, error: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { cancelled = true }
  }, [condition])

  const current = loaded && loaded.condition === condition ? loaded : null
  if (!condition) return <p className="my-4 text-[13px] text-muted-text">{E.notAQuery}</p>
  if (current?.error) return <p role="alert" className="my-4 text-[13px] text-accent-ink">{current.error}</p>
  const evidence = current?.evidence ?? null
  if (!evidence) return <p className="my-4 text-[13px] text-muted-text">{E.loading}</p>
  if (evidence.total === 0) return <p className="my-4 text-[14px] text-muted-text">{E.empty(evidence.condition.name)}</p>
  const heading = "mb-2 mt-7 text-[12px] font-semibold uppercase tracking-wide text-accent-ink"
  const chosen = picked && picked.condition === condition ? picked.key : null
  const rowOf = new Map(evidence.rows.map((row) => [row.key, row]))
  /** The treatment of a finding: the name of its row, what its paper named when the row is the folded one, nothing in the row without a treatment. */
  const treatmentOf = (item: EvidenceItem) => (item.rowKey === NO_TREATMENT_ROW ? null : item.rowKey === FOLDED_ROW ? item.treatment : rowOf.get(item.rowKey)?.treatment ?? item.treatment)
  const groups = evidence.rows
    .filter((row) => chosen === null || row.key === chosen)
    .map((row) => ({ row, named: row.key !== FOLDED_ROW && row.key !== NO_TREATMENT_ROW, items: evidence.items.filter((item) => item.rowKey === row.key) }))
    .filter((group) => group.items.length > 0)
  const recent = evidence.recent.map((item) => ({ item, treatment: treatmentOf(item) }))
  const safety = evidence.items.filter((item) => item.kind === "safety").map((item) => ({ item, treatment: treatmentOf(item) ?? E.noTreatment }))
  const pick = (key: string) => setPicked((now) => (now && now.condition === condition && now.key === key ? null : { condition, key }))
  return (
    <div data-testid="condition-evidence" className="my-4">
      <p data-testid="evidence-basis" className="text-[13px] text-muted-text">{E.basis(evidence.total, evidence.condition.name)}</p>
      {evidence.recent.length > 0 && (
        <section data-testid="evidence-new">
          <div className="flex items-baseline gap-3">
            <h3 className={heading}>{E.headings.recent}</h3>
            {evidence.recentTotal > evidence.recent.length && <span data-recent-count="true" className="text-[12px] text-muted-text">{E.recentShown(evidence.recent.length, evidence.recentTotal)}</span>}
          </div>
          <ul className="space-y-1.5">
            {recent.map(({ item, treatment }) => (
              <li key={item.key} className="flex flex-wrap items-baseline gap-x-2.5 text-[14px]">
                <Link href={`/paper/${item.slug}`} className="font-medium text-espresso hover:text-accent-ink">{item.headline}</Link>
                {treatment && <span data-recent-treatment="true" className="text-[12px] text-secondary-dark">{treatment}</span>}
                {item.kind && item.kind !== "other" && <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: KIND_COLOUR[item.kind] }}>{E.kindLabels[item.kind]}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className={heading}>{E.headings.treatments}</h3>
        <div>{evidence.rows.map((row) => <Row key={row.key} row={row} selected={chosen === row.key} onPick={() => pick(row.key)} />)}</div>
      </section>
      {safety.length > 0 && (
        <section data-testid="evidence-safety">
          <h3 className={heading}>{E.headings.safety}</h3>
          <ul className="space-y-1.5">
            {safety.map(({ item, treatment }) => (
              <li key={item.key} className="flex flex-wrap items-baseline gap-x-2.5 text-[14px]">
                <Link href={`/paper/${item.slug}`} className="font-medium text-espresso hover:text-accent-ink">{item.headline}</Link>
                <span className="text-[12px] text-secondary-dark">{treatment}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <div className="flex items-baseline gap-3">
          <h3 className={heading}>{E.headings.findings}</h3>
          {chosen !== null && <button type="button" data-show-all="true" onClick={() => setPicked(null)} className="text-[12px] text-accent-ink underline">{E.showAll}</button>}
        </div>
        {groups.map(({ row, named, items }) => (
          <div key={row.key} data-finding-group={row.key} className="mt-4 first:mt-0">
            <h4 className="text-[14px] font-semibold text-secondary-dark">{rowName(row)}</h4>
            <ul>{items.map((item) => <Finding key={item.key} item={item} treatment={named ? null : item.treatment} />)}</ul>
          </div>
        ))}
      </section>
      <details className="mt-7">
        <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-wide text-accent-ink">{E.headings.timeline}</summary>
        <div className="mt-2"><Timeline evidence={evidence} /></div>
      </details>
    </div>
  )
}
