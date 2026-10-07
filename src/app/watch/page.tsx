import { WatchListEditor } from "@/components/clinical/WatchListEditor"
import { loadPsychiatryPack } from "@/lib/clinical/pack/load"

// Reads the shipped pack from disk on every request, so the datalists follow the pack in the app folder.
export const dynamic = "force-dynamic"

export default async function WatchPage() {
  const pack = await loadPsychiatryPack()
  const nodes = (type: "condition" | "treatment") => pack.taxonomy.nodes.filter((node) => node.type === type)
  const names = (type: "condition" | "treatment") => nodes(type).map((node) => node.name)
  // Other names the pack knows (synonyms, brand names), so that typing one of them is not taken for a slip.
  const aliases = (type: "condition" | "treatment") => nodes(type).flatMap((node) => [...node.synonyms, ...node.brands])
  return (
    <WatchListEditor suggestions={{
      conditions: names("condition"), treatments: names("treatment"), populations: pack.onboarding.populations,
      conditionAliases: aliases("condition"), treatmentAliases: aliases("treatment"),
    }} />
  )
}
