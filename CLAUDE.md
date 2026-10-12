# CLAUDE.md — SciSpark Psychiatry

## What this is

SciSpark Psychiatry is a private, local-first literature feed and evidence workspace for psychiatry
clinicians: it runs on the reader's own computer, in the browser, over a Markdown vault the reader owns.
It is the psychiatry edition of SciSpark, built on the Apache-2.0 project SciSpark wiki
(`SciSpark-ai/scispark_wiki`, taken at commit `435afcd`). It works on published literature only. For literature awareness only; it is not
medical advice, and AI summaries can be wrong. See `README.md` for the full description and safety box.

## Run and test

- `npm ci` — install dependencies.
- `npm run dev` — development server (loopback only).
- `npx vitest run` — the full test suite; add a path to run one folder or file.
- `npx tsc --noEmit` — type-check.
- `npx eslint src` — lint.
- `npm run e2e` — Playwright against a disposable temporary vault.

Live tests that call a paid model or a public API are environment-gated; do not run them as ordinary tests.

## Conventions that bind this fork

- Clinical code lives in `src/lib/clinical`, `src/components/clinical`, `src/app/api/clinical` and
  `packs/` (the clinical content). New files there are ours; keep clinical logic out of upstream files.
- Every user-facing string in clinical code goes in `src/lib/clinical/copy.ts`. Guard tests enforce
  this and the wording rules: `copy-completeness`, `client-bundle`, `page-type-completeness`
  (in `src/lib/clinical/__tests__/`).
- Every edit to a file that exists upstream gets a row in `docs/psychiatry/CHANGES.md`, in the same commit.
- Vault writes go through changesets on the server (validated, atomic, undoable); the browser never writes files.
- Keep LLM skills pure and storage-free; orchestrators own persistence, filtering and cost metering.
- No patient data: nothing in the code, tests, fixtures or docs may contain it, and the app says so to the reader.
- Do not set `OPENALEX_MAILTO` or `UNPAYWALL_EMAIL` in this edition. No e-mail addresses, keys or personal paths in tracked files.
- Never expose stored model keys to the client; the settings API redacts them.
- Use the `@/*` alias for `src/*`, semantic CSS tokens (raw colours in components are guarded by tests), and add focused tests for behaviour changes.

React gotchas that have bitten this code base:

- Never side-effect inside JSX expressions; compute keys and values before building the elements.
- A `dangerouslySetInnerHTML` wrapper must be referentially stable (memoize the `{ __html }` object), or React 19 re-applies it.

Next.js here is a recent version with breaking changes: read the relevant guide in
`node_modules/next/dist/docs/` before changing Next.js code.

## Where to read more

- `docs/design/` — upstream architecture (product, system, backend, agent harness, frontend, roadmap, recommendation pipeline).
- `design.md` — the visual contract (tokens, fonts, motion, logo usage).
- `docs/psychiatry/` — this fork's own documents: `CHANGES.md` and the run logs.
- `docs/FEATURE_GUIDE.md` — what each upstream feature does.
