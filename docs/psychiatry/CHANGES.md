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
