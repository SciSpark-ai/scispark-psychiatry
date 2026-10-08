
/** All clinical-edition wording lives here, so a later language layer and legal review touch one file. */
/** The short names of the months, for an axis of time. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export const CLINICAL_COPY = {
  appName: "SciSpark Psychiatry",
  /** The small word under the SciSpark wordmark. */
  edition: "Psychiatry",
  /** The rail, and the two views of the wiki page (amendments A1, A2, A4). */
  nav: {
    /** `evidence` is the page of the conditions the reader follows (`/wiki`), `chat` the page of conversations (`/chat`). */
    whatsNew: "What's new", evidence: "Wiki", chat: "Ask", notes: "Notes", outputs: "Outputs", library: "Library", topics: "My topics",
    /** The link at the top of a wiki page that leads back to the view it belongs to. */
    backTo: (view: string) => `← ${view}`,
  },
  metaDescription: "A literature radar and knowledge base for psychiatry: new papers matched to your watch list, with study design shown.",
  /**
   * The safety line under every page (`ClinicalFooterNote`) is these three, in this order. `noPatientData` is also
   * shown beside every box a reader types in at length: the note editor and Ask.
   */
  disclaimerShort: "For literature awareness only — not medical advice.",
  aiCanBeWrong: "AI summaries can be wrong.",
  noPatientData: "Do not enter patient information.",
  /** At the foot of the feed, with `feed.aiNotice`. */
  disclaimerGrades: "Designs and grades describe the papers, not whether a treatment is right for a patient.",
  loading: "Loading…",
  errorPrefix: "Error:",
  modes: { "whats-new": "What's new", "catch-up": "Catch up" },
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
    openWatchList: "Choose your topics",
    modeChanged: (lookBack: string) => `Press Refresh to rebuild the list for ${lookBack}.`,
    readLater: "Read later",
    readLaterRemove: "Remove from Read later",
    readLaterFailed: "The Read later list could not be saved.",
    /** The one line under the heading. */
    status: (listed: number, found: number, lookBack: string, when: string) => `${listed} ${listed === 1 ? "paper" : "papers"} from ${found} found in PubMed · ${lookBack} · updated ${when}`,
    /** The two dates of a card, when they differ. The list is searched by the second. */
    publishedOn: (date: string) => `published ${date}`,
    inPubmed: (date: string) => `in PubMed ${date}`,
    customDates: "Custom dates",
    dateFrom: "From",
    dateTo: "To",
    lookBack: "Look back",
    /** A look-back in a sentence, and a custom range. */
    lastRange: (name: string) => `last ${name}`,
    dateRange: (from: string, to: string) => `${from} to ${to}`,
    lookBackOptions: { "3d": "3 days", "7d": "1 week", "14d": "2 weeks", "30d": "30 days", "3m": "3 months", "6m": "6 months", "12m": "12 months" },
    allTopics: "All",
    aiOverview: "AI overview",
    alsoOn: (condition: string) => `Also on ${condition}`,
    aiOverviewNote: "Written by AI from the summaries of the papers listed under this topic. The numbers after a sentence are the papers it rests on. Read the papers before relying on it.",
    /** The lines of the AI overview, by what the findings say. */
    overviewKinds: { benefit: "Benefit", "no-benefit": "No benefit", mixed: "Mixed", safety: "Safety", other: "Other" },
    /** The first line of the overview: how many papers, and how many of each kind among those it cites. */
    overviewCounts: (papers: number, kinds: Array<{ label: string; count: number }>) =>
      `${papers} ${papers === 1 ? "paper" : "papers"}${kinds.length > 0 ? `: ${kinds.map((kind) => `${kind.count} ${kind.label.toLowerCase()}`).join(", ")}` : ""}`,
    /** Opens the rest of a long line of other findings. */
    moreFindings: (count: number) => `${count} more`,
    fewerFindings: "Show less",
    showSeenAgain: "Show seen papers again",
    showSeenAgainNote: "Papers you have already been shown are left out of a new list. This forgets them for the chosen time range, so the next refresh can list them again.",
    seenForgotten: (count: number) => (count > 0 ? `${count} seen ${count === 1 ? "paper" : "papers"} can be listed again. Press Refresh to list them.` : "No seen papers were being held back for this time range."),
    seenForgetFailed: "The list of seen papers could not be changed.",
    topicsLabel: "Topics",
    /** The count line of a tab. */
    overview: {
      papers: (count: number) => `${count} ${count === 1 ? "paper" : "papers"}`,
    },
    saveFailed: "This paper could not be saved.",
    /** How well a paper fits the watch entry it was matched to (the stage-A grade, 1 to 4), in words. */
    matchLabels: { 4: "Direct match", 3: "Close match", 2: "Related", 1: "Loosely related" },
    matchNotes: {
      4: "The paper studies exactly what this watch entry follows: its condition, its treatment, or both.",
      3: "The paper fits this watch entry, but in a subtype, a related drug class or a different patient group.",
      2: "One part of this watch entry matches exactly and the other is only related, for example a new use of the treatment.",
      1: "Only one part of this watch entry appears in the paper.",
    },
    /** Hover text on a card's topic, by the part of the watch entry the paper matches. */
    matchedPartNotes: {
      full: "This paper is about everything this watch entry follows.",
      condition: "This paper is about the condition you follow, with a different treatment or none.",
      treatment: "This paper studies the treatment you follow, in a different condition.",
    },
    matchedOn: (quote: string) => `Matched on this sentence: “${quote}”`,
    conclusionLabel: "Authors' conclusion",
    aiNotice: "Headlines and summaries are written by AI from each abstract. Open a paper for its own title and abstract.",
    nothingNew: "Nothing new since your last visit.",
    seenEarlier: "Seen earlier today",
    aiSummaryLabel: "AI summary",
    aiSummaryNote: (quote: string) =>
      `Written by the AI model from the abstract, not by the authors. It rests on this sentence: “${quote}” Read the paper before relying on it.`,
    noAbstract: "No abstract",
    notGraded: "Not graded",
    published: (date: string) => `Published ${date}`,
    noDate: "Publication date unavailable",
  },
  paper: {
    aiSummary: "AI summary",
    aiSummaryNote: (quote: string) => `Written by AI from the abstract, not by the authors. It rests on this sentence: “${quote}” Read the abstract before relying on it.`,
    originalAbstract: "Abstract",
    /** The top of the paper page. */
    header: {
      originalTitle: "Original title",
      published: (date: string) => `Published ${date}`,
      inPubmed: (date: string) => `In PubMed ${date}`,
      separator: " · ",
      authorJoin: ", ",
      moreAuthors: (count: number) => `… ${count} more …`,
      doi: (doi: string) => `DOI ${doi}`,
      pmid: (pmid: string) => `PMID ${pmid}`,
    },
    /** The nine-item digest on the paper page. */
    digest: {
      heading: "Digest",
      labels: {
        question: "Research question", design: "Study design", population: "Population", intervention: "Intervention and comparator",
        mainResult: "Main result", secondaryOutcomes: "Secondary outcomes", safety: "Safety",
        limitations: "Limitations", conclusion: "Authors' conclusion", funding: "Funding and conflicts of interest",
      },
      groups: { study: "The study", results: "Results", appraisal: "Appraisal" },
      write: "Write digest", writing: "Reading the paper…", update: "Update from full text", written: "Digest written",
      writeNote: "Reads the paper, the full text when it can be had, and uses your AI model.",
      fromFullText: "Written by AI from the full text", fromExcerpt: "Written by AI from the full text, without its middle part",
      fromAbstract: "Written by AI from the abstract only. The full text could not be read.",
      notStated: (fromFullText: boolean, labels: string[]) => `Not stated in the ${fromFullText ? "paper" : "abstract"}: ${labels.map((label) => label.toLowerCase()).join(", ")}.`,
      unverified: "Check this against the paper: a number or the source sentence given for it was not found in the text.",
      sourceSentence: "Source sentence",
      noSourceSentence: "No source sentence was given for this item.",
      failed: (status: string) => `The digest could not be written (${status}).`,
      lookupFailed: (status: number) => `The saved digest could not be read (${status}).`,
      /** The side navigation of the paper page. */
      nav: { label: "On this page", summary: "AI summary", digest: "Digest", abstract: "Abstract", notes: "Your notes" },
    },
  },
  /** The Outputs page (`/outputs`): the reader's projects. */
  outputs: {
    heading: "Outputs",
    intro: "Bring papers and notes together for a talk, a summary or a review.",
  },
  readLater: {
    heading: "Read later",
    intro: "Papers you put aside from your feed.",
    empty: "Nothing put aside yet. Use the clock on a paper to keep it here.",
  },
  history: {
    heading: "History",
    intro: "Every search you have run. Open one to see its list again on Home, or delete it.",
    empty: "No searches yet. Each time you press Refresh, the list is kept here.",
    papers: (count: number) => `${count} ${count === 1 ? "paper" : "papers"}`,
    open: "Open",
    delete: "Delete",
    confirmDelete: "Delete for good",
    failed: "The history could not be changed.",
  },
  /** Errors and warnings of a feed run; shown on Home. */
  run: {
    noEntries: "Add at least one watch entry before refreshing the feed.",
    planningFailed: "AI query planning did not complete; used the standard queries only.",
    everyQueryFailed: "PubMed search failed for every query. Check your connection and try again.",
    tooManyQueriesFailed: (failed: number, total: number) =>
      `${failed} of ${total} PubMed searches failed, so this run would be incomplete. Your previous feed is still shown. Try again in a few minutes.`,
    queryFailed: (reason: string) => `A PubMed query failed: ${reason}`,
    /** What a search was for, as named in a warning. */
    journalBatch: (tier: string, first: number, last: number) => `tier ${tier} journals ${first}-${last}`,
    caseReports: (topic: string) => `${topic} (case reports)`,
    truncated: (total: number, returned: number, rationale: string) => `A query matched ${total} records and only ${returned} were read (${rationale}).`,
    gradingFailed: "AI grading did not complete. Check your AI connection in Settings, then try again.",
    gradingBatchesFailed: (count: number) => `${count} grading batch(es) failed; the papers in them are not in this list. Refresh to try them again.`,
    overCap: (count: number, cap: number) => `${count} more papers were found than the ${cap} that one search grades; they were not looked at. A shorter time range leaves fewer out.`,
    findingsNotKept: "This search's papers could not be added to your Wiki pages. The list itself is complete.",
    summariesFailed: "Some AI summaries could not be written; those cards show the authors' conclusions instead.",
    nothingMatched: "No papers matched your watch entries well enough. Your previous feed is still shown.",
  },
  stages: {
    context: "Reading your watch list",
    plan: "Planning searches",
    retrieve: "Searching PubMed",
    filter: "Filtering by topic and study design",
    grade: "Matching papers to your watch list",
    select: "Building your list",
  },
  /** Two icon buttons on a card: thumbs up and thumbs down. The words are their accessible names and hover text. */
  feedback: {
    up: "Useful to me", upNote: "Useful to me: show more like this",
    down: "Not for me", downNote: "Not for me: do not show this paper again",
    saveFailed: "Your vote could not be saved.",
  },
  designLabels: {
    "meta-analysis": "Meta-analysis", "systematic-review": "Systematic review", "randomized-trial": "Randomized trial",
    guideline: "Guideline", cohort: "Observational", "clinical-trial": "Clinical trial", review: "Review",
    "case-report": "Case report", editorial: "Editorial", erratum: "Erratum", retraction: "Retracted",
    protocol: "Study protocol", preclinical: "Animal or lab study", other: "Other design", unknown: "Design unknown",
  },
  designNote: "The publication type PubMed assigned to this record. It is not a judgement of study quality.",
  designInferredNote: "Read from the title and abstract, not assigned by PubMed, so it may be wrong. It is not a judgement of study quality.",
  watch: {
    heading: "My topics",
    intro: "The conditions and treatments you want papers about. Your feed is built from these. Each topic needs a condition, a treatment, or both.",
    condition: "Condition", treatment: "Treatment (optional)", population: "Patient group (optional)", outcome: "Outcome (optional)",
    priority: "Priority", high: "High priority", normal: "Normal", paused: "Paused",
    priorityNote: "High-priority topics get more places in your feed.",
    safetySignal: "Also show case reports for this topic, as safety signals",
    add: "Add topic", remove: "Remove",
    yourTopics: "Your topics",
    noTopics: "You are not following any topic yet. Add one below.",
    addTopic: "Add a topic",
    addHelp: "Type a condition, a treatment, or both, then press Enter. With a condition alone you get every new paper on it.",
    conditionHint: "For example: Schizophrenia",
    treatmentHint: "For example: Clozapine",
    addSecond: "+ Add a second condition",
    removeSecond: "Remove the second condition",
    condition2: "Second condition",
    conditionJoin: "How the two conditions combine",
    joinAnd: "Both",
    joinAndNote: "Only papers about both conditions",
    joinOr: "Either one",
    joinOrNote: "Papers about one or the other",
    preview: "You will follow:",
    alsoCalled: "also called",
    spellingAsk: (suggestion: string) => `Did you mean ${suggestion}?`,
    spellingUse: (suggestion: string) => `Use ${suggestion}`,
    spellingKeep: (typed: string) => `Keep “${typed}”`,
    caseReportsOn: "case reports on",
    filterHeading: "Which studies to include",
    needFacet: "Enter a condition, a treatment, or both.",
    saveFailed: "Your watch list could not be saved.",
    settingsSaveFailed: "Your settings could not be saved.",
    mode: "Feed mode", whatsNew: "What's new (last 30 days)", catchUp: "Catch up", catchUpWindow: "Catch up looks back",
    months: { 3: "3 months", 6: "6 months", 12: "12 months" },
    strictness: "Which studies to include",
    filters: {
      strict: { title: "Strict", note: "Trials, systematic reviews and guidelines" },
      standard: { title: "Standard", note: "All clinical studies, without case reports and narrative reviews" },
      open: { title: "Everything", note: "Every kind of article" },
    },
  },
  records: {
    notATrialDesign: "Trial data can be extracted from trials only.",
    notATrial: "The paper does not report a trial with two or more groups.",
    tooFewArms: "Fewer than two groups could be read from the paper and checked against it.",
    extractFailed: (status: string) => `The trial data could not be extracted (${status}).`,
    inboxKind: "Trial data",
    inboxOpen: "Check the extracted values",
    inboxTitle: (title: string) => `Check the trial data of “${title}”`,
    inboxDescription: (fields: number, dropped: number) =>
      `${fields} values were read from the paper and matched to a sentence in it.${dropped > 0 ? ` ${dropped} more were given by the model and dropped because they failed that check.` : ""} Confirm or correct them before relying on the table.`,
    notANumber: "This field holds a number.",
    nothingToConfirm: "There is nothing to confirm: no value was read for this field.",
    conflict: "This value was changed elsewhere since you opened the page. Reload to see it.",
    notFound: "No trial data has been extracted for this paper.",
    unreadable: "Trial data for this paper is already stored but could not be read; it was left untouched.",
    otherPaper: "Another paper with the same title already has trial data stored. This paper's data cannot be stored beside it.",
    notAChoice: "That is not one of the choices for this field.",
    notInPack: "That is not in the pack, so nothing can be filed under it.",
    badSlug: "That is not a paper this app knows.",
    badRequest: "The request was not understood.",
    noSuchCondition: "That condition is not in the pack.",
    conditionPage: {
      evidence: "Evidence your feed has seen", notes: "My notes",
      notesHint: "Write what you conclude from these papers here.",
    },
    table: {
      columns: ["Treatment", "Type", "Trials", "Compared with", "Primary outcomes", "Direction of effect", "Latest trial"],
      modalities: { drug: "Drug", psychotherapy: "Psychotherapy", neuromodulation: "Neuromodulation", other: "Other" },
      unknownModality: "Not in the pack",
      direction: (row: { favours: number; against: number; unclear: number; notComputable: number; unconfirmed: number; trials: number }) => {
        const text = [
          row.favours > 0 ? `favours the treatment in ${row.favours} of ${row.trials} ${row.trials === 1 ? "trial" : "trials"}` : "",
          row.against > 0 ? `favours the comparator in ${row.against}` : "",
          row.unclear > 0 ? `no clear difference in ${row.unclear}` : "",
          row.notComputable > 0 ? `not computable in ${row.notComputable}` : "",
          row.unconfirmed > 0 ? `direction not yet confirmed in ${row.unconfirmed}` : "",
        ].filter(Boolean).join("; ")
        return text.charAt(0).toUpperCase() + text.slice(1)
      },
      toCheck: (count: number) => `${count} ${count === 1 ? "trial has" : "trials have"} values still to check`,
      empty: (condition: string) => `No trial data has been extracted for ${condition} yet. Open a trial from your feed and choose “Extract trial data”.`,
      notAQuery: "This block does not name a condition. It should read: condition: <the pack's id of the condition>.",
      note: "Counted from the trial data you have extracted. Not a meta-analysis: trials are counted, not pooled.",
      loading: "Counting…",
      none: "-",
    },
    requestFailed: (status: number) => `The trial data could not be reached (${status}).`,
    heading: "Trial data",
    extract: "Extract trial data", extracting: "Reading the paper…",
    extractNote: "Reads the paper, the full text when it can be had, and uses your AI model. Each value is kept only if the sentence given for it is in the paper.",
    fromFullText: "Read by AI from the full text", fromAbstract: "Read by AI from the abstract only",
    truncated: (source: string) => `${source}. The paper was too long to read whole: its middle was left out, so a value printed there is missing here.`,
    toCheck: (count: number) => `${count} ${count === 1 ? "value" : "values"} to check`,
    allChecked: "Every value has been checked by you",
    dropped: (count: number) => `${count} ${count === 1 ? "value" : "values"} the model gave failed the check against the paper and ${count === 1 ? "was" : "were"} left out.`,
    arms: "Groups", outcomes: "Outcomes", primary: "Primary outcome",
    roles: { treatment: "Treatment", control: "Comparator" },
    fields: { condition: "Condition", treatment: "Received", n: "Number", name: "Outcome", instrument: "Measured with", timepoint: "When", mean: "Mean", sd: "SD", events: "Events", role: "Role", benefit: "Better result", primary: "Primary outcome" },
    /** The three things a model also writes and no sentence proves. A direction is shown only once a person has confirmed them. */
    benefit: { lower: "A lower score or fewer events", higher: "A higher score or more events", unclear: "Not clear from the paper" },
    primaryChoice: { yes: "Yes, the primary outcome", no: "No, a secondary outcome" },
    /** What the record is filed under in the pack: this decides the table and the row a trial is counted in. */
    filedUnder: (name: string) => `Filed under: ${name}`,
    notFiled: "Not in the pack",
    notFiledCondition: "Not filed under a condition of the pack: this trial appears in no table",
    fileUnder: (label: string) => `File ${label.toLowerCase()} under`,
    states: { unverified: "Not checked", "quote-verified": "Matched to a sentence", "human-confirmed": "Confirmed by you", "human-edited": "Corrected by you" },
    /** Not "not reported": the paper may print the value where the check dropped it, or in a part that was not read. */
    unknown: "No checked value",
    confirm: "Confirm", edit: "Edit", save: "Save", cancel: "Cancel", sourceSentence: "Source sentence",
    measures: { g: "Hedges g", rr: "Risk ratio" },
    directions: { "favours-treatment": "favours the treatment", "favours-control": "favours the comparator", "no-clear-difference": "no clear difference", "not-computable": "Effect not computable from the values reported",
      unconfirmed: "No direction is shown yet: first confirm which result is the better one for this outcome, and the role of both groups.",
    },
    /** A risk ratio is the treatment's risk over the comparator's, as a paper prints it. Hedges g is turned, and the line says which way. */
    intervalNotes: { g: "; above 0 favours the treatment", rr: "" },
    versus: (treatment: string, comparator: string) => `${treatment} vs ${comparator}`,
    effect: (measure: string, estimate: string, low: string, high: string, note: string, compared: string, direction: string) => `${measure} ${estimate} (95% CI ${low} to ${high}${note}) · ${compared} · ${direction}`,
    effectNote: "Computed by this app from the numbers above, not taken from the paper and not written by AI. One trial is not a meta-analysis.",
  },
  /** Notes: the Library's note pages, and what the notes route answers when it cannot do what was asked. */
  notes: {
    /** The title shown for a note that has no title and no text. */
    untitled: "Untitled note",
    badRequest: "The request was not understood.",
    notFound: "That note is not in your Library.",
    /** The line under the title of a conversation that started from a note. */
    chatAbout: (title: string) => `About your note: ${title}`,
    chatOneSubject: "A conversation about a note cannot also be about a paper or a project.",
    chatNoteFirst: "A note can only be attached when a conversation starts.",
    chatAnswerFailed: "I couldn't answer from this note just now. Your question is saved; try again.",
    conflict: "This note was changed somewhere else since you opened it.",
    tooLong: "This note is too long to save. Shorten it, or move part of it to another note.",
    /** On the start of a conversation about a note, when the reader chose to search or to review: those do not read the note. */
    chatQuestionsOnly: "Your note is only used for questions. A paper search or a deep review does not read it.",
    unknownPaper: "That paper could not be found, so it cannot be cited.",
    paperNotSaved: "That paper could not be saved to your Library, so the note was not made.",
    nameTaken: "A note of that name is being made at the same time. Try again.",
    unknownCondition: "That condition is not in the pack.",
    unknownTreatment: "That treatment is not in the pack.",
    requestFailed: (status: number) => `Your notes could not be reached (${status}).`,
    /** The Library view (`/wiki?view=all`): its row of tabs, and the Papers tab when the Library has no paper. */
    library: {
      tabsLabel: "Parts of your Library",
      tabs: { papers: "Papers", "read-later": "Read later", history: "History", chats: "Saved chats" },
      noPapers: "Your Library has no papers yet",
      noPapersHint: "Search for papers to start building it.",
      searchPapers: "Search for papers →",
    },
    /** The list of the Notes page (`/notes`). */
    list: {
      searchLabel: "Search your notes",
      searchPlaceholder: "Search notes",
      conditionLabel: "Condition",
      allConditions: "All conditions",
      kindLabel: "What a note is about",
      kinds: { all: "All", paper: "On a paper", topic: "On a topic", none: "Not linked" },
      newNote: "New note",
      loading: "Loading your notes…",
      papers: (count: number) => `${count} ${count === 1 ? "paper" : "papers"}`,
      newSince: (count: number) => `${count} new ${count === 1 ? "paper" : "papers"} since your last edit`,
      project: "Project",
      /** The day a note was last edited, from its `YYYY-MM-DD`; a day that does not read as one is shown as it is. */
      edited: (day: string) => {
        const [year, month, date] = day.split("-").map(Number)
        return MONTHS[month - 1] && date ? `Edited ${MONTHS[month - 1]} ${date}, ${year}` : `Edited ${day}`
      },
      none: "You have no notes yet",
      noneHint: "A note can cite papers and link the conditions and treatments it is about.",
      noMatch: "No note matches these filters",
      clear: "Clear filters",
      /** The treatment the address names, as a chip that can be removed. */
      treatment: (name: string) => `Treatment: ${name}`,
      removeTreatment: "Remove the treatment filter",
      removeMark: "×",
    },
    /** The reader's notes where they are reading: on a paper's page, under a condition's tab, in a treatment's header. */
    strip: {
      heading: "Your notes",
      write: "Write a note",
      onCondition: (name: string, count: number) => `Your notes on ${name} (${count})`,
      count: (count: number) => `${count} ${count === 1 ? "note" : "notes"}`,
    },
    /** The page of one note. */
    page: {
      loading: "Loading this note…",
      titleLabel: "Title of the note",
      bodyLabel: "Text of the note",
      bodyPlaceholder: "Write here.",
      /** The two ways the text is shown: the field it is written in, and the text as it reads, with its links. */
      tabsLabel: "How the text is shown",
      tabs: { edit: "Edit", preview: "Preview" },
      previewEmpty: "Nothing to preview yet.",
      aboutLabel: "What this note is about",
      /** A day as `YYYY-MM-DD`, as it is read; one that does not read as a day is shown as it is. */
      day: (day: string) => {
        const [year, month, date] = day.split("-").map(Number)
        return MONTHS[month - 1] && date ? `${MONTHS[month - 1]} ${date}, ${year}` : day
      },
      newSince: (count: number, since: string) => `${count} new ${count === 1 ? "paper" : "papers"} on these since ${since}`,
      show: "Show",
      hide: "Hide",
      cite: "Cite",
      citePaper: "Cite a paper",
      linkTopic: "Link a condition or treatment",
      copy: "Copy with references",
      copied: "Copied",
      copyFailed: "This could not be copied.",
      ask: "Ask about this note",
      remove: "Delete",
      saved: "Saved",
      saving: "Saving…",
      retry: "Retry",
      askHint: "Asking sends this note and its cited papers to your model provider.",
      conflictStored: "The stored version",
      keepMine: "Keep mine",
      useStored: "Use the stored one",
      links: "Links in this note",
      notFound: "not found",
      references: "References",
      savedToLibrary: "Saved to your Library",
      close: "Close",
      citeSearch: "Search for a paper to cite",
      citePlaceholder: "Title, author or year",
      citeSearching: "Searching…",
      citeNone: "No paper matches.",
      inLibrary: "In your Library",
      topicFilter: "Find a condition",
      topicLoading: "Loading…",
      topicNone: "No condition matches.",
      linkCondition: (name: string) => `Link ${name}`,
      treatmentsHint: "Or link one of the treatments your feed has seen for this condition:",
      noTreatments: "Your feed has seen no treatment for this condition yet.",
      backToConditions: "← Conditions",
    },
  },
  evidence: {
    /** The Evidence view: a tab for each condition, and under it the summary and the notes. */
    page: {
      conditionsLabel: "Conditions you follow",
      none: "You are not following a condition yet.", addTopics: "Add one under My topics",
      loading: "Loading…",
      /** The button after the last tab, and the list it opens: the conditions of the pack that have no tab yet. */
      add: "+", addLabel: "Add a condition", addList: "Conditions to add", addLoading: "Loading…",
      addNone: "Every condition of the pack is already shown.",
      scopeLabel: "Papers",
      scopes: { all: "Everything my feed listed", saved: (count: number | null) => (count === null ? "Saved to Library" : `Saved to Library (${count})`) },
    },
    badRequest: "The request was not understood.",
    noSuchCondition: "That condition is not in the pack.",
    requestFailed: (status: number) => `The evidence could not be reached (${status}).`,
    /** The line above the sections. `since` is the day the earliest paper was first listed. */
    basis: (count: number, condition: string, since: string | null) =>
      `From the ${count} ${count === 1 ? "paper" : "papers"} your feed has listed on ${condition}${since ? ` since ${since}` : ""}. Not all the evidence on it; papers are counted, nothing is pooled.`,
    basisPeriod: (count: number, collected: number, phrase: string, condition: string) =>
      `${count} of ${collected} ${collected === 1 ? "paper" : "papers"} your feed has listed on ${condition}, published in the last ${phrase}. Not all the evidence on it; papers are counted, nothing is pooled.`,
    /** The same line when only the papers the reader saved are shown. */
    basisSaved: (count: number, condition: string) =>
      `From the ${count} ${count === 1 ? "paper" : "papers"} you saved to your Library on ${condition}. Not all the evidence on it; papers are counted, nothing is pooled.`,
    basisSavedPeriod: (count: number, saved: number, phrase: string, condition: string) =>
      `${count} of the ${saved} ${saved === 1 ? "paper" : "papers"} you saved to your Library on ${condition}, published in the last ${phrase}. Not all the evidence on it; papers are counted, nothing is pooled.`,
    /** `control` and `everything` are the name of the control that says which papers are shown, and of its choice of all of them. */
    noneSaved: (condition: string, control: string, everything: string) =>
      `You have not saved a paper on ${condition} to your Library yet. To see every paper your feed listed on it, choose “${everything}” under ${control}.`,
    emptySavedPeriod: (condition: string, phrase: string, saved: number) =>
      `None of the ${saved} ${saved === 1 ? "paper" : "papers"} you saved on ${condition} was published in the last ${phrase}.`,
    empty: (condition: string) => `Your feed has not listed a paper on ${condition} yet. Follow it under My topics and refresh your feed.`,
    emptyPeriod: (condition: string, phrase: string, collected: number) => `No paper on ${condition} was published in the last ${phrase}. ${collected} ${collected === 1 ? "is" : "are"} collected in all.`,
    notAQuery: "This block does not name a condition. It should read: condition: <the pack's id of the condition>.",
    loading: "Counting…",
    periodLabel: "Period",
    periods: { all: "All time", "12m": "Last 12 months", "6m": "Last 6 months", "3m": "Last 3 months" },
    /** After "in the last". */
    periodPhrases: { "12m": "12 months", "6m": "6 months", "3m": "3 months" },
    sections: { treatments: "Treatments", safety: "Safety", research: "Other research" },
    treatmentsEmpty: "None of these papers reports whether a treatment worked.",
    safetyEmpty: "No safety findings among these papers.",
    researchEmpty: "No other research among these papers.",
    /** Class names by their key, for classes the pack does not name. */
    classLabels: { medicine: "Medicines", psychotherapy: "Psychotherapy", neuromodulation: "Neuromodulation", digital: "Digital tools", lifestyle: "Lifestyle", other: "Other treatments" },
    researchTypes: { "risk-factor": "Risk factors", prediction: "Prediction and biomarkers", mechanism: "Mechanisms", epidemiology: "Epidemiology", services: "Services and policy", "no-efficacy": "Treatment studied, not sorted by result", other: "Other" },
    /** A review or an editorial is not a study, so papers are counted. */
    newCount: (count: number) => `+${count} new`,
    /** Under the bubble of a treatment that has safety papers. They are listed under Safety. */
    safetyMark: (count: number) => `${count} safety`,
    /** Under the bubble of a treatment that other papers used as their comparator. Those papers are not in its number or its colours. */
    comparedMark: (count: number) => `compared in ${count}`,
    /** The two lines over the map of treatments. */
    lines: {
      one: "Each bubble is a treatment; its size is the number of papers.",
      colours: "Colour shows whether the treatment was beneficial or not, based on an AI reading of the abstract.",
    },
    /**
     * What a bubble says to a reader who does not see it. `efficacy` is null for a bubble that has no colours of direction.
     * What is new, the safety papers and the papers it was the comparison in are added when there are any.
     */
    bubbleLabel: (name: string, papers: number, efficacy: { benefit: number; "no-benefit": number; mixed: number } | null, newPapers: number, safetyPapers: number, comparatorPapers = 0, position: string | null = null) =>
      [
        `${name}: ${papers} ${papers === 1 ? "paper" : "papers"}`,
        ...(efficacy ? [`${efficacy.benefit} benefit, ${efficacy["no-benefit"]} no benefit, ${efficacy.mixed} mixed`] : []),
        ...(newPapers > 0 ? [`${newPapers} new`] : []),
        ...(safetyPapers > 0 ? [`${safetyPapers} safety`] : []),
        ...(comparatorPapers > 0 ? [`the comparison in ${comparatorPapers} other ${comparatorPapers === 1 ? "paper" : "papers"}`] : []),
        ...(position ? [position] : []),
      ].join("; "),
    /**
     * The map of treatments: across, when the newest paper of a class or of a treatment was published; up, the
     * participants its papers state, added up, on a log scale. Nothing is pooled: these are dates, counts and stated sizes.
     */
    map: {
      /** Along the y axis: what is up. */
      axis: "Total participants (log scale)",
      /** Under the map: what is across. */
      timeAxis: "Most recent publication date",
      /** The band of the items whose papers state no participants, and the column of those whose papers have no date. */
      notStated: "not stated",
      noDate: "no date",
      tick: (value: number) => value.toLocaleString("en-US"),
      /** A month of a year, or a year alone, on the axis and in the grid of a narrow screen. `month` is 1 to 12. */
      when: (year: number, month: number | null) => (month === null ? `${year}` : `${MONTHS[month - 1]} ${year}`),
      /** A day on the axis, when it has a tick a week. */
      day: (month: number, day: number) => `${MONTHS[month - 1]} ${day}`,
      /** Under a name in the grid of a narrow screen: when its newest paper was published, then its participants. */
      tileLine: (when: string | null, count: number | null) =>
        `${when ?? "no date"} · ${count === null ? "participants not stated" : `${count.toLocaleString("en-US")} ${count === 1 ? "participant" : "participants"}`}`,
      /** The last parts of what a bubble of the map says to a reader who does not see it. `newest` is the date as the paper prints it; `sized` of its `papers` state their participants. */
      position: (newest: string | null, count: number | null, sized: number, papers: number) =>
        [
          newest === null ? "no publication date" : `most recent paper ${newest}`,
          count === null ? "participants not stated" : `${count.toLocaleString("en-US")} ${count === 1 ? "participant" : "participants"} in ${sized} of ${papers} ${papers === 1 ? "paper" : "papers"}`,
        ].join("; "),
      /** Between two marks on the one line under a name. */
      markGap: " · ",
    },
    /** The names of the groups of bubbles, for a screen reader. */
    rows: {
      classes: "Classes of treatment", treatments: (className: string) => `Treatments in ${className}`,
      safety: "Safety papers, by treatment", research: "Other research, by kind",
    },
    allClasses: "All classes",
    /** Between the two parts of the crumb line. */
    crumbGap: " › ",
    kindLabels: { benefit: "Benefit", "no-benefit": "No benefit", mixed: "Mixed", safety: "Safety", other: "Other" },
    /** The line over a table: whose papers they are, and how many. */
    tableHeading: (name: string, count: number) => `${name} · ${count} ${count === 1 ? "paper" : "papers"}`,
    /**
     * Under the table of a treatment: the papers of another treatment that used this one as their comparator, in a table
     * of their own. The result of each is of the treatment that paper tested, which has its own column.
     */
    comparedName: "Used as the comparison",
    columns: { study: "Study", design: "Design", size: "n", sizeTitle: "Participants, as the paper prints it", population: "Population", comparator: "Compared with", outcome: "Outcome", result: "Result", finding: "Finding", details: "Details", tested: "Treatment tested" },
    /** A cell whose value the paper does not state. */
    noValue: "–",
    studyMarks: { new: "new", saved: "saved" },
  },
} as const

export type StageKey = keyof typeof CLINICAL_COPY.stages
