"use client"

import { useEffect, useState } from "react"
import { getOpenVault } from "@/lib/vault/get-vault"
import type { PaperRecord } from "@/lib/papers/types"
import { paperKey } from "@/lib/papers/types"
import type { CardDigest } from "@/lib/clinical/digest/card"
import { findCardDigest, findPaperCardInfo, type PaperCardInfo } from "@/lib/clinical/digest/lookup"

/** The AI headline and summary of the paper on the paper page, when the feed wrote one. */
export function useCardDigest(paper: PaperRecord | null): CardDigest | null {
  const [found, setFound] = useState<{ key: string; digest: CardDigest | null } | null>(null)
  const key = paper ? paperKey(paper) : null
  useEffect(() => {
    if (!paper || !key) return
    let cancelled = false
    void getOpenVault().then((vault) => findCardDigest(vault, paper)).then((digest) => { if (!cancelled) setFound({ key, digest }) }).catch(() => {})
    return () => { cancelled = true }
    // The record is the same paper for as long as its key is the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return found && found.key === key ? found.digest : null
}

/** The AI summary, the kind of study and the topic of the paper on the paper page. */
export function usePaperCardInfo(paper: PaperRecord | null): PaperCardInfo | null {
  const [found, setFound] = useState<{ key: string; info: PaperCardInfo } | null>(null)
  const key = paper ? paperKey(paper) : null
  useEffect(() => {
    if (!paper || !key) return
    let cancelled = false
    void getOpenVault().then((vault) => findPaperCardInfo(vault, paper)).then((info) => { if (!cancelled) setFound({ key, info }) }).catch(() => {})
    return () => { cancelled = true }
    // The record is the same paper for as long as its key is the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return found && found.key === key ? found.info : null
}
