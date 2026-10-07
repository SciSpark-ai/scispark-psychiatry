import { PAGE_TYPES, type PageType } from "../vault/types"

/** Types that stay in code (so upstream cherry-picks apply cleanly) but are off in the clinical default schema. */
export const DISABLED_PAGE_TYPES: readonly PageType[] = ["method", "finding", "comparison", "idea"]

/** Types the clinical edition does not list (decision D57): the entities that matter are taxonomy entries, not pages. Pages of these types that exist stay on disk. */
export const HIDDEN_PAGE_TYPES: readonly PageType[] = ["concept", "topic", "author", ...DISABLED_PAGE_TYPES]

export const enabledPageTypes = (): PageType[] => PAGE_TYPES.filter((type) => !DISABLED_PAGE_TYPES.includes(type))

/** Decision D14: author pages are never created automatically. */
export const AUTO_AUTHOR_PAGES = false
