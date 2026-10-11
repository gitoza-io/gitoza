#import sys: inputs
#import "@preview/cmarker:0.1.8"

#set page(margin: (x: 18mm, y: 16mm))
#set text(font: ("Arial", "Helvetica", "Liberation Sans", "Noto Sans"), size: 11pt, fill: rgb("#111827"))
// Keep markdown body headings out of the PDF bookmark pane; only explicit headings below are outlined.
#show heading: set heading(outlined: false)

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

#let status-colors(status) = if status == "APPROVED" {
  (bg: rgb("#DCFCE7"), fg: rgb("#166534"))
} else if status == "REJECTED" {
  (bg: rgb("#FEE2E2"), fg: rgb("#991B1B"))
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

#let render-case-body(segments, case-index) = {
  let lp = "pdf-case-" + str(case-index) + "-"
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

#let case-anchor(index) = "case-" + str(index)

#let toc-line(case-id, title) = "[" + str(case-id) + "] " + str(title)

#let count-node-cases(node) = {
  let nested = node.children.map(count-node-cases).sum(default: 0)
  node.cases.len() + nested
}

#let collect-case-indices(node) = {
  let child-indices = node.children.map(collect-case-indices).flatten()
  let own = node.cases.map(c => int(c.case_index))
  child-indices + own
}

#let collect-toc-case-indices(toc) = {
  toc.map(collect-case-indices).flatten()
}

#let render-toc-case-leaf(leaf, cases) = {
  let idx = int(leaf.case_index)
  let priority-state = priority-colors(str(leaf.priority))
  pad(left: 12pt)[
    #stack(
      dir: ltr,
      spacing: 6pt,
      link(label(case-anchor(idx)), toc-line(leaf.case_id, leaf.title)),
      badge(str(leaf.priority), priority-state.bg, priority-state.fg),
    )
    #v(3pt)
  ]
}

#let render-toc-node(node, depth, cases) = {
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
      #render-toc-node(child, depth + 1, cases)
    ]
    #for leaf in node.cases [
      #render-toc-case-leaf(leaf, cases)
    ]
  ]
  v(4pt)
}

#let render-toc(toc, cases) = {
  text(size: 16pt, weight: "bold")[Contents]
  v(8pt)

  if cases.len() == 0 {
    text(size: 10pt, fill: rgb("#64748B"))[No test cases available.]
  } else if toc.len() == 0 {
    for (index, case) in cases.enumerate() [
      #render-toc-case-leaf((
        case_index: index,
        case_id: case.case_id,
        title: case.title,
        priority: case.priority,
      ), cases)
    ]
  } else {
    for node in toc [
      #render-toc-node(node, 0, cases)
    ]
  }

  v(4pt)
}

#let render-case(case, case-index, outline-level: 3) = {
  let state = status-colors(case.status)
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
    #label(case-anchor(case-index))
  ]

  v(2pt)
  stack(
    dir: ltr,
    spacing: 2pt,
    midline-text(case.case_id, size: 10pt, weight: "medium", fill: rgb(17, 24, 39)),
    badge(case.status, state.bg, state.fg),
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

  render-case-body(case.body_segments, case-index)
}

#let render-detail-node(node, cases, depth, last-index) = {
  let suite-level = calc.min(depth + 1, 5)
  if depth > 0 {
    heading(outlined: true, level: suite-level)[#node.display_name]
    v(4pt)
  }
  for child in node.children [
    #render-detail-node(child, cases, depth + 1, last-index)
  ]
  for leaf in node.cases [
    #let idx = int(leaf.case_index)
    #render-case(cases.at(idx), idx, outline-level: calc.min(suite-level + 1, 6))
    #if idx < last-index [
      #pagebreak()
    ]
  ]
}

#let render-cases-from-toc(toc, cases) = {
  let last-index = if cases.len() > 0 { cases.len() - 1 } else { 0 }
  for project in toc [
    #heading(outlined: true, level: 1)[#project.display_name]
    #v(4pt)
    #for child in project.children [
      #render-detail-node(child, cases, 1, last-index)
    ]
    #for leaf in project.cases [
      #let idx = int(leaf.case_index)
      #render-case(cases.at(idx), idx, outline-level: 2)
      #if idx < last-index [
        #pagebreak()
      ]
    ]
  ]
}

#let cases = inputs.cases
#let toc = inputs.at("toc", default: ())
#let last-index = cases.len() - 1
#render-toc(toc, cases)
#pagebreak()

#if toc.len() > 0 [
  #render-cases-from-toc(toc, cases)
] else [
  #for (index, case) in cases.enumerate() [
    #render-case(case, index, outline-level: 1)
    #if index < last-index [
      #pagebreak()
    ]
  ]
]
