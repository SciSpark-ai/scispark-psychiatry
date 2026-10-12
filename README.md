# SciSpark Psychiatry

SciSpark Psychiatry is a private, local-first literature feed and evidence workspace for psychiatry clinicians.

It is built on [SciSpark wiki](https://github.com/SciSpark-ai/scispark_wiki), our general research workspace,
and shares its design. Both help you keep up with the literature and turn what you read into lasting
knowledge. Use SciSpark wiki for knowledge management in any field. This edition is clinical-facing, adapted
to psychiatry first and designed to extend to other clinical specialties.

**[Try the interactive preview](docs/preview/)** · [Run it locally](#run-it-locally) · [How it works](docs/psychiatry/how-it-works.md)

<!-- TODO (owner): replace the preview link with its GitHub Pages address once Pages is on for docs/. -->

## Who it is for

Psychiatrists, residents and other clinicians who need to stay current on specific conditions and treatments,
and who prepare evidence for their own work: journal clubs, case conferences, teaching, service decisions.
It suits you if you follow a handful of clinical questions closely and have little time to read.

## What you can use it for

**1. Follow your clinical questions.** Tell SciSpark Psychiatry the conditions, treatments and patient
populations you care about. It retrieves the most recent and relevant papers on each question, and
accumulates them into a knowledge base for each condition: which treatments were studied, in how many
papers, with what results.

**2. Weigh the evidence.** For a clinician, the quality of a study matters as much as its result, so studies
are not treated alike. Each paper is marked by its study design (randomised trial, observational study,
systematic review and so on) and its sample size, and every AI output is checked against the paper it came
from. Our clinical evidence pipeline,
[evidence_evaluator_cli](https://github.com/SciSpark-ai/evidence_evaluator_cli), goes further and is being
integrated: an assessment of each study's type, sample size, risk of bias, statistical power and effect size,
with a quality score and a detailed report, so you can judge the study yourself.

**3. Get clinical work done.** A project space built for clinical outputs: preparing a journal club, an
evidence summary or report on a clinical question, teaching material, a comparison against guidelines. Your
notes link to papers, conditions, treatments and projects, cite the papers you have stored or searched, and
export with references. Notes are available now; project templates are in progress.

## Highlights

- **Checked AI.** A number in a summary must be printed in the abstract. A sample size must be tied to
  people. "Was associated with" is not counted as a benefit outside trials and reviews.
- **An evidence map per condition.** Treatments grouped by class, placed by recency and total participants,
  coloured by what the studies found. Open one to see every study behind it.
- **Notes that stay current.** A note tells you when new papers arrive on the condition or treatment it is about.
- **Private by design.** It runs on your own computer with your own AI key. Your library and notes are plain
  files you own.

| What's new | Wiki | Notes |
|---|---|---|
| ![A feed of paper cards with topic, study design, journal, AI headline and summary](docs/preview/screens/whats-new.png) | ![The treatments of a class on the evidence map, and the study table of one treatment](docs/preview/screens/wiki.png) | ![A note with its cited papers and linked treatments](docs/preview/screens/notes.png) |

Pictures of the preview, with sample data.

## Literature only

SciSpark Psychiatry works entirely on published research. It never asks for, stores or processes patient or
clinical data, and it is not a clinical decision tool. Clinical judgement stays with you.

- **Not medical advice.** Summaries and study directions are an AI reading of abstracts and can be wrong.
  Open the paper before relying on anything shown here.
- **Do not enter patient information**, in notes or in questions.
- **Not all the evidence.** It counts the papers your own feed has listed. Nothing is pooled.

## Status

Under active development.

| | |
|---|---|
| **Available now** | Literature feed for the topics you follow · evidence map per condition · linked notes with references · runs locally with your own AI key · interactive preview |
| **In progress** | Benchmarking and optimisation of the pipeline · reading PDFs you supply · integration of the clinical evidence pipeline · project templates |
| **Planned** | A hosted version · filters by population and outcome · effect sizes and forest plots |

Current limits are listed in [How it works](docs/psychiatry/how-it-works.md#known-limits).

## Run it locally

You need Node.js 20.9 or later and an AI provider key of your own.

```bash
git clone <your-fork-url>
cd scispark-wiki-psychiatry
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>, connect your AI in Settings, add the conditions and treatments you follow under
**My topics**, and press **Refresh** on **What's new**. Your data stays in one folder on your computer
(`~/SciSpark/vault` by default). Settings and details are in
[How it works](docs/psychiatry/how-it-works.md#running-it-locally-data-and-settings).

## Credits and licence

SciSpark Psychiatry is part of SciSpark.

- **[SciSpark wiki](https://github.com/SciSpark-ai/scispark_wiki)** by Tong Shan and contributors: the
  foundation (app shell, vault, wiki, chat, projects, paper sources, model layer).
- **Psychiatry edition** by Linjing Jiang: the clinical feed pipeline and its checks, the psychiatry term
  pack, the evidence map, notes, and the clinical evidence pipeline.
- Open work SciSpark builds on: [LLM Wiki](https://github.com/nashsu/llm_wiki) and
  [Karpathy's LLM-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f),
  [Ai2 ScholarQA](https://github.com/allenai/ai2-scholarqa-lib) (Apache-2.0, adapted code),
  [Microsoft ResearchStudio](https://github.com/microsoft/ResearchStudio) (MIT, bundled cards),
  [PaperFlow](https://github.com/OpenRaiser/PaperFlow) and [PAHF](https://github.com/facebookresearch/PAHF).
- Records come from PubMed and PubMed Central (U.S. National Library of Medicine), which does not endorse
  this project.

Copyright 2026 SciSpark contributors. [Apache License 2.0](LICENSE); third-party components keep their own
licences, see [NOTICE](NOTICE). Provided "as is", without warranty.
