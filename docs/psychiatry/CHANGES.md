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
| src/app/globals.css | two colour tokens, `--clinical-benefit` and `--clinical-no-benefit` (light and dark), for the AI overview | owner request 2026-10-07 | after first runs |
| src/components/layout/Sidebar.tsx | the edition name "Psychiatry" as plain text under the unchanged SciSpark wordmark; Read later added to the navigation; the watch list is named "My topics" | owner request 2026-10-06 (D5 sub-brand) | after first runs |
| src/components/layout/__tests__/Sidebar.test.tsx | follows the above | owner request 2026-10-06 | after first runs |
| src/lib/papers/pubmed.ts | `enumeratePubmed` can be given a record store: it then fetches only the records not held and returns every match in PubMed's order (`PubmedDeps.records`) | owner request 2026-10-07 (search locally first) | after first runs |
| src/lib/papers/pubmed.ts, src/lib/papers/types.ts (+ pubmed.test.ts) | `PaperRecord.addedDate`: the day a record entered PubMed, read from its history, so a card can show it beside the publication date | owner decision 2026-10-07 | after first runs |
| src/components/paper/PaperHeader.tsx | optional `headline`: the AI headline becomes the heading and the paper's own title goes beneath it | owner request 2026-10-07 | after first runs |
| src/app/paper/[key]/page.tsx | the paper page shows the feed's AI headline and summary, and the abstract by section with readable labels | owner request 2026-10-07 | after first runs |
| src/app/paper/[key]/page.tsx | upstream's "At a glance" panel (`PaperMeta`) is not shown; the AI summary and its tags take its place | owner decision 2026-10-07 | after first runs |
| src/app/paper/[key]/page.tsx | the abstract is an always-open section above the digest, no longer a fold under it | owner decision 2026-10-07 | after first runs |
| src/app/paper/[key]/page.tsx | the clinical nine-item digest (`ClinicalPaperDigest`) is shown in place of upstream's prose digest and its section links | owner decision 2026-10-07 | after first runs |
| src/app/paper/[key]/page.tsx | the digest button is in the top row; the digest, once written, sits above the abstract; the right rail is always shown and lists the page's parts (`ClinicalPaperNav`) | owner decision 2026-10-07 | after first runs |
| src/app/paper/[key]/page.tsx | `ClinicalPaperHeader` (kind of study, topic, journal and dates on their own line, folded author list, links to DOI and PubMed) is used in place of `PaperHeader` | owner request 2026-10-07 | after first runs |
| src/components/paper/PaperActions.tsx | optional `digestAction` prop: the clinical digest's button is shown in place of "Generate digest" | owner decision 2026-10-07 | after first runs |
| src/components/paper/__tests__/PaperAutoEnrich.test.tsx | the "restores a digest on page load" test now expects the clinical digest, since the prose digest is no longer on the page | owner decision 2026-10-07 | after first runs |
| src/components/paper/__tests__/PaperAutoEnrich.test.tsx | follows the above: no "At a glance" heading after the automatic enrich | owner decision 2026-10-07 | after first runs |
| src/lib/text.ts, src/lib/review/acquisition.ts, src/lib/papers/full-text.ts (+ tests) | a long full text keeps its beginning and its end (`headAndTail`) instead of only its beginning; PubMed Central XML is read with the statements after the body (funding, conflicts), without the reference list | owner decision 2026-10-07 | after first runs |
| src/lib/wiki/review-queue.ts, src/app/wiki/inbox/page.tsx | a review kind `extraction-review` with a `paperSlug`, its label and a link to the paper page | spec 7.12 | Slice 3 |
| src/app/paper/[key]/page.tsx | the trial-data panel (`ClinicalTrialRecord`) under the digest, and its link in the side navigation: added in Slice 3, then taken off the page again by decision D56 (the component, hook, routes and store stay, unused by the page) | spec 7.7, 7.12; decision D56 | Slice 3 |
| src/components/paper/PaperActions.tsx, src/app/paper/[key]/page.tsx | optional `hideIngest` prop; the paper page does not offer "Add to knowledge base" | decision D57 | Slice 3 |
| src/components/wiki/markdown-preview.tsx (+ test) | `renderMarkdown` takes an optional `fence` callback that may draw a fenced block; without it, or when it declines, the code block is drawn as before | spec 7.6, 7.9 | Slice 3 |
| src/components/wiki/PageEditor.tsx, src/app/wiki/[...id]/page.tsx | `fence` and `initialTab` props; a condition page opens on its preview with the evidence table drawn | spec 7.6 | Slice 3 |
| src/app/wiki/page.tsx (+ its test's mocks) | the "New condition page" control beside "New note" | decision D19, spec 7.9 | Slice 3 |
| src/lib/papers/resolve.ts (+ test) | `resolvePaperBySlug` has a last fallback: the paper kept in a stored trial record (`records/<slug>.json`), so the links from the treatment-options table and the review inbox to `/paper/<slug>` still open once the paper has left the feed cache | spec 7.6, 7.12; final review I6 | Slice 3 |
| src/lib/papers/resolve.ts (+ test) | one more last fallback: a paper only the findings store still knows opens from its finding | spec D54 | Slice 3 |
| src/app/wiki/page.tsx (+ its test) | the page is "Evidence" (default: `ConditionHome`, the conditions the reader follows, in place of the dashboard of stats, shelves and type sections) or "Library" (`?view=all`: the tree, with links to Read later and History); the Dashboard / All pages toggle is removed; "New condition page" on Evidence only | decision D53; owner amendments A1, A2 2026-10-07 | Slice 3 |
| src/components/wiki/Tree.tsx (+ test) | concept, topic and author pages are not listed | decision D57 | Slice 3 |
| src/components/layout/Sidebar.tsx (+ test) | the rail is one group of five without headings (What's new, Evidence, Library, My topics, Chat); Graph, Read later and History leave it; Evidence and Library told apart by `?view=all`; the review-count badge moves to Evidence; "Sparky" reads "Chat" here only | owner amendments A1, A4 2026-10-07 | Slice 3 |
| src/lib/papers/__tests__/resolve.test.ts | the findings file written by the "opens from its finding" test is version 2, the version the store now reads | final review F1 | Slice 3 |
| src/app/wiki/[...id]/page.tsx (+ a new test) | the link back reads "← Evidence" (to `/wiki`) on a condition page and "← Library" (to `/wiki?view=all`) on any other page, in place of "← Wiki"; wording from `CLINICAL_COPY.nav` | final review M5; owner amendments A1, A2 | Slice 3 |
| src/app/wiki/page.tsx (+ its test's mock) | the default view draws `EvidencePage` (the followed conditions as tabs; under one, "Evidence summary" and "Notes"; condition, scope, period and inner tab kept in the address) in place of `ConditionHome`, which is deleted; `?view=all` is untouched | plan 2026-10-08 evidence tabs and bubbles, task 3 | after Slice 3 |
| src/app/wiki/[...id]/page.tsx (+ a new test, wiki-condition-redirect) | a page of type condition that names its condition (its `condition-evidence` block, else its `taxonomy` front matter) is replaced by `/wiki?condition=<code>` once loaded, and nothing of the editor or the Backlinks column is drawn for it; a condition page that names none, and every other type, is unchanged | plan 2026-10-08 evidence tabs and bubbles, task 3 | after Slice 3 |
