# SciSpark Psychiatry

A private, local-first literature feed and evidence workspace for psychiatry clinicians.

**An independent, unofficial fork of [SciSpark-ai/scispark_wiki](https://github.com/SciSpark-ai/scispark_wiki) (Apache-2.0). Not affiliated with or endorsed by the upstream project.**
Forked at upstream commit `435afcd`. Every change made to an upstream file is recorded in
[docs/psychiatry/CHANGES.md](docs/psychiatry/CHANGES.md); see also [NOTICE](NOTICE).

> ### Read this first
>
> - **For literature awareness only. This is not medical advice** and not a tool for deciding the care of a patient.
> - **Study directions and summaries are an AI reading of abstracts and can be wrong.** Open the paper before relying on anything shown here.
> - **Counts are the papers your own feed has listed, not all the evidence.** Papers are counted; nothing is pooled.
> - **Do not enter patient information.** No guard against protected health information (PHI) is built: what you type is stored as you typed it, and what you ask is sent to your model provider.
> - **Bring your own model key.** It is stored in plain text in the local vault (`.scispark/settings.json`). Anyone who can read that folder can read the key.

## Screenshots

**[Interactive preview](docs/preview/)**: a static, read-only copy of three pages (What's new, Wiki, Notes) filled
with sample papers, with a short guided tour. No backend and no model. Open `docs/preview/index.html` in a browser, or
serve the `docs/` folder with GitHub Pages.

<!-- TODO (owner): add the GitHub Pages address of the preview here once Pages is turned on for the docs/ folder. -->

The pictures below are of that preview, not of a running app. Sample data. For literature awareness only — not
medical advice. AI summaries can be wrong.

| What's new | Wiki | Notes |
|---|---|---|
| ![What's new: a feed of paper cards with topic, study design, journal, AI headline and summary](docs/preview/screens/whats-new.png) | ![Wiki: the treatments of a class on the map, and the study table of one treatment](docs/preview/screens/wiki.png) | ![Notes: a note in Preview with its cited papers and linked treatments](docs/preview/screens/notes.png) |

The sample is rebuilt with `node scripts/build-preview-data.mjs <vault folder>`; it holds bibliographic facts and the
app's own AI text, and no abstracts.

## What it does

The app runs on your own computer, in your browser. The side rail has these pages:

| Page | What it is today |
|---|---|
| **What's new** | A feed built from PubMed for the conditions and treatments you follow under **My topics**. Each run plans the queries, keeps psychiatric records, drops what does not match, grades the study design, and writes an AI headline and one-sentence summary per paper, each checked against the abstract. A paper whose summary fails its checks is shown with its own title and the authors' conclusion. |
| **Wiki** | One tab per condition you follow. **Treatments** are drawn on a map: across, the date of the most recent paper; up, the participants the papers state (log scale, with a band for "not stated"). A class zooms to its treatments; a treatment opens its study table. **Safety** papers are grouped by treatment. **Other research** lists the papers that name no treatment. A paper comparing two treatments counts for the treatment it tested; the other arm lists it as a comparison. |
| **Notes** | Notes that save themselves and can link papers, conditions and treatments. A note shows how many new papers on its links arrived since your last edit, can be copied with its references, and can be taken to Ask. |
| **Ask** | The upstream chat, with three modes (discuss, find papers, deep literature review). |
| **Outputs** | The upstream projects list. |
| **Library** | Saved papers, Read later, History (earlier feed runs) and Saved chats. |

A paper's own page shows the AI headline and summary, the abstract by section, an optional longer digest,
and your notes on that paper.

## How it works

The feed is a fixed pipeline. A model is used in four places only (extra queries, grading, the card summary,
the topic overview) and code checks what it returns. All modules are under `src/lib/clinical/`.

1. **Plan** — `plan/queries.ts`, `plan/skill.ts`. PubMed queries are built from your topics through the term pack. The deterministic plan always runs; the model may only add queries.
2. **Retrieve** — `retrieve/pool.ts`, `retrieve/record-store.ts`. Runs the queries, merges duplicates, cleans the text, keeps records locally so they are not fetched twice.
3. **Domain filter** — `filter/prefilter.ts`. Keeps psychiatric records (MeSH headings and the pack's text words) and logs the reason for every drop.
4. **Relevance gate and design** — `filter/gate.ts`. PubMed's publication type decides the design when there is one; otherwise the wording does, and only wording that describes this paper ("randomized trials are needed" is not a randomized trial).
5. **Grade** — `grade/stage-a.ts`, `grade/verify-parts.ts`. The model grades the match to each topic. A quote it gives must appear in the title or abstract, and the part of the topic it says a paper matches must be named in the paper's own text.
6. **Score and select** — `score/score.ts`, `score/journal-tiers.ts`, `select/select.ts`. Recency, design and journal band; places are shared between topics so one broad topic cannot fill the list.
7. **Summarise** — `digest/card.ts`, `digest/topic.ts`. Headline and summary per paper; an overview per topic that sorts each paper (benefit, no benefit, mixed, safety, other).
8. **Evidence pages** — `evidence/build.ts`, `pack/taxonomy.ts`. Builds the Wiki's three sections from the papers the feed has listed.

The checks that keep the model honest:

- **Numbers must be printed in the abstract.** A headline or summary with a number the paper's text does not contain is refused, asked for once more, then dropped (`digest/card.ts`).
- **A summary rests on a sentence code looks up.** The model names the number of an abstract sentence; it does not quote (`digest/card.ts`).
- **A sample size must be tied to people.** "180 patients" counts; "12 weeks in patients" and "42 of 180" do not (`text/sample-size.ts`).
- **Association wording is not a benefit** outside trials and reviews: "was linked to" or "predicted" shows nothing to have helped (`digest/topic.ts`).
- **Treatment names are matched to a psychiatry term pack** (`packs/psychiatry/taxonomy.json`: names, synonyms, brands), not taken from the model's wording (`pack/taxonomy.ts`).

`audit/recall.ts` counts, for a list of papers you know should appear, the stage at which each was lost.
All wording a reader sees in this edition is in `src/lib/clinical/copy.ts`.

## Status and limits

An early build used by its author. Known and left:

- **Direction is one label per paper** (benefit, no benefit, mixed), read from the abstract. It is not an outcome-by-outcome reading.
- **No effect sizes and no forest plots** on the Wiki. Nothing is pooled.
- **Only about one new paper in five has open full text** (through PubMed Central, in one check of 25 recent papers); the rest are read from the abstract alone.
- **Only what your feed listed is counted.** A treatment with no bubble may have a large literature the feed never saw.
- **LaTeX is not rendered in notes**; a formula with `*` or backticks reads as emphasis or code in Preview.
- **The first-run flow is still the upstream one**: Connect AI → the onboarding chat → add topics under **My topics** → **Refresh**. The onboarding chat asks upstream's general research questions.
- **Upstream wording remains in places**: Ask's page is titled "Sparky", Outputs says "New project", the Library header has "Review inbox". Upstream pages this edition hides from the rail (Trending, Idea Spark, Graph) still exist at their addresses.
- **Costs depend on your model.** Every refresh makes model calls with your key; the provider's bill is the authority, and no figure is promised here.
- **Local profiles are not access control.** There are no passwords and nothing is encrypted. Run it on your own machine, on the loopback address only.
- English only. The term pack covers psychiatry only.

## Run it locally

Requirements: **Node.js 20.9 or later**, npm, and a model provider key of your own (or a signed-in Codex or
Claude Code CLI, as upstream supports).

```bash
git clone <your-fork-url>
cd scispark-wiki-psychiatry
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. Then: Settings → **Connect your AI**, answer the onboarding chat, add the
conditions and treatments you follow under **My topics**, and press **Refresh** on **What's new**.

**Where your data lives.** Everything is in one folder, the vault: `~/SciSpark/vault` by default. It holds
your pages and notes as Markdown, the feed's records, your conversations, and your settings including the
model key. The profile registry, and the vault of any extra profile you create, are in `.scispark-profiles`
beside it. Back up both.

**To use another folder:**

```bash
SCISPARK_VAULT=/absolute/path/to/vault npm run dev
```

**To reset:** stop the app, then move or delete the vault folder (and `.scispark-profiles` if you want the
profiles gone too). This removes everything, including the stored key. The next start creates an empty vault.

**Environment variables.** None is required. Copy `.env.example` to `.env.local` only if you need one of these:

| Variable | Use |
|---|---|
| `SCISPARK_VAULT` | The vault folder. Default `~/SciSpark/vault`. |
| `SCISPARK_PROFILES_DIR` | The profile registry folder. Default `.scispark-profiles` beside the vault. |
| `NCBI_API_KEY` | Optional. Raises PubMed's rate limit for your own requests. |
| `SCISPARK_SCHEDULER` | Optional upstream background timer. Leave unset: refresh by hand. |

`OPENALEX_MAILTO`, `OPENALEX_API_KEY`, `UNPAYWALL_EMAIL` and `S2_API_KEY` are optional upstream settings
this edition does not need: the feed reads PubMed only. The model key is not an environment variable; it is
entered in Settings.

**Checks:**

```bash
npx tsc --noEmit && npx eslint src && npx vitest run
```

## Benchmarks

Being measured; numbers will be added here with their method and limits.

| Measure | Set | Result | Method and limits |
|---|---|---|---|
| Recall of known papers | — | — | — |
| Study design agreement | — | — | — |
| Summaries passing their checks | — | — | — |
| Direction label agreement | — | — | — |

## Credits and licence

This is a fork. Most of the application is the work of the upstream project:

- **[SciSpark](https://github.com/SciSpark-ai/scispark_wiki)** by Tong Shan and contributors, Apache-2.0. The
  app shell, vault, wiki, chat, projects, paper sources and model layer are upstream's. Upstream's own
  documentation is kept unchanged in [docs/](docs/) and describes the upstream app, not this edition.
- **[Ai2 ScholarQA](https://github.com/allenai/ai2-scholarqa-lib)**, Allen Institute for AI, Apache-2.0.
  Upstream's `src/lib/review/scholarqa.ts` is a TypeScript adaptation of its pipeline; see
  [third_party/scholarqa/NOTICE](third_party/scholarqa/NOTICE) and its [LICENSE](third_party/scholarqa/LICENSE).
- **[Microsoft ResearchStudio](https://github.com/microsoft/ResearchStudio)**, MIT. Its ideation-pattern cards
  are bundled unmodified; see [src/lib/spark/pattern-cards/NOTICE.md](src/lib/spark/pattern-cards/NOTICE.md)
  and its [LICENSE](src/lib/spark/pattern-cards/LICENSE).
- PubMed and PubMed Central (U.S. National Library of Medicine) for the records the feed reads. This project
  is not affiliated with or endorsed by them either.

What this fork added is in `src/lib/clinical/`, `src/components/clinical/`, `src/app/api/clinical/`,
`packs/` and `docs/psychiatry/`; what it changed in upstream files is in
[docs/psychiatry/CHANGES.md](docs/psychiatry/CHANGES.md).

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE). The software is provided
"as is", without warranties or conditions of any kind.
