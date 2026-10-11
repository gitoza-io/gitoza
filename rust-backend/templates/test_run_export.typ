#import sys: inputs
#import "@preview/cmarker:0.1.8"

#set page(margin: (x: 18mm, y: 16mm))
#set text(font: ("Arial", "Helvetica", "Liberation Sans", "Noto Sans"), size: 11pt, fill: rgb("#111827"))
// Keep markdown body headings out of the PDF bookmark pane; only explicit headings below are outlined.
#show heading: set heading(outlined: false)
#show heading.where(level: 1): set text(size: 18pt, weight: "bold")

#let soft-divider() = line(length: 100%, stroke: (paint: rgb("#E5E7EB"), thickness: 0.7pt))

#let badge(label, bg, fg) = box(
  fill: bg,
  radius: 999pt,
  inset: (x: 8pt, y: 3pt),
)[
  #text(size: 9pt, weight: "bold", fill: fg)[#label]
]

#let midline-text(label, size: 10pt, weight: "regular", fill: rgb("#111827")) = box(
  inset: (y: 1.3pt),
)[
  #text(size: size, weight: weight, fill: fill)[#label]
]

#let result-colors(result) = if result == "passed" {
  (bg: rgb("#DCFCE7"), fg: rgb("#166534"))
} else if result == "failed" {
  (bg: rgb("#FEE2E2"), fg: rgb("#991B1B"))
} else if result == "skipped" {
  (bg: rgb("#FEF3C7"), fg: rgb("#92400E"))
} else {
  (bg: rgb("#E5E7EB"), fg: rgb("#374151"))
}

#let run-status-colors(status) = if status == "PASSED" {
  (bg: rgb("#DCFCE7"), fg: rgb("#166534"))
} else if status == "FAILED" {
  (bg: rgb("#FEE2E2"), fg: rgb("#991B1B"))
} else if status == "IN PROGRESS" {
  (bg: rgb("#DBEAFE"), fg: rgb("#1D4ED8"))
} else {
  (bg: rgb("#E5E7EB"), fg: rgb("#374151"))
}

#let priority-colors(priority) = if priority == "High" {
  (bg: rgb("#FEE2E2"), fg: rgb("#991B1B"))
} else if priority == "Medium" {
  (bg: rgb("#FFEDD5"), fg: rgb("#9A3412"))
} else if priority == "Low" {
  (bg: rgb("#DBEAFE"), fg: rgb("#1D4ED8"))
} else {
  (bg: rgb("#E5E7EB"), fg: rgb("#374151"))
}

#let toc-result-glyph(result) = {
  let r = lower(str(result))
  if r == "passed" { "✓" }
  else if r == "failed" { "✗" }
  else if r == "skipped" { "−" }
  else { "○" }
}

#let toc-result-icon(result) = {
  let state = result-colors(str(result))
  box(width: 10pt, inset: (y: 1pt))[
    #align(center)[
      #text(size: 9pt, weight: "bold", fill: state.fg)[#toc-result-glyph(result)]
    ]
  ]
}

#let toc-legend-separator() = {
  text(size: 9pt, fill: rgb("#CBD5E1"))[·]
}

#let toc-legend-item(label, result) = {
  stack(
    dir: ltr,
    spacing: 3pt,
    text(size: 9pt, weight: "medium", fill: rgb("#64748B"))[#label],
    toc-result-icon(result),
  )
}

#let render-toc-result-legend() = {
  box(
    width: 100%,
    fill: rgb("#F8FAFC"),
    stroke: 0.5pt + rgb("#E2E8F0"),
    radius: 4pt,
    inset: (x: 10pt, y: 6pt),
  )[
    #stack(
      dir: ltr,
      spacing: 12pt,
      toc-legend-item("Pass", "passed"),
      toc-legend-separator(),
      toc-legend-item("Fail", "failed"),
      toc-legend-separator(),
      toc-legend-item("Pending", "pending"),
      toc-legend-separator(),
      toc-legend-item("Skipped", "skipped"),
    )
  ]
}

#let tone-colors(tone) = if tone == "green" {
  (bg: rgb("#DCFCE7"), fg: rgb("#166534"))
} else if tone == "purple" {
  (bg: rgb("#EDE9FE"), fg: rgb("#6D28D9"))
} else if tone == "blue" {
  (bg: rgb("#DBEAFE"), fg: rgb("#1D4ED8"))
} else if tone == "red" {
  (bg: rgb("#FEE2E2"), fg: rgb("#991B1B"))
} else if tone == "orange" {
  (bg: rgb("#FFEDD5"), fg: rgb("#9A3412"))
} else {
  (bg: rgb("#E5E7EB"), fg: rgb("#374151"))
}

#let render-tags(tags) = {
  if tags.len() > 0 {
    midline-text("🏷", size: 9pt, fill: rgb("#6B7280"))
    h(5pt)
  }
  for tag in tags {
    let colors = tone-colors(tag.tone)
    badge(tag.name, colors.bg, colors.fg)
    h(8pt)
  }
}

#let render-md-chunk(text, label-prefix) = {
  let t = str(text)
  if t.trim() == "" {
    return
  }
  block(width: 100%, breakable: true)[
    #show heading: set heading(outlined: false)
    #cmarker.render(
      t,
      label-prefix: label-prefix,
      raw-typst: true,
    )
  ]
}

#let render-image-seg(seg) = {
  let p = str(seg.at("path"))
  let pct = float(seg.at("width_percent"))
  image(p, width: pct * 1%)
}

#let render-table-seg(seg, label-prefix) = {
  let n = int(seg.columns)
  let cells = seg.cells
  if n < 1 or cells.len() < n {
    return
  }
  let md-cell(s) = {
    let t = str(s).trim()
    if t == "" [ ] else {
      cmarker.render(t, label-prefix: label-prefix + "tbl-", raw-typst: true)
    }
  }
  block(width: 100%, breakable: true)[
    #set text(size: 10pt)
    #show heading: it => {
      set heading(outlined: false)
      it
    }
    #table(
      columns: (1fr,) * n,
      stroke: 0.55pt + rgb("#E2E8F0"),
      inset: (x: 8pt, y: 6pt),
      align: (x, y) => if y == 0 { horizon + left } else { top + left },
      fill: (x, y) => if y == 0 { rgb("#F8FAFC") } else { none },
      table.header(..range(n).map(i => table.cell(md-cell(cells.at(i))))),
      ..range(n, cells.len()).map(i => table.cell(md-cell(cells.at(i)))),
    )
  ]
  v(10pt)
}

#let render-case-body(segments, run-index, case-index) = {
  let lp = "pdf-run-" + str(run-index) + "-case-" + str(case-index) + "-"
  for seg in segments {
    let k = str(seg.at("kind"))
    if k == "markdown" {
      render-md-chunk(seg.at("text"), lp)
    } else if k == "table" {
      render-table-seg(seg, lp)
    } else if k == "image" {
      render-image-seg(seg)
    }
  }
}

#let run-anchor(run-index) = "run-info-" + str(run-index)
#let case-anchor(run-index, case-index) = "run-" + str(run-index) + "-case-" + str(case-index)

#let toc-line(case-id, title) = "[" + str(case-id) + "] " + str(title)

#let count-node-cases(node) = {
  let nested = node.children.map(count-node-cases).sum(default: 0)
  node.cases.len() + nested
}

#let render-toc-case-leaf(leaf, run-index, cases) = {
  let idx = int(leaf.case_index)
  pad(left: 12pt)[
    #stack(
      dir: ltr,
      spacing: 4pt,
      toc-result-icon(str(leaf.at("result", default: "pending"))),
      link(label(case-anchor(run-index, idx)), toc-line(leaf.case_id, leaf.title)),
    )
    #v(3pt)
  ]
}

#let render-toc-node(node, depth, run-index, cases) = {
  let indent = depth * 12pt
  let count = count-node-cases(node)
  pad(left: indent)[
    #text(
      size: if depth == 0 { 11pt } else { 10pt },
      weight: if depth == 0 { "bold" } else { "semibold" },
      fill: rgb("#0F172A"),
    )[
      #node.display_name
      #h(4pt)
      #text(size: 9pt, weight: "regular", fill: rgb("#64748B"))[(#count)]
    ]
    #v(4pt)
    #for child in node.children [
      #render-toc-node(child, depth + 1, run-index, cases)
    ]
    #for leaf in node.cases [
      #render-toc-case-leaf(leaf, run-index, cases)
    ]
  ]
  v(4pt)
}

#let render-run-info(run, run-index) = {
  let run-state = run-status-colors(run.status)
  let run-id = str(run.run_id).trim()
  let desc = str(run.description).trim()
  let pending = calc.max(0, int(run.total_cases) - int(run.passed) - int(run.failed) - int(run.skipped))

  heading(outlined: true, level: 1)[
    #run.title
    #label(run-anchor(run-index))
  ]
  v(4pt)
  stack(
    dir: ltr,
    spacing: 3pt,
    if run-id != "" {
      midline-text("RUN ID", size: 9pt, weight: "bold", fill: rgb("#475569"))
      midline-text(run-id, size: 10pt, weight: "semibold", fill: rgb("#0F172A"))
      h(8pt)
    },
    badge(run.status, run-state.bg, run-state.fg),
  )
  v(6pt)
  stack(
    dir: ltr,
    spacing: 4pt,
    badge(str(run.total_cases) + " cases", rgb("#E2E8F0"), rgb("#334155")),
    badge(str(run.passed) + " passed", rgb("#DCFCE7"), rgb("#166534")),
    badge(str(run.failed) + " failed", rgb("#FEE2E2"), rgb("#991B1B")),
    badge(str(run.skipped) + " skipped", rgb("#FEF3C7"), rgb("#92400E")),
    if pending > 0 {
      badge(str(pending) + " pending", rgb("#F1F5F9"), rgb("#475569"))
    },
  )
  if desc != "" {
    v(8pt)
    text(size: 10pt, fill: rgb("#334155"))[#desc]
  }
  v(4pt)
}

#let render-run-toc(run, run-index) = {
  let toc = run.at("toc", default: ())
  text(size: 16pt, weight: "bold")[Contents]
  v(6pt)
  text(size: 10pt, fill: rgb("#475569"))[
    #link(label(run-anchor(run-index)), "Run information")
  ]
  v(6pt)

  if run.cases.len() == 0 {
    text(size: 10pt, fill: rgb("#64748B"))[No test cases available in this run.]
  } else {
    render-toc-result-legend()
    v(8pt)
    if toc.len() == 0 {
      for (case-index, case) in run.cases.enumerate() [
        #render-toc-case-leaf((
          case_index: case-index,
          case_id: case.case_id,
          title: case.title,
          priority: case.priority,
          result: case.result,
          result_label: case.result_label,
        ), run-index, run.cases)
      ]
    } else {
      for node in toc [
        #render-toc-node(node, 0, run-index, run.cases)
      ]
    }
  }

  v(10pt)
  soft-divider()
  v(10pt)
}

#let render-run-case(case, run-index, case-index, outline-level: 3) = {
  let result-state = result-colors(case.result)
  let priority-state = priority-colors(case.priority)
  let path-str = str(case.path).trim()
  let req-str = str(case.requirement_id).trim()

  if path-str != "" {
    text(size: 10pt, fill: rgb(39, 41, 45))[#case.path]
    v(2pt)
  }

  heading(
    outlined: true,
    level: outline-level,
  )[
    #toc-line(case.case_id, case.title)
    #label(case-anchor(run-index, case-index))
  ]

  v(2pt)
  stack(
    dir: ltr,
    spacing: 2pt,
    midline-text(case.case_id, size: 10pt, weight: "medium", fill: rgb(17, 24, 39)),
    badge(case.result_label, result-state.bg, result-state.fg),
  )
  v(2pt)
  stack(
    dir: ltr,
    spacing: 2pt,
    midline-text("PRIORITY", size: 9pt, weight: "bold", fill: rgb(75, 85, 99)),
    badge(case.priority, priority-state.bg, priority-state.fg),
    if req-str != "" {
      h(8pt)
      midline-text("REQUIREMENT", size: 9pt, weight: "bold", fill: rgb(75, 85, 99))
      h(2pt)
      midline-text(case.requirement_id, size: 10pt, weight: "semibold", fill: rgb(67, 56, 202))
    },
    render-tags(case.tags),
  )

  v(3pt)
  soft-divider()
  v(3pt)

  render-case-body(case.body_segments, run-index, case-index)
}

#let render-detail-node(node, run, run-index, depth, last-index) = {
  let suite-level = calc.min(depth + 2, 5)
  if depth > 0 {
    heading(outlined: true, level: suite-level)[#node.display_name]
    v(4pt)
  }
  for child in node.children [
    #render-detail-node(child, run, run-index, depth + 1, last-index)
  ]
  for leaf in node.cases [
    #let idx = int(leaf.case_index)
    #render-run-case(run.cases.at(idx), run-index, idx, outline-level: calc.min(suite-level + 1, 6))
    #if idx < last-index [
      #pagebreak()
    ]
  ]
}

#let render-run-cases-from-toc(run, run-index) = {
  let toc = run.at("toc", default: ())
  let last-index = if run.cases.len() > 0 { run.cases.len() - 1 } else { 0 }
  for project in toc [
    #heading(outlined: true, level: 2)[#project.display_name]
    #v(4pt)
    #for child in project.children [
      #render-detail-node(child, run, run-index, 1, last-index)
    ]
    #for leaf in project.cases [
      #let idx = int(leaf.case_index)
      #render-run-case(run.cases.at(idx), run-index, idx, outline-level: 3)
      #if idx < last-index [
        #pagebreak()
      ]
    ]
  ]
}

#let runs = inputs.runs
#let last-run-index = runs.len() - 1

#for (run-index, run) in runs.enumerate() [
  #render-run-info(run, run-index)
  #render-run-toc(run, run-index)

  #if run.cases.len() == 0 [
    #text(size: 10pt, fill: rgb("#64748B"))[No test cases available in this run.]
  ] else [
    #pagebreak()
    #let last-case-index = run.cases.len() - 1
    #let toc = run.at("toc", default: ())
    #if toc.len() > 0 [
      #render-run-cases-from-toc(run, run-index)
    ] else [
      #for (case-index, case) in run.cases.enumerate() [
        #render-run-case(case, run-index, case-index, outline-level: 2)
        #if case-index < last-case-index [
          #pagebreak()
        ]
      ]
    ]
  ]

  #if run-index < last-run-index [
    #pagebreak()
  ]
]
