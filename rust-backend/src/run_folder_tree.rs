use std::collections::BTreeMap;

use anyhow::Result;
use rusqlite::{params, Connection};

use crate::models::{RunFolderResultStats, RunFolderTreeNode};

#[derive(Debug, Clone)]
struct CaseRow {
    file_path: String,
    result: Option<String>,
}

fn project_from_file_path(file_path: &str) -> String {
    let p = file_path.replace('\\', "/");
    if !p.starts_with(".gitoza/test/cases/") {
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
    let t = s.trim();
    if t.is_empty() {
        name.to_string()
    } else {
        t.to_string()
    }
}

fn suite_display_name(suite_path: &str) -> String {
    let name = suite_path.split('/').next_back().unwrap_or("");
    let s = name.replace('_', " ");
    let t = s.trim();
    if t.is_empty() {
        name.to_string()
    } else {
        t.to_string()
    }
}

fn project_folder_node_name(project_path: &str) -> String {
    let segment = project_path.split('/').next_back().unwrap_or("");
    if segment.is_empty() {
        return "project.gitoza.test".to_string();
    }
    if segment.contains(".gitoza.test") {
        segment.to_string()
    } else {
        format!("{segment}.gitoza.test")
    }
}

fn stats_for_cases(cases: &[CaseRow]) -> RunFolderResultStats {
    let mut stats = RunFolderResultStats::default();
    stats.total_cases = cases.len() as i64;
    for c in cases {
        match c.result.as_deref() {
            Some("passed") => stats.passed += 1,
            Some("failed") => stats.failed += 1,
            Some("skipped") => stats.skipped += 1,
            _ => stats.pending += 1,
        }
    }
    stats
}

fn merge_stats(parts: &[RunFolderResultStats]) -> RunFolderResultStats {
    let mut out = RunFolderResultStats::default();
    for p in parts {
        out.total_cases += p.total_cases;
        out.passed += p.passed;
        out.failed += p.failed;
        out.skipped += p.skipped;
        out.pending += p.pending;
    }
    out
}

struct InternalSuiteNode {
    path: String,
    direct_cases: Vec<CaseRow>,
    children: BTreeMap<String, InternalSuiteNode>,
}

struct InternalNode {
    path: String,
    display_name: String,
    is_project: bool,
    direct_cases: Vec<CaseRow>,
    suites: BTreeMap<String, InternalSuiteNode>,
}

fn insert_case_into_suite_tree(
    suites: &mut BTreeMap<String, InternalSuiteNode>,
    project: &str,
    folder: &str,
    row: CaseRow,
) {
    let relative = folder
        .strip_prefix(&(project.to_string() + "/"))
        .unwrap_or("");
    let segments: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return;
    }

    let mut current_map = suites;
    let mut current_path = project.to_string();
    for (i, segment) in segments.iter().enumerate() {
        let segment_key = segment.to_string();
        current_path = format!("{current_path}/{segment}");
        current_map
            .entry(segment_key.clone())
            .or_insert_with(|| InternalSuiteNode {
                path: current_path.clone(),
                direct_cases: Vec::new(),
                children: BTreeMap::new(),
            });
        let is_leaf = i == segments.len() - 1;
        if is_leaf {
            if let Some(node) = current_map.get_mut(&segment_key) {
                node.direct_cases.push(row);
            }
            return;
        }
        let next_map = &mut current_map.get_mut(&segment_key).unwrap().children;
        current_map = next_map;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RunFolderTreeDepth {
    #[default]
    Full,
    Projects,
}

fn load_case_rows(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    folder_prefix: Option<&str>,
) -> Result<Vec<CaseRow>> {
    let prefix = folder_prefix
        .map(|s| s.trim().replace('\\', "/"))
        .filter(|s| !s.is_empty());
    let like = prefix.as_ref().map(|p| format!("{p}/%"));
    let mut stmt = conn.prepare(
        r#"
SELECT trc.file_path, trr.result
FROM test_run_cases trc
LEFT JOIN test_run_results trr
  ON trr.run_id = trc.run_id AND trr.file_path = trc.file_path
WHERE trc.repo_slug = ?1 AND trc.run_id = ?2
  AND (?3 IS NULL OR trc.file_path = ?3 OR trc.file_path LIKE ?4)
ORDER BY trc.id ASC
"#,
    )?;
    let rows = stmt.query_map(
        params![repo_slug, run_id, prefix.as_deref(), like.as_deref(),],
        |r| {
            Ok(CaseRow {
                file_path: r.get(0)?,
                result: r.get(1)?,
            })
        },
    )?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn build_internal_tree(rows: &[CaseRow]) -> Vec<InternalNode> {
    let mut by_project: BTreeMap<String, InternalNode> = BTreeMap::new();

    for row in rows {
        let project = project_from_file_path(&row.file_path);
        if project.is_empty() {
            continue;
        }
        let folder = folder_from_file_path(&row.file_path);
        let entry = by_project
            .entry(project.clone())
            .or_insert_with(|| InternalNode {
                path: project.clone(),
                display_name: project_display_name(&project),
                is_project: true,
                direct_cases: Vec::new(),
                suites: BTreeMap::new(),
            });

        if folder == project {
            entry.direct_cases.push(row.clone());
        } else if folder.starts_with(&(project.clone() + "/")) {
            insert_case_into_suite_tree(&mut entry.suites, &project, &folder, row.clone());
        } else {
            entry.direct_cases.push(row.clone());
        }
    }

    by_project.into_values().collect()
}

fn count_cases_in_suite(node: &InternalSuiteNode) -> i64 {
    let direct = node.direct_cases.len() as i64;
    let nested: i64 = node.children.values().map(count_cases_in_suite).sum();
    direct + nested
}

fn count_cases_in_internal(node: &InternalNode) -> i64 {
    let direct = node.direct_cases.len() as i64;
    let nested: i64 = node.suites.values().map(count_cases_in_suite).sum();
    direct + nested
}

fn stats_for_suite(node: &InternalSuiteNode) -> RunFolderResultStats {
    let mut parts = vec![stats_for_cases(&node.direct_cases)];
    for child in node.children.values() {
        parts.push(stats_for_suite(child));
    }
    merge_stats(&parts)
}

fn stats_for_internal(node: &InternalNode) -> RunFolderResultStats {
    let mut parts = vec![stats_for_cases(&node.direct_cases)];
    for suite in node.suites.values() {
        parts.push(stats_for_suite(suite));
    }
    merge_stats(&parts)
}

fn map_internal_suite_node(node: &InternalSuiteNode) -> RunFolderTreeNode {
    let mut children: Vec<RunFolderTreeNode> = node
        .children
        .values()
        .map(map_internal_suite_node)
        .collect();
    children.sort_by(|a, b| a.display_name.cmp(&b.display_name));

    RunFolderTreeNode {
        name: suite_display_name(&node.path),
        display_name: suite_display_name(&node.path),
        directory_path: node.path.clone(),
        is_project: false,
        case_count: count_cases_in_suite(node),
        result_stats: Some(stats_for_suite(node)),
        children,
    }
}

fn map_internal_to_folder_node(node: &InternalNode) -> RunFolderTreeNode {
    let mut children: Vec<RunFolderTreeNode> =
        node.suites.values().map(map_internal_suite_node).collect();
    children.sort_by(|a, b| a.display_name.cmp(&b.display_name));

    RunFolderTreeNode {
        name: if node.is_project {
            project_folder_node_name(&node.path)
        } else {
            node.display_name.clone()
        },
        display_name: node.display_name.clone(),
        directory_path: node.path.clone(),
        is_project: node.is_project,
        case_count: count_cases_in_internal(node),
        result_stats: Some(stats_for_internal(node)),
        children,
    }
}

pub fn build_run_folder_tree_from_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<Vec<RunFolderTreeNode>> {
    build_run_folder_tree_scoped(conn, repo_slug, run_id, None, RunFolderTreeDepth::Full)
}

pub fn build_run_folder_tree_scoped(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    folder_prefix: Option<&str>,
    depth: RunFolderTreeDepth,
) -> Result<Vec<RunFolderTreeNode>> {
    let rows = load_case_rows(conn, repo_slug, run_id, folder_prefix)?;
    let mut tree: Vec<RunFolderTreeNode> = build_internal_tree(&rows)
        .into_iter()
        .map(|n| {
            let mut node = map_internal_to_folder_node(&n);
            if depth == RunFolderTreeDepth::Projects {
                node.children = vec![];
            }
            node
        })
        .collect();
    tree.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    Ok(tree)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_schema;

    fn seed_run_case(
        conn: &Connection,
        repo: &str,
        run_id: &str,
        file_path: &str,
        result: Option<&str>,
    ) {
        conn.execute(
            r#"INSERT OR IGNORE INTO test_runs (run_id, repo_slug, name, created_at, updated_at)
               VALUES (?1, ?2, 'Run', 't', 't')"#,
            params![run_id, repo],
        )
        .ok();
        conn.execute(
            r#"INSERT INTO test_run_cases (run_id, repo_slug, file_path, case_id)
               VALUES (?1, ?2, ?3, 'TC-1')"#,
            params![run_id, repo, file_path],
        )
        .unwrap();
        if let Some(r) = result {
            conn.execute(
                r#"INSERT INTO test_run_results (run_id, file_path, result, executed_at)
                   VALUES (?1, ?2, ?3, 't')"#,
                params![run_id, file_path, r],
            )
            .unwrap();
        }
    }

    #[test]
    fn build_run_folder_tree_groups_projects_and_counts() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_case(
            &conn,
            "r1",
            "run-1",
            ".gitoza/test/cases/proj_a/case1.md",
            Some("passed"),
        );
        seed_run_case(
            &conn,
            "r1",
            "run-1",
            ".gitoza/test/cases/proj_a/suite_b/case2.md",
            Some("failed"),
        );

        let tree = build_run_folder_tree_from_db(&conn, "r1", "run-1").unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].case_count, 2);
        assert_eq!(tree[0].result_stats.as_ref().unwrap().passed, 1);
        assert_eq!(tree[0].result_stats.as_ref().unwrap().failed, 1);
        assert_eq!(tree[0].children.len(), 1);
    }

    #[test]
    fn build_run_folder_tree_nests_sub_suites() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let project = ".gitoza/test/cases/proj_a";
        let parent = format!("{project}/02_user_registration");
        let child = format!("{parent}/01 test");
        seed_run_case(
            &conn,
            "r1",
            "run-1",
            &format!("{parent}/direct.md"),
            Some("passed"),
        );
        seed_run_case(
            &conn,
            "r1",
            "run-1",
            &format!("{child}/nested.md"),
            Some("failed"),
        );

        let tree = build_run_folder_tree_from_db(&conn, "r1", "run-1").unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].case_count, 2);
        assert_eq!(tree[0].children.len(), 1);
        let parent_node = &tree[0].children[0];
        assert_eq!(parent_node.directory_path, parent);
        assert_eq!(parent_node.case_count, 2);
        assert_eq!(parent_node.result_stats.as_ref().unwrap().passed, 1);
        assert_eq!(parent_node.result_stats.as_ref().unwrap().failed, 1);
        assert_eq!(parent_node.children.len(), 1);
        let child_node = &parent_node.children[0];
        assert_eq!(child_node.directory_path, child);
        assert_eq!(child_node.case_count, 1);
        assert_eq!(child_node.result_stats.as_ref().unwrap().failed, 1);
        assert!(child_node.children.is_empty());
    }

    #[test]
    fn build_run_folder_tree_parent_without_direct_cases() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let project = ".gitoza/test/cases/proj_a";
        let parent = format!("{project}/02_user_registration");
        let child = format!("{parent}/01 test");
        seed_run_case(
            &conn,
            "r1",
            "run-1",
            &format!("{child}/nested.md"),
            Some("pending"),
        );

        let tree = build_run_folder_tree_from_db(&conn, "r1", "run-1").unwrap();
        assert_eq!(tree[0].children.len(), 1);
        let parent_node = &tree[0].children[0];
        assert_eq!(parent_node.directory_path, parent);
        assert_eq!(parent_node.case_count, 1);
        assert_eq!(parent_node.children.len(), 1);
        assert_eq!(parent_node.children[0].case_count, 1);
    }

    #[test]
    fn build_run_project_nodes_has_empty_children() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_case(
            &conn,
            "r1",
            "run-1",
            ".gitoza/test/cases/proj_a/case1.md",
            Some("passed"),
        );
        let tree =
            build_run_folder_tree_scoped(&conn, "r1", "run-1", None, RunFolderTreeDepth::Projects)
                .unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].case_count, 1);
        assert!(tree[0].children.is_empty());
    }

    #[test]
    fn build_run_folder_tree_scoped_by_project_prefix() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_case(
            &conn,
            "r1",
            "run-1",
            ".gitoza/test/cases/proj_a/case1.md",
            Some("passed"),
        );
        seed_run_case(
            &conn,
            "r1",
            "run-1",
            ".gitoza/test/cases/proj_b/case2.md",
            Some("failed"),
        );
        let tree = build_run_folder_tree_scoped(
            &conn,
            "r1",
            "run-1",
            Some(".gitoza/test/cases/proj_a"),
            RunFolderTreeDepth::Full,
        )
        .unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].directory_path, ".gitoza/test/cases/proj_a");
        assert_eq!(tree[0].case_count, 1);
    }
}
