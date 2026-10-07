"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { loadTreatmentTableRemote, type TreatmentTable } from "@/lib/clinical/records/client"
import { parseEvidenceQuery } from "@/lib/clinical/records/query"

const T = CLINICAL_COPY.records.table

/**
 * The treatment-options table of a condition page, drawn from the page's fenced block (spec 7.6,
 * 7.9). The numbers come from the server, counted from the stored records, each time the page is
 * shown; none is written in the page.
 */
export function EvidenceTable({ body }: { body: string }) {
  const query = parseEvidenceQuery(body)
  const condition = query?.condition ?? null
  const [table, setTable] = useState<TreatmentTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!condition) return
    let cancelled = false
    loadTreatmentTableRemote(condition).then((next) => { if (!cancelled) { setTable(next); setError(null) } }).catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { cancelled = true }
  }, [condition])

  if (!condition) return <p className="my-4 text-[13px] text-muted-text">{T.notAQuery}</p>
  if (error) return <p role="alert" className="my-4 text-[13px] text-accent-ink">{error}</p>
  if (!table) return <p className="my-4 text-[13px] text-muted-text">{T.loading}</p>
  if (table.rows.length === 0) return <p className="my-4 text-[14px] text-muted-text">{T.empty(table.condition.name)}</p>
  const toCheck = table.rows.reduce((sum, row) => sum + row.toCheck, 0)
  return (
    <div data-testid="evidence-table" className="my-4">
      <div className="overflow-x-auto">
        <table className="min-w-[760px] border-collapse text-left text-[13px] leading-relaxed text-espresso">
          <thead><tr>{T.columns.map((column) => <th key={column} className="border-b border-border-warm px-3 py-2 font-semibold">{column}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.key} className="align-top">
                <td className="border-b border-border-warm px-3 py-2.5 font-medium">{row.treatment}</td>
                <td className="border-b border-border-warm px-3 py-2.5">{row.modality ? T.modalities[row.modality as keyof typeof T.modalities] ?? row.modality : T.unknownModality}</td>
                <td className="border-b border-border-warm px-3 py-2.5">{row.trials}</td>
                <td className="border-b border-border-warm px-3 py-2.5">{row.comparators.join(", ") || T.none}</td>
                <td className="border-b border-border-warm px-3 py-2.5">{row.outcomes.join(", ") || T.none}</td>
                <td className="border-b border-border-warm px-3 py-2.5">{T.direction(row)}</td>
                <td className="border-b border-border-warm px-3 py-2.5">{row.latestYear ?? T.none}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted-text">{T.note}</p>
      {toCheck > 0 && <p className="mt-1 text-[12px] text-accent-ink">{T.toCheck(toCheck)}</p>}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {table.rows.flatMap((row) => row.papers).filter((paper, index, all) => all.findIndex((other) => other.slug === paper.slug) === index).map((paper) => (
          <li key={paper.slug}><Link href={`/paper/${paper.slug}#paper-trial-record`} className="text-accent-ink underline decoration-dotted">{paper.title}</Link></li>
        ))}
      </ul>
    </div>
  )
}
