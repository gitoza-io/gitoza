use std::collections::{HashMap, HashSet};
use std::path::Path;

use anyhow::Result;
use rusqlite::Connection;

use crate::models::RepositoryTreeNode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RepositoryTreeDepth {
    #[default]
    Full,
    Projects,
}

pub fn parse_repository_tree_depth(depth: Option<&str>) -> RepositoryTreeDepth {
    match depth.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("projects") => RepositoryTreeDepth::Projects,
        _ => RepositoryTreeDepth::Full,
    }
}

fn project_node_name_from_path(project_path: &str) -> String {
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

fn build_project_node(
    directory: &str,
    case_count: i64,
    disk_name: Option<&str>,
    depth: RepositoryTreeDepth,
) -> RepositoryTreeNode {
    let display = crate::project_name_from_directory(directory);
    let name = disk_name
        .map(|s| s.to_string())
        .unwrap_or_else(|| project_node_name_from_path(directory));
    let children = if depth == RepositoryTreeDepth::Projects {
        Some(vec![])
    } else {
        None
    };
    RepositoryTreeNode {
        type_: "folder".to_string(),
        name,
        display_name: display.clone(),
        children,
        directory_path: Some(directory.to_string()),
        path_from_root: Some(vec![display]),
        is_project: true,
        case_count,
    }
}

/// Project-only nodes from SQLite index + on-disk discovery (no suite scan).
pub fn build_repository_project_nodes(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
    folder_prefix: Option<&str>,
    archive_mode: bool,
) -> Result<Vec<RepositoryTreeNode>> {
    let prefix = folder_prefix
        .map(|s| s.trim().replace('\\', "/"))
        .filter(|s| !s.is_empty());

    let db_rows = if archive_mode {
        crate::dashboard_archive_projects_from_db(conn, repo_slug)?
    } else {
        crate::dashboard_projects_from_db(conn, repo_slug)?
    };
    let mut counts: HashMap<String, i64> = HashMap::new();
    for r in &db_rows {
        counts.insert(r.directory.clone(), r.total_test_cases);
    }

    let mut project_paths: HashSet<String> = HashSet::new();
    for r in &db_rows {
        if !r.directory.is_empty() {
            project_paths.insert(r.directory.clone());
        }
    }
    let discovered = if archive_mode {
        crate::discover_archive_project_rel_paths(repo_path)
    } else {
        crate::discover_case_project_rel_paths(repo_path)
    };
    for rel in discovered {
        project_paths.insert(rel);
    }

    let mut paths: Vec<String> = project_paths.into_iter().collect();
    paths.sort();

    let disk_names = if archive_mode {
        disk_archive_project_names(repo_path)
    } else {
        disk_project_names(repo_path)
    };

    let mut tree = Vec::new();
    for directory in paths {
        if let Some(ref pf) = prefix {
            if directory != *pf {
                continue;
            }
        }
        let case_count = counts.get(&directory).copied().unwrap_or(0);
        let disk_name = disk_names.get(&directory).map(|s| s.as_str());
        tree.push(build_project_node(
            &directory,
            case_count,
            disk_name,
            RepositoryTreeDepth::Projects,
        ));
    }
    Ok(tree)
}

fn disk_project_names(repo_path: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let cases_root = repo_path.join(".gitoza/test/cases");
    let ignore: HashSet<&str> = crate::CASE_TREE_IGNORE_DIRS.iter().copied().collect();
    if let Ok(entries) = std::fs::read_dir(&cases_root) {
        for e in entries.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let name_s = e.file_name().to_string_lossy().to_string();
            if name_s.starts_with('.') || ignore.contains(name_s.as_str()) {
                continue;
            }
            let rel = crate::rel_path_unix(repo_path, &e.path());
            out.insert(rel, name_s);
        }
    }
    out
}

fn disk_archive_project_names(repo_path: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let archive_root = repo_path.join(".gitoza/test/cases/.archive");
    let ignore: HashSet<&str> = crate::CASE_TREE_IGNORE_DIRS.iter().copied().collect();
    if let Ok(entries) = std::fs::read_dir(&archive_root) {
        for e in entries.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let name_s = e.file_name().to_string_lossy().to_string();
            if name_s.starts_with('.') || ignore.contains(name_s.as_str()) {
                continue;
            }
            let rel = crate::rel_path_unix(repo_path, &e.path());
            out.insert(rel, name_s);
        }
    }
    out
}

/// Full repository tree or scoped project subtree (disk structure + DB counts).
pub fn build_repository_tree_scoped(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
    folder_prefix: Option<&str>,
    depth: RepositoryTreeDepth,
    archive_mode: bool,
) -> Result<Vec<RepositoryTreeNode>> {
    if depth == RepositoryTreeDepth::Projects {
        return build_repository_project_nodes(
            conn,
            repo_path,
            repo_slug,
            folder_prefix,
            archive_mode,
        );
    }

    let ignore: HashSet<&str> = crate::CASE_TREE_IGNORE_DIRS.iter().copied().collect();
    let cases_root = if archive_mode {
        repo_path.join(".gitoza/test/cases/.archive")
    } else {
        repo_path.join(".gitoza/test/cases")
    };
    if !cases_root.is_dir() {
        return Ok(vec![]);
    }

    let has_index = crate::count_cases_db(conn, repo_slug).unwrap_or(0) > 0;
    let prefix = folder_prefix
        .map(|s| s.trim().replace('\\', "/"))
        .filter(|s| !s.is_empty());

    let prefix_counts = if has_index {
        crate::build_prefix_case_counts(conn, repo_slug, prefix.as_deref(), archive_mode)
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };
    let prefix_counts_ref = if has_index {
        Some(&prefix_counts)
    } else {
        None
    };

    let mut project_dirs: Vec<std::fs::DirEntry> = vec![];
    if let Ok(entries) = std::fs::read_dir(&cases_root) {
        for e in entries.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let name_s = e.file_name().to_string_lossy().to_string();
            if (!archive_mode && name_s.starts_with('.')) || ignore.contains(name_s.as_str()) {
                continue;
            }
            let rel = crate::rel_path_unix(repo_path, &e.path());
            if let Some(ref pf) = prefix {
                if rel != *pf {
                    continue;
                }
            }
            project_dirs.push(e);
        }
    }
    project_dirs.sort_by_key(|e| e.file_name());

    let mut tree: Vec<RepositoryTreeNode> = vec![];
    for entry in project_dirs {
        let abs = entry.path();
        let name_s = entry.file_name().to_string_lossy().to_string();
        if !abs.is_dir() {
            continue;
        }
        let dir_rel = crate::rel_path_unix(repo_path, &abs);
        let project_display = crate::project_name_from_directory(&dir_rel);
        let crumbs = vec![project_display.clone()];

        let children = crate::scan_subfolders_into_nodes(
            &abs,
            repo_path,
            crumbs.clone(),
            &ignore,
            repo_slug,
            has_index,
            Some(conn),
            prefix_counts_ref,
        );

        let case_count = if has_index {
            crate::prefix_case_count(prefix_counts_ref, &dir_rel)
        } else {
            crate::count_yaml_cases_in_dir_fs(&abs, &ignore)
        };

        tree.push(RepositoryTreeNode {
            type_: "folder".to_string(),
            name: name_s,
            display_name: project_display,
            children: Some(children),
            directory_path: Some(dir_rel),
            path_from_root: Some(vec![crumbs[0].clone()]),
            is_project: true,
            case_count,
        });
    }

    Ok(tree)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_schema;
    use crate::UpsertCaseArgs;
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        p.push(format!("gitoza_repo_tree_{prefix}_{t}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn seed_case(conn: &Connection, repo: &str, file_path: &str, directory: &str) {
        crate::upsert_case_db(
            conn,
            UpsertCaseArgs {
                case_id: "TC-1".to_string(),
                title: Some("T".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: None,
                file_path: file_path.to_string(),
                repo_slug: repo.to_string(),
                directory: directory.to_string(),
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: None,
                assigned_to: None,
                automated: false,
                params: BTreeMap::new(),
            },
        )
        .unwrap();
    }

    #[test]
    fn build_project_nodes_has_empty_children() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo_path = temp_dir("proj_nodes");
        let cases_root = repo_path.join(".gitoza/test/cases/proj_a.gitoza.test");
        fs::create_dir_all(&cases_root).unwrap();
        seed_case(
            &conn,
            "r1",
            ".gitoza/test/cases/proj_a.gitoza.test/case1.md",
            ".gitoza/test/cases/proj_a.gitoza.test",
        );

        let tree = build_repository_project_nodes(&conn, &repo_path, "r1", None, false).unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].case_count, 1);
        assert_eq!(tree[0].children.as_ref().map(|c| c.len()), Some(0));
        assert!(tree[0].is_project);
    }

    #[test]
    fn build_scoped_full_returns_one_project_with_suites() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo_path = temp_dir("scoped_full");
        let project = ".gitoza/test/cases/proj_a.gitoza.test";
        fs::create_dir_all(repo_path.join(project).join("suite_b")).unwrap();
        fs::create_dir_all(repo_path.join(".gitoza/test/cases/proj_b.gitoza.test")).unwrap();
        seed_case(
            &conn,
            "r1",
            &format!("{project}/suite_b/case1.md"),
            project,
        );

        let tree = build_repository_tree_scoped(
            &conn,
            &repo_path,
            "r1",
            Some(project),
            RepositoryTreeDepth::Full,
            false,
        )
        .unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].directory_path.as_deref(), Some(project));
        assert_eq!(tree[0].children.as_ref().map(|c| c.len()), Some(1));
        assert_eq!(tree[0].case_count, 1);
        assert_eq!(tree[0].children.as_ref().unwrap()[0].case_count, 1);
    }

    #[test]
    fn build_scoped_full_nested_counts_match_batch_map() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo_path = temp_dir("nested_counts");
        let project = ".gitoza/test/cases/proj_a.gitoza.test";
        fs::create_dir_all(repo_path.join(project)).unwrap();
        fs::create_dir_all(repo_path.join(project).join("suite_b")).unwrap();
        seed_case(&conn, "r1", &format!("{project}/root_case.md"), project);
        crate::upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "TC-2".to_string(),
                title: Some("Nested".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: None,
                file_path: format!("{project}/suite_b/nested.md"),
                repo_slug: "r1".to_string(),
                directory: project.to_string(),
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: None,
                assigned_to: None,
                automated: false,
                params: BTreeMap::new(),
            },
        )
        .unwrap();

        let batch = crate::build_prefix_case_counts(&conn, "r1", Some(project), false).unwrap();
        assert_eq!(
            batch.get(project).copied().unwrap_or(0),
            crate::count_cases_by_path_prefix_db(&conn, "r1", project).unwrap()
        );
        let suite_path = format!("{project}/suite_b");
        assert_eq!(
            batch.get(&suite_path).copied().unwrap_or(0),
            crate::count_cases_by_path_prefix_db(&conn, "r1", &suite_path).unwrap()
        );

        let tree = build_repository_tree_scoped(
            &conn,
            &repo_path,
            "r1",
            Some(project),
            RepositoryTreeDepth::Full,
            false,
        )
        .unwrap();
        assert_eq!(tree[0].case_count, 2);
        let suite = tree[0]
            .children
            .as_ref()
            .unwrap()
            .iter()
            .find(|n| n.directory_path.as_deref() == Some(suite_path.as_str()))
            .unwrap();
        assert_eq!(suite.case_count, 1);
    }
}
