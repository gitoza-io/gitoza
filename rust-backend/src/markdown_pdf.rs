//! Split case Markdown into blocks for PDF export: pipe tables (GFM) vs remaining Markdown.
//! Mirrors the line-based GFM table rules in `frontend/src/components/TestCaseDetailModal.jsx`
//! so PDF output matches the case detail view. The `cmarker` Typst package does not enable
//! GFM tables in its WASM parser, so pipe tables were emitted as plain text.

#[derive(Debug, Clone, PartialEq)]
pub enum BodySegment {
    Markdown(String),
    Table {
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    /// Cached asset resolved to a Typst project-root path (`/assets_cache/...`).
    Image {
        path: String,
        /// Width as a percentage of the printable column (100 = full column).
        width_percent: f64,
    },
}

/// Parse a GFM pipe table row (`| a | b |`).
fn parse_pipe_table_row(line: &str) -> Option<Vec<String>> {
    let t = line.trim();
    if !t.starts_with('|') {
        return None;
    }
    let inner = if t.ends_with('|') && t.len() > 1 {
        &t[1..t.len() - 1]
    } else {
        &t[1..]
    };
    Some(inner.split('|').map(|c| c.trim().to_string()).collect())
}

/// GFM alignment row: `| --- | :--- | ---: |` (ASCII hyphens only, matching the web view).
fn is_separator_cell(cell: &str) -> bool {
    let c = cell.trim();
    if c.is_empty() {
        return false;
    }
    let mut rest = c;
    if rest.starts_with(':') {
        rest = &rest[1..];
    }
    let hyphens = if rest.ends_with(':') {
        &rest[..rest.len() - 1]
    } else {
        rest
    };
    !hyphens.is_empty() && hyphens.chars().all(|ch| ch == '-')
}

fn is_table_separator_row(line: &str) -> bool {
    let Some(cells) = parse_pipe_table_row(line) else {
        return false;
    };
    if cells.is_empty() {
        return false;
    }
    cells.iter().all(|c| is_separator_cell(c))
}

/// Split full markdown body into alternating Markdown strings and pipe tables.
pub fn split_markdown_for_pdf(text: &str) -> Vec<BodySegment> {
    let mut lines: Vec<&str> = text.split('\n').collect();
    // `split('\n')` yields a trailing empty slice when `text` ends with `\n`; drop it so we
    // do not accumulate a spurious markdown segment containing only whitespace.
    if lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    let mut i = 0usize;
    let mut out: Vec<BodySegment> = Vec::new();
    let mut md_buf = String::new();

    let flush_md = |buf: &mut String, out: &mut Vec<BodySegment>| {
        if !buf.is_empty() {
            push_markdown_segment(out, std::mem::take(buf));
        }
    };

    while i < lines.len() {
        let line = lines[i];

        if line.trim().is_empty() {
            md_buf.push_str(line);
            md_buf.push('\n');
            i += 1;
            continue;
        }

        if line.trim().starts_with('|') {
            let next_line = lines.get(i + 1).copied().unwrap_or("");
            if let Some(header_cells) = parse_pipe_table_row(line) {
                if !header_cells.is_empty() && is_table_separator_row(next_line) {
                    i += 2;
                    let mut body_rows: Vec<Vec<String>> = Vec::new();
                    while i < lines.len() {
                        let row_line = lines[i];
                        if row_line.trim().is_empty() {
                            break;
                        }
                        if !row_line.trim().starts_with('|') {
                            break;
                        }
                        if let Some(row_cells) = parse_pipe_table_row(row_line) {
                            body_rows.push(row_cells);
                        }
                        i += 1;
                    }
                    flush_md(&mut md_buf, &mut out);
                    out.push(BodySegment::Table {
                        headers: header_cells,
                        rows: body_rows,
                    });
                    continue;
                }
            }
        }

        md_buf.push_str(line);
        md_buf.push('\n');
        i += 1;
    }

    flush_md(&mut md_buf, &mut out);
    out
}

/// Convert ATX markdown headings to bold text so PDF export does not add them to the bookmark outline.
fn strip_md_headings_for_pdf(text: &str) -> String {
    let mut out = String::new();
    for (i, line) in text.lines().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix('#') {
            let mut hashes = 1usize;
            let mut tail = rest;
            while tail.starts_with('#') && hashes < 6 {
                hashes += 1;
                tail = &tail[1..];
            }
            if tail.starts_with(' ') {
                let title = tail.trim();
                if !title.is_empty() {
                    out.push_str("**");
                    out.push_str(title);
                    out.push_str("**");
                    continue;
                }
            }
        }
        out.push_str(line);
    }
    out
}

fn push_markdown_segment(out: &mut Vec<BodySegment>, text: String) {
    if text.is_empty() {
        return;
    }
    out.push(BodySegment::Markdown(strip_md_headings_for_pdf(&text)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_leaves_plain_text_as_markdown() {
        let s = "Hello\n\nWorld";
        let segs = split_markdown_for_pdf(s);
        assert_eq!(segs.len(), 1);
        assert!(matches!(&segs[0], BodySegment::Markdown(m) if m.contains("Hello")));
    }

    #[test]
    fn split_extracts_pipe_table() {
        let s = "## Steps\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nTail\n";
        let segs = split_markdown_for_pdf(s);
        assert_eq!(segs.len(), 3);
        match &segs[0] {
            BodySegment::Markdown(m) => assert!(m.contains("**Steps**")),
            _ => panic!("expected markdown segment"),
        }
        match &segs[1] {
            BodySegment::Table { headers, rows } => {
                assert_eq!(headers, &vec!["A".to_string(), "B".to_string()]);
                assert_eq!(rows, &vec![vec!["1".to_string(), "2".to_string()]]);
            }
            _ => panic!("expected table segment"),
        }
    }

    #[test]
    fn split_handles_table_with_leading_hash_column() {
        let s = "| # | Action | Expected |\n| --- | --- | --- |\n| 1 | nnnn | ok |\n";
        let segs = split_markdown_for_pdf(s);
        assert_eq!(segs.len(), 1);
        match &segs[0] {
            BodySegment::Table { headers, rows } => {
                assert_eq!(headers.len(), 3);
                assert_eq!(rows.len(), 1);
            }
            _ => panic!("expected table"),
        }
    }

    #[test]
    fn strip_md_headings_for_pdf_converts_atx_headings_to_bold() {
        let s = "## Steps\n\nParagraph\n### Expected Result\n";
        let out = strip_md_headings_for_pdf(s);
        assert!(out.contains("**Steps**"));
        assert!(out.contains("**Expected Result**"));
        assert!(!out.contains("## Steps"));
    }
}
