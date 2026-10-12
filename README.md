# SciSpark Psychiatry

The psychiatry edition of SciSpark: follow the research on the conditions and treatments you care about, and
build your own evidence base from it.

SciSpark Psychiatry is built on [SciSpark wiki](https://github.com/SciSpark-ai/scispark_wiki), our general
research workspace, and shares its design: both help you keep up with the literature and turn what you read
into lasting knowledge. Use SciSpark wiki for knowledge management in any field. This edition is the
clinical-facing one, adapted to psychiatry first and designed to extend to other specialties.

## What is different in this edition

**1. It follows clinical questions, not just topics.** You tell it the conditions, treatments and patient
populations you care about. It tracks new studies on each and accumulates them into a per-condition picture
of the evidence: which treatments have been studied, in how many papers, with what results.

**2. It weighs clinical evidence.** For a clinician, the quality of a study matters as much as its result, so
studies are not treated alike. Today each paper is graded by study design, its AI summary is checked against
the abstract, and its result is sorted by direction (benefit, no benefit, mixed, safety). Our clinical
evidence pipeline, [evidence_evaluator_cli](https://github.com/SciSpark-ai/evidence_evaluator_cli), goes
further and is being integrated. For one study it:

- identifies the study type and extracts the key variables (arms, outcomes, event counts, effect);
- audits the statistics with deterministic code: Fragility Index, number needed to treat, post-hoc power;
- assesses risk of bias in the domains of RoB 2.0, QUADAS-2 and GRADE;
- compares the effect with the minimal clinically important difference for that outcome, where one is published;
- writes a report that flags what needs a human check.

**3. It is built for clinical-facing outputs.** Notes link to papers, conditions and treatments, tell you
when new studies arrive on what you wrote about, and export with references. Templates for the outputs
clinicians and residents actually produce (journal club outlines, evidence summaries on a clinical question,
teaching material, comparisons against guidelines) are in progress.

## Literature only

SciSpark Psychiatry works entirely on published research. It never asks for, stores or processes patient or
clinical data, and it is not a clinical decision tool. It helps you track the literature and build your own
projects on it; clinical judgement stays with you.

- **Not medical advice.** Study directions and summaries are an AI reading of abstracts and can be wrong.
  Open the paper before relying on anything shown here.
- **Do not enter patient information**, in notes or in questions. Nothing in the app needs it, and what you
  type is stored as typed and sent to your model provider when you ask.
- **Counts are the papers your own feed has listed, not all the evidence.** Papers are counted; nothing is pooled.
- **Bring your own model key.** When you run it locally the key is stored in plain text in your vault
  (`.scispark/settings.json`).

## Status

Under active development.

| | |
|---|---|
| **Available now** | Literature feed for the topics you follow · per-condition evidence map · linked notes with references · runs locally with your own AI key · an [interactive preview](docs/preview/) |
| **In progress** | Benchmarking and optimisation of the pipeline · reading PDFs you supply · integration of the clinical evidence pipeline · project templates |
| **Planned** | A hosted version · filters by population and outcome · effect sizes and forest plots |

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
| **Ask** | SciSpark wiki's chat, with three modes (discuss, find papers, deep literature review). |
| **Outputs** | Projects that group papers and notes; output templates are in progress. |
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

## Known limits

- **Direction is one label per paper** (benefit, no benefit, mixed), read from the abstract. It is not an outcome-by-outcome reading.
- **No effect sizes and no forest plots** on the Wiki. Nothing is pooled.
- **Only about one new paper in five has open full text** (through PubMed Central, in one check of 25 recent papers); the rest are read from the abstract alone.
- **Only what your feed listed is counted.** A treatment with no bubble may have a large literature the feed never saw.
- **LaTeX is not rendered in notes**; a formula with `*` or backticks reads as emphasis or code in Preview.
- **The first-run flow is still the general one**: Connect AI → the onboarding chat → add topics under **My topics** → **Refresh**. The onboarding chat asks SciSpark wiki's general research questions.
- **General-workspace wording remains in places**: Ask's page is titled "Sparky", Outputs says "New project", the Library header has "Review inbox". Pages this edition hides from the rail (Trending, Idea Spark, Graph) still exist at their addresses.
- **Costs depend on your model.** Every refresh makes model calls with your key; the provider's bill is the authority, and no figure is promised here.
- **Local profiles are not access control.** There are no passwords and nothing is encrypted. Run it on your own machine, on the loopback address only.
- English only. The term pack covers psychiatry only.

## Run it locally

Requirements: **Node.js 20.9 or later**, npm, and a model provider key of your own (or a signed-in Codex or
Claude Code CLI, as SciSpark wiki supports).

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
| `SCISPARK_SCHEDULER` | Optional background timer. Leave unset: refresh by hand. |

`OPENALEX_MAILTO`, `OPENALEX_API_KEY`, `UNPAYWALL_EMAIL` and `S2_API_KEY` are optional SciSpark wiki settings
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

SciSpark Psychiatry is part of SciSpark.

- **[SciSpark wiki](https://github.com/SciSpark-ai/scispark_wiki)** by Tong Shan and contributors is the
  foundation: the app shell, vault, wiki, chat, projects, paper sources and model layer. Its documentation is
  kept in [docs/](docs/) and describes the general workspace.
- **Psychiatry edition** by Linjing Jiang: the clinical feed pipeline and its checks, the psychiatry term
  pack, the evidence map, notes, and the clinical evidence pipeline
  ([evidence_evaluator_cli](https://github.com/SciSpark-ai/evidence_evaluator_cli), MIT).
- SciSpark wiki in turn builds on open work that we gratefully acknowledge, as it does in its own README:
  [LLM Wiki](https://github.com/nashsu/llm_wiki) and
  [Andrej Karpathy's LLM-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
  (the persistent, linked wiki); [PaperFlow](https://github.com/OpenRaiser/PaperFlow) and
  [PAHF](https://github.com/facebookresearch/PAHF) (design references for recommendation and feedback).
- **[Ai2 ScholarQA](https://github.com/allenai/ai2-scholarqa-lib)**, Allen Institute for AI, Apache-2.0.
  `src/lib/review/scholarqa.ts` is a TypeScript adaptation of its pipeline; see
  [third_party/scholarqa/NOTICE](third_party/scholarqa/NOTICE) and its [LICENSE](third_party/scholarqa/LICENSE).
- **[Microsoft ResearchStudio](https://github.com/microsoft/ResearchStudio)**, MIT. Its ideation-pattern cards
  are bundled unmodified; see [src/lib/spark/pattern-cards/NOTICE.md](src/lib/spark/pattern-cards/NOTICE.md)
  and its [LICENSE](src/lib/spark/pattern-cards/LICENSE).
- Bibliographic records come from PubMed and PubMed Central (U.S. National Library of Medicine). SciSpark is
  not affiliated with or endorsed by the NLM.

Copyright 2026 SciSpark contributors. Licensed under the [Apache License, Version 2.0](LICENSE), except where
otherwise noted; third-party components keep their own licences and notices. See [NOTICE](NOTICE). The
software is provided "as is", without warranties or conditions of any kind.
