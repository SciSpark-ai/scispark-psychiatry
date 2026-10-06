# SciSpark Psychiatry — changes to upstream files

Upstream: https://github.com/SciSpark-ai/scispark_wiki, forked at commit 435afcd (2026-10-04), Apache-2.0.
Every edit to a file that exists upstream is one row here (spec §4.2). New files in `src/lib/clinical/`,
`src/components/clinical/`, `src/app/watch/`, `src/app/api/clinical/`, `packs/` and `docs/psychiatry/` are ours and need no row.

Baseline before any change: 275 test files (plus 7 skipped), 2710 tests passing (plus 19 skipped) (`npx vitest run`).

| File | Change | Why (spec) | Task |
|---|---|---|---|
| `package.json` | name | repository identity (D24) | 1 |
