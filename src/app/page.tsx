import { ClinicalHome } from "@/components/clinical/ClinicalHome"

// Clinical edition: Home is the recall-first literature feed. Upstream's Home lives on, unrouted,
// at src/components/feed/UpstreamHome.tsx so that upstream changes to it still merge cleanly.
export default function HomePage() {
  return <ClinicalHome />
}
