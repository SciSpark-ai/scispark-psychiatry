"use client"

import type { ReactNode } from "react"
import { CONDITION_FENCE, EVIDENCE_FENCE, parseEvidenceQuery } from "@/lib/clinical/records/query"
import { ConditionEvidence } from "./ConditionEvidence"
import { EvidenceTable } from "./EvidenceTable"

/** The fenced blocks the clinical edition draws in a wiki page. Any other language is left to the ordinary code block. */
export function clinicalFence(language: string, body: string): ReactNode | null {
  if (language === CONDITION_FENCE) return <ConditionEvidence condition={parseEvidenceQuery(body)?.condition ?? null} />
  return language === EVIDENCE_FENCE ? <EvidenceTable body={body} /> : null
}
