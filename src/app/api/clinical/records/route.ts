import { getSkillTestOverrides } from "@/lib/server/skill-route"
import { getServerVault } from "@/lib/server/vault"
import { loadSettings } from "@/lib/llm/settings"
import { loadPaperText } from "@/lib/papers/full-text"
import { PaperTextInfoSchema } from "@/lib/papers/text-contract"
import { paperKey, type PaperRecord } from "@/lib/papers/types"
import { paperSlug } from "@/lib/wiki/authoring"
import { readPaperTextPatiently } from "@/lib/clinical/digest/paper-text"
import { loadPsychiatryPack } from "@/lib/clinical/pack/load"
import type { Taxonomy } from "@/lib/clinical/pack/schema"
import { NotATrialError, extractTrialRecord } from "@/lib/clinical/records/extract"
import { RecordConflictError, RecordExistsError, RecordNotFoundError, editField, isRecordSlug, readRecord, saveRecord, type FieldChange, type Seen } from "@/lib/clinical/records/store"
import type { TrialRecord } from "@/lib/clinical/records/schema"
import { DESIGNS, type Design } from "@/lib/clinical/types"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const R = CLINICAL_COPY.records
const fail = (status: number, error: unknown) => Response.json({ error: error instanceof Error ? error.message : String(error) }, { status })
const ok = (result: unknown) => Response.json({ result }, { status: 200 })

type Term = { code: string; name: string }
/**
 * A record as the panel needs it: with the pack's names of the codes it is filed under, and the terms
 * it could be filed under instead. The panel is a client component and cannot read the pack itself.
 */
function view(record: TrialRecord | null, taxonomy: Taxonomy): { record: TrialRecord | null; names: Record<string, string>; filing: { conditions: Term[]; treatments: Term[] } } {
  if (!record) return { record, names: {}, filing: { conditions: [], treatments: [] } }
  const codes = new Set([record.conditionCode, ...record.arms.map((arm) => arm.treatmentCode)])
  const names = Object.fromEntries(taxonomy.nodes.filter((node) => codes.has(node.id)).map((node) => [node.id, node.name]))
  const terms = (type: "condition" | "treatment") => taxonomy.nodes.filter((node) => node.type === type).map((node) => ({ code: node.id, name: node.name })).sort((a, b) => a.name.localeCompare(b.name))
  return { record, names, filing: { conditions: terms("condition"), treatments: terms("treatment") } }
}

/**
 * GET ?slug=&key=: the stored record of a paper, or null. Never reads the paper or calls a model.
 * Two papers with one title share a slug: the record is given only to the paper it was read from (`key`
 * is that paper's key). A stored file that cannot be read is an error, not "no record".
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const slug = params.get("slug") ?? ""
  const key = params.get("key") ?? ""
  if (!isRecordSlug(slug)) return fail(400, R.badSlug)
  if (!key) return fail(400, R.badRequest)
  try {
    const { stored, record } = await readRecord(await getServerVault(), slug)
    if (stored && !record) return fail(409, R.unreadable)
    return ok(view(record && record.paperKey === key ? record : null, (await loadPsychiatryPack()).taxonomy))
  } catch (error) { return fail(500, error) }
}

/**
 * POST {paper, design}: reads the paper (full text when it can be had), extracts, checks and stores its trial record.
 * A paper that already has a record gets that record back, untouched: a second extraction must not overwrite values a
 * person confirmed or corrected. A file stored under the paper's slug that is another paper's record, or that cannot be
 * read, is answered with 409 before the paper is read or a model is called.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { paper, design } = (await request.json()) as { paper: PaperRecord; design: Design }
    if (!paper || typeof paper.title !== "string" || !(DESIGNS as readonly string[]).includes(design)) return fail(400, R.badRequest)
    const vault = await getServerVault()
    const pack = await loadPsychiatryPack()
    const slug = paperSlug(paper)
    /** What is stored under the slug, as an answer; null when nothing is. */
    const stored = async (): Promise<Response | null> => {
      const found = await readRecord(vault, slug)
      if (!found.stored) return null
      if (!found.record) return fail(409, R.unreadable)
      return found.record.paperKey === paperKey(paper) ? ok(view(found.record, pack.taxonomy)) : fail(409, R.otherPaper)
    }
    const existing = await stored()
    if (existing) return existing
    const overrides = getSkillTestOverrides()
    const acquired = await readPaperTextPatiently(() => loadPaperText(vault, paper, { fetchFn: overrides.fetchFn }))
    const record = await extractTrialRecord(vault, paper, {
      design, text: `${paper.title}\n\n${acquired.access === "full-text" ? acquired.text : paper.abstract ?? ""}`, source: PaperTextInfoSchema.parse(acquired),
      taxonomy: pack.taxonomy, settings: await loadSettings(vault), providerOverride: overrides.providerOverride,
    })
    try {
      await saveRecord(vault, record)
    } catch (error) {
      // Stored by another request while this one was reading the paper: answer with what is there.
      if (error instanceof RecordExistsError) return (await stored()) ?? fail(409, R.unreadable)
      throw error
    }
    return ok(view(record, pack.taxonomy))
  } catch (error) {
    return fail(error instanceof NotATrialError ? 422 : 500, error)
  }
}

/**
 * PATCH {slug, path, change, expected}: confirms or corrects one value, or changes what the condition or an arm is
 * filed under. Addressed by slug: the reader got the record from a GET that matched their paper.
 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const { slug, path, change, expected } = (await request.json()) as { slug: string; path: string; change: FieldChange; expected: Seen }
    if (typeof slug !== "string" || !isRecordSlug(slug)) return fail(400, R.badSlug)
    if (typeof path !== "string" || !change || !expected) return fail(400, R.badRequest)
    const { taxonomy } = await loadPsychiatryPack()
    return ok(view(await editField(await getServerVault(), slug, path, change, expected, { taxonomy }), taxonomy))
  } catch (error) {
    return fail(error instanceof RecordNotFoundError ? 404 : error instanceof RecordConflictError ? 409 : 400, error)
  }
}
