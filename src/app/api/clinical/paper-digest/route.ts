import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { getServerVault } from "@/lib/server/vault"
import { loadSettings } from "@/lib/llm/settings"
import { loadPaperText } from "@/lib/papers/full-text"
import { PaperTextInfoSchema } from "@/lib/papers/text-contract"
import { paperSlug } from "@/lib/wiki/authoring"
import { readPaperTextPatiently } from "@/lib/clinical/digest/paper-text"
import { generatePaperDigest, loadCachedPaperDigest, type StoredPaperDigest } from "@/lib/clinical/digest/paper"
import type { PaperRecord } from "@/lib/papers/types"

/** GET ?slug=: the stored clinical digest of a paper, or null. Never reads the paper or calls a model. */
export async function GET(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get("slug")
  if (!slug) return Response.json({ error: "slug is required" }, { status: 400 })
  try {
    return Response.json({ result: { digest: await loadCachedPaperDigest(await getServerVault(), slug) } }, { status: 200 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/**
 * POST {paper}: the clinical digest of a paper, written from the full text when upstream's reader can
 * get it and from the abstract otherwise. A digest already written from the full text is returned as
 * it is; one written from the abstract is written again only if the full text can now be read.
 */
export const POST = jsonSkillRoute<{ paper: PaperRecord }, { digest: StoredPaperDigest; fromCache: boolean }>(async ({ paper }, vault) => {
  const cached = await loadCachedPaperDigest(vault, paperSlug(paper))
  if (cached?.source.access === "full-text") return { digest: cached, fromCache: true }
  const overrides = getSkillTestOverrides()
  const acquired = await readPaperTextPatiently(() => loadPaperText(vault, paper, { fetchFn: overrides.fetchFn }))
  const { digest, fromCache } = await generatePaperDigest(vault, paper, {
    fullText: acquired.access === "full-text" ? acquired.text : undefined,
    source: PaperTextInfoSchema.parse(acquired),
    settings: await loadSettings(vault),
    providerOverride: overrides.providerOverride,
  })
  return { digest, fromCache }
})
