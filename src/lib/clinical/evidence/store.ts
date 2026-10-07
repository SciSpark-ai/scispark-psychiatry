// src/lib/clinical/evidence/store.ts
import { withVaultExclusive } from "../../vault/exclusive"
import type { VaultStorage } from "../../vault/storage"
import { paperSlug } from "../../wiki/authoring"
import type { StoredFeed } from "../feed/stored"
import { listHistory, loadHistory } from "../history/store"
import type { Taxonomy } from "../pack/schema"
import { findNode } from "../pack/taxonomy"
import { FINDINGS_PATH, parseFindings } from "./file"
import type { Finding } from "./schema"

/**
 * Keeps every paper a search lists as a finding (spec D54: a condition page is built from all the
 * papers the feed has listed, not only saved ones). One finding per paper, however often it is listed.
 */

function findingsOf(feed: StoredFeed, taxonomy: Taxonomy): Finding[] {
  const codeOf = (name: string | undefined) => (name ? findNode(taxonomy, name, "condition")?.id : undefined)
  return feed.items.map((item) => {
    const topic = feed.topics?.find((entry) => entry.id === item.entryId)
    const answer: (NonNullable<StoredFeed["topicOverviews"]>[string][number]) | undefined = (item.entryId ? feed.topicOverviews?.[item.entryId] : undefined)?.find((entry) => entry.sources.length === 1 && entry.sources[0] === item.key)
    const treatment = answer?.treatment ?? null
    return {
      key: item.key, slug: paperSlug(item.paper), paper: item.paper,
      headline: item.digest?.headline ?? item.paper.title, takeaway: item.digest?.takeaway ?? "",
      design: item.design, designSource: item.designSource, journalBand: item.journalBand ?? null,
      conditionCodes: [codeOf(topic?.condition), codeOf(topic?.condition2)].filter((code): code is string => Boolean(code)),
      kind: answer?.kind ?? null, treatment, treatmentCode: treatment ? findNode(taxonomy, treatment, "treatment")?.id ?? null : null,
      text: answer?.text ?? null, population: answer?.population ?? null, comparator: answer?.comparator ?? null, outcome: answer?.outcome ?? null,
      firstListedAt: feed.generatedAt, lastListedAt: feed.generatedAt,
    }
  })
}

/** The earlier finding of a paper joined with a newer listing of it. */
function merged(earlier: Finding, newer: Finding): Finding {
  const answered = newer.kind !== null
  return {
    ...earlier,
    paper: newer.paper, design: newer.design, designSource: newer.designSource, journalBand: newer.journalBand ?? earlier.journalBand,
    // A newer listing replaces text only when it has some: a search without summaries must not blank an earlier one.
    ...(newer.takeaway ? { headline: newer.headline, takeaway: newer.takeaway } : {}),
    ...(answered ? { kind: newer.kind, treatment: newer.treatment, treatmentCode: newer.treatmentCode, text: newer.text, population: newer.population, comparator: newer.comparator, outcome: newer.outcome } : {}),
    conditionCodes: [...new Set([...earlier.conditionCodes, ...newer.conditionCodes])],
    firstListedAt: earlier.firstListedAt < newer.firstListedAt ? earlier.firstListedAt : newer.firstListedAt,
    lastListedAt: earlier.lastListedAt > newer.lastListedAt ? earlier.lastListedAt : newer.lastListedAt,
  }
}

async function write(storage: VaultStorage, feeds: StoredFeed[], taxonomy: Taxonomy): Promise<number> {
  return withVaultExclusive(storage, "clinical-findings", async () => {
    const raw = await storage.read(FINDINGS_PATH)
    const stored = parseFindings(raw)
    // A file this version cannot read is copied aside before it is replaced.
    if (raw !== null && stored === null) await storage.write(FINDINGS_PATH.replace(/\.json$/, ".unreadable.json"), raw)
    const findings = stored ?? {}
    for (const feed of feeds) for (const finding of findingsOf(feed, taxonomy)) findings[finding.key] = findings[finding.key] ? merged(findings[finding.key], finding) : finding
    await storage.write(FINDINGS_PATH, JSON.stringify({ version: 1, findings }))
    return Object.keys(findings).length
  })
}

/** Records the papers of one search. Returns how many findings are stored afterwards. */
export function recordFindings(storage: VaultStorage, feed: StoredFeed, taxonomy: Taxonomy): Promise<number> {
  return write(storage, [feed], taxonomy)
}

/** Fills an empty store from the searches already kept, oldest first. Does nothing once the file exists. */
export async function backfillFindings(storage: VaultStorage, taxonomy: Taxonomy): Promise<number> {
  const existing = parseFindings(await storage.read(FINDINGS_PATH))
  if (existing) return Object.keys(existing).length
  const entries = (await listHistory(storage)).sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
  const feeds = (await Promise.all(entries.map((entry) => loadHistory(storage, entry.id)))).filter((feed): feed is StoredFeed => feed !== null)
  return feeds.length > 0 ? write(storage, feeds, taxonomy) : 0
}
