import { commitChangeset } from "../../vault/mutations"
import { makeChangesetId } from "../../vault/changesets"
import { parseDocument, serializeDocument } from "../../vault/frontmatter"
import type { VaultStorage } from "../../vault/storage"
import { slugifyTitle } from "../../wiki/authoring"
import { loadRouting } from "../../wiki/schema-routing"
import { CLINICAL_COPY } from "../copy"
import type { Taxonomy } from "../pack/schema"
import { CONDITION_FENCE, conditionBlock } from "./query"

/**
 * Makes the wiki page of a condition when the reader asks for one (decision D19: pages are created
 * by the user). The page holds the pack's id of the condition and a block that is drawn as the
 * evidence the feed has seen on it. An existing page that has the block is left as it is. One made
 * before the block existed gets it, at the top of its body, and nothing else of it is touched.
 */
export async function createConditionPage(storage: VaultStorage, taxonomy: Taxonomy, code: string, opts: { now?: () => Date } = {}): Promise<{ id: string; created: boolean }> {
  const node = taxonomy.nodes.find((entry) => entry.id === code && entry.type === "condition")
  if (!node) throw new Error(CLINICAL_COPY.records.noSuchCondition)
  const dir = (await loadRouting(storage)).condition ?? "wiki/conditions"
  const id = `${dir}/${slugifyTitle(node.name)}`
  const path = `${id}.md`
  const now = opts.now?.() ?? new Date()
  const P = CLINICAL_COPY.records.conditionPage
  const section = `## ${P.evidence}\n\n${conditionBlock(node.id)}\n\n`
  const existing = await storage.read(path)
  if (existing !== null) {
    const after = withEvidenceSection(existing, section)
    if (after !== null) await commitChangeset(storage, { id: makeChangesetId(), skill: "condition-page-evidence", model: "none", timestamp: now.toISOString(), changes: [{ path, before: existing, after }] }, { op: "condition-page-evidence", summary: node.name })
    return { id, created: false }
  }
  const today = now.toISOString().slice(0, 10)
  const body = `${section}## ${P.notes}\n\n${P.notesHint}\n`
  const after = serializeDocument({
    type: "condition", title: node.name, created: today, updated: today, tags: [], related: [], sources: [],
    taxonomy: node.id, aliases: node.synonyms, ...(node.meshHeading ? { mesh: node.meshHeading } : {}),
  }, body)
  await commitChangeset(storage, { id: makeChangesetId(), skill: "condition-page-create", model: "none", timestamp: now.toISOString(), changes: [{ path, before: null, after }] }, { op: "condition-page-create", summary: node.name })
  return { id, created: true }
}

/** The page with the evidence section put before its body, or null when it has the block already or cannot be read as a page. */
function withEvidenceSection(raw: string, section: string): string | null {
  let parsed: ReturnType<typeof parseDocument>
  try { parsed = parseDocument(raw) } catch { return null }
  if (new RegExp(`^\`\`\`${CONDITION_FENCE}[ \\t]*$`, "m").test(parsed.body)) return null
  // The text before the body is kept as it stands, so the reader's own front matter is not rewritten.
  return raw.endsWith(parsed.body) ? `${raw.slice(0, raw.length - parsed.body.length)}${section}${parsed.body}` : serializeDocument(parsed.frontmatter, `${section}${parsed.body}`)
}
