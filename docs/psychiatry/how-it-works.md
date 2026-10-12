# How SciSpark Psychiatry works

The detail behind the [README](../../README.md): the feed pipeline, the checks on the model, the known
limits, and the settings for running it locally.

## The pipeline

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

## Running it locally: data and settings

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
