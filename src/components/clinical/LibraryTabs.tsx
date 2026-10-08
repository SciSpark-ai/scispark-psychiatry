"use client"

import { useEffect, useId, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { EmptyState } from "@/components/ui/EmptyState"
import { Tree } from "@/components/wiki/Tree"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { LIBRARY_TABS, libraryHref, libraryTabOf, movedNotesHref, type LibraryTab } from "@/lib/clinical/notes/href"
import { loadReadLater } from "@/lib/clinical/readlater/store"
import type { Bundle } from "@/lib/vault/bundle"
import { getOpenVault } from "@/lib/vault/get-vault"
import type { PageType } from "@/lib/vault/types"
import { FeedHistory } from "./FeedHistory"
import { ReadLaterList } from "./ReadLaterList"

const L = CLINICAL_COPY.notes.library
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
/** As the tabs of the Evidence view: muted, and the chosen one semibold over a line of the accent. */
const TAB = `border-b-2 border-transparent px-3 py-2 text-[15px] leading-5 text-muted-text transition-colors hover:text-espresso ${FOCUS}`
const TAB_ON = `border-b-2 border-accent-ink px-3 py-2 text-[15px] font-semibold leading-5 text-espresso ${FOCUS}`
/** The type of page a tab lists from the bundle. Read later and History are not pages: each has its own list. */
const PAGE_TYPE: Partial<Record<LibraryTab, PageType>> = { papers: "paper", chats: "query" }

/**
 * The Library view (`/wiki?view=all`), what the reader kept: a row of tabs (papers, read later, history, saved chats)
 * and under it what the chosen one lists. The tab is kept in the address; Papers is the one an address without a tab
 * opens on. Papers and Saved chats are counted from the bundle, Read later from its own list; History has no count.
 * The notes were a tab here once: such an address leads to the Notes page with the same filters.
 */
export function LibraryTabs({ bundle }: { bundle: Bundle }) {
  const router = useRouter()
  const params = useSearchParams()
  const id = useId()
  const tab = libraryTabOf(params.get("tab"))
  const moved = movedNotesHref(params)
  const [later, setLater] = useState<number | null>(null)

  useEffect(() => {
    if (moved !== null) router.replace(moved)
  }, [moved, router])

  useEffect(() => {
    let cancelled = false
    // A count that cannot be had is left out; the tab itself says why its list cannot be read.
    getOpenVault().then(loadReadLater).then((list) => { if (!cancelled) setLater(list.length) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (moved !== null) return null

  const pages = [...bundle.pages.values()]
  const countOf = (entry: LibraryTab): number | null => {
    const type = PAGE_TYPE[entry]
    if (type) return pages.filter((page) => page.frontmatter.type === type).length
    return entry === "read-later" ? later : null
  }
  const type = PAGE_TYPE[tab]

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
        {tab === "read-later" ? <ReadLaterList embedded />
          : tab === "history" ? <FeedHistory embedded />
          : tab === "papers" && countOf("papers") === 0 ? <EmptyState title={L.noPapers} hint={L.noPapersHint} action={<Link href="/papers" className="text-[13px] text-accent-ink hover:text-accent-ink-hover">{L.searchPapers}</Link>} />
          : type ? <Tree bundle={bundle} types={[type]} /> : null}
      </div>
    </section>
  )
}
