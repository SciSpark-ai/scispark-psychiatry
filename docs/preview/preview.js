// SciSpark Psychiatry: the static, read-only preview. Vanilla JavaScript, no framework, no network.
//
// It draws three pages of the app from window.SAMPLE (sample-data.js). The wording, the shapes of a bubble and the
// scales and places of the map are the app's own modules (window.APP_LIB, app-lib.js, generated from the app's source).
// Nothing is saved, nothing is sent, and no model is called.
(function () {
  "use strict"

  var S = window.SAMPLE
  var LIB = window.APP_LIB
  var view = document.getElementById("view")
  if (!S || !LIB || !view) return

  var C = LIB.copy.CLINICAL_COPY
  var E = C.evidence, M = E.map, F = C.feed, N = C.notes, L = N.list, P = N.page, K = E.columns
  var shapes = LIB.shapes, maps = LIB.map
  var SVG_NS = "http://www.w3.org/2000/svg"
  var NUMBER = new Intl.NumberFormat("en-US")
  /** One tint per topic, as the app's cards have (ClinicalFeedCard). */
  var TONES = ["var(--band-impact)", "var(--band-method)", "var(--band-breakthrough)", "var(--band-evidence)", "var(--band-trending)", "var(--band-application)", "var(--band-dataset)", "var(--band-review)"]
  /** Over this many items a map is drawn as a grid (EvidenceMap). */
  var MOST_MAPPED = 20
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // ------------------------------------------------------------------ small DOM helpers
  function fill(el, attrs, children, svg) {
    Object.keys(attrs || {}).forEach(function (name) {
      var value = attrs[name]
      if (value === null || value === undefined || value === false) return
      if (name.slice(0, 2) === "on") el.addEventListener(name.slice(2), value)
      else if (name === "class" && !svg) el.className = value
      else el.setAttribute(name, value === true ? "" : String(value))
    })
    ;(function add(list) {
      list.forEach(function (child) {
        if (child === null || child === undefined || child === false) return
        if (Array.isArray(child)) add(child)
        else el.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)))
      })
    })(children)
    return el
  }
  function h(tag, attrs) { return fill(document.createElement(tag), attrs, Array.prototype.slice.call(arguments, 2), false) }
  function s(tag, attrs) { return fill(document.createElementNS(SVG_NS, tag), attrs, Array.prototype.slice.call(arguments, 2), true) }
  var px = function (value) { return Number(value.toFixed(2)) + "px" }

  // ------------------------------------------------------------------ state
  var state = {
    view: "feed",
    topic: null,
    condition: S.conditions[0].code,
    chosen: { classKey: null, treatment: null, safety: null, research: null },
    note: null, noteTab: "preview", q: "", kind: null, noteCondition: "",
  }
  var observers = []
  var tour = null

  /** Draws the page again; the keyboard stays on what it was on, or goes to `focus` (a data-fid). */
  function render(focus) {
    var active = document.activeElement
    var keep = focus || (active && view.contains(active) ? active.getAttribute("data-fid") : null)
    observers.forEach(function (observer) { observer.disconnect() })
    observers = []
    view.replaceChildren(VIEWS[state.view] ? VIEWS[state.view]() : stubView(state.view))
    Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (button) {
      if (button.getAttribute("data-view") === state.view) button.setAttribute("aria-current", "page")
      else button.removeAttribute("aria-current")
    })
    if (keep) focusOn(keep)
    if (tour) markTour()
  }
  function focusOn(fid) {
    var found = Array.prototype.filter.call(view.querySelectorAll("[data-fid]"), function (el) { return el.getAttribute("data-fid") === fid })
    var target = found.filter(function (el) { return el.offsetParent !== null })[0] || found[0]
    if (target) target.focus({ preventScroll: true })
  }
  function go(next, focus) {
    Object.keys(next).forEach(function (key) { state[key] = next[key] })
    render(focus)
  }

  // ------------------------------------------------------------------ the paper panel
  var dialog = h("dialog", { class: "paper", "aria-labelledby": "paper-title" })
  document.body.appendChild(dialog)
  dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close() })
  var opener = null
  dialog.addEventListener("close", function () { if (opener && document.contains(opener)) opener.focus(); opener = null })

  var publishedOf = function (paper) { return paper.date ? paper.date.slice(0, 10) : paper.year ? String(paper.year) : null }

  function openPaper(slug) {
    var paper = S.papers[slug]
    if (!paper) return
    var from = document.activeElement
    closeTour(false)
    var card = S.feed.cards.filter(function (entry) { return entry.paper === slug })[0] || null
    var H = C.paper.header
    var published = publishedOf(paper)
    var dates = [published ? H.published(published) : null, paper.added && paper.added !== published ? H.inPubmed(paper.added) : null].filter(Boolean).join(H.separator)
    var authors = paper.authors.join(H.authorJoin) + (paper.moreAuthors > 0 ? H.authorJoin + H.moreAuthors(paper.moreAuthors).replace(/^… | …$/g, "") : "")
    var rows = [
      [K.result, paper.text || paper.kind ? [paper.text || "", paper.kind ? h("span", { class: "kind", style: "color:" + shapes.KIND_TEXT_COLOUR[paper.kind] + (paper.text ? "" : ";margin-left:0") }, E.kindLabels[paper.kind]) : null] : null],
      [K.tested, paper.treatment],
      [K.comparator, paper.comparator],
      [K.population, paper.population],
      [K.outcome, paper.outcome],
      [K.size, paper.sampleSize === null ? null : NUMBER.format(paper.sampleSize) + " (" + K.sizeTitle.toLowerCase() + ")"],
    ].filter(function (row) { return row[1] !== null && row[1] !== undefined && row[1] !== "" })
    dialog.replaceChildren(h("div", { class: "paper-in" },
      h("div", { class: "paper-top" },
        h("div", { class: "paper-chips" },
          paper.designNamed || (card && designShown(card)) ? h("span", { class: "chip-design" }, C.designLabels[paper.design]) : null,
          card ? h("span", { class: "chip-topic" }, card.topicLabel) : null),
        h("button", { type: "button", class: "close", onclick: function () { dialog.close() } }, P.close)),
      h("h2", { id: "paper-title" }, paper.headline),
      h("div", { class: "original" }, h("small", null, H.originalTitle), h("p", null, paper.title)),
      h("div", { class: "meta" },
        h("p", null, paper.venue ? h("span", { class: "journal" }, paper.venue) : null, dates ? h("span", { class: "dates" }, dates) : null),
        authors ? h("p", { class: "who" }, authors) : null,
        h("p", { class: "ids" },
          paper.doi ? h("a", { href: "https://doi.org/" + paper.doi, target: "_blank", rel: "noreferrer" }, H.doi(paper.doi)) : null,
          paper.pmid ? h("a", { href: "https://pubmed.ncbi.nlm.nih.gov/" + paper.pmid + "/", target: "_blank", rel: "noreferrer" }, H.pmid(paper.pmid)) : null)),
      h("section", { class: "card summary", "aria-label": C.paper.aiSummary },
        h("span", { class: "panel-label" }, C.paper.aiSummary),
        h("p", null, card ? card.takeaway : paper.takeaway),
        card && card.tags.length > 0 ? h("div", { class: "chips" }, card.tags.map(function (tag) { return h("span", { class: "chip" }, tag) })) : null),
      h("section", { class: "fields", "aria-label": "Fields read from the paper by AI" },
        h("span", { class: "panel-label" }, "Read from the paper by AI, as the Wiki's tables show it"),
        rows.length > 0
          ? h("dl", null, rows.map(function (row) { return [h("dt", null, row[0]), h("dd", null, row[1])] }))
          : h("p", { class: "panel-note" }, "Nothing was sorted for this paper: it names no treatment and no result.")),
      h("p", { class: "panel-note" }, "In the app this is the paper's own page, which also shows the abstract by section, an optional longer digest and your notes on the paper. The abstract is not part of this preview: follow the DOI to read it. " + C.aiCanBeWrong)))
    opener = from
    if (typeof dialog.showModal === "function") dialog.showModal()
    else dialog.setAttribute("open", "")
  }

  // ------------------------------------------------------------------ What's new
  var designShown = function (card) {
    var inferred = (card.designSource === "model" || card.designSource === "text-rule") && card.design !== "other" && card.design !== "unknown"
    return card.designSource === "publication-type" || inferred
  }

  function feedCard(card) {
    var paper = S.papers[card.paper]
    var published = publishedOf(paper)
    var source = [paper.venue].concat(paper.added && published && paper.added !== published ? [F.publishedOn(published), F.inPubmed(paper.added)] : [published]).filter(Boolean).join(" · ")
    var inferred = card.designSource !== "publication-type"
    return h("article", { class: "card feed-card", style: "--card-tone:" + TONES[card.tone % TONES.length], onclick: function () { openPaper(card.paper) } },
      h("p", { class: "tags" },
        h("span", { class: "topic" }, card.topicLabel),
        designShown(card) ? h("span", { title: inferred ? C.designInferredNote : C.designNote }, C.designLabels[card.design]) : null),
      h("h3", null, h("button", { type: "button", "data-fid": "card:" + card.paper, title: paper.title, onclick: function (event) { event.stopPropagation(); openPaper(card.paper) } }, card.headline)),
      source ? h("p", { class: "source", title: source }, source) : null,
      h("p", { class: "takeaway" }, card.takeaway))
  }

  function feedView() {
    var all = S.feed.cards
    var shown = all.filter(function (card) { return state.topic === null || card.topic === state.topic })
    var tabs = [{ id: null, label: F.allTopics, count: all.length }].concat(S.feed.topics.map(function (topic) {
      return { id: topic.id, label: topic.label, count: all.filter(function (card) { return card.topic === topic.id }).length }
    }))
    var range = S.feed.lookBack && F.lookBackOptions[S.feed.lookBack] ? " · " + F.lastRange(F.lookBackOptions[S.feed.lookBack]) : ""
    return h("div", null,
      h("h1", { tabindex: "-1", "data-fid": "heading" }, F.heading),
      h("p", { class: "status" }, all.length + " sample papers, from a search that listed " + S.feed.listed + (S.feed.found ? " of " + S.feed.found + " found in PubMed" : "") + range + " · updated " + S.feed.updated),
      h("div", { class: "pill-tabs", role: "tablist", "aria-label": F.topicsLabel }, tabs.map(function (tab) {
        return h("button", { type: "button", role: "tab", "aria-selected": String(state.topic === tab.id), "aria-controls": "feed-panel", "data-fid": "topic:" + tab.id, onclick: function () { go({ topic: tab.id }) } },
          tab.label, " ", h("small", null, tab.count))
      })),
      h("div", { id: "feed-panel", role: "tabpanel", class: "feed-grid" }, shown.map(feedCard)),
      h("p", { class: "foot-note" }, F.aiNotice + " " + C.disclaimerGrades))
  }

  // ------------------------------------------------------------------ the Wiki: bubbles
  /** The disc of a bubble (BubbleDisc): a ring divided by what the papers found, or one light disc; the number in it. */
  function disc(radius, papers, efficacy, safetyPapers, fluid) {
    var size = 2 * radius
    var slices = efficacy ? shapes.pieSlices(efficacy) : []
    var turned = 0
    var svg = s("svg", { "aria-hidden": "true", width: fluid ? "100%" : size, height: fluid ? "100%" : size, viewBox: "0 0 " + size + " " + size })
    if (slices.length === 0) svg.appendChild(s("circle", { cx: radius, cy: radius, r: radius - 0.5, fill: shapes.LIGHT_FILL, stroke: shapes.LIGHT_EDGE, "stroke-width": 1 }))
    else if (slices.length === 1) svg.appendChild(s("circle", { cx: radius, cy: radius, r: radius, fill: shapes.KIND_COLOUR[slices[0].kind] }))
    else slices.forEach(function (slice) {
      var from = turned
      turned += slice.fraction
      svg.appendChild(s("path", { d: shapes.arcPath(radius, radius, radius, from, turned), fill: shapes.KIND_COLOUR[slice.kind] }))
    })
    if (slices.length > 0) svg.appendChild(s("circle", { cx: radius, cy: radius, r: radius * 0.6, fill: shapes.CENTRE_FILL }))
    if (safetyPapers > 0) svg.appendChild(s("circle", { cx: radius, cy: radius, r: radius + 3, fill: "none", stroke: shapes.SAFETY_COLOUR, "stroke-width": 2 }))
    svg.appendChild(s("text", { x: radius, y: radius, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 15, "font-weight": 600, fill: shapes.NUMBER_COLOUR }, papers))
    return svg
  }
  var discBoxHeight = function (papers) { return 2 * Math.max.apply(null, [0].concat(papers.map(shapes.bubbleRadius))) + 8 }

  /** One bubble in a tile of a grid (EvidenceBubble). */
  function tile(entry, opts) {
    var says = E.bubbleLabel(entry.name, entry.papers, entry.efficacy || null, entry.newPapers || 0, entry.safetyPapers || 0, entry.comparatorPapers || 0, opts.position || null)
    return h("button", { type: "button", class: "tile", "data-fid": "b:" + entry.key, "aria-pressed": String(!!opts.pressed), "aria-label": says, onclick: opts.onPick },
      h("span", { class: "box", style: "height:" + opts.boxHeight + "px" }, h("span", { class: "ground" }, disc(shapes.bubbleRadius(entry.papers), entry.papers, entry.efficacy, entry.safetyPapers || 0, false))),
      h("span", { class: "name" }, entry.name),
      opts.detail ? h("span", { class: "detail" }, opts.detail) : null,
      entry.newPapers > 0 ? h("span", { class: "new" }, E.newCount(entry.newPapers)) : null,
      entry.safetyPapers > 0 ? h("span", { class: "safety" }, h("i", { "aria-hidden": "true" }), h("span", null, E.safetyMark(entry.safetyPapers))) : null,
      entry.comparatorPapers > 0 ? h("span", { class: "compared" }, E.comparedMark(entry.comparatorPapers)) : null)
  }

  function legend() {
    return h("ul", { class: "legend" }, shapes.EFFICACY_KINDS.map(function (kind) {
      return h("li", null, h("i", { "aria-hidden": "true", style: "background:" + shapes.KIND_COLOUR[kind] }), h("span", null, E.kindLabels[kind]))
    }))
  }

  /**
   * The map of the classes, or of the treatments of one class (EvidenceMap): across, the date of the newest paper of
   * each; up, the participants its papers state, on a log scale, with a band for those that state none. The scales
   * and the places are the app's own (`mapScales`, `layoutMap`), worked out for the measured width. Under 640 px, and
   * for more than twenty items, the same bubbles are a grid.
   */
  function mapOf(label, entries, chosen, onPick) {
    var boxHeight = discBoxHeight(entries.map(function (entry) { return entry.papers }))
    var drawn = entries.map(function (entry) {
      var newest = maps.newestDate(entry.dates)
      var parts = newest === null ? null : maps.dateParts(newest)
      var position = M.position(newest, entry.participants, entry.sized, entry.papers)
      var marks = [entry.newPapers > 0 ? E.newCount(entry.newPapers) : null, entry.safetyPapers > 0 ? E.safetyMark(entry.safetyPapers) : null, entry.comparatorPapers > 0 ? E.comparedMark(entry.comparatorPapers) : null].filter(Boolean).join(M.markGap)
      return {
        entry: entry, marks: marks, position: position, pressed: entry.key === chosen,
        line: M.tileLine(parts ? M.when(parts.year, parts.month) : null, entry.participants),
        says: E.bubbleLabel(entry.name, entry.papers, entry.efficacy, entry.newPapers, entry.safetyPapers || 0, entry.comparatorPapers || 0, position),
      }
    })
    var tiles = function () {
      return drawn.map(function (each) { return tile(each.entry, { boxHeight: boxHeight, detail: each.line, position: each.position, pressed: each.pressed, onPick: function () { onPick(each.entry.key) } }) })
    }
    if (entries.length > MOST_MAPPED) return h("div", { class: "map-root" }, legend(), h("div", { class: "tiles", role: "group", "aria-label": label }, tiles()))

    var wide = h("div", { class: "map-wide" })
    var plot = h("div", { class: "map-plot" }, wide, h("div", { class: "map-narrow" }, h("div", { class: "tiles two", role: "group", "aria-label": label }, tiles())))
    var items = drawn.map(function (each) { return { key: each.entry.key, name: each.entry.name, papers: each.entry.papers, participants: each.entry.participants, dates: each.entry.dates, marks: each.marks || undefined } })
    var drawnFor = 0

    function draw(measured) {
      var size = maps.mapSizeFor(measured)
      if (size.width === drawnFor) return
      drawnFor = size.width
      var scales = maps.mapScales(items, size)
      var places = maps.layoutMap(items, size)
      var plotBox = scales.plot, column = scales.column, band = scales.band, bandY = scales.bandY
      var text = function (attrs, value) { return s("text", Object.assign({ fill: shapes.AXIS_TEXT_COLOUR }, attrs), value) }
      var svg = s("svg", { "aria-hidden": "true", viewBox: "0 0 " + size.width + " " + size.height })
      if (band) svg.appendChild(s("rect", { x: plotBox.left, y: band.top, width: plotBox.right - plotBox.left, height: band.bottom - band.top, rx: 12, fill: shapes.COLUMN_FILL }))
      if (band && bandY !== null) svg.appendChild(text({ x: plotBox.left - 8, y: bandY, "text-anchor": "end", "dominant-baseline": "central", "font-size": 12 }, M.notStated))
      if (column) {
        svg.appendChild(s("rect", { x: column.left, y: plotBox.top, width: column.right - column.left, height: plotBox.bottom - plotBox.top, rx: 12, fill: shapes.COLUMN_FILL }))
        svg.appendChild(text({ x: (column.left + column.right) / 2, y: plotBox.bottom + 18, "text-anchor": "middle", "font-size": 13 }, M.noDate))
      }
      scales.ticksY.forEach(function (tick) {
        svg.appendChild(s("line", { x1: plotBox.left, x2: plotBox.right, y1: tick.y, y2: tick.y, stroke: shapes.GRID_COLOUR, "stroke-width": 1 }))
        svg.appendChild(text({ x: plotBox.left - 8, y: tick.y, "text-anchor": "end", "dominant-baseline": "central", "font-size": 13 }, M.tick(tick.value)))
      })
      scales.ticksX.forEach(function (tick) {
        svg.appendChild(s("line", { x1: tick.x, x2: tick.x, y1: plotBox.top, y2: plotBox.bottom, stroke: shapes.GRID_COLOUR, "stroke-width": 1 }))
        if (tick.labelled) svg.appendChild(text({ x: tick.x, y: plotBox.bottom + 18, "text-anchor": "middle", "font-size": 13 }, tick.day !== null && tick.month !== null ? M.day(tick.month, tick.day) : M.when(tick.year, tick.month)))
      })
      svg.appendChild(s("rect", { x: plotBox.left, y: plotBox.top, width: plotBox.right - plotBox.left, height: plotBox.bottom - plotBox.top, rx: 12, fill: "none", stroke: shapes.GRID_COLOUR, "stroke-width": 1 }))
      places.filter(function (place) { return place.displaced }).forEach(function (place) {
        svg.appendChild(s("line", { x1: place.home.x, y1: place.home.y, x2: place.x, y2: place.y, stroke: shapes.AXIS_TEXT_COLOUR, "stroke-width": 1, "stroke-dasharray": "2 2" }))
        svg.appendChild(s("circle", { cx: place.home.x, cy: place.home.y, r: 2.5, fill: shapes.AXIS_TEXT_COLOUR }))
      })
      // From left to right, and from the top down: the order a reader tabs through.
      var bubbles = drawn.map(function (each, at) { return { each: each, at: places[at] } })
        .sort(function (a, b) { return a.at.x - b.at.x || a.at.y - b.at.y || (a.each.entry.key < b.each.entry.key ? -1 : 1) })
        .map(function (item) {
          var each = item.each, at = item.at, entry = each.entry
          return h("button", { type: "button", class: "bubble", "data-fid": "b:" + entry.key, "aria-pressed": String(each.pressed), "aria-label": each.says, title: each.says,
            style: "left:" + px(at.x) + ";top:" + px(at.y) + ";width:" + px(2 * at.r), onclick: function () { onPick(entry.key) } },
            h("span", { class: "disc" }, disc(at.r, entry.papers, entry.efficacy, entry.safetyPapers || 0, true)),
            h("span", { class: "label " + (at.labelAbove ? "above" : "under"), style: at.labelShift === 0 ? null : "margin-left:" + at.labelShift + "px" },
              h("span", { class: "name" }, entry.name),
              each.marks ? h("span", { class: "marks" }, each.marks) : null))
        })
      var held = document.activeElement && wide.contains(document.activeElement) ? document.activeElement.getAttribute("data-fid") : null
      wide.replaceChildren(
        h("div", { class: "map-box", role: "group", "aria-label": label, style: "height:" + size.height + "px" },
          h("span", { class: "axis-y" }, h("span", null, M.axis)), svg, bubbles),
        h("p", { class: "axis-x" }, M.timeAxis))
      if (held) focusOn(held)
    }

    draw(maps.DEFAULT_MAP_WIDTH)
    if (typeof ResizeObserver === "function") {
      var observer = new ResizeObserver(function () { if (plot.clientWidth > 0) draw(plot.clientWidth) })
      observer.observe(plot)
      observers.push(observer)
    }
    return h("div", { class: "map-root" }, h("div", { class: "map-figure" }, legend(), plot))
  }

  // ------------------------------------------------------------------ the Wiki: tables
  function studyCell(slug, named) {
    var paper = S.papers[slug]
    return h("td", null,
      h("button", { type: "button", class: "study", "data-fid": "study:" + slug, title: paper.venue || null, onclick: function () { openPaper(slug) } }, paper.label || paper.headline),
      named ? h("span", { class: "named" }, named) : null,
      paper.isNew ? h("span", { class: "new-mark" }, E.studyMarks.new) : null)
  }
  function resultCell(paper) {
    return h("td", null, h("span", null, paper.text || paper.takeaway), paper.kind ? h("span", { class: "kind", style: "color:" + shapes.KIND_TEXT_COLOUR[paper.kind] }, E.kindLabels[paper.kind]) : null)
  }

  /** The studies behind a bubble (StudyTable): the study, its design and participants, and what it was compared with and found. */
  function studyTable(slugs, kind, caption, treatmentShown) {
    var heads = [K.study, K.design, K.size].concat(kind === "research" ? [K.finding] : [K.comparator, K.result])
    var id = "table-" + kind + "-" + caption.replace(/\W+/g, "-")
    var body = h("tbody")
    slugs.forEach(function (slug, at) {
      var paper = S.papers[slug]
      var more = [[K.population, paper.population], [K.outcome, paper.outcome]].filter(function (entry) { return entry[1] })
      var detailsId = id + "-details-" + at
      var details = null
      var toggle = more.length === 0 ? null : h("button", { type: "button", class: "link more", "aria-expanded": "false", "aria-controls": detailsId, onclick: function () {
        if (details) { details.remove(); details = null; toggle.setAttribute("aria-expanded", "false"); return }
        details = h("tr", { id: detailsId, class: "details" }, h("td", { colspan: heads.length + 1 }, h("dl", null, more.map(function (entry) { return [h("dt", null, entry[0]), h("dd", null, entry[1])] }))))
        row.after(details)
        toggle.setAttribute("aria-expanded", "true")
      } }, K.details)
      var row = h("tr", { class: "row" },
        studyCell(slug, treatmentShown || paper.severalTreatments ? paper.treatment : null),
        h("td", null, paper.designNamed ? C.designLabels[paper.design] : E.noValue),
        h("td", { class: "num" }, paper.sampleSize === null ? E.noValue : NUMBER.format(paper.sampleSize)),
        kind === "research" ? h("td", null, paper.takeaway) : [h("td", null, paper.comparator || ""), resultCell(paper)],
        h("td", null, toggle))
      body.appendChild(row)
    })
    return h("div", null,
      h("h4", { id: id, class: "table-heading" }, E.tableHeading(caption, slugs.length)),
      h("div", { class: "table-scroll" }, h("table", { "aria-labelledby": id },
        h("thead", null, h("tr", null,
          heads.map(function (head) { return head === K.size ? h("th", { scope: "col", class: "num", title: K.sizeTitle }, head) : h("th", { scope: "col" }, head) }),
          h("th", { scope: "col" }, h("span", { class: "sr-only" }, K.details)))),
        body)))
  }

  /** The papers of another treatment that used this one as their comparison (ComparisonTable). */
  function comparisonTable(slugs) {
    var id = "table-compared"
    return h("div", null,
      h("h4", { id: id, class: "table-heading" }, E.tableHeading(E.comparedName, slugs.length)),
      h("div", { class: "table-scroll" }, h("table", { class: "small", "aria-labelledby": id },
        h("thead", null, h("tr", null, [K.study, K.tested, K.result].map(function (head) { return h("th", { scope: "col" }, head) }))),
        h("tbody", null, slugs.map(function (slug) {
          var paper = S.papers[slug]
          return h("tr", { class: "row" }, studyCell(slug, null), h("td", null, paper.treatment || E.noValue), resultCell(paper))
        })))))
  }

  // ------------------------------------------------------------------ the Wiki: the page
  function section(name, count, body) {
    var id = "sec-" + name
    return h("section", { class: "card sec", "aria-labelledby": id, "data-section": name },
      h("h3", { id: id }, h("span", null, E.sections[name]), h("span", { class: "count" }, count)),
      h("div", { class: "sec-body" }, body))
  }
  var shownDates = function (slugs) { return slugs.map(function (slug) { return S.papers[slug].shown }).filter(Boolean) }
  var distinct = function (list) { return list.filter(function (value, at) { return list.indexOf(value) === at }) }

  function wikiView() {
    var evidence = S.conditions.filter(function (entry) { return entry.code === state.condition })[0] || S.conditions[0]
    var chosen = state.chosen
    var choose = function (next, focus) { go({ chosen: Object.assign({}, chosen, next) }, focus) }
    var cls = evidence.classes.filter(function (entry) { return entry.key === chosen.classKey })[0] || null
    var treatment = cls ? cls.treatments.filter(function (entry) { return entry.key === chosen.treatment })[0] || null : null
    var harms = evidence.safety.filter(function (group) { return group.key === chosen.safety })[0] || null
    var research = evidence.research.filter(function (group) { return group.name === chosen.research })[0] || null

    var treatments
    if (evidence.classes.length === 0) treatments = h("p", { class: "muted" }, E.treatmentsEmpty)
    else {
      var lines = h("div", { class: "lines" }, h("p", null, E.lines.one), h("p", null, E.lines.colours))
      if (cls) {
        var treatmentEntries = cls.treatments.map(function (entry) { return Object.assign({}, entry, { dates: shownDates(entry.studies) }) })
        treatments = [lines,
          h("p", { class: "crumb" },
            h("button", { type: "button", class: "link", "data-fid": "crumb", onclick: function () { choose({ classKey: null, treatment: null }, "b:" + cls.key) } }, E.allClasses),
            h("span", { "aria-hidden": "true" }, E.crumbGap),
            h("span", { "aria-current": "true" }, cls.name)),
          mapOf(E.rows.treatments(cls.name), treatmentEntries, chosen.treatment, function (key) { choose({ treatment: key === chosen.treatment ? null : key }) }),
          treatment ? h("div", { class: "detail-block", "data-treatment-detail": treatment.key },
            studyTable(treatment.studies, "treatment", treatment.name, false),
            treatment.comparedIn.length > 0 ? comparisonTable(treatment.comparedIn) : null) : null]
      } else {
        var classEntries = evidence.classes.map(function (entry) {
          return Object.assign({}, entry, { dates: shownDates(distinct([].concat.apply([], entry.treatments.map(function (item) { return item.studies })))) })
        })
        treatments = [lines, mapOf(E.rows.classes, classEntries, null, function (key) { choose({ classKey: key, treatment: null }, "crumb") })]
      }
    }

    var safetyBox = discBoxHeight(evidence.safety.map(function (group) { return group.papers }))
    var safety = evidence.safety.length === 0 ? h("p", { class: "muted" }, E.safetyEmpty) : [
      h("div", { class: "tiles", role: "group", "aria-label": E.rows.safety }, evidence.safety.map(function (group) {
        return tile(group, { boxHeight: safetyBox, pressed: group.key === chosen.safety, onPick: function () { choose({ safety: group.key === chosen.safety ? null : group.key }) } })
      })),
      harms ? h("div", { class: "pad-top" }, studyTable(harms.studies, "safety", harms.name, false)) : null]

    var other = evidence.research.length === 0 ? h("p", { class: "muted" }, E.researchEmpty) : [
      h("div", { class: "pills", role: "group", "aria-label": E.rows.research }, evidence.research.map(function (group) {
        return h("button", { type: "button", "data-fid": "r:" + group.name, "aria-pressed": String(group.name === chosen.research), onclick: function () { choose({ research: group.name === chosen.research ? null : group.name }) } },
          h("b", null, group.papers), " ", h("span", null, group.name), group.newPapers > 0 ? [" ", h("small", null, E.newCount(group.newPapers))] : null)
      })),
      research ? h("div", { class: "pad-top" }, studyTable(research.studies, "research", research.name, research.treatmentShown)) : null]

    return h("div", null,
      h("h1", { tabindex: "-1", "data-fid": "heading" }, C.nav.evidence),
      h("div", { class: "line-tabs", role: "tablist", "aria-label": E.page.conditionsLabel, style: "margin-top:16px" }, S.conditions.map(function (entry) {
        return h("button", { type: "button", role: "tab", id: "tab-" + entry.code, "aria-selected": String(entry.code === evidence.code), "aria-controls": "condition-panel", "data-fid": "cond:" + entry.code,
          onclick: function () { go({ condition: entry.code, chosen: { classKey: null, treatment: null, safety: null, research: null } }) } }, entry.name)
      })),
      h("div", { id: "condition-panel", role: "tabpanel", "aria-labelledby": "tab-" + evidence.code },
        h("p", { class: "basis" }, E.basis(evidence.total, evidence.name, evidence.since)),
        h("div", { class: "sections" },
          section("treatments", evidence.sections.treatments, treatments),
          section("safety", evidence.sections.safety, safety),
          section("research", evidence.sections.research, other))))
  }

  /** The Wiki on a condition, and on one of its treatments when it has a bubble: where a note's links lead. */
  function goWiki(condition, treatmentKey) {
    var evidence = S.conditions.filter(function (entry) { return entry.code === condition })[0]
    if (!evidence) return
    var owner = treatmentKey ? evidence.classes.filter(function (cls) { return cls.treatments.some(function (entry) { return entry.key === treatmentKey }) })[0] : null
    go({ view: "wiki", condition: condition, chosen: { classKey: owner ? owner.key : null, treatment: owner ? treatmentKey : null, safety: null, research: null } }, owner ? "b:" + treatmentKey : "heading")
  }

  // ------------------------------------------------------------------ Notes
  /** A note's text as it reads (the app's Preview): paragraphs, lists, bold, and its links. A cited paper opens the paper; a condition or a treatment opens the Wiki. */
  function inline(text) {
    var out = []
    var pattern = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]|\[([^\]\n]*)\]\(\s*\/wiki\?([^)\s]*)\s*\)|\*\*(.+?)\*\*/g
    var at = 0
    var match
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > at) out.push(text.slice(at, match.index))
      if (match[1] !== undefined) {
        (function (slug, alias) {
          var known = S.papers[slug]
          out.push(known ? h("button", { type: "button", class: "link", "data-fid": "cite:" + slug, title: known.title, onclick: function () { openPaper(slug) } }, alias || known.label || slug) : (alias || slug))
        })(match[1].trim(), (match[2] || "").trim())
      } else if (match[4] !== undefined) {
        (function (label, query) {
          var params = new URLSearchParams(query)
          out.push(h("button", { type: "button", class: "link", onclick: function () { goWiki(params.get("condition"), params.get("treatment")) } }, label))
        })(match[3], match[4])
      } else out.push(h("strong", null, inline(match[5])))
      at = pattern.lastIndex
    }
    if (at < text.length) out.push(text.slice(at))
    return out
  }
  function markdown(body) {
    return body.split(/\n\s*\n/).map(function (block) {
      var lines = block.split("\n").filter(function (line) { return line.trim() !== "" })
      if (lines.length > 0 && lines.every(function (line) { return /^\s*[-*]\s+/.test(line) })) return h("ul", null, lines.map(function (line) { return h("li", null, inline(line.replace(/^\s*[-*]\s+/, ""))) }))
      return h("p", null, inline(lines.join(" ")))
    })
  }
  var plainOf = function (note) { return (note.title + " " + note.body.replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")).toLowerCase() }
  var treatmentsOf = function (note) { return note.treatments.filter(function (entry, at, all) { return all.findIndex(function (other) { return other.key === entry.key }) === at }) }

  function notesView() {
    if (state.note) {
      var open = S.notes.filter(function (note) { return note.id === state.note })[0]
      if (open) return notePage(open)
    }
    var host = h("div")
    function list() {
      var q = state.q.trim().toLowerCase()
      var matching = S.notes.filter(function (note) { return q === "" || plainOf(note).indexOf(q) >= 0 })
      var ofCondition = matching.filter(function (note) { return state.noteCondition === "" || note.conditions.some(function (entry) { return entry.code === state.noteCondition }) })
      var shown = state.kind ? ofCondition.filter(function (note) { return note.kind === state.kind }) : ofCondition
      var filtered = q !== "" || state.noteCondition !== "" || state.kind !== null
      var pills = [{ kind: null, label: L.kinds.all, count: ofCondition.length }].concat(["paper", "topic", "none"].map(function (kind) {
        return { kind: kind, label: L.kinds[kind], count: ofCondition.filter(function (note) { return note.kind === kind }).length }
      }))
      var held = document.activeElement && host.contains(document.activeElement) ? document.activeElement.getAttribute("data-fid") : null
      host.replaceChildren(
        h("div", { class: "kinds", role: "group", "aria-label": L.kindLabel }, pills.map(function (pill) {
          return h("button", { type: "button", "data-fid": "kind:" + pill.kind, "aria-pressed": String(pill.kind === state.kind), onclick: function () { state.kind = pill.kind; list() } }, pill.label, " ", h("span", null, pill.count))
        })),
        shown.length > 0
          ? h("ul", { class: "note-list" }, shown.map(function (note) {
            return h("li", null, h("button", { type: "button", class: "card note-row", "data-fid": "note:" + note.id, onclick: function () { go({ note: note.id, noteTab: "preview" }, "heading") } },
              h("div", { class: "top" }, h("h3", null, note.title), h("time", { datetime: note.updated }, L.edited(note.updated))),
              note.excerpt ? h("p", null, note.excerpt) : null,
              h("div", { class: "chips" },
                note.conditions.map(function (entry) { return h("span", { class: "chip" }, entry.name) }),
                treatmentsOf(note).map(function (entry) { return h("span", { class: "chip" }, entry.name) }),
                note.papers.length > 0 ? h("span", { class: "chip" }, L.papers(note.papers.length)) : null)))
          }))
          : filtered
            ? h("div", { class: "empty" }, h("strong", null, L.noMatch), h("button", { type: "button", class: "btn", "data-fid": "clear", onclick: function () { state.q = ""; state.kind = null; state.noteCondition = ""; render("search") } }, L.clear))
            : h("div", { class: "empty" }, h("strong", null, L.none), h("p", { class: "muted" }, L.noneHint)))
      if (held) focusOn(held)
    }
    var names = {}
    S.notes.forEach(function (note) { note.conditions.forEach(function (entry) { names[entry.code] = entry.name }) })
    var view = h("div", null,
      h("h1", { tabindex: "-1", "data-fid": "heading" }, C.nav.notes),
      h("div", { class: "filters" },
        h("input", { type: "search", class: "field", "data-fid": "search", "aria-label": L.searchLabel, placeholder: L.searchPlaceholder, autocomplete: "off", value: state.q, oninput: function (event) { state.q = event.target.value; list() } }),
        h("select", { class: "field", "data-fid": "note-condition", "aria-label": L.conditionLabel, onchange: function (event) { state.noteCondition = event.target.value; list() } },
          h("option", { value: "" }, L.allConditions),
          Object.keys(names).map(function (code) { return h("option", { value: code, selected: code === state.noteCondition }, names[code]) }))),
      host)
    list()
    return view
  }

  function notePage(note) {
    var treatments = treatmentsOf(note)
    var tabs = ["edit", "preview"]
    return h("div", { class: "note-page" },
      h("button", { type: "button", class: "back", "data-fid": "back", onclick: function () { go({ note: null }, "note:" + note.id) } }, C.nav.backTo(C.nav.notes)),
      h("h1", { tabindex: "-1", "data-fid": "heading" }, note.title),
      h("div", { class: "chips", role: "group", "aria-label": P.aboutLabel },
        note.conditions.map(function (entry) { return h("button", { type: "button", class: "chip", onclick: function () { goWiki(entry.code, null) } }, entry.name) }),
        treatments.map(function (entry) { return h("button", { type: "button", class: "chip", onclick: function () { goWiki(entry.condition, entry.key) } }, entry.name) }),
        note.papers.length > 0 ? h("span", { class: "chip" }, L.papers(note.papers.length)) : null),
      h("div", { class: "line-tabs", role: "tablist", "aria-label": P.tabsLabel }, tabs.map(function (tab) {
        return h("button", { type: "button", role: "tab", id: "note-tab-" + tab, "aria-selected": String(tab === state.noteTab), "aria-controls": "note-panel", "data-fid": "note-tab:" + tab, onclick: function () { go({ noteTab: tab }) } }, P.tabs[tab])
      })),
      h("div", { id: "note-panel", role: "tabpanel", "aria-labelledby": "note-tab-" + state.noteTab },
        state.noteTab === "preview"
          ? h("div", { class: "note-body" }, markdown(note.body))
          : h("textarea", { class: "note-raw", readonly: true, "aria-label": P.bodyLabel + " (read-only in this preview)", rows: 10 }, note.body)),
      h("section", { class: "note-links", "aria-label": P.links },
        h("h2", null, P.links),
        h("ul", null,
          note.papers.map(function (entry) { return h("li", null, h("button", { type: "button", class: "link", "data-fid": "ref:" + entry.slug, title: S.papers[entry.slug].title, onclick: function () { openPaper(entry.slug) } }, entry.label)) }),
          note.conditions.map(function (entry) { return h("li", null, h("button", { type: "button", class: "link", onclick: function () { goWiki(entry.code, null) } }, entry.name)) }),
          treatments.map(function (entry) { return h("li", null, h("button", { type: "button", class: "link", onclick: function () { goWiki(entry.condition, entry.key) } }, entry.name)) }))),
      h("p", { class: "note-state" }, L.edited(note.updated) + " · An invented sample note, read-only here. In the app a note saves itself as you write, and has these actions: " +
        [P.citePaper, P.linkTopic, P.copy, P.ask, P.remove].join(", ") + ". " + C.noPatientData))
  }

  // ------------------------------------------------------------------ pages that are not in this preview
  var STUBS = {
    ask: { name: C.nav.chat, line: "Ask is the upstream chat, with three modes: discuss, find papers, and a deep literature review. It needs a model, so it is not in this preview." },
    outputs: { name: C.nav.outputs, line: "Outputs is the upstream projects list: " + C.outputs.intro.charAt(0).toLowerCase() + C.outputs.intro.slice(1) },
    library: { name: C.nav.library, line: "The Library holds your saved papers, Read later, History (your earlier feed searches) and Saved chats." },
    topics: { name: C.watch.heading, line: C.watch.intro.split(". ").slice(0, 2).join(". ") + "." },
  }
  function stubView(key) {
    var stub = STUBS[key]
    return h("div", null,
      h("h1", { tabindex: "-1", "data-fid": "heading" }, stub.name),
      h("div", { class: "card stub" }, h("strong", null, "Not in this preview"), h("p", null, stub.line)))
  }

  var VIEWS = { feed: feedView, wiki: wikiView, notes: notesView }

  // ------------------------------------------------------------------ the guided tour
  var firstClass = S.conditions[0].classes[0]
  var firstTreatment = firstClass ? (firstClass.treatments.filter(function (entry) { return entry.participants !== null })[0] || firstClass.treatments[0]) : null
  var NO_CHOICE = { classKey: null, treatment: null, safety: null, research: null }
  var STEPS = [
    { title: "A card is one new paper", text: "The topic it matched, the study design, the journal and its dates, then an AI headline and a one-sentence summary that code checks against the paper's text. Click a card to open the paper.",
      set: { view: "feed", topic: null }, target: ".feed-card" },
    { title: "The Wiki map", text: "One bubble per class of treatment, for the papers your feed has listed on a condition. Across: the date of the most recent paper. Up: the participants the papers state, on a log scale. Size: the number of papers. Colour: benefit, no benefit or mixed.",
      set: { view: "wiki", condition: S.conditions[0].code, chosen: NO_CHOICE }, target: ".map-root" },
    { title: "A class zooms to its treatments", text: "Click a class and the same map shows the treatments in it. “" + E.allClasses + "” leads back.",
      set: { view: "wiki", condition: S.conditions[0].code, chosen: Object.assign({}, NO_CHOICE, { classKey: firstClass ? firstClass.key : null }) }, target: ".map-root" },
    { title: "A treatment opens its studies", text: "One row per paper: design, participants, what it was compared with, the result and its direction label. Papers are counted; nothing is pooled. Click a study to open the paper.",
      set: { view: "wiki", condition: S.conditions[0].code, chosen: Object.assign({}, NO_CHOICE, { classKey: firstClass ? firstClass.key : null, treatment: firstTreatment ? firstTreatment.key : null }) }, target: "[data-treatment-detail]" },
    { title: "Notes link back to the evidence", text: "A note can cite papers and link conditions and treatments. In Preview a cited paper opens the paper, and a treatment opens its place on the Wiki.",
      set: { view: "notes", note: S.notes[0] ? S.notes[0].id : null, noteTab: "preview" }, target: ".note-page" },
  ]
  var pop = null

  function markTour() {
    Array.prototype.forEach.call(document.querySelectorAll(".tour-target"), function (el) { el.classList.remove("tour-target") })
    if (!tour) return
    var target = view.querySelector(STEPS[tour.step].target)
    if (!target) { closeTour(false); return }
    target.classList.add("tour-target")
    tour.target = target
    placeTour(false)
  }
  function placeTour(scroll) {
    if (!tour || !tour.target || !pop) return
    var box = tour.target.getBoundingClientRect()
    var width = pop.offsetWidth, height = pop.offsetHeight
    var page = document.documentElement.clientWidth
    var tall = box.height > 320
    var top = (tall ? box.top - height - 14 : box.bottom + 14) + window.scrollY
    var left = Math.min(Math.max(12, box.left + window.scrollX), page - width - 12)
    pop.style.top = Math.max(8, top) + "px"
    pop.style.left = Math.max(12, left) + "px"
    if (scroll) window.scrollTo({ top: Math.max(0, Math.min(top, box.top + window.scrollY) - 24), behavior: reducedMotion ? "auto" : "smooth" })
  }
  function showStep(step) {
    tour = { step: step, target: null }
    var info = STEPS[step]
    var last = step === STEPS.length - 1
    if (!pop) {
      pop = h("div", { class: "tour", role: "dialog", "aria-modal": "false", "aria-labelledby": "tour-title", "aria-describedby": "tour-text", tabindex: "-1" })
      pop.addEventListener("keydown", function (event) {
        if (event.key === "Escape") { event.preventDefault(); closeTour(true) }
        else if (event.key === "ArrowRight" && tour && tour.step < STEPS.length - 1) showStep(tour.step + 1)
        else if (event.key === "ArrowLeft" && tour && tour.step > 0) showStep(tour.step - 1)
      })
      document.body.appendChild(pop)
    }
    var next = h("button", { type: "button", class: "btn primary", onclick: function () { if (last) closeTour(true); else showStep(step + 1) } }, last ? "Done" : "Next")
    pop.replaceChildren(
      h("small", { "aria-live": "polite" }, "Step " + (step + 1) + " of " + STEPS.length),
      h("h3", { id: "tour-title" }, info.title),
      h("p", { id: "tour-text" }, info.text),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn", disabled: step === 0, onclick: function () { showStep(step - 1) } }, "Back"),
        next,
        h("button", { type: "button", class: "end", onclick: function () { closeTour(true) } }, "Close")))
    Object.keys(info.set).forEach(function (key) { state[key] = info.set[key] })
    render()
    // The map is measured after it is in the page: the place is worked out once more when it has its size.
    placeTour(true)
    window.requestAnimationFrame(function () { placeTour(true) })
    next.focus({ preventScroll: true })
  }
  /** `refocus`: the reader closed it, so the keyboard goes back to the button that started it. */
  function closeTour(refocus) {
    if (!tour) return
    tour = null
    if (pop) { pop.remove(); pop = null }
    markTour()
    var start = document.getElementById("tour-start")
    if (refocus && start) start.focus({ preventScroll: true })
  }
  window.addEventListener("resize", function () { placeTour(false) })

  // ------------------------------------------------------------------ start
  Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (button) {
    button.addEventListener("click", function () {
      closeTour(false)
      go({ view: button.getAttribute("data-view"), note: null }, "heading")
    })
  })
  var start = document.getElementById("tour-start")
  if (start) start.addEventListener("click", function () { showStep(0) })
  document.documentElement.classList.add("js")
  render()
})()
