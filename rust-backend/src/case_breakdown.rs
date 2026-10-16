//! Pre-aggregated project case breakdown for Dashboard Case tab (DB-only; no YAML).

use std::collections::{BTreeMap, HashSet};

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection};

use crate::models::ProjectCaseBreakdownResponse;
use crate::{is_assignee_unassigned, ASSIGNEE_UNASSIGNED_LABEL};

const PRIORITY_KEYS: [&str; 4] = ["high", "medium", "low", "unset"];

fn normalize_priority(priority: Option<&str>) -> &'static str {
    match priority.unwrap_or("").trim().to_lowercase().as_str() {
        "high" => "high",
        "medium" => "medium",
        "low" => "low",
        _ => "unset",
    }
}

fn parse_tags(tags_json: Option<&str>) -> Vec<String> {
    tags_json
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

fn is_untagged(tags_json: Option<&str>) -> bool {
    parse_tags(tags_json).is_empty()
}

fn user_display_key(assigned_to: Option<&str>) -> String {
    match assigned_to {
        None => ASSIGNEE_UNASSIGNED_LABEL.to_string(),
        Some(s) => {
            let t = s.trim();
            if t.is_empty() || is_assignee_unassigned(t) {
                ASSIGNEE_UNASSIGNED_LABEL.to_string()
            } else {
                t.to_string()
            }
        }
    }
}

struct TagCountAggregator {
    display: BTreeMap<String, String>,
    counts: BTreeMap<String, i64>,
}

impl TagCountAggregator {
    fn new() -> Self {
        Self {
            display: BTreeMap::new(),
            counts: BTreeMap::new(),
        }
    }

    fn add_case_tags(&mut self, tags_json: Option<&str>) {
        let tags = parse_tags(tags_json);
        let mut seen_on_case = HashSet::new();
        for t in tags {
            let key = t.to_lowercase();
            if !seen_on_case.insert(key.clone()) {
                continue;
            }
            self.display.entry(key.clone()).or_insert_with(|| t.clone());
            *self.counts.entry(key).or_default() += 1;
        }
    }

    fn sorted_tags(&self) -> Vec<String> {
        let mut tags: Vec<String> = self.display.values().cloned().collect();
        tags.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        tags
    }
}

fn empty_priority_counts() -> BTreeMap<String, i64> {
    let mut m = BTreeMap::new();
    for k in PRIORITY_KEYS {
        m.insert(k.to_string(), 0);
    }
    m
}

/// Build Dashboard project case breakdown from SQLite (no YAML / git).
pub fn build_project_case_breakdown(
    conn: &Connection,
    repo_slug: &str,
    project_path: &str,
) -> Result<ProjectCaseBreakdownResponse> {
    let project_path = project_path.trim();
    if project_path.is_empty() {
        return Err(anyhow!("Project path is required."));
    }

    let mut by_priority = empty_priority_counts();
    let mut tag_agg = TagCountAggregator::new();
    let mut by_user: BTreeMap<String, i64> = BTreeMap::new();
    let mut total_cases: i64 = 0;
    let mut automated_count: i64 = 0;
    let mut untagged_count: i64 = 0;

    let mut stmt = conn.prepare(
        r#"
SELECT priority, tags, assigned_to, automated
FROM test_cases
WHERE repo_slug = ?1
  AND directory = ?2
  AND file_path NOT LIKE '.gitoza/test/cases/.archive/%'
ORDER BY file_path ASC
"#,
    )?;

    let rows = stmt.query_map(params![repo_slug, project_path], |r| {
        Ok((
            r.get::<_, Option<String>>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, i32>(3)?,
        ))
    })?;

    for row in rows {
        let (priority, tags, assigned_to, automated) = row?;
        total_cases += 1;
        if automated != 0 {
            automated_count += 1;
        }
        if is_untagged(tags.as_deref()) {
            untagged_count += 1;
        }

        let pk = normalize_priority(priority.as_deref()).to_string();
        *by_priority.entry(pk).or_default() += 1;

        tag_agg.add_case_tags(tags.as_deref());

        let user_key = user_display_key(assigned_to.as_deref());
        *by_user.entry(user_key).or_default() += 1;
    }

    for k in PRIORITY_KEYS {
        by_priority.entry(k.to_string()).or_insert(0);
    }

    Ok(ProjectCaseBreakdownResponse {
        total_cases,
        automated_count,
        untagged_count,
        by_priority,
        tags: tag_agg.sorted_tags(),
        by_tag: tag_agg.counts,
        by_user,
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
CREATE TABLE test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  title TEXT,
  tags TEXT,
  status TEXT,
  priority TEXT,
  file_path TEXT NOT NULL,
  repo_slug TEXT NOT NULL,
  directory TEXT,
  indexed_at TEXT NOT NULL,
  approve_status TEXT,
  updated_at TEXT,
  updated_by TEXT,
  assigned_to TEXT,
  automated INTEGER NOT NULL DEFAULT 0
);
"#,
        )
        .unwrap();
    }

    fn insert_case(
        conn: &Connection,
        file_path: &str,
        directory: &str,
        priority: Option<&str>,
        tags: Option<&str>,
        assigned_to: Option<&str>,
        automated: i32,
    ) {
        conn.execute(
            r#"
INSERT INTO test_cases (case_id, file_path, repo_slug, directory, indexed_at, priority, tags, assigned_to, automated)
VALUES (?1, ?2, 'repo1', ?3, '2024-01-01', ?4, ?5, ?6, ?7)
"#,
            params![
                "c1",
                file_path,
                directory,
                priority,
                tags,
                assigned_to,
                automated
            ],
        )
        .unwrap();
    }

    #[test]
    fn empty_project_returns_zeros() {
        let conn = mem_conn();
        setup_schema(&conn);
        let resp = build_project_case_breakdown(&conn, "repo1", ".gitoza/test/cases/proj").unwrap();
        assert_eq!(resp.total_cases, 0);
        assert_eq!(resp.automated_count, 0);
        assert_eq!(resp.untagged_count, 0);
        assert!(resp.tags.is_empty());
        assert!(resp.by_user.is_empty());
    }

    #[test]
    fn aggregates_priority_tags_user_automated_and_untagged() {
        let conn = mem_conn();
        setup_schema(&conn);
        let dir = ".gitoza/test/cases/proj";
        insert_case(
            &conn,
            ".gitoza/test/cases/proj/a.md",
            dir,
            Some("high"),
            Some(r#"["smoke","regression"]"#),
            Some("alice"),
            1,
        );
        insert_case(
            &conn,
            ".gitoza/test/cases/proj/b.md",
            dir,
            Some("low"),
            Some("[]"),
            None,
            0,
        );
        insert_case(
            &conn,
            ".gitoza/test/cases/proj/c.md",
            dir,
            None,
            None,
            Some("__unassigned__"),
            0,
        );

        let resp = build_project_case_breakdown(&conn, "repo1", dir).unwrap();
        assert_eq!(resp.total_cases, 3);
        assert_eq!(resp.automated_count, 1);
        assert_eq!(resp.untagged_count, 2);
        assert_eq!(resp.by_priority.get("high"), Some(&1));
        assert_eq!(resp.by_priority.get("low"), Some(&1));
        assert_eq!(resp.by_priority.get("unset"), Some(&1));
        assert!(resp.tags.contains(&"smoke".to_string()));
        assert!(resp.tags.contains(&"regression".to_string()));
        assert_eq!(resp.by_tag.get("smoke"), Some(&1));
        assert_eq!(resp.by_tag.get("regression"), Some(&1));
        assert_eq!(resp.by_user.get("alice"), Some(&1));
        assert_eq!(resp.by_user.get(ASSIGNEE_UNASSIGNED_LABEL), Some(&2));
    }

    #[test]
    fn excludes_archived_paths() {
        let conn = mem_conn();
        setup_schema(&conn);
        let dir = ".gitoza/test/cases/.archive/old";
        insert_case(
            &conn,
            ".gitoza/test/cases/.archive/old/x.md",
            dir,
            Some("high"),
            Some(r#"["x"]"#),
            Some("bob"),
            0,
        );
        let resp = build_project_case_breakdown(&conn, "repo1", dir).unwrap();
        assert_eq!(resp.total_cases, 0);
    }
}
