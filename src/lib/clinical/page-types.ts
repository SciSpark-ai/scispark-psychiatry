import { PAGE_TYPES, type PageType } from "../vault/types"

/** Types that stay in code (so upstream cherry-picks apply cleanly) but are off in the clinical default schema. */
export const DISABLED_PAGE_TYPES: readonly PageType[] = ["method", "finding", "comparison", "idea"]

export const enabledPageTypes = (): PageType[] => PAGE_TYPES.filter((type) => !DISABLED_PAGE_TYPES.includes(type))

/** Decision D14: author pages are never created automatically. */
export const AUTO_AUTHOR_PAGES = false
