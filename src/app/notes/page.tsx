import { Suspense } from "react"
import { NotesList } from "@/components/clinical/NotesList"
import { COMPANION_CLEARANCE } from "@/components/layout/companion-clearance"
import { LoadingState } from "@/components/ui/LoadingState"
import { PageHeader } from "@/components/ui/PageHeader"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

// Clinical edition: the reader's notes, with their search and filters kept in the address (/notes?q=&condition=&kind=&treatment=).
export default function NotesPage() {
  return (
    <div className={`p-7 ${COMPANION_CLEARANCE}`}>
      <PageHeader title={CLINICAL_COPY.nav.notes} />
      <Suspense fallback={<LoadingState label={CLINICAL_COPY.notes.list.loading} />}>
        <NotesList />
      </Suspense>
    </div>
  )
}
