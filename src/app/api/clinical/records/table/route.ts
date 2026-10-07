import { getServerVault } from "@/lib/server/vault"
import { loadPsychiatryPack } from "@/lib/clinical/pack/load"
import { listRecords } from "@/lib/clinical/records/store"
import { buildTreatmentTable } from "@/lib/clinical/records/table"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

/** GET ?condition=<taxonomy id>: the treatment-options table of a condition, counted from the stored trial records. No model. */
export async function GET(request: Request): Promise<Response> {
  const code = new URL(request.url).searchParams.get("condition") ?? ""
  if (!/^[a-z0-9][a-z0-9-]*$/.test(code)) return Response.json({ error: CLINICAL_COPY.records.badRequest }, { status: 400 })
  try {
    const pack = await loadPsychiatryPack()
    const node = pack.taxonomy.nodes.find((entry) => entry.id === code && entry.type === "condition")
    if (!node) return Response.json({ error: CLINICAL_COPY.records.noSuchCondition }, { status: 404 })
    const rows = buildTreatmentTable(await listRecords(await getServerVault()), pack.taxonomy, code)
    return Response.json({ result: { condition: { code, name: node.name }, rows } }, { status: 200 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
