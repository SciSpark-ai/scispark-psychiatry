import { getServerVault } from "@/lib/server/vault"
import { loadPsychiatryPack } from "@/lib/clinical/pack/load"
import { findNode } from "@/lib/clinical/pack/taxonomy"
import { readFindings } from "@/lib/clinical/evidence/file"
import { buildConditionEvidence, followedConditions } from "@/lib/clinical/evidence/build"
import { loadWatchEntries } from "@/lib/clinical/watch/store"
import { loadRouting } from "@/lib/wiki/schema-routing"
import { slugifyTitle } from "@/lib/wiki/authoring"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const fail = (status: number, error: unknown) => Response.json({ error: error instanceof Error ? error.message : String(error) }, { status })

/**
 * GET ?condition=<taxonomy id>: the evidence the feed has seen on that condition, built from the
 * stored findings. GET with no parameter: the conditions the reader follows. No model in either.
 */
export async function GET(request: Request): Promise<Response> {
  const code = new URL(request.url).searchParams.get("condition")
  if (code !== null && !/^[a-z0-9][a-z0-9-]*$/.test(code)) return fail(400, CLINICAL_COPY.evidence.badRequest)
  try {
    const vault = await getServerVault()
    const [pack, findings, routing] = await Promise.all([loadPsychiatryPack(), readFindings(vault), loadRouting(vault)])
    const now = new Date()
    if (code === null) {
      const entries = await loadWatchEntries(vault)
      const watched = entries.flatMap((entry) => [entry.condition, entry.condition2]).flatMap((name) => (name ? findNode(pack.taxonomy, name, "condition")?.id ?? [] : []))
      const dir = routing.condition ?? "wiki/conditions"
      const conditions = await Promise.all(followedConditions(findings, pack.taxonomy, watched, now).map(async (entry) => {
        const id = `${dir}/${slugifyTitle(entry.name)}`
        return { ...entry, pageId: (await vault.read(`${id}.md`)) !== null ? id : null }
      }))
      return Response.json({ result: { conditions } }, { status: 200 })
    }
    const paperDir = routing.paper ?? "wiki/papers"
    const saved = new Set((await vault.list(`${paperDir}/`)).filter((path) => path.endsWith(".md")).map((path) => path.slice(paperDir.length + 1, -3)))
    const evidence = buildConditionEvidence(findings, pack.taxonomy, code, { now, savedSlugs: saved })
    return evidence ? Response.json({ result: evidence }, { status: 200 }) : fail(404, CLINICAL_COPY.evidence.noSuchCondition)
  } catch (error) {
    return fail(500, error)
  }
}
