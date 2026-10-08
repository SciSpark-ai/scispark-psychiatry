"use client"

import { useEffect, useId, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { EmptyState } from "@/components/ui/EmptyState"
import { Tree } from "@/components/wiki/Tree"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { listNotesRemote } from "@/lib/clinical/notes/client"
import { LIBRARY_TABS, libraryHref, libraryTabOf, type LibraryTab } from "@/lib/clinical/notes/href"
import type { Bundle } from "@/lib/vault/bundle"
import type { PageType } from "@/lib/vault/types"
import { NotesTab } from "./NotesTab"

const L = CLINICAL_COPY.notes.library
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
/** As the tabs of the Evidence view: muted, and the chosen one semibold over a line of the accent. */
const TAB = `border-b-2 border-transparent px-3 py-2 text-[15px] leading-5 text-muted-text transition-colors hover:text-espresso ${FOCUS}`
const TAB_ON = `border-b-2 border-accent-ink px-3 py-2 text-[15px] font-semibold leading-5 text-espresso ${FOCUS}`
/** The type of page a tab lists from the bundle. The notes are not listed from it: they have their own list. */
const PAGE_TYPE: Record<Exclude<LibraryTab, "notes">, PageType> = { papers: "paper", projects: "project", chats: "query" }

/**
 * The Library view (`/wiki?view=all`): a row of tabs (papers, notes, projects, saved chats), each with how many it
 * holds, and under it what the chosen one lists. The tab is kept in the address; Papers is the one an address
 * without a tab opens on.
 */
export function LibraryTabs({ bundle }: { bundle: Bundle }) {
  const router = useRouter()
  const params = useSearchParams()
  const id = useId()
  const tab = libraryTabOf(params.get("tab"))
  const [notes, setNotes] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    // A count that cannot be had is left out; the Notes tab itself says why the notes cannot be read.
    listNotesRemote().then((list) => { if (!cancelled) setNotes(list.length) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const pages = [...bundle.pages.values()]
  const countOf = (entry: LibraryTab) => (entry === "notes" ? notes : pages.filter((page) => page.frontmatter.type === PAGE_TYPE[entry]).length)

  return (
    <section>
      <div role="tablist" aria-label={L.tabsLabel} className="flex flex-wrap gap-1 border-b border-border-warm">
        {LIBRARY_TABS.map((entry) => {
          const count = countOf(entry)
          return (
            <button key={entry} type="button" role="tab" id={`${id}-${entry}`} data-tab={entry} aria-selected={entry === tab} aria-controls={`${id}-panel`}
              onClick={() => router.replace(libraryHref(entry))} className={entry === tab ? TAB_ON : TAB}>
              {L.tabs[entry]}{count !== null && <span className="font-normal text-muted-text"> {count}</span>}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="pt-5">
        {tab === "notes" ? <NotesTab />
          : tab === "papers" && countOf("papers") === 0 ? <EmptyState title={L.noPapers} hint={L.noPapersHint} action={<Link href="/papers" className="text-[13px] text-accent-ink hover:text-accent-ink-hover">{L.searchPapers}</Link>} />
          : <Tree bundle={bundle} types={[PAGE_TYPE[tab]]} />}
      </div>
    </section>
  )
}
