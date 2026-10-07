import { getServerVault } from "@/lib/server/vault"
import { loadPsychiatryPack } from "@/lib/clinical/pack/load"
import { createConditionPage } from "@/lib/clinical/records/condition-page"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

/** GET: the conditions of the pack, for the control that makes a condition page. */
export async function GET(): Promise<Response> {
  try {
    const pack = await loadPsychiatryPack()
    const conditions = pack.taxonomy.nodes.filter((node) => node.type === "condition").map((node) => ({ code: node.id, name: node.name })).sort((a, b) => a.name.localeCompare(b.name))
    return Response.json({ result: { conditions } }, { status: 200 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

/** POST {code}: makes the condition's page if it is not there, and says where it is. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { code } = (await request.json()) as { code: string }
    const pack = await loadPsychiatryPack()
    if (typeof code !== "string" || !pack.taxonomy.nodes.some((node) => node.id === code && node.type === "condition")) return Response.json({ error: CLINICAL_COPY.records.noSuchCondition }, { status: 404 })
    return Response.json({ result: await createConditionPage(await getServerVault(), pack.taxonomy, code) }, { status: 200 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
