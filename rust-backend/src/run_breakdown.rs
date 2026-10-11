//! Pre-aggregated run breakdown for Dashboard (DB-only; no YAML).

use std::collections::{BTreeMap, HashSet};

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{BreakdownStats, RunBreakdownResponse, SuiteBreakdownRow};

const CASES_PREFIX: &str = ".gitoza/test/cases/";
const OTHER_LOCATIONS_KEY: &str = "__other_locations__";
const PRIORITY_KEYS: [&str; 4] = ["high", "medium", "low", "unset"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResultBucket {
    Passed,
    Failed,
    Skipped,
    Pending,
}

impl BreakdownStats {
    fn add_result(&mut self, bucket: ResultBucket) {
        self.total_cases += 1;
        match bucket {
            ResultBucket::Passed => self.passed += 1,
            ResultBucket::Failed => self.failed += 1,
            ResultBucket::Skipped => self.skipped += 1,
            ResultBucket::Pending => self.pending += 1,
        }
    }

    fn merge(&mut self, other: &BreakdownStats) {
        self.total_cases += other.total_cases;
        self.passed += other.passed;
        self.failed += other.failed;
        self.skipped += other.skipped;
        self.pending += other.pending;
    }
}

fn normalize_result(result: Option<&str>) -> ResultBucket {
    match result.unwrap_or("").trim().to_lowercase().as_str() {
        "passed" | "pass" => ResultBucket::Passed,
        "failed" | "fail" => ResultBucket::Failed,
        "skipped" | "skip" => ResultBucket::Skipped,
        _ => ResultBucket::Pending,
    }
}

fn normalize_priority(priority: Option<&str>) -> &'static str {
    match priority.unwrap_or("").trim().to_lowercase().as_str() {
        "high" => "high",
        "medium" => "medium",
        "low" => "low",
        _ => "unset",
    }
}

fn project_from_file_path(file_path: &str) -> String {
    let p = file_path.replace('\\', "/");
    if !p.starts_with(CASES_PREFIX) {
        return String::new();
    }
    let parts: Vec<&str> = p.split('/').collect();
    if parts.len() >= 4 {
        parts[..4].join("/")
    } else {
        String::new()
    }
}

fn folder_from_file_path(file_path: &str) -> String {
    let p = file_path.replace('\\', "/");
    p.rfind('/').map(|i| p[..i].to_string()).unwrap_or_default()
}

fn project_display_name(project_path: &str) -> String {
    let name = project_path.split('/').next_back().unwrap_or("");
    let s = name.replace('_', " ").replace('-', " ");
    let trimmed = s.trim();
    if trimmed.is_empty() {
        name.to_string()
    } else {
        trimmed.to_string()
    }
}

fn suite_display_name(suite_path: &str) -> String {
    let name = suite_path.split('/').next_back().unwrap_or("");
    let s = name.replace('_', " ");
    let trimmed = s.trim();
    if trimmed.is_empty() {
        name.to_string()
    } else {
        trimmed.to_string()
    }
}

struct SuiteNode {
    key: String,
    display_name: String,
    direct: BreakdownStats,
    children: BTreeMap<String, SuiteNode>,
}

impl SuiteNode {
    fn new_project(path: String) -> Self {
        let display_name = project_display_name(&path);
        Self {
            key: path.clone(),
            display_name,
            direct: BreakdownStats::default(),
            children: BTreeMap::new(),
        }
    }

    fn new_suite(path: String) -> Self {
        let display_name = suite_display_name(&path);
        Self {
            key: path.clone(),
            display_name,
            direct: BreakdownStats::default(),
            children: BTreeMap::new(),
        }
    }

    fn add_direct(&mut self, bucket: ResultBucket) {
        self.direct.add_result(bucket);
    }

    fn rollup_stats(&self) -> BreakdownStats {
        let mut stats = self.direct.clone();
        for child in self.children.values() {
            stats.merge(&child.rollup_stats());
        }
        stats
    }
}

struct SuiteAggregator {
    projects: BTreeMap<String, SuiteNode>,
    other: BreakdownStats,
}

impl SuiteAggregator {
    fn new() -> Self {
        Self {
            projects: BTreeMap::new(),
            other: BreakdownStats::default(),
        }
    }

    fn add_case(&mut self, file_path: &str, bucket: ResultBucket) {
        let project_path = project_from_file_path(file_path);
        if project_path.is_empty() {
            self.other.add_result(bucket);
            return;
        }

        let folder = folder_from_file_path(file_path);
        let project = self
            .projects
            .entry(project_path.clone())
            .or_insert_with(|| SuiteNode::new_project(project_path.clone()));

        if folder == project_path || !folder.starts_with(&format!("{}/", project_path)) {
            project.add_direct(bucket);
            return;
        }

        let relative = folder
            .strip_prefix(&format!("{}/", project_path))
            .unwrap_or("");
        let segments: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
        let mut current_path = project_path.clone();
        let mut current = project;
        for segment in segments {
            current_path = format!("{}/{}", current_path, segment);
            current = current
                .children
                .entry(segment.to_string())
                .or_insert_with(|| SuiteNode::new_suite(current_path.clone()));
        }
        current.add_direct(bucket);
    }

    fn collect_rows(&self) -> Vec<SuiteBreakdownRow> {
        let mut rows = Vec::new();
        for project in self.projects.values() {
            collect_node_rows(project, "", &mut rows);
        }
        if self.other.total_cases > 0 {
            rows.push(SuiteBreakdownRow {
                key: OTHER_LOCATIONS_KEY.to_string(),
                label: "Other locations".to_string(),
                stats: self.other.clone(),
            });
        }
        rows
    }
}

fn collect_node_rows(node: &SuiteNode, parent_label: &str, rows: &mut Vec<SuiteBreakdownRow>) {
    let label = if parent_label.is_empty() {
        node.display_name.clone()
    } else {
        format!("{} › {}", parent_label, node.display_name)
    };
    let stats = node.rollup_stats();
    if stats.total_cases > 0 {
        rows.push(SuiteBreakdownRow {
            key: node.key.clone(),
            label: label.clone(),
            stats,
        });
    }
    for child in node.children.values() {
        collect_node_rows(child, &label, rows);
    }
}

struct TagAggregator {
    /// Lowercase key -> display label (first-seen casing).
    display: BTreeMap<String, String>,
    stats: BTreeMap<String, BreakdownStats>,
}

impl TagAggregator {
    fn new() -> Self {
        Self {
            display: BTreeMap::new(),
            stats: BTreeMap::new(),
        }
    }

    fn add_case_tags(&mut self, tags_json: Option<&str>, bucket: ResultBucket) {
        let tags: Vec<String> = tags_json
            .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
            .unwrap_or_default();
        let mut seen_on_case = HashSet::new();
        for t in tags {
            let s = t.trim();
            if s.is_empty() {
                continue;
            }
            let key = s.to_lowercase();
            if !seen_on_case.insert(key.clone()) {
                continue;
            }
            self.display
                .entry(key.clone())
                .or_insert_with(|| s.to_string());
            self.stats.entry(key).or_default().add_result(bucket);
        }
    }

    fn sorted_tags(&self) -> Vec<String> {
        let mut tags: Vec<String> = self.display.values().cloned().collect();
        tags.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        tags
    }
}

fn empty_priority_map() -> BTreeMap<String, BreakdownStats> {
    let mut m = BTreeMap::new();
    for k in PRIORITY_KEYS {
        m.insert(k.to_string(), BreakdownStats::default());
    }
    m
}

/// Build Dashboard breakdown from SQLite (no YAML / git).
pub fn build_run_breakdown(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<RunBreakdownResponse> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
            params![repo_slug, run_id],
            |r| r.get::<_, i32>(0),
        )
        .optional()?
        .is_some();
    if !exists {
        return Err(anyhow!("Run not found."));
    }

    let mut by_priority = empty_priority_map();
    let mut suite_agg = SuiteAggregator::new();
    let mut tag_agg = TagAggregator::new();

    let mut stmt = conn.prepare(
        r#"
SELECT trc.file_path, trc.priority, trc.tags, trr.result
FROM test_run_cases trc
LEFT JOIN test_run_results trr
  ON trr.run_id = trc.run_id AND trr.file_path = trc.file_path
WHERE trc.run_id = ?1 AND trc.repo_slug = ?2
ORDER BY trc.id ASC
"#,
    )?;

    let rows = stmt.query_map(params![run_id, repo_slug], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;

    for row in rows {
        let (file_path, priority, tags, result) = row?;
        let bucket = normalize_result(result.as_deref());
        let pk = normalize_priority(priority.as_deref()).to_string();
        by_priority.entry(pk).or_default().add_result(bucket);
        suite_agg.add_case(&file_path, bucket);
        tag_agg.add_case_tags(tags.as_deref(), bucket);
    }

    // Ensure all priority keys exist even when zero.
    for k in PRIORITY_KEYS {
        by_priority.entry(k.to_string()).or_default();
    }

    Ok(RunBreakdownResponse {
        by_priority,
        by_suite: suite_agg.collect_rows(),
        tags: tag_agg.sorted_tags(),
        by_tag: tag_agg.stats,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn mem_conn() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    fn setup_schema(conn: &Connection) {
        conn.execute_batch(
            r#"
CREATE TABLE test_runs (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,
  repo_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  approve_status TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT,
  approved_at TEXT
);
CREATE TABLE test_run_cases (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,
  repo_slug TEXT NOT NULL,
  file_path TEXT NOT NULL,
  case_id TEXT,
  priority TEXT,
  tags TEXT,
  executed_at TEXT,
  title TEXT,
  requirement_id TEXT,
  executed_by TEXT
);
CREATE TABLE test_run_results (
  run_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  result TEXT NOT NULL,
  executed_at TEXT,
  comment TEXT,
  PRIMARY KEY (run_id, file_path)
);
"#,
        )
        .unwrap();
    }

    fn insert_run(conn: &Connection, run_id: &str, slug: &str) {
        conn.execute(
            r#"INSERT INTO test_runs (run_id, repo_slug, name, created_at, updated_at, approve_status)
               VALUES (?1, ?2, 'Test Run', '2020-01-01', '2020-01-01', 'draft')"#,
            params![run_id, slug],
        )
        .unwrap();
    }

    fn insert_case(
        conn: &Connection,
        run_id: &str,
        slug: &str,
        file_path: &str,
        priority: Option<&str>,
        tags: Option<&str>,
        result: Option<&str>,
    ) {
        conn.execute(
            r#"INSERT INTO test_run_cases (run_id, repo_slug, file_path, case_id, priority, tags)
               VALUES (?1, ?2, ?3, 'TC-1', ?4, ?5)"#,
            params![run_id, slug, file_path, priority, tags],
        )
        .unwrap();
        if let Some(r) = result {
            conn.execute(
                r#"INSERT INTO test_run_results (run_id, file_path, result, executed_at)
                   VALUES (?1, ?2, ?3, '2020-01-01')"#,
                params![run_id, file_path, r],
            )
            .unwrap();
        }
    }

    #[test]
    fn empty_run_returns_zero_buckets() {
        let conn = mem_conn();
        setup_schema(&conn);
        insert_run(&conn, "run-1", "repo");
        let resp = build_run_breakdown(&conn, "repo", "run-1").unwrap();
        assert!(resp.by_suite.is_empty());
        assert!(resp.tags.is_empty());
        assert!(resp.by_tag.is_empty());
        for k in PRIORITY_KEYS {
            assert_eq!(resp.by_priority.get(k).unwrap().total_cases, 0);
        }
    }

    #[test]
    fn missing_run_errors() {
        let conn = mem_conn();
        setup_schema(&conn);
        let err = build_run_breakdown(&conn, "repo", "missing").unwrap_err();
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn nested_suite_breadcrumb_rows() {
        let conn = mem_conn();
        setup_schema(&conn);
        insert_run(&conn, "run-1", "repo");
        let project = ".gitoza/test/cases/auth.gitoza.test";
        let suite = format!("{}/login", project);
        insert_case(
            &conn,
            "run-1",
            "repo",
            &format!("{}/root.yaml", project),
            Some("high"),
            None,
            Some("passed"),
        );
        insert_case(
            &conn,
            "run-1",
            "repo",
            &format!("{}/a.yaml", suite),
            Some("medium"),
            None,
            Some("failed"),
        );

        let resp = build_run_breakdown(&conn, "repo", "run-1").unwrap();
        assert!(resp.by_suite.len() >= 2);
        assert!(resp
            .by_suite
            .iter()
            .any(|r| r.label.contains("auth") && r.stats.total_cases > 0));
        assert!(resp.by_suite.iter().any(|r| r.label.contains("login")));
        assert_eq!(resp.by_priority["high"].passed, 1);
        assert_eq!(resp.by_priority["medium"].failed, 1);
    }

    #[test]
    fn other_locations_row_for_non_standard_paths() {
        let conn = mem_conn();
        setup_schema(&conn);
        insert_run(&conn, "run-1", "repo");
        insert_case(
            &conn,
            "run-1",
            "repo",
            "custom/path/case.yaml",
            None,
            None,
            Some("passed"),
        );

        let resp = build_run_breakdown(&conn, "repo", "run-1").unwrap();
        let other = resp
            .by_suite
            .iter()
            .find(|r| r.key == OTHER_LOCATIONS_KEY)
            .unwrap();
        assert_eq!(other.label, "Other locations");
        assert_eq!(other.stats.total_cases, 1);
        assert_eq!(other.stats.passed, 1);
        assert_eq!(resp.by_priority["unset"].passed, 1);
    }

    #[test]
    fn tags_deduped_case_insensitive() {
        let conn = mem_conn();
        setup_schema(&conn);
        insert_run(&conn, "run-1", "repo");
        let fp = ".gitoza/test/cases/proj/a.yaml";
        insert_case(
            &conn,
            "run-1",
            "repo",
            fp,
            None,
            Some(r#"["Smoke", "smoke", "Regression"]"#),
            Some("passed"),
        );

        let resp = build_run_breakdown(&conn, "repo", "run-1").unwrap();
        assert_eq!(resp.tags.len(), 2);
        assert!(resp.by_tag.contains_key("smoke"));
        assert!(resp.by_tag.contains_key("regression"));
        assert_eq!(resp.by_tag["smoke"].passed, 1);
        assert_eq!(resp.by_tag["regression"].passed, 1);
    }

    #[test]
    fn priority_unset_bucket() {
        let conn = mem_conn();
        setup_schema(&conn);
        insert_run(&conn, "run-1", "repo");
        insert_case(
            &conn,
            "run-1",
            "repo",
            ".gitoza/test/cases/proj/x.yaml",
            Some(""),
            None,
            None,
        );

        let resp = build_run_breakdown(&conn, "repo", "run-1").unwrap();
        assert_eq!(resp.by_priority["unset"].pending, 1);
    }
}
