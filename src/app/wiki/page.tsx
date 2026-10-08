"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import { reviewCount } from "@/lib/wiki/review-queue"
import { PageHeader } from "@/components/ui/PageHeader"
import { COMPANION_CLEARANCE } from "@/components/layout/companion-clearance"
import { LoadingState } from "@/components/ui/LoadingState"
import { EvidencePage } from "@/components/clinical/EvidencePage"
import { LibraryTabs } from "@/components/clinical/LibraryTabs"
import { CLINICAL_COPY } from "@/lib/clinical/copy"

const N = CLINICAL_COPY.nav

function WikiIndexPageContent() {
  const searchParams = useSearchParams()
  const view = searchParams.get("view") === "all" ? "all" : "evidence"

  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [inboxCount, setInboxCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const vault = await getOpenVault()
    const [b, n] = await Promise.all([loadBundle(vault), reviewCount(vault)])
    setBundle(b)
    setInboxCount(n)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refresh()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  return (
    <div className={`p-7 ${COMPANION_CLEARANCE}`}>
      <PageHeader
        title={view === "all" ? N.library : N.evidence}
        actions={
          // The Evidence view has no header buttons: its controls are in its own row of tabs.
          view === "all" ? (
            // Read later and History are in the sidebar; a note is made from the Notes tab.
            <Link
              href="/wiki/inbox"
              className="text-[13px] text-muted-text hover:text-espresso tracking-body px-3 py-1.5 rounded-pill border border-border-warm"
            >
              Review inbox ({inboxCount})
            </Link>
          ) : undefined
        }
      />

      {error && (
        <p className="mt-3 text-[13px] text-red-600">Error: {error}</p>
      )}

      {!bundle ? (
        <LoadingState label="Loading vault…" />
      ) : view === "all" ? (
        <LibraryTabs bundle={bundle} />
      ) : (
        <EvidencePage />
      )}

      {bundle && bundle.errors.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[16px] font-heading text-espresso tracking-heading-card mb-3">Vault errors</h2>
          <ul className="space-y-1.5">
            {bundle.errors.map((err, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <span className="flex-shrink-0 text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-badge bg-card-surface text-muted-text">
                  {err.kind}
                </span>
                <span className="text-espresso">
                  {err.path}: {err.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default function WikiIndexPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading vault…" />}>
      <WikiIndexPageContent />
    </Suspense>
  )
}
