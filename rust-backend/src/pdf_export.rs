use std::path::Path;

use anyhow::{anyhow, Result};
use typst::foundations::{Array, Dict, IntoValue, Value};
use typst::layout::PagedDocument;
use typst_as_lib::typst_kit_options::TypstKitFontOptions;
use typst_as_lib::TypstEngine;

use crate::markdown_pdf::BodySegment;
use crate::models::{
    ExportTocCase, ExportTocNode, TestCase, TestCaseTag, TestRunPdfCase, TestRunPdfRun,
};
use crate::AppState;

const TEST_CASE_TEMPLATE: &str = include_str!("../templates/test_case_export.typ");
const TEST_RUN_TEMPLATE: &str = include_str!("../templates/test_run_export.typ");

pub async fn generate_pdf(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    case: TestCase,
) -> Vec<u8> {
    generate_pdf_for_cases(state, repo_slug, repo_path, vec![case], Vec::new()).await
}

pub async fn generate_pdf_for_cases(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    cases: Vec<TestCase>,
    toc: Vec<ExportTocNode>,
) -> Vec<u8> {
    if cases.is_empty() {
        return Vec::new();
    }

    match generate_pdf_result(state, repo_slug, repo_path, cases, toc).await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!("failed to generate Typst PDF: {err:?}");
            Vec::new()
        }
    }
}

pub async fn generate_pdf_for_runs(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    runs: Vec<TestRunPdfRun>,
) -> Vec<u8> {
    if runs.is_empty() {
        return Vec::new();
    }

    match generate_run_pdf_result(state, repo_slug, repo_path, runs).await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!("failed to generate Typst run PDF: {err:?}");
            Vec::new()
        }
    }
}

async fn generate_pdf_result(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    cases: Vec<TestCase>,
    toc: Vec<ExportTocNode>,
) -> Result<Vec<u8>> {
    let engine = TypstEngine::builder()
        .main_file(TEST_CASE_TEMPLATE)
        .search_fonts_with(TypstKitFontOptions::default())
        .with_package_file_resolver()
        .with_file_system_resolver(state.config_dir.as_path())
        .build();

    let warned = engine.compile_with_input::<_, PagedDocument>(
        build_typst_inputs(state, repo_slug, repo_path, &cases, &toc).await,
    );
    let document = warned
        .output
        .map_err(|err| anyhow!("typst compile error: {err:?}"))?;

    typst_pdf::pdf(&document, &Default::default())
        .map_err(|err| anyhow!("typst pdf conversion error: {err:?}"))
}

async fn generate_run_pdf_result(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    runs: Vec<TestRunPdfRun>,
) -> Result<Vec<u8>> {
    let engine = TypstEngine::builder()
        .main_file(TEST_RUN_TEMPLATE)
        .search_fonts_with(TypstKitFontOptions::default())
        .with_package_file_resolver()
        .with_file_system_resolver(state.config_dir.as_path())
        .build();

    let warned = engine.compile_with_input::<_, PagedDocument>(
        build_run_typst_inputs(state, repo_slug, repo_path, &runs).await,
    );
    let document = warned
        .output
        .map_err(|err| anyhow!("typst compile error: {err:?}"))?;

    typst_pdf::pdf(&document, &Default::default())
        .map_err(|err| anyhow!("typst pdf conversion error: {err:?}"))
}

async fn build_typst_inputs(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    cases: &[TestCase],
    toc: &[ExportTocNode],
) -> Dict {
    let mut dict = Dict::new();
    let mut items = Vec::with_capacity(cases.len());
    for c in cases {
        items.push(case_to_typst_dict(state, repo_slug, repo_path, c).await);
    }
    dict.insert("cases".into(), items.into_value());
    dict.insert("toc".into(), toc_nodes_to_typst_array(toc).into_value());
    dict
}

async fn build_run_typst_inputs(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    runs: &[TestRunPdfRun],
) -> Dict {
    let mut dict = Dict::new();
    let mut items = Vec::with_capacity(runs.len());
    for r in runs {
        items.push(run_to_typst_dict(state, repo_slug, repo_path, r).await);
    }
    dict.insert("runs".into(), items.into_value());
    dict
}

async fn case_to_typst_dict(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    case: &TestCase,
) -> Dict {
    let mut dict = Dict::new();
    dict.insert("title".into(), case.title.clone().into_value());
    dict.insert("case_id".into(), case.case_id.clone().into_value());
    dict.insert("status".into(), to_status_label(&case.status).into_value());
    dict.insert(
        "priority".into(),
        to_priority_label(&case.priority).into_value(),
    );
    dict.insert("path".into(), case.path.clone().into_value());
    dict.insert(
        "requirement_id".into(),
        case.requirement_id.clone().into_value(),
    );
    dict.insert("tags".into(), typst_tag_items(&case.tags).into_value());
    let segments =
        crate::typst_markdown_assets::split_body_for_pdf(state, repo_slug, repo_path, &case.body)
            .await;
    dict.insert(
        "body_segments".into(),
        body_segments_to_typst_array(&segments).into_value(),
    );
    dict
}

async fn run_to_typst_dict(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    run: &TestRunPdfRun,
) -> Dict {
    let mut dict = Dict::new();
    let title = if run.title.trim().is_empty() {
        "Unnamed Run".to_string()
    } else {
        run.title.clone()
    };
    let total_cases = if run.total_cases > 0 {
        run.total_cases
    } else {
        run.cases.len() as i64
    };

    dict.insert("run_id".into(), run.run_id.clone().into_value());
    dict.insert("title".into(), title.into_value());
    dict.insert("description".into(), run.description.clone().into_value());
    dict.insert(
        "status".into(),
        to_run_status_label(run.status.as_str()).into_value(),
    );
    dict.insert("total_cases".into(), total_cases.into_value());
    dict.insert("passed".into(), run.passed.into_value());
    dict.insert("failed".into(), run.failed.into_value());
    dict.insert("skipped".into(), run.skipped.into_value());

    let mut cases = Vec::with_capacity(run.cases.len());
    for c in &run.cases {
        cases.push(run_case_to_typst_dict(state, repo_slug, repo_path, c).await);
    }
    dict.insert("cases".into(), cases.into_value());
    dict.insert(
        "toc".into(),
        toc_nodes_to_typst_array(&run.toc).into_value(),
    );
    dict
}

async fn run_case_to_typst_dict(
    state: &AppState,
    repo_slug: &str,
    repo_path: Option<&Path>,
    case: &TestRunPdfCase,
) -> Dict {
    let mut dict = Dict::new();
    dict.insert("title".into(), case.title.clone().into_value());
    dict.insert("case_id".into(), case.case_id.clone().into_value());
    let result = normalize_result_keyword(&case.result);
    dict.insert("result".into(), result.clone().into_value());
    dict.insert("result_label".into(), to_result_label(&result).into_value());
    dict.insert(
        "priority".into(),
        to_priority_label(&case.priority).into_value(),
    );
    dict.insert("path".into(), case.path.clone().into_value());
    dict.insert(
        "requirement_id".into(),
        case.requirement_id.clone().into_value(),
    );
    dict.insert("tags".into(), typst_tag_items(&case.tags).into_value());
    let segments =
        crate::typst_markdown_assets::split_body_for_pdf(state, repo_slug, repo_path, &case.body)
            .await;
    dict.insert(
        "body_segments".into(),
        body_segments_to_typst_array(&segments).into_value(),
    );
    dict
}

fn body_segments_to_typst_array(segments: &[BodySegment]) -> Value {
    Value::Array(Array::from_iter(
        segments
            .iter()
            .map(|s| Value::Dict(body_segment_to_dict(s))),
    ))
}

fn body_segment_to_dict(seg: &BodySegment) -> Dict {
    match seg {
        BodySegment::Markdown(text) => {
            let mut d = Dict::new();
            d.insert("kind".into(), "markdown".into_value());
            d.insert("text".into(), text.clone().into_value());
            d
        }
        BodySegment::Table { headers, rows } => {
            let n = headers.len().max(1);
            let mut flat: Vec<String> = headers.clone();
            for row in rows {
                let mut r = row.clone();
                while r.len() < n {
                    r.push(String::new());
                }
                r.truncate(n);
                flat.extend(r.into_iter());
            }
            let mut d = Dict::new();
            d.insert("kind".into(), "table".into_value());
            d.insert("columns".into(), (n as i64).into_value());
            d.insert(
                "cells".into(),
                Value::Array(Array::from_iter(
                    flat.iter().map(|s| s.clone().into_value()),
                )),
            );
            d
        }
        BodySegment::Image {
            path,
            width_percent,
        } => {
            let mut d = Dict::new();
            d.insert("kind".into(), "image".into_value());
            d.insert("path".into(), path.clone().into_value());
            d.insert("width_percent".into(), (*width_percent).into_value());
            d
        }
    }
}

fn to_status_label(status: &str) -> String {
    let lowered = status.trim().to_ascii_lowercase();
    match lowered.as_str() {
        "approved" => "APPROVED".to_string(),
        "rejected" => "REJECTED".to_string(),
        other if !other.is_empty() => other.to_ascii_uppercase(),
        _ => "APPROVED".to_string(),
    }
}

fn to_priority_label(priority: &str) -> String {
    let lowered = priority.trim().to_ascii_lowercase();
    match lowered.as_str() {
        "high" => "High".to_string(),
        "medium" => "Medium".to_string(),
        "low" => "Low".to_string(),
        other if !other.is_empty() => capitalize_first(other),
        _ => "High".to_string(),
    }
}

fn normalize_result_keyword(result: &str) -> String {
    let lowered = result.trim().to_ascii_lowercase();
    match lowered.as_str() {
        "passed" | "pass" => "passed".to_string(),
        "failed" | "fail" => "failed".to_string(),
        "skipped" | "skip" => "skipped".to_string(),
        _ => "pending".to_string(),
    }
}

fn to_result_label(result: &str) -> String {
    match normalize_result_keyword(result).as_str() {
        "passed" => "PASSED".to_string(),
        "failed" => "FAILED".to_string(),
        "skipped" => "SKIPPED".to_string(),
        _ => "PENDING".to_string(),
    }
}

fn to_run_status_label(status: &str) -> String {
    let lowered = status.trim().to_ascii_lowercase();
    match lowered.as_str() {
        "not_started" => "NOT STARTED".to_string(),
        "in_progress" => "IN PROGRESS".to_string(),
        "passed" => "PASSED".to_string(),
        "failed" => "FAILED".to_string(),
        other if !other.is_empty() => other.replace('_', " ").to_ascii_uppercase(),
        _ => "NOT STARTED".to_string(),
    }
}

fn typst_tag_items(tags: &[TestCaseTag]) -> Vec<Dict> {
    tags.iter()
        .map(|tag| {
            let mut tag_dict = Dict::new();
            let tone = tag
                .tone
                .clone()
                .unwrap_or_else(|| infer_tag_tone(&tag.name).to_string());
            tag_dict.insert("name".into(), tag.name.clone().into_value());
            tag_dict.insert("tone".into(), tone.into_value());
            tag_dict
        })
        .collect()
}

fn infer_tag_tone(tag: &str) -> &'static str {
    match tag.trim().to_ascii_lowercase().as_str() {
        "manual" => "green",
        "test-repository" | "test_repository" => "purple",
        "tree" => "blue",
        "critical" => "red",
        _ => "blue",
    }
}

fn capitalize_first(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

fn toc_nodes_to_typst_array(nodes: &[ExportTocNode]) -> Value {
    Value::Array(Array::from_iter(
        nodes.iter().map(|node| Value::Dict(toc_node_to_dict(node))),
    ))
}

fn toc_node_to_dict(node: &ExportTocNode) -> Dict {
    let mut dict = Dict::new();
    dict.insert("type".into(), node.type_.clone().into_value());
    dict.insert(
        "display_name".into(),
        node.display_name.clone().into_value(),
    );
    dict.insert("children".into(), toc_nodes_to_typst_array(&node.children));
    dict.insert(
        "cases".into(),
        Value::Array(Array::from_iter(
            node.cases.iter().map(|c| Value::Dict(toc_case_to_dict(c))),
        )),
    );
    dict
}

fn toc_case_to_dict(case: &ExportTocCase) -> Dict {
    let mut dict = Dict::new();
    dict.insert("case_index".into(), (case.case_index as i64).into_value());
    dict.insert("case_id".into(), case.case_id.clone().into_value());
    dict.insert("title".into(), case.title.clone().into_value());
    dict.insert(
        "priority".into(),
        to_priority_label(&case.priority).into_value(),
    );
    let result = normalize_result_keyword(&case.result);
    dict.insert("result".into(), result.clone().into_value());
    let result_label = if case.result_label.trim().is_empty() {
        to_result_label(&result)
    } else {
        case.result_label.clone()
    };
    dict.insert("result_label".into(), result_label.into_value());
    dict
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ExportTocCase, ExportTocNode, TestRunPdfCase, TestRunPdfRun};

    #[tokio::test]
    async fn generate_pdf_returns_pdf_buffer() {
        let state = crate::new_state(std::path::PathBuf::from("."));
        let case = TestCase {
            title: "Tree supports ctrl multi-select and shift range selection".to_string(),
            case_id: "TREP01".to_string(),
            status: "approved".to_string(),
            priority: "high".to_string(),
            path: "demo_project > suite_a > TREP01".to_string(),
            requirement_id: "REQ-1001".to_string(),
            tags: vec![
                TestCaseTag {
                    name: "Manual".to_string(),
                    tone: Some("green".to_string()),
                },
                TestCaseTag {
                    name: "Test-repository".to_string(),
                    tone: Some("purple".to_string()),
                },
                TestCaseTag {
                    name: "Tree".to_string(),
                    tone: Some("blue".to_string()),
                },
            ],
            body: r##"## Description

This test verifies advanced selection behavior in the Test Repository tree.

## Steps

1. Open Test Repository with at least six visible case rows in one suite.
2. Click one case row to set the initial selection.
3. Hold `Ctrl` (or `Cmd` on macOS) and click two additional non-adjacent cases.

| Action | Expected |
| --- | --- |
| Multi-select | Rows stay highlighted |

## Expected results

- `Ctrl` or `Cmd` adds and removes individual rows without clearing existing selections.
- `Shift` expands selection as a continuous range from the last anchor row.
"##
            .to_string(),
        };

        let pdf = generate_pdf(&state, "demo_project", None, case).await;
        assert!(!pdf.is_empty(), "PDF output should not be empty");
        assert!(
            pdf.starts_with(b"%PDF-"),
            "Output should start with PDF header"
        );
    }

    #[tokio::test]
    async fn generate_pdf_with_hierarchical_toc_returns_pdf_buffer() {
        let state = crate::new_state(std::path::PathBuf::from("."));
        let cases = vec![
            TestCase {
                title: "Install Gitoza".to_string(),
                case_id: "IAL-001".to_string(),
                status: "approved".to_string(),
                priority: "high".to_string(),
                path: "GitozaApp > 01 install > IAL-001".to_string(),
                requirement_id: String::new(),
                tags: vec![],
                body: "## Steps\n\n1. Run installer.\n\n## Expected Result\n\nApp launches."
                    .to_string(),
            },
            TestCase {
                title: "View Terms".to_string(),
                case_id: "LAL-001".to_string(),
                status: "approved".to_string(),
                priority: "medium".to_string(),
                path: "GitozaApp > 02 legal > LAL-001".to_string(),
                requirement_id: String::new(),
                tags: vec![],
                body: "## Steps\n\n1. Open legal screen.".to_string(),
            },
        ];
        let toc = vec![ExportTocNode {
            type_: "project".to_string(),
            display_name: "GitozaApp".to_string(),
            children: vec![
                ExportTocNode {
                    type_: "suite".to_string(),
                    display_name: "01 install".to_string(),
                    children: vec![],
                    cases: vec![ExportTocCase {
                        case_index: 0,
                        case_id: "IAL-001".to_string(),
                        title: "Install Gitoza".to_string(),
                        priority: "high".to_string(),
                        result: String::new(),
                        result_label: String::new(),
                    }],
                },
                ExportTocNode {
                    type_: "suite".to_string(),
                    display_name: "02 legal".to_string(),
                    children: vec![],
                    cases: vec![ExportTocCase {
                        case_index: 1,
                        case_id: "LAL-001".to_string(),
                        title: "View Terms".to_string(),
                        priority: "medium".to_string(),
                        result: String::new(),
                        result_label: String::new(),
                    }],
                },
            ],
            cases: vec![],
        }];

        let pdf = generate_pdf_for_cases(&state, "demo_project", None, cases, toc).await;
        assert!(!pdf.is_empty(), "PDF output should not be empty");
        assert!(
            pdf.starts_with(b"%PDF-"),
            "Output should start with PDF header"
        );
    }

    #[tokio::test]
    async fn generate_run_pdf_returns_pdf_buffer() {
        let state = crate::new_state(std::path::PathBuf::from("."));
        let run = TestRunPdfRun {
            run_id: "RUN-1".to_string(),
            title: "Release smoke run".to_string(),
            description: "Smoke validation before release".to_string(),
            status: "in_progress".to_string(),
            total_cases: 1,
            passed: 0,
            failed: 0,
            skipped: 0,
            toc: Vec::new(),
            cases: vec![TestRunPdfCase {
                title: "User can export selected run as Typst PDF".to_string(),
                case_id: "RUNEXP-01".to_string(),
                result: "passed".to_string(),
                priority: "high".to_string(),
                status: "active".to_string(),
                tags: vec![TestCaseTag {
                    name: "Smoke".to_string(),
                    tone: Some("orange".to_string()),
                }],
                path: "demo_project > export_suite > RUNEXP-01".to_string(),
                requirement_id: "REQ-2201".to_string(),
                body: "## Steps\n\n1. Open export.\n2. Select run.\n3. Export PDF.".to_string(),
            }],
        };

        let pdf = generate_pdf_for_runs(&state, "demo_project", None, vec![run]).await;
        assert!(!pdf.is_empty(), "PDF output should not be empty");
        assert!(
            pdf.starts_with(b"%PDF-"),
            "Output should start with PDF header"
        );
    }
}
