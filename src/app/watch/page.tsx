import { WatchListEditor } from "@/components/clinical/WatchListEditor"
import { loadPsychiatryPack } from "@/lib/clinical/pack/load"

// Reads the shipped pack from disk on every request, so the datalists follow the pack in the app folder.
export const dynamic = "force-dynamic"

export default async function WatchPage() {
  const pack = await loadPsychiatryPack()
  const names = (type: "condition" | "treatment") => pack.taxonomy.nodes.filter((node) => node.type === type).map((node) => node.name)
  return <WatchListEditor suggestions={{ conditions: names("condition"), treatments: names("treatment"), populations: pack.onboarding.populations }} />
}
