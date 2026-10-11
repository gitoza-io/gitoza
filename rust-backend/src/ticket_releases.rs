//! File-is-truth ticket releases under `.gitoza/tasks/tickets/{project}/releases/`.
//!
//! Identity (Option A): `release_id = {project}/{stem}` where the file is
//! `{TICKETS_PREFIX}{project}/releases/{stem}.yaml`. Project ownership is the
//! parent folder; YAML does not store a `project` field.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection};

use crate::{
    file_rel_from_repo, is_valid_project_name, models,
    tickets::{TICKETS_PREFIX, TICKETS_ROOT_REL},
    write_full_yaml,
};
use indexmap::IndexMap;

/// Reserved subfolder name under each ticket project (not a ticket project itself).
pub(crate) const RELEASES_DIR_NAME: &str = "releases";

/// Build relative file path for a release YAML.
pub(crate) fn release_file_rel(project: &str, stem: &str) -> String {
    format!("{TICKETS_PREFIX}{project}/{RELEASES_DIR_NAME}/{stem}.yaml")
}

/// Compose Option A release_id from project + stem.
pub(crate) fn compose_release_id(project: &str, stem: &str) -> String {
    format!("{project}/{stem}")
}

/// Parse `.gitoza/tasks/tickets/{project}/releases/{stem}.yaml` → (project, stem).
pub(crate) fn parse_release_path(file_rel: &str) -> Option<(String, String)> {
    let p = file_rel.trim().replace('\\', "/");
    let rest = p.strip_prefix(TICKETS_PREFIX)?;
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() != 3 {
        return None;
    }
    let project = parts[0];
    if project.is_empty()
        || project == RELEASES_DIR_NAME
        || project.starts_with('.')
        || !is_valid_project_name(project)
    {
        return None;
    }
    if parts[1] != RELEASES_DIR_NAME {
        return None;
    }
    let file_name = parts[2];
    if file_name.is_empty() || file_name.starts_with('.') {
        return None;
    }
    let stem = Path::new(file_name).file_stem()?.to_str()?;
    if stem.is_empty() || !is_valid_release_stem(stem) {
        return None;
    }
    let ext = Path::new(file_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "yaml" && ext != "yml" {
        return None;
    }
    Some((project.to_string(), stem.to_string()))
}

pub(crate) fn is_release_yaml_path(file_rel: &str) -> bool {
    parse_release_path(file_rel).is_some()
}

pub(crate) fn validate_release_file_path_for_write(file_path: &str) -> Result<String, String> {
    let file_path = file_path.trim_start_matches('/').trim().replace('\\', "/");
    if file_path.is_empty() || file_path.contains("..") || file_path.starts_with('/') {
        return Err("Invalid file_path".to_string());
    }
    if !is_release_yaml_path(&file_path) {
        return Err(format!(
            "Release YAML must live under .gitoza/tasks/tickets/{{project}}/{RELEASES_DIR_NAME}/ as a flat file"
        ));
    }
    Ok(file_path)
}

pub(crate) fn init_ticket_releases_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS ticket_releases (
  release_id   TEXT    NOT NULL,
  name         TEXT,
  project      TEXT,
  status       TEXT,
  file_path    TEXT    NOT NULL,
  repo_slug    TEXT    NOT NULL,
  indexed_at   TEXT    NOT NULL,
  updated_at   TEXT,
  updated_by   TEXT,
  PRIMARY KEY (repo_slug, file_path)
);
CREATE INDEX IF NOT EXISTS idx_ticket_releases_repo ON ticket_releases(repo_slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_releases_id
  ON ticket_releases(repo_slug, release_id);
CREATE INDEX IF NOT EXISTS idx_ticket_releases_updated
  ON ticket_releases(repo_slug, updated_at);
"#,
    )?;
    Ok(())
}

/// Slugify a display name into a release filename stem (not the full release_id).
pub(crate) fn slugify_release_name(name: &str) -> String {
    let mut out = String::new();
    let mut prev_us = false;
    for c in name.trim().chars() {
        let mapped = if c.is_ascii_alphanumeric() {
            Some(c.to_ascii_lowercase())
        } else if c == '.' || c == '-' || c == '_' {
            Some(c)
        } else if c.is_whitespace() || c == '/' || c == '\\' {
            Some('_')
        } else {
            None
        };
        if let Some(ch) = mapped {
            if ch == '_' {
                if prev_us || out.is_empty() {
                    continue;
                }
                prev_us = true;
                out.push('_');
            } else {
                prev_us = false;
                out.push(ch);
            }
        }
    }
    while out.ends_with('_') || out.ends_with('.') || out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "release".to_string()
    } else {
        out
    }
}

pub(crate) fn is_valid_release_stem(stem: &str) -> bool {
    let s = stem.trim();
    !s.is_empty()
        && s.len() <= 180
        && !s.contains('/')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// Option A: `{project}/{stem}`.
pub(crate) fn is_valid_release_id(id: &str) -> bool {
    let s = id.trim();
    let Some((project, stem)) = s.split_once('/') else {
        return false;
    };
    if project.is_empty()
        || project == RELEASES_DIR_NAME
        || !is_valid_project_name(project)
        || project.contains('/')
    {
        return false;
    }
    is_valid_release_stem(stem) && s.len() <= 200
}

fn yaml_str(map: &BTreeMap<String, serde_yaml::Value>, key: &str) -> Option<String> {
    map.get(key).and_then(|v| match v {
        serde_yaml::Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        serde_yaml::Value::Number(n) => Some(n.to_string()),
        serde_yaml::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

fn parse_release_from_front_matter(
    lower: BTreeMap<String, serde_yaml::Value>,
    body: String,
    raw: String,
    default_id: &str,
) -> models::YamlReleaseDetail {
    let release_id = yaml_str(&lower, "release_id").unwrap_or_else(|| default_id.to_string());
    models::YamlReleaseDetail {
        release_id,
        name: yaml_str(&lower, "name"),
        // Project is derived from path on index; ignore YAML project if present.
        project: None,
        status: yaml_str(&lower, "status").map(|s| s.to_lowercase()),
        file_path: String::new(),
        body,
        raw,
        updated_at: yaml_str(&lower, "updated_at"),
        updated_by: yaml_str(&lower, "updated_by"),
    }
}

pub(crate) fn read_release_yaml(path: &Path) -> Result<Option<models::YamlReleaseDetail>> {
    if !path.is_file() {
        return Ok(None);
    }
    let raw =
        std::fs::read_to_string(path).with_context(|| format!("Cannot read {}", path.display()))?;
    let stripped = raw.trim_start();
    if !stripped.starts_with("---") {
        return Ok(None);
    }
    let rest = &stripped[3..];
    let end = rest.find("\n---");
    let (front_text, body) = match end {
        Some(idx) => {
            let fm = &rest[..idx];
            let body = rest[idx + 4..].trim_start().to_string();
            (fm, body)
        }
        None => (rest, "".to_string()),
    };
    let data: serde_yaml::Value = match serde_yaml::from_str(front_text) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let map = match data {
        serde_yaml::Value::Mapping(m) => m,
        _ => return Ok(None),
    };
    let mut lower = BTreeMap::<String, serde_yaml::Value>::new();
    for (k, v) in map {
        if let serde_yaml::Value::String(s) = k {
            lower.insert(s.to_lowercase(), v);
        }
    }
    let default_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    Ok(Some(parse_release_from_front_matter(
        lower,
        body,
        raw,
        &default_id,
    )))
}

pub(crate) fn release_detail_to_front_matter(
    d: &models::YamlReleaseDetail,
) -> IndexMap<String, serde_yaml::Value> {
    let mut fm = IndexMap::new();
    fm.insert(
        "release_id".to_string(),
        serde_yaml::Value::String(d.release_id.clone()),
    );
    if let Some(name) = &d.name {
        if !name.trim().is_empty() {
            fm.insert("name".to_string(), serde_yaml::Value::String(name.clone()));
        }
    }
    // Do not write project into YAML; ownership is the parent folder.
    if let Some(status) = &d.status {
        if !status.trim().is_empty() {
            fm.insert(
                "status".to_string(),
                serde_yaml::Value::String(status.to_lowercase()),
            );
        }
    }
    fm
}

pub(crate) struct UpsertReleaseArgs {
    pub(crate) release_id: String,
    pub(crate) name: Option<String>,
    pub(crate) project: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) file_path: String,
    pub(crate) repo_slug: String,
    pub(crate) updated_at: Option<String>,
    pub(crate) updated_by: Option<String>,
}

/// Load SQLite-owned release audit fields for detail API overlays.
pub(crate) fn load_release_audit(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
) -> (Option<String>, Option<String>) {
    let key = crate::normalize_repo_rel_path(file_path);
    if key.is_empty() {
        return (None, None);
    }
    conn.query_row(
        r#"SELECT updated_at, updated_by FROM ticket_releases
WHERE repo_slug = ?1 AND file_path = ?2"#,
        params![repo_slug, key],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    )
    .unwrap_or((None, None))
}

/// Overlay SQLite release audit onto a YAML-parsed detail.
pub(crate) fn apply_release_audit_from_db(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
    detail: &mut models::YamlReleaseDetail,
) {
    let (at, by) = load_release_audit(conn, repo_slug, file_path);
    detail.updated_at = at;
    detail.updated_by = by;
}

pub(crate) fn upsert_release_db(conn: &Connection, a: UpsertReleaseArgs) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        r#"
INSERT INTO ticket_releases
  (release_id, name, project, status, file_path, repo_slug, indexed_at, updated_at, updated_by)
VALUES
  (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
ON CONFLICT(repo_slug, file_path) DO UPDATE SET
  release_id = excluded.release_id,
  name = excluded.name,
  project = excluded.project,
  status = excluded.status,
  indexed_at = excluded.indexed_at,
  updated_at = COALESCE(excluded.updated_at, ticket_releases.updated_at),
  updated_by = COALESCE(excluded.updated_by, ticket_releases.updated_by)
"#,
        params![
            a.release_id,
            a.name,
            a.project,
            a.status,
            a.file_path,
            a.repo_slug,
            now,
            a.updated_at,
            a.updated_by,
        ],
    )?;
    Ok(())
}

fn detail_to_upsert(
    d: &models::YamlReleaseDetail,
    file_rel: &str,
    repo_slug: &str,
    project: &str,
    release_id: &str,
    audit: &crate::AuditStampSource,
) -> UpsertReleaseArgs {
    let (updated_at, updated_by) = audit.resolve(file_rel);
    UpsertReleaseArgs {
        release_id: release_id.to_string(),
        name: d.name.clone(),
        project: Some(project.to_string()),
        status: d.status.clone(),
        file_path: file_rel.to_string(),
        repo_slug: repo_slug.to_string(),
        updated_at,
        updated_by,
    }
}

pub(crate) fn index_release_yaml_file_with_audit(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    file_rel: &str,
    audit: &crate::AuditStampSource,
) -> Result<()> {
    let norm = file_rel.replace('\\', "/");
    let Some((project, stem)) = parse_release_path(&norm) else {
        let _ = delete_release_db_row(conn, slug, &norm);
        return Ok(());
    };
    let release_id = compose_release_id(&project, &stem);
    let full = repo_path.join(&norm);
    match read_release_yaml(&full)? {
        Some(mut d) => {
            d.file_path = norm.clone();
            d.release_id = release_id.clone();
            d.project = Some(project.clone());
            upsert_release_db(
                conn,
                detail_to_upsert(&d, &norm, slug, &project, &release_id, audit),
            )?;
        }
        None => {
            let _ = delete_release_db_row(conn, slug, &norm);
        }
    }
    Ok(())
}

fn scan_release_dir(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if !(lower.ends_with(".yaml") || lower.ends_with(".yml")) {
            continue;
        }
        out.push(p);
    }
}

pub(crate) fn index_releases_from_yaml(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
) -> Result<i64> {
    let audit = crate::AuditStampSource::for_releases_full(repo_path);
    index_releases_from_yaml_with_audit(conn, repo_path, slug, &audit)
}

pub(crate) fn index_releases_from_yaml_with_audit(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    audit: &crate::AuditStampSource,
) -> Result<i64> {
    let tickets_root = repo_path.join(TICKETS_ROOT_REL);
    let mut files: Vec<PathBuf> = Vec::new();
    if tickets_root.is_dir() {
        let Ok(projects) = std::fs::read_dir(&tickets_root) else {
            return Ok(0);
        };
        for entry in projects.flatten() {
            let project_dir = entry.path();
            if !project_dir.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == RELEASES_DIR_NAME || !is_valid_project_name(&name) {
                continue;
            }
            let releases_dir = project_dir.join(RELEASES_DIR_NAME);
            if releases_dir.is_dir() {
                scan_release_dir(&releases_dir, &mut files);
            }
        }
    }
    let mut n = 0i64;
    for path in files {
        let rel = file_rel_from_repo(repo_path, &path);
        if !is_release_yaml_path(&rel) {
            continue;
        }
        index_release_yaml_file_with_audit(conn, repo_path, slug, &rel, audit)?;
        n += 1;
    }
    Ok(n)
}

pub(crate) fn reindex_releases_for_repo(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
) -> Result<i64> {
    conn.execute("DELETE FROM ticket_releases WHERE repo_slug = ?", [slug])?;
    index_releases_from_yaml(conn, repo_path, slug)
}

pub(crate) fn apply_incremental_release_changes(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    paths: &[String],
    audit: &crate::AuditStampSource,
) -> Result<()> {
    for p in paths {
        let norm = p.trim().replace('\\', "/");
        if !is_release_yaml_path(&norm) {
            continue;
        }
        let full = repo_path.join(&norm);
        if full.is_file() {
            index_release_yaml_file_with_audit(conn, repo_path, slug, &norm, audit)?;
        } else {
            delete_release_db_row(conn, slug, &norm)?;
        }
    }
    Ok(())
}

pub(crate) fn filter_release_yaml_paths(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| is_release_yaml_path(p))
        .cloned()
        .collect()
}

#[derive(Debug, Default)]
pub(crate) struct QueryReleasesArgs {
    pub(crate) search: Option<String>,
    pub(crate) project: Option<String>,
    /// When true with empty project filter semantics: only rows with NULL/empty project.
    pub(crate) project_empty: bool,
    pub(crate) release_id: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) limit: i64,
    pub(crate) offset: i64,
}

pub(crate) fn list_releases(
    conn: &Connection,
    repo_slug: &str,
    args: QueryReleasesArgs,
) -> Result<(Vec<models::YamlReleaseListItem>, i64)> {
    let mut conditions = vec!["repo_slug = ?".to_string()];
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(repo_slug.to_string())];

    if let Some(s) = args.search.as_ref().filter(|s| !s.trim().is_empty()) {
        let like = format!("%{}%", s.trim());
        conditions
            .push("(release_id LIKE ? OR name LIKE ? OR IFNULL(project,'') LIKE ?)".to_string());
        params_vec.push(Box::new(like.clone()));
        params_vec.push(Box::new(like.clone()));
        params_vec.push(Box::new(like));
    }

    if args.project_empty {
        conditions.push("(project IS NULL OR TRIM(project) = '')".to_string());
    } else if let Some(s) = args.project.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("TRIM(project) = ?".to_string());
        params_vec.push(Box::new(s.trim().to_string()));
    }

    if let Some(s) = args.release_id.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("TRIM(release_id) = ?".to_string());
        params_vec.push(Box::new(s.trim().to_string()));
    }

    if let Some(s) = args.status.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(TRIM(IFNULL(status, ''))) = LOWER(?)".to_string());
        params_vec.push(Box::new(s.trim().to_string()));
    }

    let where_sql = conditions.join(" AND ");
    let count_sql = format!("SELECT COUNT(*) FROM ticket_releases WHERE {where_sql}");
    let mut count_stmt = conn.prepare(&count_sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let total: i64 = count_stmt.query_row(param_refs.as_slice(), |r| r.get(0))?;

    let list_sql = format!(
        r#"
SELECT release_id, name, project, status, file_path, updated_at, updated_by,
  (
    SELECT COUNT(*) FROM tickets t
    WHERE t.repo_slug = ticket_releases.repo_slug
      AND LOWER(TRIM(IFNULL(t.release, ''))) = LOWER(TRIM(ticket_releases.release_id))
  ) AS ticket_count
FROM ticket_releases
WHERE {where_sql}
ORDER BY COALESCE(updated_at, '') DESC, release_id ASC
LIMIT ? OFFSET ?
"#
    );
    let mut list_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(params_vec.len() + 2);
    list_params.extend(params_vec);
    list_params.push(Box::new(args.limit));
    list_params.push(Box::new(args.offset));
    let param_refs: Vec<&dyn rusqlite::ToSql> = list_params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&list_sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(models::YamlReleaseListItem {
            release_id: row.get(0)?,
            name: row.get(1)?,
            project: row.get(2)?,
            status: row.get(3)?,
            file_path: row.get(4)?,
            updated_at: row.get(5)?,
            updated_by: row.get(6)?,
            ticket_count: row.get(7)?,
        })
    })?;
    let items: Vec<_> = rows.filter_map(|r| r.ok()).collect();
    Ok((items, total))
}

pub(crate) fn distinct_release_projects(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT project FROM ticket_releases WHERE repo_slug = ? AND project IS NOT NULL AND TRIM(project) != '' ORDER BY project",
    )?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub(crate) fn delete_release_db_row(conn: &Connection, slug: &str, file_path: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM ticket_releases WHERE repo_slug = ? AND file_path = ?",
        params![slug, file_path],
    )?;
    Ok(())
}

pub(crate) fn ensure_releases_dir(repo_path: &Path, project: &str) -> Result<PathBuf> {
    if !is_valid_project_name(project) || project == RELEASES_DIR_NAME {
        anyhow::bail!("Invalid project name for releases.");
    }
    let dir = repo_path
        .join(TICKETS_ROOT_REL)
        .join(project.trim())
        .join(RELEASES_DIR_NAME);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub(crate) fn write_release_yaml(path: &Path, detail: &models::YamlReleaseDetail) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let fm = release_detail_to_front_matter(detail);
    if !detail.raw.trim().is_empty() {
        crate::write_yaml_from_existing_raw(path, &detail.raw, &fm, &detail.body)?;
    } else {
        write_full_yaml(path, &fm, &detail.body)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tickets::{init_tickets_schema, upsert_ticket_db, UpsertTicketArgs};
    use std::collections::BTreeMap;

    fn open_mem() -> Connection {
        let conn = Connection::open_in_memory().expect("mem db");
        init_ticket_releases_schema(&conn).expect("releases schema");
        init_tickets_schema(&conn).expect("tickets schema");
        conn
    }

    #[test]
    fn parse_release_path_accepts_project_scoped_layout() {
        let (project, stem) =
            parse_release_path(".gitoza/tasks/tickets/demo/releases/1.1.0.yaml").unwrap();
        assert_eq!(project, "demo");
        assert_eq!(stem, "1.1.0");
        assert_eq!(compose_release_id(&project, &stem), "demo/1.1.0");
        assert!(is_valid_release_id("demo/1.1.0"));
        assert!(!is_valid_release_id("1.1.0"));
        assert!(!is_release_yaml_path(".gitoza/tasks/releases/rel-a.yaml"));
    }

    #[test]
    fn list_releases_includes_active_ticket_count() {
        let conn = open_mem();
        let slug = "demo";
        upsert_release_db(
            &conn,
            UpsertReleaseArgs {
                release_id: "App/rel-a".to_string(),
                name: Some("Release A".to_string()),
                project: Some("App".to_string()),
                status: Some("open".to_string()),
                file_path: ".gitoza/tasks/tickets/App/releases/rel-a.yaml".to_string(),
                repo_slug: slug.to_string(),
                updated_at: Some("2026-01-01T00:00:00Z".to_string()),
                updated_by: None,
            },
        )
        .expect("upsert release");

        upsert_ticket_db(
            &conn,
            UpsertTicketArgs {
                ticket_id: "T-1".to_string(),
                title: Some("One".to_string()),
                tags: vec![],
                ticket_type: Some("task".to_string()),
                status: Some("open".to_string()),
                priority: None,
                file_path: ".gitoza/tasks/tickets/App/T-1.yaml".to_string(),
                repo_slug: slug.to_string(),
                updated_at: None,
                updated_by: None,
                assigned_to: None,
                reporter: None,
                sprint: None,
                release: Some("App/rel-a".to_string()),
                parent: None,
                params: BTreeMap::new(),
            },
        )
        .expect("upsert ticket");

        upsert_ticket_db(
            &conn,
            UpsertTicketArgs {
                ticket_id: "T-2".to_string(),
                title: Some("Done".to_string()),
                tags: vec![],
                ticket_type: Some("task".to_string()),
                status: Some("done".to_string()),
                priority: None,
                file_path: ".gitoza/tasks/tickets/App/T-2.yaml".to_string(),
                repo_slug: slug.to_string(),
                updated_at: None,
                updated_by: None,
                assigned_to: None,
                reporter: None,
                sprint: None,
                release: Some("App/rel-a".to_string()),
                parent: None,
                params: BTreeMap::new(),
            },
        )
        .expect("upsert done ticket");

        let (items, total) = list_releases(
            &conn,
            slug,
            QueryReleasesArgs {
                limit: 50,
                offset: 0,
                ..Default::default()
            },
        )
        .expect("list");
        assert_eq!(total, 1);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].release_id, "App/rel-a");
        assert_eq!(items[0].project.as_deref(), Some("App"));
        // Both open and done tickets linked to the release count.
        assert_eq!(items[0].ticket_count, 2);
    }

    #[test]
    fn apply_release_audit_from_db_overlays_sqlite() {
        let conn = open_mem();
        let slug = "demo";
        let rel = ".gitoza/tasks/tickets/App/releases/rel-a.yaml";
        upsert_release_db(
            &conn,
            UpsertReleaseArgs {
                release_id: "App/rel-a".to_string(),
                name: Some("Release A".to_string()),
                project: Some("App".to_string()),
                status: Some("open".to_string()),
                file_path: rel.to_string(),
                repo_slug: slug.to_string(),
                updated_at: Some("2024-06-01T12:00:00Z".to_string()),
                updated_by: Some("DbUser".to_string()),
            },
        )
        .expect("upsert release");

        let mut detail = models::YamlReleaseDetail {
            release_id: "App/rel-a".to_string(),
            name: Some("Release A".to_string()),
            project: Some("App".to_string()),
            status: Some("open".to_string()),
            file_path: rel.to_string(),
            body: String::new(),
            raw: String::new(),
            updated_at: Some("1999-01-01T00:00:00Z".to_string()),
            updated_by: Some("YamlUser".to_string()),
        };
        apply_release_audit_from_db(&conn, slug, rel, &mut detail);
        assert_eq!(detail.updated_by.as_deref(), Some("DbUser"));
        assert_eq!(detail.updated_at.as_deref(), Some("2024-06-01T12:00:00Z"));

        // Local write stamp: upsert with now+user must be loadable (create/update path).
        upsert_release_db(
            &conn,
            UpsertReleaseArgs {
                release_id: "App/rel-a".to_string(),
                name: Some("Release A".to_string()),
                project: Some("App".to_string()),
                status: Some("open".to_string()),
                file_path: rel.to_string(),
                repo_slug: slug.to_string(),
                updated_at: Some("2025-01-01T00:00:00Z".to_string()),
                updated_by: Some("LocalEditor".to_string()),
            },
        )
        .expect("restamp");
        let (at, by) = load_release_audit(&conn, slug, rel);
        assert_eq!(by.as_deref(), Some("LocalEditor"));
        assert_eq!(at.as_deref(), Some("2025-01-01T00:00:00Z"));
    }
}
