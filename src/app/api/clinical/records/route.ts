import { getSkillTestOverrides } from "@/lib/server/skill-route"
import { getServerVault } from "@/lib/server/vault"
import { loadSettings } from "@/lib/llm/settings"
import { loadPaperText } from "@/lib/papers/full-text"
import { PaperTextInfoSchema } from "@/lib/papers/text-contract"
import type { PaperRecord } from "@/lib/papers/types"
import { paperSlug } from "@/lib/wiki/authoring"
import { readPaperTextPatiently } from "@/lib/clinical/digest/paper-text"
import { loadPsychiatryPack } from "@/lib/clinical/pack/load"
import { NotATrialError, extractTrialRecord } from "@/lib/clinical/records/extract"
import { RecordConflictError, RecordNotFoundError, editField, isRecordSlug, loadRecord, saveRecord, type FieldChange } from "@/lib/clinical/records/store"
import type { NumberField, TextField } from "@/lib/clinical/records/schema"
import { DESIGNS, type Design } from "@/lib/clinical/types"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const fail = (status: number, error: unknown) => Response.json({ error: error instanceof Error ? error.message : String(error) }, { status })
const ok = (result: unknown) => Response.json({ result }, { status: 200 })

/** GET ?slug=: the stored record of a paper, or null. Never reads the paper or calls a model. */
export async function GET(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get("slug") ?? ""
  if (!isRecordSlug(slug)) return fail(400, CLINICAL_COPY.records.badSlug)
  try { return ok({ record: await loadRecord(await getServerVault(), slug) }) } catch (error) { return fail(500, error) }
}

/**
 * POST {paper, design}: reads the paper (full text when it can be had), extracts, checks and stores its trial record.
 * A paper that already has a record gets that record back, untouched: a second extraction must not overwrite values a person confirmed or corrected.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { paper, design } = (await request.json()) as { paper: PaperRecord; design: Design }
    if (!paper || typeof paper.title !== "string" || !(DESIGNS as readonly string[]).includes(design)) return fail(400, CLINICAL_COPY.records.badRequest)
    const vault = await getServerVault()
    const existing = await loadRecord(vault, paperSlug(paper))
    if (existing) return ok({ record: existing })
    const overrides = getSkillTestOverrides()
    const pack = await loadPsychiatryPack()
    const acquired = await readPaperTextPatiently(() => loadPaperText(vault, paper, { fetchFn: overrides.fetchFn }))
    const record = await extractTrialRecord(vault, paper, {
      design, text: `${paper.title}\n\n${acquired.access === "full-text" ? acquired.text : paper.abstract ?? ""}`, source: PaperTextInfoSchema.parse(acquired),
      taxonomy: pack.taxonomy, settings: await loadSettings(vault), providerOverride: overrides.providerOverride,
    })
    await saveRecord(vault, record)
    return ok({ record })
  } catch (error) {
    return fail(error instanceof NotATrialError ? 422 : 500, error)
  }
}

/** PATCH {slug, path, change, expected}: confirms or corrects one value. */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const { slug, path, change, expected } = (await request.json()) as { slug: string; path: string; change: FieldChange; expected: TextField | NumberField }
    if (typeof slug !== "string" || !isRecordSlug(slug)) return fail(400, CLINICAL_COPY.records.badSlug)
    if (typeof path !== "string" || !change || !expected) return fail(400, CLINICAL_COPY.records.badRequest)
    return ok({ record: await editField(await getServerVault(), slug, path, change, expected) })
  } catch (error) {
    return fail(error instanceof RecordNotFoundError ? 404 : error instanceof RecordConflictError ? 409 : 400, error)
  }
}
