//! File-is-truth tickets under `.gitoza/tasks/tickets/{project}/` (YAML + SQLite index).

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection};

use crate::{
    atomic_write_file, file_rel_from_repo, insert_comments_into_fm, is_valid_case_id,
    is_valid_project_name, json_path_for_param_key, merge_param_values_into_map, models,
    normalize_params_for_storage, normalize_tags_for_storage, params_to_yaml_value,
    parse_comments_from_yaml_value, write_full_yaml,
};
use indexmap::IndexMap;

pub(crate) const TICKETS_PREFIX: &str = ".gitoza/tasks/tickets/";
pub(crate) const TICKETS_ROOT_REL: &str = ".gitoza/tasks/tickets";
/// Reserved name; cannot be used as a ticket project folder.
pub(crate) const TICKETS_RESERVED_DIR: &str = ".archive";
/// Reserved subfolder under each ticket project for release YAML (not a project name).
pub(crate) const TICKETS_RELEASES_DIR: &str = "releases";
/// `list_tickets` release filter sentinel: tickets with null/empty release (backlog).
pub(crate) const TICKET_RELEASE_NONE: &str = "__none__";

fn is_forbidden_ticket_project_name(name: &str) -> bool {
    name == TICKETS_RESERVED_DIR || name == TICKETS_RELEASES_DIR
}
/// Destination project for legacy flat ticket YAML found at tickets root.
pub(crate) const TICKETS_LEGACY_PROJECT: &str = "default";

/// Relative paths of ticket YAML files under `.gitoza/tasks/tickets/{project}/`.
pub(crate) fn discover_ticket_yaml_rel_paths(repo_path: &Path) -> Vec<String> {
    let tickets_root = repo_path.join(TICKETS_ROOT_REL);
    if !tickets_root.is_dir() {
        return Vec::new();
    }

    let mut out: Vec<String> = Vec::new();
    let entries = match std::fs::read_dir(&tickets_root) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let project_dir = entry.path();
        if !project_dir.is_dir() {
            continue;
        }
        let project_name = entry.file_name().to_string_lossy().to_string();
        if is_forbidden_ticket_project_name(&project_name)
            || project_name == "."
            || project_name == ".."
        {
            continue;
        }
        let files = match std::fs::read_dir(&project_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for file_entry in files.flatten() {
            let p = file_entry.path();
            if !p.is_file() {
                continue;
            }
            let name = file_entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ext != "md" {
                continue;
            }
            out.push(file_rel_from_repo(repo_path, &p));
        }
    }
    out.sort();
    out
}

pub(crate) fn is_ticket_yaml_path(file_rel: &str) -> bool {
    let p = file_rel.trim().replace('\\', "/");
    if !p.starts_with(TICKETS_PREFIX) {
        return false;
    }
    let name = Path::new(&p)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if name.is_empty() || name.starts_with('.') {
        return false;
    }
    let ext = Path::new(&p)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    ext == "md"
}

/// One-level project paths: `.gitoza/tasks/tickets/{project}/{id}.md`.
pub(crate) fn validate_ticket_file_path_for_write(file_path: &str) -> Result<String, String> {
    let file_path = file_path.trim_start_matches('/').trim().replace('\\', "/");
    if file_path.is_empty() || file_path.contains("..") || file_path.starts_with('/') {
        return Err("Invalid file_path".to_string());
    }
    if !file_path.starts_with(TICKETS_PREFIX) || file_path == TICKETS_PREFIX.trim_end_matches('/') {
        return Err("Ticket must be under .gitoza/tasks/tickets/".to_string());
    }
    let rest = &file_path[TICKETS_PREFIX.len()..];
    if rest.is_empty() {
        return Err("Ticket path is incomplete".to_string());
    }
    let parts: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() != 2 {
        return Err("Ticket YAML must live under .gitoza/tasks/tickets/{project}/".to_string());
    }
    let project = parts[0];
    let file_name = parts[1];
    if is_forbidden_ticket_project_name(project) || project == "." || project == ".." {
        return Err("Invalid ticket project name".to_string());
    }
    if !is_valid_project_name(project) {
        return Err(
            "Invalid ticket project name. Use only letters, numbers, underscores, and hyphens."
                .to_string(),
        );
    }
    let lower = file_name.to_ascii_lowercase();
    if !(lower.ends_with(".md") || lower.ends_with(".md")) {
        return Err("Ticket file must be .md".to_string());
    }
    Ok(file_path)
}

/// Extract project segment from a validated ticket file path.
pub(crate) fn ticket_project_from_path(file_path: &str) -> Option<String> {
    let norm = file_path.trim().replace('\\', "/");
    let rest = norm.strip_prefix(TICKETS_PREFIX)?;
    let project = rest.split('/').next()?.trim();
    if project.is_empty() || is_forbidden_ticket_project_name(project) {
        return None;
    }
    Some(project.to_string())
}

pub(crate) fn init_tickets_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS tickets (
  ticket_id    TEXT    NOT NULL,
  title        TEXT,
  tags         TEXT,
  type         TEXT,
  status       TEXT,
  priority     TEXT,
  file_path    TEXT    NOT NULL,
  repo_slug    TEXT    NOT NULL,
  indexed_at   TEXT    NOT NULL,
  updated_at   TEXT,
  updated_by   TEXT,
  assigned_to  TEXT,
  reporter     TEXT,
  sprint       TEXT,
  release      TEXT,
  parent       TEXT,
  params       TEXT,
  PRIMARY KEY (repo_slug, file_path)
);
CREATE INDEX IF NOT EXISTS idx_tickets_repo ON tickets(repo_slug);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_id ON tickets(ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_file_path ON tickets(repo_slug, file_path);
CREATE TABLE IF NOT EXISTS ticket_projects (
  repo_slug TEXT NOT NULL,
  project_name TEXT NOT NULL,
  ticket_prefix TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_slug, project_name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_projects_prefix
  ON ticket_projects(repo_slug, ticket_prefix);
"#,
    )?;
    // Older DBs created ticket_projects without archived.
    let _ = conn.execute(
        "ALTER TABLE ticket_projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
        [],
    );
    Ok(())
}

pub(crate) use crate::paths::PROJECT_META_FILE;

const TICKET_ID_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

fn is_valid_ticket_prefix(prefix: &str) -> bool {
    let s = prefix.trim();
    !s.is_empty()
        && s.len() <= 12
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// Alphanumeric uppercase stem from a project folder name.
fn derive_prefix_stem(project_name: &str) -> String {
    let alnum: String = project_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if alnum.is_empty() {
        "TICK".to_string()
    } else {
        alnum
    }
}

pub(crate) fn derive_prefix_candidate(project_name: &str) -> String {
    let stem = derive_prefix_stem(project_name);
    if stem.len() >= 4 {
        stem.chars().take(4).collect()
    } else if stem.len() >= 2 {
        stem
    } else {
        let mut s = stem;
        while s.len() < 2 {
            s.push('X');
        }
        s
    }
}

fn prefix_taken(conn: &Connection, slug: &str, prefix: &str) -> Result<bool> {
    let mut stmt = conn.prepare(
        "SELECT 1 FROM ticket_projects WHERE repo_slug = ?1 AND ticket_prefix = ?2 LIMIT 1",
    )?;
    Ok(stmt.exists(params![slug, prefix])?)
}

fn random_alnum_suffix(len: usize) -> String {
    let mut out = String::with_capacity(len);
    while out.len() < len {
        let u = uuid::Uuid::new_v4();
        for b in u.as_bytes() {
            if out.len() >= len {
                break;
            }
            out.push(TICKET_ID_ALPHABET[(*b as usize) % TICKET_ID_ALPHABET.len()] as char);
        }
    }
    out
}

/// Allocate a repo-unique ticket prefix for `project_name` (does not write disk/DB).
pub(crate) fn allocate_ticket_prefix(
    conn: &Connection,
    slug: &str,
    project_name: &str,
) -> Result<String> {
    let stem = derive_prefix_stem(project_name);
    let primary = derive_prefix_candidate(project_name);
    let mut candidates: Vec<String> = vec![primary.clone()];
    for n in 2u8..=9 {
        candidates.push(format!("{primary}{n}"));
    }
    for take in 5..=stem.len().min(8) {
        candidates.push(stem.chars().take(take).collect());
    }
    for c in &candidates {
        if is_valid_ticket_prefix(c) && !prefix_taken(conn, slug, c)? {
            return Ok(c.clone());
        }
    }
    for _ in 0..32 {
        let c = random_alnum_suffix(4);
        if !prefix_taken(conn, slug, &c)? {
            return Ok(c);
        }
    }
    anyhow::bail!("Failed to allocate unique ticket prefix for project '{project_name}'")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TicketProjectMeta {
    pub ticket_prefix: String,
    pub archived: bool,
    pub description: String,
}

/// List filter for ticket project trees (active vs archived shelf).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TicketProjectListFilter {
    ActiveOnly,
    ArchivedOnly,
}

fn yaml_bool(val: &serde_yaml::Value, key: &str) -> bool {
    match val.get(key) {
        Some(serde_yaml::Value::Bool(b)) => *b,
        Some(serde_yaml::Value::String(s)) => {
            let t = s.trim().to_ascii_lowercase();
            t == "true" || t == "yes" || t == "1"
        }
        Some(serde_yaml::Value::Number(n)) => n.as_i64() == Some(1),
        _ => false,
    }
}

fn yaml_description(val: &serde_yaml::Value) -> String {
    match val.get("description") {
        Some(serde_yaml::Value::String(s)) => s.to_string(),
        Some(serde_yaml::Value::Null) | None => String::new(),
        Some(other) => other
            .as_i64()
            .map(|n| n.to_string())
            .or_else(|| other.as_f64().map(|n| n.to_string()))
            .or_else(|| other.as_bool().map(|b| b.to_string()))
            .unwrap_or_default(),
    }
}

pub(crate) fn ticket_project_display_name(folder_name: &str) -> String {
    folder_name.replace('_', " ").replace('-', " ")
}

pub(crate) fn read_project_meta(project_dir: &Path) -> Option<TicketProjectMeta> {
    let path = project_dir.join(PROJECT_META_FILE);
    let raw = std::fs::read_to_string(&path).ok()?;
    let stripped = raw.trim_start();
    if !stripped.starts_with("---") {
        return None;
    }
    let rest = &stripped[3..];
    let front_text = match rest.find("\n---") {
        Some(idx) => &rest[..idx],
        None => rest,
    };
    let val: serde_yaml::Value = serde_yaml::from_str(front_text).ok()?;
    let prefix = val
        .get("ticket_prefix")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_ascii_uppercase())
        .filter(|s| is_valid_ticket_prefix(s))?;
    Some(TicketProjectMeta {
        ticket_prefix: prefix,
        archived: yaml_bool(&val, "archived"),
        description: yaml_description(&val),
    })
}

pub(crate) fn write_project_meta(project_dir: &Path, meta: &TicketProjectMeta) -> Result<()> {
    std::fs::create_dir_all(project_dir)?;
    let path = project_dir.join(PROJECT_META_FILE);
    let mut map = serde_yaml::Mapping::new();
    map.insert(
        serde_yaml::Value::String("ticket_prefix".to_string()),
        serde_yaml::Value::String(meta.ticket_prefix.clone()),
    );
    if meta.archived {
        map.insert(
            serde_yaml::Value::String("archived".to_string()),
            serde_yaml::Value::Bool(true),
        );
    }
    if !meta.description.is_empty() {
        map.insert(
            serde_yaml::Value::String("description".to_string()),
            serde_yaml::Value::String(meta.description.clone()),
        );
    }
    let yaml = serde_yaml::to_string(&serde_yaml::Value::Mapping(map))
        .context("serialize ticket project meta")?;
    let header = yaml.trim_start_matches("---\n");
    let body = format!("---\n{header}---\n\n");
    atomic_write_file(&path, body.as_bytes())
        .with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

/// Write or update prefix while preserving existing `archived` and `description` on disk.
#[cfg(test)]
pub(crate) fn write_project_meta_prefix(project_dir: &Path, prefix: &str) -> Result<()> {
    let existing = read_project_meta(project_dir);
    write_project_meta(
        project_dir,
        &TicketProjectMeta {
            ticket_prefix: prefix.to_string(),
            archived: existing.as_ref().map(|m| m.archived).unwrap_or(false),
            description: existing
                .map(|m| m.description)
                .unwrap_or_default(),
        },
    )
}

fn bool_i32(v: bool) -> i32 {
    if v {
        1
    } else {
        0
    }
}

pub(crate) fn upsert_ticket_project_row(
    conn: &Connection,
    slug: &str,
    project_name: &str,
    ticket_prefix: &str,
    archived: bool,
) -> Result<()> {
    conn.execute(
        "INSERT INTO ticket_projects (repo_slug, project_name, ticket_prefix, archived)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(repo_slug, project_name) DO UPDATE SET
           ticket_prefix = excluded.ticket_prefix,
           archived = excluded.archived",
        params![slug, project_name, ticket_prefix, bool_i32(archived)],
    )?;
    Ok(())
}

fn project_archived_from_db(
    conn: &Connection,
    slug: &str,
    project_name: &str,
) -> Option<bool> {
    conn.query_row(
        "SELECT archived FROM ticket_projects WHERE repo_slug = ?1 AND project_name = ?2",
        params![slug, project_name],
        |r| r.get::<_, i32>(0),
    )
    .ok()
    .map(|v| v != 0)
}

/// Disk is truth; DB is a cache. Falls back to SQLite when `.project.md` is missing.
pub(crate) fn is_ticket_project_archived(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    project: &str,
) -> bool {
    let project_dir = repo_path.join(TICKETS_ROOT_REL).join(project.trim());
    if let Some(meta) = read_project_meta(&project_dir) {
        return meta.archived;
    }
    project_archived_from_db(conn, slug, project).unwrap_or(false)
}

/// Ensure project has a prefix on disk and in SQLite; returns the prefix.
pub(crate) fn ensure_project_prefix(
    repo_path: &Path,
    conn: &Connection,
    slug: &str,
    project: &str,
) -> Result<String> {
    let project_dir = ensure_ticket_project_dir(repo_path, project)?;
    if let Some(meta) = read_project_meta(&project_dir) {
        // If this prefix is owned by another project, allocate a fresh one.
        let conflict: Option<String> = conn
            .query_row(
                "SELECT project_name FROM ticket_projects
                 WHERE repo_slug = ?1 AND ticket_prefix = ?2 AND project_name != ?3
                 LIMIT 1",
                params![slug, &meta.ticket_prefix, project],
                |r| r.get(0),
            )
            .ok();
        if conflict.is_none() {
            upsert_ticket_project_row(
                conn,
                slug,
                project,
                &meta.ticket_prefix,
                meta.archived,
            )?;
            return Ok(meta.ticket_prefix);
        }
        let archived = meta.archived;
        let description = meta.description;
        let prefix = allocate_ticket_prefix(conn, slug, project)?;
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: prefix.clone(),
                archived,
                description,
            },
        )?;
        upsert_ticket_project_row(conn, slug, project, &prefix, archived)?;
        return Ok(prefix);
    }
    let prefix = allocate_ticket_prefix(conn, slug, project)?;
    write_project_meta(
        &project_dir,
        &TicketProjectMeta {
            ticket_prefix: prefix.clone(),
            archived: false,
            description: String::new(),
        },
    )?;
    upsert_ticket_project_row(conn, slug, project, &prefix, false)?;
    Ok(prefix)
}

/// Set or clear project-level archive in `.project.md` + SQLite (no ticket path moves).
pub(crate) fn set_ticket_project_archived(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    project: &str,
    archived: bool,
) -> Result<()> {
    if !is_valid_project_name(project) || is_forbidden_ticket_project_name(project) {
        anyhow::bail!("Invalid project name.");
    }
    let project_dir = repo_path.join(TICKETS_ROOT_REL).join(project.trim());
    if !project_dir.is_dir() {
        anyhow::bail!("Project '{project}' not found.");
    }
    let prefix = ensure_project_prefix(repo_path, conn, slug, project)?;
    let description = read_project_meta(&project_dir)
        .map(|m| m.description)
        .unwrap_or_default();
    write_project_meta(
        &project_dir,
        &TicketProjectMeta {
            ticket_prefix: prefix.clone(),
            archived,
            description,
        },
    )?;
    upsert_ticket_project_row(conn, slug, project, &prefix, archived)?;
    Ok(())
}

/// Load ticket project meta for overview / settings.
pub(crate) fn get_ticket_project(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    project: &str,
) -> Result<models::TicketProjectDetail> {
    let project_name = project.trim();
    if !is_valid_project_name(project_name) || is_forbidden_ticket_project_name(project_name) {
        anyhow::bail!("Invalid project name.");
    }
    let project_dir = repo_path.join(TICKETS_ROOT_REL).join(project_name);
    if !project_dir.is_dir() {
        anyhow::bail!("Project '{project_name}' not found.");
    }
    let prefix = ensure_project_prefix(repo_path, conn, slug, project_name)?;
    let meta = read_project_meta(&project_dir).unwrap_or(TicketProjectMeta {
        ticket_prefix: prefix.clone(),
        archived: false,
        description: String::new(),
    });
    Ok(models::TicketProjectDetail {
        project_name: project_name.to_string(),
        ticket_prefix: meta.ticket_prefix,
        archived: meta.archived,
        description: meta.description,
    })
}

/// Update editable ticket project fields (description). Rejects archived projects.
pub(crate) fn update_ticket_project(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    project: &str,
    description: &str,
) -> Result<models::TicketProjectDetail> {
    let project_name = project.trim();
    if !is_valid_project_name(project_name) || is_forbidden_ticket_project_name(project_name) {
        anyhow::bail!("Invalid project name.");
    }
    let project_dir = repo_path.join(TICKETS_ROOT_REL).join(project_name);
    if !project_dir.is_dir() {
        anyhow::bail!("Project '{project_name}' not found.");
    }
    let prefix = ensure_project_prefix(repo_path, conn, slug, project_name)?;
    let existing = read_project_meta(&project_dir).unwrap_or(TicketProjectMeta {
        ticket_prefix: prefix.clone(),
        archived: false,
        description: String::new(),
    });
    if existing.archived {
        anyhow::bail!("Cannot update an archived ticket project.");
    }
    let meta = TicketProjectMeta {
        ticket_prefix: existing.ticket_prefix,
        archived: false,
        description: description.to_string(),
    };
    write_project_meta(&project_dir, &meta)?;
    upsert_ticket_project_row(conn, slug, project_name, &meta.ticket_prefix, false)?;
    Ok(models::TicketProjectDetail {
        project_name: project_name.to_string(),
        ticket_prefix: meta.ticket_prefix,
        archived: meta.archived,
        description: meta.description,
    })
}

/// Aggregate ticket counts for a project overview (status, type, backlog).
pub(crate) fn get_ticket_project_breakdown(
    conn: &Connection,
    slug: &str,
    project: &str,
) -> Result<models::TicketProjectBreakdownResponse> {
    let project_name = project.trim();
    if project_name.is_empty() {
        anyhow::bail!("Project name is required.");
    }
    let like = format!("{TICKETS_PREFIX}{project_name}/%");
    let mut stmt = conn.prepare(
        "SELECT status, type, release FROM tickets
         WHERE repo_slug = ?1 AND file_path LIKE ?2",
    )?;
    let rows = stmt.query_map(params![slug, like], |r| {
        Ok((
            r.get::<_, Option<String>>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;

    let mut total: i64 = 0;
    let mut backlog_count: i64 = 0;
    let mut by_status: BTreeMap<String, i64> = BTreeMap::new();
    let mut by_type: BTreeMap<String, i64> = BTreeMap::new();

    for row in rows {
        let (status, ticket_type, release) = row?;
        total += 1;
        let status_key = status
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_else(|| "unset".to_string());
        *by_status.entry(status_key).or_default() += 1;

        let type_key = ticket_type
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_else(|| "unset".to_string());
        *by_type.entry(type_key).or_default() += 1;

        let release_empty = release
            .as_deref()
            .map(str::trim)
            .map(|s| s.is_empty())
            .unwrap_or(true);
        if release_empty {
            backlog_count += 1;
        }
    }

    Ok(models::TicketProjectBreakdownResponse {
        total,
        by_status,
        by_type,
        backlog_count,
    })
}

/// Aggregate ticket counts for a release overview (status + type).
pub(crate) fn get_release_ticket_breakdown(
    conn: &Connection,
    slug: &str,
    release_id: &str,
) -> Result<models::TicketProjectBreakdownResponse> {
    let release_id = release_id.trim();
    if release_id.is_empty() {
        anyhow::bail!("Release id is required.");
    }
    let mut stmt = conn.prepare(
        "SELECT status, type FROM tickets
         WHERE repo_slug = ?1 AND LOWER(TRIM(COALESCE(release, ''))) = LOWER(?2)",
    )?;
    let rows = stmt.query_map(params![slug, release_id], |r| {
        Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
    })?;

    let mut total: i64 = 0;
    let mut by_status: BTreeMap<String, i64> = BTreeMap::new();
    let mut by_type: BTreeMap<String, i64> = BTreeMap::new();

    for row in rows {
        let (status, ticket_type) = row?;
        total += 1;
        let status_key = status
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_else(|| "unset".to_string());
        *by_status.entry(status_key).or_default() += 1;

        let type_key = ticket_type
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_else(|| "unset".to_string());
        *by_type.entry(type_key).or_default() += 1;
    }

    Ok(models::TicketProjectBreakdownResponse {
        total,
        by_status,
        by_type,
        backlog_count: 0,
    })
}

/// Permanently delete an archived ticket project (disk + index). Rejects active projects.
pub(crate) fn delete_ticket_project(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    project: &str,
) -> Result<()> {
    if !is_valid_project_name(project) || is_forbidden_ticket_project_name(project) {
        anyhow::bail!("Invalid project name.");
    }
    let project = project.trim();
    if !is_ticket_project_archived(conn, repo_path, slug, project) {
        anyhow::bail!("Only archived ticket projects can be deleted permanently.");
    }
    let project_dir = repo_path.join(TICKETS_ROOT_REL).join(project);
    if project_dir.is_dir() {
        std::fs::remove_dir_all(&project_dir)
            .with_context(|| format!("Failed to delete {}", project_dir.display()))?;
    }
    let like = format!("{TICKETS_PREFIX}{project}/%");
    conn.execute(
        "DELETE FROM tickets WHERE repo_slug = ?1 AND file_path LIKE ?2",
        params![slug, like],
    )?;
    let _ = conn.execute(
        "DELETE FROM ticket_releases WHERE repo_slug = ?1 AND (project = ?2 OR file_path LIKE ?3)",
        params![slug, project, like],
    );
    conn.execute(
        "DELETE FROM ticket_projects WHERE repo_slug = ?1 AND project_name = ?2",
        params![slug, project],
    )?;
    Ok(())
}

/// Generate `{PREFIX}-{6 random}` not used on disk or in the tickets index.
pub(crate) fn generate_unique_ticket_id(
    conn: &Connection,
    slug: &str,
    project_dir: &Path,
    prefix: &str,
) -> Result<String> {
    for _ in 0..64 {
        let id = format!("{prefix}-{}", random_alnum_suffix(6));
        if !is_valid_ticket_id(&id) {
            continue;
        }
        let path = project_dir.join(format!("{id}.md"));
        if path.exists() {
            continue;
        }
        let taken = conn
            .query_row(
                "SELECT 1 FROM tickets WHERE repo_slug = ?1 AND ticket_id = ?2 LIMIT 1",
                params![slug, id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !taken {
            return Ok(id);
        }
    }
    anyhow::bail!("Failed to allocate unique ticket id for prefix '{prefix}'")
}

fn yaml_str(map: &BTreeMap<String, serde_yaml::Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn parse_tags(map: &BTreeMap<String, serde_yaml::Value>) -> Vec<String> {
    match map.get("tags") {
        Some(serde_yaml::Value::Sequence(seq)) => seq
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect(),
        Some(serde_yaml::Value::String(s)) => s
            .split(',')
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect(),
        _ => vec![],
    }
}

fn parse_ticket_from_front_matter(
    lower: BTreeMap<String, serde_yaml::Value>,
    body: String,
    raw: String,
    default_ticket_id: &str,
    file_path: &str,
) -> models::YamlTicketDetail {
    let ticket_id = yaml_str(&lower, "ticket_id").unwrap_or_else(|| default_ticket_id.to_string());
    let status = yaml_str(&lower, "status")
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "open".to_string());
    let ticket_type = yaml_str(&lower, "type")
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| "task".to_string());
    let params = lower
        .get("params")
        .map(crate::parse_params_from_yaml_value)
        .map(normalize_params_for_storage)
        .unwrap_or_default();

    models::YamlTicketDetail {
        ticket_id,
        title: yaml_str(&lower, "title"),
        tags: parse_tags(&lower),
        ticket_type: Some(ticket_type),
        status: Some(status),
        priority: yaml_str(&lower, "priority").map(|s| s.to_lowercase()),
        file_path: file_path.to_string(),
        body,
        raw,
        updated_at: yaml_str(&lower, "updated_at"),
        updated_by: yaml_str(&lower, "updated_by"),
        assigned_to: yaml_str(&lower, "assigned_to"),
        reporter: yaml_str(&lower, "reporter"),
        sprint: yaml_str(&lower, "sprint"),
        release: yaml_str(&lower, "release"),
        parent: yaml_str(&lower, "parent"),
        comments: parse_comments_from_yaml_value(
            lower
                .get("comments")
                .unwrap_or(&serde_yaml::Value::Sequence(vec![])),
        ),
        params,
    }
}

pub(crate) fn read_ticket_yaml(path: &Path) -> Result<Option<models::YamlTicketDetail>> {
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
    Ok(Some(parse_ticket_from_front_matter(
        lower,
        body,
        raw,
        &default_id,
        "",
    )))
}

pub(crate) fn ticket_detail_to_front_matter(
    d: &models::YamlTicketDetail,
) -> IndexMap<String, serde_yaml::Value> {
    let mut fm = IndexMap::new();
    if let Some(title) = &d.title {
        if !title.trim().is_empty() {
            fm.insert(
                "title".to_string(),
                serde_yaml::Value::String(title.clone()),
            );
        }
    }
    if !d.tags.is_empty() {
        fm.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(
                d.tags
                    .iter()
                    .map(|t| serde_yaml::Value::String(t.clone()))
                    .collect(),
            ),
        );
    }
    if let Some(t) = &d.ticket_type {
        if !t.trim().is_empty() {
            fm.insert(
                "type".to_string(),
                serde_yaml::Value::String(t.to_lowercase()),
            );
        }
    }
    if let Some(status) = &d.status {
        if !status.trim().is_empty() {
            fm.insert(
                "status".to_string(),
                serde_yaml::Value::String(status.to_lowercase()),
            );
        }
    }
    if let Some(priority) = &d.priority {
        if !priority.trim().is_empty() {
            fm.insert(
                "priority".to_string(),
                serde_yaml::Value::String(priority.to_lowercase()),
            );
        }
    }
    if let Some(v) = &d.assigned_to {
        if !v.trim().is_empty() {
            fm.insert(
                "assigned_to".to_string(),
                serde_yaml::Value::String(v.clone()),
            );
        }
    }
    if let Some(v) = &d.reporter {
        if !v.trim().is_empty() {
            fm.insert("reporter".to_string(), serde_yaml::Value::String(v.clone()));
        }
    }
    if let Some(v) = &d.sprint {
        if !v.trim().is_empty() {
            fm.insert("sprint".to_string(), serde_yaml::Value::String(v.clone()));
        }
    }
    if let Some(v) = &d.release {
        if !v.trim().is_empty() {
            fm.insert("release".to_string(), serde_yaml::Value::String(v.clone()));
        }
    }
    if let Some(v) = &d.parent {
        if !v.trim().is_empty() {
            fm.insert("parent".to_string(), serde_yaml::Value::String(v.clone()));
        }
    }
    if !d.params.is_empty() {
        fm.insert("params".to_string(), params_to_yaml_value(&d.params));
    }
    insert_comments_into_fm(&mut fm, &d.comments);
    fm
}

#[derive(Debug)]
pub(crate) struct UpsertTicketArgs {
    pub(crate) ticket_id: String,
    pub(crate) title: Option<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) ticket_type: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) priority: Option<String>,
    pub(crate) file_path: String,
    pub(crate) repo_slug: String,
    pub(crate) updated_at: Option<String>,
    pub(crate) updated_by: Option<String>,
    pub(crate) assigned_to: Option<String>,
    pub(crate) reporter: Option<String>,
    pub(crate) sprint: Option<String>,
    pub(crate) release: Option<String>,
    pub(crate) parent: Option<String>,
    pub(crate) params: BTreeMap<String, String>,
}

/// Load SQLite-owned ticket audit fields for detail API overlays.
pub(crate) fn load_ticket_audit(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
) -> (Option<String>, Option<String>) {
    let key = crate::normalize_repo_rel_path(file_path);
    if key.is_empty() {
        return (None, None);
    }
    conn.query_row(
        r#"SELECT updated_at, updated_by FROM tickets
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

/// Overlay SQLite ticket audit onto a YAML-parsed detail.
pub(crate) fn apply_ticket_audit_from_db(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
    detail: &mut models::YamlTicketDetail,
) {
    let (at, by) = load_ticket_audit(conn, repo_slug, file_path);
    detail.updated_at = at;
    detail.updated_by = by;
}

pub(crate) fn upsert_ticket_db(conn: &Connection, a: UpsertTicketArgs) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let tags_json = serde_json::to_string(&a.tags).unwrap_or_else(|_| "[]".to_string());
    let params_json = serde_json::to_string(&a.params).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        r#"
INSERT INTO tickets
  (ticket_id, title, tags, type, status, priority, file_path, repo_slug, indexed_at,
   updated_at, updated_by, assigned_to, reporter, sprint, release, parent, params)
VALUES
  (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
ON CONFLICT(repo_slug, file_path) DO UPDATE SET
  ticket_id = excluded.ticket_id,
  title = excluded.title,
  tags = excluded.tags,
  type = excluded.type,
  status = excluded.status,
  priority = excluded.priority,
  indexed_at = excluded.indexed_at,
  updated_at = COALESCE(excluded.updated_at, tickets.updated_at),
  updated_by = COALESCE(excluded.updated_by, tickets.updated_by),
  assigned_to = excluded.assigned_to,
  reporter = excluded.reporter,
  sprint = excluded.sprint,
  release = excluded.release,
  parent = excluded.parent,
  params = excluded.params
"#,
        params![
            a.ticket_id,
            a.title,
            tags_json,
            a.ticket_type,
            a.status,
            a.priority,
            a.file_path,
            a.repo_slug,
            now,
            a.updated_at,
            a.updated_by,
            a.assigned_to,
            a.reporter,
            a.sprint,
            a.release,
            a.parent,
            params_json,
        ],
    )?;
    Ok(())
}

fn detail_to_upsert(
    d: &models::YamlTicketDetail,
    file_rel: &str,
    repo_slug: &str,
    audit: &crate::AuditStampSource,
) -> UpsertTicketArgs {
    let (updated_at, updated_by) = audit.resolve(file_rel);
    UpsertTicketArgs {
        ticket_id: d.ticket_id.clone(),
        title: d.title.clone(),
        tags: normalize_tags_for_storage(d.tags.clone()),
        ticket_type: d.ticket_type.clone(),
        status: d.status.clone(),
        priority: d.priority.clone(),
        file_path: file_rel.to_string(),
        repo_slug: repo_slug.to_string(),
        updated_at,
        updated_by,
        assigned_to: d.assigned_to.clone(),
        reporter: d.reporter.clone(),
        sprint: d.sprint.clone(),
        release: d.release.clone(),
        parent: d.parent.clone(),
        params: normalize_params_for_storage(d.params.clone()),
    }
}

/// Move legacy flat `*.md` at tickets root into `{default}/`.
fn migrate_flat_ticket_yamls(dir: &Path, into_project: &str) {
    let project_dir = dir.join(into_project);
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "md" {
            continue;
        }
        let Some(name) = p.file_name() else {
            continue;
        };
        if let Err(_) = std::fs::create_dir_all(&project_dir) {
            continue;
        }
        let dest = project_dir.join(name);
        if dest.exists() {
            continue;
        }
        let _ = std::fs::rename(&p, &dest);
    }
}

fn index_ticket_yaml_file(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
    abs: &Path,
    audit: &crate::AuditStampSource,
) -> Result<bool> {
    let file_rel = file_rel_from_repo(repo_path, abs);
    if validate_ticket_file_path_for_write(&file_rel).is_err() {
        return Ok(false);
    }
    let d = match read_ticket_yaml(abs)? {
        Some(x) => x,
        None => return Ok(false),
    };
    upsert_ticket_db(conn, detail_to_upsert(&d, &file_rel, repo_slug, audit))?;
    Ok(true)
}

/// Index ticket YAMLs under `{project}/`. Migrates any legacy flat root YAML into `default/` first.
pub(crate) fn index_tickets_from_yaml(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
) -> Result<i64> {
    let audit = crate::AuditStampSource::for_tickets_full(repo_path);
    index_tickets_from_yaml_with_audit(conn, repo_path, repo_slug, &audit)
}

pub(crate) fn index_tickets_from_yaml_with_audit(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
    audit: &crate::AuditStampSource,
) -> Result<i64> {
    let tickets_root = repo_path.join(TICKETS_ROOT_REL);
    if !tickets_root.is_dir() {
        return Ok(0);
    }

    migrate_flat_ticket_yamls(&tickets_root, TICKETS_LEGACY_PROJECT);

    let mut total: i64 = 0;
    let entries = match std::fs::read_dir(&tickets_root) {
        Ok(e) => e,
        Err(_) => return Ok(0),
    };
    for entry in entries.flatten() {
        let project_dir = entry.path();
        if !project_dir.is_dir() {
            continue;
        }
        let project_name = entry.file_name().to_string_lossy().to_string();
        if is_forbidden_ticket_project_name(&project_name)
            || project_name == "."
            || project_name == ".."
            || !is_valid_project_name(&project_name)
        {
            continue;
        }
        let files = match std::fs::read_dir(&project_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for file_entry in files.flatten() {
            let p = file_entry.path();
            if !p.is_file() {
                continue;
            }
            let file_name = file_entry.file_name().to_string_lossy().to_string();
            if file_name.starts_with('.') {
                continue;
            }
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ext != "md" {
                continue;
            }
            if index_ticket_yaml_file(conn, repo_path, repo_slug, &p, audit)? {
                total += 1;
            }
        }
        if let Err(e) = ensure_project_prefix(repo_path, conn, repo_slug, &project_name) {
            tracing::warn!("Failed to ensure ticket prefix for project '{project_name}': {e:#}");
        }
    }
    Ok(total)
}

pub(crate) fn reindex_tickets_for_repo(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
) -> Result<i64> {
    conn.execute("DELETE FROM tickets WHERE repo_slug = ?", [slug])?;
    conn.execute("DELETE FROM ticket_projects WHERE repo_slug = ?", [slug])?;
    index_tickets_from_yaml(conn, repo_path, slug)
}

pub(crate) fn apply_incremental_ticket_changes(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    changed: &[String],
    audit: &crate::AuditStampSource,
) -> Result<()> {
    for rel in changed {
        if !is_ticket_yaml_path(rel) {
            continue;
        }
        let abs = repo_path.join(rel);
        if abs.is_file() {
            let d = match read_ticket_yaml(&abs)? {
                Some(v) => v,
                None => continue,
            };
            if validate_ticket_file_path_for_write(rel).is_err() {
                continue;
            }
            upsert_ticket_db(conn, detail_to_upsert(&d, rel, slug, audit))?;
            // Keep ticket_projects in sync for newly pulled project folders.
            if let Some(project) = ticket_project_from_path(rel) {
                if let Err(e) = ensure_project_prefix(repo_path, conn, slug, &project) {
                    tracing::warn!(
                        "Failed to ensure ticket prefix for project '{project}' after incremental index: {e:#}"
                    );
                }
            }
        } else {
            conn.execute(
                "DELETE FROM tickets WHERE repo_slug = ? AND file_path = ?",
                params![slug, rel],
            )?;
        }
    }
    Ok(())
}

pub(crate) fn filter_ticket_yaml_paths(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| is_ticket_yaml_path(p))
        .cloned()
        .collect()
}

#[derive(Debug)]
pub(crate) struct QueryTicketsArgs {
    pub(crate) search: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) priority: Option<String>,
    pub(crate) ticket_type: Option<String>,
    pub(crate) tag: Option<String>,
    pub(crate) assigned_to: Option<String>,
    pub(crate) sprint: Option<String>,
    pub(crate) release: Option<String>,
    /// Exact match on tickets.parent (children of this ticket id).
    pub(crate) parent: Option<String>,
    /// Exact match on tickets.ticket_id (resolve one id).
    pub(crate) ticket_id: Option<String>,
    /// When set, restrict to tickets under this project folder.
    pub(crate) project: Option<String>,
    /// AND of custom-field key/value pairs (flat `params` JSON).
    pub(crate) param_filters: Option<Vec<(String, String)>>,
    pub(crate) sort_by: String,
    pub(crate) sort_dir: String,
    pub(crate) limit: i64,
    pub(crate) offset: i64,
}

fn build_query_tickets_conditions(
    repo_slug: &str,
    args: &QueryTicketsArgs,
) -> (String, Vec<rusqlite::types::Value>) {
    let mut conditions: Vec<String> = vec!["repo_slug = ?".to_string()];
    let mut params_vec: Vec<rusqlite::types::Value> = vec![repo_slug.to_string().into()];

    if let Some(project) = args
        .project
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        conditions.push("file_path LIKE ?".to_string());
        params_vec.push(format!("{TICKETS_PREFIX}{project}/%").into());
    }

    if let Some(s) = args.search.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push(
            "(ticket_id LIKE ? OR title LIKE ? OR tags LIKE ? OR sprint LIKE ? OR release LIKE ?)"
                .to_string(),
        );
        let like = format!("%{}%", s.trim());
        for _ in 0..5 {
            params_vec.push(like.clone().into());
        }
    }
    if let Some(s) = args.status.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(TRIM(status)) = LOWER(?)".to_string());
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(s) = args.priority.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(TRIM(priority)) = LOWER(?)".to_string());
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(s) = args.ticket_type.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(TRIM(type)) = LOWER(?)".to_string());
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(s) = args.tag.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(tags) LIKE ?".to_string());
        params_vec.push(format!("%\"{}\"%", s.trim().to_lowercase()).into());
    }
    if let Some(s) = args.assigned_to.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(TRIM(assigned_to)) = LOWER(?)".to_string());
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(s) = args.sprint.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(TRIM(sprint)) = LOWER(?)".to_string());
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(s) = args.release.as_ref().filter(|s| !s.trim().is_empty()) {
        let release = s.trim();
        if release.eq_ignore_ascii_case(TICKET_RELEASE_NONE) {
            conditions.push("(release IS NULL OR TRIM(release) = '')".to_string());
        } else {
            conditions.push("LOWER(TRIM(release)) = LOWER(?)".to_string());
            params_vec.push(release.to_string().into());
        }
    }
    if let Some(s) = args.parent.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("TRIM(parent) = ?".to_string());
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(s) = args.ticket_id.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("TRIM(ticket_id) = ?".to_string());
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(filters) = args.param_filters.as_ref() {
        for (key, value) in filters {
            let key = key.trim();
            let value = value.trim();
            if key.is_empty() || value.is_empty() {
                continue;
            }
            conditions.push(
                "params IS NOT NULL AND params != '' AND params != '{}' AND LOWER(json_extract(params, ?)) = LOWER(?)".to_string(),
            );
            params_vec.push(json_path_for_param_key(key).into());
            params_vec.push(value.to_string().into());
        }
    }

    // Exact ticket_id lookups still resolve for deep links into archived projects.
    let exact_ticket_id = args
        .ticket_id
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .is_some();
    if !exact_ticket_id {
        conditions.push(
            "NOT EXISTS (\
               SELECT 1 FROM ticket_projects tp \
               WHERE tp.repo_slug = tickets.repo_slug \
                 AND tp.archived != 0 \
                 AND tickets.file_path LIKE ('.gitoza/tasks/tickets/' || tp.project_name || '/%')\
             )"
            .to_string(),
        );
    }

    (conditions.join(" AND "), params_vec)
}

fn map_ticket_list_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<models::YamlTicketListItem> {
    let tags_raw: Option<String> = row.get("tags")?;
    let tags: Vec<String> = tags_raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default();
    Ok(models::YamlTicketListItem {
        ticket_id: row.get("ticket_id")?,
        title: row.get("title")?,
        tags,
        ticket_type: row.get("type")?,
        status: row.get("status")?,
        priority: row.get("priority")?,
        file_path: row.get("file_path")?,
        repo_slug: row.get("repo_slug")?,
        indexed_at: row.get("indexed_at")?,
        updated_at: row.get("updated_at")?,
        updated_by: row.get("updated_by")?,
        assigned_to: row.get("assigned_to")?,
        reporter: row.get("reporter")?,
        sprint: row.get("sprint")?,
        release: row.get("release")?,
        parent: row.get("parent")?,
    })
}

pub(crate) fn query_tickets_db(
    conn: &Connection,
    repo_slug: &str,
    args: QueryTicketsArgs,
) -> Result<(Vec<models::YamlTicketListItem>, i64)> {
    let allowed_sort = HashSet::from([
        "ticket_id".to_string(),
        "title".to_string(),
        "status".to_string(),
        "priority".to_string(),
        "type".to_string(),
        "updated_at".to_string(),
        "indexed_at".to_string(),
        "sprint".to_string(),
    ]);
    let sort_by = if allowed_sort.contains(&args.sort_by) {
        args.sort_by.clone()
    } else {
        "ticket_id".to_string()
    };
    let direction = if args.sort_dir.eq_ignore_ascii_case("desc") {
        "DESC"
    } else {
        "ASC"
    };

    let (where_sql, mut filter_params) = build_query_tickets_conditions(repo_slug, &args);

    let count_sql = format!("SELECT COUNT(*) FROM tickets WHERE {where_sql}");
    let total: i64 = conn
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(filter_params.iter()),
            |row| row.get(0),
        )
        .unwrap_or(0);

    let sql = format!(
        r#"
SELECT ticket_id, title, tags, type, status, priority,
       file_path, repo_slug, indexed_at, updated_at, updated_by,
       assigned_to, reporter, sprint, release, parent
FROM tickets
WHERE {where_sql}
ORDER BY {sort_by} {direction}
LIMIT ? OFFSET ?
"#
    );
    filter_params.push(args.limit.into());
    filter_params.push(args.offset.into());

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(filter_params.iter()),
        map_ticket_list_row,
    )?;
    let items: Vec<models::YamlTicketListItem> = rows.filter_map(|r| r.ok()).collect();
    Ok((items, total))
}

pub(crate) fn distinct_ticket_values(
    conn: &Connection,
    repo_slug: &str,
    column: &str,
) -> Result<Vec<String>> {
    let allowed = [
        "status",
        "priority",
        "type",
        "assigned_to",
        "sprint",
        "release",
    ];
    if !allowed.contains(&column) {
        return Ok(vec![]);
    }
    let sql = format!(
        "SELECT DISTINCT {column} FROM tickets WHERE repo_slug = ? AND {column} IS NOT NULL AND TRIM({column}) != '' ORDER BY {column}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub(crate) fn all_ticket_tags(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT tags FROM tickets WHERE repo_slug = ?")?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, Option<String>>(0))?;
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for row in rows.flatten().flatten() {
        if let Ok(tags) = serde_json::from_str::<Vec<String>>(&row) {
            for t in tags {
                let key = t.to_lowercase();
                if seen.insert(key) {
                    out.push(t);
                }
            }
        }
    }
    out.sort_by_key(|s| s.to_lowercase());
    Ok(out)
}

pub(crate) fn all_ticket_param_keys(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT params FROM tickets WHERE repo_slug = ?1 AND params IS NOT NULL AND params != '' AND params != '{}'",
    )?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    for r in rows.flatten() {
        if let Ok(v) = serde_json::from_str::<BTreeMap<String, String>>(&r) {
            for k in v.keys() {
                let norm = k.trim();
                if norm.is_empty() {
                    continue;
                }
                let lookup = norm.to_lowercase();
                if !seen.contains_key(&lookup) {
                    seen.insert(lookup, norm.to_string());
                }
            }
        }
    }
    let mut out: Vec<String> = seen.into_values().collect();
    out.sort();
    Ok(out)
}

pub(crate) fn all_ticket_param_values_by_key(
    conn: &Connection,
    repo_slug: &str,
) -> Result<BTreeMap<String, Vec<String>>> {
    let mut stmt = conn.prepare(
        "SELECT params FROM tickets WHERE repo_slug = ?1 AND params IS NOT NULL AND params != '' AND params != '{}'",
    )?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    let mut by_key: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    for r in rows.flatten() {
        if let Ok(v) = serde_json::from_str::<BTreeMap<String, String>>(&r) {
            merge_param_values_into_map(&mut by_key, &v);
        }
    }
    let mut out = BTreeMap::new();
    for (k, vals) in by_key {
        let mut list: Vec<String> = vals.into_values().collect();
        list.sort();
        out.insert(k, list);
    }
    Ok(out)
}

pub(crate) fn remap_ticket_file_path(
    conn: &Connection,
    slug: &str,
    old_path: &str,
    new_path: &str,
    new_ticket_id: &str,
) -> Result<usize> {
    let n = conn.execute(
        "UPDATE tickets SET file_path = ?1, ticket_id = ?2 WHERE repo_slug = ?3 AND file_path = ?4",
        params![new_path, new_ticket_id, slug, old_path],
    )?;
    Ok(n)
}

pub(crate) fn ensure_ticket_project_dir(repo_path: &Path, project: &str) -> Result<PathBuf> {
    if !is_valid_project_name(project) {
        anyhow::bail!("Invalid project name. Use only letters, numbers, underscores, and hyphens.");
    }
    if is_forbidden_ticket_project_name(project) {
        anyhow::bail!("Invalid project name.");
    }
    let dir = repo_path.join(TICKETS_ROOT_REL).join(project.trim());
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Project nodes for the Tasks tree (disk dirs + SQLite counts).
pub(crate) fn list_ticket_projects(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
    filter: TicketProjectListFilter,
) -> Result<Vec<models::RepositoryTreeNode>> {
    let root = repo_path.join(TICKETS_ROOT_REL);
    let path_prefix = TICKETS_PREFIX;

    let mut counts: HashMap<String, i64> = HashMap::new();
    {
        let like = format!("{path_prefix}%");
        let mut stmt = conn
            .prepare("SELECT file_path FROM tickets WHERE repo_slug = ?1 AND file_path LIKE ?2")?;
        let rows = stmt.query_map(params![repo_slug, like], |r| r.get::<_, String>(0))?;
        for path in rows.flatten() {
            if let Some(project) = ticket_project_from_path(&path) {
                *counts.entry(project).or_insert(0) += 1;
            }
        }
    }

    let mut names: HashSet<String> = counts.keys().cloned().collect();
    if root.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if is_forbidden_ticket_project_name(&name)
                    || name == "."
                    || name == ".."
                    || !is_valid_project_name(&name)
                {
                    continue;
                }
                names.insert(name);
            }
        }
    }

    let mut projects: Vec<String> = names.into_iter().collect();
    projects.sort_by_key(|s| s.to_lowercase());

    let mut nodes = Vec::with_capacity(projects.len());
    for name in projects {
        let archived = is_ticket_project_archived(conn, repo_path, repo_slug, &name);
        match filter {
            TicketProjectListFilter::ActiveOnly if archived => continue,
            TicketProjectListFilter::ArchivedOnly if !archived => continue,
            _ => {}
        }
        let directory_path = format!("{path_prefix}{name}");
        let case_count = *counts.get(&name).unwrap_or(&0);
        nodes.push(models::RepositoryTreeNode {
            type_: "folder".to_string(),
            name: name.clone(),
            display_name: ticket_project_display_name(&name),
            children: Some(vec![]),
            directory_path: Some(directory_path),
            path_from_root: Some(vec![name]),
            is_project: true,
            case_count,
        });
    }
    Ok(nodes)
}

/// Reuse case-id rules for ticket ids (letters, numbers, `_`, `-`).
pub(crate) fn is_valid_ticket_id(ticket_id: &str) -> bool {
    is_valid_case_id(ticket_id)
}

/// Write empty body placeholder when creating tickets.
#[allow(dead_code)]
pub(crate) fn write_ticket_yaml_file(
    path: &Path,
    fm: &IndexMap<String, serde_yaml::Value>,
    body: &str,
) -> Result<()> {
    write_full_yaml(path, fm, body)
}

#[allow(dead_code)]
pub(crate) fn atomic_write_bytes(path: &Path, data: &[u8]) -> std::io::Result<()> {
    atomic_write_file(path, data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        p.push(format!("gitoza_ticket_test_{prefix}_{t}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn incremental_ticket_changes_ensure_project_prefix() {
        let repo = temp_dir("incr_prefix");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        let ticket_rel = ".gitoza/tasks/tickets/demo/DEMO-1.md";
        let ticket_abs = repo.join(ticket_rel);
        fs::write(
            &ticket_abs,
            "---\nticket_id: DEMO-1\ntitle: Demo\nstatus: open\ntype: task\n---\nBody\n",
        )
        .unwrap();
        // Remote already has a stable prefix file (as create_ticket_project would push).
        fs::write(
            project_dir.join(".project.md"),
            "---\nticket_prefix: DEMO\n---\n\n",
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();

        apply_incremental_ticket_changes(
            &conn,
            &repo,
            "repo",
            &[ticket_rel.to_string()],
            &crate::AuditStampSource::CommitMeta(std::collections::HashMap::new()),
        )
        .unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tickets WHERE repo_slug = ? AND ticket_id = ?",
                params!["repo", "DEMO-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        let prefix: String = conn
            .query_row(
                "SELECT ticket_prefix FROM ticket_projects
                 WHERE repo_slug = ? AND project_name = ?",
                params!["repo", "demo"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(prefix, "DEMO");
    }

    #[test]
    fn is_ticket_yaml_path_accepts_project_folder() {
        assert!(is_ticket_yaml_path(
            ".gitoza/tasks/tickets/demo/DEMO-1.md"
        ));
        assert!(!is_ticket_yaml_path(
            ".gitoza/tasks/tickets/demo/.project.md"
        ));
        assert!(!is_ticket_yaml_path(".gitoza/test/cases/a.md"));
    }

    #[test]
    fn apply_ticket_audit_from_db_overlays_sqlite() {
        let repo = temp_dir("ticket_audit_overlay");
        let rel = ".gitoza/tasks/tickets/demo/DEMO-1.md";
        let abs = repo.join(rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        fs::write(
            &abs,
            "---\nticket_id: DEMO-1\ntitle: Demo\nstatus: open\ntype: task\nupdated_by: YamlUser\n---\nBody\n",
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        upsert_ticket_db(
            &conn,
            UpsertTicketArgs {
                ticket_id: "DEMO-1".to_string(),
                title: Some("Demo".to_string()),
                tags: vec![],
                ticket_type: Some("task".to_string()),
                status: Some("open".to_string()),
                priority: None,
                file_path: rel.to_string(),
                repo_slug: slug.to_string(),
                updated_at: Some("2024-06-01T12:00:00Z".to_string()),
                updated_by: Some("DbUser".to_string()),
                assigned_to: None,
                reporter: None,
                sprint: None,
                release: None,
                parent: None,
                params: BTreeMap::new(),
            },
        )
        .unwrap();

        let mut detail = read_ticket_yaml(&abs).unwrap().expect("parsed");
        assert_eq!(detail.updated_by.as_deref(), Some("YamlUser"));
        apply_ticket_audit_from_db(&conn, slug, rel, &mut detail);
        assert_eq!(detail.updated_by.as_deref(), Some("DbUser"));
        assert_eq!(detail.updated_at.as_deref(), Some("2024-06-01T12:00:00Z"));
    }

    #[test]
    fn ticket_detail_to_front_matter_omits_ticket_id() {
        let detail = models::YamlTicketDetail {
            ticket_id: "DEMO-1".to_string(),
            title: Some("Demo".to_string()),
            tags: vec![],
            ticket_type: Some("task".to_string()),
            status: Some("open".to_string()),
            priority: Some("medium".to_string()),
            file_path: ".gitoza/tasks/tickets/demo/DEMO-1.md".to_string(),
            body: "Body".to_string(),
            raw: String::new(),
            updated_at: None,
            updated_by: None,
            assigned_to: None,
            reporter: Some("Alice".to_string()),
            sprint: None,
            release: None,
            parent: None,
            comments: vec![],
            params: BTreeMap::new(),
        };
        let fm = ticket_detail_to_front_matter(&detail);
        assert!(!fm.contains_key("ticket_id"));
        assert_eq!(
            fm.get("title"),
            Some(&serde_yaml::Value::String("Demo".to_string()))
        );
    }

    #[test]
    fn project_meta_round_trip_preserves_archived_and_description() {
        let repo = temp_dir("meta_archived");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: "DEMO".to_string(),
                archived: true,
                description: "Hello\nworld".to_string(),
            },
        )
        .unwrap();
        let meta = read_project_meta(&project_dir).expect("meta");
        assert_eq!(meta.ticket_prefix, "DEMO");
        assert!(meta.archived);
        assert_eq!(meta.description, "Hello\nworld");

        write_project_meta_prefix(&project_dir, "DEMO").unwrap();
        let meta2 = read_project_meta(&project_dir).expect("meta after prefix write");
        assert_eq!(meta2.ticket_prefix, "DEMO");
        assert!(meta2.archived, "prefix write must not clear archived");
        assert_eq!(meta2.description, "Hello\nworld");
    }

    #[test]
    fn ticket_project_display_name_replaces_underscores() {
        assert_eq!(ticket_project_display_name("project_name"), "project name");
        assert_eq!(ticket_project_display_name("my-project"), "my project");
    }

    #[test]
    fn archive_preserves_description() {
        let repo = temp_dir("archive_desc");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: "DEMO".to_string(),
                archived: false,
                description: "Keep me".to_string(),
            },
        )
        .unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        ensure_project_prefix(&repo, &conn, slug, "demo").unwrap();
        set_ticket_project_archived(&conn, &repo, slug, "demo", true).unwrap();
        let meta = read_project_meta(&project_dir).expect("meta");
        assert!(meta.archived);
        assert_eq!(meta.description, "Keep me");
    }

    #[test]
    fn get_ticket_project_breakdown_counts_status_type_backlog() {
        let repo = temp_dir("breakdown");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            repo.join(".gitoza/tasks/tickets/demo/DEMO-1.md"),
            "---\ntitle: Open task\nstatus: open\ntype: task\n---\nBody\n",
        )
        .unwrap();
        fs::write(
            repo.join(".gitoza/tasks/tickets/demo/DEMO-2.md"),
            "---\ntitle: Bug\nstatus: blocked\ntype: bug\nrelease: demo/1.0\n---\nBody\n",
        )
        .unwrap();
        fs::write(
            repo.join(".gitoza/tasks/tickets/demo/DEMO-3.md"),
            "---\ntitle: Story\nstatus: open\ntype: story\n---\nBody\n",
        )
        .unwrap();
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: "DEMO".to_string(),
                archived: false,
                description: String::new(),
            },
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        ensure_project_prefix(&repo, &conn, slug, "demo").unwrap();
        apply_incremental_ticket_changes(
            &conn,
            &repo,
            slug,
            &[
                ".gitoza/tasks/tickets/demo/DEMO-1.md".to_string(),
                ".gitoza/tasks/tickets/demo/DEMO-2.md".to_string(),
                ".gitoza/tasks/tickets/demo/DEMO-3.md".to_string(),
            ],
            &crate::AuditStampSource::CommitMeta(std::collections::HashMap::new()),
        )
        .unwrap();

        let breakdown = get_ticket_project_breakdown(&conn, slug, "demo").unwrap();
        assert_eq!(breakdown.total, 3);
        assert_eq!(breakdown.backlog_count, 2);
        assert_eq!(breakdown.by_status.get("open"), Some(&2));
        assert_eq!(breakdown.by_status.get("blocked"), Some(&1));
        assert_eq!(breakdown.by_type.get("task"), Some(&1));
        assert_eq!(breakdown.by_type.get("bug"), Some(&1));
        assert_eq!(breakdown.by_type.get("story"), Some(&1));
    }

    #[test]
    fn get_release_ticket_breakdown_counts_status_type() {
        let repo = temp_dir("release_breakdown");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            repo.join(".gitoza/tasks/tickets/demo/DEMO-1.md"),
            "---\ntitle: Open task\nstatus: open\ntype: task\nrelease: demo/1.0\n---\nBody\n",
        )
        .unwrap();
        fs::write(
            repo.join(".gitoza/tasks/tickets/demo/DEMO-2.md"),
            "---\ntitle: Bug\nstatus: blocked\ntype: bug\nrelease: demo/1.0\n---\nBody\n",
        )
        .unwrap();
        fs::write(
            repo.join(".gitoza/tasks/tickets/demo/DEMO-3.md"),
            "---\ntitle: Other release\nstatus: open\ntype: story\nrelease: demo/2.0\n---\nBody\n",
        )
        .unwrap();
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: "DEMO".to_string(),
                archived: false,
                description: String::new(),
            },
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        ensure_project_prefix(&repo, &conn, slug, "demo").unwrap();
        apply_incremental_ticket_changes(
            &conn,
            &repo,
            slug,
            &[
                ".gitoza/tasks/tickets/demo/DEMO-1.md".to_string(),
                ".gitoza/tasks/tickets/demo/DEMO-2.md".to_string(),
                ".gitoza/tasks/tickets/demo/DEMO-3.md".to_string(),
            ],
            &crate::AuditStampSource::CommitMeta(std::collections::HashMap::new()),
        )
        .unwrap();

        let breakdown = get_release_ticket_breakdown(&conn, slug, "demo/1.0").unwrap();
        assert_eq!(breakdown.total, 2);
        assert_eq!(breakdown.backlog_count, 0);
        assert_eq!(breakdown.by_status.get("open"), Some(&1));
        assert_eq!(breakdown.by_status.get("blocked"), Some(&1));
        assert_eq!(breakdown.by_type.get("task"), Some(&1));
        assert_eq!(breakdown.by_type.get("bug"), Some(&1));
        assert!(breakdown.by_type.get("story").is_none());
    }

    #[test]
    fn update_ticket_project_writes_description() {
        let repo = temp_dir("update_desc");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: "DEMO".to_string(),
                archived: false,
                description: String::new(),
            },
        )
        .unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        ensure_project_prefix(&repo, &conn, slug, "demo").unwrap();
        let detail =
            update_ticket_project(&conn, &repo, slug, "demo", "Overview notes").unwrap();
        assert_eq!(detail.description, "Overview notes");
        let meta = read_project_meta(&project_dir).expect("meta");
        assert_eq!(meta.description, "Overview notes");
        assert_eq!(meta.ticket_prefix, "DEMO");
    }

    #[test]
    fn list_ticket_projects_filters_archived_flag() {
        let repo = temp_dir("list_archived");
        let active_dir = repo.join(".gitoza/tasks/tickets/active");
        let archived_dir = repo.join(".gitoza/tasks/tickets/old");
        fs::create_dir_all(&active_dir).unwrap();
        fs::create_dir_all(&archived_dir).unwrap();
        write_project_meta(
            &active_dir,
            &TicketProjectMeta {
                ticket_prefix: "ACTV".to_string(),
                archived: false,
                description: String::new(),
            },
        )
        .unwrap();
        write_project_meta(
            &archived_dir,
            &TicketProjectMeta {
                ticket_prefix: "OLDX".to_string(),
                archived: true,
                description: String::new(),
            },
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        ensure_project_prefix(&repo, &conn, slug, "active").unwrap();
        ensure_project_prefix(&repo, &conn, slug, "old").unwrap();

        let active = list_ticket_projects(
            &conn,
            &repo,
            slug,
            TicketProjectListFilter::ActiveOnly,
        )
        .unwrap();
        let archived = list_ticket_projects(
            &conn,
            &repo,
            slug,
            TicketProjectListFilter::ArchivedOnly,
        )
        .unwrap();
        assert_eq!(
            active.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(),
            vec!["active"]
        );
        assert_eq!(
            archived
                .iter()
                .map(|n| n.name.as_str())
                .collect::<Vec<_>>(),
            vec!["old"]
        );
    }

    #[test]
    fn archive_restore_does_not_move_ticket_files() {
        let repo = temp_dir("archive_no_move");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        let ticket_rel = ".gitoza/tasks/tickets/demo/DEMO-1.md";
        let ticket_abs = repo.join(ticket_rel);
        fs::write(
            &ticket_abs,
            "---\ntitle: Demo\nstatus: open\ntype: task\n---\nBody\n",
        )
        .unwrap();
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: "DEMO".to_string(),
                archived: false,
                description: String::new(),
            },
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        ensure_project_prefix(&repo, &conn, slug, "demo").unwrap();

        set_ticket_project_archived(&conn, &repo, slug, "demo", true).unwrap();
        assert!(ticket_abs.is_file(), "ticket must stay in place");
        assert!(!repo
            .join(".gitoza/tasks/tickets/.archive/demo/DEMO-1.md")
            .exists());
        assert!(is_ticket_project_archived(&conn, &repo, slug, "demo"));

        set_ticket_project_archived(&conn, &repo, slug, "demo", false).unwrap();
        assert!(ticket_abs.is_file());
        assert!(!is_ticket_project_archived(&conn, &repo, slug, "demo"));
    }

    #[test]
    fn delete_ticket_project_requires_archived() {
        let repo = temp_dir("delete_archived");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        let ticket_abs = repo.join(".gitoza/tasks/tickets/demo/DEMO-1.md");
        fs::write(
            &ticket_abs,
            "---\ntitle: Demo\nstatus: open\ntype: task\n---\nBody\n",
        )
        .unwrap();
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: "DEMO".to_string(),
                archived: false,
                description: String::new(),
            },
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        ensure_project_prefix(&repo, &conn, slug, "demo").unwrap();
        apply_incremental_ticket_changes(
            &conn,
            &repo,
            slug,
            &[".gitoza/tasks/tickets/demo/DEMO-1.md".to_string()],
            &crate::AuditStampSource::CommitMeta(std::collections::HashMap::new()),
        )
        .unwrap();

        let err = delete_ticket_project(&conn, &repo, slug, "demo").unwrap_err();
        assert!(
            err.to_string().contains("archived"),
            "active delete should fail: {err}"
        );
        assert!(project_dir.is_dir());

        set_ticket_project_archived(&conn, &repo, slug, "demo", true).unwrap();
        delete_ticket_project(&conn, &repo, slug, "demo").unwrap();
        assert!(!project_dir.exists());
        let tickets_left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tickets WHERE repo_slug = ? AND file_path LIKE ?",
                params![slug, ".gitoza/tasks/tickets/demo/%"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tickets_left, 0);
        let projects_left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ticket_projects WHERE repo_slug = ? AND project_name = ?",
                params![slug, "demo"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(projects_left, 0);
    }

    #[test]
    fn query_tickets_excludes_archived_projects_unless_exact_id() {
        let repo = temp_dir("query_archived");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        let ticket_rel = ".gitoza/tasks/tickets/demo/DEMO-1.md";
        fs::write(
            repo.join(ticket_rel),
            "---\ntitle: Demo\nstatus: open\ntype: task\n---\nBody\n",
        )
        .unwrap();
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: "DEMO".to_string(),
                archived: false,
                description: String::new(),
            },
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        ensure_project_prefix(&repo, &conn, slug, "demo").unwrap();
        apply_incremental_ticket_changes(
            &conn,
            &repo,
            slug,
            &[ticket_rel.to_string()],
            &crate::AuditStampSource::CommitMeta(std::collections::HashMap::new()),
        )
        .unwrap();
        set_ticket_project_archived(&conn, &repo, slug, "demo", true).unwrap();

        let (items, total) = query_tickets_db(
            &conn,
            slug,
            QueryTicketsArgs {
                search: None,
                status: None,
                priority: None,
                ticket_type: None,
                tag: None,
                assigned_to: None,
                sprint: None,
                release: None,
                parent: None,
                ticket_id: None,
                project: None,
                param_filters: None,
                sort_by: "ticket_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 50,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 0);
        assert!(items.is_empty());

        let (items, total) = query_tickets_db(
            &conn,
            slug,
            QueryTicketsArgs {
                search: None,
                status: None,
                priority: None,
                ticket_type: None,
                tag: None,
                assigned_to: None,
                sprint: None,
                release: None,
                parent: None,
                ticket_id: Some("DEMO-1".to_string()),
                project: None,
                param_filters: None,
                sort_by: "ticket_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 50,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].ticket_id, "DEMO-1");
    }

    #[test]
    fn query_tickets_release_none_matches_empty_release_only() {
        let repo = temp_dir("release_none");
        let project_dir = repo.join(".gitoza/tasks/tickets/demo");
        fs::create_dir_all(&project_dir).unwrap();
        let backlog_rel = ".gitoza/tasks/tickets/demo/DEMO-1.md";
        let planned_rel = ".gitoza/tasks/tickets/demo/DEMO-2.md";
        fs::write(
            repo.join(backlog_rel),
            "---\ntitle: Backlog\nstatus: open\ntype: task\n---\nBody\n",
        )
        .unwrap();
        fs::write(
            repo.join(planned_rel),
            "---\ntitle: Planned\nstatus: open\ntype: task\nrelease: demo/1.0\n---\nBody\n",
        )
        .unwrap();
        write_project_meta(
            &project_dir,
            &TicketProjectMeta {
                ticket_prefix: "DEMO".to_string(),
                archived: false,
                description: String::new(),
            },
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_tickets_schema(&conn).unwrap();
        let slug = "repo";
        ensure_project_prefix(&repo, &conn, slug, "demo").unwrap();
        apply_incremental_ticket_changes(
            &conn,
            &repo,
            slug,
            &[backlog_rel.to_string(), planned_rel.to_string()],
            &crate::AuditStampSource::CommitMeta(std::collections::HashMap::new()),
        )
        .unwrap();

        let (items, total) = query_tickets_db(
            &conn,
            slug,
            QueryTicketsArgs {
                search: None,
                status: None,
                priority: None,
                ticket_type: None,
                tag: None,
                assigned_to: None,
                sprint: None,
                release: Some(TICKET_RELEASE_NONE.to_string()),
                parent: None,
                ticket_id: None,
                project: Some("demo".to_string()),
                param_filters: None,
                sort_by: "ticket_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 50,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].ticket_id, "DEMO-1");

        let (items, total) = query_tickets_db(
            &conn,
            slug,
            QueryTicketsArgs {
                search: None,
                status: None,
                priority: None,
                ticket_type: None,
                tag: None,
                assigned_to: None,
                sprint: None,
                release: Some("demo/1.0".to_string()),
                parent: None,
                ticket_id: None,
                project: Some("demo".to_string()),
                param_filters: None,
                sort_by: "ticket_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 50,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].ticket_id, "DEMO-2");
    }
}
