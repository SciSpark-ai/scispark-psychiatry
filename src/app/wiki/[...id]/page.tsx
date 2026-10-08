"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import { serializeDocument } from "@/lib/vault/frontmatter"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref, resolveWikiRouteId } from "@/lib/wiki/href"
import { isDeletablePage, backlinkCount, deletePage } from "@/lib/wiki/delete"
import type { VaultStorage } from "@/lib/vault/storage"
import type { WikiPage } from "@/lib/vault/types"
import { PageEditor } from "@/components/wiki/PageEditor"
import { clinicalFence } from "@/components/clinical/clinical-fence"
import { CLINICAL_COPY } from "@/lib/clinical/copy"
import { evidenceHref } from "@/lib/clinical/evidence/href"
import { conditionCodeOf } from "@/lib/clinical/records/notes"
import { NotePage } from "@/components/clinical/NotePage"
import { libraryHref, noteIdOf } from "@/lib/clinical/notes/href"
import { isUntitledStored } from "@/lib/clinical/notes/links"
import { Backlinks } from "@/components/wiki/Backlinks"
import DeleteConfirmCard from "@/components/wiki/DeleteConfirmCard"

export default function WikiPageDetail() {
  const params = useParams()
  const router = useRouter()
  // Next 16 catch-all ([...id]): params.id is always string[] for a
  // required catch-all segment. Joined back into URL segments, then resolved
  // to the vault-relative bundle id (e.g. "wiki/concepts/foo") via the
  // shared helper — this accepts BOTH the canonical URL ("concepts/foo")
  // and legacy doubled links ("wiki/concepts/foo"), per C5.
  const rawId = params?.id
  const joined = Array.isArray(rawId) ? rawId.join("/") : (rawId ?? "")
  const id = resolveWikiRouteId(joined)

  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  // undefined = still loading, null = loaded but not found
  const [page, setPage] = useState<WikiPage | null | undefined>(undefined)
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const vault = await getOpenVault()
    setStorage(vault)
    const b = await loadBundle(vault)
    setBundle(b)
    const p = b.pages.get(id) ?? null
    setPage(p)
    setBody(p?.body ?? "")
  }, [id])

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        await load()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [load])

  // Legacy doubled links (/wiki/wiki/...) — settle on the canonical URL.
  useEffect(() => {
    if (joined.startsWith("wiki/")) router.replace(wikiHref(id))
  }, [joined, id, router])

  // A condition is read on the Evidence view, not in the editor: its page leads there.
  const conditionCode = page && page.frontmatter.type === "condition" ? conditionCodeOf(page) : null
  useEffect(() => {
    if (conditionCode) router.replace(evidenceHref({ condition: conditionCode }))
  }, [conditionCode, router])

  // A note is written on its own page, which saves itself: the editor and the Backlinks column are not drawn for it.
  const noteId = page && page.frontmatter.type === "note" ? noteIdOf(page.id) : null

  const handleSave = async () => {
    if (!storage || !page) return
    try {
      const updatedFrontmatter = { ...page.frontmatter, updated: new Date().toISOString().slice(0, 10) }
      const content = serializeDocument(updatedFrontmatter, body)
      await storage.write(page.path, content)
      setStatus("Saved")
      await load()
      setTimeout(() => setStatus(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Memoized so DeleteConfirmCard's Esc-keydown effect (which depends on
  // onCancel) doesn't tear down and re-add its window listener on every
  // keystroke of the body editor re-rendering this component.
  const handleCancelDelete = useCallback(() => setConfirmingDelete(false), [])

  const handleConfirmDelete = async () => {
    if (!storage || !page) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await deletePage(storage, page)
      router.push(noteId ? libraryHref("notes") : "/wiki")
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  if (page === undefined || conditionCode) {
    return <div className="p-7 text-[14px] text-muted-text">Loading…</div>
  }

  if (page === null) {
    return (
      <div className="p-7">
        <p className="text-[14px] text-espresso">Page not found: {id}</p>
        {error && <p className="mt-2 text-[13px] text-red-600">Error: {error}</p>}
        <Link href="/wiki" className="mt-3 inline-block text-[14px] text-accent-ink hover:underline">
          ← Back to wiki
        </Link>
      </div>
    )
  }

  if (noteId) {
    return (
      <NotePage
        key={noteId}
        id={noteId}
        untitled={isUntitledStored(page.frontmatter.title)}
        onDelete={() => {
          setDeleteError(null)
          setConfirmingDelete(true)
        }}
        confirm={confirmingDelete ? (
          <DeleteConfirmCard
            title={displayTitle(String(page.frontmatter.title ?? ""))}
            backlinks={bundle ? backlinkCount(bundle, page.id) : 0}
            busy={deleteBusy}
            error={deleteError}
            onConfirm={handleConfirmDelete}
            onCancel={handleCancelDelete}
          />
        ) : null}
      />
    )
  }

  const fm = page.frontmatter
  const slug = page.id.split("/").pop() ?? page.id
  const canDelete = isDeletablePage(page)
  // A condition page belongs to the Evidence view; every other page is listed in the Library.
  const back = fm.type === "condition"
    ? { href: "/wiki", label: CLINICAL_COPY.nav.evidence }
    : { href: "/wiki?view=all", label: CLINICAL_COPY.nav.library }

  return (
    <div className="p-7 flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 mb-3">
          <Link href={back.href} className="text-[13px] text-muted-text hover:text-espresso">
            {CLINICAL_COPY.nav.backTo(back.label)}
          </Link>
          <div className="flex items-center gap-3">
            {status && <span className="text-[13px] text-accent-ink">{status}</span>}
            {error && <span className="text-[13px] text-red-600">{error}</span>}
            {fm.type === "paper" && (
              <Link href={`/paper/${slug}`} className="text-[13px] text-accent-ink hover:underline">
                Open paper page →
              </Link>
            )}
            <button
              onClick={handleSave}
              className="text-[13px] text-on-accent bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium transition-colors"
            >
              Save
            </button>
            {canDelete && (
              <button
                onClick={() => {
                  setDeleteError(null)
                  setConfirmingDelete(true)
                }}
                className="text-[13px] text-espresso hover:text-red-600 rounded-pill border border-border-warm px-4 py-1.5 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {confirmingDelete && (
          <DeleteConfirmCard
            title={displayTitle(String(fm.title ?? ""))}
            backlinks={bundle ? backlinkCount(bundle, page.id) : 0}
            busy={deleteBusy}
            error={deleteError}
            onConfirm={handleConfirmDelete}
            onCancel={handleCancelDelete}
          />
        )}

        <h1 className="font-heading text-[24px] text-espresso tracking-heading">{displayTitle(String(fm.title ?? ""))}</h1>

        <div className="flex flex-wrap items-center gap-2 mt-3 mb-5">
          <span className="text-[12px] uppercase tracking-wide px-2 py-0.5 rounded-badge bg-card-surface text-espresso">
            {fm.type}
          </span>
          {fm.type === "idea" && typeof fm.status === "string" && (
            <span className="text-[12px] uppercase tracking-wide px-2 py-0.5 rounded-badge bg-card-surface text-espresso">
              {fm.status}
            </span>
          )}
          {fm.type === "idea" && typeof fm.depth === "string" && (
            <span className="text-[12px] uppercase tracking-wide px-2 py-0.5 rounded-badge bg-light-surface border border-border-warm text-muted-text">
              {fm.depth}
            </span>
          )}
          {fm.tags.map((tag) => (
            <span key={tag} className="text-[12px] px-2 py-0.5 rounded-badge bg-light-surface border border-border-warm text-muted-text">
              #{tag}
            </span>
          ))}
          <span className="text-[12px] text-muted-text">updated {fm.updated}</span>
          <span className="text-[12px] text-muted-text">
            {fm.sources.length} source{fm.sources.length === 1 ? "" : "s"}
          </span>
        </div>

        {bundle && <PageEditor key={page?.id} value={body} onChange={setBody} bundle={bundle} fence={clinicalFence} initialTab={page?.frontmatter.type === "condition" ? "preview" : "edit"} />}
      </div>

      <aside className="w-full lg:w-64 flex-shrink-0">
        <h2 className="text-[13px] font-medium text-espresso tracking-body mb-2">Backlinks</h2>
        {bundle && <Backlinks bundle={bundle} id={id} />}
      </aside>
    </div>
  )
}
