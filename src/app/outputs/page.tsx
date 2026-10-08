import { ProjectsList } from "@/components/projects/ProjectsList"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

// Clinical edition: what the reader makes out of papers and notes. For now, the projects; one opens at /projects/<id>.
export default function OutputsPage() {
  return <ProjectsList heading={CLINICAL_COPY.outputs.heading} intro={CLINICAL_COPY.outputs.intro} />
}
