// src/lib/clinical/records/query.ts
// The fenced block a condition page holds, and the query it stands for. Pure text; a page can use it.

export const EVIDENCE_FENCE = "evidence-table"

/** The block's body as a query, or null when it is not one. Only `condition: <taxonomy id>` is understood in this version. */
export function parseEvidenceQuery(body: string): { condition: string } | null {
  const line = body.split("\n").map((entry) => entry.trim()).find((entry) => entry.startsWith("condition:"))
  const condition = line?.slice("condition:".length).trim() ?? ""
  return /^[a-z0-9][a-z0-9-]*$/.test(condition) ? { condition } : null
}

export const evidenceBlock = (conditionCode: string) => `\`\`\`${EVIDENCE_FENCE}\ncondition: ${conditionCode}\n\`\`\``
