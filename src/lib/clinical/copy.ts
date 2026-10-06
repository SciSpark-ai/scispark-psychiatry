/** All clinical-edition wording lives here, so a later language layer and legal review touch one file. */
export const CLINICAL_COPY = {
  appName: "SciSpark Psychiatry",
  metaDescription: "A literature radar and knowledge base for psychiatry: new papers matched to your watch list, with study design shown.",
  disclaimerShort:
    "For literature awareness only. Designs and grades describe the papers, not whether a treatment is right for a patient.",
  noPatientData: "Do not enter patient information.",
  feed: {
    heading: "Your literature feed",
    emptyNoEntries: "Add the conditions and treatments you follow, and your feed will be built around them.",
    emptyNoFeed: "No feed yet. Refresh to search for new papers on your watch list.",
    refresh: "Refresh",
    refreshing: "Searching…",
    morePapers: "Show more",
    lowerConfidence: "Lower-confidence matches",
    safetySignals: "Safety signals",
    savedToKnowledgeBase: "Saved",
    saveToKnowledgeBase: "Save to knowledge base",
  },
  stages: {
    context: "Reading your watch list",
    plan: "Planning searches",
    retrieve: "Searching PubMed",
    filter: "Filtering by topic and study design",
    grade: "Matching papers to your watch list",
    select: "Building your list",
  },
  feedback: { relevant: "Relevant to me", practiceChange: "Would change my practice", notRelevant: "Not relevant" },
  designLabels: {
    "meta-analysis": "Meta-analysis", "systematic-review": "Systematic review", "randomized-trial": "Randomized trial",
    guideline: "Guideline", cohort: "Observational", "clinical-trial": "Clinical trial", review: "Review",
    "case-report": "Case report", editorial: "Editorial", erratum: "Erratum", retraction: "Retracted", other: "Other design", unknown: "Design unknown",
  },
  designNote: "Design comes from the record's publication types or its text. It is not a judgement of study quality.",
  watch: {
    heading: "Watch list",
    intro: "The conditions and treatments you follow. Each entry needs a condition, a treatment, or both.",
    condition: "Condition", treatment: "Treatment", population: "Population (optional)", outcome: "Outcome (optional)",
    priority: "Priority", high: "High", normal: "Normal", paused: "Paused",
    safetySignal: "Show case reports for this topic as safety signals",
    add: "Add entry", remove: "Remove",
    mode: "Feed mode", whatsNew: "What's new (last 30 days)", catchUp: "Catch up", catchUpWindow: "Catch up looks back",
    months: { 3: "3 months", 6: "6 months", 12: "12 months" },
    strictness: "Study design filter", strict: "Strict: trials, reviews, guidelines", standard: "Standard: adds observational studies", open: "Open: adds other reviews and designs",
  },
} as const

export type StageKey = keyof typeof CLINICAL_COPY.stages
