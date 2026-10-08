// src/lib/clinical/evidence/store.ts
import { withVaultExclusive } from "../../vault/exclusive"
import type { VaultStorage } from "../../vault/storage"
import { paperSlug } from "../../wiki/authoring"
import type { StoredFeed } from "../feed/stored"
import { listHistory, loadHistory } from "../history/store"
import type { Taxonomy } from "../pack/schema"
import { armsOf, findNode } from "../pack/taxonomy"
import { FINDINGS_PATH, parseFindings } from "./file"
import { FINDINGS_VERSION, type Finding } from "./schema"

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
      // A paper that matched only the topic's treatment (ketamine after surgery, under a depression topic) is not
      // about the topic's condition. A topic with two conditions joined by "or" gives both codes: which of the two
      // the paper matched is not recorded.
      conditionCodes: item.matched === "treatment" ? [] : [codeOf(topic?.condition), codeOf(topic?.condition2)].filter((code): code is string => Boolean(code)),
      // The first treatment the text names, by its words, that is not the paper's comparator. The words are kept as the
      // model gave them: the page finds the treatments and the comparators again when it is built.
      kind: answer?.kind ?? null, treatment,
      treatmentCode: treatment ? armsOf(taxonomy, treatment, answer?.comparator).treatments[0] ?? null : null,
      treatmentClass: answer?.treatmentClass ?? null, researchType: answer?.researchType ?? null, sampleSize: answer?.sampleSize ?? null,
      text: answer?.text ?? null, population: answer?.population ?? null, comparator: answer?.comparator ?? null, outcome: answer?.outcome ?? null,
      firstListedAt: feed.generatedAt, lastListedAt: feed.generatedAt,
    }
  })
}

/**
 * What the paper is about after a newer answer (final review I3): a treatment, or a type of research, never both.
 * The latest answer decides. One that names a treatment files the paper under it; one that names none and gives a
 * type of research clears the treatment, its code and its class; one that gives neither keeps an earlier treatment,
 * so a thin answer does not erase it, and with a treatment standing there is no type of research.
 */
function subjectOf(earlier: Finding, newer: Finding): Pick<Finding, "treatment" | "treatmentCode" | "treatmentClass" | "researchType"> {
  if (newer.treatment !== null) return { treatment: newer.treatment, treatmentCode: newer.treatmentCode, treatmentClass: newer.treatmentClass ?? earlier.treatmentClass, researchType: null }
  if (newer.researchType !== null) return { treatment: null, treatmentCode: null, treatmentClass: null, researchType: newer.researchType }
  const { treatment, treatmentCode } = earlier
  return { treatment, treatmentCode, treatmentClass: newer.treatmentClass ?? earlier.treatmentClass, researchType: treatment !== null ? null : earlier.researchType }
}

/** The earlier finding of a paper joined with a newer listing of it. */
function merged(earlier: Finding, newer: Finding): Finding {
  const answered = newer.kind !== null
  return {
    ...earlier,
    paper: newer.paper, design: newer.design, designSource: newer.designSource, journalBand: newer.journalBand ?? earlier.journalBand,
    // A newer listing replaces text only when it has some: a search without summaries must not blank an earlier one.
    ...(newer.takeaway ? { headline: newer.headline, takeaway: newer.takeaway } : {}),
    ...(answered ? { kind: newer.kind, text: newer.text, population: newer.population, comparator: newer.comparator, outcome: newer.outcome } : {}),
    // A listing without an answer changes nothing of what the paper is about; a newer sample size replaces an earlier one only when it has one.
    ...(answered ? { ...subjectOf(earlier, newer), sampleSize: newer.sampleSize ?? earlier.sampleSize } : {}),
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
    await storage.write(FINDINGS_PATH, JSON.stringify({ version: FINDINGS_VERSION, findings }))
    return Object.keys(findings).length
  })
}

/** Records the papers of one search. Returns how many findings are stored afterwards. */
export function recordFindings(storage: VaultStorage, feed: StoredFeed, taxonomy: Taxonomy): Promise<number> {
  return write(storage, [feed], taxonomy)
}

/** Fills a missing or unreadable store (one of an earlier version too) from the searches already kept, oldest first. Does nothing once a readable file exists. */
export async function backfillFindings(storage: VaultStorage, taxonomy: Taxonomy): Promise<number> {
  const existing = parseFindings(await storage.read(FINDINGS_PATH))
  if (existing) return Object.keys(existing).length
  const entries = (await listHistory(storage)).sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
  const feeds = (await Promise.all(entries.map((entry) => loadHistory(storage, entry.id)))).filter((feed): feed is StoredFeed => feed !== null)
  return feeds.length > 0 ? write(storage, feeds, taxonomy) : 0
}
