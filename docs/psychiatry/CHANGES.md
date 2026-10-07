# SciSpark Psychiatry — changes to upstream files

Upstream: https://github.com/SciSpark-ai/scispark_wiki, forked at commit 435afcd (2026-10-04), Apache-2.0.
Every edit to a file that exists upstream is one row here (spec §4.2). New files in `src/lib/clinical/`,
`src/components/clinical/`, `src/app/watch/`, `src/app/api/clinical/`, `packs/` and `docs/psychiatry/` are ours and need no row.

Baseline before any change: 275 test files (plus 7 skipped), 2710 tests passing (plus 19 skipped) (`npx vitest run`).

| File | Change | Why (spec) | Task |
|---|---|---|---|
| `package.json` | name | repository identity (D24) | 1 |
| src/lib/vault/types.ts | add `condition` to PAGE_TYPES | §7.3 | 5 |
| src/lib/vault/scaffold.ts | `condition` directory; schema.md lists enabled types only | §7.2 | 5 |
| src/lib/wiki/schema-routing.ts | DEFAULT_ROUTING = clinical default (no method/finding/comparison/idea; adds condition) | §7.2 | 5 |
| src/lib/vault/index-builder.ts, src/components/wiki/Tree.tsx, src/components/viz/FilterBar.tsx, src/lib/wiki/dashboard.ts | `condition` label / section | §7.2 (4) | 5 |
| src/lib/skills/ingest.ts | no automatic author skeleton pages | D14 | 5 |
| src/lib/vault/__tests__/scaffold.test.ts, src/lib/skills/__tests__/ingest.test.ts | expectations follow the clinical default schema and D14 | F2 | 5 |
| src/app/layout.tsx | page title and description from the copy file | §8.3 | 6 |
| src/lib/papers/pubmed.ts | add enumeratePubmed; efetch half of the search extracted | §6.8 enumeration, F1 | 8 |
| src/app/page.tsx | Home is ClinicalHome; upstream Home moved to components/feed/UpstreamHome.tsx | §8.2 | 17 |
| src/components/layout/Sidebar.tsx | Watch list added; Trending, Projects, Idea Spark, History hidden | D32 | 17 |
| src/components/layout/__tests__/Sidebar.test.tsx, src/app/__tests__/home-feed-notices.test.tsx | follow the above | D32 | 17 |
| src/lib/papers/pubmed.ts | `enumeratePubmed`: a deadline per request instead of one for the whole enumeration; batches already read are kept when a later batch fails (reported as truncated); `PubmedDeps.timeoutMs` | review of Slices 0–1, finding 1 | review |
| src/components/layout/Sidebar.tsx | the Watch list label comes from the copy file | §8.1, review finding 5 | review |
| src/app/globals.css | typeface: system sans-serif for headings and body, letter-spacing relaxed (colours and layout unchanged from upstream) | owner request 2026-10-06 (readability) | after first runs |
