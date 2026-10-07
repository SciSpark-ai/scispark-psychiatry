import { commitChangeset } from "../../vault/mutations"
import { makeChangesetId } from "../../vault/changesets"
import { serializeDocument } from "../../vault/frontmatter"
import type { VaultStorage } from "../../vault/storage"
import { slugifyTitle } from "../../wiki/authoring"
import { loadRouting } from "../../wiki/schema-routing"
import { CLINICAL_COPY } from "../copy"
import type { Taxonomy } from "../pack/schema"
import { evidenceBlock } from "./query"

/**
 * Makes the wiki page of a condition when the reader asks for one (decision D19: pages are created
 * by the user). The page holds the pack's id of the condition and a block that is drawn as the
 * treatment-options table. An existing page is left as it is.
 */
export async function createConditionPage(storage: VaultStorage, taxonomy: Taxonomy, code: string, opts: { now?: () => Date } = {}): Promise<{ id: string; created: boolean }> {
  const node = taxonomy.nodes.find((entry) => entry.id === code && entry.type === "condition")
  if (!node) throw new Error(CLINICAL_COPY.records.noSuchCondition)
  const dir = (await loadRouting(storage)).condition ?? "wiki/conditions"
  const id = `${dir}/${slugifyTitle(node.name)}`
  const path = `${id}.md`
  if ((await storage.read(path)) !== null) return { id, created: false }
  const now = opts.now?.() ?? new Date()
  const today = now.toISOString().slice(0, 10)
  const P = CLINICAL_COPY.records.conditionPage
  const body = `## ${P.overview}\n\n${P.overviewHint}\n\n## ${P.options}\n\n${evidenceBlock(node.id)}\n`
  const after = serializeDocument({
    type: "condition", title: node.name, created: today, updated: today, tags: [], related: [], sources: [],
    taxonomy: node.id, aliases: node.synonyms, ...(node.meshHeading ? { mesh: node.meshHeading } : {}),
  }, body)
  await commitChangeset(storage, { id: makeChangesetId(), skill: "condition-page-create", model: "none", timestamp: now.toISOString(), changes: [{ path, before: null, after }] }, { op: "condition-page-create", summary: node.name })
  return { id, created: true }
}
