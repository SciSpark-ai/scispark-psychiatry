// scripts/build-preview-data.mjs
//
// Builds docs/preview/sample-data.js: the small, committed sample the static preview page shows.
//
//   node scripts/build-preview-data.mjs <vault folder>
//
// It READS two files of a vault (never writes there): `.scispark/clinical/feed.json` and
// `.scispark/clinical/findings.json`. The Wiki's data is computed with the app's own pure builder
// (`buildConditionEvidence`, period "all", scope "all", a fixed `now`), so the preview shows what the
// app would show for the same papers. The app's TypeScript modules are loaded through the Vite that
// Vitest already installs; no new dependency.
//
// What is left out of every paper: the abstract, any full text, MeSH fields, publication types, and
// the sentence of the abstract a summary rests on (publisher's text). What is kept: bibliographic
// facts (title, authors, journal, dates, DOI, PMID) and this product's own AI-written headline,
// summary and extracted fields. The one note is invented here; no note of the vault is read.
//
// It also writes docs/preview/app-lib.js: three pure modules of the app as plain JavaScript (see LIB).

import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { createServer } from "vite"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(ROOT, "docs", "preview", "sample-data.js")
const LIB_OUT = path.join(ROOT, "docs", "preview", "app-lib.js")
/**
 * Three pure modules of the app, with no import that runs, that the page uses as they are: every word a reader sees,
 * the shapes of a bubble, and the scales and the places of the map. They are turned into plain JavaScript with the
 * TypeScript already installed, so the preview draws the map with the app's own code and says things in its words.
 */
const LIB = [["copy", "src/lib/clinical/copy.ts"], ["shapes", "src/components/clinical/evidence-shapes.ts"], ["map", "src/components/clinical/evidence-map.ts"]]
/** The day the sample is counted for: "new" means within 14 days of it. */
const NOW = new Date("2026-10-08T00:00:00.000Z")
const CONDITIONS = ["schizophrenia", "depression", "adhd"]
const CARDS_PER_TOPIC = 6
const MAX_AUTHORS = 8
const MAX_BYTES = 250 * 1024
/** The two papers the invented note cites; they are always among the cards. */
const NOTE_PAPERS = ["10-1016-j-psychres-2026-117469", "10-1016-j-pnpbp-2026-111950"]
const NOTE_DAY = "2026-10-07"

const vault = process.argv[2]
if (!vault) {
  console.error("usage: node scripts/build-preview-data.mjs <vault folder>")
  process.exit(1)
}

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"))

const server = await createServer({
  root: ROOT, configFile: false, logLevel: "error", appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { "@": path.join(ROOT, "src") } },
})

try {
  const load = (file) => server.ssrLoadModule(path.join(ROOT, file))
  const { loadPsychiatryPack } = await load("src/lib/clinical/pack/load.ts")
  const { buildConditionEvidence } = await load("src/lib/clinical/evidence/build.ts")
  const { FindingsFileSchema } = await load("src/lib/clinical/evidence/schema.ts")
  const { unescapeHtml } = await load("src/lib/clinical/text/clean.ts")
  const { displayTitle } = await load("src/lib/papers/title.ts")
  const { topicLabel } = await load("src/lib/clinical/topic-label.ts")
  const { topicLookup } = await load("src/components/clinical/topic.ts")
  const { classNameOf } = await load("src/components/clinical/evidence-labels.ts")
  const notes = await load("src/lib/clinical/notes/links.ts")
  const { CLINICAL_COPY: copy } = await load("src/lib/clinical/copy.ts")

  const pack = await loadPsychiatryPack(ROOT)
  const clinical = path.join(vault, ".scispark", "clinical")
  const feed = await readJson(path.join(clinical, "feed.json"))
  const findings = Object.values(FindingsFileSchema.parse(await readJson(path.join(clinical, "findings.json"))).findings)
  const findingOf = new Map(findings.map((finding) => [finding.key, finding]))

  // --- papers: one record each, by an opaque id (the slug) --------------------------------------
  const papers = {}
  /** Bibliographic facts only. */
  const bibliography = (paper) => {
    const names = (paper.authors ?? []).map((author) => unescapeHtml(author.name ?? "").trim()).filter(Boolean)
    return {
      title: displayTitle(unescapeHtml(paper.title)),
      authors: names.slice(0, MAX_AUTHORS), moreAuthors: Math.max(0, names.length - MAX_AUTHORS),
      venue: paper.venue ?? null, date: paper.date ?? null, added: paper.addedDate?.slice(0, 10) ?? null, year: paper.year ?? null,
      doi: paper.ids?.doi ?? null, pmid: paper.ids?.pmid ?? null,
    }
  }
  const EMPTY = { shown: null, label: null, designNamed: false, population: null, sampleSize: null, comparator: null, outcome: null, kind: null, text: null, treatment: null, severalTreatments: false, isNew: false }
  /** A study as the builder made it (its numbers are the ones a table shows), with its paper's bibliography. */
  const keepStudy = (study) => {
    const finding = findingOf.get(study.key)
    papers[study.slug] ??= {
      ...bibliography(finding.paper),
      // `shown`: the date the builder orders and draws the paper by (its publication date when that names a month, else the day it was listed).
      shown: study.date, headline: study.headline, takeaway: study.takeaway, label: study.label, design: study.design, designNamed: study.designNamed,
      population: study.population, sampleSize: study.sampleSize, comparator: study.comparator, outcome: study.outcome,
      kind: study.kind, text: study.text, treatment: study.treatment, severalTreatments: study.severalTreatments, isNew: study.isNew,
    }
    return study.slug
  }

  // --- the Wiki: the app's own builder, then studies replaced by their ids ----------------------
  const conditions = CONDITIONS.map((code) => {
    const evidence = buildConditionEvidence(findings, pack.taxonomy, code, { now: NOW, period: "all", scope: "all" })
    if (!evidence) throw new Error(`the pack has no condition "${code}"`)
    return {
      code: evidence.condition.code, name: evidence.condition.name,
      total: evidence.total, collected: evidence.collected, since: evidence.since, sections: evidence.sections,
      classes: evidence.classes.map((cls) => ({
        key: cls.key, name: classNameOf(cls.key, cls.label), papers: cls.papers, efficacy: cls.efficacy, newPapers: cls.newPapers, participants: cls.participants, sized: cls.sized,
        treatments: cls.treatments.map((entry) => ({
          key: entry.key, name: entry.name, papers: entry.papers, efficacy: entry.efficacy, newPapers: entry.newPapers, participants: entry.participants, sized: entry.sized,
          safetyPapers: entry.safetyPapers, comparatorPapers: entry.comparatorPapers,
          studies: entry.studies.map(keepStudy), comparedIn: entry.comparedIn.map(keepStudy),
        })),
      })),
      safety: evidence.safety.map((group) => ({ key: group.key, name: group.name, papers: group.papers, newPapers: group.newPapers, studies: group.studies.map(keepStudy) })),
      research: evidence.research.map((group) => ({ name: copy.evidence.researchTypes[group.type], treatmentShown: group.type === "no-efficacy", papers: group.papers, newPapers: group.newPapers, studies: group.studies.map(keepStudy) })),
    }
  })

  // --- What's new: some cards of the latest feed, the best-scored of each topic -------------------
  const lookup = topicLookup(feed.topics)
  const slugOf = (item) => findingOf.get(item.key)?.slug ?? null
  const cards = []
  for (const topic of feed.topics) {
    const mine = feed.items.filter((item) => item.entryId === topic.id && item.digest && slugOf(item))
    const cited = mine.filter((item) => NOTE_PAPERS.includes(slugOf(item)))
    const rest = mine.filter((item) => !cited.includes(item)).sort((a, b) => b.score - a.score)
    for (const item of [...cited, ...rest].slice(0, CARDS_PER_TOPIC).sort((a, b) => b.score - a.score)) {
      const slug = slugOf(item)
      const finding = findingOf.get(item.key)
      // A paper the Wiki files under none of the three conditions still has its card: the finding's own fields, no builder numbers.
      if (papers[slug]) papers[slug].added ??= item.paper.addedDate?.slice(0, 10) ?? null
      papers[slug] ??= { ...bibliography(item.paper), ...EMPTY, headline: finding.headline, takeaway: finding.takeaway, design: finding.design, kind: finding.kind, text: finding.text, treatment: finding.treatment, comparator: finding.comparator, population: finding.population, outcome: finding.outcome }
      cards.push({
        paper: slug, topic: topic.id, topicLabel: lookup.topicOf(item) ?? topicLabel(topic), tone: lookup.toneOf(item) ?? 0,
        design: item.design, designSource: item.designSource,
        headline: item.digest.headline, takeaway: item.digest.takeaway, tags: item.digest.tags ?? [],
      })
    }
  }
  const topics = feed.topics.map((topic) => ({ id: topic.id, label: topicLabel(topic) }))

  // --- one invented note (not from the vault), written with the links the app itself writes -------
  for (const slug of NOTE_PAPERS) if (!papers[slug]) throw new Error(`the note cites ${slug}, which is not in the sample`)
  const depression = conditions.find((entry) => entry.code === "depression")
  const treatment = (key) => {
    const found = depression.classes.flatMap((cls) => cls.treatments).find((entry) => entry.key === key)
    if (!found) throw new Error(`the note links the treatment "${key}", which the sample has no bubble for`)
    return notes.treatmentLink("depression", key, found.name)
  }
  const cite = (slug) => notes.paperLink(slug, notes.paperLabel(papers[slug]))
  const body = [
    `Sample note, written for this preview. Options to read up on when a first antidepressant has not worked, from what the feed listed under ${notes.conditionLink("depression", depression.name)}:`,
    "",
    `- **Augmentation**: ${treatment("lithium")} or ${treatment("quetiapine")} added to the antidepressant. One trial in the feed reports on both ${cite(NOTE_PAPERS[0])}.`,
    `- **${treatment("ketamine")}**: a pooled analysis of two trials looks at which symptoms change first ${cite(NOTE_PAPERS[1])}.`,
    "",
    "To do: open both papers and check the comparators and how long the patients were followed. The labels on the Wiki are an AI reading and can be wrong.",
  ].join("\n")
  const links = notes.noteLinks(body)
  const note = {
    id: "sample-note", title: "Augmentation options after a first antidepressant", body, excerpt: notes.excerptOf(body), updated: NOTE_DAY, kind: notes.noteKind(links),
    conditions: [{ code: "depression", name: depression.name }],
    treatments: links.treatments.map((entry) => ({ condition: entry.condition, key: entry.treatment, name: depression.classes.flatMap((cls) => cls.treatments).find((item) => item.key === entry.treatment)?.name ?? entry.treatment })),
    papers: links.papers.map((slug) => ({ slug, label: notes.paperLabel(papers[slug]) })),
  }

  const sample = {
    note: "Sample data for the static preview. Built by scripts/build-preview-data.mjs. Bibliographic facts and this product's own AI text only; the one note is invented.",
    now: NOW.toISOString().slice(0, 10),
    feed: { listed: feed.items.length, found: feed.stats?.retrieved ?? null, lookBack: feed.lookBack ?? null, updated: String(feed.generatedAt).slice(0, 10), topics, cards },
    conditions, papers, notes: [note],
  }

  // Nothing of the publisher's and nothing of the machine it was built on may be in the file.
  const forbidden = (value, trail = "sample") => {
    if (Array.isArray(value)) return value.forEach((entry, at) => forbidden(entry, `${trail}[${at}]`))
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (/abstract|fulltext|full_text|path|quote/i.test(key)) throw new Error(`${trail}.${key} must not be in the sample`)
        forbidden(entry, `${trail}.${key}`)
      }
    }
  }
  forbidden(sample)
  const text = `// Generated by scripts/build-preview-data.mjs. Do not edit by hand.\nwindow.SAMPLE = ${JSON.stringify(sample)};\n`
  if (/\/Users\/|\/home\/|[\w.+-]+@[\w-]+\.[a-z]{2,}|sk-[A-Za-z0-9]{8}/i.test(text)) throw new Error("a local path, an address or a key is in the sample")
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`the sample is ${Buffer.byteLength(text)} bytes, over ${MAX_BYTES}`)
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, text)

  const modules = []
  for (const [name, file] of LIB) {
    const source = await readFile(path.join(ROOT, file), "utf8")
    if (/^import\s+(?!type\b)/m.test(source)) throw new Error(`${file} imports something that runs; it cannot be used as it is`)
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, removeComments: true } }).outputText
    modules.push(`// ${file}\nlib.${name} = (function () { var exports = {};\n${js}\nreturn exports; })();`)
  }
  const lib = `/* eslint-disable */\n// Generated by scripts/build-preview-data.mjs from the app's own source (Apache-2.0). Do not edit by hand.\n(function () {\nvar lib = {};\n${modules.join("\n")}\nwindow.APP_LIB = lib;\n})();\n`
  await writeFile(LIB_OUT, lib)
  console.log(`${path.relative(ROOT, LIB_OUT)}: ${Buffer.byteLength(lib)} bytes`)
  console.log(`${path.relative(ROOT, OUT)}: ${Buffer.byteLength(text)} bytes, ${cards.length} cards, ${Object.keys(papers).length} papers, ${conditions.map((entry) => `${entry.code} ${entry.total}`).join(", ")}`)
} finally {
  await server.close()
}
