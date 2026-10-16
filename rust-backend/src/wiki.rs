//! File-is-truth wiki pages under `.gitoza/wiki/` (nested folders + YAML + SQLite index).

use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection};

use crate::{
    file_rel_from_repo, is_valid_case_id, is_valid_project_name, models, normalize_tags_for_storage,
};
use indexmap::IndexMap;

pub(crate) const WIKI_PREFIX: &str = ".gitoza/wiki/";
pub(crate) const WIKI_ROOT_REL: &str = ".gitoza/wiki";
pub(crate) const WIKI_RESERVED_DIR: &str = ".archive";
pub(crate) const WIKI_ARCHIVE_ROOT: &str = ".gitoza/wiki/.archive";
pub(crate) const WIKI_ARCHIVE_PREFIX: &str = ".gitoza/wiki/.archive/";
const GITKEEP_FILE: &str = ".gitkeep";
/// Allocated wiki page ids: `W-` + 6 alphanumeric chars.
const WIKI_ID_PREFIX: &str = "W";
const WIKI_ID_SUFFIX_LEN: usize = 6;
const WIKI_ID_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

fn is_workspace_doc_file(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(crate::paths::is_workspace_doc_ext)
        .unwrap_or(false)
}

fn is_forbidden_wiki_folder_name(name: &str) -> bool {
    name == WIKI_RESERVED_DIR || name == "." || name == ".." || name.starts_with('.')
}

fn is_valid_wiki_nested_folder_name(name: &str) -> bool {
    name != "." && name != ".." && !name.starts_with('.') && is_valid_project_name(name)
}

/// Skip dot-prefixed dirs during wiki YAML scan except top-level `.archive` under wiki root.
fn should_skip_wiki_scan_dir(parent_rel: &str, dir_name: &str) -> bool {
    if dir_name == "." || dir_name == ".." {
        return true;
    }
    if !dir_name.starts_with('.') {
        return false;
    }
    !(parent_rel == WIKI_ROOT_REL && dir_name == WIKI_RESERVED_DIR)
}

/// True when the wiki YAML lives under `.gitoza/wiki/.archive/`.
pub(crate) fn is_archived_wiki_path(file_rel: &str) -> bool {
    let norm = file_rel.trim().replace('\\', "/");
    norm.starts_with(WIKI_ARCHIVE_PREFIX) || norm == WIKI_ARCHIVE_ROOT
}

pub(crate) fn active_wiki_path_sql_clause() -> &'static str {
    "file_path NOT LIKE '.gitoza/wiki/.archive/%'"
}

pub(crate) fn archived_wiki_path_sql_clause() -> &'static str {
    "file_path LIKE '.gitoza/wiki/.archive/%'"
}

/// Map an active wiki path to its archived counterpart under `.archive/`.
pub(crate) fn wiki_to_archive_path(active_rel: &str) -> Result<String, String> {
    let norm = active_rel.trim().replace('\\', "/");
    if !norm.starts_with(WIKI_PREFIX) || norm == WIKI_ROOT_REL {
        return Err("Wiki page must be under .gitoza/wiki/".to_string());
    }
    if is_archived_wiki_path(&norm) {
        return Err("Wiki page is already archived".to_string());
    }
    let after = &norm[WIKI_PREFIX.len()..];
    if after.is_empty() {
        return Err("Wiki page path is incomplete".to_string());
    }
    Ok(format!("{WIKI_ARCHIVE_PREFIX}{after}"))
}

/// Map an archived wiki path back to its active location.
pub(crate) fn wiki_to_active_path(archived_rel: &str) -> Result<String, String> {
    let norm = archived_rel.trim().replace('\\', "/");
    if !is_archived_wiki_path(&norm) {
        return Err("Wiki page is not under .archive/".to_string());
    }
    let after = norm.strip_prefix(WIKI_ARCHIVE_PREFIX).unwrap_or("");
    if after.is_empty() {
        return Err("Invalid archived wiki path".to_string());
    }
    Ok(format!("{WIKI_PREFIX}{after}"))
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

fn page_id_from_file_name(file_name: &str) -> String {
    let lower = file_name.to_ascii_lowercase();
    if let Some(stem) = lower.strip_suffix(crate::paths::WORKSPACE_DOC_SUFFIX) {
        file_name[..stem.len()].to_string()
    } else {
        file_name.to_string()
    }
}

/// Parent folder relative to `.gitoza/wiki/` (`""` for pages at the wiki root).
pub(crate) fn wiki_folder_from_path(file_path: &str) -> Option<String> {
    let norm = file_path.trim().replace('\\', "/");
    let rest = norm.strip_prefix(WIKI_PREFIX)?;
    match rest.rsplit_once('/') {
        Some((parent, _)) => Some(parent.to_string()),
        None => Some(String::new()),
    }
}

pub(crate) fn wiki_page_id_from_path(file_path: &str) -> Option<String> {
    let name = Path::new(file_path).file_name()?.to_str()?;
    if name.starts_with('.') {
        return None;
    }
    Some(page_id_from_file_name(name))
}

pub(crate) fn is_wiki_yaml_path(file_rel: &str) -> bool {
    let p = file_rel.trim().replace('\\', "/");
    if !p.starts_with(WIKI_PREFIX) {
        return false;
    }
    let name = Path::new(&p)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if name.is_empty() || name.starts_with('.') {
        return false;
    }
    is_workspace_doc_file(Path::new(&p))
}

/// Nested wiki YAML: `.gitoza/wiki/{folders…}/{page}.md` (folders optional).
pub(crate) fn validate_wiki_file_path_for_write(file_path: &str) -> Result<String, String> {
    let file_path = file_path.trim_start_matches('/').trim().replace('\\', "/");
    if file_path.is_empty() || file_path.contains("..") || file_path.starts_with('/') {
        return Err("Invalid file_path".to_string());
    }
    if !file_path.starts_with(WIKI_PREFIX) || file_path == WIKI_ROOT_REL {
        return Err("Wiki page must be under .gitoza/wiki/".to_string());
    }
    let rest = &file_path[WIKI_PREFIX.len()..];
    if rest.is_empty() {
        return Err("Wiki page path is incomplete".to_string());
    }
    let parts: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return Err("Wiki page path is incomplete".to_string());
    }
    let file_name = parts[parts.len() - 1];
    for folder in &parts[..parts.len() - 1] {
        if is_forbidden_wiki_folder_name(folder) || !is_valid_project_name(folder) {
            return Err(
                "Invalid wiki folder name. Use only letters, numbers, underscores, and hyphens."
                    .to_string(),
            );
        }
    }
    let lower = file_name.to_ascii_lowercase();
    if !(lower.ends_with(".md") || lower.ends_with(".md")) {
        return Err("Wiki page file must be .md".to_string());
    }
    let stem = page_id_from_file_name(file_name);
    if !is_valid_case_id(&stem) {
        return Err(
            "Invalid wiki page id. Use only letters, numbers, underscores, and hyphens."
                .to_string(),
        );
    }
    Ok(file_path)
}

/// Folder path: `.gitoza/wiki` or `.gitoza/wiki/{folders…}`.
pub(crate) fn validate_wiki_folder_path(folder_path: &str) -> Result<String, String> {
    let folder_path = folder_path
        .trim_start_matches('/')
        .trim()
        .trim_end_matches('/')
        .replace('\\', "/");
    if folder_path.is_empty() || folder_path.contains("..") || folder_path.starts_with('/') {
        return Err("Invalid folder_path".to_string());
    }
    if folder_path == WIKI_ROOT_REL {
        return Ok(folder_path);
    }
    if !folder_path.starts_with(WIKI_PREFIX) {
        return Err("Wiki folder must be under .gitoza/wiki/".to_string());
    }
    let rest = &folder_path[WIKI_PREFIX.len()..];
    if rest.is_empty() {
        return Ok(WIKI_ROOT_REL.to_string());
    }
    for folder in rest.split('/').filter(|s| !s.is_empty()) {
        if is_forbidden_wiki_folder_name(folder) || !is_valid_project_name(folder) {
            return Err(
                "Invalid wiki folder name. Use only letters, numbers, underscores, and hyphens."
                    .to_string(),
            );
        }
    }
    Ok(folder_path)
}

fn validate_wiki_yaml_file_name(file_name: &str) -> Result<(), String> {
    let lower = file_name.to_ascii_lowercase();
    if !(lower.ends_with(".md") || lower.ends_with(".md")) {
        return Err("Wiki page file must be .md".to_string());
    }
    let stem = page_id_from_file_name(file_name);
    if !is_valid_case_id(&stem) {
        return Err(
            "Invalid wiki page id. Use only letters, numbers, underscores, and hyphens."
                .to_string(),
        );
    }
    Ok(())
}

/// Archived wiki YAML: `.gitoza/wiki/.archive/{folders…}/{page}.md`.
pub(crate) fn validate_wiki_archived_file_path_for_write(
    file_path: &str,
) -> Result<String, String> {
    let file_path = file_path.trim_start_matches('/').trim().replace('\\', "/");
    if file_path.is_empty() || file_path.contains("..") || file_path.starts_with('/') {
        return Err("Invalid file_path".to_string());
    }
    if !file_path.starts_with(WIKI_ARCHIVE_PREFIX) {
        return Err("Archived wiki page must be under .gitoza/wiki/.archive/".to_string());
    }
    let rest = &file_path[WIKI_ARCHIVE_PREFIX.len()..];
    if rest.is_empty() {
        return Err("Wiki page path is incomplete".to_string());
    }
    let parts: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return Err("Wiki page path is incomplete".to_string());
    }
    let file_name = parts[parts.len() - 1];
    for folder in &parts[..parts.len() - 1] {
        if !is_valid_wiki_nested_folder_name(folder) {
            return Err(
                "Invalid wiki folder name. Use only letters, numbers, underscores, and hyphens."
                    .to_string(),
            );
        }
    }
    validate_wiki_yaml_file_name(file_name)?;
    Ok(file_path)
}

/// Read validator: active pages or archived pages.
pub(crate) fn validate_wiki_file_path_for_read(file_path: &str) -> Result<String, String> {
    let norm = file_path.trim_start_matches('/').trim().replace('\\', "/");
    if is_archived_wiki_path(&norm) {
        validate_wiki_archived_file_path_for_write(&norm)
    } else {
        validate_wiki_file_path_for_write(&norm)
    }
}

/// Archived folder: `.gitoza/wiki/.archive` or `.gitoza/wiki/.archive/{folders…}`.
pub(crate) fn validate_wiki_archived_folder_path(folder_path: &str) -> Result<String, String> {
    let folder_path = folder_path
        .trim_start_matches('/')
        .trim()
        .trim_end_matches('/')
        .replace('\\', "/");
    if folder_path.is_empty() || folder_path.contains("..") || folder_path.starts_with('/') {
        return Err("Invalid folder_path".to_string());
    }
    if !folder_path.starts_with(WIKI_ARCHIVE_PREFIX) && folder_path != WIKI_ARCHIVE_ROOT {
        return Err("Archived wiki folder must be under .gitoza/wiki/.archive/".to_string());
    }
    if folder_path == WIKI_ARCHIVE_ROOT {
        return Ok(folder_path);
    }
    let rest = &folder_path[WIKI_ARCHIVE_PREFIX.len()..];
    if rest.is_empty() {
        return Ok(WIKI_ARCHIVE_ROOT.to_string());
    }
    for folder in rest.split('/').filter(|s| !s.is_empty()) {
        if !is_valid_wiki_nested_folder_name(folder) {
            return Err(
                "Invalid wiki folder name. Use only letters, numbers, underscores, and hyphens."
                    .to_string(),
            );
        }
    }
    Ok(folder_path)
}

pub(crate) fn slugify_wiki_name(name: &str) -> String {
    crate::run_publish::sanitize_folder_name(name)
}

/// Filename stem from a typed page name. Empty/invalid names are errors (no silent `page` fallback).
/// Kept for tests / callers that still slugify display names; create_wiki_page no longer uses this for filenames.
#[cfg(test)]
pub(crate) fn wiki_page_stem_from_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Wiki page name is required.".to_string());
    }
    let stem = slugify_wiki_name(title);
    if stem.is_empty() || !is_valid_case_id(&stem) {
        return Err(
            "Could not derive a valid page id from the name. Use letters, numbers, underscores, and hyphens."
                .to_string(),
        );
    }
    Ok(stem)
}

#[cfg(test)]
pub(crate) fn wiki_page_file_exists(folder_dir: &Path, stem: &str) -> bool {
    folder_dir.join(format!("{stem}.md")).exists()
}

/// True when `page_id` matches the allocated form `W-XXXXXX`.
pub(crate) fn is_allocated_wiki_id(page_id: &str) -> bool {
    let Some(rest) = page_id.strip_prefix(&format!("{WIKI_ID_PREFIX}-")) else {
        return false;
    };
    rest.len() == WIKI_ID_SUFFIX_LEN
        && rest
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        && is_valid_case_id(page_id)
}

fn random_wiki_id_suffix(len: usize) -> String {
    let mut out = String::with_capacity(len);
    while out.len() < len {
        let u = uuid::Uuid::new_v4();
        for b in u.as_bytes() {
            if out.len() >= len {
                break;
            }
            out.push(WIKI_ID_ALPHABET[(*b as usize) % WIKI_ID_ALPHABET.len()] as char);
        }
    }
    out
}

/// True if any wiki YAML under the repo uses this stem (any folder / archive).
pub(crate) fn wiki_id_taken_on_disk(repo_path: &Path, page_id: &str) -> bool {
    discover_wiki_yaml_rel_paths(repo_path)
        .iter()
        .any(|rel| wiki_page_id_from_path(rel).as_deref() == Some(page_id))
}

fn wiki_id_taken_in_db(conn: &Connection, slug: &str, page_id: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM wiki_pages WHERE repo_slug = ?1 AND page_id = ?2 LIMIT 1",
        params![slug, page_id],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

/// Generate `W-{6}` not used on disk (whole wiki tree) or in the wiki_pages index.
pub(crate) fn generate_unique_wiki_id(
    conn: &Connection,
    slug: &str,
    repo_path: &Path,
) -> Result<String> {
    for _ in 0..64 {
        let id = format!(
            "{WIKI_ID_PREFIX}-{}",
            random_wiki_id_suffix(WIKI_ID_SUFFIX_LEN)
        );
        if !is_allocated_wiki_id(&id) {
            continue;
        }
        if wiki_id_taken_on_disk(repo_path, &id) {
            continue;
        }
        if wiki_id_taken_in_db(conn, slug, &id) {
            continue;
        }
        return Ok(id);
    }
    anyhow::bail!("Failed to allocate unique wiki page id")
}

pub(crate) fn init_wiki_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS wiki_pages (
  page_id      TEXT    NOT NULL,
  title        TEXT,
  tags         TEXT,
  status       TEXT,
  folder       TEXT    NOT NULL,
  file_path    TEXT    NOT NULL,
  repo_slug    TEXT    NOT NULL,
  indexed_at   TEXT    NOT NULL,
  updated_at   TEXT,
  updated_by   TEXT,
  PRIMARY KEY (repo_slug, file_path)
);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_repo ON wiki_pages(repo_slug);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_folder ON wiki_pages(repo_slug, folder);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_id ON wiki_pages(page_id);
"#,
    )?;
    // Repo-wide unique page_id. Best-effort: may fail until legacy slug stems are
    // migrated on reindex (duplicate stems across folders). Reindex re-attempts it.
    ensure_wiki_page_id_unique_index(conn);
    // Best-effort migrations for older DBs.
    // SQLite doesn't support IF NOT EXISTS for ADD COLUMN, so ignore errors.
    let _ = conn.execute("ALTER TABLE wiki_pages ADD COLUMN status TEXT", []);
    Ok(())
}

pub(crate) fn ensure_wiki_page_id_unique_index(conn: &Connection) {
    let _ = conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_pages_repo_page_id ON wiki_pages(repo_slug, page_id)",
        [],
    );
}

fn parse_wiki_from_front_matter(
    lower: BTreeMap<String, serde_yaml::Value>,
    body: String,
    raw: String,
    default_page_id: &str,
    file_path: &str,
) -> models::YamlWikiPageDetail {
    // Identity is always the filename stem (immutable wiki id).
    let page_id = default_page_id.to_string();
    let folder = wiki_folder_from_path(file_path).unwrap_or_default();
    models::YamlWikiPageDetail {
        page_id,
        title: yaml_str(&lower, "title"),
        tags: parse_tags(&lower),
        status: yaml_str(&lower, "status"),
        folder,
        file_path: file_path.to_string(),
        body,
        raw,
        updated_at: yaml_str(&lower, "updated_at"),
        updated_by: yaml_str(&lower, "updated_by"),
    }
}

pub(crate) fn read_wiki_yaml(path: &Path) -> Result<Option<models::YamlWikiPageDetail>> {
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
    Ok(Some(parse_wiki_from_front_matter(
        lower,
        body,
        raw,
        &default_id,
        "",
    )))
}

pub(crate) fn wiki_detail_to_front_matter(
    d: &models::YamlWikiPageDetail,
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
    let tags = normalize_tags_for_storage(d.tags.clone());
    if !tags.is_empty() {
        fm.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(tags.into_iter().map(serde_yaml::Value::String).collect()),
        );
    }

    if let Some(status) = d.status.as_ref() {
        let s = status.trim();
        if !s.is_empty() {
            fm.insert(
                "status".to_string(),
                serde_yaml::Value::String(s.to_string()),
            );
        }
    }
    fm
}

#[derive(Debug)]
pub(crate) struct UpsertWikiPageArgs {
    pub(crate) page_id: String,
    pub(crate) title: Option<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) status: Option<String>,
    pub(crate) folder: String,
    pub(crate) file_path: String,
    pub(crate) repo_slug: String,
    pub(crate) updated_at: Option<String>,
    pub(crate) updated_by: Option<String>,
}

pub(crate) fn load_wiki_audit(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
) -> (Option<String>, Option<String>) {
    let key = crate::normalize_repo_rel_path(file_path);
    if key.is_empty() {
        return (None, None);
    }
    conn.query_row(
        r#"SELECT updated_at, updated_by FROM wiki_pages
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

pub(crate) fn apply_wiki_audit_from_db(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
    detail: &mut models::YamlWikiPageDetail,
) {
    let (at, by) = load_wiki_audit(conn, repo_slug, file_path);
    detail.updated_at = at;
    detail.updated_by = by;
}

pub(crate) fn upsert_wiki_page_db(conn: &Connection, a: UpsertWikiPageArgs) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let tags_json = serde_json::to_string(&a.tags).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        r#"
INSERT INTO wiki_pages
  (page_id, title, tags, status, folder, file_path, repo_slug, indexed_at, updated_at, updated_by)
VALUES
  (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
ON CONFLICT(repo_slug, file_path) DO UPDATE SET
  page_id = excluded.page_id,
  title = excluded.title,
  tags = excluded.tags,
  status = excluded.status,
  folder = excluded.folder,
  indexed_at = excluded.indexed_at,
  updated_at = COALESCE(excluded.updated_at, wiki_pages.updated_at),
  updated_by = COALESCE(excluded.updated_by, wiki_pages.updated_by)
"#,
        params![
            a.page_id,
            a.title,
            tags_json,
            a.status,
            a.folder,
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
    d: &models::YamlWikiPageDetail,
    file_rel: &str,
    repo_slug: &str,
    audit: &crate::AuditStampSource,
) -> UpsertWikiPageArgs {
    let (updated_at, updated_by) = audit.resolve(file_rel);
    let folder = wiki_folder_from_path(file_rel).unwrap_or_default();
    let page_id = if d.page_id.trim().is_empty() {
        wiki_page_id_from_path(file_rel).unwrap_or_else(|| d.page_id.clone())
    } else {
        d.page_id.clone()
    };
    UpsertWikiPageArgs {
        page_id,
        title: d.title.clone(),
        tags: normalize_tags_for_storage(d.tags.clone()),
        status: d.status.clone(),
        folder,
        file_path: file_rel.to_string(),
        repo_slug: repo_slug.to_string(),
        updated_at,
        updated_by,
    }
}

fn collect_wiki_yaml_rel_paths(
    repo_path: &Path,
    dir: &Path,
    parent_rel: &str,
    out: &mut Vec<String>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            if should_skip_wiki_scan_dir(parent_rel, &name) {
                continue;
            }
            let child_rel = if parent_rel.is_empty() {
                format!("{WIKI_PREFIX}{name}")
            } else {
                format!("{parent_rel}/{name}")
            };
            collect_wiki_yaml_rel_paths(repo_path, &p, &child_rel, out);
            continue;
        }
        if name.starts_with('.') {
            continue;
        }
        if !p.is_file() || !is_workspace_doc_file(&p) {
            continue;
        }
        out.push(file_rel_from_repo(repo_path, &p));
    }
}

pub(crate) fn discover_wiki_yaml_rel_paths(repo_path: &Path) -> Vec<String> {
    let root = repo_path.join(WIKI_ROOT_REL);
    if !root.is_dir() {
        return Vec::new();
    }
    let mut out = Vec::new();
    collect_wiki_yaml_rel_paths(repo_path, &root, WIKI_ROOT_REL, &mut out);
    out.sort();
    out
}

fn index_wiki_yaml_file(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
    abs: &Path,
    audit: &crate::AuditStampSource,
) -> Result<bool> {
    let file_rel = file_rel_from_repo(repo_path, abs);
    if validate_wiki_file_path_for_read(&file_rel).is_err() {
        return Ok(false);
    }
    let d = match read_wiki_yaml(abs)? {
        Some(x) => x,
        None => return Ok(false),
    };
    upsert_wiki_page_db(conn, detail_to_upsert(&d, &file_rel, repo_slug, audit))?;
    Ok(true)
}

pub(crate) fn index_wiki_from_yaml(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
) -> Result<i64> {
    let audit = crate::AuditStampSource::for_wiki_full(repo_path);
    index_wiki_from_yaml_with_audit(conn, repo_path, repo_slug, &audit)
}

pub(crate) fn index_wiki_from_yaml_with_audit(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
    audit: &crate::AuditStampSource,
) -> Result<i64> {
    let mut total: i64 = 0;
    for rel in discover_wiki_yaml_rel_paths(repo_path) {
        let rel = migrate_legacy_wiki_page_if_needed(conn, repo_path, repo_slug, &rel)?;
        let abs = repo_path.join(&rel);
        if index_wiki_yaml_file(conn, repo_path, repo_slug, &abs, audit)? {
            total += 1;
        }
    }
    Ok(total)
}

pub(crate) fn reindex_wiki_for_repo(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
) -> Result<i64> {
    conn.execute("DELETE FROM wiki_pages WHERE repo_slug = ?", [slug])?;
    let n = index_wiki_from_yaml(conn, repo_path, slug)?;
    ensure_wiki_page_id_unique_index(conn);
    Ok(n)
}

/// Update indexed `file_path` + `folder` when a wiki page is moved (page_id unchanged).
pub(crate) fn remap_wiki_file_path(
    conn: &Connection,
    slug: &str,
    old_path: &str,
    new_path: &str,
) -> Result<u64> {
    let old_norm = crate::normalize_repo_rel_path(old_path);
    let new_norm = crate::normalize_repo_rel_path(new_path);
    if old_norm.is_empty() || new_norm.is_empty() || old_norm == new_norm {
        return Ok(0);
    }
    let folder = wiki_folder_from_path(&new_norm).unwrap_or_default();
    let changed = conn.execute(
        "UPDATE wiki_pages SET file_path = ?1, folder = ?2 WHERE repo_slug = ?3 AND file_path = ?4",
        params![new_norm, folder, slug, old_norm],
    )?;
    Ok(changed as u64)
}

pub(crate) fn stamp_wiki_audit_in_db(
    conn: &Connection,
    repo_slug: &str,
    file_paths: &[String],
    updated_by: &str,
    updated_at: &str,
) -> Result<usize> {
    let mut n = 0usize;
    for path in file_paths {
        let key = crate::normalize_repo_rel_path(path);
        if key.is_empty() {
            continue;
        }
        let changed = conn.execute(
            r#"UPDATE wiki_pages SET updated_at = ?1, updated_by = ?2
WHERE repo_slug = ?3 AND file_path = ?4"#,
            params![updated_at, updated_by, repo_slug, key],
        )?;
        n += changed as usize;
    }
    Ok(n)
}

/// After archive/move/restore/delete of a *page*, keep wiki folders as they are.
/// Unlike test cases, empty wiki folders are first-class and are only removed when
/// the user explicitly deletes a folder. Write `.gitkeep` so Git still tracks them.
pub(crate) fn prune_empty_wiki_dirs_upward(repo_path: &Path, dir_rel: &str) {
    let dir_rel = dir_rel
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    if dir_rel.is_empty() || dir_rel.contains("..") {
        return;
    }
    if dir_rel == WIKI_ROOT_REL || dir_rel == WIKI_ARCHIVE_ROOT {
        return;
    }
    if !dir_rel.starts_with(WIKI_PREFIX) {
        return;
    }
    let abs = repo_path.join(&dir_rel);
    if !abs.is_dir() {
        return;
    }
    let _ = write_gitkeep(&abs);
}

pub(crate) fn collect_wiki_yaml_paths_under(repo_path: &Path, directory_rel: &str) -> Vec<String> {
    let mut out = Vec::new();
    let root = repo_path.join(directory_rel);
    if !root.is_dir() {
        return out;
    }
    collect_wiki_yaml_rel_paths(repo_path, &root, directory_rel, &mut out);
    out.sort();
    out
}

/// Move one active wiki YAML to its archived path. Does not reindex or prune.
pub(crate) fn archive_wiki_page_on_disk(
    repo_path: &Path,
    file_path: &str,
    reason: &str,
) -> Result<String, String> {
    let file_path = validate_wiki_file_path_for_write(file_path)?;
    if is_archived_wiki_path(&file_path) {
        return Err(
            "Wiki page is already under .archive/ and cannot be archived again.".to_string(),
        );
    }
    let new_path = wiki_to_archive_path(&file_path)?;
    let src = repo_path.join(&file_path);
    if !src.is_file() {
        return Err(format!("Wiki page not found: {file_path}"));
    }
    let existing = match read_wiki_yaml(&src) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(format!("Could not parse YAML: {file_path}")),
        Err(e) => return Err(format!("Failed to read YAML: {e:#}")),
    };
    let mut fm = wiki_detail_to_front_matter(&existing);
    fm.insert(
        "archived_at".to_string(),
        serde_yaml::Value::String(Utc::now().to_rfc3339()),
    );
    fm.insert(
        "archived_reason".to_string(),
        serde_yaml::Value::String(reason.to_string()),
    );
    let dest = repo_path.join(&new_path);
    if let Some(par) = dest.parent() {
        std::fs::create_dir_all(par)
            .map_err(|e| format!("Failed to create archived directory: {e:#}"))?;
    }
    if dest.exists() {
        return Err(format!("Target already exists: {new_path}"));
    }
    crate::write_yaml_from_existing_raw(&dest, &existing.raw, &fm, &existing.body)
        .map_err(|e| format!("Failed to write archived YAML: {e:#}"))?;
    if let Err(e) = std::fs::remove_file(&src) {
        let _ = std::fs::remove_file(&dest);
        return Err(format!("Failed to remove original file: {e:#}"));
    }
    Ok(new_path)
}

/// Move one archived wiki YAML to its active path. Does not reindex or prune.
pub(crate) fn restore_wiki_page_on_disk(
    repo_path: &Path,
    file_path: &str,
) -> Result<String, String> {
    let file_path = validate_wiki_archived_file_path_for_write(file_path)?;
    let new_path = wiki_to_active_path(&file_path)?;
    let src = repo_path.join(&file_path);
    if !src.is_file() {
        return Err(format!("Wiki page not found: {file_path}"));
    }
    let existing = match read_wiki_yaml(&src) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(format!("Could not parse YAML: {file_path}")),
        Err(e) => return Err(format!("Failed to read YAML: {e:#}")),
    };
    let fm = wiki_detail_to_front_matter(&existing);
    let dest = repo_path.join(&new_path);
    if let Some(par) = dest.parent() {
        std::fs::create_dir_all(par)
            .map_err(|e| format!("Failed to create target directory: {e:#}"))?;
    }
    if dest.exists() {
        return Err(format!("Target already exists: {new_path}"));
    }
    crate::write_yaml_from_existing_raw(&dest, &existing.raw, &fm, &existing.body)
        .map_err(|e| format!("Failed to write restored YAML: {e:#}"))?;
    if let Err(e) = std::fs::remove_file(&src) {
        let _ = std::fs::remove_file(&dest);
        return Err(format!("Failed to remove archived file: {e:#}"));
    }
    Ok(new_path)
}

pub(crate) fn apply_incremental_wiki_changes(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    changed: &[String],
    audit: &crate::AuditStampSource,
) -> Result<()> {
    for rel in changed {
        if !is_wiki_yaml_path(rel) {
            continue;
        }
        let abs = repo_path.join(rel);
        if abs.is_file() {
            let new_rel = migrate_legacy_wiki_page_if_needed(conn, repo_path, slug, rel)?;
            if new_rel != *rel {
                conn.execute(
                    "DELETE FROM wiki_pages WHERE repo_slug = ? AND file_path = ?",
                    params![slug, rel],
                )?;
            }
            let abs = repo_path.join(&new_rel);
            let d = match read_wiki_yaml(&abs)? {
                Some(v) => v,
                None => continue,
            };
            if validate_wiki_file_path_for_read(&new_rel).is_err() {
                continue;
            }
            upsert_wiki_page_db(conn, detail_to_upsert(&d, &new_rel, slug, audit))?;
        } else {
            conn.execute(
                "DELETE FROM wiki_pages WHERE repo_slug = ? AND file_path = ?",
                params![slug, rel],
            )?;
        }
    }
    ensure_wiki_page_id_unique_index(conn);
    Ok(())
}

/// Rename legacy slug-named wiki YAML to an allocated `W-XXXXXX.md`. Idempotent when already allocated.
pub(crate) fn migrate_legacy_wiki_page_if_needed(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    file_rel: &str,
) -> Result<String> {
    let Some(old_id) = wiki_page_id_from_path(file_rel) else {
        return Ok(file_rel.to_string());
    };
    if is_allocated_wiki_id(&old_id) {
        return Ok(file_rel.to_string());
    }
    let abs = repo_path.join(file_rel);
    if !abs.is_file() {
        return Ok(file_rel.to_string());
    }

    let detail = read_wiki_yaml(&abs)?;
    if let Some(d) = detail.as_ref() {
        let title = d
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .unwrap_or(old_id.as_str())
            .to_string();
        let mut fm = IndexMap::new();
        fm.insert("title".to_string(), serde_yaml::Value::String(title));
        if !d.tags.is_empty() {
            fm.insert(
                "tags".to_string(),
                serde_yaml::Value::Sequence(
                    d.tags
                        .iter()
                        .cloned()
                        .map(serde_yaml::Value::String)
                        .collect(),
                ),
            );
        }
        crate::write_yaml_from_existing_raw(&abs, &d.raw, &fm, &d.body)
            .with_context(|| format!("Failed to rewrite {}", abs.display()))?;
    }

    let new_id = generate_unique_wiki_id(conn, slug, repo_path)?;
    let parent = abs.parent().unwrap_or(repo_path);
    let new_abs = parent.join(format!("{new_id}.md"));
    if new_abs.exists() {
        anyhow::bail!(
            "Cannot migrate wiki page '{}': target '{}' already exists",
            file_rel,
            file_rel_from_repo(repo_path, &new_abs)
        );
    }
    std::fs::rename(&abs, &new_abs).with_context(|| {
        format!(
            "Failed to rename wiki page {} -> {}",
            abs.display(),
            new_abs.display()
        )
    })?;
    Ok(file_rel_from_repo(repo_path, &new_abs))
}

pub(crate) fn filter_wiki_yaml_paths(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| is_wiki_yaml_path(p))
        .cloned()
        .collect()
}

#[derive(Debug)]
pub(crate) struct QueryWikiPagesArgs {
    pub(crate) search: Option<String>,
    pub(crate) tag: Option<String>,
    pub(crate) folder: Option<String>,
    pub(crate) status: Option<String>,
    /// Exact page_id match (resolve one wiki id).
    pub(crate) page_id: Option<String>,
    pub(crate) sort_by: String,
    pub(crate) sort_dir: String,
    pub(crate) limit: i64,
    pub(crate) offset: i64,
    pub(crate) exclude_archived: bool,
    pub(crate) archived_only: bool,
}

fn build_query_wiki_conditions(
    repo_slug: &str,
    args: &QueryWikiPagesArgs,
) -> (String, Vec<rusqlite::types::Value>) {
    let mut conditions: Vec<String> = vec!["repo_slug = ?".to_string()];
    let mut params_vec: Vec<rusqlite::types::Value> = vec![repo_slug.to_string().into()];

    if let Some(folder) = args
        .folder
        .as_ref()
        .map(|s| s.trim().trim_end_matches('/').replace('\\', "/"))
        .filter(|s| !s.is_empty())
    {
        let folder_rel = if folder == WIKI_ROOT_REL || folder == WIKI_PREFIX.trim_end_matches('/') {
            String::new()
        } else if let Some(rest) = folder.strip_prefix(WIKI_PREFIX) {
            rest.to_string()
        } else {
            folder
        };
        if folder_rel.is_empty() {
            // Wiki root: no extra path filter (all pages).
        } else {
            conditions.push("(folder = ? OR folder LIKE ? OR file_path LIKE ?)".to_string());
            params_vec.push(folder_rel.clone().into());
            params_vec.push(format!("{folder_rel}/%").into());
            params_vec.push(format!("{WIKI_PREFIX}{folder_rel}/%").into());
        }
    }

    if let Some(s) = args.search.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("(page_id LIKE ? OR title LIKE ? OR tags LIKE ?)".to_string());
        let like = format!("%{}%", s.trim());
        for _ in 0..3 {
            params_vec.push(like.clone().into());
        }
    }
    if let Some(s) = args.page_id.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("TRIM(page_id) = ?".to_string());
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(s) = args.tag.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(tags) LIKE ?".to_string());
        params_vec.push(format!("%\"{}\"%", s.trim().to_lowercase()).into());
    }
    if let Some(s) = args.status.as_ref().filter(|s| !s.trim().is_empty()) {
        // Treat missing status as the default `draft`.
        conditions.push("LOWER(COALESCE(status, 'draft')) = ?".to_string());
        params_vec.push(s.trim().to_lowercase().into());
    }
    if args.archived_only {
        conditions.push(archived_wiki_path_sql_clause().to_string());
    } else if args.exclude_archived {
        conditions.push(active_wiki_path_sql_clause().to_string());
    }

    (conditions.join(" AND "), params_vec)
}

fn map_wiki_list_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<models::YamlWikiPageListItem> {
    let tags_raw: Option<String> = row.get("tags")?;
    let tags: Vec<String> = tags_raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default();
    Ok(models::YamlWikiPageListItem {
        page_id: row.get("page_id")?,
        title: row.get("title")?,
        tags,
        status: row.get("status")?,
        folder: row.get("folder")?,
        file_path: row.get("file_path")?,
        repo_slug: row.get("repo_slug")?,
        indexed_at: row.get("indexed_at")?,
        updated_at: row.get("updated_at")?,
        updated_by: row.get("updated_by")?,
    })
}

pub(crate) fn query_wiki_pages_db(
    conn: &Connection,
    repo_slug: &str,
    args: QueryWikiPagesArgs,
) -> Result<(Vec<models::YamlWikiPageListItem>, i64)> {
    let allowed_sort = HashSet::from([
        "page_id".to_string(),
        "title".to_string(),
        "status".to_string(),
        "updated_at".to_string(),
        "indexed_at".to_string(),
        "folder".to_string(),
    ]);
    let sort_by = if allowed_sort.contains(&args.sort_by) {
        args.sort_by.clone()
    } else {
        "title".to_string()
    };
    let direction = if args.sort_dir.eq_ignore_ascii_case("desc") {
        "DESC"
    } else {
        "ASC"
    };

    let (where_sql, mut filter_params) = build_query_wiki_conditions(repo_slug, &args);

    let count_sql = format!("SELECT COUNT(*) FROM wiki_pages WHERE {where_sql}");
    let total: i64 = conn
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(filter_params.iter()),
            |row| row.get(0),
        )
        .unwrap_or(0);

    let sql = format!(
        r#"
    SELECT page_id, title, tags, status, folder, file_path, repo_slug, indexed_at, updated_at, updated_by
FROM wiki_pages
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
        map_wiki_list_row,
    )?;
    let items: Vec<models::YamlWikiPageListItem> = rows.filter_map(|r| r.ok()).collect();
    Ok((items, total))
}

pub(crate) fn all_wiki_tags(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT tags FROM wiki_pages WHERE repo_slug = ?")?;
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

fn write_gitkeep(dir: &Path) -> Result<()> {
    let keep = dir.join(GITKEEP_FILE);
    if !keep.exists() {
        std::fs::write(&keep, b"")?;
    }
    Ok(())
}

pub(crate) fn ensure_wiki_folder_dir(repo_path: &Path, folder_rel: &str) -> Result<PathBuf> {
    let folder_rel = validate_wiki_folder_path(folder_rel).map_err(|e| anyhow::anyhow!(e))?;
    let dir = repo_path.join(&folder_rel);
    std::fs::create_dir_all(&dir)?;
    write_gitkeep(&dir)?;
    Ok(dir)
}

fn collect_disk_wiki_folders(dir: &Path, rel: &str, out: &mut HashSet<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_forbidden_wiki_folder_name(&name) || !is_valid_project_name(&name) {
            continue;
        }
        let child_rel = if rel.is_empty() {
            format!("{WIKI_PREFIX}{name}")
        } else {
            format!("{rel}/{name}")
        };
        out.insert(child_rel.clone());
        collect_disk_wiki_folders(&p, &child_rel, out);
    }
}

fn insert_tree_folder(
    root: &mut BTreeMap<String, WikiTreeAcc>,
    folder_path: &str,
    strip_prefix: &str,
    root_rel: &str,
) {
    let rest = match folder_path.strip_prefix(strip_prefix) {
        Some(r) if !r.is_empty() => r,
        _ => return,
    };
    let parts: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return;
    }
    let mut cursor = root;
    let mut acc_path = root_rel.to_string();
    let mut from_root: Vec<String> = Vec::new();
    for part in parts.iter() {
        acc_path = format!("{acc_path}/{part}");
        from_root.push((*part).to_string());
        let entry = cursor
            .entry((*part).to_string())
            .or_insert_with(|| WikiTreeAcc {
                name: (*part).to_string(),
                directory_path: acc_path.clone(),
                path_from_root: from_root.clone(),
                is_project: false,
                case_count: 0,
                children: BTreeMap::new(),
            });
        cursor = &mut entry.children;
    }
}

fn add_count(
    root: &mut BTreeMap<String, WikiTreeAcc>,
    folder_path: &str,
    strip_prefix: &str,
    delta: i64,
) {
    let rest = match folder_path.strip_prefix(strip_prefix) {
        Some(r) if !r.is_empty() => r,
        _ => return,
    };
    let mut cursor = root;
    for part in rest.split('/').filter(|s| !s.is_empty()) {
        let Some(node) = cursor.get_mut(part) else {
            return;
        };
        node.case_count += delta;
        cursor = &mut node.children;
    }
}

#[derive(Default)]
struct WikiTreeAcc {
    name: String,
    directory_path: String,
    path_from_root: Vec<String>,
    is_project: bool,
    case_count: i64,
    children: BTreeMap<String, WikiTreeAcc>,
}

fn acc_to_nodes(map: BTreeMap<String, WikiTreeAcc>) -> Vec<models::RepositoryTreeNode> {
    map.into_values()
        .map(|n| models::RepositoryTreeNode {
            type_: "folder".to_string(),
            name: n.name,
            display_name: n.path_from_root.last().cloned().unwrap_or_default(),
            children: Some(acc_to_nodes(n.children)),
            directory_path: Some(n.directory_path),
            path_from_root: Some(n.path_from_root),
            is_project: n.is_project,
            case_count: n.case_count,
        })
        .collect()
}

/// Nested folder nodes (disk dirs ∪ SQLite parents) with descendant page counts.
pub(crate) fn list_wiki_tree(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
    archive_mode: bool,
) -> Result<Vec<models::RepositoryTreeNode>> {
    let (scan_root_rel, strip_prefix, path_like) = if archive_mode {
        (
            WIKI_ARCHIVE_ROOT,
            WIKI_ARCHIVE_PREFIX,
            format!("{WIKI_ARCHIVE_PREFIX}%"),
        )
    } else {
        (WIKI_ROOT_REL, WIKI_PREFIX, format!("{WIKI_PREFIX}%"))
    };

    let mut folder_paths: HashSet<String> = HashSet::new();
    let scan_root = repo_path.join(scan_root_rel);
    if scan_root.is_dir() {
        collect_disk_wiki_folders(&scan_root, scan_root_rel, &mut folder_paths);
    }

    let mut page_folders: Vec<String> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT file_path, folder FROM wiki_pages WHERE repo_slug = ?1 AND file_path LIKE ?2",
        )?;
        let rows = stmt.query_map(params![repo_slug, path_like], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for (file_path, folder) in rows.flatten() {
            if archive_mode {
                if !is_archived_wiki_path(&file_path) {
                    continue;
                }
            } else if is_archived_wiki_path(&file_path) {
                continue;
            }
            if folder.is_empty() {
                continue;
            }
            // Folder column is relative to `.gitoza/wiki/` (may start with `.archive/`).
            let folder_full = format!("{WIKI_PREFIX}{folder}");
            if archive_mode && !folder_full.starts_with(WIKI_ARCHIVE_PREFIX) {
                continue;
            }
            if !archive_mode && folder.starts_with(WIKI_RESERVED_DIR) {
                continue;
            }
            let mut acc = String::new();
            let rel = if archive_mode {
                folder
                    .strip_prefix(&format!("{WIKI_RESERVED_DIR}/"))
                    .or_else(|| {
                        if folder == WIKI_RESERVED_DIR {
                            Some("")
                        } else {
                            None
                        }
                    })
                    .unwrap_or(folder.as_str())
            } else {
                folder.as_str()
            };
            if rel.is_empty() {
                continue;
            }
            for part in rel.split('/').filter(|s| !s.is_empty()) {
                if acc.is_empty() {
                    acc = format!("{scan_root_rel}/{part}");
                } else {
                    acc = format!("{acc}/{part}");
                }
                folder_paths.insert(acc.clone());
            }
            page_folders.push(format!("{scan_root_rel}/{rel}"));
            let _ = file_path;
        }
    }

    let mut roots: BTreeMap<String, WikiTreeAcc> = BTreeMap::new();
    let mut sorted_folders: Vec<String> = folder_paths.into_iter().collect();
    sorted_folders.sort();
    for fp in &sorted_folders {
        insert_tree_folder(&mut roots, fp, strip_prefix, scan_root_rel);
    }
    for fp in page_folders {
        add_count(&mut roots, &fp, strip_prefix, 1);
    }

    Ok(acc_to_nodes(roots))
}

pub(crate) fn allocate_unique_wiki_folder_name(parent_dir: &Path, name: &str) -> Result<String> {
    let mut base = slugify_wiki_name(name);
    if base.is_empty() || !is_valid_project_name(&base) {
        base = "folder".to_string();
    }
    if is_forbidden_wiki_folder_name(&base) {
        anyhow::bail!("Invalid wiki folder name.");
    }
    let mut stem = base.clone();
    let mut n = 2u32;
    loop {
        let candidate = parent_dir.join(&stem);
        if !candidate.exists() {
            return Ok(stem);
        }
        stem = format!("{base}-{n}");
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        p.push(format!("gitoza_wiki_test_{prefix}_{t}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn validate_nested_and_root_wiki_paths() {
        assert!(validate_wiki_file_path_for_write(".gitoza/wiki/intro.md").is_ok());
        assert!(validate_wiki_file_path_for_write(".gitoza/wiki/arch/data/model.md").is_ok());
        assert!(validate_wiki_file_path_for_write(".gitoza/wiki/.archive/x.md").is_err());
        assert!(validate_wiki_archived_file_path_for_write(".gitoza/wiki/.archive/x.md").is_ok());
        assert!(validate_wiki_file_path_for_read(".gitoza/wiki/.archive/x.md").is_ok());
        assert!(validate_wiki_file_path_for_write(".gitoza/wiki/arch/../x.md").is_err());
        assert!(validate_wiki_file_path_for_write(".gitoza/tasks/tickets/a/b.md").is_err());
        assert_eq!(
            wiki_folder_from_path(".gitoza/wiki/arch/data/model.md").as_deref(),
            Some("arch/data")
        );
        assert_eq!(
            wiki_folder_from_path(".gitoza/wiki/intro.md").as_deref(),
            Some("")
        );
        assert!(validate_wiki_folder_path(".gitoza/wiki").is_ok());
        assert!(validate_wiki_folder_path(".gitoza/wiki/arch/data").is_ok());
        assert!(validate_wiki_folder_path(".gitoza/wiki/.archive").is_err());
    }

    #[test]
    fn is_wiki_yaml_path_skips_dotfiles() {
        assert!(is_wiki_yaml_path(".gitoza/wiki/demo/page.md"));
        assert!(!is_wiki_yaml_path(".gitoza/wiki/demo/.gitkeep"));
        assert!(!is_wiki_yaml_path(".gitoza/tasks/tickets/demo/T-1.md"));
    }

    #[test]
    fn index_create_and_nested_tree() {
        let repo = temp_dir("index_nested");
        let nested = repo.join(".gitoza/wiki/architecture/data");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("model.md"),
            "---\ntitle: Data model\ntags: [arch]\n---\nBody\n",
        )
        .unwrap();
        fs::write(
            repo.join(".gitoza/wiki/intro.md"),
            "---\ntitle: Intro\n---\nHi\n",
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_wiki_schema(&conn).unwrap();
        let n = reindex_wiki_for_repo(&conn, &repo, "repo").unwrap();
        assert_eq!(n, 2);

        let tree = list_wiki_tree(&conn, &repo, "repo", false).unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "architecture");
        assert!(!tree[0].is_project, "wiki folders are never projects");
        assert_eq!(tree[0].case_count, 1);
        let children = tree[0].children.clone().unwrap_or_default();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].name, "data");
        assert!(!children[0].is_project);
        assert_eq!(
            children[0].directory_path.as_deref(),
            Some(".gitoza/wiki/architecture/data")
        );

        let (items, total) = query_wiki_pages_db(
            &conn,
            "repo",
            QueryWikiPagesArgs {
                search: None,
                tag: None,
                status: None,
                folder: Some("architecture".to_string()),
                page_id: None,
                sort_by: "title".to_string(),
                sort_dir: "asc".to_string(),
                limit: 50,
                offset: 0,
                exclude_archived: false,
                archived_only: false,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert!(is_allocated_wiki_id(&items[0].page_id));
        assert_eq!(items[0].title.as_deref(), Some("Data model"));
        assert!(items[0]
            .file_path
            .ends_with(&format!("{}.md", items[0].page_id)));
        assert!(!repo
            .join(".gitoza/wiki/architecture/data/model.md")
            .exists());

        apply_incremental_wiki_changes(
            &conn,
            &repo,
            "repo",
            &[items[0].file_path.clone()],
            &crate::AuditStampSource::CommitMeta(HashMap::new()),
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM wiki_pages WHERE repo_slug = ?",
                params!["repo"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn generate_unique_wiki_id_and_create_uses_allocated_id() {
        let repo = temp_dir("wiki_alloc");
        fs::create_dir_all(repo.join(".gitoza/wiki")).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_wiki_schema(&conn).unwrap();

        let id1 = generate_unique_wiki_id(&conn, "repo", &repo).unwrap();
        assert!(is_allocated_wiki_id(&id1));
        fs::write(
            repo.join(format!(".gitoza/wiki/{id1}.md")),
            "---\ntitle: A\n---\n",
        )
        .unwrap();
        upsert_wiki_page_db(
            &conn,
            UpsertWikiPageArgs {
                page_id: id1.clone(),
                title: Some("A".to_string()),
                tags: vec![],
                status: None,
                folder: String::new(),
                file_path: format!(".gitoza/wiki/{id1}.md"),
                repo_slug: "repo".to_string(),
                updated_at: None,
                updated_by: None,
            },
        )
        .unwrap();

        let id2 = generate_unique_wiki_id(&conn, "repo", &repo).unwrap();
        assert_ne!(id1, id2);
        assert!(is_allocated_wiki_id(&id2));
        assert!(!is_allocated_wiki_id("overview"));
        assert!(!is_allocated_wiki_id("W-abc"));
        assert!(!is_allocated_wiki_id("W-ABCDEFG"));
    }

    #[test]
    fn migrate_legacy_renames_slug_and_preserves_title() {
        let repo = temp_dir("wiki_migrate");
        let nested = repo.join(".gitoza/wiki/docs");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("legacy-page.md"),
            "---\ntitle: Legacy Title\ntags: [a]\n---\nBody\n",
        )
        .unwrap();
        let other = repo.join(".gitoza/wiki/other");
        fs::create_dir_all(&other).unwrap();
        fs::write(
            other.join("legacy-page.md"),
            "---\ntitle: Other Legacy\n---\n",
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_wiki_schema(&conn).unwrap();
        let n = reindex_wiki_for_repo(&conn, &repo, "repo").unwrap();
        assert_eq!(n, 2);
        assert!(!nested.join("legacy-page.md").exists());
        assert!(!other.join("legacy-page.md").exists());

        let (items, total) = query_wiki_pages_db(
            &conn,
            "repo",
            QueryWikiPagesArgs {
                search: None,
                tag: None,
                status: None,
                folder: None,
                page_id: None,
                sort_by: "title".to_string(),
                sort_dir: "asc".to_string(),
                limit: 50,
                offset: 0,
                exclude_archived: false,
                archived_only: false,
            },
        )
        .unwrap();
        assert_eq!(total, 2);
        for item in &items {
            assert!(is_allocated_wiki_id(&item.page_id));
        }
        let titles: HashSet<_> = items.iter().filter_map(|i| i.title.clone()).collect();
        assert!(titles.contains("Legacy Title"));
        assert!(titles.contains("Other Legacy"));

        // Idempotent second reindex
        let n2 = reindex_wiki_for_repo(&conn, &repo, "repo").unwrap();
        assert_eq!(n2, 2);
        let ids: HashSet<_> = items.iter().map(|i| i.page_id.clone()).collect();
        let (items2, _) = query_wiki_pages_db(
            &conn,
            "repo",
            QueryWikiPagesArgs {
                search: None,
                tag: None,
                status: None,
                folder: None,
                page_id: None,
                sort_by: "title".to_string(),
                sort_dir: "asc".to_string(),
                limit: 50,
                offset: 0,
                exclude_archived: false,
                archived_only: false,
            },
        )
        .unwrap();
        let ids2: HashSet<_> = items2.iter().map(|i| i.page_id.clone()).collect();
        assert_eq!(ids, ids2);
    }

    #[test]
    fn query_wiki_pages_exact_page_id() {
        let repo = temp_dir("wiki_page_id_q");
        fs::create_dir_all(repo.join(".gitoza/wiki")).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_wiki_schema(&conn).unwrap();
        upsert_wiki_page_db(
            &conn,
            UpsertWikiPageArgs {
                page_id: "W-ABC123".to_string(),
                title: Some("Hit".to_string()),
                tags: vec![],
                status: None,
                folder: String::new(),
                file_path: ".gitoza/wiki/W-ABC123.md".to_string(),
                repo_slug: "repo".to_string(),
                updated_at: None,
                updated_by: None,
            },
        )
        .unwrap();
        let (items, total) = query_wiki_pages_db(
            &conn,
            "repo",
            QueryWikiPagesArgs {
                search: None,
                tag: None,
                status: None,
                folder: None,
                page_id: Some("W-ABC123".to_string()),
                sort_by: "title".to_string(),
                sort_dir: "asc".to_string(),
                limit: 10,
                offset: 0,
                exclude_archived: false,
                archived_only: false,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].title.as_deref(), Some("Hit"));
        let (_, miss) = query_wiki_pages_db(
            &conn,
            "repo",
            QueryWikiPagesArgs {
                search: None,
                tag: None,
                status: None,
                folder: None,
                page_id: Some("W-MISSING".to_string()),
                sort_by: "title".to_string(),
                sort_dir: "asc".to_string(),
                limit: 10,
                offset: 0,
                exclude_archived: false,
                archived_only: false,
            },
        )
        .unwrap();
        assert_eq!(miss, 0);
        let _ = fs::remove_dir_all(&repo);
    }
    #[test]
    fn apply_wiki_audit_from_db_overlays_sqlite() {
        let repo = temp_dir("wiki_audit");
        let rel = ".gitoza/wiki/docs/page.md";
        let abs = repo.join(rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        fs::write(&abs, "---\ntitle: Page\nupdated_by: YamlUser\n---\nBody\n").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_wiki_schema(&conn).unwrap();
        upsert_wiki_page_db(
            &conn,
            UpsertWikiPageArgs {
                page_id: "page".to_string(),
                title: Some("Page".to_string()),
                tags: vec![],
                status: None,
                folder: "docs".to_string(),
                file_path: rel.to_string(),
                repo_slug: "repo".to_string(),
                updated_at: Some("2024-06-01T12:00:00Z".to_string()),
                updated_by: Some("DbUser".to_string()),
            },
        )
        .unwrap();

        let mut detail = read_wiki_yaml(&abs).unwrap().expect("parsed");
        assert_eq!(detail.updated_by.as_deref(), Some("YamlUser"));
        apply_wiki_audit_from_db(&conn, "repo", rel, &mut detail);
        assert_eq!(detail.updated_by.as_deref(), Some("DbUser"));
        assert_eq!(detail.updated_at.as_deref(), Some("2024-06-01T12:00:00Z"));
    }

    #[test]
    fn wiki_page_stem_from_title_rejects_empty_and_invalid() {
        assert_eq!(
            wiki_page_stem_from_title("").unwrap_err(),
            "Wiki page name is required."
        );
        assert_eq!(
            wiki_page_stem_from_title("   ").unwrap_err(),
            "Wiki page name is required."
        );
        assert!(wiki_page_stem_from_title("!!!").is_err());
    }

    #[test]
    fn wiki_page_stem_from_title_slugifies_and_detects_conflict() {
        assert_eq!(
            wiki_page_stem_from_title("Data model").unwrap(),
            "Data_model"
        );
        assert_eq!(wiki_page_stem_from_title("overview").unwrap(), "overview");

        let dir = temp_dir("wiki_stem_conflict");
        fs::write(dir.join("overview.md"), "---\ntitle: overview\n---\n").unwrap();
        assert!(wiki_page_file_exists(&dir, "overview"));
        assert!(!wiki_page_file_exists(&dir, "other"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wiki_archive_path_round_trip() {
        assert_eq!(
            wiki_to_archive_path(".gitoza/wiki/arch/data/W-ABC123.md").unwrap(),
            ".gitoza/wiki/.archive/arch/data/W-ABC123.md"
        );
        assert_eq!(
            wiki_to_archive_path(".gitoza/wiki/W-ABC123.md").unwrap(),
            ".gitoza/wiki/.archive/W-ABC123.md"
        );
        assert!(wiki_to_archive_path(".gitoza/wiki/.archive/W-ABC123.md").is_err());
        assert_eq!(
            wiki_to_active_path(".gitoza/wiki/.archive/arch/data/W-ABC123.md").unwrap(),
            ".gitoza/wiki/arch/data/W-ABC123.md"
        );
        assert_eq!(
            wiki_to_active_path(".gitoza/wiki/.archive/W-ABC123.md").unwrap(),
            ".gitoza/wiki/W-ABC123.md"
        );
        assert!(wiki_to_active_path(".gitoza/wiki/W-ABC123.md").is_err());
    }

    #[test]
    fn query_wiki_pages_excludes_and_includes_archived() {
        let conn = Connection::open_in_memory().unwrap();
        init_wiki_schema(&conn).unwrap();
        upsert_wiki_page_db(
            &conn,
            UpsertWikiPageArgs {
                page_id: "W-ACT001".to_string(),
                title: Some("Active".to_string()),
                tags: vec![],
                status: None,
                folder: String::new(),
                file_path: ".gitoza/wiki/W-ACT001.md".to_string(),
                repo_slug: "repo".to_string(),
                updated_at: None,
                updated_by: None,
            },
        )
        .unwrap();
        upsert_wiki_page_db(
            &conn,
            UpsertWikiPageArgs {
                page_id: "W-ARC001".to_string(),
                title: Some("Archived".to_string()),
                tags: vec![],
                status: None,
                folder: ".archive".to_string(),
                file_path: ".gitoza/wiki/.archive/W-ARC001.md".to_string(),
                repo_slug: "repo".to_string(),
                updated_at: None,
                updated_by: None,
            },
        )
        .unwrap();

        let (_, total_active) = query_wiki_pages_db(
            &conn,
            "repo",
            QueryWikiPagesArgs {
                search: None,
                tag: None,
                status: None,
                folder: None,
                page_id: None,
                sort_by: "title".to_string(),
                sort_dir: "asc".to_string(),
                limit: 50,
                offset: 0,
                exclude_archived: true,
                archived_only: false,
            },
        )
        .unwrap();
        assert_eq!(total_active, 1);

        let (archived, total_arch) = query_wiki_pages_db(
            &conn,
            "repo",
            QueryWikiPagesArgs {
                search: None,
                tag: None,
                status: None,
                folder: None,
                page_id: None,
                sort_by: "title".to_string(),
                sort_dir: "asc".to_string(),
                limit: 50,
                offset: 0,
                exclude_archived: false,
                archived_only: true,
            },
        )
        .unwrap();
        assert_eq!(total_arch, 1);
        assert_eq!(archived[0].page_id, "W-ARC001");
    }

    #[test]
    fn list_wiki_tree_archive_mode_uses_archive_subtree() {
        let repo = temp_dir("wiki_tree_archive");
        let active_dir = repo.join(".gitoza/wiki/docs");
        let archive_dir = repo.join(".gitoza/wiki/.archive/docs");
        fs::create_dir_all(&active_dir).unwrap();
        fs::create_dir_all(&archive_dir).unwrap();
        fs::write(
            active_dir.join("W-ACT001.md"),
            "---\ntitle: Active\n---\n",
        )
        .unwrap();
        fs::write(
            archive_dir.join("W-ARC001.md"),
            "---\ntitle: Archived\n---\n",
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_wiki_schema(&conn).unwrap();
        let n = reindex_wiki_for_repo(&conn, &repo, "repo").unwrap();
        assert_eq!(n, 2);

        let active_tree = list_wiki_tree(&conn, &repo, "repo", false).unwrap();
        assert_eq!(active_tree.len(), 1);
        assert_eq!(active_tree[0].name, "docs");
        assert_eq!(active_tree[0].case_count, 1);
        assert_eq!(
            active_tree[0].directory_path.as_deref(),
            Some(".gitoza/wiki/docs")
        );

        let archive_tree = list_wiki_tree(&conn, &repo, "repo", true).unwrap();
        assert_eq!(archive_tree.len(), 1);
        assert_eq!(archive_tree[0].name, "docs");
        assert_eq!(archive_tree[0].case_count, 1);
        assert_eq!(
            archive_tree[0].directory_path.as_deref(),
            Some(".gitoza/wiki/.archive/docs")
        );
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn remap_wiki_file_path_updates_folder_keeps_page_id() {
        let conn = Connection::open_in_memory().unwrap();
        init_wiki_schema(&conn).unwrap();
        upsert_wiki_page_db(
            &conn,
            UpsertWikiPageArgs {
                page_id: "W-MOV001".to_string(),
                title: Some("Move me".to_string()),
                tags: vec![],
                status: None,
                folder: "a".to_string(),
                file_path: ".gitoza/wiki/a/W-MOV001.md".to_string(),
                repo_slug: "repo".to_string(),
                updated_at: None,
                updated_by: None,
            },
        )
        .unwrap();
        let n = remap_wiki_file_path(
            &conn,
            "repo",
            ".gitoza/wiki/a/W-MOV001.md",
            ".gitoza/wiki/b/W-MOV001.md",
        )
        .unwrap();
        assert_eq!(n, 1);
        let (items, _) = query_wiki_pages_db(
            &conn,
            "repo",
            QueryWikiPagesArgs {
                search: None,
                tag: None,
                status: None,
                folder: None,
                page_id: Some("W-MOV001".to_string()),
                sort_by: "title".to_string(),
                sort_dir: "asc".to_string(),
                limit: 10,
                offset: 0,
                exclude_archived: false,
                archived_only: false,
            },
        )
        .unwrap();
        assert_eq!(items[0].page_id, "W-MOV001");
        assert_eq!(items[0].folder, "b");
        assert_eq!(items[0].file_path, ".gitoza/wiki/b/W-MOV001.md");
    }

    #[test]
    fn archive_and_restore_preserves_title_body_page_id() {
        let repo = temp_dir("wiki_archive_restore");
        let nested = repo.join(".gitoza/wiki/docs");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("W-ARC999.md"),
            "---\ntitle: Keep me\ntags: [docs]\n---\nHello body\n",
        )
        .unwrap();
        let archived =
            archive_wiki_page_on_disk(&repo, ".gitoza/wiki/docs/W-ARC999.md", "cleanup").unwrap();
        assert_eq!(archived, ".gitoza/wiki/.archive/docs/W-ARC999.md");
        assert!(!nested.join("W-ARC999.md").exists());
        let archived_abs = repo.join(&archived);
        assert!(archived_abs.is_file());
        let raw = fs::read_to_string(&archived_abs).unwrap();
        assert!(raw.contains("archived_at:"));
        assert!(raw.contains("Keep me"));
        assert!(raw.contains("Hello body"));

        let restored = restore_wiki_page_on_disk(&repo, &archived).unwrap();
        assert_eq!(restored, ".gitoza/wiki/docs/W-ARC999.md");
        let restored_raw = fs::read_to_string(repo.join(&restored)).unwrap();
        assert!(!restored_raw.contains("archived_at:"));
        assert!(restored_raw.contains("Keep me"));
        assert!(restored_raw.contains("Hello body"));
        let _ = fs::remove_dir_all(&repo);
    }

    fn mkdir_gitkeep(repo: &Path, rel: &str) {
        let dir = repo.join(rel);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(GITKEEP_FILE), b"").unwrap();
    }

    fn exists(repo: &Path, rel: &str) -> bool {
        repo.join(rel).exists()
    }

    #[test]
    fn archive_page_does_not_remove_sibling_empty_folder() {
        let repo = temp_dir("wiki_archive_keeps_empty");
        mkdir_gitkeep(&repo, ".gitoza/wiki/empty");
        fs::write(
            repo.join(".gitoza/wiki/W-ARC001.md"),
            "---\ntitle: Root page\n---\nBody\n",
        )
        .unwrap();

        archive_wiki_page_on_disk(&repo, ".gitoza/wiki/W-ARC001.md", "").unwrap();
        prune_empty_wiki_dirs_upward(&repo, WIKI_ROOT_REL);

        assert!(exists(&repo, ".gitoza/wiki/empty"));
        assert!(exists(&repo, ".gitoza/wiki/empty/.gitkeep"));
        assert!(!exists(&repo, ".gitoza/wiki/W-ARC001.md"));
        assert!(exists(&repo, ".gitoza/wiki/.archive/W-ARC001.md"));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn prune_keeps_sibling_gitkeep_folder_at_wiki_root() {
        let repo = temp_dir("wiki_prune_root_gitkeep");
        mkdir_gitkeep(&repo, ".gitoza/wiki/empty");
        let page = ".gitoza/wiki/W-KEEP01.md";
        fs::write(repo.join(page), "---\ntitle: Root page\n---\nBody\n").unwrap();
        fs::remove_file(repo.join(page)).unwrap();

        prune_empty_wiki_dirs_upward(&repo, WIKI_ROOT_REL);

        assert!(exists(&repo, ".gitoza/wiki/empty"));
        assert!(exists(&repo, ".gitoza/wiki/empty/.gitkeep"));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn prune_keeps_sibling_gitkeep_folder_under_same_parent() {
        let repo = temp_dir("wiki_prune_sibling_gitkeep");
        mkdir_gitkeep(&repo, ".gitoza/wiki/guides/empty");
        let page = ".gitoza/wiki/guides/W-KEEP02.md";
        fs::create_dir_all(repo.join(".gitoza/wiki/guides")).unwrap();
        fs::write(repo.join(page), "---\ntitle: Guides page\n---\nBody\n").unwrap();
        fs::remove_file(repo.join(page)).unwrap();

        prune_empty_wiki_dirs_upward(&repo, ".gitoza/wiki/guides");

        assert!(exists(&repo, ".gitoza/wiki/guides/empty"));
        assert!(exists(&repo, ".gitoza/wiki/guides/empty/.gitkeep"));
        assert!(exists(&repo, ".gitoza/wiki/guides"));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn prune_keeps_gitkeep_folder_after_last_page_archived() {
        let repo = temp_dir("wiki_prune_keep_source_folder");
        mkdir_gitkeep(&repo, ".gitoza/wiki/docs");
        let page = ".gitoza/wiki/docs/W-KEEP03.md";
        fs::write(repo.join(page), "---\ntitle: Docs page\n---\nBody\n").unwrap();
        fs::remove_file(repo.join(page)).unwrap();

        prune_empty_wiki_dirs_upward(&repo, ".gitoza/wiki/docs");

        assert!(exists(&repo, ".gitoza/wiki/docs"));
        assert!(exists(&repo, ".gitoza/wiki/docs/.gitkeep"));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn prune_keeps_truly_empty_dirs_and_writes_gitkeep() {
        let repo = temp_dir("wiki_prune_truly_empty");
        fs::create_dir_all(repo.join(".gitoza/wiki/leftover")).unwrap();

        prune_empty_wiki_dirs_upward(&repo, ".gitoza/wiki/leftover");

        assert!(exists(&repo, ".gitoza/wiki/leftover"));
        assert!(exists(&repo, ".gitoza/wiki/leftover/.gitkeep"));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn prune_does_not_remove_sibling_empty_dir_without_gitkeep() {
        let repo = temp_dir("wiki_prune_sibling_no_gitkeep");
        fs::create_dir_all(repo.join(".gitoza/wiki/empty")).unwrap();
        fs::write(
            repo.join(".gitoza/wiki/W-KEEP04.md"),
            "---\ntitle: Root page\n---\nBody\n",
        )
        .unwrap();
        fs::remove_file(repo.join(".gitoza/wiki/W-KEEP04.md")).unwrap();

        prune_empty_wiki_dirs_upward(&repo, WIKI_ROOT_REL);

        assert!(exists(&repo, ".gitoza/wiki/empty"));
        let _ = fs::remove_dir_all(&repo);
    }
}
