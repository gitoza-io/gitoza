use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::Write,
    path::{Path, PathBuf},
    sync::{atomic::AtomicUsize, Arc, Mutex},
};

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use indexmap::IndexMap;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod asset_store;
pub mod asset_sync;
pub mod automation_cache;
pub mod automation_index;
pub mod automation_paths;
pub mod automation_remote;
pub mod case_breakdown;
pub(crate) mod case_ids;
pub(crate) mod clone_service;
pub mod error;
pub(crate) mod file_truth_framework;
pub mod ipc_api;
pub mod junit_parser;
pub mod local_sync_paths;
pub mod markdown_pdf;
pub mod models;
pub mod paths;
pub mod pdf_export;
pub mod pending_assets;
pub mod pending_run_yaml;
pub(crate) mod playground_service;
pub mod project_config;
pub mod project_sync_config;
pub(crate) mod repo_config;
pub mod repository_tree;
pub(crate) mod requirement_ids;
pub mod run_breakdown;
pub mod run_folder_tree;
pub(crate) mod run_publish;
pub mod s3_broker;
pub(crate) mod ssh_key;
pub(crate) mod sync_engine_adapter;
pub mod sync_secrets;
pub(crate) mod ticket_releases;
pub(crate) mod tickets;
pub mod typst_markdown_assets;
pub(crate) mod wiki;
pub(crate) mod workspace;

pub use error::ApiError;
pub use paths::default_config_dir;

// Low-level Git CLI layer lives in `sync-git`; re-export so existing call sites keep compiling.
pub use sync_git::process as git_process;
pub use sync_git::ssh_silent;
pub(crate) use sync_git::run::{
    git_run, git_run_network_timeout, git_stdout, git_stdout_blocking,
};

// Sync workflow (publish / recover / conflicts) lives in `sync-engine`.
pub use sync_engine::conflict as conflict_classification;
pub use sync_engine::modify_delete as modify_delete_resolution;
pub use sync_engine::{
    abort_rebase_impl, is_rebase_in_progress, is_safe_repo_relative_path, push_fail_reason,
};

pub(crate) const INCREMENTAL_THRESHOLD: usize = 200;
#[derive(Clone)]
pub struct AppState {
    pub config_dir: PathBuf,
    // Simple per-repo connection cache; ok for a base version.
    pub(crate) dbs: Arc<Mutex<BTreeMap<String, Arc<Mutex<Connection>>>>>,
    pub ws_tx: tokio::sync::broadcast::Sender<String>,
    pub active_ws_clients: Arc<AtomicUsize>,
    pub(crate) git_op_locks: Arc<Mutex<BTreeMap<String, Arc<tokio::sync::Mutex<()>>>>>,
    pub(crate) asset_op_locks: Arc<Mutex<BTreeMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

/// Cheap clone for background asset tasks (shared Arc internals).
pub fn clone_app_state(state: &AppState) -> AppState {
    AppState {
        config_dir: state.config_dir.clone(),
        dbs: state.dbs.clone(),
        ws_tx: state.ws_tx.clone(),
        active_ws_clients: state.active_ws_clients.clone(),
        git_op_locks: state.git_op_locks.clone(),
        asset_op_locks: state.asset_op_locks.clone(),
    }
}

pub fn new_state(config_dir: PathBuf) -> AppState {
    let (tx, _rx) = tokio::sync::broadcast::channel(256);
    AppState {
        config_dir,
        dbs: Arc::new(Mutex::new(BTreeMap::new())),
        ws_tx: tx,
        active_ws_clients: Arc::new(AtomicUsize::new(0)),
        git_op_locks: Arc::new(Mutex::new(BTreeMap::new())),
        asset_op_locks: Arc::new(Mutex::new(BTreeMap::new())),
    }
}

pub async fn broadcast_refresh(state: &AppState) -> Result<()> {
    // Frontend `wsRefresh.js` parses JSON and expects `{ "type": "REFRESH_REQUIRED" }`.
    let _ = state
        .ws_tx
        .send(r#"{"type":"REFRESH_REQUIRED"}"#.to_string());
    Ok(())
}

pub(crate) async fn mark_workplace_editing_best_effort(
    _state: &AppState,
    _slug: &str,
    _repo_path: &Path,
) {
    // No-op: UI mode is derived from git status + confirm workflow step.
}

// ---------------------------------------------------------------------------
// Contract stubs for endpoints that are not fully ported yet.
// ---------------------------------------------------------------------------
pub(crate) const CASES_PREFIX: &str = ".gitoza/test/cases/";
pub(crate) const CASES_ARCHIVE_DIR: &str = ".archive";
pub(crate) const CASES_ARCHIVE_PREFIX: &str = ".gitoza/test/cases/.archive/";
pub(crate) const TEMPLATES_PREFIX: &str = ".gitoza/test/templates/";

/// True when the case YAML lives under `.gitoza/test/cases/.archive/`.
pub(crate) fn is_archived_file_path(file_rel: &str) -> bool {
    file_rel
        .trim()
        .replace('\\', "/")
        .starts_with(CASES_ARCHIVE_PREFIX)
}

/// Active-case filter for counts/queries in the main repository view.
pub(crate) fn active_case_path_sql_clause() -> &'static str {
    "file_path NOT LIKE '.gitoza/test/cases/.archive/%'"
}

/// Archived-case filter for archive-mode tree badges.
pub(crate) fn archived_case_path_sql_clause() -> &'static str {
    "file_path LIKE '.gitoza/test/cases/.archive/%'"
}

/// Skip dot-prefixed dirs during case YAML scan except top-level `.archive` under cases root.
pub(crate) fn should_skip_case_scan_dir(
    parent_rel: &str,
    dir_name: &str,
    ignore: &HashSet<&str>,
) -> bool {
    if ignore.contains(dir_name) {
        return true;
    }
    if !dir_name.starts_with('.') {
        return false;
    }
    !(parent_rel == ".gitoza/test/cases" && dir_name == CASES_ARCHIVE_DIR)
}

pub(crate) fn normalize_repo_rel_path(path: &str) -> String {
    path.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

/// Top-level archived project directory: `.gitoza/test/cases/.archive/{project}`.
pub(crate) fn is_archived_project_directory_path(dir_rel: &str) -> bool {
    let norm = normalize_repo_rel_path(dir_rel);
    let parts: Vec<&str> = norm.split('/').collect();
    parts.len() == 5
        && parts[0] == ".gitoza"
        && parts[1] == "test"
        && parts[2] == "cases"
        && parts[3] == CASES_ARCHIVE_DIR
}

/// Archived suite directory under an archived project (6+ path segments).
pub(crate) fn is_archived_suite_directory_path(dir_rel: &str) -> bool {
    let norm = normalize_repo_rel_path(dir_rel);
    let parts: Vec<&str> = norm.split('/').collect();
    parts.len() >= 6
        && parts[0] == ".gitoza"
        && parts[1] == "test"
        && parts[2] == "cases"
        && parts[3] == CASES_ARCHIVE_DIR
}

/// Map an active case path to its archived counterpart under `.archive/`.
pub(crate) fn to_archive_path(active_rel: &str) -> Result<String, String> {
    let norm = active_rel.trim().replace('\\', "/");
    if !norm.starts_with(CASES_PREFIX) || norm == CASES_PREFIX.trim_end_matches('/') {
        return Err("Case must be under .gitoza/test/cases/".to_string());
    }
    if is_archived_file_path(&norm) {
        return Err("Case is already archived".to_string());
    }
    let after = &norm[CASES_PREFIX.len()..];
    Ok(format!(
        "{}/.archive/{}",
        CASES_PREFIX.trim_end_matches('/'),
        after
    ))
}

/// Map an archived case path back to its active location.
pub(crate) fn to_active_path(archived_rel: &str) -> Result<String, String> {
    let norm = archived_rel.trim().replace('\\', "/");
    if !is_archived_file_path(&norm) {
        return Err("Case is not under .archive/".to_string());
    }
    let after = &norm[CASES_ARCHIVE_PREFIX.len()..];
    if after.is_empty() {
        return Err("Invalid archived case path".to_string());
    }
    Ok(format!("{}/{}", CASES_PREFIX.trim_end_matches('/'), after))
}

/// Single `.md` file directly under `.gitoza/test/templates/` (same path hygiene as cases).
pub(crate) fn validate_template_file_path(file_path: &str) -> Result<String, String> {
    let file_path = file_path.trim_start_matches('/').trim().replace('\\', "/");
    if file_path.is_empty() || file_path.contains("..") || file_path.starts_with('/') {
        return Err("Invalid file_path".to_string());
    }
    if !file_path.starts_with(TEMPLATES_PREFIX)
        || file_path == TEMPLATES_PREFIX.trim_end_matches('/')
    {
        return Err("Template must be under .gitoza/test/templates/".to_string());
    }
    let rest = &file_path[TEMPLATES_PREFIX.len()..];
    if rest.is_empty() || rest.contains('/') {
        return Err("Template must be a single file under .gitoza/test/templates/".to_string());
    }
    if !rest.to_ascii_lowercase().ends_with(".md") {
        return Err("Template file must be .md".to_string());
    }
    Ok(file_path)
}

/// Same rules as `delete_case` / `approve_case_yaml`: relative path under `.gitoza/test/cases/`.
pub(crate) fn validate_case_file_path_for_write(file_path: &str) -> Result<String, String> {
    let file_path = file_path.trim_start_matches('/').trim().replace('\\', "/");
    if file_path.is_empty() || file_path.contains("..") || file_path.starts_with('/') {
        return Err("Invalid file_path".to_string());
    }
    if !file_path.starts_with(CASES_PREFIX) || file_path == CASES_PREFIX.trim_end_matches('/') {
        return Err("Case must be under .gitoza/test/cases/".to_string());
    }
    let name = Path::new(&file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if !crate::paths::has_workspace_doc_ext(name) {
        return Err("Case file must be .md".to_string());
    }
    Ok(file_path)
}

/// Atomically replace `path` contents (temp file in same directory, fsync, rename).
pub(crate) fn atomic_write_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file_name = path.file_name().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no file name")
    })?;
    let tmp = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(
            ".{}.tmp.{}",
            file_name.to_string_lossy(),
            Uuid::new_v4()
        ));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    #[cfg(windows)]
    {
        let _ = std::fs::remove_file(path);
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub(crate) fn is_valid_case_id(case_id: &str) -> bool {
    let s = case_id.trim();
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn repo_git_lock(state: &AppState, slug: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut guard = state.git_op_locks.lock().unwrap();
    guard
        .entry(slug.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// Serializes git commands and working-tree mutations per repo. [`read_repo_status`] and
/// confirm/fetch/push paths share [`repo_git_lock`] to avoid `index.lock` races.
#[allow(dead_code)] // Reserved for parity with HTTP layer; IPC uses `repo_git_lock` directly.
pub(crate) fn repo_write_lock(state: &AppState, slug: &str) -> Arc<tokio::sync::Mutex<()>> {
    repo_git_lock(state, slug)
}

pub(crate) fn is_safe_repo_slug(s: &str) -> bool {
    let s = s.trim();
    !s.is_empty()
        && !s.contains("..")
        && !s.contains('/')
        && !s.contains('\\')
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// After removing a workspace: drop `config.json` or point it at another repo if the default was deleted or stale.
pub(crate) fn refresh_config_after_repo_removed(
    config_dir: &Path,
    removed_slug: &str,
) -> Result<()> {
    let cfg_file = config_dir.join(repo_config::CONFIG_FILE);
    let repos_dir = config_dir.join(repo_config::REPOS_DIR);

    let mut remaining: Vec<PathBuf> = Vec::new();
    if repos_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&repos_dir) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() && p.join(".git").is_dir() {
                    remaining.push(p);
                }
            }
        }
    }
    remaining.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    let mut must_update = false;
    if cfg_file.is_file() {
        if let Ok(raw) = std::fs::read_to_string(&cfg_file) {
            if let Ok(parsed) = serde_json::from_str::<repo_config::StoredConfig>(&raw) {
                let rp = PathBuf::from(&parsed.repo_path);
                let matches_removed = rp
                    .file_name()
                    .map(|n| n.to_string_lossy() == removed_slug)
                    .unwrap_or(false);
                if matches_removed || !rp.exists() {
                    must_update = true;
                }
            } else {
                must_update = true;
            }
        }
    }

    if !must_update {
        return Ok(());
    }

    if remaining.is_empty() {
        let _ = std::fs::remove_file(&cfg_file);
        return Ok(());
    }

    let next = &remaining[0];
    // No persisted per-repo remote metadata; use a placeholder when repointing config.
    let remote_url = "https://unknown.invalid/local".to_string();
    let branch = crate::paths::GITOZA_WORK_BRANCH;
    let use_ssh = remote_url.trim().starts_with("git@");
    repo_config::save_config(
        config_dir,
        next,
        remote_url.as_str(),
        branch,
        false,
        if use_ssh { "ssh" } else { "https" },
    )
}

pub(crate) fn is_valid_project_name(name: &str) -> bool {
    let s = name.trim();
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub(crate) fn reindex_cases_for_repo(state: &AppState, slug: &str, repo_path: &Path) -> Result<()> {
    let conn_arc = open_repo_db(state, slug)?;
    let conn = conn_arc.lock().unwrap();
    conn.execute("DELETE FROM test_cases WHERE repo_slug = ?", [slug])?;
    let _ = index_cases_from_yaml(&conn, repo_path, slug)?;
    Ok(())
}

/// Update indexed `file_path` values when a folder is renamed (suite/project subtree).
pub(crate) fn remap_case_index_paths_by_prefix(
    conn: &Connection,
    slug: &str,
    old_path: &str,
    new_path: &str,
) -> Result<u64> {
    let old_norm = old_path.trim_end_matches('/').replace('\\', "/");
    let new_norm = new_path.trim_end_matches('/').replace('\\', "/");
    if old_norm.is_empty() || new_norm.is_empty() || old_norm == new_norm {
        return Ok(0);
    }

    let like_prefix = format!("{old_norm}/%");
    let mut stmt = conn.prepare(
        "SELECT file_path FROM test_cases WHERE repo_slug = ?1 AND (file_path = ?2 OR file_path LIKE ?3)",
    )?;
    let rows: Vec<String> = stmt
        .query_map(params![slug, old_norm, like_prefix], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut updated = 0u64;
    for old_fp in rows {
        let suffix = if old_fp == old_norm {
            String::new()
        } else if let Some(rest) = old_fp.strip_prefix(&format!("{old_norm}/")) {
            format!("/{rest}")
        } else {
            continue;
        };
        let new_fp = format!("{new_norm}{suffix}");
        let changed = conn.execute(
            "UPDATE test_cases SET file_path = ?1 WHERE repo_slug = ?2 AND file_path = ?3",
            params![new_fp, slug, old_fp],
        )?;
        updated += changed as u64;
    }
    Ok(updated)
}

/// Update indexed `file_path` and `case_id` when a single case file is renamed in place.
pub(crate) fn remap_case_file_path(
    conn: &Connection,
    slug: &str,
    old_path: &str,
    new_path: &str,
    new_case_id: &str,
) -> Result<u64> {
    let old_norm = old_path.trim().replace('\\', "/");
    let new_norm = new_path.trim().replace('\\', "/");
    if old_norm.is_empty() || new_norm.is_empty() || old_norm == new_norm {
        return Ok(0);
    }
    let changed = conn.execute(
        "UPDATE test_cases SET file_path = ?1, case_id = ?2 WHERE repo_slug = ?3 AND file_path = ?4",
        params![new_norm, new_case_id, slug, old_norm],
    )?;
    Ok(changed as u64)
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Axum `Query` shape; IPC uses handler parameters instead.
pub(crate) struct RunsListQuery {
    repo: Option<String>,
    include_archived: Option<bool>,
    archived_only: Option<bool>,
    search: Option<String>,
    approve_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(dead_code)]
enum OneOrMany {
    One(String),
    Many(Vec<String>),
}

#[allow(dead_code)]
impl OneOrMany {
    fn into_vec(self) -> Vec<String> {
        match self {
            OneOrMany::One(v) => vec![v],
            OneOrMany::Many(vs) => vs,
        }
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct RemoveRunCasesQuery {
    repo: Option<String>,
    file_paths: Option<OneOrMany>,
    #[serde(rename = "file_paths[]")]
    file_paths_bracket: Option<OneOrMany>,
}

// ---------------------------------------------------------------------------
// Config / Repo discovery (compatible with Python backend paths)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct RepoQuery {
    repo: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct ClearPendingQuery {
    repo: Option<String>,
    /// When true, run `git reset` before clearing the snapshot so staging from capture is dropped.
    #[serde(default)]
    unstage: bool,
}

// ---------------------------------------------------------------------------
// Repo status
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct RepoStatusQuery {
    repo: Option<String>,
    #[serde(default)]
    sync: Option<bool>,
}

/// Git fields for repo status. Caller must hold [`repo_git_lock`] for this slug.
#[derive(Debug, Clone)]
pub(crate) struct RepoGitSnapshot {
    pub branch: Option<String>,
    pub hash: Option<String>,
    pub is_dirty: bool,
    pub case_files_dirty: bool,
    pub run_files_dirty: bool,
    pub last_commit_message: Option<String>,
    pub last_commit_author: Option<String>,
    pub last_commit_date: Option<String>,
}

/// Read git porcelain/log/rev-parse. Must run under [`repo_git_lock`].
pub(crate) async fn read_repo_git_snapshot(repo_path: &Path) -> Result<RepoGitSnapshot> {
    ensure_git_repo(repo_path).await?;
    let cwd = repo_path.to_path_buf();
    let branch = git_stdout(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .ok();
    let hash = git_stdout(&cwd, &["rev-parse", "HEAD"]).await.ok();
    let is_dirty = !git_stdout(&cwd, &["status", "--porcelain"])
        .await
        .unwrap_or_default()
        .trim()
        .is_empty();

    let (last_commit_message, last_commit_author, last_commit_date) = if let Ok(out) =
        git_stdout(&cwd, &["log", "-1", "--pretty=format:%s%n%an <%ae>%n%cI"]).await
    {
        let mut lines = out.lines();
        (
            lines.next().map(|s| s.to_string()),
            lines.next().map(|s| s.to_string()),
            lines.next().map(|s| s.to_string()),
        )
    } else {
        (None, None, None)
    };

    let case_files_dirty = !git_stdout(
        &cwd,
        &["status", "--porcelain", "--", ".gitoza/test/cases/"],
    )
    .await
    .unwrap_or_default()
    .trim()
    .is_empty();
    let run_files_dirty = !git_stdout(&cwd, &["status", "--porcelain", "--", ".gitoza/test/runs/"])
        .await
        .unwrap_or_default()
        .trim()
        .is_empty();

    Ok(RepoGitSnapshot {
        branch,
        hash,
        is_dirty,
        case_files_dirty,
        run_files_dirty,
        last_commit_message,
        last_commit_author,
        last_commit_date,
    })
}

pub(crate) async fn build_repo_status_response(
    state: &AppState,
    slug: &str,
    repo_path: &Path,
    git: RepoGitSnapshot,
) -> Result<models::RepoStatusResponse> {
    let (confirm_step, push_failed_due_to_remote, push_failed_reason) =
        if let Ok(conn_arc) = open_repo_db(state, slug) {
            let conn = conn_arc.lock().unwrap();
            (
                get_confirm_workflow_step_db(&conn, slug),
                has_push_failed_db(&conn, slug).unwrap_or(false),
                get_push_failed_reason_db(&conn, slug).ok().flatten(),
            )
        } else {
            (None, false, None)
        };

    let run_yaml_pending = crate::pending_run_yaml::has_pending_run_yaml(state, slug);
    let workplace_mode =
        derive_workplace_mode(git.is_dirty, run_yaml_pending, confirm_step.as_deref());
    let (enable_review_system, modules) =
        crate::project_config::resolve_feature_flags_for_status(state, slug, repo_path);

    Ok(models::RepoStatusResponse {
        is_valid_repo: true,
        repo_path: repo_path.to_string_lossy().to_string(),
        current_branch: git
            .branch
            .map(|s| if s == "HEAD" { None } else { Some(s) })
            .flatten(),
        last_commit_hash: git.hash,
        last_commit_message: git.last_commit_message,
        last_commit_author: git.last_commit_author,
        last_commit_date: git.last_commit_date,
        is_dirty: git.is_dirty,
        workplace_mode,
        case_files_dirty: git.case_files_dirty,
        run_files_dirty: git.run_files_dirty,
        run_yaml_pending,
        push_failed_due_to_remote,
        push_failed_reason,
        enable_review_system,
        modules,
        workspace_kind: crate::workspace::workspace_kind_for_repo(repo_path).to_string(),
    })
}

pub(crate) async fn read_repo_status(
    state: &AppState,
    slug: &str,
    repo_path: &Path,
) -> Result<models::RepoStatusResponse> {
    let git = {
        let git_lock = repo_git_lock(state, slug);
        let _guard = git_lock.lock().await;
        read_repo_git_snapshot(repo_path).await?
    };
    build_repo_status_response(state, slug, repo_path, git).await
}

/// Inputs for unified fetch/pull gating (dirty, pending run YAML, confirm workflow).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RepoPullGate {
    pub is_dirty: bool,
    pub run_yaml_pending: bool,
    pub confirm_step: Option<String>,
}

/// Whether a background or quick sync may pull and re-index from remote.
pub(crate) fn should_pull_for_repo(gate: &RepoPullGate) -> bool {
    !gate.is_dirty && !gate.run_yaml_pending && gate.confirm_step.as_deref() != Some("rebase_done")
}

pub(crate) async fn collect_repo_pull_gate(
    state: &AppState,
    slug: &str,
    repo_path: &Path,
) -> Result<RepoPullGate> {
    let is_dirty = !git_stdout(repo_path, &["status", "--porcelain"])
        .await
        .unwrap_or_default()
        .trim()
        .is_empty();
    let confirm_step = if let Ok(conn_arc) = open_repo_db(state, slug) {
        let conn = conn_arc.lock().unwrap();
        get_confirm_workflow_step_db(&conn, slug)
    } else {
        None
    };
    let run_yaml_pending = crate::pending_run_yaml::has_pending_run_yaml(state, slug);
    Ok(RepoPullGate {
        is_dirty,
        run_yaml_pending,
        confirm_step,
    })
}

/// Fetch origin; pull and re-index when baseline allows. Returns true if a pull was applied.
pub async fn fetch_and_pull_if_allowed(
    state: &AppState,
    slug: &str,
    repo_path: &Path,
) -> Result<bool> {
    git_fetch_origin(repo_path).await?;
    let gate = collect_repo_pull_gate(state, slug, repo_path).await?;
    if !should_pull_for_repo(&gate) {
        return Ok(false);
    }
    if pull_if_behind(repo_path).await? {
        sync_index_after_pull(state, repo_path, slug).await?;
        return Ok(true);
    }
    Ok(false)
}

pub(crate) fn derive_workplace_mode(
    is_dirty: bool,
    run_yaml_pending: bool,
    confirm_step: Option<&str>,
) -> String {
    // While confirm is mid-flight, keep UI in editing to prevent stale baseline display.
    if matches!(confirm_step, Some("staged" | "committed" | "rebase_done")) {
        return "editing".to_string();
    }
    if is_dirty || run_yaml_pending {
        return "editing".to_string();
    }
    "baseline".to_string()
}

// ---------------------------------------------------------------------------
// Dashboard summary (matches FastAPI / Python index_db.get_dashboard_projects)
// ---------------------------------------------------------------------------

pub(crate) struct DashboardDbRow {
    pub(crate) directory: String,
    pub(crate) total_test_cases: i64,
    pub(crate) high_count: i64,
    pub(crate) medium_count: i64,
    pub(crate) low_count: i64,
    pub(crate) automated_count: i64,
    pub(crate) latest_modified: Option<String>,
}

pub(crate) fn project_name_from_directory(directory: &str) -> String {
    if directory.is_empty() {
        return "Root".to_string();
    }
    Path::new(directory)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| s.replace('_', " ").replace('-', " "))
        .unwrap_or_else(|| "Root".to_string())
}

pub(crate) const CASE_PROJECT_IGNORE_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".next",
    ".nuxt",
    "coverage",
];

/// First-level project dirs under `.gitoza/test/cases/` (relative paths like `.gitoza/test/cases/foo`).
pub(crate) fn discover_case_project_rel_paths(repo_path: &Path) -> Vec<String> {
    let cases_root = repo_path.join(".gitoza/test/cases");
    if !cases_root.is_dir() {
        return vec![];
    }
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&cases_root) {
        for e in entries.flatten() {
            let name = e.file_name();
            let name_s = name.to_string_lossy();
            if name_s.starts_with('.') {
                continue;
            }
            if CASE_PROJECT_IGNORE_NAMES
                .iter()
                .any(|&x| x == name_s.as_ref())
            {
                continue;
            }
            let p = e.path();
            if p.is_dir() {
                out.push(format!(".gitoza/test/cases/{}", name_s));
            }
        }
    }
    out.sort();
    out
}

pub(crate) fn dashboard_archive_projects_from_db(
    conn: &Connection,
    slug: &str,
) -> Result<Vec<DashboardDbRow>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT COALESCE(directory, '') AS directory,
               COUNT(*) AS total_test_cases,
               COALESCE(SUM(CASE WHEN lower(priority) = 'high'   THEN 1 ELSE 0 END), 0) AS high_count,
               COALESCE(SUM(CASE WHEN lower(priority) = 'medium' THEN 1 ELSE 0 END), 0) AS medium_count,
               COALESCE(SUM(CASE WHEN lower(priority) = 'low'    THEN 1 ELSE 0 END), 0) AS low_count,
               COALESCE(SUM(CASE WHEN automated = 1 THEN 1 ELSE 0 END), 0) AS automated_count,
               MAX(updated_at) AS latest_modified
        FROM test_cases
        WHERE repo_slug = ?1 AND file_path LIKE '.gitoza/test/cases/.archive/%'
        GROUP BY directory
        ORDER BY directory
        "#,
    )?;
    let rows = stmt.query_map(params![slug], |row| {
        Ok(DashboardDbRow {
            directory: row.get(0)?,
            total_test_cases: row.get(1)?,
            high_count: row.get(2)?,
            medium_count: row.get(3)?,
            low_count: row.get(4)?,
            automated_count: row.get(5)?,
            latest_modified: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub(crate) fn dashboard_projects_from_db(
    conn: &Connection,
    slug: &str,
) -> Result<Vec<DashboardDbRow>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT COALESCE(directory, '') AS directory,
               COUNT(*) AS total_test_cases,
               COALESCE(SUM(CASE WHEN lower(priority) = 'high'   THEN 1 ELSE 0 END), 0) AS high_count,
               COALESCE(SUM(CASE WHEN lower(priority) = 'medium' THEN 1 ELSE 0 END), 0) AS medium_count,
               COALESCE(SUM(CASE WHEN lower(priority) = 'low'    THEN 1 ELSE 0 END), 0) AS low_count,
               COALESCE(SUM(CASE WHEN automated = 1 THEN 1 ELSE 0 END), 0) AS automated_count,
               MAX(updated_at) AS latest_modified
        FROM test_cases
        WHERE repo_slug = ?1 AND file_path NOT LIKE '.gitoza/test/cases/.archive/%'
        GROUP BY directory
        ORDER BY directory
        "#,
    )?;
    let rows = stmt.query_map(params![slug], |row| {
        Ok(DashboardDbRow {
            directory: row.get(0)?,
            total_test_cases: row.get(1)?,
            high_count: row.get(2)?,
            medium_count: row.get(3)?,
            low_count: row.get(4)?,
            automated_count: row.get(5)?,
            latest_modified: row.get(6)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub(crate) fn build_dashboard_project_detail(
    directory: &str,
    cnt: i64,
    high: i64,
    med: i64,
    low: i64,
    automated: i64,
    latest_modified: Option<String>,
) -> models::DashboardProjectDetail {
    let mut dist = BTreeMap::new();
    dist.insert("High".to_string(), high);
    dist.insert("Medium".to_string(), med);
    dist.insert("Low".to_string(), low);
    let last = models::DashboardProjectLastActivity {
        timestamp: latest_modified,
        author: None,
    };
    models::DashboardProjectDetail {
        project_name: project_name_from_directory(directory),
        project_path: directory.to_string(),
        suite_count: cnt,
        total_test_cases: cnt,
        automated_count: automated,
        project_priority_distribution: dist.clone(),
        last_activity: last.clone(),
        test_suites: vec![],
        aggregated_priority: dist,
        latest_activity: last,
    }
}

// ---------------------------------------------------------------------------
// Cases list/detail + autosave-compatible update
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct CasesQuery {
    repo: Option<String>,
    search: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    tag: Option<String>,
    directory: Option<String>,
    directories: Option<String>,
    approve_status: Option<String>,
    include_archived: Option<bool>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct CaseTemplateContentQuery {
    repo: Option<String>,
    file_path: String,
}

// ---------------------------------------------------------------------------
// Repository tree (folder-only sidebar)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct RepoTreeQuery {
    repo: Option<String>,
    project: Option<String>,
}

pub(crate) const CASE_TREE_IGNORE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".next",
    ".nuxt",
    "coverage",
];

pub(crate) fn rel_path_unix(repo_root: &Path, abs: &Path) -> String {
    abs.strip_prefix(repo_root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

pub(crate) fn display_name_from_folder_name(folder_name: &str) -> String {
    folder_name.replace('_', " ").replace('-', " ")
}

pub(crate) fn count_yaml_cases_in_dir_fs(dir_abs: &Path, ignore: &HashSet<&str>) -> i64 {
    let mut cnt: i64 = 0;
    let Ok(entries) = std::fs::read_dir(dir_abs) else {
        return 0;
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_s = name.to_string_lossy();
        if entry.path().is_dir() {
            if name_s.starts_with('.') || ignore.contains(name_s.as_ref()) {
                continue;
            }
            cnt += count_yaml_cases_in_dir_fs(&entry.path(), ignore);
            continue;
        }

        let p = entry.path();
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "md" {
            continue;
        }

        cnt += 1;
    }

    cnt
}

/// Increment recursive case counts for every ancestor folder of a case file path.
fn add_file_path_to_prefix_counts(map: &mut HashMap<String, i64>, file_path: &str) {
    let normalized = file_path.replace('\\', "/");
    let Some((parent, _)) = normalized.rsplit_once('/') else {
        return;
    };
    if !parent.starts_with(".gitoza/test/cases/") {
        return;
    }
    let mut current = parent.to_string();
    while current.starts_with(".gitoza/test/cases/") {
        *map.entry(current.clone()).or_insert(0) += 1;
        let Some((p, _)) = current.rsplit_once('/') else {
            break;
        };
        current = p.to_string();
    }
}

/// One-query prefix case counts for repository tree badges (replaces per-folder COUNT).
pub(crate) fn build_prefix_case_counts(
    conn: &Connection,
    repo_slug: &str,
    scope_prefix: Option<&str>,
    archive_mode: bool,
) -> Result<HashMap<String, i64>> {
    let mut map = HashMap::new();
    let scope = scope_prefix
        .map(|s| s.trim().replace('\\', "/"))
        .filter(|s| !s.is_empty());
    let path_clause = if archive_mode {
        archived_case_path_sql_clause()
    } else {
        active_case_path_sql_clause()
    };

    let file_paths: Vec<String> = if let Some(ref prefix) = scope {
        let pattern = format!("{}/%", prefix.trim_end_matches('/'));
        let sql = format!(
            r#"
            SELECT file_path FROM test_cases
            WHERE repo_slug = ?1
              AND file_path LIKE ?2
              AND ({path_clause})
            "#
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![repo_slug, pattern], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    } else {
        let sql = format!(
            r#"
            SELECT file_path FROM test_cases
            WHERE repo_slug = ?1
              AND ({path_clause})
            "#
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![repo_slug], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    for fp in file_paths {
        add_file_path_to_prefix_counts(&mut map, &fp);
    }
    Ok(map)
}

pub(crate) fn prefix_case_count(
    prefix_counts: Option<&HashMap<String, i64>>,
    dir_rel: &str,
) -> i64 {
    prefix_counts
        .and_then(|m| m.get(dir_rel))
        .copied()
        .unwrap_or(0)
}

pub(crate) fn count_cases_by_path_prefix_db(
    conn: &Connection,
    repo_slug: &str,
    path_prefix: &str,
) -> Result<i64> {
    let pattern = format!("{}/%", path_prefix.trim_end_matches('/'));
    let norm_prefix = path_prefix.trim().replace('\\', "/");
    let sql = if is_archived_file_path(&norm_prefix)
        || norm_prefix.starts_with(CASES_ARCHIVE_PREFIX.trim_end_matches('/'))
    {
        format!(
            r#"
            SELECT COUNT(*) FROM test_cases
            WHERE repo_slug = ? AND file_path LIKE ?
            "#
        )
    } else {
        format!(
            r#"
            SELECT COUNT(*) FROM test_cases
            WHERE repo_slug = ? AND file_path LIKE ?
              AND ({})
            "#,
            active_case_path_sql_clause()
        )
    };
    let row: i64 = conn
        .query_row(&sql, params![repo_slug, pattern], |r| r.get(0))
        .unwrap_or(0);
    Ok(row)
}

pub(crate) fn scan_subfolders_into_nodes(
    parent_abs: &Path,
    repo_root: &Path,
    breadcrumb: Vec<String>,
    ignore: &HashSet<&str>,
    repo_slug: &str,
    has_index: bool,
    conn: Option<&Connection>,
    prefix_counts: Option<&HashMap<String, i64>>,
) -> Vec<models::RepositoryTreeNode> {
    let mut nodes: Vec<models::RepositoryTreeNode> = vec![];
    let Ok(entries) = std::fs::read_dir(parent_abs) else {
        return nodes;
    };

    // Collect + sort so the sidebar order is stable.
    let mut dirs: Vec<std::fs::DirEntry> = entries.flatten().collect();
    dirs.sort_by_key(|e| e.file_name());

    for entry in dirs {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name_s = entry.file_name().to_string_lossy().to_string();
        if name_s.starts_with('.') || ignore.contains(name_s.as_str()) {
            continue;
        }

        let display = display_name_from_folder_name(&name_s);
        let dir_rel = rel_path_unix(repo_root, &path);
        let mut crumbs = breadcrumb.clone();
        crumbs.push(display.clone());

        let children = scan_subfolders_into_nodes(
            &path,
            repo_root,
            crumbs.clone(),
            ignore,
            repo_slug,
            has_index,
            conn,
            prefix_counts,
        );

        let case_count = if has_index {
            if prefix_counts.is_some() {
                prefix_case_count(prefix_counts, &dir_rel)
            } else if let Some(c) = conn {
                count_cases_by_path_prefix_db(c, repo_slug, &dir_rel).unwrap_or(0)
            } else {
                0
            }
        } else {
            count_yaml_cases_in_dir_fs(&path, ignore)
        };

        nodes.push(models::RepositoryTreeNode {
            type_: "folder".to_string(),
            name: name_s,
            display_name: display,
            children: Some(children),
            directory_path: Some(dir_rel),
            path_from_root: Some(crumbs),
            is_project: false,
            case_count,
        });
    }

    nodes
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct DiffContentQuery {
    file_path: String,
    repo: Option<String>,
}

// ---------------------------------------------------------------------------
// Comment helpers (YAML + run JSON docs)
// ---------------------------------------------------------------------------

fn comment_from_mapping(
    author: Option<&str>,
    timestamp: Option<&str>,
    text: Option<&str>,
) -> Option<models::Comment> {
    let text = text?.trim();
    if text.is_empty() {
        return None;
    }
    Some(models::Comment {
        author: author.unwrap_or("").trim().to_string(),
        timestamp: timestamp.unwrap_or("").trim().to_string(),
        text: text.to_string(),
    })
}

pub(crate) fn parse_comments_from_yaml_value(v: &serde_yaml::Value) -> Vec<models::Comment> {
    let serde_yaml::Value::Sequence(seq) = v else {
        return vec![];
    };
    seq.iter()
        .filter_map(|item| {
            let serde_yaml::Value::Mapping(m) = item else {
                return None;
            };
            let get = |k: &str| {
                m.get(&serde_yaml::Value::String(k.to_string()))
                    .and_then(|v| v.as_str())
            };
            comment_from_mapping(get("author"), get("timestamp"), get("text"))
        })
        .collect()
}

pub(crate) fn parse_comments_from_json_value(v: &serde_json::Value) -> Vec<models::Comment> {
    let serde_json::Value::Array(arr) = v else {
        return vec![];
    };
    arr.iter()
        .filter_map(|item| {
            let serde_json::Value::Object(m) = item else {
                return None;
            };
            let get = |k: &str| m.get(k).and_then(|v| v.as_str());
            comment_from_mapping(get("author"), get("timestamp"), get("text"))
        })
        .collect()
}

pub(crate) fn comments_to_json_value(comments: &[models::Comment]) -> serde_json::Value {
    serde_json::Value::Array(
        comments
            .iter()
            .map(|c| {
                serde_json::json!({
                    "author": c.author,
                    "timestamp": c.timestamp,
                    "text": c.text,
                })
            })
            .collect(),
    )
}

fn map_comment_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<models::Comment> {
    Ok(models::Comment {
        author: row.get(0)?,
        timestamp: row.get(1)?,
        text: row.get(2)?,
    })
}

pub(crate) fn delete_run_comments_for_run(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<()> {
    conn.execute(
        "DELETE FROM test_run_comments WHERE repo_slug = ?1 AND run_id = ?2",
        params![repo_slug, run_id],
    )?;
    conn.execute(
        "DELETE FROM test_run_case_comments WHERE repo_slug = ?1 AND run_id = ?2",
        params![repo_slug, run_id],
    )?;
    Ok(())
}

pub(crate) fn delete_run_case_comments_for_paths(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_paths: &[String],
) -> Result<()> {
    for file_path in file_paths {
        let fp = file_path.trim();
        if fp.is_empty() {
            continue;
        }
        conn.execute(
            "DELETE FROM test_run_case_comments WHERE repo_slug = ?1 AND run_id = ?2 AND file_path = ?3",
            params![repo_slug, run_id, fp],
        )?;
    }
    Ok(())
}

pub(crate) fn import_run_comments_from_doc(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    doc: &serde_json::Value,
) -> Result<()> {
    delete_run_comments_for_run(conn, repo_slug, run_id)?;

    if let Some(v) = doc.get("comments") {
        for comment in parse_comments_from_json_value(v) {
            conn.execute(
                r#"INSERT INTO test_run_comments (run_id, repo_slug, author, timestamp, text)
                   VALUES (?1, ?2, ?3, ?4, ?5)"#,
                params![
                    run_id,
                    repo_slug,
                    comment.author,
                    comment.timestamp,
                    comment.text,
                ],
            )?;
        }
    }

    if let Some(case_arr) = doc.get("cases").and_then(|v| v.as_array()) {
        for c in case_arr {
            let Some(fp) = c.get("file_path").and_then(|v| v.as_str()) else {
                continue;
            };
            let fp = fp.trim();
            if fp.is_empty() {
                continue;
            }
            let comments = parse_comments_from_json_value(
                c.get("comments")
                    .unwrap_or(&serde_json::Value::Array(vec![])),
            );
            for comment in comments {
                conn.execute(
                    r#"INSERT INTO test_run_case_comments
                       (run_id, repo_slug, file_path, author, timestamp, text)
                       VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
                    params![
                        run_id,
                        repo_slug,
                        fp,
                        comment.author,
                        comment.timestamp,
                        comment.text,
                    ],
                )?;
            }
        }
    }

    Ok(())
}

pub(crate) fn load_run_comments(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<Vec<models::Comment>> {
    let mut stmt = conn.prepare(
        r#"SELECT author, timestamp, text FROM test_run_comments
           WHERE repo_slug = ?1 AND run_id = ?2
           ORDER BY id ASC"#,
    )?;
    let rows = stmt.query_map(params![repo_slug, run_id], map_comment_row)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub(crate) fn load_run_case_comments(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_path: &str,
) -> Result<Vec<models::Comment>> {
    let mut stmt = conn.prepare(
        r#"SELECT author, timestamp, text FROM test_run_case_comments
           WHERE repo_slug = ?1 AND run_id = ?2 AND file_path = ?3
           ORDER BY id ASC"#,
    )?;
    let rows = stmt.query_map(params![repo_slug, run_id, file_path], map_comment_row)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub(crate) fn load_run_case_comments_for_paths(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_paths: &[String],
) -> Result<std::collections::HashMap<String, Vec<models::Comment>>> {
    let mut out = std::collections::HashMap::new();
    if file_paths.is_empty() {
        return Ok(out);
    }
    for file_path in file_paths {
        let fp = file_path.trim();
        if fp.is_empty() {
            continue;
        }
        let comments = load_run_case_comments(conn, repo_slug, run_id, fp)?;
        if !comments.is_empty() {
            out.insert(fp.to_string(), comments);
        }
    }
    Ok(out)
}

pub(crate) fn load_all_run_case_comments_grouped(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<std::collections::HashMap<String, Vec<models::Comment>>> {
    let mut stmt = conn.prepare(
        r#"SELECT file_path, author, timestamp, text FROM test_run_case_comments
           WHERE repo_slug = ?1 AND run_id = ?2
           ORDER BY file_path ASC, id ASC"#,
    )?;
    let rows = stmt.query_map(params![repo_slug, run_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            models::Comment {
                author: r.get(1)?,
                timestamp: r.get(2)?,
                text: r.get(3)?,
            },
        ))
    })?;
    let mut out: std::collections::HashMap<String, Vec<models::Comment>> =
        std::collections::HashMap::new();
    for row in rows.flatten() {
        let (fp, comment) = row;
        out.entry(fp).or_default().push(comment);
    }
    Ok(out)
}

pub(crate) fn touch_run_header_for_comment(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    updated_by: Option<&str>,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"UPDATE test_runs SET updated_at = ?1, updated_by = COALESCE(?2, updated_by)
           WHERE repo_slug = ?3 AND run_id = ?4"#,
        params![now, updated_by, repo_slug, run_id],
    )?;
    Ok(())
}

pub(crate) fn append_run_comment_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    comment: &models::Comment,
    updated_by: Option<&str>,
) -> Result<Vec<models::Comment>> {
    conn.execute(
        r#"INSERT INTO test_run_comments (run_id, repo_slug, author, timestamp, text)
           VALUES (?1, ?2, ?3, ?4, ?5)"#,
        params![
            run_id,
            repo_slug,
            comment.author,
            comment.timestamp,
            comment.text,
        ],
    )?;
    touch_run_header_for_comment(conn, repo_slug, run_id, updated_by)?;
    load_run_comments(conn, repo_slug, run_id)
}

pub(crate) fn delete_run_comment_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    index: usize,
    git_name: &str,
) -> Result<Vec<models::Comment>, &'static str> {
    let mut stmt = conn
        .prepare(
            r#"SELECT id, author FROM test_run_comments
               WHERE repo_slug = ?1 AND run_id = ?2
               ORDER BY id ASC"#,
        )
        .map_err(|_| "comment_not_found")?;
    let rows: Vec<(i64, String)> = stmt
        .query_map(params![repo_slug, run_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "comment_not_found")?
        .filter_map(|r| r.ok())
        .collect();
    let Some((id, author)) = rows.get(index).cloned() else {
        return Err("comment_not_found");
    };
    if !comment_author_matches(&author, git_name) {
        return Err("not_author");
    }
    conn.execute("DELETE FROM test_run_comments WHERE id = ?1", params![id])
        .map_err(|_| "comment_not_found")?;
    touch_run_header_for_comment(conn, repo_slug, run_id, Some(git_name))
        .map_err(|_| "comment_not_found")?;
    load_run_comments(conn, repo_slug, run_id).map_err(|_| "comment_not_found")
}

pub(crate) fn append_run_case_comment_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_path: &str,
    comment: &models::Comment,
    updated_by: Option<&str>,
) -> Result<Vec<models::Comment>> {
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM test_run_cases WHERE repo_slug = ?1 AND run_id = ?2 AND file_path = ?3",
            params![repo_slug, run_id, file_path],
            |r| r.get(0),
        )
        .optional()?;
    if exists.is_none() {
        return Err(anyhow!("case_not_found"));
    }
    conn.execute(
        r#"INSERT INTO test_run_case_comments
           (run_id, repo_slug, file_path, author, timestamp, text)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
        params![
            run_id,
            repo_slug,
            file_path,
            comment.author,
            comment.timestamp,
            comment.text,
        ],
    )?;
    touch_run_header_for_comment(conn, repo_slug, run_id, updated_by)?;
    load_run_case_comments(conn, repo_slug, run_id, file_path)
}

pub(crate) fn delete_run_case_comment_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_path: &str,
    index: usize,
    git_name: &str,
) -> Result<Vec<models::Comment>, &'static str> {
    let mut stmt = conn
        .prepare(
            r#"SELECT id, author FROM test_run_case_comments
               WHERE repo_slug = ?1 AND run_id = ?2 AND file_path = ?3
               ORDER BY id ASC"#,
        )
        .map_err(|_| "comment_not_found")?;
    let rows: Vec<(i64, String)> = stmt
        .query_map(params![repo_slug, run_id, file_path], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| "comment_not_found")?
        .filter_map(|r| r.ok())
        .collect();
    let Some((id, author)) = rows.get(index).cloned() else {
        return Err("comment_not_found");
    };
    if !comment_author_matches(&author, git_name) {
        return Err("not_author");
    }
    conn.execute(
        "DELETE FROM test_run_case_comments WHERE id = ?1",
        params![id],
    )
    .map_err(|_| "comment_not_found")?;
    touch_run_header_for_comment(conn, repo_slug, run_id, Some(git_name))
        .map_err(|_| "comment_not_found")?;
    load_run_case_comments(conn, repo_slug, run_id, file_path).map_err(|_| "comment_not_found")
}

pub(crate) fn comments_to_yaml_value(comments: &[models::Comment]) -> serde_yaml::Value {
    serde_yaml::Value::Sequence(
        comments
            .iter()
            .map(|c| {
                let mut m = serde_yaml::Mapping::new();
                m.insert(
                    serde_yaml::Value::String("author".to_string()),
                    serde_yaml::Value::String(c.author.clone()),
                );
                m.insert(
                    serde_yaml::Value::String("timestamp".to_string()),
                    serde_yaml::Value::String(c.timestamp.clone()),
                );
                m.insert(
                    serde_yaml::Value::String("text".to_string()),
                    serde_yaml::Value::String(c.text.clone()),
                );
                serde_yaml::Value::Mapping(m)
            })
            .collect(),
    )
}

pub(crate) fn insert_comments_into_fm(
    fm: &mut IndexMap<String, serde_yaml::Value>,
    comments: &[models::Comment],
) {
    if !comments.is_empty() {
        fm.insert("comments".to_string(), comments_to_yaml_value(comments));
    } else {
        fm.shift_remove("comments");
    }
}

/// True when `author` matches the repo git `user.name` (trimmed, exact).
pub(crate) fn comment_author_matches(author: &str, git_name: &str) -> bool {
    author.trim() == git_name.trim()
}

/// Remove comment at `index` when authored by `git_name`.
pub(crate) fn remove_comment_at_index(
    comments: &mut Vec<models::Comment>,
    index: usize,
    git_name: &str,
) -> Result<(), &'static str> {
    let Some(c) = comments.get(index) else {
        return Err("comment_not_found");
    };
    if !comment_author_matches(&c.author, git_name) {
        return Err("not_author");
    }
    comments.remove(index);
    Ok(())
}

/// Parse `params` front matter (flat string key-value map only).
pub(crate) fn parse_params_from_yaml_value(v: &serde_yaml::Value) -> BTreeMap<String, String> {
    let mapping = match v {
        serde_yaml::Value::Mapping(m) => m,
        _ => return BTreeMap::new(),
    };
    let mut out = BTreeMap::new();
    for (k, val) in mapping {
        let key = match k {
            serde_yaml::Value::String(s) => s.trim().to_string(),
            _ => continue,
        };
        if key.is_empty() {
            continue;
        }
        let value = match val {
            serde_yaml::Value::String(s) => s.trim().to_string(),
            serde_yaml::Value::Number(n) => n.to_string(),
            serde_yaml::Value::Bool(b) => b.to_string(),
            _ => continue,
        };
        if value.is_empty() {
            continue;
        }
        out.insert(key, value);
    }
    out
}

pub(crate) fn normalize_params_for_storage(
    params: BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (k, v) in params {
        let key = k.trim().to_string();
        let val = v.trim().to_string();
        if key.is_empty() || val.is_empty() {
            continue;
        }
        out.insert(key, val);
    }
    out
}

pub(crate) fn params_to_yaml_value(params: &BTreeMap<String, String>) -> serde_yaml::Value {
    let mut m = serde_yaml::Mapping::new();
    for (k, v) in params {
        m.insert(
            serde_yaml::Value::String(k.clone()),
            serde_yaml::Value::String(v.clone()),
        );
    }
    serde_yaml::Value::Mapping(m)
}

fn parse_automated_from_yaml(v: &serde_yaml::Value) -> bool {
    v.as_bool().unwrap_or(false)
}

/// Rebuild case YAML front matter from parsed detail.
/// Does not write `updated_at` / `updated_by` (SQLite-owned audit metadata).
pub(crate) fn case_detail_to_front_matter(
    d: &models::YamlCaseDetail,
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
    if !d.approve_status.trim().is_empty() {
        fm.insert(
            "approve_status".to_string(),
            serde_yaml::Value::String(d.approve_status.clone()),
        );
    }
    if let Some(v) = &d.approved_by {
        fm.insert(
            "approved_by".to_string(),
            serde_yaml::Value::String(v.clone()),
        );
    }
    if let Some(v) = &d.approved_at {
        fm.insert(
            "approved_at".to_string(),
            serde_yaml::Value::String(v.clone()),
        );
    }
    crate::requirement_ids::insert_requirement_ids_into_fm(&mut fm, &d.requirement_ids);
    if let Some(at) = &d.assigned_to {
        if !at.trim().is_empty() {
            fm.insert(
                "assigned_to".to_string(),
                serde_yaml::Value::String(at.clone()),
            );
        }
    }
    if d.automated {
        fm.insert("automated".to_string(), serde_yaml::Value::Bool(true));
    }
    if !d.params.is_empty() {
        fm.insert("params".to_string(), params_to_yaml_value(&d.params));
    }
    insert_comments_into_fm(&mut fm, &d.comments);
    fm
}

// ---------------------------------------------------------------------------
// YAML helpers (front-matter + body)
// ---------------------------------------------------------------------------

pub(crate) fn read_full_yaml(path: &Path) -> Result<Option<models::YamlCaseDetail>> {
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
    let tags = match lower.get("tags") {
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
    };
    let approve_status = lower
        .get("approve_status")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "draft".to_string());

    let status = lower
        .get("status")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "active".to_string());

    let params = lower
        .get("params")
        .map(parse_params_from_yaml_value)
        .map(normalize_params_for_storage)
        .unwrap_or_default();

    Ok(Some(models::YamlCaseDetail {
        case_id: path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string(),
        title: lower
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        tags,
        status: Some(status),
        priority: lower
            .get("priority")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        file_path: "".to_string(),
        body,
        raw,
        approve_status,
        updated_at: lower
            .get("updated_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        updated_by: lower
            .get("updated_by")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        approved_by: lower
            .get("approved_by")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        approved_at: lower
            .get("approved_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        requirement_ids: crate::requirement_ids::parse_requirement_ids_from_yaml_map(&lower),
        assigned_to: lower
            .get("assigned_to")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        automated: lower
            .get("automated")
            .map(parse_automated_from_yaml)
            .unwrap_or(false),
        comments: parse_comments_from_yaml_value(
            lower
                .get("comments")
                .unwrap_or(&serde_yaml::Value::Sequence(vec![])),
        ),
        params,
    }))
}

pub(crate) fn parse_full_yaml_content_for_api(
    raw: &str,
    file_path: &str,
    default_case_id: &str,
) -> Option<models::YamlCaseDetail> {
    let stripped = raw.trim_start();
    if !stripped.starts_with("---") {
        return None;
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

    let data: serde_yaml::Value = serde_yaml::from_str(front_text).ok()?;
    let map = match data {
        serde_yaml::Value::Mapping(m) => m,
        _ => return None,
    };
    let mut lower = BTreeMap::<String, serde_yaml::Value>::new();
    for (k, v) in map {
        if let serde_yaml::Value::String(s) = k {
            lower.insert(s.to_lowercase(), v);
        }
    }

    let tags: Vec<String> = match lower.get("tags") {
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
    };

    let approve_status = lower
        .get("approve_status")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "draft".to_string());

    let status = lower
        .get("status")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "active".to_string());

    let case_id = lower
        .get("case_id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_case_id.to_string());

    let params = lower
        .get("params")
        .map(parse_params_from_yaml_value)
        .map(normalize_params_for_storage)
        .unwrap_or_default();

    Some(models::YamlCaseDetail {
        case_id,
        title: lower
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        tags,
        status: Some(status),
        priority: lower
            .get("priority")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        file_path: file_path.to_string(),
        body,
        raw: raw.to_string(),
        approve_status,
        updated_at: lower
            .get("updated_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        updated_by: lower
            .get("updated_by")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        approved_by: lower
            .get("approved_by")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        approved_at: lower
            .get("approved_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        requirement_ids: crate::requirement_ids::parse_requirement_ids_from_yaml_map(&lower),
        assigned_to: lower
            .get("assigned_to")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        automated: lower
            .get("automated")
            .map(parse_automated_from_yaml)
            .unwrap_or(false),
        comments: parse_comments_from_yaml_value(
            lower
                .get("comments")
                .unwrap_or(&serde_yaml::Value::Sequence(vec![])),
        ),
        params,
    })
}

pub(crate) fn tags_json_for_run_case_db(tags: &[String]) -> String {
    serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string())
}

/// Keys the app owns in case/ticket/wiki/release front matter.
/// Unknown keys (e.g. AI-only) are preserved on merge; managed keys absent from
/// `desired` are dropped (e.g. omit `automated` when false).
const MANAGED_FRONT_MATTER_KEYS: &[&str] = &[
    "title",
    "tags",
    "status",
    "priority",
    "approve_status",
    "approved_by",
    "approved_at",
    "requirement_ids",
    "requirement_id",
    "assigned_to",
    "automated",
    "params",
    "comments",
    "type",
    "reporter",
    "sprint",
    "release",
    "parent",
    "ticket_id",
    "release_id",
    "name",
    "project",
    "updated_at",
    "updated_by",
    "archived_at",
    "archived_reason",
];

fn is_managed_front_matter_key(key: &str) -> bool {
    let lower = key.to_lowercase();
    MANAGED_FRONT_MATTER_KEYS
        .iter()
        .any(|k| k.eq_ignore_ascii_case(&lower))
}

/// Split document raw text into front-matter Mapping (ordered) when present.
pub(crate) fn parse_front_matter_mapping(raw: &str) -> Option<serde_yaml::Mapping> {
    let stripped = raw.trim_start();
    if !stripped.starts_with("---") {
        return None;
    }
    let rest = &stripped[3..];
    let end = rest.find("\n---")?;
    let front_text = &rest[..end];
    let data: serde_yaml::Value = serde_yaml::from_str(front_text).ok()?;
    match data {
        serde_yaml::Value::Mapping(m) => Some(m),
        _ => None,
    }
}

/// Merge `desired` into on-disk Mapping: preserve key order/casing, keep unknown keys,
/// drop managed keys missing from desired, append new desired keys.
pub(crate) fn merge_front_matter_preserving_order(
    existing: serde_yaml::Mapping,
    desired: &IndexMap<String, serde_yaml::Value>,
) -> serde_yaml::Mapping {
    let desired_lower: HashMap<String, &serde_yaml::Value> = desired
        .iter()
        .map(|(k, v)| (k.to_lowercase(), v))
        .collect();
    let mut seen_desired: HashSet<String> = HashSet::new();
    let mut out = serde_yaml::Mapping::new();

    for (k, v) in existing {
        let key_str = match &k {
            serde_yaml::Value::String(s) => s.clone(),
            _ => {
                out.insert(k, v);
                continue;
            }
        };
        let lower = key_str.to_lowercase();
        if let Some(new_v) = desired_lower.get(&lower) {
            out.insert(k, (*new_v).clone());
            seen_desired.insert(lower);
        } else if is_managed_front_matter_key(&key_str) {
            // Drop managed key not present in desired (e.g. automated=false).
            continue;
        } else {
            // Keep unknown / AI-only keys in place.
            out.insert(k, v);
        }
    }

    for (k, v) in desired {
        let lower = k.to_lowercase();
        if seen_desired.contains(&lower) {
            continue;
        }
        out.insert(
            serde_yaml::Value::String(k.clone()),
            v.clone(),
        );
    }
    out
}

fn format_yaml_document(yaml_header: &str, body: &str) -> String {
    if body.trim().is_empty() {
        format!("---\n{yaml_header}---\n\n")
    } else {
        format!("---\n{yaml_header}---\n\n{}\n", body.trim())
    }
}

pub(crate) fn write_full_yaml_from_mapping(
    path: &Path,
    mapping: &serde_yaml::Mapping,
    body: &str,
) -> Result<()> {
    let yaml_header = serde_yaml::to_string(mapping)?;
    let content = format_yaml_document(&yaml_header, body);
    atomic_write_file(path, content.as_bytes())?;
    Ok(())
}

/// Write front matter from IndexMap insertion order (creates / fallback rebuilds).
pub(crate) fn write_full_yaml(
    path: &Path,
    front_matter: &IndexMap<String, serde_yaml::Value>,
    body: &str,
) -> Result<()> {
    let mut mapping = serde_yaml::Mapping::new();
    for (k, v) in front_matter {
        mapping.insert(serde_yaml::Value::String(k.clone()), v.clone());
    }
    write_full_yaml_from_mapping(path, &mapping, body)
}

/// Keep front-matter bytes unchanged; rewrite only the body section.
pub(crate) fn rewrite_yaml_body_preserving_front_matter(
    path: &Path,
    raw: &str,
    new_body: &str,
) -> Result<()> {
    let stripped = raw.trim_start();
    if !stripped.starts_with("---") {
        return Err(anyhow!("document missing front matter"));
    }
    let rest = &stripped[3..];
    let end = rest
        .find("\n---")
        .ok_or_else(|| anyhow!("document missing closing front matter delimiter"))?;
    // Include leading `---` and the closing `\n---` (4 chars after fm text).
    let prefix_len = (raw.len() - stripped.len()) + 3 + end + 4;
    let front_with_delimiters = &raw[..prefix_len];
    let content = if new_body.trim().is_empty() {
        format!("{front_with_delimiters}\n\n")
    } else {
        format!("{front_with_delimiters}\n\n{}\n", new_body.trim())
    };
    atomic_write_file(path, content.as_bytes())?;
    Ok(())
}

/// Update path: body-only splice when FM unchanged; else merge preserving on-disk order.
pub(crate) fn write_yaml_update_preserving_order(
    path: &Path,
    existing_raw: &str,
    desired: &IndexMap<String, serde_yaml::Value>,
    body: &str,
    front_matter_unchanged: bool,
) -> Result<()> {
    if front_matter_unchanged {
        if rewrite_yaml_body_preserving_front_matter(path, existing_raw, body).is_ok() {
            return Ok(());
        }
    }
    if let Some(existing) = parse_front_matter_mapping(existing_raw) {
        let merged = merge_front_matter_preserving_order(existing, desired);
        return write_full_yaml_from_mapping(path, &merged, body);
    }
    write_full_yaml(path, desired, body)
}

/// Convenience: preserve on-disk order when rewriting an existing document.
pub(crate) fn write_yaml_from_existing_raw(
    path: &Path,
    existing_raw: &str,
    desired: &IndexMap<String, serde_yaml::Value>,
    body: &str,
) -> Result<()> {
    let desired = reconcile_desired_front_matter_with_disk(existing_raw, desired);
    let fm_unchanged = front_matter_matches_desired(existing_raw, &desired);
    write_yaml_update_preserving_order(path, existing_raw, &desired, body, fm_unchanged)
}

/// When desired values equal disk ignore-case, keep disk spelling (strings / tag lists).
pub(crate) fn reconcile_desired_front_matter_with_disk(
    existing_raw: &str,
    desired: &IndexMap<String, serde_yaml::Value>,
) -> IndexMap<String, serde_yaml::Value> {
    let Some(existing) = parse_front_matter_mapping(existing_raw) else {
        return desired.clone();
    };
    let mut disk_by_lower: HashMap<String, &serde_yaml::Value> = HashMap::new();
    for (k, v) in &existing {
        if let serde_yaml::Value::String(s) = k {
            disk_by_lower.insert(s.to_lowercase(), v);
        }
    }

    let mut out = IndexMap::new();
    for (k, desired_v) in desired {
        let lower = k.to_lowercase();
        let reconciled = match disk_by_lower.get(&lower) {
            Some(disk_v) => reconcile_yaml_value_prefer_disk(disk_v, desired_v),
            None => desired_v.clone(),
        };
        out.insert(k.clone(), reconciled);
    }
    out
}

fn yaml_string_eq_ignore_case(a: &serde_yaml::Value, b: &serde_yaml::Value) -> bool {
    match (a.as_str(), b.as_str()) {
        (Some(sa), Some(sb)) => sa.eq_ignore_ascii_case(sb),
        _ => false,
    }
}

fn reconcile_yaml_value_prefer_disk(
    disk: &serde_yaml::Value,
    desired: &serde_yaml::Value,
) -> serde_yaml::Value {
    if yaml_string_eq_ignore_case(disk, desired) {
        return disk.clone();
    }
    match (disk, desired) {
        (serde_yaml::Value::Sequence(disk_seq), serde_yaml::Value::Sequence(desired_seq)) => {
            if disk_seq.len() != desired_seq.len() {
                return desired.clone();
            }
            let all_strings = disk_seq.iter().all(|v| v.as_str().is_some())
                && desired_seq.iter().all(|v| v.as_str().is_some());
            if !all_strings {
                return desired.clone();
            }
            let same_order_ignore_case = disk_seq
                .iter()
                .zip(desired_seq.iter())
                .all(|(d, want)| yaml_string_eq_ignore_case(d, want));
            if same_order_ignore_case {
                disk.clone()
            } else {
                desired.clone()
            }
        }
        _ => desired.clone(),
    }
}

/// Compare desired FM to on-disk Mapping for managed keys (unknown keys ignored).
pub(crate) fn front_matter_matches_desired(
    existing_raw: &str,
    desired: &IndexMap<String, serde_yaml::Value>,
) -> bool {
    let Some(existing) = parse_front_matter_mapping(existing_raw) else {
        return false;
    };
    let merged = merge_front_matter_preserving_order(existing.clone(), desired);
    // Equal if merge did not change any key/value vs existing (including drops/appends).
    if merged.len() != existing.len() {
        return false;
    }
    for (k, v) in &merged {
        match existing.get(k) {
            Some(ev) if ev == v => {}
            _ => return false,
        }
    }
    true
}

// ---------------------------------------------------------------------------
// YAML -> SQLite indexer (minimal parity with FastAPI)
// ---------------------------------------------------------------------------

pub(crate) fn normalize_tags_for_storage(tags: Vec<String>) -> Vec<String> {
    // Preserve first-seen order (Python behavior), but dedupe case-insensitively.
    let mut seen: HashSet<String> = HashSet::new(); // lowercase -> exists
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let norm = normalize_tag(&t);
        if norm.is_empty() {
            continue;
        }
        let key = norm.to_lowercase();
        if seen.insert(key) {
            out.push(norm);
        }
    }
    out
}

pub(crate) fn file_rel_from_repo(repo_path: &Path, abs_path: &Path) -> String {
    abs_path
        .strip_prefix(repo_path)
        .unwrap_or(abs_path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub(crate) fn index_cases_from_yaml(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
) -> Result<i64> {
    index_cases_from_yaml_with_audit(
        conn,
        repo_path,
        repo_slug,
        &AuditStampSource::for_cases_full(repo_path),
    )
}

pub(crate) fn index_cases_from_yaml_with_audit(
    conn: &Connection,
    repo_path: &Path,
    repo_slug: &str,
    audit: &AuditStampSource,
) -> Result<i64> {
    let cases_root = repo_path.join(".gitoza/test/cases");
    if !cases_root.is_dir() {
        return Ok(0);
    }
    let ignore: HashSet<&str> = CASE_TREE_IGNORE_DIRS.iter().copied().collect();

    fn visit_dir(
        conn: &Connection,
        repo_path: &Path,
        dir_abs: &Path,
        repo_slug: &str,
        ignore: &HashSet<&str>,
        audit: &AuditStampSource,
    ) -> Result<i64> {
        let mut total: i64 = 0;
        let entries = match std::fs::read_dir(dir_abs) {
            Ok(e) => e,
            Err(_) => return Ok(0),
        };
        for entry in entries.flatten() {
            let name_s = entry.file_name().to_string_lossy().to_string();
            let p = entry.path();
            if p.is_dir() {
                let parent_rel = file_rel_from_repo(repo_path, dir_abs);
                if should_skip_case_scan_dir(&parent_rel, &name_s, ignore) {
                    continue;
                }
                total += visit_dir(conn, repo_path, &p, repo_slug, ignore, audit)?;
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

            let file_rel = file_rel_from_repo(repo_path, &p);
            let directory = directory_from_file_path(&file_rel);
            if directory.is_empty() {
                continue;
            }

            let d = match read_full_yaml(&p)? {
                Some(x) => x,
                None => continue,
            };

            let tags_for_db = normalize_tags_for_storage(d.tags.clone());
            let params_for_db = normalize_params_for_storage(d.params.clone());
            let (updated_at, updated_by) = audit.resolve(&file_rel);

            let up_args = UpsertCaseArgs {
                case_id: d.case_id,
                title: d.title,
                tags: tags_for_db,
                status: d.status.clone(),
                priority: d.priority,
                file_path: file_rel,
                repo_slug: repo_slug.to_string(),
                directory,
                approve_status: d.approve_status,
                updated_at,
                updated_by,
                approved_by: d.approved_by,
                approved_at: d.approved_at,
                requirement_id: crate::requirement_ids::requirement_ids_json_for_db(
                    &d.requirement_ids,
                ),
                assigned_to: d.assigned_to,
                automated: d.automated,
                params: params_for_db,
            };
            if let Err(_) = upsert_case_db(conn, up_args) {
                // Best-effort indexing; skip problematic files instead of failing the whole scan.
                continue;
            }
            total += 1;
        }
        Ok(total)
    }

    visit_dir(conn, repo_path, &cases_root, repo_slug, &ignore, audit)
}

// ---------------------------------------------------------------------------
// SQLite (subset needed by frontend)
// ---------------------------------------------------------------------------

pub(crate) fn open_repo_db(state: &AppState, slug: &str) -> Result<Arc<Mutex<Connection>>> {
    let mut guard = state.dbs.lock().unwrap();
    if let Some(c) = guard.get(slug) {
        return Ok(c.clone());
    }
    let db_dir = state.config_dir.join("db");
    std::fs::create_dir_all(&db_dir)?;
    let path = db_dir.join(format!("{slug}.db"));
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    init_schema(&conn)?;
    let arc = Arc::new(Mutex::new(conn));
    guard.insert(slug.to_string(), arc.clone());
    Ok(arc)
}

fn init_schema(conn: &Connection) -> Result<()> {
    // Idempotent schema initialization.
    // We create the "final" tables used by the FastAPI backend, and then run
    // best-effort `ALTER TABLE ... ADD COLUMN` migrations for older DBs.
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS test_cases (
  case_id        TEXT    NOT NULL,
  title          TEXT,
  tags           TEXT,
  status         TEXT,
  priority       TEXT,
  file_path      TEXT    NOT NULL,
  repo_slug      TEXT    NOT NULL,
  directory      TEXT,
  indexed_at     TEXT    NOT NULL,
  approve_status TEXT,
  updated_at     TEXT,
  updated_by     TEXT,
  approved_by    TEXT,
  approved_at    TEXT,
  requirement_id TEXT,
  assigned_to    TEXT,
  automated      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_slug, file_path)
);
CREATE INDEX IF NOT EXISTS idx_cases_repo   ON test_cases(repo_slug);
CREATE INDEX IF NOT EXISTS idx_cases_status ON test_cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_id      ON test_cases(case_id);
CREATE INDEX IF NOT EXISTS idx_cases_file_path ON test_cases(repo_slug, file_path);

CREATE TABLE IF NOT EXISTS pending_commit_metadata (
  repo_slug      TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  diff_content   TEXT NOT NULL,
  captured_at    TEXT NOT NULL,
  change_status  TEXT NOT NULL DEFAULT 'M',
  old_file_path  TEXT,
  PRIMARY KEY (repo_slug, file_path)
);
CREATE INDEX IF NOT EXISTS idx_pending_repo ON pending_commit_metadata(repo_slug);

CREATE TABLE IF NOT EXISTS pending_commit_groups (
  repo_slug   TEXT NOT NULL,
  group_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  old_path    TEXT NOT NULL,
  new_path    TEXT NOT NULL,
  file_count  INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (repo_slug, group_id)
);
CREATE INDEX IF NOT EXISTS idx_pending_groups_repo ON pending_commit_groups(repo_slug);

CREATE TABLE IF NOT EXISTS confirm_workflow_state (
  repo_slug        TEXT    PRIMARY KEY,
  step             TEXT    NOT NULL,
  draft_branch     TEXT    NOT NULL,
  main_sha         TEXT,
  updated_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS confirm_push_failed (
  repo_slug        TEXT    PRIMARY KEY,
  set_at           TEXT    NOT NULL,
  reason           TEXT    NOT NULL DEFAULT 'conflict'
);

CREATE TABLE IF NOT EXISTS repo_git_user (
  repo_slug   TEXT    PRIMARY KEY,
  user_name   TEXT,
  user_email  TEXT,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_index_state (
  repo_slug         TEXT PRIMARY KEY,
  indexed_head_sha  TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT    NOT NULL UNIQUE,
  repo_slug   TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0,
  approved    INTEGER NOT NULL DEFAULT 0,
  approve_status TEXT    DEFAULT 'draft',
  updated_by  TEXT,
  approved_by TEXT,
  approved_at TEXT,
  assigned_to TEXT,
  requirement_id TEXT,
  release TEXT
);
CREATE INDEX IF NOT EXISTS idx_test_runs_repo ON test_runs(repo_slug);

CREATE TABLE IF NOT EXISTS test_run_cases (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id           TEXT    NOT NULL,
  repo_slug        TEXT    NOT NULL,
  file_path        TEXT    NOT NULL,
  case_id          TEXT    NOT NULL,
  picked_at_sha   TEXT,
  content_snapshot TEXT,
  executed_at      TEXT,
  title            TEXT,
  tags             TEXT,
  priority         TEXT,
  requirement_id   TEXT,
  assigned_to      TEXT,
  automated        INTEGER NOT NULL DEFAULT 0,
  UNIQUE(run_id, file_path)
);
CREATE INDEX IF NOT EXISTS idx_test_run_cases_run ON test_run_cases(run_id);

CREATE TABLE IF NOT EXISTS test_run_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,
  result      TEXT    NOT NULL,
  executed_at TEXT    NOT NULL,
  comment     TEXT,
  UNIQUE(run_id, file_path)
);
CREATE INDEX IF NOT EXISTS idx_test_run_results_run ON test_run_results(run_id);

CREATE TABLE IF NOT EXISTS test_run_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT    NOT NULL,
  repo_slug   TEXT    NOT NULL,
  author      TEXT    NOT NULL,
  timestamp   TEXT    NOT NULL,
  text        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_run_comments_run ON test_run_comments(repo_slug, run_id);

CREATE TABLE IF NOT EXISTS test_run_case_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT    NOT NULL,
  repo_slug   TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,
  author      TEXT    NOT NULL,
  timestamp   TEXT    NOT NULL,
  text        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_run_case_comments_run ON test_run_case_comments(repo_slug, run_id, file_path);

CREATE TABLE IF NOT EXISTS pending_run_yaml_flush (
  run_id         TEXT PRIMARY KEY,
  flush_head     INTEGER NOT NULL DEFAULT 0,
  flush_cases    INTEGER NOT NULL DEFAULT 0,
  flush_results  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_feature_flags (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enable_review_system INTEGER NOT NULL DEFAULT 1,
  module_tickets INTEGER NOT NULL DEFAULT 1,
  module_releases INTEGER NOT NULL DEFAULT 1,
  module_wiki INTEGER NOT NULL DEFAULT 1,
  module_dashboard INTEGER NOT NULL DEFAULT 1,
  module_test_repository INTEGER NOT NULL DEFAULT 1,
  module_test_run INTEGER NOT NULL DEFAULT 1,
  module_automation INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
"#,
    )?;

    crate::automation_index::init_automation_schema(conn)?;
    crate::tickets::init_tickets_schema(conn)?;
    crate::ticket_releases::init_ticket_releases_schema(conn)?;
    crate::wiki::init_wiki_schema(conn)?;

    // Best-effort migrations for DBs that already exist but miss columns.
    // (We ignore errors because these statements may fail when the column already exists.)
    // Hard cleanup: remove retired table from old local DBs.
    let _ = conn.execute("DROP TABLE IF EXISTS workplace_settings", []);
    let _ = conn.execute(
        "ALTER TABLE test_runs ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE test_runs ADD COLUMN approved INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE test_runs ADD COLUMN approve_status TEXT DEFAULT 'draft'",
        [],
    );
    let _ = conn.execute("ALTER TABLE test_runs ADD COLUMN updated_by TEXT", []);
    let _ = conn.execute("ALTER TABLE test_runs ADD COLUMN approved_by TEXT", []);
    let _ = conn.execute("ALTER TABLE test_runs ADD COLUMN approved_at TEXT", []);
    // Legacy unused columns (kept for old DB open compatibility; not read/written at runtime).
    let _ = conn.execute(
        "ALTER TABLE test_runs ADD COLUMN results_revision INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE test_runs ADD COLUMN yaml_flush_revision INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE test_runs ADD COLUMN run_dir_path TEXT", []);
    let _ = conn.execute("ALTER TABLE test_runs ADD COLUMN assigned_to TEXT", []);
    let _ = conn.execute("ALTER TABLE test_runs ADD COLUMN requirement_id TEXT", []);
    let _ = conn.execute("ALTER TABLE test_runs ADD COLUMN release TEXT", []);

    let _ = conn.execute("ALTER TABLE test_cases ADD COLUMN requirement_id TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE test_cases ADD COLUMN approve_status TEXT DEFAULT 'draft'",
        [],
    );
    let _ = conn.execute("ALTER TABLE test_cases ADD COLUMN updated_at TEXT", []);
    let _ = conn.execute("ALTER TABLE test_cases ADD COLUMN updated_by TEXT", []);
    let _ = conn.execute("ALTER TABLE test_cases ADD COLUMN approved_by TEXT", []);
    let _ = conn.execute("ALTER TABLE test_cases ADD COLUMN approved_at TEXT", []);
    let _ = conn.execute("ALTER TABLE test_cases ADD COLUMN assigned_to TEXT", []);
    let _ = conn.execute("ALTER TABLE test_cases ADD COLUMN params TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE test_cases ADD COLUMN automated INTEGER NOT NULL DEFAULT 0",
        [],
    );

    let _ = conn.execute(
        "ALTER TABLE confirm_push_failed ADD COLUMN reason TEXT NOT NULL DEFAULT 'conflict'",
        [],
    );

    // Run-case and run-result UUID columns (best-effort; older DBs may have only case_id).

    // Cached frozen metadata from Run YAML (title, tags, priority, requirement_id).
    let _ = conn.execute("ALTER TABLE test_run_cases ADD COLUMN title TEXT", []);
    let _ = conn.execute("ALTER TABLE test_run_cases ADD COLUMN tags TEXT", []);
    let _ = conn.execute("ALTER TABLE test_run_cases ADD COLUMN priority TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE test_run_cases ADD COLUMN requirement_id TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE test_run_cases ADD COLUMN executed_by TEXT", []);
    let _ = conn.execute("ALTER TABLE test_run_cases ADD COLUMN executed_at TEXT", []);
    let _ = conn.execute("ALTER TABLE test_run_cases ADD COLUMN assigned_to TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE test_run_cases ADD COLUMN automated INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE test_run_cases DROP COLUMN added_at", []);
    let _ = conn.execute("ALTER TABLE test_run_cases DROP COLUMN added_by", []);

    let _ = conn.execute(
        "ALTER TABLE pending_commit_metadata ADD COLUMN change_status TEXT NOT NULL DEFAULT 'M'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE pending_commit_metadata ADD COLUMN old_file_path TEXT",
        [],
    );

    Ok(())
}

pub(crate) fn count_cases_db(conn: &Connection, slug: &str) -> Result<i64> {
    let v: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM test_cases WHERE repo_slug = ?",
            [slug],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(v)
}

#[derive(Debug)]
pub(crate) struct UpsertCaseArgs {
    pub(crate) case_id: String,
    pub(crate) title: Option<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) status: Option<String>,
    pub(crate) priority: Option<String>,
    pub(crate) file_path: String,
    pub(crate) repo_slug: String,
    pub(crate) directory: String,
    pub(crate) approve_status: String,
    pub(crate) updated_at: Option<String>,
    pub(crate) updated_by: Option<String>,
    pub(crate) approved_by: Option<String>,
    pub(crate) approved_at: Option<String>,
    pub(crate) requirement_id: Option<String>,
    pub(crate) assigned_to: Option<String>,
    pub(crate) automated: bool,
    pub(crate) params: BTreeMap<String, String>,
}

pub(crate) fn upsert_case_db(conn: &Connection, a: UpsertCaseArgs) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let tags_json = serde_json::to_string(&a.tags).unwrap_or_else(|_| "[]".to_string());
    let params_json = serde_json::to_string(&a.params).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        r#"
INSERT INTO test_cases
  (case_id, title, tags, status, priority, file_path, repo_slug, directory, indexed_at,
   approve_status, updated_at, updated_by, approved_by, approved_at, requirement_id, assigned_to, automated, params)
VALUES
  (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
ON CONFLICT(repo_slug, file_path) DO UPDATE SET
  case_id = excluded.case_id,
  title = excluded.title,
  tags = excluded.tags,
  status = excluded.status,
  priority = excluded.priority,
  directory = excluded.directory,
  indexed_at = excluded.indexed_at,
  approve_status = excluded.approve_status,
  updated_at = COALESCE(excluded.updated_at, test_cases.updated_at),
  updated_by = COALESCE(excluded.updated_by, test_cases.updated_by),
  approved_by = excluded.approved_by,
  approved_at = excluded.approved_at,
  requirement_id = excluded.requirement_id,
  assigned_to = excluded.assigned_to,
  automated = excluded.automated,
  params = excluded.params
"#,
        params![
            a.case_id,
            a.title,
            tags_json,
            a.status,
            a.priority,
            a.file_path,
            a.repo_slug,
            a.directory,
            now,
            a.approve_status,
            a.updated_at,
            a.updated_by,
            a.approved_by,
            a.approved_at,
            a.requirement_id,
            a.assigned_to,
            i32::from(a.automated),
            params_json,
        ],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Test runs (YAML truth + SQLite index)
// ---------------------------------------------------------------------------

pub(crate) fn set_run_dir_path_db(
    conn: &Connection,
    run_id: &str,
    run_dir_path: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE test_runs SET run_dir_path = ?1 WHERE run_id = ?2",
        params![run_dir_path, run_id],
    )?;
    Ok(())
}

/// Move run directory when archive state changes.
pub(crate) fn move_run_dir_for_archive(
    repo_path: &Path,
    run_id: &str,
    from_archived: bool,
    to_archived: bool,
) -> Result<(), String> {
    run_publish::move_run_dir(repo_path, run_id, from_archived, to_archived)?;
    Ok(())
}

pub(crate) fn remove_run_by_id(repo_path: &Path, run_id: &str, archived: bool) {
    run_publish::remove_run_dir(repo_path, run_id, archived);
}

fn discover_run_head_paths_in_dir(repo_path: &Path, parent: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if !parent.is_dir() {
        return out;
    }
    if let Ok(entries) = std::fs::read_dir(parent) {
        for e in entries.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            let name_owned = e.file_name().to_string_lossy().into_owned();
            if name_owned.starts_with('.') {
                continue;
            }
            let head = p.join(run_publish::HEAD_FILE);
            if head.is_file() {
                let rel = file_rel_from_repo(repo_path, &head);
                out.push(rel);
            }
        }
    }
    out
}

pub(crate) fn discover_run_yaml_rel_paths(repo_path: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let runs_root = repo_path.join(".gitoza/test/runs");
    if !runs_root.is_dir() {
        return out;
    }

    out.extend(discover_run_head_paths_in_dir(repo_path, &runs_root));
    let archive = runs_root.join(".archive");
    out.extend(discover_run_head_paths_in_dir(repo_path, &archive));

    out.sort();
    out.dedup();
    out
}

pub(crate) fn read_run_doc_from_abs_yaml(path: &Path) -> Option<serde_json::Value> {
    if !path.is_file() {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    let doc: serde_json::Value = serde_yaml::from_str(&raw).ok()?;
    if doc.is_object() {
        Some(doc)
    } else {
        None
    }
}

/// Full reindex of runs from on-disk YAML shards into SQLite.
///
/// Flushes pending DB→YAML first so disk matches SQLite before any import
/// (`upsert_test_run_from_doc`). Do not call disk load helpers that feed this
/// path without going through this flush.
pub(crate) async fn index_runs_from_yaml_full(
    state: &AppState,
    repo_path: &Path,
    slug: &str,
) -> Result<i64> {
    pending_run_yaml::flush_pending_run_yaml_before_index(state, slug)
        .await
        .map_err(|e| anyhow!(e))?;

    let rel_paths = discover_run_yaml_rel_paths(repo_path);
    if rel_paths.is_empty() {
        // If there are no run YAMLs, clear DB runs for this repo (parity with file-truth).
        if let Ok(conn_arc) = open_repo_db(state, slug) {
            let conn = conn_arc.lock().unwrap();
            let _ = conn.execute(
                "DELETE FROM test_run_case_comments WHERE repo_slug = ?",
                [slug],
            );
            let _ = conn.execute("DELETE FROM test_run_comments WHERE repo_slug = ?", [slug]);
            let _ = conn.execute("DELETE FROM test_run_results WHERE run_id IN (SELECT run_id FROM test_runs WHERE repo_slug = ?)", [slug]);
            let _ = conn.execute("DELETE FROM test_run_cases WHERE repo_slug = ?", [slug]);
            let _ = conn.execute("DELETE FROM test_runs WHERE repo_slug = ?", [slug]);
        }
        return Ok(0);
    }

    let mut seen_run_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut indexed: i64 = 0;

    for rel in rel_paths.iter() {
        let archived = rel.contains("/.archive/");
        let run_dir_rel = run_publish::run_dir_from_shard_rel(rel).unwrap_or_default();
        if run_dir_rel.is_empty() {
            continue;
        }
        let run_id = run_dir_rel
            .rsplit('/')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        if run_id.is_empty() || !run_publish::validate_run_id_for_dir(&run_id) {
            continue;
        }
        let Some(mut doc) = run_publish::load_run_shards_from_disk(repo_path, &run_id, archived)
        else {
            continue;
        };
        if let Some(obj) = doc.as_object_mut() {
            obj.insert("archived".to_string(), serde_json::Value::Bool(archived));
        }
        seen_run_ids.insert(run_id.clone());

        let conn_arc = open_repo_db(state, slug)?;
        {
            let conn = conn_arc.lock().unwrap();
            let _ = upsert_test_run_from_doc(&conn, slug, &doc, Some(&run_dir_rel));
            let head_rel = run_publish::get_run_head_rel_path_from_run_id(&run_id, archived);
            if let Some(meta) = git_last_commit_meta(repo_path, &head_rel) {
                let _ = apply_run_audit_meta(&conn, slug, &run_id, &meta);
            }
        }
        indexed += 1;
    }

    // Remove stale DB runs not present on disk.
    if let Ok(conn_arc) = open_repo_db(state, slug) {
        let conn = conn_arc.lock().unwrap();
        let existing: Vec<String> = conn
            .prepare("SELECT run_id FROM test_runs WHERE repo_slug = ?")?
            .query_map([slug], |r| r.get(0))?
            .flatten()
            .collect();
        for run_id in existing {
            if !seen_run_ids.contains(&run_id) {
                let _ = conn.execute(
                    "DELETE FROM test_run_case_comments WHERE repo_slug = ?1 AND run_id = ?2",
                    params![slug, run_id],
                );
                let _ = conn.execute(
                    "DELETE FROM test_run_comments WHERE repo_slug = ?1 AND run_id = ?2",
                    params![slug, run_id],
                );
                let _ = conn.execute(
                    "DELETE FROM test_run_results WHERE run_id = ?",
                    params![run_id],
                );
                let _ = conn.execute(
                    "DELETE FROM test_run_cases WHERE repo_slug = ? AND run_id = ?",
                    params![slug, run_id],
                );
                let _ = conn.execute(
                    "DELETE FROM test_runs WHERE repo_slug = ? AND run_id = ?",
                    params![slug, run_id],
                );
            }
        }
    }

    Ok(indexed)
}

/// Unique run_ids referenced by run YAML shard paths (head/cases/results).
pub(crate) fn run_ids_from_yaml_paths(paths: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        let Some(run_id) = run_id_from_staged_path(&p.replace('\\', "/")) else {
            continue;
        };
        if seen.insert(run_id.clone()) {
            out.push(run_id);
        }
    }
    out
}

fn delete_run_rows_from_db(conn: &Connection, repo_slug: &str, run_id: &str) -> Result<()> {
    let _ = conn.execute(
        "DELETE FROM test_run_case_comments WHERE repo_slug = ?1 AND run_id = ?2",
        params![repo_slug, run_id],
    );
    let _ = conn.execute(
        "DELETE FROM test_run_comments WHERE repo_slug = ?1 AND run_id = ?2",
        params![repo_slug, run_id],
    );
    let _ = conn.execute(
        "DELETE FROM test_run_results WHERE run_id = ?",
        params![run_id],
    );
    let _ = conn.execute(
        "DELETE FROM test_run_cases WHERE repo_slug = ? AND run_id = ?",
        params![repo_slug, run_id],
    );
    let _ = conn.execute(
        "DELETE FROM test_runs WHERE repo_slug = ? AND run_id = ?",
        params![repo_slug, run_id],
    );
    Ok(())
}

/// Disk-wins reconcile for selected runs: clear pending flush entries (no DB→YAML write),
/// then rebuild each run from on-disk shards via [`upsert_test_run_from_doc`].
/// Missing shards delete the run from SQLite.
pub(crate) async fn reconcile_runs_from_disk(
    state: &AppState,
    repo_path: &Path,
    slug: &str,
    run_ids: &[String],
) -> Result<()> {
    for run_id in run_ids {
        let run_id = run_id.trim();
        if run_id.is_empty() || !run_publish::validate_run_id_for_dir(run_id) {
            continue;
        }
        let _ = pending_run_yaml::clear_pending_run_yaml_entry(state, slug, run_id);

        let (archived, doc) =
            if let Some(doc) = run_publish::load_run_shards_from_disk(repo_path, run_id, false) {
                (false, Some(doc))
            } else if let Some(doc) =
                run_publish::load_run_shards_from_disk(repo_path, run_id, true)
            {
                (true, Some(doc))
            } else {
                (false, None)
            };

        let conn_arc = open_repo_db(state, slug)?;
        let conn = conn_arc.lock().unwrap();
        match doc {
            Some(mut doc) => {
                if let Some(obj) = doc.as_object_mut() {
                    obj.insert("archived".to_string(), serde_json::Value::Bool(archived));
                }
                let run_dir = run_publish::get_run_dir_rel_path(run_id, archived);
                let _ = upsert_test_run_from_doc(&conn, slug, &doc, Some(&run_dir));
            }
            None => {
                let _ = delete_run_rows_from_db(&conn, slug, run_id);
            }
        }
    }
    Ok(())
}

pub(crate) async fn build_case_entries_for_run(
    state: &AppState,
    repo_path: &Path,
    repo_slug: &str,
    case_specs: Vec<BTreeMap<String, String>>,
) -> Result<Vec<serde_json::Value>> {
    // Read HEAD SHA (best effort).
    let picked_at_sha = git_stdout(repo_path, &["rev-parse", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let conn_arc = open_repo_db(state, repo_slug)?;
    let conn = conn_arc.lock().unwrap();

    let mut out: Vec<serde_json::Value> = Vec::new();
    for item in case_specs {
        let fp = item
            .get("file_path")
            .map(|s| s.trim().replace('\\', "/"))
            .filter(|s| !s.is_empty());
        let Some(fp) = fp else {
            continue;
        };
        if fp.contains("..") || fp.starts_with('/') {
            continue;
        }

        let row: Option<(
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            i32,
        )> = conn
                .query_row(
                    "SELECT case_id, title, tags, priority, requirement_id, automated FROM test_cases WHERE repo_slug = ? AND file_path = ?",
                    params![repo_slug, fp],
                    |r| {
                        Ok((
                            r.get(0)?,
                            r.get(1)?,
                            r.get(2)?,
                            r.get(3)?,
                            r.get(4)?,
                            r.get(5)?,
                        ))
                    },
                )
                .optional()?;
        let Some((case_id_db, title, tags_json, priority, requirement_id, automated)) = row else {
            continue;
        };

        let mut entry = serde_json::Map::new();
        entry.insert("file_path".to_string(), serde_json::Value::String(fp));
        entry.insert("case_id".to_string(), serde_json::Value::String(case_id_db));
        if let Some(t) = title.filter(|s| !s.trim().is_empty()) {
            entry.insert("title".to_string(), serde_json::Value::String(t));
        }
        if let Some(p) = priority.filter(|s| !s.trim().is_empty()) {
            entry.insert("priority".to_string(), serde_json::Value::String(p));
        }
        if let Some(tags) = tags_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
            .filter(|v| !v.is_empty())
        {
            entry.insert(
                "tags".to_string(),
                serde_json::Value::Array(tags.into_iter().map(serde_json::Value::String).collect()),
            );
        }
        if let Some(v) = crate::requirement_ids::requirement_ids_to_json_value(
            &crate::requirement_ids::requirement_ids_from_db(requirement_id.as_deref()),
        ) {
            entry.insert("requirement_ids".to_string(), v);
        }
        if automated != 0 {
            entry.insert("automated".to_string(), serde_json::Value::Bool(true));
        }
        entry.insert(
            "result".to_string(),
            serde_json::Value::String("pending".to_string()),
        );
        if let Some(sha) = picked_at_sha.clone() {
            entry.insert("picked_at_sha".to_string(), serde_json::Value::String(sha));
        }
        out.push(serde_json::Value::Object(entry));
    }
    Ok(out)
}

fn run_id_from_doc(doc: &serde_json::Value) -> Result<&str> {
    let run_id = doc
        .as_object()
        .and_then(|o| o.get("run_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if run_id.is_empty() {
        return Err(anyhow!("Run doc missing run_id"));
    }
    Ok(run_id)
}

/// Upsert `test_runs` row from run doc (YAML source of truth for run metadata).
pub(crate) fn sync_test_run_header_from_doc(
    conn: &Connection,
    repo_slug: &str,
    doc: &serde_json::Value,
) -> Result<()> {
    let obj = doc
        .as_object()
        .ok_or_else(|| anyhow!("Run doc must be an object"))?;
    let run_id = run_id_from_doc(doc)?;
    let run_name = obj
        .get("title")
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("run_name").and_then(|v| v.as_str()))
        .unwrap_or("run")
        .trim()
        .to_string();
    let description = obj
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let created_at = obj
        .get("created_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let updated_at = obj
        .get("updated_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let archived = obj
        .get("archived")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let approve_status = obj
        .get("approve_status")
        .and_then(|v| v.as_str())
        .unwrap_or("draft")
        .trim()
        .to_lowercase();
    let updated_by = obj
        .get("updated_by")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let approved_by = obj
        .get("approved_by")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let approved_at = obj
        .get("approved_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let assigned_to = obj
        .get("assigned_to")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let requirement_id = crate::requirement_ids::requirement_ids_json_for_db(
        &crate::requirement_ids::parse_requirement_ids_from_json_map(obj),
    );
    let release = obj
        .get("release")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    conn.execute(
        r#"
INSERT INTO test_runs
  (run_id, repo_slug, name, description, created_at, updated_at, archived, approve_status, updated_by, approved_by, approved_at, assigned_to, requirement_id, release)
VALUES
  (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
ON CONFLICT(run_id) DO UPDATE SET
  repo_slug = excluded.repo_slug,
  name = excluded.name,
  description = excluded.description,
  updated_at = excluded.updated_at,
  archived = excluded.archived,
  approve_status = excluded.approve_status,
  updated_by = COALESCE(excluded.updated_by, test_runs.updated_by),
  approved_by = excluded.approved_by,
  approved_at = excluded.approved_at,
  assigned_to = excluded.assigned_to,
  requirement_id = excluded.requirement_id,
  release = excluded.release
"#,
        params![
            run_id,
            repo_slug,
            run_name,
            description,
            created_at,
            updated_at,
            if archived { 1 } else { 0 },
            approve_status,
            updated_by,
            approved_by,
            approved_at,
            assigned_to,
            requirement_id,
            release,
        ],
    )?;
    Ok(())
}

/// Stored sentinel for run-case explicit opt-out from run-header assignee.
pub const ASSIGNEE_UNASSIGNED: &str = "__unassigned__";
/// Human-readable label written to run cases YAML and shown in the UI.
pub const ASSIGNEE_UNASSIGNED_LABEL: &str = "Unassigned";
/// Search filter sentinel resolved to the current git `user.name` on the server.
pub const ASSIGNED_TO_ME: &str = "__me__";

pub(crate) fn is_assignee_unassigned(s: &str) -> bool {
    let t = s.trim();
    t == ASSIGNEE_UNASSIGNED || t.eq_ignore_ascii_case(ASSIGNEE_UNASSIGNED_LABEL)
}

/// Normalize assignee from YAML or patch payload into SQLite storage form.
pub(crate) fn normalize_stored_assignee(input: &str) -> Option<String> {
    let t = input.trim();
    if t.is_empty() {
        None
    } else if is_assignee_unassigned(t) {
        Some(ASSIGNEE_UNASSIGNED.to_string())
    } else {
        Some(t.to_string())
    }
}

/// Case-insensitive match key for assignee names (Unicode lowercase).
pub(crate) fn assignee_match_key(s: &str) -> String {
    s.trim().to_lowercase()
}

/// First canonical name per match key (iteration order wins).
pub(crate) fn build_assignee_canonical_map(known: &[String]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for name in known {
        let trimmed = name.trim();
        if trimmed.is_empty() || is_assignee_unassigned(trimmed) {
            continue;
        }
        map.entry(assignee_match_key(trimmed))
            .or_insert_with(|| trimmed.to_string());
    }
    map
}

/// Resolve input to a canonical workspace assignee when case-insensitively known.
pub(crate) fn canonical_assignee(input: &str, known: &[String]) -> Option<String> {
    let t = input.trim();
    if t.is_empty() {
        return None;
    }
    if is_assignee_unassigned(t) {
        return normalize_stored_assignee(t);
    }
    let map = build_assignee_canonical_map(known);
    if let Some(canonical) = map.get(&assignee_match_key(t)) {
        return Some(canonical.clone());
    }
    Some(t.to_string())
}

/// Normalize stored assignee and canonicalize against known workspace names.
pub(crate) fn normalize_stored_assignee_with_canonical(
    input: &str,
    known: &[String],
) -> Option<String> {
    let t = input.trim();
    if t.is_empty() {
        return None;
    }
    if is_assignee_unassigned(t) {
        return normalize_stored_assignee(t);
    }
    canonical_assignee(t, known)
}

/// Deduplicate assignee names case-insensitively, preserving first canonical per key.
pub(crate) fn dedupe_assignees_case_insensitive(names: Vec<String>) -> Vec<String> {
    let map = build_assignee_canonical_map(&names);
    let mut seen_keys = HashSet::new();
    let mut out = Vec::new();
    for name in names {
        let trimmed = name.trim();
        if trimmed.is_empty() || is_assignee_unassigned(trimmed) {
            continue;
        }
        let key = assignee_match_key(trimmed);
        if seen_keys.insert(key) {
            if let Some(canonical) = map.get(&assignee_match_key(trimmed)) {
                out.push(canonical.clone());
            }
        }
    }
    out
}

/// Canonicalize assignee for a repo using workspace usernames as the directory.
pub(crate) fn canonicalize_assignee_for_repo(
    conn: &Connection,
    repo_slug: &str,
    input: &str,
) -> Result<Option<String>> {
    let known = workspace_usernames(conn, repo_slug)?;
    Ok(normalize_stored_assignee_with_canonical(input, &known))
}

/// True when two assignee strings refer to the same person (case-insensitive).
pub(crate) fn assignees_equal_ignore_case(a: Option<&str>, b: Option<&str>) -> bool {
    match (
        a.map(str::trim).filter(|s| !s.is_empty()),
        b.map(str::trim).filter(|s| !s.is_empty()),
    ) {
        (None, None) => true,
        (Some(x), Some(y)) => assignee_match_key(x) == assignee_match_key(y),
        _ => false,
    }
}

/// Write assignee to run cases YAML (sentinel → human label).
pub(crate) fn assignee_to_yaml_value(stored: &str) -> String {
    if stored == ASSIGNEE_UNASSIGNED {
        ASSIGNEE_UNASSIGNED_LABEL.to_string()
    } else {
        stored.to_string()
    }
}

/// Resolve run-case assignee: explicit case value, else run header default.
/// Sentinel on case blocks inheritance from run header.
pub(crate) fn effective_assigned_to(
    case_assigned: Option<&str>,
    run_assigned: Option<&str>,
) -> Option<String> {
    if let Some(case) = case_assigned.map(str::trim).filter(|s| !s.is_empty()) {
        if is_assignee_unassigned(case) {
            return None;
        }
        return Some(case.to_string());
    }
    run_assigned
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// SQL expression for run-case effective assignee (matches `effective_assigned_to`).
pub(crate) fn effective_assignee_sql_expr() -> String {
    format!(
        r#"CASE
  WHEN trc.assigned_to = '{unassigned}' THEN NULL
  WHEN trc.assigned_to IS NOT NULL AND TRIM(trc.assigned_to) != '' THEN TRIM(trc.assigned_to)
  ELSE NULLIF(TRIM(tr.assigned_to), '')
END"#,
        unassigned = ASSIGNEE_UNASSIGNED
    )
}

/// Outcome of resolving an optional assigned-to search param.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AssignedToQueryFilter {
    /// No assigned-to filter applied.
    None,
    /// Filter by exact assignee name.
    Match(String),
    /// Assigned-to filter requested but cannot match (e.g. `__me__` with empty git user).
    NoMatch,
}

/// Resolve optional assigned-to query param for list/search APIs.
pub(crate) fn resolve_assigned_to_query_filter(
    value: Option<&str>,
    git_name: &str,
) -> AssignedToQueryFilter {
    let Some(raw) = value.map(str::trim).filter(|s| !s.is_empty()) else {
        return AssignedToQueryFilter::None;
    };
    if raw == ASSIGNED_TO_ME {
        let name = git_name.trim();
        if name.is_empty() {
            return AssignedToQueryFilter::NoMatch;
        }
        return AssignedToQueryFilter::Match(name.to_string());
    }
    AssignedToQueryFilter::Match(raw.to_string())
}

/// Resolve an optional string field patch for case updates.
/// `None` keeps `existing`; `Some("")` clears; `Some(value)` sets trimmed value.
pub(crate) fn resolve_optional_string_patch(
    incoming: Option<&str>,
    existing: &Option<String>,
) -> Option<String> {
    match incoming {
        None => existing.clone(),
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
    }
}

/// Update run header fields in SQLite (no YAML).
pub(crate) fn update_test_run_header_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    name: Option<&str>,
    description: Option<&str>,
    archived: Option<bool>,
    assigned_to: Option<Option<&str>>,
    requirement_ids: Option<&[String]>,
    release: Option<Option<&str>>,
    updated_by: Option<&str>,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let row: Option<(
        String,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = conn
        .query_row(
            "SELECT name, description, archived, assigned_to, requirement_id, release FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
            params![repo_slug, run_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()?;
    let Some((cur_name, cur_desc, cur_archived_i, cur_assigned_to, cur_requirement_id, cur_release)) =
        row
    else {
        return Err(anyhow!("Run not found"));
    };
    let new_name = name.unwrap_or(&cur_name).trim().to_string();
    let new_desc = match description {
        Some(d) => Some(d.to_string()),
        None => cur_desc,
    };
    let new_archived = archived.unwrap_or(cur_archived_i != 0);
    let new_assigned_to = match assigned_to {
        Some(Some(v)) => {
            let t = v.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        Some(None) => None,
        None => cur_assigned_to,
    };
    let new_requirement_id = match requirement_ids {
        Some(ids) => crate::requirement_ids::requirement_ids_json_for_db(ids),
        None => cur_requirement_id,
    };
    let new_release = match release {
        Some(Some(v)) => {
            let t = v.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        Some(None) => None,
        None => cur_release,
    };
    conn.execute(
        r#"
UPDATE test_runs SET
  name = ?1,
  description = ?2,
  archived = ?3,
  assigned_to = ?4,
  requirement_id = ?5,
  release = ?6,
  updated_at = ?7,
  updated_by = COALESCE(?8, updated_by)
WHERE repo_slug = ?9 AND run_id = ?10
"#,
        params![
            new_name,
            new_desc,
            if new_archived { 1 } else { 0 },
            new_assigned_to,
            new_requirement_id,
            new_release,
            now,
            updated_by,
            repo_slug,
            run_id,
        ],
    )?;
    Ok(())
}

/// Update approval fields in SQLite (no YAML).
pub(crate) fn update_test_run_approval_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    approve_status: &str,
    approved_by: Option<&str>,
    approved_at: Option<&str>,
    updated_by: Option<&str>,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let ap = approve_status.trim().to_lowercase();
    let ap = if ap.is_empty() {
        "draft".to_string()
    } else {
        ap
    };
    conn.execute(
        r#"
UPDATE test_runs SET
  approve_status = ?1,
  approved_by = COALESCE(?2, approved_by),
  approved_at = COALESCE(?3, approved_at),
  updated_at = ?4,
  updated_by = COALESCE(?5, updated_by)
WHERE repo_slug = ?6 AND run_id = ?7
"#,
        params![
            ap,
            approved_by,
            approved_at,
            now,
            updated_by,
            repo_slug,
            run_id
        ],
    )?;
    Ok(())
}

fn tags_from_case_object(co: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    if let Some(arr) = co.get("tags").and_then(|v| v.as_array()) {
        let tags: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect();
        if tags.is_empty() {
            return None;
        }
        return Some(tags_json_for_run_case_db(&tags));
    }
    if let Some(s) = co.get("tags").and_then(|v| v.as_str()) {
        let tags: Vec<String> = s
            .split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        if tags.is_empty() {
            return None;
        }
        return Some(tags_json_for_run_case_db(&tags));
    }
    None
}

fn cache_fields_from_case_object(
    co: &serde_json::Map<String, serde_json::Value>,
    _file_path: &str,
) -> (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    Option<String>,
) {
    let case_id_db = case_str_field(co, "case_id").unwrap_or_default();
    let title_c = case_str_field(co, "title");
    let tags_c = tags_from_case_object(co);
    let priority_c = case_str_field(co, "priority");
    let requirement_c = crate::requirement_ids::requirement_ids_json_for_db(
        &crate::requirement_ids::parse_requirement_ids_from_json_map(co),
    );
    let picked_at_sha = co
        .get("picked_at_sha")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let content_snapshot = co
        .get("_content_snapshot")
        .and_then(|v| v.as_str())
        .or_else(|| co.get("content_snapshot").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();

    (
        case_id_db,
        title_c,
        tags_c,
        priority_c,
        requirement_c,
        content_snapshot,
        picked_at_sha,
    )
}

fn case_str_field(co: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    co.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn automated_from_case_object(co: &serde_json::Map<String, serde_json::Value>) -> bool {
    co.get("automated")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Read execution actor from case map (`executed_by`, or legacy `added_by` in old YAML).
fn executed_by_from_case(co: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    case_str_field(co, "executed_by").or_else(|| case_str_field(co, "added_by"))
}

fn upsert_run_case_row(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_path: &str,
    co: &serde_json::Map<String, serde_json::Value>,
) -> Result<()> {
    let (case_id_db, title_c, tags_c, priority_c, requirement_c, content_snapshot, picked_at_sha) =
        cache_fields_from_case_object(co, file_path);
    let executed_at = case_str_field(co, "executed_at").unwrap_or_else(|| Utc::now().to_rfc3339());
    let executed_by = executed_by_from_case(co);
    let assigned_to = case_str_field(co, "assigned_to").and_then(|s| normalize_stored_assignee(&s));
    let automated = i32::from(automated_from_case_object(co));

    conn.execute(
        r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, picked_at_sha, content_snapshot, executed_at,
   title, tags, priority, requirement_id, executed_by, assigned_to, automated)
VALUES
  (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
ON CONFLICT(run_id, file_path) DO UPDATE SET
  case_id = excluded.case_id,
  picked_at_sha = excluded.picked_at_sha,
  content_snapshot = excluded.content_snapshot,
  executed_at = excluded.executed_at,
  title = excluded.title,
  tags = excluded.tags,
  priority = excluded.priority,
  requirement_id = excluded.requirement_id,
  executed_by = COALESCE(excluded.executed_by, test_run_cases.executed_by),
  assigned_to = excluded.assigned_to,
  automated = excluded.automated
"#,
        params![
            run_id,
            repo_slug,
            file_path,
            case_id_db,
            picked_at_sha,
            content_snapshot,
            executed_at,
            title_c,
            tags_c,
            priority_c,
            requirement_c,
            executed_by,
            assigned_to,
            automated,
        ],
    )?;
    Ok(())
}

fn sync_run_result_for_case(
    conn: &Connection,
    run_id: &str,
    file_path: &str,
    co: &serde_json::Map<String, serde_json::Value>,
) -> Result<()> {
    let result = co
        .get("result")
        .and_then(|v| v.as_str())
        .unwrap_or("pending")
        .trim();
    if result == "pending" {
        conn.execute(
            "DELETE FROM test_run_results WHERE run_id = ? AND file_path = ?",
            params![run_id, file_path],
        )?;
        let case_executed_at = case_str_field(co, "executed_at");
        let case_executed_by = executed_by_from_case(co);
        if case_executed_at.is_some() || case_executed_by.is_some() {
            let _ = conn.execute(
                r#"
UPDATE test_run_cases SET
  executed_at = COALESCE(?1, executed_at),
  executed_by = COALESCE(?2, executed_by)
WHERE run_id = ?3 AND file_path = ?4
"#,
                params![case_executed_at, case_executed_by, run_id, file_path],
            );
        }
        return Ok(());
    }
    let executed_at = co
        .get("executed_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let comment = co
        .get("comment")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    conn.execute(
        r#"
INSERT INTO test_run_results
  (run_id, file_path, result, executed_at, comment)
VALUES
  (?1, ?2, ?3, ?4, ?5)
ON CONFLICT(run_id, file_path) DO UPDATE SET
  result = excluded.result,
  executed_at = excluded.executed_at,
  comment = excluded.comment
"#,
        params![run_id, file_path, result, executed_at, comment],
    )?;
    Ok(())
}

/// Sync run header and all case results from doc; does not modify `test_run_cases` rows.
#[cfg(test)]
pub(crate) fn sync_run_results_from_doc(
    conn: &Connection,
    repo_slug: &str,
    doc: &serde_json::Value,
) -> Result<()> {
    sync_test_run_header_from_doc(conn, repo_slug, doc)?;
    let run_id = run_id_from_doc(doc)?;
    let cases = doc
        .as_object()
        .and_then(|o| o.get("cases"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for c in cases {
        let co = c.as_object().cloned().unwrap_or_default();
        let file_path = co
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if file_path.is_empty() {
            continue;
        }
        sync_run_result_for_case(conn, run_id, file_path, &co)?;
        if let Some(eb) = executed_by_from_case(&co) {
            let _ = conn.execute(
                "UPDATE test_run_cases SET executed_by = ?1 WHERE run_id = ?2 AND file_path = ?3",
                params![eb, run_id, file_path],
            );
        }
    }
    Ok(())
}

/// Stamped result row after a DB-first write.
#[derive(Debug, Clone)]
pub(crate) struct DbRunResultStamp {
    pub file_path: String,
    pub result: String,
    pub executed_at: String,
    pub executed_by: Option<String>,
    pub comment: Option<String>,
}

fn touch_test_run_header_after_result(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    updated_by: Option<&str>,
    review_enabled: bool,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    if review_enabled {
        conn.execute(
            r#"
UPDATE test_runs SET
  updated_at = ?1,
  updated_by = COALESCE(?2, updated_by),
  approve_status = 'draft'
WHERE repo_slug = ?3 AND run_id = ?4
"#,
            params![now, updated_by, repo_slug, run_id],
        )?;
    } else {
        conn.execute(
            r#"
UPDATE test_runs SET
  updated_at = ?1,
  updated_by = COALESCE(?2, updated_by)
WHERE repo_slug = ?3 AND run_id = ?4
"#,
            params![now, updated_by, repo_slug, run_id],
        )?;
    }
    Ok(())
}

/// Write a single run result directly to SQLite (hot path; no YAML).
pub(crate) fn set_run_result_in_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_path: &str,
    result: &str,
    comment: Option<&str>,
    executed_by: Option<&str>,
    review_enabled: bool,
) -> Result<Option<DbRunResultStamp>> {
    let fp = file_path.trim().replace('\\', "/");
    if fp.is_empty() {
        return Err(anyhow!("file_path is required"));
    }

    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM test_run_cases WHERE run_id = ?1 AND repo_slug = ?2 AND file_path = ?3",
            params![run_id, repo_slug, fp],
            |r| r.get::<_, i32>(0),
        )
        .optional()?
        .is_some();
    if !exists {
        return Ok(None);
    }

    let result_norm = result.trim().to_lowercase();
    let now = Utc::now().to_rfc3339();
    let eb = executed_by.map(str::trim).filter(|s| !s.is_empty());

    if result_norm.is_empty() || result_norm == "pending" {
        conn.execute(
            "DELETE FROM test_run_results WHERE run_id = ?1 AND file_path = ?2",
            params![run_id, fp],
        )?;
        if let Some(name) = eb {
            let _ = conn.execute(
                "UPDATE test_run_cases SET executed_by = ?1 WHERE run_id = ?2 AND file_path = ?3",
                params![name, run_id, fp],
            );
        }
        touch_test_run_header_after_result(conn, repo_slug, run_id, eb, review_enabled)?;
        return Ok(Some(DbRunResultStamp {
            file_path: fp,
            result: "pending".to_string(),
            executed_at: now,
            executed_by: eb.map(|s| s.to_string()),
            comment: None,
        }));
    }

    let comment_s = comment
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let comment_for_db = comment_s.clone();
    conn.execute(
        r#"
INSERT INTO test_run_results
  (run_id, file_path, result, executed_at, comment)
VALUES
  (?1, ?2, ?3, ?4, ?5)
ON CONFLICT(run_id, file_path) DO UPDATE SET
  result = excluded.result,
  executed_at = excluded.executed_at,
  comment = excluded.comment
"#,
        params![run_id, fp, result_norm, now, comment_for_db],
    )?;
    let _ = conn.execute(
        r#"
UPDATE test_run_cases SET
  executed_at = ?1,
  executed_by = COALESCE(?2, executed_by)
WHERE run_id = ?3 AND file_path = ?4
"#,
        params![now, eb, run_id, fp],
    );
    touch_test_run_header_after_result(conn, repo_slug, run_id, eb, review_enabled)?;

    Ok(Some(DbRunResultStamp {
        file_path: fp,
        result: result_norm,
        executed_at: now,
        executed_by: eb.map(|s| s.to_string()),
        comment: comment_s,
    }))
}

pub(crate) fn build_run_result_header_patch(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<models::RunResultHeaderPatch> {
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT updated_at, updated_by FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
            params![repo_slug, run_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((updated_at, updated_by)) = row else {
        return Err(anyhow!("Run not found"));
    };
    let (_total, passed, failed, skipped) = run_result_counts(conn, run_id)?;
    Ok(models::RunResultHeaderPatch {
        passed,
        failed,
        skipped,
        updated_at,
        updated_by,
    })
}

pub(crate) fn db_stamp_to_model(stamp: DbRunResultStamp) -> models::RunResultCaseStamp {
    models::RunResultCaseStamp {
        file_path: stamp.file_path,
        result: stamp.result,
        executed_at: stamp.executed_at,
        executed_by: stamp.executed_by,
        comment: stamp.comment,
    }
}

/// Batch DB-first result writes; returns stamped rows and header patch.
pub(crate) fn set_run_results_batch_in_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    items: &[models::RunResultItem],
    executed_by: Option<&str>,
    review_enabled: bool,
) -> Result<models::SetRunResultsBatchResponse> {
    let mut stamped: Vec<models::RunResultCaseStamp> = Vec::new();
    let mut updated = 0usize;
    for it in items {
        if let Some(s) = set_run_result_in_db(
            conn,
            repo_slug,
            run_id,
            &it.file_path,
            &it.result,
            None,
            executed_by,
            review_enabled,
        )? {
            stamped.push(db_stamp_to_model(s));
            updated += 1;
        }
    }
    let run = build_run_result_header_patch(conn, repo_slug, run_id)?;
    Ok(models::SetRunResultsBatchResponse {
        status: "ok".to_string(),
        updated,
        run,
        cases: stamped,
    })
}

/// Import results from a `.results.md` doc into SQLite (pull / incremental index).
///
/// Sparse YAML only lists non-pending results: this **replaces** all DB results for the
/// run (delete then apply map) and clears execution meta on member cases absent from the map.
///
/// Callers that load this doc from disk must call `flush_pending_run_yaml_before_index`
/// first so pending DB results are on disk and are not overwritten by a stale file
/// (unless the caller intentionally wants disk-wins and has cleared pending).
pub(crate) fn sync_run_results_from_results_yaml_doc(
    conn: &Connection,
    repo_slug: &str,
    results_doc: &serde_json::Value,
) -> Result<()> {
    let run_id = results_doc
        .get("run_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if run_id.is_empty() {
        return Err(anyhow!("results doc missing run_id"));
    }

    // Audit fields are SQLite-owned; do not copy updated_* from results YAML.
    // Legacy `results_revision` keys in YAML (if present) are ignored.

    let results_map = results_doc
        .get("results")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    conn.execute(
        "DELETE FROM test_run_results WHERE run_id = ?",
        params![run_id],
    )?;

    for (fp, r) in &results_map {
        if !run_case_path_is_member(conn, repo_slug, &run_id, fp)? {
            continue;
        }
        let mut co = r.as_object().cloned().unwrap_or_default();
        co.insert(
            "file_path".to_string(),
            serde_json::Value::String(fp.clone()),
        );
        sync_run_result_for_case(conn, &run_id, fp, &co)?;
        if let Some(eb) = executed_by_from_case(&co) {
            let _ = conn.execute(
                "UPDATE test_run_cases SET executed_by = ?1 WHERE run_id = ?2 AND file_path = ?3",
                params![eb, run_id, fp],
            );
        }
    }

    // Paths not in sparse results.md are pending: clear execution stamps.
    let member_paths: Vec<String> = conn
        .prepare(
            "SELECT file_path FROM test_run_cases WHERE repo_slug = ?1 AND run_id = ?2",
        )?
        .query_map(params![repo_slug, run_id], |r| r.get(0))?
        .flatten()
        .collect();
    for fp in member_paths {
        if results_map.contains_key(&fp) {
            continue;
        }
        let _ = conn.execute(
            r#"
UPDATE test_run_cases
SET executed_at = NULL, executed_by = NULL
WHERE repo_slug = ?1 AND run_id = ?2 AND file_path = ?3
"#,
            params![repo_slug, run_id, fp],
        );
    }

    prune_orphan_run_results(conn, repo_slug, &run_id)?;
    Ok(())
}

/// Insert new run-case rows from in-memory entries; skips existing paths.
pub(crate) fn insert_run_cases_from_entries(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    entries: &[serde_json::Value],
) -> Result<usize> {
    let mut added = 0usize;
    for e in entries {
        let co = e.as_object().cloned().unwrap_or_default();
        let file_path = co
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if file_path.is_empty() {
            continue;
        }
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo_slug, run_id, file_path],
                |_| Ok(1),
            )
            .optional()?
            .is_some();
        if exists {
            let case_executed_at = case_str_field(&co, "executed_at");
            let case_executed_by = executed_by_from_case(&co);
            if case_executed_at.is_some() || case_executed_by.is_some() {
                let _ = conn.execute(
                    r#"
UPDATE test_run_cases SET
  executed_at = COALESCE(?1, executed_at),
  executed_by = COALESCE(?2, executed_by)
WHERE repo_slug = ?3 AND run_id = ?4 AND file_path = ?5
"#,
                    params![
                        case_executed_at,
                        case_executed_by,
                        repo_slug,
                        run_id,
                        file_path
                    ],
                );
            }
            continue;
        }
        upsert_run_case_row(conn, repo_slug, run_id, file_path, &co)?;
        sync_run_result_for_case(conn, run_id, file_path, &co)?;
        added += 1;
    }
    Ok(added)
}

pub(crate) fn run_case_path_is_member(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_path: &str,
) -> Result<bool> {
    let fp = file_path.trim();
    if fp.is_empty() {
        return Ok(false);
    }
    Ok(conn
        .query_row(
            "SELECT 1 FROM test_run_cases WHERE repo_slug = ?1 AND run_id = ?2 AND file_path = ?3",
            params![repo_slug, run_id, fp],
            |_| Ok(1),
        )
        .optional()?
        .is_some())
}

/// Drop result rows whose file_path is no longer in run membership.
pub(crate) fn prune_orphan_run_results(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<()> {
    conn.execute(
        r#"
DELETE FROM test_run_results
WHERE run_id = ?1
  AND file_path NOT IN (
    SELECT file_path FROM test_run_cases WHERE repo_slug = ?2 AND run_id = ?1
  )
"#,
        params![run_id, repo_slug],
    )?;
    Ok(())
}

/// Remove run-case and result rows for the given paths only.
/// Returns how many `test_run_results` rows were deleted.
pub(crate) fn delete_run_cases_by_paths(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_paths: &[String],
) -> Result<usize> {
    let mut results_deleted = 0usize;
    for file_path in file_paths {
        let fp = file_path.trim();
        if fp.is_empty() {
            continue;
        }
        conn.execute(
            "DELETE FROM test_run_results WHERE run_id = ? AND file_path = ?",
            params![run_id, fp],
        )?;
        results_deleted += conn.changes() as usize;
        conn.execute(
            "DELETE FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
            params![repo_slug, run_id, fp],
        )?;
        let _ = delete_run_case_comments_for_paths(conn, repo_slug, run_id, &[fp.to_string()]);
    }
    Ok(results_deleted)
}

/// Full rebuild of run cases/results from doc (indexing, create, duplicate, restore).
pub(crate) fn upsert_test_run_from_doc(
    conn: &Connection,
    repo_slug: &str,
    doc: &serde_json::Value,
    yaml_rel_path: Option<&str>,
) -> Result<()> {
    sync_test_run_header_from_doc(conn, repo_slug, doc)?;
    let run_id = run_id_from_doc(doc)?;

    conn.execute(
        "DELETE FROM test_run_cases WHERE repo_slug = ? AND run_id = ?",
        params![repo_slug, run_id],
    )?;
    conn.execute(
        "DELETE FROM test_run_results WHERE run_id = ?",
        params![run_id],
    )?;

    let cases = doc
        .as_object()
        .and_then(|o| o.get("cases"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for c in cases {
        let co = c.as_object().cloned().unwrap_or_default();
        let file_path = co
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if file_path.is_empty() {
            continue;
        }
        upsert_run_case_row(conn, repo_slug, run_id, file_path, &co)?;
        sync_run_result_for_case(conn, run_id, file_path, &co)?;
    }

    import_run_comments_from_doc(conn, repo_slug, &run_id, doc)?;

    let archived = doc
        .get("archived")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let run_dir = yaml_rel_path
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_end_matches('/').to_string())
        .unwrap_or_else(|| run_publish::get_run_dir_rel_path(&run_id, archived));
    let _ = set_run_dir_path_db(conn, &run_id, &run_dir);
    Ok(())
}

pub(crate) fn get_test_run_list_item(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<Option<models::RunListItem>> {
    let row: Option<(
        i64,
        String,
        String,
        String,
        Option<String>,
        String,
        String,
        Option<String>,
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = conn
        .query_row(
            r#"
SELECT id, run_id, repo_slug, name, description, created_at, updated_at, updated_by, archived, approve_status, approved_by, approved_at, assigned_to, requirement_id, release
FROM test_runs
WHERE repo_slug = ? AND run_id = ?
"#,
            params![repo_slug, run_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                    r.get(12)?,
                    r.get(13)?,
                    r.get(14)?,
                ))
            },
        )
        .optional()?;
    let Some((
        id,
        run_id,
        repo_slug,
        name,
        description,
        created_at,
        updated_at,
        updated_by,
        archived_i,
        approve_status,
        approved_by,
        approved_at,
        assigned_to,
        requirement_id,
        release,
    )) = row
    else {
        return Ok(None);
    };

    let (total_cases, passed, failed, skipped) = run_result_counts(conn, &run_id)?;
    let status = if total_cases == 0 {
        "not_started".to_string()
    } else if failed > 0 {
        "failed".to_string()
    } else if passed + skipped == total_cases {
        "passed".to_string()
    } else {
        "in_progress".to_string()
    };

    Ok(Some(models::RunListItem {
        id,
        run_id: run_id.clone(),
        repo_slug,
        name,
        description: description.unwrap_or_default(),
        created_at,
        updated_at,
        updated_by,
        total_cases,
        passed,
        failed,
        skipped,
        status,
        archived: archived_i != 0,
        approve_status,
        approved_by,
        approved_at,
        assigned_to,
        requirement_ids: crate::requirement_ids::requirement_ids_from_db(requirement_id.as_deref()),
        release: release.filter(|s| !s.trim().is_empty()),
        comments: vec![],
    }))
}

fn run_result_counts(conn: &Connection, run_id: &str) -> Result<(i64, i64, i64, i64)> {
    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM test_run_cases WHERE run_id = ?",
            [run_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let passed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM test_run_results WHERE run_id = ? AND result = 'passed'",
            [run_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let failed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM test_run_results WHERE run_id = ? AND result = 'failed'",
            [run_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let skipped: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM test_run_results WHERE run_id = ? AND result = 'skipped'",
            [run_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok((total, passed, failed, skipped))
}

pub(crate) fn list_test_runs(
    conn: &Connection,
    repo_slug: &str,
) -> Result<Vec<models::RunListItem>> {
    let mut stmt = conn.prepare(
        r#"
SELECT id, run_id, repo_slug, name, description, created_at, updated_at, updated_by, archived, approve_status, approved_by, approved_at, assigned_to, requirement_id, release
FROM test_runs
WHERE repo_slug = ?
ORDER BY updated_at DESC
"#,
    )?;
    let rows = stmt.query_map([repo_slug], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, Option<String>>(7)?,
            r.get::<_, i64>(8)?,
            r.get::<_, String>(9)?,
            r.get::<_, Option<String>>(10)?,
            r.get::<_, Option<String>>(11)?,
            r.get::<_, Option<String>>(12)?,
            r.get::<_, Option<String>>(13)?,
            r.get::<_, Option<String>>(14)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows.flatten() {
        let (
            id,
            run_id,
            repo_slug,
            name,
            description,
            created_at,
            updated_at,
            updated_by,
            archived_i,
            approve_status,
            approved_by,
            approved_at,
            assigned_to,
            requirement_id,
            release,
        ) = r;
        let (total_cases, passed, failed, skipped) =
            run_result_counts(conn, &run_id).unwrap_or((0, 0, 0, 0));
        let status = if total_cases == 0 {
            "not_started".to_string()
        } else if failed > 0 {
            "failed".to_string()
        } else if passed + skipped == total_cases {
            "passed".to_string()
        } else {
            "in_progress".to_string()
        };
        out.push(models::RunListItem {
            id,
            run_id,
            repo_slug,
            name,
            description: description.unwrap_or_default(),
            created_at,
            updated_at,
            updated_by,
            total_cases,
            passed,
            failed,
            skipped,
            status,
            archived: archived_i != 0,
            approve_status,
            approved_by,
            approved_at,
            assigned_to,
            requirement_ids: crate::requirement_ids::requirement_ids_from_db(
                requirement_id.as_deref(),
            ),
            release: release.filter(|s| !s.trim().is_empty()),
            comments: vec![],
        });
    }
    Ok(out)
}

pub(crate) fn get_run_detail(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    include_cases: bool,
    include_case_comments: bool,
) -> Result<Option<models::RunDetailResponse>> {
    let mut run = match get_test_run_list_item(conn, repo_slug, run_id)? {
        Some(r) => r,
        None => return Ok(None),
    };

    run.comments = load_run_comments(conn, repo_slug, run_id)?;

    if !include_cases {
        return Ok(Some(models::RunDetailResponse { run, cases: vec![] }));
    }

    // Load cases from DB with results in one query (LEFT JOIN).
    let mut stmt = conn.prepare(
        r#"
SELECT trc.id, trc.run_id, trc.file_path, trc.case_id, trc.executed_at,
       trc.title, trc.tags, trc.priority, trc.requirement_id, trc.automated, trc.executed_by, trc.assigned_to,
       trr.result, trr.executed_at AS result_executed_at, trr.comment
FROM test_run_cases trc
LEFT JOIN test_run_results trr
  ON trr.run_id = trc.run_id AND trr.file_path = trc.file_path
WHERE trc.run_id = ? AND trc.repo_slug = ?
ORDER BY trc.id ASC
"#,
    )?;
    let rows = stmt.query_map(params![run_id, repo_slug], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, Option<String>>(7)?,
            r.get::<_, Option<String>>(8)?,
            r.get::<_, i32>(9)?,
            r.get::<_, Option<String>>(10)?,
            r.get::<_, Option<String>>(11)?,
            r.get::<_, Option<String>>(12)?,
            r.get::<_, Option<String>>(13)?,
            r.get::<_, Option<String>>(14)?,
        ))
    })?;

    let mut cases: Vec<models::RunCaseItem> = Vec::new();
    for rr in rows.flatten() {
        let (
            id,
            run_id_s,
            file_path,
            case_id,
            case_executed_at,
            title,
            tags_json,
            priority,
            requirement_id,
            automated,
            case_executed_by,
            case_assigned_to,
            result,
            result_executed_at,
            comment,
        ) = rr;
        let executed_at = result_executed_at.or(case_executed_at);

        let tags: Vec<String> = tags_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
            .unwrap_or_default();
        let directory = directory_from_file_path(&file_path);
        let effective =
            effective_assigned_to(case_assigned_to.as_deref(), run.assigned_to.as_deref());

        cases.push(models::RunCaseItem {
            id,
            run_id: run_id_s,
            file_path,
            case_id,
            title,
            priority,
            status: None,
            tags,
            requirement_ids: crate::requirement_ids::requirement_ids_from_db(
                requirement_id.as_deref(),
            ),
            automated: automated != 0,
            result,
            executed_at,
            comment,
            executed_by: case_executed_by,
            assigned_to: case_assigned_to,
            effective_assigned_to: effective,
            directory,
            comments: vec![],
        });
    }

    if include_case_comments && !cases.is_empty() {
        let paths: Vec<String> = cases.iter().map(|c| c.file_path.clone()).collect();
        let comments_by_path = load_run_case_comments_for_paths(conn, repo_slug, run_id, &paths)?;
        for case in &mut cases {
            if let Some(cm) = comments_by_path.get(&case.file_path) {
                case.comments = cm.clone();
            }
        }
    }

    Ok(Some(models::RunDetailResponse { run, cases }))
}

pub(crate) struct CaseEntityIndexer {
    pub(crate) conn: Arc<Mutex<Connection>>,
    pub(crate) audit: AuditStampSource,
}

fn discover_yaml_files_rec(
    root: &Path,
    repo_path: &Path,
    ignore_dirs: &HashSet<&str>,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn visit(out: &mut Vec<PathBuf>, dir: &Path, repo_path: &Path, ignore_dirs: &HashSet<&str>) {
        let parent_rel = file_rel_from_repo(repo_path, dir);
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if p.is_dir() {
                if should_skip_case_scan_dir(&parent_rel, &name, ignore_dirs) {
                    continue;
                }
                visit(out, &p, repo_path, ignore_dirs);
                continue;
            }
            if p
                .extension()
                .and_then(|s| s.to_str())
                .is_some_and(crate::paths::is_workspace_doc_ext)
            {
                out.push(p);
            }
        }
    }
    visit(&mut out, root, repo_path, ignore_dirs);
    out
}

impl file_truth_framework::EntityIndexer for CaseEntityIndexer {
    type Entity = UpsertCaseArgs;

    fn discover_files(&self, repo_path: &Path) -> Vec<PathBuf> {
        let cases_root = repo_path.join(".gitoza/test/cases");
        if !cases_root.is_dir() {
            return vec![];
        }
        let ignore: HashSet<&str> = CASE_TREE_IGNORE_DIRS.iter().copied().collect();
        discover_yaml_files_rec(&cases_root, repo_path, &ignore)
    }

    fn parse_file(
        &self,
        file_path: &Path,
        repo_path: &Path,
        repo_slug: &str,
    ) -> Result<Option<(String, Self::Entity)>> {
        let d = match read_full_yaml(file_path)? {
            Some(x) => x,
            None => return Ok(None),
        };

        let file_rel = file_rel_from_repo(repo_path, file_path);
        let directory = directory_from_file_path(&file_rel);
        if directory.is_empty() {
            return Ok(None);
        }

        let tags_for_db = normalize_tags_for_storage(d.tags.clone());
        let (updated_at, updated_by) = self.audit.resolve(&file_rel);
        let args = UpsertCaseArgs {
            case_id: d.case_id,
            title: d.title,
            tags: tags_for_db,
            status: d.status.clone(),
            priority: d.priority,
            file_path: file_rel.clone(),
            repo_slug: repo_slug.to_string(),
            directory,
            approve_status: d.approve_status,
            updated_at,
            updated_by,
            approved_by: d.approved_by,
            approved_at: d.approved_at,
            requirement_id: crate::requirement_ids::requirement_ids_json_for_db(&d.requirement_ids),
            assigned_to: d.assigned_to,
            automated: d.automated,
            params: normalize_params_for_storage(d.params.clone()),
        };
        Ok(Some((file_rel, args)))
    }

    fn upsert_entities(&self, _repo_slug: &str, entities: &[Self::Entity]) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let mut n = 0i64;
        for e in entities {
            if upsert_case_db(
                &conn,
                UpsertCaseArgs {
                    case_id: e.case_id.clone(),
                    title: e.title.clone(),
                    tags: e.tags.clone(),
                    status: e.status.clone(),
                    priority: e.priority.clone(),
                    file_path: e.file_path.clone(),
                    repo_slug: e.repo_slug.clone(),
                    directory: e.directory.clone(),
                    approve_status: e.approve_status.clone(),
                    updated_at: e.updated_at.clone(),
                    updated_by: e.updated_by.clone(),
                    approved_by: e.approved_by.clone(),
                    approved_at: e.approved_at.clone(),
                    requirement_id: e.requirement_id.clone(),
                    assigned_to: e.assigned_to.clone(),
                    automated: e.automated,
                    params: e.params.clone(),
                },
            )
            .is_ok()
            {
                n += 1;
            }
        }
        Ok(n)
    }

    fn remove_stale(&self, repo_slug: &str, current_ids: &HashSet<String>) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        // Simpler (but O(n)): delete rows not in current_ids by scanning DB.
        let mut stmt = conn.prepare("SELECT file_path FROM test_cases WHERE repo_slug = ?")?;
        let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
        let mut removed = 0i64;
        for r in rows.flatten() {
            if !current_ids.contains(&r) {
                if conn
                    .execute(
                        "DELETE FROM test_cases WHERE repo_slug = ? AND file_path = ?",
                        params![repo_slug, r],
                    )
                    .is_ok()
                {
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }
}

/// JSON path for `json_extract(params, ?)` given a flat params object key.
pub(crate) fn json_path_for_param_key(key: &str) -> String {
    let trimmed = key.trim();
    if trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        format!("$.{trimmed}")
    } else {
        let escaped = trimmed.replace('\\', "\\\\").replace('"', "\\\"");
        format!("$.\"{escaped}\"")
    }
}

#[derive(Debug)]
pub(crate) struct QueryCasesArgs {
    pub(crate) search: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) priority: Option<String>,
    pub(crate) tag: Option<String>,
    pub(crate) directory: Option<String>,
    pub(crate) directories: Option<Vec<String>>,
    pub(crate) path_prefix: Option<String>,
    pub(crate) approve_status: Option<String>,
    pub(crate) updated_by: Option<String>,
    pub(crate) assigned_to: Option<String>,
    pub(crate) requirement_id: Option<String>,
    pub(crate) automated: Option<bool>,
    pub(crate) param_filters: Option<Vec<(String, String)>>,
    pub(crate) exclude_archived: bool,
    pub(crate) sort_by: String,
    pub(crate) sort_dir: String,
    pub(crate) limit: i64,
    pub(crate) offset: i64,
}

/// Shared WHERE clause for `query_cases_db` list + count queries.
pub(crate) fn build_query_cases_conditions(
    repo_slug: &str,
    args: &QueryCasesArgs,
    archived_only: bool,
) -> (String, Vec<rusqlite::types::Value>) {
    let mut conditions: Vec<String> = vec!["repo_slug = ?".to_string()];
    let mut params_vec: Vec<rusqlite::types::Value> = vec![repo_slug.to_string().into()];

    if archived_only {
        conditions.push("file_path LIKE ?".to_string());
        params_vec.push(format!("{}%", CASES_ARCHIVE_PREFIX).into());
    } else if args.exclude_archived {
        conditions.push("file_path NOT LIKE ?".to_string());
        params_vec.push(format!("{}%", CASES_ARCHIVE_PREFIX).into());
    }

    if let Some(s) = args.search.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("(case_id LIKE ? OR title LIKE ? OR tags LIKE ?)".to_string());
        let like = format!("%{}%", s.trim());
        params_vec.push(like.clone().into());
        params_vec.push(like.clone().into());
        params_vec.push(like.into());
    }
    if let Some(s) = args.status.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("status = ?".to_string());
        params_vec.push(s.clone().into());
    }
    if let Some(s) = args.priority.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("priority = ?".to_string());
        params_vec.push(s.clone().into());
    }
    if let Some(s) = args.tag.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(tags) LIKE ?".to_string());
        params_vec.push(format!("%\"{}\"%", s.trim().to_lowercase()).into());
    }
    if let Some(prefix) = args.path_prefix.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("file_path LIKE ?".to_string());
        let pattern = format!("{}/%", prefix.trim_end_matches('/'));
        params_vec.push(pattern.into());
    } else if let Some(dirs) = args.directories.as_ref().filter(|v| !v.is_empty()) {
        let placeholders = vec!["?"; dirs.len()].join(",");
        conditions.push(format!("directory IN ({placeholders})"));
        for d in dirs {
            params_vec.push(d.clone().into());
        }
    } else if let Some(d) = args.directory.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("directory = ?".to_string());
        params_vec.push(d.clone().into());
    }
    if let Some(ap) = args.approve_status.as_ref() {
        let v = ap.trim().to_lowercase();
        let v = if v.is_empty() { "draft".to_string() } else { v };
        conditions.push("LOWER(TRIM(COALESCE(approve_status, 'draft'))) = ?".to_string());
        params_vec.push(v.into());
    }
    if let Some(s) = args.updated_by.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("updated_by LIKE ?".to_string());
        params_vec.push(format!("%{}%", s.trim()).into());
    }
    if let Some(s) = args.assigned_to.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(TRIM(assigned_to)) = LOWER(?)".to_string());
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(s) = args
        .requirement_id
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        conditions.push(crate::requirement_ids::sql_requirement_id_contains(
            "requirement_id",
        ));
        let needle = s.trim().to_string();
        params_vec.push(needle.clone().into());
        params_vec.push(needle.into());
    }
    if let Some(automated) = args.automated {
        conditions.push("automated = ?".to_string());
        params_vec.push(i32::from(automated).into());
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

    (conditions.join(" AND "), params_vec)
}

fn map_case_list_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<models::YamlCaseListItem> {
    let tags_raw: Option<String> = row.get("tags")?;
    let tags: Vec<String> = tags_raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default();
    let ap: Option<String> = row.get("approve_status")?;
    Ok(models::YamlCaseListItem {
        case_id: row.get("case_id")?,
        title: row.get("title")?,
        tags,
        status: row.get("status")?,
        priority: row.get("priority")?,
        file_path: row.get("file_path")?,
        repo_slug: row.get("repo_slug")?,
        directory: row.get("directory")?,
        indexed_at: row.get("indexed_at")?,
        approve_status: ap
            .unwrap_or_else(|| "draft".to_string())
            .trim()
            .to_lowercase(),
        updated_at: row.get("updated_at")?,
        updated_by: row.get("updated_by")?,
        approved_by: row.get("approved_by")?,
        approved_at: row.get("approved_at")?,
        requirement_ids: crate::requirement_ids::requirement_ids_from_db(
            row.get::<_, Option<String>>("requirement_id")?.as_deref(),
        ),
        assigned_to: row.get("assigned_to")?,
        automated: row.get::<_, i32>("automated").unwrap_or(0) != 0,
    })
}

pub(crate) fn query_cases_db(
    conn: &Connection,
    repo_slug: &str,
    args: QueryCasesArgs,
    archived_only: bool,
) -> Result<(Vec<models::YamlCaseListItem>, i64)> {
    let allowed_sort = HashSet::from([
        "case_id".to_string(),
        "title".to_string(),
        "status".to_string(),
        "priority".to_string(),
        "updated_at".to_string(),
        "indexed_at".to_string(),
    ]);
    let sort_by = if allowed_sort.contains(&args.sort_by) {
        args.sort_by.clone()
    } else {
        "case_id".to_string()
    };
    let direction = if args.sort_dir.eq_ignore_ascii_case("desc") {
        "DESC"
    } else {
        "ASC"
    };

    let (where_sql, mut filter_params) =
        build_query_cases_conditions(repo_slug, &args, archived_only);

    let count_sql = format!("SELECT COUNT(*) FROM test_cases WHERE {where_sql}");
    let total: i64 = conn
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(filter_params.iter()),
            |row| row.get(0),
        )
        .unwrap_or(0);

    let sql = format!(
        r#"
SELECT case_id, title, tags, status, priority,
       file_path, repo_slug, directory, indexed_at, approve_status,
       updated_at, updated_by, approved_by, approved_at, requirement_id, assigned_to, automated
FROM test_cases
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
        map_case_list_row,
    )?;
    let items: Vec<models::YamlCaseListItem> = rows.filter_map(|r| r.ok()).collect();

    Ok((items, total))
}

pub(crate) fn distinct_values(
    conn: &Connection,
    repo_slug: &str,
    column: &str,
) -> Result<Vec<String>> {
    let allowed = ["status", "priority", "directory"];
    if !allowed.contains(&column) {
        return Ok(vec![]);
    }
    let sql = format!(
        "SELECT DISTINCT {column} FROM test_cases WHERE repo_slug = ? AND {column} IS NOT NULL ORDER BY {column}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    let mut out: Vec<String> = rows.filter_map(|r| r.ok()).collect();
    if column == "status" {
        out.retain(|v| !v.trim().eq_ignore_ascii_case("draft"));
    }
    Ok(out)
}

pub(crate) fn all_tags(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT DISTINCT tags FROM test_cases WHERE repo_slug = ? AND tags IS NOT NULL")?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    for r in rows.flatten() {
        if let Ok(v) = serde_json::from_str::<Vec<String>>(&r) {
            for t in v {
                let norm = normalize_tag(&t);
                if norm.is_empty() {
                    continue;
                }
                let key = norm.to_lowercase();
                if !seen.contains_key(&key) {
                    seen.insert(key, norm);
                }
            }
        }
    }
    let mut out: Vec<String> = seen.into_values().collect();
    out.sort();
    Ok(out)
}

pub(crate) fn merge_param_values_into_map(
    map: &mut BTreeMap<String, BTreeMap<String, String>>,
    params: &BTreeMap<String, String>,
) {
    for (k, v) in params {
        let key = k.trim();
        let val = v.trim();
        if key.is_empty() || val.is_empty() {
            continue;
        }
        map.entry(key.to_string())
            .or_default()
            .insert(val.to_lowercase(), val.to_string());
    }
}

pub(crate) fn all_param_keys(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT params FROM test_cases WHERE repo_slug = ?1 AND params IS NOT NULL AND params != '' AND params != '{}'",
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

pub(crate) fn all_param_values_by_key(
    conn: &Connection,
    repo_slug: &str,
) -> Result<BTreeMap<String, Vec<String>>> {
    let mut stmt = conn.prepare(
        "SELECT params FROM test_cases WHERE repo_slug = ?1 AND params IS NOT NULL AND params != '' AND params != '{}'",
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

#[derive(Debug)]
pub(crate) struct QueryRunCasesArgs {
    pub(crate) run_id: Option<String>,
    pub(crate) folder_prefix: Option<String>,
    pub(crate) search: Option<String>,
    pub(crate) tag: Option<String>,
    pub(crate) priority: Option<String>,
    pub(crate) requirement_id: Option<String>,
    pub(crate) automated: Option<bool>,
    pub(crate) executed_by: Option<String>,
    pub(crate) assigned_to: Option<String>,
    pub(crate) result: Option<String>,
    pub(crate) include_archived: bool,
    pub(crate) per_run_order: bool,
    pub(crate) limit: i64,
    pub(crate) offset: i64,
}

const RUN_CASE_SEARCH_FROM: &str = r#"
FROM test_run_cases trc
JOIN test_runs tr ON tr.run_id = trc.run_id AND tr.repo_slug = trc.repo_slug
LEFT JOIN test_run_results trr ON trr.run_id = trc.run_id AND trr.file_path = trc.file_path
"#;

/// Shared WHERE clause for `query_run_cases_db` list + count queries.
pub(crate) fn build_query_run_cases_conditions(
    repo_slug: &str,
    args: &QueryRunCasesArgs,
) -> (String, Vec<rusqlite::types::Value>) {
    let mut conditions: Vec<String> = vec!["trc.repo_slug = ?".to_string()];
    let mut params_vec: Vec<rusqlite::types::Value> = vec![repo_slug.to_string().into()];

    if !args.include_archived {
        conditions.push("tr.archived = 0".to_string());
    }

    if let Some(s) = args.run_id.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("trc.run_id = ?".to_string());
        params_vec.push(s.trim().to_string().into());
    }

    if let Some(s) = args.folder_prefix.as_ref().filter(|s| !s.trim().is_empty()) {
        let p = s.trim().replace('\\', "/");
        conditions.push("(trc.file_path = ? OR trc.file_path LIKE ?)".to_string());
        params_vec.push(p.clone().into());
        params_vec.push(format!("{p}/%").into());
    }

    if let Some(s) = args.search.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push(
            "(trc.case_id LIKE ? OR trc.title LIKE ? OR tr.name LIKE ? OR trc.run_id LIKE ?)"
                .to_string(),
        );
        let like = format!("%{}%", s.trim());
        params_vec.push(like.clone().into());
        params_vec.push(like.clone().into());
        params_vec.push(like.clone().into());
        params_vec.push(like.into());
    }
    if let Some(s) = args.tag.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("LOWER(trc.tags) LIKE ?".to_string());
        params_vec.push(format!("%\"{}\"%", s.trim().to_lowercase()).into());
    }
    if let Some(s) = args.priority.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("trc.priority = ?".to_string());
        params_vec.push(s.clone().into());
    }
    if let Some(s) = args
        .requirement_id
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        conditions.push(crate::requirement_ids::sql_requirement_id_contains(
            "trc.requirement_id",
        ));
        let needle = s.trim().to_string();
        params_vec.push(needle.clone().into());
        params_vec.push(needle.into());
    }
    if let Some(automated) = args.automated {
        conditions.push("trc.automated = ?".to_string());
        params_vec.push(i32::from(automated).into());
    }
    if let Some(s) = args.executed_by.as_ref().filter(|s| !s.trim().is_empty()) {
        conditions.push("trc.executed_by LIKE ?".to_string());
        params_vec.push(format!("%{}%", s.trim()).into());
    }
    if let Some(s) = args.assigned_to.as_ref().filter(|s| !s.trim().is_empty()) {
        let expr = effective_assignee_sql_expr();
        conditions.push(format!("LOWER(({expr})) = LOWER(?)"));
        params_vec.push(s.trim().to_string().into());
    }
    if let Some(s) = args.result.as_ref().filter(|s| !s.trim().is_empty()) {
        let r = s.trim().to_lowercase();
        if r == "pending" {
            conditions.push("(trr.result IS NULL OR trr.result = 'pending')".to_string());
        } else {
            conditions.push("trr.result = ?".to_string());
            params_vec.push(r.into());
        }
    }

    (conditions.join(" AND "), params_vec)
}

fn map_run_case_search_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<models::RunCaseItem> {
    let tags_raw: Option<String> = row.get(6)?;
    let tags: Vec<String> = tags_raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .unwrap_or_default();
    let file_path: String = row.get(2)?;
    let directory = directory_from_file_path(&file_path);
    let case_assigned_to: Option<String> = row.get(10)?;
    let run_assigned_to: Option<String> = row.get(11)?;
    let effective = effective_assigned_to(case_assigned_to.as_deref(), run_assigned_to.as_deref());
    Ok(models::RunCaseItem {
        id: row.get(0)?,
        run_id: row.get(1)?,
        file_path,
        case_id: row.get(3)?,
        title: row.get(4)?,
        priority: row.get(5)?,
        status: None,
        tags,
        requirement_ids: crate::requirement_ids::requirement_ids_from_db(
            row.get::<_, Option<String>>(7)?.as_deref(),
        ),
        automated: row.get::<_, i32>(8).unwrap_or(0) != 0,
        result: row.get(12)?,
        executed_at: row.get(13)?,
        comment: row.get(14)?,
        executed_by: row.get(9)?,
        assigned_to: case_assigned_to,
        effective_assigned_to: effective,
        directory,
        comments: vec![],
    })
}

pub(crate) fn query_run_cases_db(
    conn: &Connection,
    repo_slug: &str,
    args: QueryRunCasesArgs,
) -> Result<(Vec<models::RunCaseItem>, i64)> {
    let (where_sql, mut filter_params) = build_query_run_cases_conditions(repo_slug, &args);

    let count_sql = format!("SELECT COUNT(*) {RUN_CASE_SEARCH_FROM} WHERE {where_sql}");
    let total: i64 = conn
        .query_row(
            &count_sql,
            rusqlite::params_from_iter(filter_params.iter()),
            |row| row.get(0),
        )
        .unwrap_or(0);

    let order_sql = if args.per_run_order {
        "ORDER BY trc.id ASC"
    } else {
        "ORDER BY tr.updated_at DESC, trc.id ASC"
    };
    let sql = format!(
        r#"
SELECT trc.id, trc.run_id, trc.file_path, trc.case_id, trc.title, trc.priority,
       trc.tags, trc.requirement_id, trc.automated, trc.executed_by, trc.assigned_to, tr.assigned_to AS run_assigned_to,
       trr.result, COALESCE(trr.executed_at, trc.executed_at) AS executed_at, trr.comment
{RUN_CASE_SEARCH_FROM}
WHERE {where_sql}
{order_sql}
LIMIT ? OFFSET ?
"#
    );
    filter_params.push(args.limit.into());
    filter_params.push(args.offset.into());

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(filter_params.iter()),
        map_run_case_search_row,
    )?;
    let items: Vec<models::RunCaseItem> = rows.filter_map(|r| r.ok()).collect();

    Ok((items, total))
}

pub(crate) fn get_run_case_item(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    file_path: &str,
) -> Result<Option<models::RunCaseItem>> {
    let run_assigned_to: Option<String> = conn
        .query_row(
            "SELECT assigned_to FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
            params![repo_slug, run_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    let mut stmt = conn.prepare(
        r#"
SELECT trc.id, trc.run_id, trc.file_path, trc.case_id, trc.title, trc.priority,
       trc.tags, trc.requirement_id, trc.automated, trc.executed_by, trc.assigned_to,
       trr.result, COALESCE(trr.executed_at, trc.executed_at) AS executed_at, trr.comment
FROM test_run_cases trc
LEFT JOIN test_run_results trr ON trr.run_id = trc.run_id AND trr.file_path = trc.file_path
WHERE trc.repo_slug = ?1 AND trc.run_id = ?2 AND trc.file_path = ?3
"#,
    )?;
    let row = stmt
        .query_row(params![repo_slug, run_id, file_path], |r| {
            Ok(models::RunCaseItem {
                id: r.get(0)?,
                run_id: r.get(1)?,
                file_path: r.get(2)?,
                case_id: r.get(3)?,
                title: r.get(4)?,
                priority: r.get(5)?,
                status: None,
                tags: r
                    .get::<_, Option<String>>(6)?
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                    .unwrap_or_default(),
                requirement_ids: crate::requirement_ids::requirement_ids_from_db(
                    r.get::<_, Option<String>>(7)?.as_deref(),
                ),
                automated: r.get::<_, i32>(8).unwrap_or(0) != 0,
                executed_by: r.get(9)?,
                assigned_to: {
                    let v: Option<String> = r.get(10)?;
                    v
                },
                effective_assigned_to: None,
                result: r.get(11)?,
                executed_at: r.get(12)?,
                comment: r.get(13)?,
                directory: directory_from_file_path(file_path),
                comments: vec![],
            })
        })
        .optional()?;
    Ok(row.map(|mut item| {
        item.effective_assigned_to =
            effective_assigned_to(item.assigned_to.as_deref(), run_assigned_to.as_deref());
        item
    }))
}

pub(crate) fn workspace_usernames(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let sql = r#"
SELECT DISTINCT name FROM (
  SELECT updated_by AS name FROM test_cases WHERE repo_slug = ?1 AND updated_by IS NOT NULL AND TRIM(updated_by) != ''
  UNION SELECT approved_by FROM test_cases WHERE repo_slug = ?1 AND approved_by IS NOT NULL AND TRIM(approved_by) != ''
  UNION SELECT assigned_to FROM test_cases WHERE repo_slug = ?1 AND assigned_to IS NOT NULL AND TRIM(assigned_to) != ''
  UNION SELECT updated_by FROM test_runs WHERE repo_slug = ?1 AND updated_by IS NOT NULL AND TRIM(updated_by) != ''
  UNION SELECT approved_by FROM test_runs WHERE repo_slug = ?1 AND approved_by IS NOT NULL AND TRIM(approved_by) != ''
  UNION SELECT assigned_to FROM test_runs WHERE repo_slug = ?1 AND assigned_to IS NOT NULL AND TRIM(assigned_to) != ''
  UNION SELECT executed_by FROM test_run_cases WHERE repo_slug = ?1 AND executed_by IS NOT NULL AND TRIM(executed_by) != ''
  UNION SELECT assigned_to FROM test_run_cases WHERE repo_slug = ?1 AND assigned_to IS NOT NULL AND TRIM(assigned_to) != ''
  UNION SELECT author FROM test_run_comments WHERE repo_slug = ?1 AND TRIM(author) != ''
  UNION SELECT author FROM test_run_case_comments WHERE repo_slug = ?1 AND TRIM(author) != ''
) ORDER BY name COLLATE NOCASE
"#;
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    let names: Vec<String> = rows
        .filter_map(|r| r.ok())
        .filter(|name| !is_assignee_unassigned(name) && name != ASSIGNEE_UNASSIGNED)
        .collect();
    Ok(dedupe_assignees_case_insensitive(names))
}

pub(crate) fn list_run_case_paths_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<models::RunCasePathsResponse> {
    let mut stmt = conn.prepare(
        "SELECT file_path FROM test_run_cases WHERE repo_slug = ?1 AND run_id = ?2 ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![repo_slug, run_id], |row| row.get::<_, String>(0))?;
    let paths: Vec<String> = rows.filter_map(|r| r.ok()).collect();
    Ok(models::RunCasePathsResponse {
        total: paths.len() as i64,
        paths,
    })
}

pub(crate) fn distinct_effective_run_case_assignees(
    conn: &Connection,
    repo_slug: &str,
) -> Result<Vec<String>> {
    let expr = effective_assignee_sql_expr();
    let sql = format!(
        r#"
SELECT DISTINCT assignee FROM (
  SELECT ({expr}) AS assignee
  FROM test_run_cases trc
  JOIN test_runs tr ON tr.run_id = trc.run_id AND tr.repo_slug = trc.repo_slug
  WHERE trc.repo_slug = ?
) WHERE assignee IS NOT NULL
ORDER BY assignee COLLATE NOCASE
"#
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    let names: Vec<String> = rows.filter_map(|r| r.ok()).collect();
    Ok(dedupe_assignees_case_insensitive(names))
}

pub(crate) fn distinct_run_case_values(
    conn: &Connection,
    repo_slug: &str,
    column: &str,
) -> Result<Vec<String>> {
    let allowed = ["priority", "requirement_id", "executed_by"];
    if !allowed.contains(&column) {
        return Ok(vec![]);
    }
    if column == "requirement_id" {
        return distinct_run_case_requirement_ids(conn, repo_slug);
    }
    let sql = format!(
        "SELECT DISTINCT {column} FROM test_run_cases WHERE repo_slug = ? AND {column} IS NOT NULL AND TRIM({column}) != '' ORDER BY {column}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn distinct_run_case_requirement_ids(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT requirement_id FROM test_run_cases WHERE repo_slug = ? AND requirement_id IS NOT NULL AND TRIM(requirement_id) != ''",
    )?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    for raw in rows.flatten() {
        for id in crate::requirement_ids::requirement_ids_from_db(Some(&raw)) {
            let key = id.to_lowercase();
            if !seen.contains_key(&key) {
                seen.insert(key, id);
            }
        }
    }
    let mut out: Vec<String> = seen.into_values().collect();
    out.sort();
    Ok(out)
}

pub(crate) fn run_case_all_tags(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT tags FROM test_run_cases WHERE repo_slug = ? AND tags IS NOT NULL",
    )?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    for r in rows.flatten() {
        if let Ok(v) = serde_json::from_str::<Vec<String>>(&r) {
            for t in v {
                let norm = normalize_tag(&t);
                if norm.is_empty() {
                    continue;
                }
                let key = norm.to_lowercase();
                if !seen.contains_key(&key) {
                    seen.insert(key, norm);
                }
            }
        }
    }
    let mut out: Vec<String> = seen.into_values().collect();
    out.sort();
    Ok(out)
}

pub(crate) fn normalize_tag(tag: &str) -> String {
    let s = tag.trim();
    if s.is_empty() {
        return "".to_string();
    }
    // Preserve spelling; only collapse internal whitespace. Matching/dedupe is case-insensitive.
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Store staged file paths and change status; diff text is filled lazily on first preview read.
pub(crate) fn upsert_pending_diff_file_list_db(
    conn: &Connection,
    repo_slug: &str,
    files: &[models::PendingFileChange],
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM pending_commit_metadata WHERE repo_slug = ?",
        [repo_slug],
    )?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO pending_commit_metadata (repo_slug, file_path, diff_content, captured_at, change_status, old_file_path) VALUES (?, ?, '', ?, ?, ?)",
        )?;
        for file in files {
            stmt.execute(params![
                repo_slug,
                file.path,
                now,
                file.status,
                file.old_path
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub(crate) fn cache_pending_diff_content_db(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
    diff: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let changed = conn.execute(
        "UPDATE pending_commit_metadata SET diff_content = ?1, captured_at = ?2 WHERE repo_slug = ?3 AND file_path = ?4",
        params![diff, now, repo_slug, file_path],
    )?;
    if changed == 0 {
        conn.execute(
            "INSERT OR REPLACE INTO pending_commit_metadata (repo_slug, file_path, diff_content, captured_at, change_status, old_file_path) VALUES (?, ?, ?, ?, 'M', NULL)",
            params![repo_slug, file_path, diff, now],
        )?;
    }
    Ok(())
}

pub(crate) fn clear_pending_diffs_db(conn: &Connection, repo_slug: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM pending_commit_metadata WHERE repo_slug = ?",
        [repo_slug],
    )?;
    conn.execute(
        "DELETE FROM pending_commit_groups WHERE repo_slug = ?",
        [repo_slug],
    )?;
    Ok(())
}

pub(crate) fn pending_diff_files_db(conn: &Connection, repo_slug: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT file_path FROM pending_commit_metadata WHERE repo_slug = ? ORDER BY file_path",
    )?;
    let rows = stmt.query_map([repo_slug], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub(crate) fn pending_case_file_changes_db(
    conn: &Connection,
    repo_slug: &str,
) -> Result<Vec<models::PendingFileChange>> {
    let cases_like = format!("{CASES_PREFIX}%");
    let tickets_like = format!("{}%", tickets::TICKETS_PREFIX);
    let wiki_like = format!("{}%", wiki::WIKI_PREFIX);
    let mut stmt = conn.prepare(
        "SELECT file_path, change_status, old_file_path FROM pending_commit_metadata \
         WHERE repo_slug = ? AND (file_path LIKE ? OR file_path LIKE ? OR file_path LIKE ?) ORDER BY file_path",
    )?;
    let rows = stmt.query_map(
        params![repo_slug, cases_like, tickets_like, wiki_like],
        |r| {
            Ok(models::PendingFileChange {
                path: r.get(0)?,
                status: r.get(1)?,
                old_path: r.get(2)?,
            })
        },
    )?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub(crate) fn pending_diff_content_db(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
) -> Result<String> {
    let mut stmt = conn.prepare(
        "SELECT diff_content FROM pending_commit_metadata WHERE repo_slug = ? AND file_path = ?",
    )?;
    let row: Option<String> = stmt
        .query_row(params![repo_slug, file_path], |r| r.get(0))
        .optional()?;
    Ok(row.unwrap_or_default())
}

/// Parse `git diff --cached --name-status -M` into staged file change records.
pub(crate) fn parse_name_status_changes(output: &str) -> Vec<models::PendingFileChange> {
    let mut out = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.is_empty() {
            continue;
        }
        let status = parts[0].chars().next().unwrap_or('?');
        match status {
            'A' | 'M' | 'D' if parts.len() >= 2 => {
                let path = parts[1].trim().replace('\\', "/");
                if !path.is_empty() {
                    out.push(models::PendingFileChange {
                        path,
                        status: status.to_string(),
                        old_path: None,
                    });
                }
            }
            'R' if parts.len() >= 3 => {
                let old_p = parts[1].trim().replace('\\', "/");
                let new_p = parts[2].trim().replace('\\', "/");
                if !old_p.is_empty() && !new_p.is_empty() {
                    out.push(models::PendingFileChange {
                        path: new_p,
                        status: "R".to_string(),
                        old_path: Some(old_p),
                    });
                }
            }
            _ => {}
        }
    }
    out
}

/// Case and ticket file changes from a full name-status snapshot (for Confirm capture responses).
pub(crate) fn case_changes_from_name_status(
    all_changes: &[models::PendingFileChange],
) -> Vec<models::PendingFileChange> {
    all_changes
        .iter()
        .filter(|c| {
            c.path.starts_with(CASES_PREFIX)
                || c.path.starts_with(tickets::TICKETS_PREFIX)
                || c.path.starts_with(wiki::WIKI_PREFIX)
        })
        .cloned()
        .collect()
}

/// True when a relative path is safe to discard from Confirm Changes (under `.gitoza/`).
pub(crate) fn is_allowed_discard_path(p: &str) -> bool {
    let p = p.replace('\\', "/");
    is_safe_repo_relative_path(&p) && p.starts_with(".gitoza/")
}

/// Partition discard targets into `git restore` vs `git rm` path sets.
///
/// - **A** (added): `git rm -f`
/// - **R** (renamed): restore both `old_path` and new `path`
/// - **M / D / other**: `git restore --source=HEAD --staged --worktree`
pub(crate) fn partition_discard_git_ops(
    paths: &[String],
    status_by_path: &HashMap<String, models::PendingFileChange>,
) -> (Vec<String>, Vec<String>) {
    let mut restore: HashSet<String> = HashSet::new();
    let mut rm: HashSet<String> = HashSet::new();

    for raw in paths {
        let path = raw.replace('\\', "/");
        if path.is_empty() {
            continue;
        }
        let change = status_by_path.get(&path);
        let status = change
            .map(|c| c.status.to_ascii_uppercase())
            .unwrap_or_else(|| "M".to_string());

        match status.as_str() {
            "A" => {
                rm.insert(path);
            }
            "R" => {
                if let Some(old) = change.and_then(|c| c.old_path.as_ref()) {
                    let old = old.replace('\\', "/");
                    if !old.is_empty() {
                        restore.insert(old);
                    }
                }
                restore.insert(path);
            }
            _ => {
                restore.insert(path);
            }
        }
    }

    let mut restore_v: Vec<String> = restore.into_iter().filter(|p| !rm.contains(p)).collect();
    let mut rm_v: Vec<String> = rm.into_iter().collect();
    restore_v.sort();
    rm_v.sort();
    (restore_v, rm_v)
}

/// Discard staged+worktree changes for the given path sets (Confirm Changes reset).
pub(crate) async fn discard_staged_and_worktree_paths(
    repo_path: &Path,
    restore_paths: &[String],
    rm_paths: &[String],
) -> Result<()> {
    if !restore_paths.is_empty() {
        let mut args: Vec<String> = vec![
            "restore".into(),
            "--source=HEAD".into(),
            "--staged".into(),
            "--worktree".into(),
            "--".into(),
        ];
        args.extend(restore_paths.iter().cloned());
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let r = git_run(repo_path, &arg_refs).await?;
        if !r.success {
            anyhow::bail!(
                "git restore failed: {}",
                r.output.chars().take(500).collect::<String>()
            );
        }
    }
    if !rm_paths.is_empty() {
        let mut args: Vec<String> = vec!["rm".into(), "-f".into(), "--".into()];
        args.extend(rm_paths.iter().cloned());
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let r = git_run(repo_path, &arg_refs).await?;
        if !r.success {
            anyhow::bail!(
                "git rm failed: {}",
                r.output.chars().take(500).collect::<String>()
            );
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Workflow state + push-failed markers (SQLite)
// ---------------------------------------------------------------------------

pub(crate) fn set_confirm_workflow_state_db(
    conn: &Connection,
    repo_slug: &str,
    step: &str,
    draft_branch: &str,
    main_sha: Option<&str>,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        r#"
INSERT INTO confirm_workflow_state (repo_slug, step, draft_branch, main_sha, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT(repo_slug) DO UPDATE SET
  step = excluded.step,
  draft_branch = excluded.draft_branch,
  main_sha = excluded.main_sha,
  updated_at = excluded.updated_at
"#,
        params![repo_slug, step, draft_branch, main_sha, now],
    )?;
    Ok(())
}

pub(crate) fn get_confirm_workflow_step_db(conn: &Connection, repo_slug: &str) -> Option<String> {
    conn.query_row(
        "SELECT step FROM confirm_workflow_state WHERE repo_slug = ?",
        [repo_slug],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
}

pub(crate) fn clear_confirm_workflow_state_db(conn: &Connection, repo_slug: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM confirm_workflow_state WHERE repo_slug = ?",
        [repo_slug],
    )?;
    Ok(())
}

pub(crate) fn mark_push_failed_db(conn: &Connection, repo_slug: &str, reason: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        r#"
INSERT INTO confirm_push_failed (repo_slug, set_at, reason)
VALUES (?1, ?2, ?3)
ON CONFLICT(repo_slug) DO UPDATE SET
  set_at = excluded.set_at,
  reason = excluded.reason
"#,
        params![repo_slug, now, reason],
    )?;
    Ok(())
}

pub(crate) fn clear_push_failed_db(conn: &Connection, repo_slug: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM confirm_push_failed WHERE repo_slug = ?",
        [repo_slug],
    )?;
    Ok(())
}

pub(crate) fn has_push_failed_db(conn: &Connection, repo_slug: &str) -> Result<bool> {
    let v: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM confirm_push_failed WHERE repo_slug = ?",
            [repo_slug],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v.is_some())
}

pub(crate) fn get_push_failed_reason_db(
    conn: &Connection,
    repo_slug: &str,
) -> Result<Option<String>> {
    let v: Option<String> = conn
        .query_row(
            "SELECT reason FROM confirm_push_failed WHERE repo_slug = ?",
            [repo_slug],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v)
}

pub(crate) fn get_cached_git_user_db(
    conn: &Connection,
    repo_slug: &str,
) -> Result<(Option<String>, Option<String>)> {
    let row: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT user_name, user_email FROM repo_git_user WHERE repo_slug = ?",
            [repo_slug],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(row
        .map(|(name, email)| {
            (
                name.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
                email
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
            )
        })
        .unwrap_or((None, None)))
}

fn normalize_optional_git_identity(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
fn git_identity_changed(cached: &Option<String>, effective: &Option<String>) -> bool {
    cached.as_deref() != effective.as_deref()
}

#[cfg(test)]
pub(crate) fn has_local_git_override(
    global_name: &Option<String>,
    global_email: &Option<String>,
    effective_name: &Option<String>,
    effective_email: &Option<String>,
) -> bool {
    match (global_name.as_ref(), global_email.as_ref()) {
        (Some(gn), Some(ge)) => {
            effective_name.as_ref().map(|e| e != gn).unwrap_or(false)
                || effective_email.as_ref().map(|e| e != ge).unwrap_or(false)
        }
        _ => false,
    }
}

pub(crate) fn validate_git_identity_field(
    value: &str,
    field: GitIdentityField,
) -> Result<Option<String>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    match field {
        GitIdentityField::Name => {
            if trimmed.len() > 200 {
                return Err("Display name must be at most 200 characters.".to_string());
            }
        }
        GitIdentityField::Email => {
            if !trimmed.contains('@') {
                return Err("Email must contain @.".to_string());
            }
            if trimmed.len() > 320 {
                return Err("Email must be at most 320 characters.".to_string());
            }
        }
    }
    Ok(Some(trimmed.to_string()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GitIdentityField {
    Name,
    Email,
}

#[cfg(test)]
pub(crate) fn validate_git_profile_input(
    name: &str,
    email: &str,
) -> Result<(String, String), String> {
    let name = name.trim();
    let email = email.trim();
    if name.is_empty() {
        return Err("Display name is required.".to_string());
    }
    if name.len() > 200 {
        return Err("Display name must be at most 200 characters.".to_string());
    }
    if email.is_empty() {
        return Err("Email is required.".to_string());
    }
    if !email.contains('@') {
        return Err("Email must contain @.".to_string());
    }
    if email.len() > 320 {
        return Err("Email must be at most 320 characters.".to_string());
    }
    Ok((name.to_string(), email.to_string()))
}

pub(crate) fn list_connected_repo_slugs(state: &AppState) -> Vec<String> {
    let repos_dir = state.config_dir.join("repos");
    let mut slugs = vec![];
    if let Ok(entries) = std::fs::read_dir(&repos_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join(".git").is_dir() {
                slugs.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    slugs.sort();
    slugs
}

pub(crate) async fn sync_repo_git_user_cache(
    state: &AppState,
    slug: &str,
    repo_path: &Path,
) -> Result<()> {
    let effective_name = git_effective_user_name(repo_path).await.ok().flatten();
    let effective_email = git_effective_user_email(repo_path).await.ok().flatten();
    let conn_arc = open_repo_db(state, slug)?;
    let conn = conn_arc.lock().unwrap();
    set_cached_git_user_db(
        &conn,
        slug,
        effective_name.as_deref(),
        effective_email.as_deref(),
    )
}

pub(crate) async fn sync_all_repo_git_user_caches(state: &AppState) -> Result<u32> {
    let slugs = list_connected_repo_slugs(state);
    let mut synced = 0u32;
    for slug in slugs {
        let repo_path = state.config_dir.join("repos").join(&slug);
        if sync_repo_git_user_cache(state, &slug, &repo_path)
            .await
            .is_ok()
        {
            synced += 1;
        }
    }
    Ok(synced)
}

pub(crate) fn set_cached_git_user_db(
    conn: &Connection,
    repo_slug: &str,
    user_name: Option<&str>,
    user_email: Option<&str>,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let normalized_name = user_name.map(str::trim).filter(|s| !s.is_empty());
    let normalized_email = user_email.map(str::trim).filter(|s| !s.is_empty());
    conn.execute(
        r#"
INSERT INTO repo_git_user (repo_slug, user_name, user_email, updated_at)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT(repo_slug) DO UPDATE SET
  user_name = excluded.user_name,
  user_email = excluded.user_email,
  updated_at = excluded.updated_at
"#,
        params![repo_slug, normalized_name, normalized_email, now],
    )?;
    Ok(())
}

pub(crate) fn get_indexed_head_sha(conn: &Connection, repo_slug: &str) -> Result<Option<String>> {
    let row: Option<String> = conn
        .query_row(
            "SELECT indexed_head_sha FROM repo_index_state WHERE repo_slug = ?",
            [repo_slug],
            |r| r.get(0),
        )
        .optional()?;
    Ok(row.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}

pub(crate) fn set_indexed_head_sha(
    conn: &Connection,
    repo_slug: &str,
    head_sha: &str,
) -> Result<()> {
    let sha = head_sha.trim();
    if sha.is_empty() {
        return Ok(());
    }
    let now = Utc::now().to_rfc3339();
    conn.execute(
        r#"
INSERT INTO repo_index_state (repo_slug, indexed_head_sha, updated_at)
VALUES (?1, ?2, ?3)
ON CONFLICT(repo_slug) DO UPDATE SET
  indexed_head_sha = excluded.indexed_head_sha,
  updated_at = excluded.updated_at
"#,
        params![repo_slug, sha, now],
    )?;
    Ok(())
}

/// Current `HEAD` SHA (first line of `git rev-parse HEAD`).
pub(crate) async fn git_head_sha(repo_path: &Path) -> Result<String> {
    let out = git_stdout(repo_path, &["rev-parse", "HEAD"]).await?;
    let sha = out
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if sha.is_empty() {
        return Err(anyhow!("git rev-parse HEAD returned empty"));
    }
    Ok(sha)
}

pub(crate) async fn git_commit_exists(repo_path: &Path, sha: &str) -> bool {
    let sha = sha.trim();
    if sha.is_empty() {
        return false;
    }
    let spec = format!("{sha}^{{commit}}");
    git_run(repo_path, &["rev-parse", "--verify", spec.as_str()])
        .await
        .map(|r| r.success)
        .unwrap_or(false)
}

pub(crate) async fn stamp_indexed_head(
    state: &AppState,
    repo_path: &Path,
    slug: &str,
) -> Result<()> {
    let head = git_head_sha(repo_path).await?;
    let conn_arc = open_repo_db(state, slug)?;
    set_indexed_head_sha(&conn_arc.lock().unwrap(), slug, &head)?;
    Ok(())
}

fn count_gitoza_index_rows(conn: &Connection, slug: &str) -> i64 {
    let cases = count_cases_db(conn, slug).unwrap_or(0);
    let tickets: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tickets WHERE repo_slug = ?",
            [slug],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let releases: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ticket_releases WHERE repo_slug = ?",
            [slug],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let wiki: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM wiki_pages WHERE repo_slug = ?",
            [slug],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let runs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM test_runs WHERE repo_slug = ?",
            [slug],
            |r| r.get(0),
        )
        .unwrap_or(0);
    cases + tickets + releases + wiki + runs
}

pub(crate) async fn resolve_git_user_name_cached(
    state: &AppState,
    repo_path: &Path,
    repo_slug: &str,
) -> String {
    if let Ok(conn_arc) = open_repo_db(state, repo_slug) {
        let conn = conn_arc.lock().unwrap();
        if let Ok((Some(name), _)) = get_cached_git_user_db(&conn, repo_slug) {
            return name;
        }
    }

    let effective_name = git_effective_user_name(repo_path).await.ok().flatten();
    let effective_email = git_effective_user_email(repo_path).await.ok().flatten();
    let name = effective_name.clone().unwrap_or_default();
    if let Ok(conn_arc) = open_repo_db(state, repo_slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = set_cached_git_user_db(
            &conn,
            repo_slug,
            effective_name.as_deref(),
            effective_email.as_deref(),
        );
    }
    name
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

pub(crate) async fn ensure_git_repo(repo_path: &Path) -> Result<()> {
    let r = git_run(repo_path, &["rev-parse", "--git-dir"]).await?;
    if !r.success {
        return Err(anyhow!("Path is not a git repo: {}", repo_path.display()));
    }
    Ok(())
}

/// Background / quick-sync fetch and ff-pull budget (matches clone `ls-remote` style).
pub(crate) const GIT_NETWORK_TIMEOUT_SECS: u64 = 90;

/// Fetch `origin`. Uses a timed network runner so a hung SSH cannot hold
/// [`repo_git_lock`] forever (auto-fetch loop). Callers that ignore errors (Quick Sync)
/// still release the lock when this returns.
pub async fn git_fetch_origin(repo_path: &Path) -> Result<()> {
    let r = git_run_network_timeout(
        repo_path,
        &["fetch", "origin"],
        std::time::Duration::from_secs(GIT_NETWORK_TIMEOUT_SECS),
    )
    .await?;
    if !r.success {
        return Err(anyhow!("git fetch origin failed: {}", r.output));
    }
    Ok(())
}

pub async fn pull_if_behind(repo_path: &Path) -> Result<bool> {
    // Determine if HEAD is behind upstream: `git rev-list --left-right --count HEAD...@{u}` -> "behind ahead"
    let out = git_stdout(
        repo_path,
        &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
    )
    .await;
    let Ok(out) = out else {
        return Ok(false);
    };
    let parts: Vec<&str> = out.split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(false);
    }
    let behind = parts[1].parse::<i64>().unwrap_or(0);
    if behind <= 0 {
        return Ok(false);
    }
    let r = git_run_network_timeout(
        repo_path,
        &["pull", "--ff-only"],
        std::time::Duration::from_secs(GIT_NETWORK_TIMEOUT_SECS),
    )
    .await?;
    Ok(r.success)
}

/// Paths changed between `since_sha` and current HEAD (`git diff --name-only since..HEAD`).
pub(crate) async fn changed_paths_since(repo_path: &Path, since_sha: &str) -> Result<Vec<String>> {
    let since = since_sha.trim();
    if since.is_empty() {
        return Ok(Vec::new());
    }
    let range = format!("{since}..HEAD");
    let out = git_stdout(repo_path, &["diff", "--name-only", &range]).await?;
    let mut out_paths = Vec::new();
    let mut seen = HashSet::new();
    for line in out.lines() {
        let p = line.trim().replace('\\', "/");
        if p.is_empty() {
            continue;
        }
        if seen.insert(p.clone()) {
            out_paths.push(p);
        }
    }
    Ok(out_paths)
}

/// All paths from `git status --porcelain -z -uall` (untracked, modified, deleted, renamed, etc.).
pub(crate) async fn git_status_porcelain_paths(repo_path: &Path) -> Result<Vec<String>> {
    let out = git_stdout(repo_path, &["status", "--porcelain", "-z", "-uall"]).await?;
    Ok(sync_git::porcelain::parse_status_porcelain_z(&out))
}

pub(crate) fn filter_case_and_run_yaml_paths(all_paths: &[String]) -> (Vec<String>, Vec<String>) {
    let mut case_set: HashSet<String> = HashSet::new();
    let mut run_set: HashSet<String> = HashSet::new();
    for p in all_paths {
        let p = p.replace('\\', "/");
        if p.is_empty() {
            continue;
        }
        let ext = Path::new(&p)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "md" {
            continue;
        }
        if p.starts_with(".gitoza/test/cases/") {
            case_set.insert(p);
        } else if p.starts_with(".gitoza/test/runs/") {
            run_set.insert(p);
        }
    }
    (
        case_set.into_iter().collect(),
        run_set.into_iter().collect(),
    )
}

pub(crate) fn list_indexed_case_file_paths(
    conn: &Connection,
    slug: &str,
) -> Result<HashSet<String>> {
    let mut out = HashSet::new();
    let mut stmt = conn.prepare("SELECT file_path FROM test_cases WHERE repo_slug = ?")?;
    let rows = stmt.query_map([slug], |r| r.get::<_, String>(0))?;
    for row in rows.flatten() {
        let p = row.replace('\\', "/");
        if !p.is_empty() {
            out.insert(p);
        }
    }
    Ok(out)
}

pub(crate) fn discover_case_yaml_rel_paths(repo_path: &Path) -> HashSet<String> {
    let cases_root = repo_path.join(".gitoza/test/cases");
    if !cases_root.is_dir() {
        return HashSet::new();
    }
    let ignore: HashSet<&str> = CASE_TREE_IGNORE_DIRS.iter().copied().collect();
    let mut out = HashSet::new();
    for abs in discover_yaml_files_rec(&cases_root, repo_path, &ignore) {
        let file_rel = file_rel_from_repo(repo_path, &abs);
        if directory_from_file_path(&file_rel).is_empty() {
            continue;
        }
        out.insert(file_rel);
    }
    out
}

/// Paths where disk and SQLite case index disagree (symmetric difference on `file_path`).
pub(crate) fn reconcile_case_paths(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
) -> Result<Vec<String>> {
    let disk = discover_case_yaml_rel_paths(repo_path);
    let db = list_indexed_case_file_paths(conn, slug)?;
    let mut paths: Vec<String> = disk.symmetric_difference(&db).cloned().collect();
    paths.sort();
    Ok(paths)
}

fn list_indexed_run_ids(conn: &Connection, slug: &str) -> Result<HashSet<String>> {
    let mut out = HashSet::new();
    let mut stmt = conn.prepare("SELECT run_id FROM test_runs WHERE repo_slug = ?")?;
    let rows = stmt.query_map([slug], |r| r.get::<_, String>(0))?;
    for row in rows.flatten() {
        let id = row.trim().to_string();
        if !id.is_empty() {
            out.insert(id);
        }
    }
    Ok(out)
}

/// Run YAML paths on disk whose `run_id` is not yet in the index (e.g. after undo-restore).
pub(crate) fn reconcile_run_paths(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
) -> Result<Vec<String>> {
    let db_run_ids = list_indexed_run_ids(conn, slug)?;
    let mut out = HashSet::new();
    for rel in discover_run_yaml_rel_paths(repo_path) {
        let run_dir_rel = run_publish::run_dir_from_shard_rel(&rel).unwrap_or_default();
        if run_dir_rel.is_empty() {
            continue;
        }
        let run_id = run_dir_rel
            .rsplit('/')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        if run_id.is_empty() {
            continue;
        }
        if !db_run_ids.contains(&run_id) {
            out.insert(rel);
        }
    }
    let mut paths: Vec<String> = out.into_iter().collect();
    paths.sort();
    Ok(paths)
}

pub(crate) fn merge_path_lists(a: Vec<String>, b: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in a.into_iter().chain(b) {
        let p = p.replace('\\', "/");
        if p.is_empty() {
            continue;
        }
        if seen.insert(p.clone()) {
            out.push(p);
        }
    }
    out.sort();
    out
}

/// Case YAML paths eligible for IDE local audit stamp: porcelain-only, excluding archived.
pub(crate) fn case_paths_for_external_stamp(porcelain_paths: &[String]) -> Vec<String> {
    filter_case_and_run_yaml_paths(porcelain_paths)
        .0
        .into_iter()
        .filter(|p| !is_archived_file_path(p))
        .collect()
}

/// Merge reconcile paths into post-pull changed-path lists (cases + runs).
pub(crate) fn merge_reconcile_index_paths(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    changed_cases: &[String],
    changed_runs: &[String],
) -> Result<(Vec<String>, Vec<String>)> {
    let case_reconcile = reconcile_case_paths(conn, repo_path, slug)?;
    let changed_cases = merge_path_lists(changed_cases.to_vec(), case_reconcile);
    let run_reconcile = reconcile_run_paths(conn, repo_path, slug)?;
    let changed_runs = merge_path_lists(changed_runs.to_vec(), run_reconcile);
    Ok((changed_cases, changed_runs))
}

/// Merge porcelain case paths with disk ↔ SQLite reconcile (sync; no I/O beyond DB/disk walk).
pub(crate) fn merge_external_refresh_case_paths(
    repo_path: &Path,
    slug: &str,
    porcelain_paths: &[String],
    conn: &Connection,
) -> Result<Vec<String>> {
    let (mut changed_cases, _) = filter_case_and_run_yaml_paths(porcelain_paths);
    let case_reconcile = reconcile_case_paths(conn, repo_path, slug)?;
    changed_cases = merge_path_lists(changed_cases, case_reconcile);
    Ok(changed_cases)
}

/// Build IDE-refresh audit source: porcelain-dirty → local stamp; else commit meta.
pub(crate) fn audit_source_for_ide_refresh(
    repo_path: &Path,
    porcelain_paths: &[String],
    changed_paths: &[String],
    pathspecs: &[&str],
    git_name: &str,
) -> AuditStampSource {
    let dirty: HashSet<String> = case_paths_for_external_stamp(porcelain_paths)
        .into_iter()
        .chain(tickets::filter_ticket_yaml_paths(porcelain_paths))
        .chain(ticket_releases::filter_release_yaml_paths(porcelain_paths))
        .chain(wiki::filter_wiki_yaml_paths(porcelain_paths))
        .map(|p| normalize_repo_rel_path(&p))
        .collect();
    // Also mark dirty run head/results paths from porcelain.
    let (_, porcelain_runs) = filter_case_and_run_yaml_paths(porcelain_paths);
    let mut dirty = dirty;
    for p in porcelain_runs {
        dirty.insert(normalize_repo_rel_path(&p));
    }
    let commit_meta = git_last_commit_meta_for_paths(repo_path, changed_paths, pathspecs);
    AuditStampSource::Mixed {
        dirty,
        local_by: git_name.trim().to_string(),
        local_at: Utc::now().to_rfc3339(),
        commit_meta,
    }
}

pub(crate) fn apply_run_audit_meta(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
    meta: &CommitAuditMeta,
) -> Result<()> {
    conn.execute(
        r#"UPDATE test_runs SET updated_at = ?1, updated_by = ?2
WHERE repo_slug = ?3 AND run_id = ?4"#,
        params![meta.updated_at, meta.updated_by, repo_slug, run_id],
    )?;
    Ok(())
}

/// Stamp SQLite audit columns for local writes (archive/restore/IDE) without touching YAML.
pub(crate) fn stamp_case_audit_in_db(
    conn: &Connection,
    repo_slug: &str,
    file_paths: &[String],
    updated_by: &str,
    updated_at: &str,
) -> Result<usize> {
    let mut n = 0usize;
    for path in file_paths {
        let key = normalize_repo_rel_path(path);
        if key.is_empty() {
            continue;
        }
        let changed = conn.execute(
            r#"UPDATE test_cases SET updated_at = ?1, updated_by = ?2
WHERE repo_slug = ?3 AND file_path = ?4"#,
            params![updated_at, updated_by, repo_slug, key],
        )?;
        n += changed as usize;
    }
    Ok(n)
}

/// Load SQLite-owned case audit fields for detail API overlays (YAML no longer stores them).
pub(crate) fn load_case_audit(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
) -> (Option<String>, Option<String>) {
    let key = normalize_repo_rel_path(file_path);
    if key.is_empty() {
        return (None, None);
    }
    conn.query_row(
        r#"SELECT updated_at, updated_by FROM test_cases
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

/// Overlay SQLite case audit onto a YAML-parsed detail (ignores any legacy YAML keys).
pub(crate) fn apply_case_audit_from_db(
    conn: &Connection,
    repo_slug: &str,
    file_path: &str,
    detail: &mut models::YamlCaseDetail,
) {
    let (at, by) = load_case_audit(conn, repo_slug, file_path);
    detail.updated_at = at;
    detail.updated_by = by;
}

/// Incremental index for paths changed since `since_sha` (inclusive of additions from rebase/pull).
pub async fn sync_index_since_commit(
    state: &AppState,
    repo_path: &Path,
    slug: &str,
    since_sha: &str,
) -> Result<()> {
    let all_changed = changed_paths_since(repo_path, since_sha)
        .await
        .unwrap_or_default();
    if crate::project_config::paths_include_project_config(&all_changed) {
        let _ = crate::project_config::sync_feature_flags_from_disk(state, slug, repo_path);
    }
    let (mut changed_cases, mut changed_runs) = filter_case_and_run_yaml_paths(&all_changed);
    let changed_tickets = tickets::filter_ticket_yaml_paths(&all_changed);
    let changed_releases = ticket_releases::filter_release_yaml_paths(&all_changed);
    let changed_wiki = wiki::filter_wiki_yaml_paths(&all_changed);
    if let Ok(conn_arc) = open_repo_db(state, slug) {
        let conn = conn_arc.lock().unwrap();
        if let Ok((cases, runs)) =
            merge_reconcile_index_paths(&conn, repo_path, slug, &changed_cases, &changed_runs)
        {
            changed_cases = cases;
            changed_runs = runs;
        }
    }
    let case_audit = AuditStampSource::CommitMeta(git_last_commit_meta_for_paths(
        repo_path,
        &changed_cases,
        &[".gitoza/test/cases"],
    ));
    let run_audit = AuditStampSource::CommitMeta(git_last_commit_meta_for_paths(
        repo_path,
        &changed_runs,
        &[".gitoza/test/runs"],
    ));
    sync_index_for_changed_paths(
        state,
        repo_path,
        slug,
        changed_cases,
        changed_runs,
        Some(&case_audit),
        Some(&run_audit),
    )
    .await?;
    if !changed_tickets.is_empty() {
        if let Ok(conn_arc) = open_repo_db(state, slug) {
            let conn = conn_arc.lock().unwrap();
            let ticket_audit = AuditStampSource::CommitMeta(git_last_commit_meta_for_paths(
                repo_path,
                &changed_tickets,
                &[".gitoza/tasks/tickets"],
            ));
            if changed_tickets.len() > INCREMENTAL_THRESHOLD {
                let _ = tickets::reindex_tickets_for_repo(&conn, repo_path, slug);
            } else {
                let _ = tickets::apply_incremental_ticket_changes(
                    &conn,
                    repo_path,
                    slug,
                    &changed_tickets,
                    &ticket_audit,
                );
            }
        }
    }
    if !changed_releases.is_empty() {
        if let Ok(conn_arc) = open_repo_db(state, slug) {
            let conn = conn_arc.lock().unwrap();
            let release_audit = AuditStampSource::CommitMeta(git_last_commit_meta_for_paths(
                repo_path,
                &changed_releases,
                &[".gitoza/tasks/tickets"],
            ));
            if changed_releases.len() > INCREMENTAL_THRESHOLD {
                let _ = ticket_releases::reindex_releases_for_repo(&conn, repo_path, slug);
            } else {
                let _ = ticket_releases::apply_incremental_release_changes(
                    &conn,
                    repo_path,
                    slug,
                    &changed_releases,
                    &release_audit,
                );
            }
        }
    }
    if !changed_wiki.is_empty() {
        if let Ok(conn_arc) = open_repo_db(state, slug) {
            let conn = conn_arc.lock().unwrap();
            let wiki_audit = AuditStampSource::CommitMeta(git_last_commit_meta_for_paths(
                repo_path,
                &changed_wiki,
                &[".gitoza/wiki"],
            ));
            if changed_wiki.len() > INCREMENTAL_THRESHOLD {
                let _ = wiki::reindex_wiki_for_repo(&conn, repo_path, slug);
            } else {
                let _ = wiki::apply_incremental_wiki_changes(
                    &conn,
                    repo_path,
                    slug,
                    &changed_wiki,
                    &wiki_audit,
                );
            }
        }
    }
    let _ = stamp_indexed_head(state, repo_path, slug).await;
    Ok(())
}

/// After ff-only pull: index using reflog previous HEAD (`HEAD@{1}`). Prefer
/// [`sync_index_since_commit`] when the pre-move SHA is known (e.g. confirm rebase).
pub async fn sync_index_after_pull(state: &AppState, repo_path: &Path, slug: &str) -> Result<()> {
    let since = git_stdout(repo_path, &["rev-parse", "HEAD@{1}"])
        .await
        .unwrap_or_default();
    let since = since.trim();
    if since.is_empty() {
        return Ok(());
    }
    sync_index_since_commit(state, repo_path, slug, since).await
}

/// Apply case/run YAML path changes into SQLite.
///
/// Always flushes pending run YAML before reading disk so stale `results.md`
/// cannot overwrite newer DB execution results. Callers must not bypass this
/// for disk-sourced run imports.
pub(crate) async fn sync_index_for_changed_paths(
    state: &AppState,
    repo_path: &Path,
    slug: &str,
    changed_cases: Vec<String>,
    changed_runs: Vec<String>,
    case_audit: Option<&AuditStampSource>,
    run_audit: Option<&AuditStampSource>,
) -> Result<()> {
    if changed_cases.is_empty() && changed_runs.is_empty() {
        return Ok(());
    }

    pending_run_yaml::flush_pending_run_yaml_before_index(state, slug)
        .await
        .map_err(|e| anyhow!(e))?;

    let default_case_audit;
    let case_audit = match case_audit {
        Some(a) => a,
        None => {
            default_case_audit = AuditStampSource::CommitMeta(git_last_commit_meta_for_paths(
                repo_path,
                &changed_cases,
                &[".gitoza/test/cases"],
            ));
            &default_case_audit
        }
    };
    let default_run_audit;
    let run_audit = match run_audit {
        Some(a) => a,
        None => {
            default_run_audit = AuditStampSource::CommitMeta(git_last_commit_meta_for_paths(
                repo_path,
                &changed_runs,
                &[".gitoza/test/runs"],
            ));
            &default_run_audit
        }
    };

    let case_overflow = changed_cases.len() > INCREMENTAL_THRESHOLD;
    let run_overflow = changed_runs.len() > INCREMENTAL_THRESHOLD;

    // Too many touched case YAMLs: full case index + full run index (same as before for large case pulls).
    if case_overflow {
        {
            let conn_arc = open_repo_db(state, slug)?;
            let conn = conn_arc.lock().unwrap();
            conn.execute("DELETE FROM test_cases WHERE repo_slug = ?", [slug])?;
            let _ = index_cases_from_yaml_with_audit(&conn, repo_path, slug, case_audit)?;
        }
        let _ = index_runs_from_yaml_full(state, repo_path, slug).await;
        return Ok(());
    }

    // Many run files changed but cases are within incremental limits: refresh runs fully, cases only if listed.
    if run_overflow {
        if !changed_cases.is_empty() {
            let conn_arc = open_repo_db(state, slug)?;
            let conn = conn_arc.lock().unwrap();
            apply_incremental_case_changes(&conn, repo_path, slug, &changed_cases, case_audit)?;
        }
        let _ = index_runs_from_yaml_full(state, repo_path, slug).await;
        return Ok(());
    }

    // If we can't safely handle run deletions incrementally, do a full run reindex.
    let any_run_deletion = changed_runs
        .iter()
        .any(|rel| !repo_path.join(rel).is_file());

    if !changed_cases.is_empty() {
        let conn_arc = open_repo_db(state, slug)?;
        let conn = conn_arc.lock().unwrap();
        apply_incremental_case_changes(&conn, repo_path, slug, &changed_cases, case_audit)?;
    }

    if any_run_deletion {
        let _ = index_runs_from_yaml_full(state, repo_path, slug).await;
        return Ok(());
    }

    // Incremental (runs): import changed shard files.
    for rel in changed_runs {
        let abs = repo_path.join(&rel);
        if !abs.is_file() {
            continue;
        }
        let conn_arc = open_repo_db(state, slug)?;
        if run_publish::is_run_results_rel_path(&rel) {
            let doc = match read_run_doc_from_abs_yaml(&abs) {
                Some(d) => d,
                None => continue,
            };
            let conn = conn_arc.lock().unwrap();
            let _ = sync_run_results_from_results_yaml_doc(&conn, slug, &doc);
            if let Some(meta) = run_audit.resolve_meta(&rel) {
                if let Ok(run_id) = run_id_from_doc(&doc) {
                    let _ = apply_run_audit_meta(&conn, slug, run_id, &meta);
                }
            }
            continue;
        }
        let archived = rel.contains("/.archive/");
        let run_dir_rel = match run_publish::run_dir_from_shard_rel(&rel) {
            Some(d) => d,
            None => continue,
        };
        let run_id = run_dir_rel
            .rsplit('/')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        if run_id.is_empty() {
            continue;
        }
        let Some(mut doc) = run_publish::load_run_shards_from_disk(repo_path, &run_id, archived)
        else {
            continue;
        };
        if let Some(obj) = doc.as_object_mut() {
            obj.insert("archived".to_string(), serde_json::Value::Bool(archived));
        }
        {
            let conn = conn_arc.lock().unwrap();
            let _ = upsert_test_run_from_doc(&conn, slug, &doc, Some(&run_dir_rel));
            let head_rel = run_publish::get_run_head_rel_path_from_run_id(&run_id, archived);
            if let Some(meta) = run_audit
                .resolve_meta(&head_rel)
                .or_else(|| run_audit.resolve_meta(&rel))
            {
                let _ = apply_run_audit_meta(&conn, slug, &run_id, &meta);
            }
        }
    }

    Ok(())
}

fn apply_incremental_case_changes(
    conn: &Connection,
    repo_path: &Path,
    slug: &str,
    changed_cases: &[String],
    audit: &AuditStampSource,
) -> Result<()> {
    for rel in changed_cases {
        let abs = repo_path.join(rel);
        if abs.is_file() {
            let d = match read_full_yaml(&abs)? {
                Some(v) => v,
                None => continue,
            };
            let tags_for_db = normalize_tags_for_storage(d.tags.clone());
            let (updated_at, updated_by) = audit.resolve(rel);
            let args = UpsertCaseArgs {
                case_id: d.case_id,
                title: d.title,
                tags: tags_for_db,
                status: d.status.clone(),
                priority: d.priority,
                file_path: rel.clone(),
                repo_slug: slug.to_string(),
                directory: directory_from_file_path(rel),
                approve_status: d.approve_status,
                updated_at,
                updated_by,
                approved_by: d.approved_by,
                approved_at: d.approved_at,
                requirement_id: crate::requirement_ids::requirement_ids_json_for_db(
                    &d.requirement_ids,
                ),
                assigned_to: d.assigned_to,
                automated: d.automated,
                params: normalize_params_for_storage(d.params.clone()),
            };
            upsert_case_db(conn, args)?;
        } else {
            conn.execute(
                "DELETE FROM test_cases WHERE repo_slug = ? AND file_path = ?",
                params![slug, rel],
            )?;
        }
    }
    Ok(())
}

pub(crate) async fn async_index_repo(
    state: &AppState,
    repo_path: &Path,
    slug: &str,
) -> Result<models::YamlIndexStats> {
    let conn_arc = open_repo_db(state, slug)?;
    let indexer = CaseEntityIndexer {
        conn: conn_arc,
        audit: AuditStampSource::for_cases_full(repo_path),
    };
    let s = file_truth_framework::index_entities_full(repo_path, slug, &indexer)?;
    let _ = index_runs_from_yaml_full(state, repo_path, slug).await;
    {
        let conn_arc = open_repo_db(state, slug)?;
        let conn = conn_arc.lock().unwrap();
        let _ = tickets::reindex_tickets_for_repo(&conn, repo_path, slug);
        let _ = ticket_releases::reindex_releases_for_repo(&conn, repo_path, slug);
        let _ = wiki::reindex_wiki_for_repo(&conn, repo_path, slug);
    }
    let _ = stamp_indexed_head(state, repo_path, slug).await;
    Ok(models::YamlIndexStats {
        repo_slug: slug.to_string(),
        indexed: s.indexed,
        errors: s.errors,
        removed: s.removed,
        directories: 0,
    })
}

/// Result of [`ensure_repo_index`]: whether a full scan ran, and how many gitoza paths were applied.
#[derive(Debug, Clone, Default)]
pub struct IndexEnsureOutcome {
    pub did_full: bool,
    pub gitoza_paths_indexed: usize,
}

pub(crate) async fn apply_incremental_tickets_releases_wiki(
    state: &AppState,
    repo_path: &Path,
    slug: &str,
    changed_tickets: &[String],
    changed_releases: &[String],
    changed_wiki: &[String],
    porcelain_paths: &[String],
    git_name: &str,
) -> Result<()> {
    if !changed_tickets.is_empty() {
        let conn_arc = open_repo_db(state, slug)?;
        let conn = conn_arc.lock().unwrap();
        let ticket_audit = audit_source_for_ide_refresh(
            repo_path,
            porcelain_paths,
            changed_tickets,
            &[".gitoza/tasks/tickets"],
            git_name,
        );
        if changed_tickets.len() > INCREMENTAL_THRESHOLD {
            let _ = tickets::reindex_tickets_for_repo(&conn, repo_path, slug);
        } else {
            tickets::apply_incremental_ticket_changes(
                &conn,
                repo_path,
                slug,
                changed_tickets,
                &ticket_audit,
            )?;
        }
    }
    if !changed_releases.is_empty() {
        let conn_arc = open_repo_db(state, slug)?;
        let conn = conn_arc.lock().unwrap();
        let release_audit = audit_source_for_ide_refresh(
            repo_path,
            porcelain_paths,
            changed_releases,
            &[".gitoza/tasks/tickets"],
            git_name,
        );
        if changed_releases.len() > INCREMENTAL_THRESHOLD {
            let _ = ticket_releases::reindex_releases_for_repo(&conn, repo_path, slug);
        } else {
            ticket_releases::apply_incremental_release_changes(
                &conn,
                repo_path,
                slug,
                changed_releases,
                &release_audit,
            )?;
        }
    }
    if !changed_wiki.is_empty() {
        let conn_arc = open_repo_db(state, slug)?;
        let conn = conn_arc.lock().unwrap();
        let wiki_audit = audit_source_for_ide_refresh(
            repo_path,
            porcelain_paths,
            changed_wiki,
            &[".gitoza/wiki"],
            git_name,
        );
        if changed_wiki.len() > INCREMENTAL_THRESHOLD {
            let _ = wiki::reindex_wiki_for_repo(&conn, repo_path, slug);
        } else {
            wiki::apply_incremental_wiki_changes(
                &conn,
                repo_path,
                slug,
                changed_wiki,
                &wiki_audit,
            )?;
        }
    }
    Ok(())
}

/// Warm-start: incremental from stored HEAD + porcelain, or full if no usable cursor.
pub async fn ensure_repo_index(
    state: &AppState,
    repo_path: &Path,
    slug: &str,
) -> Result<IndexEnsureOutcome> {
    let git_lock = repo_git_lock(state, slug);
    let _git_guard = git_lock.lock().await;

    let indexed_head = {
        let conn_arc = open_repo_db(state, slug)?;
        let conn = conn_arc.lock().unwrap();
        get_indexed_head_sha(&conn, slug)?
    };

    let cursor_ok = match indexed_head.as_deref() {
        Some(sha) => git_commit_exists(repo_path, sha).await,
        None => false,
    };

    if !cursor_ok {
        let _stats = async_index_repo(state, repo_path, slug).await?;
        let n = {
            let conn_arc = open_repo_db(state, slug)?;
            let n = count_gitoza_index_rows(&conn_arc.lock().unwrap(), slug);
            n
        };
        return Ok(IndexEnsureOutcome {
            did_full: true,
            gitoza_paths_indexed: n.max(0) as usize,
        });
    }

    let since = indexed_head.expect("cursor_ok implies Some");
    let committed = changed_paths_since(repo_path, &since)
        .await
        .unwrap_or_default();
    let porcelain = git_status_porcelain_paths(repo_path)
        .await
        .unwrap_or_default();
    let merged = merge_path_lists(committed, porcelain.clone());

    let (changed_cases, changed_runs) = filter_case_and_run_yaml_paths(&merged);
    let changed_tickets = tickets::filter_ticket_yaml_paths(&merged);
    let changed_releases = ticket_releases::filter_release_yaml_paths(&merged);
    let changed_wiki = wiki::filter_wiki_yaml_paths(&merged);
    let n = changed_cases.len()
        + changed_runs.len()
        + changed_tickets.len()
        + changed_releases.len()
        + changed_wiki.len();

    if n > 0 {
        let git_name = resolve_git_user_name_cached(state, repo_path, slug).await;
        let mut all_cr = changed_cases.clone();
        all_cr.extend(changed_runs.iter().cloned());
        let case_run_audit = audit_source_for_ide_refresh(
            repo_path,
            &porcelain,
            &all_cr,
            &[".gitoza/test/cases", ".gitoza/test/runs"],
            &git_name,
        );
        sync_index_for_changed_paths(
            state,
            repo_path,
            slug,
            changed_cases,
            changed_runs,
            Some(&case_run_audit),
            Some(&case_run_audit),
        )
        .await?;
        apply_incremental_tickets_releases_wiki(
            state,
            repo_path,
            slug,
            &changed_tickets,
            &changed_releases,
            &changed_wiki,
            &porcelain,
            &git_name,
        )
        .await?;
    }

    let _ = stamp_indexed_head(state, repo_path, slug).await;
    Ok(IndexEnsureOutcome {
        did_full: false,
        gitoza_paths_indexed: n,
    })
}

/// Startup: warm-start each connected repo. Returns whether any repo indexed gitoza paths.
pub async fn ensure_all_repos_index(state: &AppState) -> Result<bool> {
    let repos_dir = state.config_dir.join("repos");
    let mut any = false;
    let entries = std::fs::read_dir(&repos_dir);
    if let Ok(entries) = entries {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() || !p.join(".git").is_dir() {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().to_string();
            if let Ok(o) = ensure_repo_index(state, &p, &slug).await {
                if o.gitoza_paths_indexed > 0 {
                    any = true;
                }
            }
        }
    }
    Ok(any)
}

pub(crate) async fn async_index_all_repos(state: &AppState) -> Result<bool> {
    ensure_all_repos_index(state).await
}

pub(crate) async fn git_effective_user_name(repo_path: &Path) -> Result<Option<String>> {
    let out = git_stdout(repo_path, &["config", "user.name"]).await.ok();
    Ok(normalize_optional_git_identity(out))
}

pub(crate) async fn git_effective_user_email(repo_path: &Path) -> Result<Option<String>> {
    let out = git_stdout(repo_path, &["config", "user.email"]).await.ok();
    Ok(normalize_optional_git_identity(out))
}

async fn git_config_scoped_get(
    repo_path: &Path,
    scope: &[&str],
    key: &str,
) -> Result<Option<String>> {
    let mut args = vec!["config"];
    args.extend_from_slice(scope);
    args.extend(["--get", key]);
    let r = git_run(repo_path, &args).await?;
    if !r.success {
        return Ok(None);
    }
    Ok(normalize_optional_git_identity(Some(r.output)))
}

async fn git_config_show_origin_get(
    repo_path: &Path,
    key: &str,
) -> Result<Option<(String, String)>> {
    let r = git_run(repo_path, &["config", "--show-origin", "--get", key]).await?;
    if !r.success {
        return Ok(None);
    }
    let line = r.output.trim();
    if let Some((origin, value)) = line.split_once('\t') {
        return Ok(Some((origin.trim().to_string(), value.trim().to_string())));
    }
    Ok(None)
}

fn is_repository_config_origin(origin: &str) -> bool {
    if origin.starts_with("global:") || origin.starts_with("system:") {
        return false;
    }
    let Some(path) = origin.strip_prefix("file:") else {
        return false;
    };
    let lower = path.to_lowercase();
    lower.contains(".git/config")
        || lower.contains(".git/worktrees/")
        || lower.ends_with("/config")
        || lower.contains("config.worktree")
}

async fn git_config_read_repo_scoped(repo_path: &Path, key: &str) -> Result<Option<String>> {
    if let Some(v) = git_config_scoped_get(repo_path, &["--local"], key).await? {
        return Ok(Some(v));
    }
    if let Some(v) = git_config_scoped_get(repo_path, &["--worktree"], key).await? {
        return Ok(Some(v));
    }
    if let Some((origin, value)) = git_config_show_origin_get(repo_path, key).await? {
        if is_repository_config_origin(&origin) {
            return Ok(normalize_optional_git_identity(Some(value)));
        }
    }
    Ok(None)
}

/// Raw repo-local `user.name` (not inherited from global).
pub(crate) async fn git_local_user_name(repo_path: &Path) -> Result<Option<String>> {
    git_config_read_repo_scoped(repo_path, "user.name").await
}

/// Raw repo-local `user.email` (not inherited from global).
pub(crate) async fn git_local_user_email(repo_path: &Path) -> Result<Option<String>> {
    git_config_read_repo_scoped(repo_path, "user.email").await
}

/// Value to show in Profile repository fields when raw local is unset but Git effective differs.
pub(crate) fn local_identity_for_display(
    raw_local: Option<String>,
    global: &Option<String>,
    effective: &Option<String>,
) -> Option<String> {
    if raw_local.is_some() {
        return raw_local;
    }
    match (global.as_ref(), effective.as_ref()) {
        (None, Some(e)) => Some(e.clone()),
        (Some(g), Some(e)) if g != e => Some(e.clone()),
        _ => None,
    }
}

pub(crate) async fn git_global_user_name() -> Result<Option<String>> {
    let r = git_process::git_run_global(&["config", "--global", "user.name"]).await?;
    if !r.success {
        return Ok(None);
    }
    Ok(normalize_optional_git_identity(Some(r.output)))
}

pub(crate) async fn git_global_user_email() -> Result<Option<String>> {
    let r = git_process::git_run_global(&["config", "--global", "user.email"]).await?;
    if !r.success {
        return Ok(None);
    }
    Ok(normalize_optional_git_identity(Some(r.output)))
}

fn git_unset_failure_ok(output: &str) -> bool {
    // `git config --local --unset` exits 5 with no output when the key was never set.
    if output.is_empty() {
        return true;
    }
    let lower = output.to_lowercase();
    lower.contains("no such section")
        || lower.contains("has no value")
        || lower.contains("does not exist")
}

async fn git_unset_global_key(key: &str) -> Result<()> {
    let r = git_process::git_run_global(&["config", "--global", "--unset", key]).await?;
    if !r.success && !git_unset_failure_ok(&r.output) {
        return Err(anyhow!("Could not unset global git {key}: {}", r.output));
    }
    Ok(())
}

async fn git_unset_local_key(repo_path: &Path, key: &str) -> Result<()> {
    ensure_git_repo(repo_path).await?;
    for scope in ["--local", "--worktree"] {
        let r = git_run(repo_path, &["config", scope, "--unset", key]).await?;
        if !r.success && !git_unset_failure_ok(&r.output) {
            return Err(anyhow!("Could not unset repo git {key}: {}", r.output));
        }
    }
    Ok(())
}

pub(crate) async fn apply_git_global_identity_name(value: Option<&str>) -> Result<()> {
    match value {
        Some(v) => {
            let r = git_process::git_run_global(&["config", "--global", "user.name", v]).await?;
            if !r.success {
                return Err(anyhow!(
                    "Could not write global git user.name: {}",
                    r.output
                ));
            }
        }
        None => git_unset_global_key("user.name").await?,
    }
    Ok(())
}

pub(crate) async fn apply_git_global_identity_email(value: Option<&str>) -> Result<()> {
    match value {
        Some(v) => {
            let r = git_process::git_run_global(&["config", "--global", "user.email", v]).await?;
            if !r.success {
                return Err(anyhow!(
                    "Could not write global git user.email: {}",
                    r.output
                ));
            }
        }
        None => git_unset_global_key("user.email").await?,
    }
    Ok(())
}

pub(crate) async fn apply_git_local_identity_name(
    repo_path: &Path,
    value: Option<&str>,
) -> Result<()> {
    match value {
        Some(v) => {
            ensure_git_repo(repo_path).await?;
            let r = git_run(repo_path, &["config", "--local", "user.name", v]).await?;
            if !r.success {
                return Err(anyhow!("Could not write repo git user.name: {}", r.output));
            }
        }
        None => git_unset_local_key(repo_path, "user.name").await?,
    }
    Ok(())
}

pub(crate) async fn apply_git_local_identity_email(
    repo_path: &Path,
    value: Option<&str>,
) -> Result<()> {
    match value {
        Some(v) => {
            ensure_git_repo(repo_path).await?;
            let r = git_run(repo_path, &["config", "--local", "user.email", v]).await?;
            if !r.success {
                return Err(anyhow!("Could not write repo git user.email: {}", r.output));
            }
        }
        None => git_unset_local_key(repo_path, "user.email").await?,
    }
    Ok(())
}

pub(crate) async fn git_set_local_user(repo_path: &Path, name: &str, email: &str) -> Result<()> {
    apply_git_local_identity_name(repo_path, Some(name)).await?;
    apply_git_local_identity_email(repo_path, Some(email)).await?;
    Ok(())
}

pub(crate) async fn git_cached_file_diff(repo_path: &Path, file_path: &str) -> Result<String> {
    if file_path.is_empty() || file_path.contains("..") || file_path.starts_with('/') {
        return Ok("".to_string());
    }
    let p = file_path.replace('\\', "/");
    git_stdout(repo_path, &["diff", "--cached", "--", &p]).await
}

/// Staged file changes from `git diff --cached --name-status -M50%`.
pub(crate) async fn git_cached_name_status_changes(
    repo_path: &Path,
) -> Result<Vec<models::PendingFileChange>> {
    let out = git_stdout(repo_path, &["diff", "--cached", "--name-status", "-M50%"]).await?;
    Ok(parse_name_status_changes(&out))
}

/// Max unique entity labels listed in an Auto-sync commit subject before falling back to a count.
const AUTO_SYNC_LABEL_THRESHOLD: usize = 8;

const RUNS_PREFIX: &str = ".gitoza/test/runs/";

/// Extract a short display ID from a staged repo-relative path for Auto-sync commit subjects.
pub(crate) fn commit_label_from_path(file_path: &str) -> Option<String> {
    let p = file_path.trim().replace('\\', "/");
    if p.is_empty() {
        return None;
    }

    // Releases before tickets (same prefix).
    if let Some((project, stem)) = ticket_releases::parse_release_path(&p) {
        return Some(ticket_releases::compose_release_id(&project, &stem));
    }

    if p.starts_with(tickets::TICKETS_PREFIX) {
        let name = Path::new(&p).file_name()?.to_str()?;
        if name.starts_with('.') {
            return None;
        }
        if crate::paths::has_workspace_doc_ext(name) {
            return Path::new(name)
                .file_stem()
                .and_then(|s| s.to_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
        }
    }

    if p.starts_with(CASES_PREFIX) {
        let name = Path::new(&p).file_name()?.to_str()?;
        if name.starts_with('.') {
            return None;
        }
        if crate::paths::has_workspace_doc_ext(name) {
            return Path::new(name)
                .file_stem()
                .and_then(|s| s.to_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
        }
    }

    if wiki::is_wiki_yaml_path(&p) {
        return wiki::wiki_page_id_from_path(&p);
    }

    if let Some(run_id) = run_id_from_staged_path(&p) {
        return Some(run_id);
    }

    if p.starts_with(TEMPLATES_PREFIX) {
        let name = Path::new(&p).file_name()?.to_str()?;
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".md") {
            return Path::new(name)
                .file_stem()
                .and_then(|s| s.to_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
        }
    }

    if p == ".gitoza/config.json" {
        return Some("config".to_string());
    }

    if p.starts_with(".gitoza/") {
        return path_file_stem_or_name(&p);
    }

    path_file_stem_or_name(&p)
}

fn run_id_from_staged_path(p: &str) -> Option<String> {
    let rest = p.strip_prefix(RUNS_PREFIX)?;
    let parts: Vec<&str> = rest.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    if parts[0] == ".archive" {
        if parts.len() >= 2 {
            Some(parts[1].to_string())
        } else {
            None
        }
    } else {
        Some(parts[0].to_string())
    }
}

fn path_file_stem_or_name(p: &str) -> Option<String> {
    Path::new(p)
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            Path::new(p)
                .file_name()
                .and_then(|s| s.to_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
}

/// Build Auto-sync commit subject from staged paths (IDs, deduped). Pure helper for tests.
pub(crate) fn format_auto_sync_commit_message(paths: &[&str]) -> Option<String> {
    let mut labels: Vec<String> = Vec::new();
    let mut seen = HashSet::<String>::new();
    for path in paths {
        if let Some(label) = commit_label_from_path(path) {
            if seen.insert(label.clone()) {
                labels.push(label);
            }
        }
    }
    if labels.is_empty() {
        if paths.is_empty() {
            return None;
        }
        return Some(format!("Auto-sync: {} files", paths.len()));
    }
    if labels.len() <= AUTO_SYNC_LABEL_THRESHOLD {
        Some(format!("Auto-sync: {}", labels.join(", ")))
    } else {
        Some(format!("Auto-sync: {} items", labels.len()))
    }
}

pub(crate) async fn build_commit_message(repo_path: &Path) -> Result<Option<String>> {
    let out = git_stdout(repo_path, &["diff", "--name-only", "--cached"]).await?;
    let files: Vec<&str> = out
        .lines()
        .map(|l| l.trim())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(format_auto_sync_commit_message(&files))
}

pub(crate) async fn git_head_commit_time(repo_path: &Path) -> Result<Option<String>> {
    let out = git_stdout(repo_path, &["log", "-1", "--pretty=format:%cI"]).await;
    Ok(out
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty()))
}

/// Last commit author name + author date for a path (SQLite audit metadata).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommitAuditMeta {
    pub updated_by: String,
    pub updated_at: String,
}

/// `git log -1` author name + author ISO date for one path.
pub(crate) fn git_last_commit_meta(repo_path: &Path, rel_path: &str) -> Option<CommitAuditMeta> {
    let rel = normalize_repo_rel_path(rel_path);
    if rel.is_empty() {
        return None;
    }
    let out = git_stdout_blocking(
        repo_path,
        &["log", "-1", "--pretty=format:%aN%n%aI", "--", &rel],
    )
    .ok()?;
    let mut lines = out.lines();
    let by = lines.next()?.trim();
    let at = lines.next()?.trim();
    if by.is_empty() || at.is_empty() {
        return None;
    }
    Some(CommitAuditMeta {
        updated_by: by.to_string(),
        updated_at: at.to_string(),
    })
}

/// Walk history for `pathspecs`; record first (newest) commit meta per path.
pub(crate) fn git_last_commit_meta_batch(
    repo_path: &Path,
    pathspecs: &[&str],
) -> HashMap<String, CommitAuditMeta> {
    let mut map = HashMap::new();
    if pathspecs.is_empty() {
        return map;
    }
    let mut args: Vec<&str> = vec!["log", "--pretty=format:%aN%x00%aI", "--name-only", "--"];
    args.extend_from_slice(pathspecs);
    let out = match git_stdout_blocking(repo_path, &args) {
        Ok(s) => s,
        Err(_) => return map,
    };
    let mut current: Option<CommitAuditMeta> = None;
    for line in out.lines() {
        if line.contains('\0') {
            let mut parts = line.splitn(2, '\0');
            let by = parts.next().unwrap_or("").trim();
            let at = parts.next().unwrap_or("").trim();
            current = if !by.is_empty() && !at.is_empty() {
                Some(CommitAuditMeta {
                    updated_by: by.to_string(),
                    updated_at: at.to_string(),
                })
            } else {
                None
            };
            continue;
        }
        let path = normalize_repo_rel_path(line);
        if path.is_empty() {
            continue;
        }
        if let Some(ref meta) = current {
            map.entry(path).or_insert_with(|| meta.clone());
        }
    }
    map
}

/// Resolve commit meta for an explicit path list (per-path for small N, else batch + filter).
pub(crate) fn git_last_commit_meta_for_paths(
    repo_path: &Path,
    paths: &[String],
    batch_pathspecs: &[&str],
) -> HashMap<String, CommitAuditMeta> {
    let mut out = HashMap::new();
    if paths.is_empty() {
        return out;
    }
    if paths.len() <= 32 {
        for p in paths {
            let key = normalize_repo_rel_path(p);
            if let Some(meta) = git_last_commit_meta(repo_path, &key) {
                out.insert(key, meta);
            }
        }
        return out;
    }
    let batch = git_last_commit_meta_batch(repo_path, batch_pathspecs);
    for p in paths {
        let key = normalize_repo_rel_path(p);
        if let Some(meta) = batch.get(&key) {
            out.insert(key, meta.clone());
        }
    }
    out
}

/// How to fill SQLite `updated_at` / `updated_by` during index (never from YAML).
#[derive(Debug, Clone)]
pub(crate) enum AuditStampSource {
    /// Clone / pull / full reindex: commit meta only.
    CommitMeta(HashMap<String, CommitAuditMeta>),
    /// IDE refresh: porcelain-dirty paths get local now + git user; others commit meta.
    Mixed {
        dirty: HashSet<String>,
        local_by: String,
        local_at: String,
        commit_meta: HashMap<String, CommitAuditMeta>,
    },
}

impl AuditStampSource {
    pub(crate) fn for_cases_full(repo_path: &Path) -> Self {
        Self::CommitMeta(git_last_commit_meta_batch(
            repo_path,
            &[".gitoza/test/cases"],
        ))
    }

    pub(crate) fn for_tickets_full(repo_path: &Path) -> Self {
        Self::CommitMeta(git_last_commit_meta_batch(
            repo_path,
            &[".gitoza/tasks/tickets"],
        ))
    }

    pub(crate) fn for_releases_full(repo_path: &Path) -> Self {
        Self::CommitMeta(git_last_commit_meta_batch(
            repo_path,
            &[".gitoza/tasks/tickets"],
        ))
    }

    pub(crate) fn for_wiki_full(repo_path: &Path) -> Self {
        Self::CommitMeta(git_last_commit_meta_batch(repo_path, &[".gitoza/wiki"]))
    }

    pub(crate) fn resolve(&self, rel_path: &str) -> (Option<String>, Option<String>) {
        let key = normalize_repo_rel_path(rel_path);
        match self {
            Self::CommitMeta(map) => match map.get(&key) {
                Some(m) => (Some(m.updated_at.clone()), Some(m.updated_by.clone())),
                None => (None, None),
            },
            Self::Mixed {
                dirty,
                local_by,
                local_at,
                commit_meta,
            } => {
                if dirty.contains(&key) {
                    (Some(local_at.clone()), Some(local_by.clone()))
                } else {
                    match commit_meta.get(&key) {
                        Some(m) => (Some(m.updated_at.clone()), Some(m.updated_by.clone())),
                        None => (None, None),
                    }
                }
            }
        }
    }

    pub(crate) fn resolve_meta(&self, rel_path: &str) -> Option<CommitAuditMeta> {
        let (at, by) = self.resolve(rel_path);
        match (at, by) {
            (Some(updated_at), Some(updated_by)) => Some(CommitAuditMeta {
                updated_at,
                updated_by,
            }),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Path / slug resolution
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct StoredConfig {
    repo_path: String,
    #[serde(default)]
    #[allow(dead_code)] // retained for serde compat with on-disk config.json
    remote_url: Option<String>,
    #[serde(default)]
    #[allow(dead_code)] // retained for serde compat with on-disk config.json
    branch: Option<String>,
    #[serde(default)]
    #[allow(dead_code)] // retained for serde compat with on-disk config.json
    connection_type: Option<String>,
}

#[derive(Debug)]
pub(crate) struct LoadedConfig {
    pub(crate) repo_path: PathBuf,
}

pub(crate) fn load_config(config_dir: &Path) -> Result<Option<LoadedConfig>> {
    let config_file = config_dir.join("config.json");
    if !config_file.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&config_file)
        .with_context(|| format!("Failed to read {}", config_file.display()))?;
    let parsed: StoredConfig = serde_json::from_str(&raw)
        .with_context(|| format!("Failed to parse {}", config_file.display()))?;
    let repo_path = PathBuf::from(parsed.repo_path);
    if !repo_path.exists() {
        return Ok(None);
    }
    Ok(Some(LoadedConfig { repo_path }))
}

pub(crate) fn resolve_repo_slug(state: &AppState, explicit: Option<&str>) -> Result<String> {
    if let Some(s) = explicit.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        return Ok(s.to_string());
    }
    let cfg = load_config(&state.config_dir)?
        .ok_or_else(|| anyhow!("No repository specified and no default configured."))?;
    let slug = cfg
        .repo_path
        .file_name()
        .ok_or_else(|| anyhow!("Invalid configured repo_path"))?
        .to_string_lossy()
        .to_string();
    Ok(slug)
}

pub fn resolve_repo_path(state: &AppState, slug_opt: Option<&str>) -> Result<PathBuf> {
    let slug = resolve_repo_slug(state, slug_opt)?;

    if let Ok(Some(cfg)) = load_config(&state.config_dir) {
        if cfg.repo_path.is_dir() {
            let cfg_slug = cfg
                .repo_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string());
            let git_path = cfg.repo_path.join(".git");
            if cfg_slug.as_deref() == Some(slug.as_str()) && git_path.exists() {
                return Ok(cfg.repo_path);
            }
        }
    }

    let p = state.config_dir.join("repos").join(&slug);
    if p.is_dir() && p.join(".git").exists() {
        return Ok(p);
    }
    if let Ok(Some(cfg)) = load_config(&state.config_dir) {
        if cfg.repo_path.is_dir() && cfg.repo_path.join(".git").exists() {
            return Ok(cfg.repo_path);
        }
    }
    Err(anyhow!("Repository not found: {slug}"))
}

pub(crate) fn directory_from_file_path(file_path: &str) -> String {
    let normalized = file_path.replace('\\', "/");
    if !normalized.starts_with(CASES_PREFIX) {
        return "".to_string();
    }
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.len() < 4 {
        return "".to_string();
    }
    if parts.len() >= 5 && parts[3] == CASES_ARCHIVE_DIR {
        return parts[..5].join("/");
    }
    parts[..4].join("/")
}

/// First-level project dirs under `.gitoza/test/cases/.archive/`.
pub(crate) fn discover_archive_project_rel_paths(repo_path: &Path) -> Vec<String> {
    let archive_root = repo_path.join(".gitoza/test/cases/.archive");
    if !archive_root.is_dir() {
        return vec![];
    }
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&archive_root) {
        for e in entries.flatten() {
            let name = e.file_name();
            let name_s = name.to_string_lossy();
            if name_s.starts_with('.') {
                continue;
            }
            if CASE_PROJECT_IGNORE_NAMES
                .iter()
                .any(|&x| x == name_s.as_ref())
            {
                continue;
            }
            let p = e.path();
            if p.is_dir() {
                out.push(rel_path_unix(repo_path, &p));
            }
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use indexmap::IndexMap;
    use std::collections::{BTreeMap, HashMap};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        p.push(format!("gitoza_test_{prefix}_{t}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn normalize_tags_preserves_first_seen_order_case_insensitive_dedupe() {
        let out = normalize_tags_for_storage(vec![
            "login".to_string(),
            "Login".to_string(),
            "Add user".to_string(),
        ]);
        assert_eq!(out, vec!["login".to_string(), "Add user".to_string()]);
    }

    #[test]
    fn yaml_roundtrip_preserves_tags_order() {
        let dir = temp_dir("yaml_roundtrip");
        let file = dir.join("case.md");

        let mut fm = IndexMap::<String, serde_yaml::Value>::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("T".to_string()),
        );
        fm.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::String("Alpha".to_string()),
                serde_yaml::Value::String("beta".to_string()),
            ]),
        );
        fm.insert(
            "status".to_string(),
            serde_yaml::Value::String("active".to_string()),
        );
        fm.insert(
            "priority".to_string(),
            serde_yaml::Value::String("medium".to_string()),
        );
        fm.insert(
            "approve_status".to_string(),
            serde_yaml::Value::String("draft".to_string()),
        );
        fm.insert(
            "updated_at".to_string(),
            serde_yaml::Value::String("2020-01-01T00:00:00Z".to_string()),
        );
        fm.insert(
            "updated_by".to_string(),
            serde_yaml::Value::String("u".to_string()),
        );

        write_full_yaml(
            &file,
            &fm,
            "Hello body\nwith newlines\n".to_string().as_str(),
        )
        .unwrap();

        let parsed = read_full_yaml(&file).unwrap().unwrap();
        assert_eq!(parsed.tags, vec!["Alpha".to_string(), "beta".to_string()]);
        assert_eq!(parsed.body.trim(), "Hello body\nwith newlines");
    }

    #[test]
    fn write_full_yaml_preserves_indexmap_insertion_order() {
        let dir = temp_dir("yaml_title_order");
        let file = dir.join("case.md");
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("My Title".to_string()),
        );
        fm.insert(
            "approve_status".to_string(),
            serde_yaml::Value::String("draft".to_string()),
        );
        write_full_yaml(&file, &fm, "body").unwrap();
        let raw = fs::read_to_string(&file).unwrap();
        let after_sep = raw.strip_prefix("---\n").expect("expected --- header");
        let first_line = after_sep.lines().next().expect("front matter line");
        assert_eq!(first_line.trim(), "title: My Title");
    }

    #[test]
    fn update_preserves_on_disk_front_matter_key_order_and_unknown_keys() {
        let dir = temp_dir("yaml_preserve_order");
        let file = dir.join("case.md");
        let ai_raw = "---\ntags:\n- a\nai_only: keep-me\ntitle: Hello\nstatus: active\n---\n\nBody one\n";
        fs::write(&file, ai_raw).unwrap();

        let mut desired = IndexMap::new();
        desired.insert(
            "title".to_string(),
            serde_yaml::Value::String("Hello".to_string()),
        );
        desired.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::String("a".to_string())]),
        );
        desired.insert(
            "status".to_string(),
            serde_yaml::Value::String("deprecated".to_string()),
        );
        write_yaml_from_existing_raw(&file, ai_raw, &desired, "Body one").unwrap();

        let raw = fs::read_to_string(&file).unwrap();
        let after_sep = raw.strip_prefix("---\n").unwrap();
        let lines: Vec<&str> = after_sep
            .lines()
            .take_while(|l| *l != "---")
            .collect();
        assert!(lines[0].starts_with("tags:"));
        assert!(raw.contains("ai_only: keep-me"));
        assert!(raw.contains("status: deprecated"));
        // title stays after tags/ai_only in original relative order
        let tags_pos = raw.find("tags:").unwrap();
        let ai_pos = raw.find("ai_only:").unwrap();
        let title_pos = raw.find("title:").unwrap();
        let status_pos = raw.find("status:").unwrap();
        assert!(tags_pos < ai_pos && ai_pos < title_pos && title_pos < status_pos);
    }

    #[test]
    fn reconcile_preserves_disk_tag_and_scalar_casing_for_body_only() {
        let dir = temp_dir("yaml_casing_body_only");
        let file = dir.join("ticket.md");
        let disk = "---\ntitle: T\ntype: task\nstatus: Open\npriority: low\ntags:\n- handbook\n- backlog\n---\n\nOld body\n";
        fs::write(&file, disk).unwrap();
        let before = fs::read_to_string(&file).unwrap();
        let stripped = before.trim_start();
        let rest = &stripped[3..];
        let end = rest.find("\n---").unwrap();
        let prefix_len = (before.len() - stripped.len()) + 3 + end + 4;
        let fm_bytes = before[..prefix_len].to_string();

        let mut desired = IndexMap::new();
        desired.insert(
            "title".to_string(),
            serde_yaml::Value::String("T".to_string()),
        );
        desired.insert(
            "type".to_string(),
            serde_yaml::Value::String("task".to_string()),
        );
        desired.insert(
            "status".to_string(),
            serde_yaml::Value::String("open".to_string()),
        );
        desired.insert(
            "priority".to_string(),
            serde_yaml::Value::String("low".to_string()),
        );
        desired.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::String("Handbook".to_string()),
                serde_yaml::Value::String("Backlog".to_string()),
            ]),
        );
        let reconciled = reconcile_desired_front_matter_with_disk(&before, &desired);
        assert_eq!(
            reconciled.get("status").and_then(|v| v.as_str()),
            Some("Open")
        );
        let tags = reconciled
            .get("tags")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(tags[0].as_str(), Some("handbook"));
        assert_eq!(tags[1].as_str(), Some("backlog"));
        assert!(front_matter_matches_desired(&before, &reconciled));

        write_yaml_update_preserving_order(&file, &before, &reconciled, "New body", true).unwrap();
        let after = fs::read_to_string(&file).unwrap();
        assert!(after.starts_with(&fm_bytes));
        assert!(after.contains("New body"));
        assert!(after.contains("- handbook"));
        assert!(!after.contains("Handbook"));
    }

    #[test]
    fn reconcile_keeps_real_tag_change() {
        let disk = "---\ntags:\n- handbook\ntitle: T\n---\n\nBody\n";
        let mut desired = IndexMap::new();
        desired.insert(
            "title".to_string(),
            serde_yaml::Value::String("T".to_string()),
        );
        desired.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::String("docs".to_string())]),
        );
        let reconciled = reconcile_desired_front_matter_with_disk(disk, &desired);
        let tags = reconciled
            .get("tags")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(tags[0].as_str(), Some("docs"));
    }

    #[test]
    fn body_only_rewrite_keeps_front_matter_bytes_identical() {
        let dir = temp_dir("yaml_body_only");
        let file = dir.join("case.md");
        let ai_raw = "---\ntags:\n- z\ntitle: T\n---\n\nOld body\n";
        fs::write(&file, ai_raw).unwrap();
        let before = fs::read_to_string(&file).unwrap();
        let stripped = before.trim_start();
        let rest = &stripped[3..];
        let end = rest.find("\n---").unwrap();
        let prefix_len = (before.len() - stripped.len()) + 3 + end + 4;
        let fm_bytes = before[..prefix_len].to_string();

        let mut desired = IndexMap::new();
        desired.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::String("z".to_string())]),
        );
        desired.insert(
            "title".to_string(),
            serde_yaml::Value::String("T".to_string()),
        );
        assert!(front_matter_matches_desired(&before, &desired));
        write_yaml_update_preserving_order(&file, &before, &desired, "New body", true).unwrap();

        let after = fs::read_to_string(&file).unwrap();
        assert!(after.starts_with(&fm_bytes));
        assert!(after.contains("New body"));
        assert!(!after.contains("Old body"));
    }

    #[test]
    fn write_full_yaml_allows_empty_body_between_separators() {
        let dir = temp_dir("yaml_empty_body");
        let file = dir.join("case.md");
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("T".to_string()),
        );
        write_full_yaml(&file, &fm, "").unwrap();
        let parsed = read_full_yaml(&file).unwrap().unwrap();
        assert_eq!(parsed.body, "");
        let raw = fs::read_to_string(&file).unwrap();
        let parts: Vec<_> = raw.split("---").collect();
        assert!(parts.len() >= 3);
        assert!(parts[2].trim().is_empty());
    }

    #[test]
    fn read_full_yaml_defaults_comments_empty_when_omitted() {
        let dir = temp_dir("yaml_comments_default");
        let file = dir.join("case.md");
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("T".to_string()),
        );
        write_full_yaml(&file, &fm, "body").unwrap();
        let parsed = read_full_yaml(&file).unwrap().unwrap();
        assert!(parsed.comments.is_empty());
    }

    #[test]
    fn remove_comment_at_index_requires_author_match() {
        let mut comments = vec![models::Comment {
            author: "Alice".to_string(),
            timestamp: "t1".to_string(),
            text: "hi".to_string(),
        }];
        assert_eq!(
            remove_comment_at_index(&mut comments, 0, "Bob"),
            Err("not_author")
        );
        assert_eq!(comments.len(), 1);
        remove_comment_at_index(&mut comments, 0, "Alice").unwrap();
        assert!(comments.is_empty());
    }

    #[test]
    fn parse_comments_from_yaml_value_skips_invalid_entries() {
        let v = serde_yaml::from_str(
            r#"
- author: Alice
  timestamp: "2024-01-01T00:00:00Z"
  text: Hello
- not_a_map: true
- author: Bob
  text: ""
"#,
        )
        .unwrap();
        let comments = parse_comments_from_yaml_value(&v);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].author, "Alice");
        assert_eq!(comments[0].text, "Hello");
    }

    #[test]
    fn read_full_yaml_defaults_status_active_approve_draft_when_omitted() {
        let dir = temp_dir("yaml_defaults");
        let file = dir.join("minimal.md");
        fs::write(&file, "---\ntitle: Only title\n---\n\nBody.\n").unwrap();
        let parsed = read_full_yaml(&file).unwrap().unwrap();
        assert_eq!(parsed.title.as_deref(), Some("Only title"));
        assert_eq!(parsed.status.as_deref(), Some("active"));
        assert_eq!(parsed.approve_status, "draft");
    }

    #[test]
    fn read_full_yaml_requirement_ids_legacy_and_list() {
        let dir = temp_dir("yaml_req_ids");
        let scalar = dir.join("scalar.md");
        fs::write(
            &scalar,
            "---\ntitle: T\nrequirement_id: DEMO-1\n---\n\nBody.\n",
        )
        .unwrap();
        let parsed = read_full_yaml(&scalar).unwrap().unwrap();
        assert_eq!(parsed.requirement_ids, vec!["DEMO-1".to_string()]);

        let list = dir.join("list.md");
        fs::write(
            &list,
            "---\ntitle: T\nrequirement_ids:\n  - DEMO-A\n  - DEMO-B\n---\n\nBody.\n",
        )
        .unwrap();
        let parsed = read_full_yaml(&list).unwrap().unwrap();
        assert_eq!(
            parsed.requirement_ids,
            vec!["DEMO-A".to_string(), "DEMO-B".to_string()]
        );

        let fm = case_detail_to_front_matter(&parsed);
        assert!(!fm.contains_key("requirement_id"));
        write_full_yaml(&list, &fm, "Body").unwrap();
        let raw = fs::read_to_string(&list).unwrap();
        assert!(raw.contains("requirement_ids:"));
        assert!(!raw.contains("requirement_id:"));

        let mut d = read_full_yaml(&list).unwrap().unwrap();
        d.requirement_ids = crate::requirement_ids::add_requirement_id(d.requirement_ids, "DEMO-C");
        d.requirement_ids =
            crate::requirement_ids::remove_requirement_id(d.requirement_ids, "DEMO-A");
        let fm = case_detail_to_front_matter(&d);
        write_full_yaml(&list, &fm, "Body").unwrap();
        let parsed = read_full_yaml(&list).unwrap().unwrap();
        assert_eq!(
            crate::requirement_ids::join_requirement_ids(&parsed.requirement_ids),
            "DEMO-B, DEMO-C"
        );
    }

    #[test]
    fn yaml_roundtrip_preserves_params() {
        let dir = temp_dir("yaml_params_roundtrip");
        let file = dir.join("case.md");

        let mut params = BTreeMap::new();
        params.insert("browser".to_string(), "Chrome".to_string());
        params.insert("environment".to_string(), "staging".to_string());

        let detail = models::YamlCaseDetail {
            case_id: "TC-1".to_string(),
            title: Some("Params case".to_string()),
            tags: vec![],
            status: Some("active".to_string()),
            priority: Some("medium".to_string()),
            file_path: "".to_string(),
            body: "Body".to_string(),
            raw: String::new(),
            approve_status: "draft".to_string(),
            updated_at: None,
            updated_by: None,
            approved_by: None,
            approved_at: None,
            requirement_ids: vec![],
            assigned_to: None,
            automated: false,
            comments: vec![],
            params: params.clone(),
        };

        let fm = case_detail_to_front_matter(&detail);
        write_full_yaml(&file, &fm, "Body").unwrap();

        let parsed = read_full_yaml(&file).unwrap().unwrap();
        assert_eq!(parsed.params, params);
    }

    #[test]
    fn case_detail_to_front_matter_omits_empty_params() {
        let detail = models::YamlCaseDetail {
            case_id: "TC-1".to_string(),
            title: Some("No params".to_string()),
            tags: vec![],
            status: Some("active".to_string()),
            priority: Some("medium".to_string()),
            file_path: "".to_string(),
            body: "Body".to_string(),
            raw: String::new(),
            approve_status: "draft".to_string(),
            updated_at: None,
            updated_by: None,
            approved_by: None,
            approved_at: None,
            requirement_ids: vec![],
            assigned_to: None,
            automated: false,
            comments: vec![],
            params: BTreeMap::new(),
        };
        let fm = case_detail_to_front_matter(&detail);
        assert!(!fm.contains_key("params"));
    }

    #[test]
    fn automated_yaml_roundtrip_true_only_when_set() {
        let dir = temp_dir("yaml_automated_roundtrip");
        let file = dir.join("case.md");

        let automated_detail = models::YamlCaseDetail {
            case_id: "TC-A".to_string(),
            title: Some("Automated case".to_string()),
            tags: vec![],
            status: Some("active".to_string()),
            priority: Some("medium".to_string()),
            file_path: "".to_string(),
            body: "Body".to_string(),
            raw: String::new(),
            approve_status: "draft".to_string(),
            updated_at: None,
            updated_by: None,
            approved_by: None,
            approved_at: None,
            requirement_ids: vec![],
            assigned_to: None,
            automated: true,
            comments: vec![],
            params: BTreeMap::new(),
        };
        let fm = case_detail_to_front_matter(&automated_detail);
        assert_eq!(fm.get("automated").and_then(|v| v.as_bool()), Some(true));
        write_full_yaml(&file, &fm, "Body").unwrap();
        let parsed = read_full_yaml(&file).unwrap().unwrap();
        assert!(parsed.automated);

        let manual_detail = models::YamlCaseDetail {
            automated: false,
            ..automated_detail
        };
        let fm_manual = case_detail_to_front_matter(&manual_detail);
        assert!(!fm_manual.contains_key("automated"));
    }

    #[test]
    fn dashboard_projects_from_db_counts_automated_cases() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "r1";
        let dir = ".gitoza/test/cases/p";
        upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "a".to_string(),
                title: Some("A".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("high".to_string()),
                file_path: format!("{dir}/a.md"),
                repo_slug: repo.to_string(),
                directory: dir.to_string(),
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: None,
                assigned_to: None,
                automated: true,
                params: BTreeMap::new(),
            },
        )
        .unwrap();
        upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "b".to_string(),
                title: Some("B".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("low".to_string()),
                file_path: format!("{dir}/b.md"),
                repo_slug: repo.to_string(),
                directory: dir.to_string(),
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

        let rows = dashboard_projects_from_db(&conn, repo).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].total_test_cases, 2);
        assert_eq!(rows[0].automated_count, 1);
    }

    #[test]
    fn query_cases_db_filters_by_automated() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "r1";
        let dir = ".gitoza/test/cases/p";
        for (case_id, automated) in [("auto", true), ("manual", false)] {
            upsert_case_db(
                &conn,
                UpsertCaseArgs {
                    case_id: case_id.to_string(),
                    title: Some(case_id.to_string()),
                    tags: vec![],
                    status: Some("active".to_string()),
                    priority: Some("medium".to_string()),
                    file_path: format!("{dir}/{case_id}.md"),
                    repo_slug: repo.to_string(),
                    directory: dir.to_string(),
                    approve_status: "draft".to_string(),
                    updated_at: None,
                    updated_by: None,
                    approved_by: None,
                    approved_at: None,
                    requirement_id: None,
                    assigned_to: None,
                    automated,
                    params: BTreeMap::new(),
                },
            )
            .unwrap();
        }

        let (auto_items, auto_total) = query_cases_db(
            &conn,
            repo,
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: None,
                approve_status: None,
                updated_by: None,
                assigned_to: None,
                requirement_id: None,
                automated: Some(true),
                param_filters: None,
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 100,
                offset: 0,
            },
            false,
        )
        .unwrap();
        assert_eq!(auto_total, 1);
        assert_eq!(auto_items[0].case_id, "auto");
        assert!(auto_items[0].automated);
    }

    #[test]
    fn all_param_keys_and_values_aggregate_from_index() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let mut params_a = BTreeMap::new();
        params_a.insert("browser".to_string(), "Chrome".to_string());
        params_a.insert("env".to_string(), "staging".to_string());

        let mut params_b = BTreeMap::new();
        params_b.insert("browser".to_string(), "Firefox".to_string());
        params_b.insert("device".to_string(), "mobile".to_string());

        upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "c1".to_string(),
                title: Some("A".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: ".gitoza/test/cases/p/a.md".to_string(),
                repo_slug: "r1".to_string(),
                directory: ".gitoza/test/cases/p".to_string(),
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: None,
                assigned_to: None,
                automated: false,
                params: params_a,
            },
        )
        .unwrap();

        upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "c2".to_string(),
                title: Some("B".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: ".gitoza/test/cases/p/b.md".to_string(),
                repo_slug: "r1".to_string(),
                directory: ".gitoza/test/cases/p".to_string(),
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: None,
                assigned_to: None,
                automated: false,
                params: params_b,
            },
        )
        .unwrap();

        let keys = all_param_keys(&conn, "r1").unwrap();
        assert_eq!(keys, vec!["browser", "device", "env"]);

        let values = all_param_values_by_key(&conn, "r1").unwrap();
        assert_eq!(
            values.get("browser").cloned().unwrap(),
            vec!["Chrome".to_string(), "Firefox".to_string()]
        );
        assert_eq!(
            values.get("env").cloned().unwrap(),
            vec!["staging".to_string()]
        );
    }

    #[test]
    fn sqlite_upsert_case_updates_approve_and_requirement() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let now1 = "2020-01-01T00:00:00Z".to_string();
        let now2 = "2020-02-02T00:00:00Z".to_string();
        let args1 = UpsertCaseArgs {
            case_id: "c1".to_string(),
            title: Some("Old".to_string()),
            tags: vec!["Tag".to_string()],
            status: Some("active".to_string()),
            priority: Some("medium".to_string()),
            file_path: ".gitoza/test/cases/p/a.md".to_string(),
            repo_slug: "r1".to_string(),
            directory: " .gitoza/test/cases/p/a".trim().to_string(),
            approve_status: "draft".to_string(),
            updated_at: Some(now1.clone()),
            updated_by: Some("user".to_string()),
            approved_by: None,
            approved_at: None,
            requirement_id: Some("req1".to_string()),
            assigned_to: None,
            automated: false,
            params: BTreeMap::new(),
        };
        upsert_case_db(&conn, args1).unwrap();

        let row1: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT title, requirement_id FROM test_cases WHERE repo_slug = ? AND file_path = ?",
                params!["r1", ".gitoza/test/cases/p/a.md"],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row1.0.unwrap(), "Old".to_string());
        assert_eq!(row1.1.unwrap(), "req1".to_string());

        let args2 = UpsertCaseArgs {
            case_id: "c1".to_string(),
            title: Some("New".to_string()),
            tags: vec!["Tag".to_string()],
            status: Some("active".to_string()),
            priority: Some("medium".to_string()),
            file_path: ".gitoza/test/cases/p/a.md".to_string(),
            repo_slug: "r1".to_string(),
            directory: ".gitoza/test/cases/p".to_string(),
            approve_status: "approved".to_string(),
            updated_at: Some(now2.clone()),
            updated_by: Some("user2".to_string()),
            approved_by: Some("user2".to_string()),
            approved_at: Some(now2),
            requirement_id: None,
            assigned_to: Some("Dev".to_string()),
            automated: false,
            params: BTreeMap::new(),
        };
        upsert_case_db(&conn, args2).unwrap();

        let row2: (Option<String>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT title, approve_status, requirement_id FROM test_cases WHERE repo_slug = ? AND file_path = ?",
                params!["r1", ".gitoza/test/cases/p/a.md"],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(row2.0.unwrap(), "New".to_string());
        assert_eq!(row2.1.unwrap(), "approved".to_string());
        assert!(row2.2.is_none());
    }

    #[test]
    fn query_cases_db_requirement_id_contains_json_and_scalar() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let fp_json = ".gitoza/test/cases/p/multi.md";
        let fp_scalar = ".gitoza/test/cases/p/legacy.md";
        upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "multi".to_string(),
                title: Some("Multi".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: fp_json.to_string(),
                repo_slug: "r1".to_string(),
                directory: ".gitoza/test/cases/p".to_string(),
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: Some(r#"["DEMO-A","DEMO-B"]"#.to_string()),
                assigned_to: None,
                automated: false,
                params: BTreeMap::new(),
            },
        )
        .unwrap();
        upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "legacy".to_string(),
                title: Some("Legacy".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: fp_scalar.to_string(),
                repo_slug: "r1".to_string(),
                directory: ".gitoza/test/cases/p".to_string(),
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: Some("DEMO-A".to_string()),
                assigned_to: None,
                automated: false,
                params: BTreeMap::new(),
            },
        )
        .unwrap();

        let args = QueryCasesArgs {
            search: None,
            status: None,
            priority: None,
            tag: None,
            directory: None,
            directories: None,
            path_prefix: None,
            approve_status: None,
            updated_by: None,
            assigned_to: None,
            requirement_id: Some("DEMO-A".to_string()),
            automated: None,
            param_filters: None,
            exclude_archived: true,
            sort_by: "case_id".to_string(),
            sort_dir: "asc".to_string(),
            limit: 100,
            offset: 0,
        };
        let (items, total) = query_cases_db(&conn, "r1", args, false).unwrap();
        assert_eq!(total, 2);
        let mut ids: Vec<_> = items.into_iter().map(|c| c.case_id).collect();
        ids.sort();
        assert_eq!(ids, vec!["legacy".to_string(), "multi".to_string()]);

        let args_b = QueryCasesArgs {
            search: None,
            status: None,
            priority: None,
            tag: None,
            directory: None,
            directories: None,
            path_prefix: None,
            approve_status: None,
            updated_by: None,
            assigned_to: None,
            requirement_id: Some("DEMO-B".to_string()),
            automated: None,
            param_filters: None,
            exclude_archived: true,
            sort_by: "case_id".to_string(),
            sort_dir: "asc".to_string(),
            limit: 100,
            offset: 0,
        };
        let (items_b, total_b) = query_cases_db(&conn, "r1", args_b, false).unwrap();
        assert_eq!(total_b, 1);
        assert_eq!(items_b[0].case_id, "multi");
        assert_eq!(
            items_b[0].requirement_ids,
            vec!["DEMO-A".to_string(), "DEMO-B".to_string()]
        );
    }

    fn seed_case_for_query(
        conn: &Connection,
        repo_slug: &str,
        file_path: &str,
        case_id: &str,
        status: &str,
    ) {
        let directory = directory_from_file_path(file_path);
        upsert_case_db(
            conn,
            UpsertCaseArgs {
                case_id: case_id.to_string(),
                title: Some(format!("Title {case_id}")),
                tags: vec![],
                status: Some(status.to_string()),
                priority: Some("medium".to_string()),
                file_path: file_path.to_string(),
                repo_slug: repo_slug.to_string(),
                directory,
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: Some("alice".to_string()),
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
    fn query_cases_db_path_prefix_scopes_to_subtree() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_case_for_query(
            &conn,
            "r1",
            ".gitoza/test/cases/auth/login/a.md",
            "a",
            "active",
        );
        seed_case_for_query(
            &conn,
            "r1",
            ".gitoza/test/cases/auth/login/b.md",
            "b",
            "active",
        );
        seed_case_for_query(
            &conn,
            "r1",
            ".gitoza/test/cases/other/x.md",
            "x",
            "active",
        );

        let (items, total) = query_cases_db(
            &conn,
            "r1",
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: Some(".gitoza/test/cases/auth/login".to_string()),
                approve_status: None,
                updated_by: None,
                assigned_to: None,
                requirement_id: None,
                automated: None,
                param_filters: None,
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 100,
                offset: 0,
            },
            false,
        )
        .unwrap();

        assert_eq!(total, 2);
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|i| i.file_path.contains("/auth/login/")));
    }

    #[test]
    fn query_cases_db_total_exceeds_page_size() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        for i in 0..5 {
            seed_case_for_query(
                &conn,
                "r1",
                &format!(".gitoza/test/cases/p/c{i}.md"),
                &format!("c{i}"),
                "active",
            );
        }

        let (items, total) = query_cases_db(
            &conn,
            "r1",
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: None,
                approve_status: None,
                updated_by: None,
                assigned_to: None,
                requirement_id: None,
                automated: None,
                param_filters: None,
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 2,
                offset: 0,
            },
            false,
        )
        .unwrap();

        assert_eq!(total, 5);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn query_cases_db_path_prefix_excludes_archived() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_case_for_query(
            &conn,
            "r1",
            ".gitoza/test/cases/p/active.md",
            "active",
            "active",
        );
        seed_case_for_query(
            &conn,
            "r1",
            ".gitoza/test/cases/.archive/p/old.md",
            "old",
            "archived",
        );

        let (items, total) = query_cases_db(
            &conn,
            "r1",
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: Some(".gitoza/test/cases/p".to_string()),
                approve_status: None,
                updated_by: None,
                assigned_to: None,
                requirement_id: None,
                automated: None,
                param_filters: None,
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 100,
                offset: 0,
            },
            false,
        )
        .unwrap();

        assert_eq!(total, 1);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].case_id, "active");
    }

    fn seed_run_for_search(
        conn: &Connection,
        repo_slug: &str,
        run_id: &str,
        name: &str,
        archived: bool,
        run_assigned_to: Option<&str>,
    ) {
        conn.execute(
            r#"
INSERT INTO test_runs
  (run_id, repo_slug, name, description, created_at, updated_at, archived, approve_status, assigned_to)
VALUES (?1, ?2, ?3, '', '2024-01-01', '2024-01-02', ?4, 'draft', ?5)
"#,
            params![
                run_id,
                repo_slug,
                name,
                if archived { 1 } else { 0 },
                run_assigned_to
            ],
        )
        .unwrap();
    }

    fn seed_run_case_for_search(
        conn: &Connection,
        repo_slug: &str,
        run_id: &str,
        file_path: &str,
        case_id: &str,
        title: &str,
        tags: &[&str],
        priority: &str,
        requirement_id: Option<&str>,
        executed_by: Option<&str>,
        case_assigned_to: Option<&str>,
        result: Option<&str>,
    ) {
        let tags_json = if tags.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&tags).unwrap())
        };
        conn.execute(
            r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, title, tags, priority, requirement_id, executed_by, assigned_to)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
"#,
            params![
                run_id,
                repo_slug,
                file_path,
                case_id,
                title,
                tags_json,
                priority,
                requirement_id,
                executed_by,
                case_assigned_to
            ],
        )
        .unwrap();
        if let Some(res) = result {
            conn.execute(
                r#"
INSERT INTO test_run_results (run_id, file_path, result, executed_at)
VALUES (?1, ?2, ?3, '2024-01-03')
"#,
                params![run_id, file_path, res],
            )
            .unwrap();
        }
    }

    #[test]
    fn query_run_cases_db_filters_by_result_pending_and_tag() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_for_search(&conn, "r1", "run-a", "Smoke", false, None);
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/p/a.md",
            "TC-1",
            "Alpha",
            &["smoke"],
            "High",
            Some("REQ-1"),
            Some("alice"),
            None,
            Some("failed"),
        );
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/p/b.md",
            "TC-2",
            "Beta",
            &["smoke"],
            "Low",
            None,
            None,
            None,
            None,
        );

        let (failed, _) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: None,
                folder_prefix: None,
                search: None,
                tag: Some("smoke".to_string()),
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: None,
                result: Some("failed".to_string()),
                include_archived: false,
                per_run_order: false,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].case_id, "TC-1");

        let (pending, total) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: None,
                folder_prefix: None,
                search: None,
                tag: Some("smoke".to_string()),
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: None,
                result: Some("pending".to_string()),
                include_archived: false,
                per_run_order: false,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(pending[0].case_id, "TC-2");
    }

    #[test]
    fn query_run_cases_db_search_matches_run_name_and_excludes_archived() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_for_search(&conn, "r1", "run-a", "Regression", false, None);
        seed_run_for_search(&conn, "r1", "run-b", "Old Run", true, None);
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/p/a.md",
            "TC-1",
            "Case A",
            &[],
            "Medium",
            None,
            None,
            None,
            Some("passed"),
        );
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-b",
            ".gitoza/test/cases/p/b.md",
            "TC-2",
            "Case B",
            &[],
            "Medium",
            None,
            None,
            None,
            Some("passed"),
        );

        let (items, total) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: None,
                folder_prefix: None,
                search: Some("Regression".to_string()),
                tag: None,
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: None,
                result: None,
                include_archived: false,
                per_run_order: false,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].run_id, "run-a");

        let (archived, archived_total) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: None,
                folder_prefix: None,
                search: None,
                tag: None,
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: None,
                result: None,
                include_archived: true,
                per_run_order: false,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(archived_total, 2);
        assert_eq!(archived.len(), 2);
    }

    #[test]
    fn query_cases_db_filters_by_assigned_to() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_case_for_query(&conn, "r1", ".gitoza/test/cases/p/a.md", "a", "active");
        seed_case_for_query(&conn, "r1", ".gitoza/test/cases/p/b.md", "b", "active");
        conn.execute(
            "UPDATE test_cases SET assigned_to = 'Alice' WHERE case_id = 'a'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE test_cases SET assigned_to = 'Bob' WHERE case_id = 'b'",
            [],
        )
        .unwrap();

        let (items, total) = query_cases_db(
            &conn,
            "r1",
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: None,
                approve_status: None,
                updated_by: None,
                assigned_to: Some("Alice".to_string()),
                requirement_id: None,
                automated: None,
                param_filters: None,
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 100,
                offset: 0,
            },
            false,
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].case_id, "a");
    }

    #[test]
    fn query_cases_db_assigned_to_case_insensitive() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_case_for_query(&conn, "r1", ".gitoza/test/cases/p/a.md", "a", "active");
        conn.execute(
            "UPDATE test_cases SET assigned_to = 'Alice' WHERE case_id = 'a'",
            [],
        )
        .unwrap();

        let (items, total) = query_cases_db(
            &conn,
            "r1",
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: None,
                approve_status: None,
                updated_by: None,
                assigned_to: Some("alice".to_string()),
                requirement_id: None,
                automated: None,
                param_filters: None,
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 100,
                offset: 0,
            },
            false,
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].case_id, "a");
    }

    fn seed_case_with_params(
        conn: &Connection,
        repo_slug: &str,
        file_path: &str,
        case_id: &str,
        params: BTreeMap<String, String>,
    ) {
        let directory = directory_from_file_path(file_path);
        upsert_case_db(
            conn,
            UpsertCaseArgs {
                case_id: case_id.to_string(),
                title: Some(format!("Title {case_id}")),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: file_path.to_string(),
                repo_slug: repo_slug.to_string(),
                directory,
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: None,
                assigned_to: None,
                automated: false,
                params,
            },
        )
        .unwrap();
    }

    #[test]
    fn json_path_for_param_key_handles_simple_and_quoted_keys() {
        assert_eq!(json_path_for_param_key("browser"), "$.browser");
        assert_eq!(json_path_for_param_key("my_key"), "$.my_key");
        assert_eq!(json_path_for_param_key("my key"), "$.\"my key\"");
    }

    #[test]
    fn query_cases_db_filters_by_param_single() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let mut params_a = BTreeMap::new();
        params_a.insert("env".to_string(), "staging".to_string());
        seed_case_with_params(&conn, "r1", ".gitoza/test/cases/p/a.md", "a", params_a);

        let mut params_b = BTreeMap::new();
        params_b.insert("env".to_string(), "prod".to_string());
        seed_case_with_params(&conn, "r1", ".gitoza/test/cases/p/b.md", "b", params_b);

        let (items, total) = query_cases_db(
            &conn,
            "r1",
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: None,
                approve_status: None,
                updated_by: None,
                assigned_to: None,
                requirement_id: None,
                automated: None,
                param_filters: Some(vec![("env".to_string(), "staging".to_string())]),
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 100,
                offset: 0,
            },
            false,
        )
        .unwrap();

        assert_eq!(total, 1);
        assert_eq!(items[0].case_id, "a");
    }

    #[test]
    fn query_cases_db_param_filters_and() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let mut match_params = BTreeMap::new();
        match_params.insert("env".to_string(), "staging".to_string());
        match_params.insert("browser".to_string(), "Chrome".to_string());
        seed_case_with_params(
            &conn,
            "r1",
            ".gitoza/test/cases/p/match.md",
            "match",
            match_params,
        );

        let mut partial = BTreeMap::new();
        partial.insert("env".to_string(), "staging".to_string());
        partial.insert("browser".to_string(), "Firefox".to_string());
        seed_case_with_params(
            &conn,
            "r1",
            ".gitoza/test/cases/p/partial.md",
            "partial",
            partial,
        );

        let (items, total) = query_cases_db(
            &conn,
            "r1",
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: None,
                approve_status: None,
                updated_by: None,
                assigned_to: None,
                requirement_id: None,
                automated: None,
                param_filters: Some(vec![
                    ("env".to_string(), "staging".to_string()),
                    ("browser".to_string(), "Chrome".to_string()),
                ]),
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 100,
                offset: 0,
            },
            false,
        )
        .unwrap();

        assert_eq!(total, 1);
        assert_eq!(items[0].case_id, "match");
    }

    #[test]
    fn query_cases_db_param_filter_case_insensitive() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let mut params = BTreeMap::new();
        params.insert("Environment".to_string(), "Staging".to_string());
        seed_case_with_params(&conn, "r1", ".gitoza/test/cases/p/a.md", "a", params);

        let (items, total) = query_cases_db(
            &conn,
            "r1",
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: None,
                approve_status: None,
                updated_by: None,
                assigned_to: None,
                requirement_id: None,
                automated: None,
                param_filters: Some(vec![("Environment".to_string(), "staging".to_string())]),
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 100,
                offset: 0,
            },
            false,
        )
        .unwrap();

        assert_eq!(total, 1);
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn query_cases_db_param_filter_special_key() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let mut params = BTreeMap::new();
        params.insert("my key".to_string(), "alpha".to_string());
        seed_case_with_params(&conn, "r1", ".gitoza/test/cases/p/a.md", "a", params);

        let (items, total) = query_cases_db(
            &conn,
            "r1",
            QueryCasesArgs {
                search: None,
                status: None,
                priority: None,
                tag: None,
                directory: None,
                directories: None,
                path_prefix: None,
                approve_status: None,
                updated_by: None,
                assigned_to: None,
                requirement_id: None,
                automated: None,
                param_filters: Some(vec![("my key".to_string(), "alpha".to_string())]),
                exclude_archived: true,
                sort_by: "case_id".to_string(),
                sort_dir: "asc".to_string(),
                limit: 100,
                offset: 0,
            },
            false,
        )
        .unwrap();

        assert_eq!(total, 1);
        assert_eq!(items[0].case_id, "a");
    }

    #[test]
    fn query_run_cases_db_effective_assigned_to_case_insensitive() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_for_search(&conn, "r1", "run-a", "Smoke", false, Some("Bob"));
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/p/a.md",
            "TC-1",
            "Alpha",
            &[],
            "High",
            None,
            None,
            None,
            None,
        );

        let (items, total) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: None,
                folder_prefix: None,
                search: None,
                tag: None,
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: Some("bob".to_string()),
                result: None,
                include_archived: false,
                per_run_order: false,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn query_run_cases_db_filters_by_effective_assigned_to_inherited() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_for_search(&conn, "r1", "run-a", "Smoke", false, Some("Bob"));
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/p/a.md",
            "TC-1",
            "Alpha",
            &[],
            "High",
            None,
            None,
            None,
            None,
        );

        let (items, total) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: None,
                folder_prefix: None,
                search: None,
                tag: None,
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: Some("Bob".to_string()),
                result: None,
                include_archived: false,
                per_run_order: false,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].effective_assigned_to.as_deref(), Some("Bob"));
    }

    #[test]
    fn query_run_cases_db_filters_by_effective_assigned_to_case_override() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_for_search(&conn, "r1", "run-a", "Smoke", false, Some("Bob"));
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/p/a.md",
            "TC-1",
            "Alpha",
            &[],
            "High",
            None,
            None,
            Some("Alice"),
            None,
        );

        let (bob, _) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: None,
                folder_prefix: None,
                search: None,
                tag: None,
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: Some("Bob".to_string()),
                result: None,
                include_archived: false,
                per_run_order: false,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert!(bob.is_empty());

        let (alice, total) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: None,
                folder_prefix: None,
                search: None,
                tag: None,
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: Some("Alice".to_string()),
                result: None,
                include_archived: false,
                per_run_order: false,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 1);
        assert_eq!(alice[0].case_id, "TC-1");
    }

    #[test]
    fn query_run_cases_db_assigned_to_unassigned_excluded() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_for_search(&conn, "r1", "run-a", "Smoke", false, Some("Bob"));
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/p/a.md",
            "TC-1",
            "Alpha",
            &[],
            "High",
            None,
            None,
            Some(ASSIGNEE_UNASSIGNED),
            None,
        );

        let (items, total) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: None,
                folder_prefix: None,
                search: None,
                tag: None,
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: Some("Bob".to_string()),
                result: None,
                include_archived: false,
                per_run_order: false,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 0);
        assert!(items.is_empty());
    }

    #[test]
    fn distinct_effective_run_case_assignees_includes_run_header_only() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_for_search(&conn, "r1", "run-a", "Smoke", false, Some("Bob"));
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/p/a.md",
            "TC-1",
            "Alpha",
            &[],
            "High",
            None,
            None,
            None,
            None,
        );

        let assignees = distinct_effective_run_case_assignees(&conn, "r1").unwrap();
        assert_eq!(assignees, vec!["Bob".to_string()]);
    }

    #[test]
    fn resolve_assigned_to_query_filter_maps_me_to_git_name() {
        assert_eq!(
            resolve_assigned_to_query_filter(Some(ASSIGNED_TO_ME), "Alice"),
            AssignedToQueryFilter::Match("Alice".to_string())
        );
        assert_eq!(
            resolve_assigned_to_query_filter(Some(ASSIGNED_TO_ME), ""),
            AssignedToQueryFilter::NoMatch
        );
        assert_eq!(
            resolve_assigned_to_query_filter(Some("Bob"), "Alice"),
            AssignedToQueryFilter::Match("Bob".to_string())
        );
        assert_eq!(
            resolve_assigned_to_query_filter(None, "Alice"),
            AssignedToQueryFilter::None
        );
    }

    #[test]
    fn run_comment_db_append_delete_and_get_run_detail_uses_db() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "r1";
        let run_id = "run-1";
        conn.execute(
            r#"INSERT INTO test_runs (run_id, repo_slug, name, created_at, updated_at)
               VALUES (?1, ?2, 'Run', 't', 't')"#,
            params![run_id, repo],
        )
        .unwrap();

        let comment = models::Comment {
            author: "Alice".to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            text: "Hello".to_string(),
        };
        let comments = append_run_comment_db(&conn, repo, run_id, &comment, Some("Alice")).unwrap();
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].text, "Hello");

        let detail = get_run_detail(&conn, repo, run_id, false, false)
            .unwrap()
            .unwrap();
        assert_eq!(detail.run.comments.len(), 1);
        assert!(detail.cases.is_empty());

        let after_delete = delete_run_comment_db(&conn, repo, run_id, 0, "Alice").unwrap();
        assert!(after_delete.is_empty());
    }

    #[test]
    fn import_run_comments_from_doc_round_trip() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "r1";
        let run_id = "run-1";
        let doc = serde_json::json!({
            "run_id": run_id,
            "comments": [{ "author": "Bob", "timestamp": "t", "text": "Run note" }],
            "cases": [{
                "file_path": ".gitoza/test/cases/p/c.md",
                "comments": [{ "author": "Bob", "timestamp": "t", "text": "Case note" }]
            }]
        });
        import_run_comments_from_doc(&conn, repo, run_id, &doc).unwrap();
        let run_comments = load_run_comments(&conn, repo, run_id).unwrap();
        assert_eq!(run_comments.len(), 1);
        let case_comments =
            load_run_case_comments(&conn, repo, run_id, ".gitoza/test/cases/p/c.md").unwrap();
        assert_eq!(case_comments.len(), 1);
        assert_eq!(case_comments[0].text, "Case note");
    }

    #[test]
    fn list_run_case_paths_returns_all_paths() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_for_search(&conn, "r1", "run-a", "Run A", false, None);
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/proj/a.md",
            "TC-1",
            "A",
            &[],
            "Medium",
            None,
            None,
            None,
            None,
        );
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/proj/b.md",
            "TC-2",
            "B",
            &[],
            "Medium",
            None,
            None,
            None,
            None,
        );
        let res = list_run_case_paths_db(&conn, "r1", "run-a").unwrap();
        assert_eq!(res.total, 2);
        assert_eq!(res.paths.len(), 2);
        assert!(res
            .paths
            .contains(&".gitoza/test/cases/proj/a.md".to_string()));
        assert!(res
            .paths
            .contains(&".gitoza/test/cases/proj/b.md".to_string()));
    }

    #[test]
    fn list_run_cases_filters_by_run_id_and_folder_prefix() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_run_for_search(&conn, "r1", "run-a", "Run A", false, None);
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/proj/a.md",
            "TC-1",
            "A",
            &[],
            "Medium",
            None,
            None,
            None,
            Some("passed"),
        );
        seed_run_case_for_search(
            &conn,
            "r1",
            "run-a",
            ".gitoza/test/cases/proj/suite/b.md",
            "TC-2",
            "B",
            &[],
            "Medium",
            None,
            None,
            None,
            None,
        );

        let (all, total) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: Some("run-a".to_string()),
                folder_prefix: None,
                search: None,
                tag: None,
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: None,
                result: None,
                include_archived: true,
                per_run_order: true,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(total, 2);
        assert_eq!(all.len(), 2);

        let (folder, folder_total) = query_run_cases_db(
            &conn,
            "r1",
            QueryRunCasesArgs {
                run_id: Some("run-a".to_string()),
                folder_prefix: Some(".gitoza/test/cases/proj/suite".to_string()),
                search: None,
                tag: None,
                priority: None,
                requirement_id: None,
                automated: None,
                executed_by: None,
                assigned_to: None,
                result: None,
                include_archived: true,
                per_run_order: true,
                limit: 100,
                offset: 0,
            },
        )
        .unwrap();
        assert_eq!(folder_total, 1);
        assert_eq!(folder[0].case_id, "TC-2");
    }

    #[test]
    fn derive_workplace_mode_returns_baseline_for_clean_idle_repo() {
        let mode = derive_workplace_mode(false, false, None);
        assert_eq!(mode, "baseline".to_string());
    }

    #[test]
    fn derive_workplace_mode_returns_editing_for_dirty_repo() {
        let mode = derive_workplace_mode(true, false, None);
        assert_eq!(mode, "editing".to_string());
    }

    #[test]
    fn derive_workplace_mode_editing_when_run_yaml_pending() {
        let mode = derive_workplace_mode(false, true, None);
        assert_eq!(mode, "editing".to_string());
    }

    #[test]
    fn derive_workplace_mode_returns_editing_during_confirm_steps() {
        for step in ["staged", "committed", "rebase_done"] {
            let mode = derive_workplace_mode(false, false, Some(step));
            assert_eq!(mode, "editing".to_string());
        }
    }

    #[test]
    fn should_pull_true_when_clean_no_pending() {
        let gate = RepoPullGate {
            is_dirty: false,
            run_yaml_pending: false,
            confirm_step: None,
        };
        assert!(should_pull_for_repo(&gate));
    }

    #[test]
    fn should_pull_false_when_run_yaml_pending() {
        let gate = RepoPullGate {
            is_dirty: false,
            run_yaml_pending: true,
            confirm_step: None,
        };
        assert!(!should_pull_for_repo(&gate));
    }

    #[test]
    fn should_pull_false_when_dirty() {
        let gate = RepoPullGate {
            is_dirty: true,
            run_yaml_pending: false,
            confirm_step: None,
        };
        assert!(!should_pull_for_repo(&gate));
    }

    #[test]
    fn should_pull_false_when_rebase_done() {
        let gate = RepoPullGate {
            is_dirty: false,
            run_yaml_pending: false,
            confirm_step: Some("rebase_done".to_string()),
        };
        assert!(!should_pull_for_repo(&gate));
    }

    #[test]
    fn validate_case_file_path_rejects_traversal_and_non_cases_prefix() {
        assert!(
            validate_case_file_path_for_write(".gitoza/test/cases/../../../etc/passwd").is_err()
        );
        assert!(validate_case_file_path_for_write("../.gitoza/test/cases/foo.md").is_err());
        assert!(validate_case_file_path_for_write(".gitoza/test/runs/x.md").is_err());
        assert!(validate_case_file_path_for_write(".gitoza/test/cases/proj/foo.md").is_ok());
    }

    #[test]
    fn atomic_write_file_replaces_content() {
        let dir = temp_dir("atomic_write");
        let p = dir.join("f.md");
        atomic_write_file(&p, b"v1").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "v1");
        atomic_write_file(&p, b"v2").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "v2");
    }

    fn minimal_case_yaml(repo: &Path, rel: &str) {
        let abs = repo.join(rel);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut fm = IndexMap::new();
        fm.insert(
            "case_id".to_string(),
            serde_yaml::Value::String("CASE-1".to_string()),
        );
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("Title".to_string()),
        );
        write_full_yaml(&abs, &fm, "body").unwrap();
    }

    fn seed_case_index_row(conn: &Connection, repo_slug: &str, file_path: &str) {
        let directory = directory_from_file_path(file_path);
        upsert_case_db(
            conn,
            UpsertCaseArgs {
                case_id: "CASE-1".to_string(),
                title: Some("Title".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: file_path.to_string(),
                repo_slug: repo_slug.to_string(),
                directory,
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
    fn reconcile_case_paths_restores_missing_index() {
        let repo = temp_dir("reconcile_missing");
        let rel = ".gitoza/test/cases/proj/a.md";
        minimal_case_yaml(&repo, rel);
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let slug = "r1";
        let paths = reconcile_case_paths(&conn, &repo, slug).unwrap();
        assert_eq!(paths, vec![rel.to_string()]);
    }

    #[test]
    fn reconcile_case_paths_removes_stale_db() {
        let repo = temp_dir("reconcile_stale");
        let rel = ".gitoza/test/cases/proj/gone.md";
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let slug = "r1";
        seed_case_index_row(&conn, slug, rel);
        let paths = reconcile_case_paths(&conn, &repo, slug).unwrap();
        assert_eq!(paths, vec![rel.to_string()]);
    }

    #[test]
    fn reconcile_case_paths_clean_when_aligned() {
        let repo = temp_dir("reconcile_aligned");
        let rel = ".gitoza/test/cases/proj/a.md";
        minimal_case_yaml(&repo, rel);
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let slug = "r1";
        seed_case_index_row(&conn, slug, rel);
        let paths = reconcile_case_paths(&conn, &repo, slug).unwrap();
        assert!(
            paths.is_empty(),
            "expected no reconcile paths, got {paths:?}"
        );
    }

    #[test]
    fn merge_path_lists_dedupes() {
        let a = vec![
            ".gitoza/test/cases/p/a.md".to_string(),
            ".gitoza/test/cases/p/b.md".to_string(),
        ];
        let b = vec![
            ".gitoza/test/cases/p/b.md".to_string(),
            ".gitoza/test/cases/p/c.md".to_string(),
        ];
        let merged = merge_path_lists(a, b);
        assert_eq!(
            merged,
            vec![
                ".gitoza/test/cases/p/a.md".to_string(),
                ".gitoza/test/cases/p/b.md".to_string(),
                ".gitoza/test/cases/p/c.md".to_string(),
            ]
        );
    }

    #[test]
    fn get_cached_git_user_db_returns_name_and_email() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        set_cached_git_user_db(&conn, "r1", Some("Alice"), Some("alice@example.com")).unwrap();
        let (name, email) = get_cached_git_user_db(&conn, "r1").unwrap();
        assert_eq!(name.as_deref(), Some("Alice"));
        assert_eq!(email.as_deref(), Some("alice@example.com"));
    }

    #[test]
    fn set_cached_git_user_db_normalizes_empty_to_none() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        set_cached_git_user_db(&conn, "r1", Some("  "), Some("  ")).unwrap();
        let (name, email) = get_cached_git_user_db(&conn, "r1").unwrap();
        assert!(name.is_none());
        assert!(email.is_none());
    }

    #[test]
    fn has_local_git_override_detects_name_diff() {
        assert!(has_local_git_override(
            &Some("Global".to_string()),
            &Some("g@example.com".to_string()),
            &Some("Local".to_string()),
            &Some("g@example.com".to_string()),
        ));
    }

    #[test]
    fn has_local_git_override_false_when_global_unset() {
        assert!(!has_local_git_override(
            &None,
            &None,
            &Some("Local".to_string()),
            &Some("local@example.com".to_string()),
        ));
    }

    #[test]
    fn local_identity_for_display_infers_from_effective_when_no_global() {
        assert_eq!(
            local_identity_for_display(None, &None, &Some("Repo User".to_string()),),
            Some("Repo User".to_string())
        );
    }

    #[test]
    fn local_identity_for_display_infers_when_effective_differs_from_global() {
        assert_eq!(
            local_identity_for_display(
                None,
                &Some("Global".to_string()),
                &Some("Repo".to_string()),
            ),
            Some("Repo".to_string())
        );
    }

    #[test]
    fn local_identity_for_display_blank_when_inheriting_global() {
        assert_eq!(
            local_identity_for_display(None, &Some("Same".to_string()), &Some("Same".to_string()),),
            None
        );
    }

    #[test]
    fn validate_git_identity_field_accepts_empty_as_unset() {
        assert_eq!(
            validate_git_identity_field("", GitIdentityField::Name).unwrap(),
            None
        );
        assert_eq!(
            validate_git_identity_field("  ", GitIdentityField::Email).unwrap(),
            None
        );
    }

    #[test]
    fn validate_git_identity_field_validates_non_empty() {
        assert_eq!(
            validate_git_identity_field("Tester A", GitIdentityField::Name).unwrap(),
            Some("Tester A".to_string())
        );
        assert!(validate_git_identity_field("bad", GitIdentityField::Email).is_err());
        assert_eq!(
            validate_git_identity_field("a@b.com", GitIdentityField::Email).unwrap(),
            Some("a@b.com".to_string())
        );
    }

    #[test]
    fn validate_git_profile_input_rejects_empty_name() {
        assert!(validate_git_profile_input("", "a@b.com").is_err());
    }

    #[test]
    fn validate_git_profile_input_accepts_valid() {
        let (name, email) = validate_git_profile_input("Tester A", "tester@example.com").unwrap();
        assert_eq!(name, "Tester A");
        assert_eq!(email, "tester@example.com");
    }

    #[test]
    fn git_identity_changed_detects_drift() {
        assert!(git_identity_changed(
            &Some("Old".to_string()),
            &Some("New".to_string()),
        ));
        assert!(!git_identity_changed(
            &Some("Same".to_string()),
            &Some("Same".to_string()),
        ));
    }

    fn init_test_git_repo_bare(dir: &Path) {
        std::process::Command::new("git")
            .current_dir(dir)
            .args(["init"])
            .output()
            .expect("git init");
    }

    fn init_test_git_repo(dir: &Path, name: &str, email: &str) {
        std::process::Command::new("git")
            .current_dir(dir)
            .args(["init"])
            .output()
            .expect("git init");
        std::process::Command::new("git")
            .current_dir(dir)
            .args(["config", "user.name", name])
            .output()
            .expect("git config user.name");
        std::process::Command::new("git")
            .current_dir(dir)
            .args(["config", "user.email", email])
            .output()
            .expect("git config user.email");
    }

    #[tokio::test]
    async fn git_set_local_user_writes_effective_identity() {
        let dir = temp_dir("git_set_local_user");
        let repo_path = dir.join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo(&repo_path, "Initial", "initial@example.com");

        git_set_local_user(&repo_path, "Local User", "local@example.com")
            .await
            .expect("git_set_local_user");

        let local_name = git_stdout(&repo_path, &["config", "--local", "user.name"])
            .await
            .expect("local user.name");
        let local_email = git_stdout(&repo_path, &["config", "--local", "user.email"])
            .await
            .expect("local user.email");
        assert_eq!(local_name, "Local User");
        assert_eq!(local_email, "local@example.com");

        let name = git_effective_user_name(&repo_path).await.unwrap();
        let email = git_effective_user_email(&repo_path).await.unwrap();
        assert_eq!(name.as_deref(), Some("Local User"));
        assert_eq!(email.as_deref(), Some("local@example.com"));
    }

    #[tokio::test]
    async fn git_local_user_fields_none_when_unset() {
        let dir = temp_dir("git_local_unset");
        let repo_path = dir.join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo_bare(&repo_path);

        assert!(git_local_user_name(&repo_path).await.unwrap().is_none());
        assert!(git_local_user_email(&repo_path).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn apply_git_local_identity_unset_clears_local_only() {
        let dir = temp_dir("git_local_unset_name");
        let repo_path = dir.join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo(&repo_path, "Local User", "local@example.com");

        apply_git_local_identity_name(&repo_path, None)
            .await
            .expect("unset local name");

        assert!(git_local_user_name(&repo_path).await.unwrap().is_none());
        assert_eq!(
            git_local_user_email(&repo_path).await.unwrap().as_deref(),
            Some("local@example.com")
        );
    }

    #[tokio::test]
    async fn apply_git_local_identity_unset_noop_when_never_set() {
        let dir = temp_dir("git_local_unset_noop");
        let repo_path = dir.join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo_bare(&repo_path);

        apply_git_local_identity_name(&repo_path, None)
            .await
            .expect("unset noop when local name never set");
        apply_git_local_identity_email(&repo_path, None)
            .await
            .expect("unset noop when local email never set");

        assert!(git_local_user_name(&repo_path).await.unwrap().is_none());
        assert!(git_local_user_email(&repo_path).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn resolve_git_user_name_cached_returns_cached_without_git() {
        let config = temp_dir("resolve_cache_hit");
        let slug = "myrepo";
        let repo_path = config.join("repos").join(slug);
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo(&repo_path, "Git Name", "git@example.com");

        let state = new_state(config);
        let conn_arc = open_repo_db(&state, slug).unwrap();
        set_cached_git_user_db(
            &conn_arc.lock().unwrap(),
            slug,
            Some("Cached User"),
            Some("cached@example.com"),
        )
        .unwrap();

        let name = resolve_git_user_name_cached(&state, &repo_path, slug).await;
        assert_eq!(name, "Cached User");
    }

    #[test]
    fn open_repo_db_creates_schema_only_without_indexing_cases() {
        let config = temp_dir("open_repo_db_schema_only");
        let slug = "myrepo";
        let repo_path = config.join("repos").join(slug);
        let case_yaml = repo_path.join(".gitoza/test/cases/alpha.gitoza.test/suite/case-a.md");
        fs::create_dir_all(case_yaml.parent().unwrap()).unwrap();
        fs::write(&case_yaml, "title: Case A\nstatus: active\n").unwrap();
        init_test_git_repo_bare(&repo_path);

        let state = new_state(config);
        let conn_arc = open_repo_db(&state, slug).unwrap();
        let count = count_cases_db(&conn_arc.lock().unwrap(), slug).unwrap();
        assert_eq!(
            count, 0,
            "open_repo_db must not synchronously index YAML cases"
        );
    }

    #[tokio::test]
    async fn resolve_git_user_name_cached_populates_cache_on_miss() {
        let config = temp_dir("resolve_cache_miss");
        let slug = "myrepo";
        let repo_path = config.join("repos").join(slug);
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo(&repo_path, "Local User", "local@example.com");

        let state = new_state(config);
        let name = resolve_git_user_name_cached(&state, &repo_path, slug).await;
        assert_eq!(name, "Local User");

        let conn_arc = open_repo_db(&state, slug).unwrap();
        let (cached_name, cached_email) =
            get_cached_git_user_db(&conn_arc.lock().unwrap(), slug).unwrap();
        assert_eq!(cached_name.as_deref(), Some("Local User"));
        assert_eq!(cached_email.as_deref(), Some("local@example.com"));
    }

    #[test]
    fn case_detail_to_front_matter_omits_updated_at_by() {
        let detail = models::YamlCaseDetail {
            case_id: "TC-1".to_string(),
            title: Some("Title".to_string()),
            tags: vec![],
            status: Some("active".to_string()),
            priority: Some("medium".to_string()),
            file_path: "".to_string(),
            body: "Body".to_string(),
            raw: String::new(),
            approve_status: "draft".to_string(),
            updated_at: Some("2024-01-01T00:00:00Z".to_string()),
            updated_by: Some("Alice".to_string()),
            approved_by: None,
            approved_at: None,
            requirement_ids: vec![],
            assigned_to: None,
            automated: false,
            comments: vec![],
            params: BTreeMap::new(),
        };
        let fm = case_detail_to_front_matter(&detail);
        assert!(!fm.contains_key("updated_at"));
        assert!(!fm.contains_key("updated_by"));
        assert!(fm.contains_key("title"));
    }

    #[test]
    fn apply_case_audit_from_db_overlays_sqlite_over_yaml() {
        let repo = temp_dir("case_audit_overlay");
        let rel = ".gitoza/test/cases/proj/a.md";
        minimal_case_yaml(&repo, rel);
        // Legacy YAML keys must be ignored when overlaying from SQLite.
        let abs = repo.join(rel);
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("Title".to_string()),
        );
        fm.insert(
            "updated_at".to_string(),
            serde_yaml::Value::String("1999-01-01T00:00:00Z".to_string()),
        );
        fm.insert(
            "updated_by".to_string(),
            serde_yaml::Value::String("YamlUser".to_string()),
        );
        write_full_yaml(&abs, &fm, "body").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let slug = "r1";
        upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "a".to_string(),
                title: Some("Title".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: rel.to_string(),
                repo_slug: slug.to_string(),
                directory: directory_from_file_path(rel),
                approve_status: "draft".to_string(),
                updated_at: Some("2024-06-01T12:00:00Z".to_string()),
                updated_by: Some("DbUser".to_string()),
                approved_by: None,
                approved_at: None,
                requirement_id: None,
                assigned_to: None,
                automated: false,
                params: BTreeMap::new(),
            },
        )
        .unwrap();

        let mut detail = read_full_yaml(&abs).unwrap().expect("parsed");
        assert_eq!(detail.updated_by.as_deref(), Some("YamlUser"));
        apply_case_audit_from_db(&conn, slug, rel, &mut detail);
        assert_eq!(detail.updated_by.as_deref(), Some("DbUser"));
        assert_eq!(detail.updated_at.as_deref(), Some("2024-06-01T12:00:00Z"));

        // Missing DB row → clears to None (no leftover YAML audit).
        let mut orphan = read_full_yaml(&abs).unwrap().expect("parsed");
        apply_case_audit_from_db(
            &conn,
            slug,
            ".gitoza/test/cases/proj/missing.md",
            &mut orphan,
        );
        assert!(orphan.updated_at.is_none());
        assert!(orphan.updated_by.is_none());
    }

    #[test]
    fn load_case_audit_preserves_values_for_approve_style_coalesce() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let slug = "r1";
        let rel = ".gitoza/test/cases/proj/a.md";
        upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "a".to_string(),
                title: Some("Title".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: rel.to_string(),
                repo_slug: slug.to_string(),
                directory: directory_from_file_path(rel),
                approve_status: "draft".to_string(),
                updated_at: Some("2024-01-01T00:00:00Z".to_string()),
                updated_by: Some("Editor".to_string()),
                approved_by: None,
                approved_at: None,
                requirement_id: None,
                assigned_to: None,
                automated: false,
                params: BTreeMap::new(),
            },
        )
        .unwrap();
        // Approve-style upsert: pass None for audit → COALESCE keeps previous.
        upsert_case_db(
            &conn,
            UpsertCaseArgs {
                case_id: "a".to_string(),
                title: Some("Title".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: rel.to_string(),
                repo_slug: slug.to_string(),
                directory: directory_from_file_path(rel),
                approve_status: "approved".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: Some("Approver".to_string()),
                approved_at: Some("2024-02-01T00:00:00Z".to_string()),
                requirement_id: None,
                assigned_to: None,
                automated: false,
                params: BTreeMap::new(),
            },
        )
        .unwrap();
        let (at, by) = load_case_audit(&conn, slug, rel);
        assert_eq!(by.as_deref(), Some("Editor"));
        assert_eq!(at.as_deref(), Some("2024-01-01T00:00:00Z"));
    }

    #[test]
    fn audit_stamp_source_mixed_uses_local_for_dirty() {
        let mut dirty = HashSet::new();
        dirty.insert(".gitoza/test/cases/proj/a.md".to_string());
        let mut commit_meta = HashMap::new();
        commit_meta.insert(
            ".gitoza/test/cases/proj/a.md".to_string(),
            CommitAuditMeta {
                updated_by: "Committer".to_string(),
                updated_at: "2020-01-01T00:00:00Z".to_string(),
            },
        );
        commit_meta.insert(
            ".gitoza/test/cases/proj/b.md".to_string(),
            CommitAuditMeta {
                updated_by: "Committer".to_string(),
                updated_at: "2020-01-02T00:00:00Z".to_string(),
            },
        );
        let src = AuditStampSource::Mixed {
            dirty,
            local_by: "Local".to_string(),
            local_at: "2024-06-01T12:00:00Z".to_string(),
            commit_meta,
        };
        let (at, by) = src.resolve(".gitoza/test/cases/proj/a.md");
        assert_eq!(by.as_deref(), Some("Local"));
        assert_eq!(at.as_deref(), Some("2024-06-01T12:00:00Z"));
        let (at2, by2) = src.resolve(".gitoza/test/cases/proj/b.md");
        assert_eq!(by2.as_deref(), Some("Committer"));
        assert_eq!(at2.as_deref(), Some("2020-01-02T00:00:00Z"));
    }

    #[test]
    fn git_last_commit_meta_reads_author_for_path() {
        let repo = temp_dir("git_audit_meta");
        git_ok(&repo, &["init"]);
        git_ok(&repo, &["config", "user.name", "Audit Author"]);
        git_ok(&repo, &["config", "user.email", "audit@example.com"]);
        let rel = ".gitoza/test/cases/proj/a.md";
        minimal_case_yaml(&repo, rel);
        git_ok(&repo, &["add", rel]);
        git_ok(&repo, &["commit", "-m", "add case"]);
        let meta = git_last_commit_meta(&repo, rel).expect("commit meta");
        assert_eq!(meta.updated_by, "Audit Author");
        assert!(!meta.updated_at.is_empty());
    }

    #[test]
    fn case_paths_for_external_stamp_excludes_reconcile_only() {
        let stamp = case_paths_for_external_stamp(&[]);
        assert!(stamp.is_empty());
    }

    #[test]
    fn to_archive_path_maps_under_central_archive_root() {
        let active = ".gitoza/test/cases/auth/login/foo.md";
        let archived = to_archive_path(active).unwrap();
        assert_eq!(archived, ".gitoza/test/cases/.archive/auth/login/foo.md");
    }

    #[test]
    fn to_active_path_round_trips_archive_path() {
        let archived = ".gitoza/test/cases/.archive/auth/login/foo.md";
        let active = to_active_path(archived).unwrap();
        assert_eq!(active, ".gitoza/test/cases/auth/login/foo.md");
        assert_eq!(to_archive_path(&active).unwrap(), archived);
    }

    #[test]
    fn archive_only_delete_path_helpers() {
        assert!(is_archived_file_path(
            ".gitoza/test/cases/.archive/proj/case.md"
        ));
        assert!(!is_archived_file_path(".gitoza/test/cases/proj/case.md"));

        assert!(is_archived_project_directory_path(
            ".gitoza/test/cases/.archive/proj"
        ));
        assert!(!is_archived_project_directory_path(
            ".gitoza/test/cases/proj"
        ));
        assert!(!is_archived_project_directory_path(
            ".gitoza/test/cases/.archive/proj/suite"
        ));

        assert!(is_archived_suite_directory_path(
            ".gitoza/test/cases/.archive/proj/suite"
        ));
        assert!(!is_archived_suite_directory_path(
            ".gitoza/test/cases/proj/suite"
        ));
        assert!(!is_archived_suite_directory_path(
            ".gitoza/test/cases/.archive/proj"
        ));
    }

    #[test]
    fn case_paths_for_external_stamp_excludes_archived() {
        let dep = ".gitoza/test/cases/.archive/proj/a.md".to_string();
        let stamp = case_paths_for_external_stamp(&[dep]);
        assert!(stamp.is_empty());
    }

    #[test]
    fn build_prefix_case_counts_excludes_archive_paths_regardless_of_status() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let archive_project = ".gitoza/test/cases/.archive/proj.gitoza.test";
        seed_case_for_query(
            &conn,
            "r1",
            &format!("{archive_project}/case.md"),
            "TC-1",
            "active",
        );
        let counts = build_prefix_case_counts(&conn, "r1", Some(archive_project), false).unwrap();
        assert_eq!(counts.get(archive_project).copied().unwrap_or(0), 0);
    }

    #[test]
    fn build_prefix_case_counts_includes_active_paths_regardless_of_status() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let project = ".gitoza/test/cases/proj.gitoza.test";
        seed_case_for_query(
            &conn,
            "r1",
            &format!("{project}/case.md"),
            "TC-1",
            "archived",
        );
        let counts = build_prefix_case_counts(&conn, "r1", Some(project), false).unwrap();
        assert_eq!(counts.get(project).copied().unwrap_or(0), 1);
    }

    #[test]
    fn build_prefix_case_counts_includes_archive_paths_in_archive_mode() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let archive_project = ".gitoza/test/cases/.archive/proj.gitoza.test";
        seed_case_for_query(
            &conn,
            "r1",
            &format!("{archive_project}/case.md"),
            "TC-1",
            "active",
        );
        let counts = build_prefix_case_counts(&conn, "r1", Some(archive_project), true).unwrap();
        assert_eq!(counts.get(archive_project).copied().unwrap_or(0), 1);
    }

    #[test]
    fn discover_yaml_skips_nested_dot_archive_inside_project() {
        let repo = temp_dir("discover_skip_nested_archive");
        let hidden = ".gitoza/test/cases/proj.gitoza.test/.archive/hidden.md";
        fs::create_dir_all(repo.join(hidden).parent().unwrap()).unwrap();
        fs::write(
            &repo.join(hidden),
            r#"---
title: Hidden
---
body
"#,
        )
        .unwrap();
        let paths = discover_case_yaml_rel_paths(&repo);
        assert!(!paths.contains(&hidden.to_string()));
    }

    #[test]
    fn discover_yaml_includes_top_level_archive_root() {
        let repo = temp_dir("discover_top_level_archive");
        let archived = ".gitoza/test/cases/.archive/proj.gitoza.test/a.md";
        fs::create_dir_all(repo.join(archived).parent().unwrap()).unwrap();
        fs::write(
            &repo.join(archived),
            r#"---
title: Archived
---
body
"#,
        )
        .unwrap();
        let paths = discover_case_yaml_rel_paths(&repo);
        assert!(paths.contains(&archived.to_string()));
    }

    #[test]
    fn case_paths_for_external_stamp_includes_active_porcelain() {
        let active = ".gitoza/test/cases/proj/a.md".to_string();
        let stamp = case_paths_for_external_stamp(&[active.clone()]);
        assert_eq!(stamp, vec![active]);
    }

    #[test]
    fn merge_reconcile_index_paths_archive_move() {
        let repo = temp_dir("reconcile_arch_move");
        let slug = "r1";
        let old_rel = ".gitoza/test/cases/proj/a.md";
        let new_rel = ".gitoza/test/cases/.archive/proj/a.md";
        let abs = repo.join(new_rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        fs::write(
            &abs,
            r#"---
case_id: CASE-1
title: Title
status: active
---
body
"#,
        )
        .unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_case_index_row(&conn, slug, old_rel);
        let (changed_cases, _) = merge_reconcile_index_paths(&conn, &repo, slug, &[], &[]).unwrap();
        assert!(
            changed_cases.iter().any(|p| p == new_rel),
            "expected new archived path in changed list, got {changed_cases:?}"
        );
        assert!(
            changed_cases.iter().any(|p| p == old_rel),
            "expected stale active path in changed list, got {changed_cases:?}"
        );
        let audit = AuditStampSource::CommitMeta(HashMap::new());
        apply_incremental_case_changes(&conn, &repo, slug, &changed_cases, &audit).unwrap();
        let status: String = conn
            .query_row(
                "SELECT status FROM test_cases WHERE repo_slug = ? AND file_path = ?",
                params![slug, new_rel],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "active");
        let stale_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM test_cases WHERE repo_slug = ? AND file_path = ?",
                params![slug, old_rel],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stale_count, 0);
    }

    #[test]
    fn reconcile_run_paths_includes_yaml_when_run_id_not_indexed() {
        let repo = temp_dir("reconcile_run");
        let run_id = "run-abc";
        let rel = format!(".gitoza/test/runs/{run_id}/head.md");
        let abs = repo.join(&rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        fs::write(
            &abs,
            r#"---
run_id: run-abc
title: Run
created_at: 2020-01-01T00:00:00Z
updated_at: 2020-01-01T00:00:00Z
---

"#,
        )
        .unwrap();
        fs::write(
            repo.join(format!(".gitoza/test/runs/{run_id}/cases.md")),
            "---\nrun_id: run-abc\ncases: []\n---\n\n",
        )
        .unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let paths = reconcile_run_paths(&conn, &repo, "r1").unwrap();
        assert_eq!(paths, vec![rel]);
    }

    fn seed_test_run_header(conn: &Connection, repo_slug: &str, run_id: &str) {
        conn.execute(
            r#"
INSERT INTO test_runs
  (run_id, repo_slug, name, description, created_at, updated_at, archived, approve_status)
VALUES (?1, ?2, 'Run', NULL, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 0, 'draft')
"#,
            params![run_id, repo_slug],
        )
        .unwrap();
    }

    #[test]
    fn sync_run_results_from_doc_preserves_case_title() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp = ".gitoza/test/cases/a/case.md";
        seed_test_run_header(&conn, repo, run_id);
        conn.execute(
            r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, title)
VALUES (?1, ?2, ?3, 'C1', '', '2020-01-01T00:00:00Z', 'Real Title')
"#,
            params![run_id, repo, fp],
        )
        .unwrap();

        let doc = serde_json::json!({
            "run_id": run_id,
            "run_name": "Run",
            "updated_at": "2020-02-02T00:00:00Z",
            "cases": [{
                "file_path": fp,
                "case_id": "C1",
                "result": "passed",
                "executed_at": "2020-02-02T00:00:00Z",
                "executed_by": "Alice"
            }]
        });
        sync_run_results_from_doc(&conn, repo, &doc).unwrap();

        let title: String = conn
            .query_row(
                "SELECT title FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "Real Title");

        let result: String = conn
            .query_row(
                "SELECT result FROM test_run_results WHERE run_id = ? AND file_path = ?",
                params![run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(result, "passed");

        let executed_by: String = conn
            .query_row(
                "SELECT executed_by FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(executed_by, "Alice");
    }

    #[test]
    fn set_run_result_in_db_preserves_title_and_updates_result() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-db-1";
        let fp = ".gitoza/test/cases/a/case.md";
        seed_test_run_header(&conn, repo, run_id);
        conn.execute(
            r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, title)
VALUES (?1, ?2, ?3, 'C1', '', '2020-01-01T00:00:00Z', 'Keep Title')
"#,
            params![run_id, repo, fp],
        )
        .unwrap();

        let stamp =
            set_run_result_in_db(&conn, repo, run_id, fp, "passed", None, Some("Alice"), true)
                .unwrap()
                .expect("stamp");

        assert_eq!(stamp.result, "passed");
        assert_eq!(stamp.executed_by.as_deref(), Some("Alice"));

        let title: String = conn
            .query_row(
                "SELECT title FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "Keep Title");

        let result: String = conn
            .query_row(
                "SELECT result FROM test_run_results WHERE run_id = ? AND file_path = ?",
                params![run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(result, "passed");

        let approve: String = conn
            .query_row(
                "SELECT approve_status FROM test_runs WHERE run_id = ?",
                params![run_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(approve, "draft");
    }

    #[test]
    fn upsert_run_case_row_title_from_yaml_only() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp = ".gitoza/test/cases/yaml_title/case.md";
        seed_test_run_header(&conn, repo, run_id);

        let snapshot = "---\ntitle: Snapshot Title\ncase_id: C1\n---\n\nBody.\n";
        let doc = serde_json::json!({
            "run_id": run_id,
            "run_name": "Run",
            "cases": [{
                "file_path": fp,
                "case_id": "C1",
                "title": "YAML Title",
                "content_snapshot": snapshot,
            }]
        });
        upsert_test_run_from_doc(&conn, repo, &doc, None).unwrap();

        let title: Option<String> = conn
            .query_row(
                "SELECT title FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title.as_deref(), Some("YAML Title"));
    }

    #[test]
    fn upsert_run_case_row_metadata_from_yaml_only() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp = ".gitoza/test/cases/yaml_meta/case.md";
        seed_test_run_header(&conn, repo, run_id);

        let snapshot = "---\ntitle: Snapshot Title\ncase_id: C1\npriority: low\ntags: [old]\nrequirement_id: OLD\n---\n\nBody.\n";
        let doc = serde_json::json!({
            "run_id": run_id,
            "run_name": "Run",
            "cases": [{
                "file_path": fp,
                "case_id": "C1",
                "title": "YAML Title",
                "priority": "high",
                "tags": ["smoke", "regression"],
                "requirement_id": "REQ-42",
                "content_snapshot": snapshot,
            }]
        });
        upsert_test_run_from_doc(&conn, repo, &doc, None).unwrap();

        let (title, tags_json, priority, requirement_id): (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT title, tags, priority, requirement_id FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(title.as_deref(), Some("YAML Title"));
        assert_eq!(priority.as_deref(), Some("high"));
        assert_eq!(requirement_id.as_deref(), Some(r#"["REQ-42"]"#));
        let tags: Vec<String> = serde_json::from_str(tags_json.as_deref().unwrap()).unwrap();
        assert_eq!(tags, vec!["smoke", "regression"]);
    }

    #[test]
    fn upsert_run_case_row_assigned_to_unassigned_from_yaml() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-unassign-yaml";
        let fp = ".gitoza/test/cases/yaml_assign/case.md";
        seed_test_run_header(&conn, repo, run_id);

        let mut co = serde_json::Map::new();
        co.insert(
            "file_path".to_string(),
            serde_json::Value::String(fp.to_string()),
        );
        co.insert(
            "case_id".to_string(),
            serde_json::Value::String("C1".to_string()),
        );
        co.insert(
            "assigned_to".to_string(),
            serde_json::Value::String(ASSIGNEE_UNASSIGNED_LABEL.to_string()),
        );
        upsert_run_case_row(&conn, repo, run_id, fp, &co).unwrap();

        let stored: Option<String> = conn
            .query_row(
                "SELECT assigned_to FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored.as_deref(), Some(ASSIGNEE_UNASSIGNED));
    }

    #[tokio::test]
    async fn build_case_entries_no_content_snapshot() {
        let config = temp_dir("build_case_entries");
        let slug = "myrepo";
        let repo_path = config.join("repos").join(slug);
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo(&repo_path, "User", "user@example.com");

        let state = new_state(config);
        let conn_arc = open_repo_db(&state, slug).unwrap();
        let fp = ".gitoza/test/cases/proj/case.md";
        upsert_case_db(
            &conn_arc.lock().unwrap(),
            UpsertCaseArgs {
                case_id: "C1".to_string(),
                title: Some("Indexed Title".to_string()),
                tags: vec!["smoke".to_string()],
                status: Some("active".to_string()),
                priority: Some("high".to_string()),
                file_path: fp.to_string(),
                repo_slug: slug.to_string(),
                directory: ".gitoza/test/cases/proj".to_string(),
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: Some("REQ-1".to_string()),
                assigned_to: Some("Bob".to_string()),
                automated: false,
                params: BTreeMap::new(),
            },
        )
        .unwrap();

        let mut spec = BTreeMap::new();
        spec.insert("file_path".to_string(), fp.to_string());
        let entries = build_case_entries_for_run(&state, &repo_path, slug, vec![spec])
            .await
            .unwrap();
        assert_eq!(entries.len(), 1);
        let entry = entries[0].as_object().unwrap();
        assert_eq!(
            entry.get("title").and_then(|v| v.as_str()),
            Some("Indexed Title")
        );
        assert_eq!(entry.get("priority").and_then(|v| v.as_str()), Some("high"));
        let ids = entry
            .get("requirement_ids")
            .and_then(|v| v.as_array())
            .expect("requirement_ids array");
        assert_eq!(ids.len(), 1);
        assert_eq!(ids[0].as_str(), Some("REQ-1"));
        assert!(entry.get("automated").is_none());
        assert!(entry.get("_content_snapshot").is_none());
        assert!(entry.get("content_snapshot").is_none());
        let tags = entry.get("tags").and_then(|v| v.as_array()).unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].as_str(), Some("smoke"));
    }

    #[tokio::test]
    async fn build_case_entries_for_run_freezes_automated_flag() {
        let config = temp_dir("freeze_automated");
        let slug = "repo-freeze-auto";
        let repo_path = config.join("repos").join(slug);
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo(&repo_path, "User", "user@example.com");

        let state = new_state(config);
        let conn_arc = open_repo_db(&state, slug).unwrap();
        let fp = ".gitoza/test/cases/proj/auto.md";
        upsert_case_db(
            &conn_arc.lock().unwrap(),
            UpsertCaseArgs {
                case_id: "C-AUTO".to_string(),
                title: Some("Auto case".to_string()),
                tags: vec![],
                status: Some("active".to_string()),
                priority: Some("medium".to_string()),
                file_path: fp.to_string(),
                repo_slug: slug.to_string(),
                directory: ".gitoza/test/cases/proj".to_string(),
                approve_status: "draft".to_string(),
                updated_at: None,
                updated_by: None,
                approved_by: None,
                approved_at: None,
                requirement_id: None,
                assigned_to: None,
                automated: true,
                params: BTreeMap::new(),
            },
        )
        .unwrap();

        let mut spec = BTreeMap::new();
        spec.insert("file_path".to_string(), fp.to_string());
        let entries = build_case_entries_for_run(&state, &repo_path, slug, vec![spec])
            .await
            .unwrap();
        let entry = entries[0].as_object().unwrap();
        assert_eq!(entry.get("automated").and_then(|v| v.as_bool()), Some(true));
    }

    #[test]
    fn upsert_run_case_row_no_title_without_yaml_field() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp = ".gitoza/test/cases/no_yaml_title/case.md";
        seed_test_run_header(&conn, repo, run_id);

        let snapshot = "---\ntitle: Snapshot Title\ncase_id: C1\n---\n\nBody.\n";
        let doc = serde_json::json!({
            "run_id": run_id,
            "run_name": "Run",
            "cases": [{
                "file_path": fp,
                "case_id": "C1",
                "content_snapshot": snapshot,
            }]
        });
        upsert_test_run_from_doc(&conn, repo, &doc, None).unwrap();

        let title: Option<String> = conn
            .query_row(
                "SELECT title FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, None);
    }

    #[test]
    fn insert_run_cases_from_entries_sets_title_from_yaml_field() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp = ".gitoza/test/cases/b/case.md";
        seed_test_run_header(&conn, repo, run_id);

        let snapshot = "---\ntitle: From Snapshot\ncase_id: B1\n---\n\nBody.\n";
        let entry = serde_json::json!({
            "file_path": fp,
            "case_id": "B1",
            "title": "From YAML",
            "result": "pending",
            "executed_by": "Bob",
            "executed_at": "2020-03-03T00:00:00Z",
            "_content_snapshot": snapshot,
        });
        insert_run_cases_from_entries(&conn, repo, run_id, &[entry]).unwrap();

        let title: Option<String> = conn
            .query_row(
                "SELECT title FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title.as_deref(), Some("From YAML"));

        let executed_by: Option<String> = conn
            .query_row(
                "SELECT executed_by FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(executed_by.as_deref(), Some("Bob"));

        let result_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM test_run_results WHERE run_id = ? AND file_path = ?",
                params![run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(result_count, 0);
    }

    #[test]
    fn sync_run_results_sets_executed_by_and_preserves_case_title() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp = ".gitoza/test/cases/c/case.md";
        seed_test_run_header(&conn, repo, run_id);
        conn.execute(
            r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, executed_by, title)
VALUES (?1, ?2, ?3, 'C1', '', '2020-01-01T00:00:00Z', 'Alice', 'Title')
"#,
            params![run_id, repo, fp],
        )
        .unwrap();

        let doc = serde_json::json!({
            "run_id": run_id,
            "run_name": "Run",
            "updated_at": "2020-02-02T00:00:00Z",
            "cases": [{
                "file_path": fp,
                "case_id": "C1",
                "result": "passed",
                "executed_at": "2020-02-02T00:00:00Z",
                "executed_by": "Bob"
            }]
        });
        sync_run_results_from_doc(&conn, repo, &doc).unwrap();

        let title: String = conn
            .query_row(
                "SELECT title FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "Title");

        let executed_by: String = conn
            .query_row(
                "SELECT executed_by FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(executed_by, "Bob");
    }

    #[test]
    fn delete_run_cases_by_paths_removes_only_given_paths() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp_a = ".gitoza/test/cases/a.md";
        let fp_b = ".gitoza/test/cases/b.md";
        seed_test_run_header(&conn, repo, run_id);
        for fp in [fp_a, fp_b] {
            conn.execute(
                r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, title)
VALUES (?1, ?2, ?3, 'X', '', '2020-01-01T00:00:00Z', 'T')
"#,
                params![run_id, repo, fp],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO test_run_results (run_id, file_path, result, executed_at) VALUES (?1, ?2, 'passed', '2020-01-01T00:00:00Z')",
                params![run_id, fp],
            )
            .unwrap();
        }

        let deleted = delete_run_cases_by_paths(&conn, repo, run_id, &[fp_a.to_string()]).unwrap();
        assert_eq!(deleted, 1);

        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM test_run_cases WHERE repo_slug = ? AND run_id = ?",
                params![repo, run_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 1);

        let still_b: String = conn
            .query_row(
                "SELECT file_path FROM test_run_cases WHERE repo_slug = ? AND run_id = ?",
                params![repo, run_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(still_b, fp_b);

        let results_left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM test_run_results WHERE run_id = ?",
                params![run_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(results_left, 1);
    }

    #[test]
    fn delete_run_cases_by_paths_returns_deleted_result_count() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp = ".gitoza/test/cases/a.md";
        seed_test_run_header(&conn, repo, run_id);
        conn.execute(
            r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, title)
VALUES (?1, ?2, ?3, 'X', '', '2020-01-01T00:00:00Z', 'T')
"#,
            params![run_id, repo, fp],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO test_run_results (run_id, file_path, result, executed_at) VALUES (?1, ?2, 'passed', '2020-01-01T00:00:00Z')",
            params![run_id, fp],
        )
        .unwrap();

        let deleted = delete_run_cases_by_paths(&conn, repo, run_id, &[fp.to_string()]).unwrap();
        assert_eq!(deleted, 1);

        let results_left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM test_run_results WHERE run_id = ?",
                params![run_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(results_left, 0);
    }

    #[test]
    fn build_run_results_doc_excludes_orphan_results() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp_member = ".gitoza/test/cases/a.md";
        let fp_orphan = ".gitoza/test/cases/b.md";
        seed_test_run_header(&conn, repo, run_id);
        conn.execute(
            r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, title)
VALUES (?1, ?2, ?3, 'A', '', '2020-01-01T00:00:00Z', 'A')
"#,
            params![run_id, repo, fp_member],
        )
        .unwrap();
        for fp in [fp_member, fp_orphan] {
            conn.execute(
                "INSERT INTO test_run_results (run_id, file_path, result, executed_at) VALUES (?1, ?2, 'passed', '2020-01-01T00:00:00Z')",
                params![run_id, fp],
            )
            .unwrap();
        }

        let doc = crate::run_publish::build_run_results_doc_from_db(&conn, repo, run_id).unwrap();
        let results = doc
            .get("results")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        assert!(results.contains_key(fp_member));
        assert!(!results.contains_key(fp_orphan));
    }

    #[test]
    fn sync_results_yaml_skips_non_members() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp_a = ".gitoza/test/cases/a.md";
        let fp_b = ".gitoza/test/cases/b.md";
        seed_test_run_header(&conn, repo, run_id);
        conn.execute(
            r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, title)
VALUES (?1, ?2, ?3, 'A', '', '2020-01-01T00:00:00Z', 'A')
"#,
            params![run_id, repo, fp_a],
        )
        .unwrap();

        let results_doc = serde_json::json!({
            "run_id": run_id,
            "updated_at": "2020-02-02T00:00:00Z",
            "results": {
                fp_a: {
                    "result": "passed",
                    "executed_at": "2020-02-02T00:00:00Z"
                },
                fp_b: {
                    "result": "failed",
                    "executed_at": "2020-02-02T00:00:00Z"
                }
            }
        });
        sync_run_results_from_results_yaml_doc(&conn, repo, &results_doc).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM test_run_results WHERE run_id = ?",
                params![run_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        let result_a: String = conn
            .query_row(
                "SELECT result FROM test_run_results WHERE run_id = ? AND file_path = ?",
                params![run_id, fp_a],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(result_a, "passed");
    }

    #[test]
    fn sync_results_yaml_replace_clears_absent_paths() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp_a = ".gitoza/test/cases/a.md";
        let fp_b = ".gitoza/test/cases/b.md";
        seed_test_run_header(&conn, repo, run_id);
        for (fp, cid) in [(fp_a, "A"), (fp_b, "B")] {
            conn.execute(
                r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, executed_by, title)
VALUES (?1, ?2, ?3, ?4, '', '2020-01-01T00:00:00Z', 'Alice', ?4)
"#,
                params![run_id, repo, fp, cid],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO test_run_results (run_id, file_path, result, executed_at) VALUES (?1, ?2, 'passed', '2020-01-01T00:00:00Z')",
                params![run_id, fp],
            )
            .unwrap();
        }

        // Sparse YAML only keeps B — A must become pending and lose its result row.
        let results_doc = serde_json::json!({
            "run_id": run_id,
            "results": {
                fp_b: {
                    "result": "failed",
                    "executed_at": "2020-02-02T00:00:00Z",
                    "executed_by": "Bob"
                }
            }
        });
        sync_run_results_from_results_yaml_doc(&conn, repo, &results_doc).unwrap();

        let count_a: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM test_run_results WHERE run_id = ? AND file_path = ?",
                params![run_id, fp_a],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count_a, 0);

        let result_b: String = conn
            .query_row(
                "SELECT result FROM test_run_results WHERE run_id = ? AND file_path = ?",
                params![run_id, fp_b],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(result_b, "failed");

        let executed_a: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT executed_at, executed_by FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp_a],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(executed_a, (None, None));
    }

    #[tokio::test]
    async fn reconcile_runs_from_disk_restores_pending_from_sparse_yaml() {
        use crate::pending_run_yaml::{self, PendingRunFlushFlags};

        let config = temp_dir("reconcile_disk_wins");
        let slug = "myrepo";
        let run_id = "550e8400-e29b-41d4-a716-446655440001";
        let fp = ".gitoza/test/cases/a/case.md";
        let repo_path = config.join("repos").join(slug);
        fs::create_dir_all(&repo_path).unwrap();

        let run_dir = repo_path.join(".gitoza/test/runs").join(run_id);
        fs::create_dir_all(&run_dir).unwrap();
        fs::write(
            run_dir.join("head.md"),
            format!(
                "---\nrun_id: {run_id}\ntitle: Run\ncreated_at: 2020-01-01T00:00:00Z\nupdated_at: 2020-01-01T00:00:00Z\n---\n\n"
            ),
        )
        .unwrap();
        fs::write(
            run_dir.join("cases.md"),
            format!("---\nrun_id: {run_id}\ncases:\n  - file_path: {fp}\n    case_id: C1\n---\n\n"),
        )
        .unwrap();
        // Empty / missing results ⇒ pending on disk.
        fs::write(
            run_dir.join("results.md"),
            format!("---\nrun_id: {run_id}\ntitle: Run\nresults: {{}}\n---\n\n"),
        )
        .unwrap();

        let state = new_state(config);
        let conn_arc = open_repo_db(&state, slug).unwrap();
        {
            let conn = conn_arc.lock().unwrap();
            seed_test_run_header(&conn, slug, run_id);
            conn.execute(
                r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, executed_by, title)
VALUES (?1, ?2, ?3, 'C1', '', '2020-01-01T00:00:00Z', 'Alice', 'Case')
"#,
                params![run_id, slug, fp],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO test_run_results (run_id, file_path, result, executed_at) VALUES (?1, ?2, 'passed', '2020-01-01T00:00:00Z')",
                params![run_id, fp],
            )
            .unwrap();
        }

        pending_run_yaml::mark_run_yaml_pending(
            &state,
            slug,
            run_id,
            PendingRunFlushFlags::results_only(),
        )
        .unwrap();
        assert!(pending_run_yaml::has_pending_run_yaml(&state, slug));

        reconcile_runs_from_disk(&state, &repo_path, slug, &[run_id.to_string()])
            .await
            .unwrap();

        assert!(!pending_run_yaml::has_pending_run_yaml(&state, slug));
        let conn = conn_arc.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM test_run_results WHERE run_id = ? AND file_path = ?",
                params![run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn run_ids_from_yaml_paths_dedupes() {
        let paths = vec![
            ".gitoza/test/runs/R-ABC123/results.md".to_string(),
            ".gitoza/test/runs/R-ABC123/head.md".to_string(),
            ".gitoza/test/runs/R-XYZ789/cases.md".to_string(),
            ".gitoza/test/cases/foo.md".to_string(),
        ];
        let ids = run_ids_from_yaml_paths(&paths);
        assert_eq!(ids, vec!["R-ABC123".to_string(), "R-XYZ789".to_string()]);
    }

    #[test]
    fn readd_case_after_remove_is_pending() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-1";
        let fp = ".gitoza/test/cases/a.md";
        seed_test_run_header(&conn, repo, run_id);
        conn.execute(
            r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, title, picked_at_sha)
VALUES (?1, ?2, ?3, 'A', '', '2020-01-01T00:00:00Z', 'A', 'sha-old')
"#,
            params![run_id, repo, fp],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO test_run_results (run_id, file_path, result, executed_at) VALUES (?1, ?2, 'passed', '2020-01-01T00:00:00Z')",
            params![run_id, fp],
        )
        .unwrap();

        delete_run_cases_by_paths(&conn, repo, run_id, &[fp.to_string()]).unwrap();

        let entry = serde_json::json!({
            "file_path": fp,
            "case_id": "A",
            "picked_at_sha": "sha-new",
            "result": "pending"
        });
        insert_run_cases_from_entries(&conn, repo, run_id, &[entry]).unwrap();

        let result_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM test_run_results WHERE run_id = ? AND file_path = ?",
                params![run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(result_count, 0);

        let picked_sha: String = conn
            .query_row(
                "SELECT picked_at_sha FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![repo, run_id, fp],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(picked_sha, "sha-new");
    }

    #[tokio::test]
    async fn flush_pending_before_index_preserves_results_after_ide_cases_edit() {
        use crate::pending_run_yaml::{self, PendingRunFlushFlags};

        let config = temp_dir("flush_before_index");
        let slug = "myrepo";
        let run_id = "550e8400-e29b-41d4-a716-446655440000";
        let fp_a = ".gitoza/test/cases/a/case.md";
        let fp_b = ".gitoza/test/cases/b/case.md";
        let repo_path = config.join("repos").join(slug);
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo(&repo_path, "Tester", "tester@example.com");

        let run_dir = repo_path.join(".gitoza/test/runs").join(&run_id);
        fs::create_dir_all(&run_dir).unwrap();
        fs::write(
            run_dir.join("head.md"),
            format!(
                "---\nrun_id: {run_id}\ntitle: Run\ncreated_at: 2020-01-01T00:00:00Z\nupdated_at: 2020-01-01T00:00:00Z\n---\n\n"
            ),
        )
        .unwrap();
        fs::write(
            run_dir.join("cases.md"),
            format!("---\nrun_id: {run_id}\ncases:\n  - file_path: {fp_a}\n    case_id: C1\n---\n\n"),
        )
        .unwrap();

        let state = new_state(config);
        let conn_arc = open_repo_db(&state, slug).unwrap();
        let run_dir_rel = run_publish::get_run_dir_rel_path(&run_id, false);

        {
            let conn = conn_arc.lock().unwrap();
            seed_test_run_header(&conn, slug, run_id);
            set_run_dir_path_db(&conn, &run_id, &run_dir_rel).unwrap();
            conn.execute(
                r#"
INSERT INTO test_run_cases
  (run_id, repo_slug, file_path, case_id, content_snapshot, executed_at, title)
VALUES (?1, ?2, ?3, 'C1', '', '2020-01-01T00:00:00Z', 'Case A')
"#,
                params![run_id, slug, fp_a],
            )
            .unwrap();
            set_run_result_in_db(
                &conn,
                slug,
                run_id,
                fp_a,
                "passed",
                None,
                Some("Tester"),
                false,
            )
            .unwrap();
        }

        pending_run_yaml::mark_run_yaml_pending(
            &state,
            slug,
            run_id,
            PendingRunFlushFlags::results_only(),
        )
        .unwrap();

        // Simulate IDE adding case B on disk (cases.md changed, results.md still stale).
        fs::write(
            run_dir.join("cases.md"),
            format!(
                "---\nrun_id: {run_id}\ncases:\n  - file_path: {fp_a}\n    case_id: C1\n  - file_path: {fp_b}\n    case_id: C2\n---\n\n"
            ),
        )
        .unwrap();

        // Negative control: reindex from disk without flush loses execution results.
        {
            let doc = run_publish::load_run_shards_from_disk(&repo_path, run_id, false).unwrap();
            let conn = conn_arc.lock().unwrap();
            upsert_test_run_from_doc(&conn, slug, &doc, Some(&run_dir_rel)).unwrap();
            let result: Option<String> = conn
                .query_row(
                    "SELECT result FROM test_run_results WHERE run_id = ? AND file_path = ?",
                    params![run_id, fp_a],
                    |r| r.get(0),
                )
                .optional()
                .unwrap()
                .flatten();
            assert_ne!(
                result.as_deref(),
                Some("passed"),
                "stale results.md should drop passed result without flush"
            );
        }

        // Restore DB result and pending flag for the flush path.
        {
            let conn = conn_arc.lock().unwrap();
            set_run_result_in_db(
                &conn,
                slug,
                run_id,
                fp_a,
                "passed",
                None,
                Some("Tester"),
                false,
            )
            .unwrap();
        }
        pending_run_yaml::mark_run_yaml_pending(
            &state,
            slug,
            run_id,
            PendingRunFlushFlags::results_only(),
        )
        .unwrap();

        pending_run_yaml::flush_pending_run_yaml_before_index(&state, slug)
            .await
            .unwrap();

        {
            let doc = run_publish::load_run_shards_from_disk(&repo_path, run_id, false).unwrap();
            let conn = conn_arc.lock().unwrap();
            upsert_test_run_from_doc(&conn, slug, &doc, Some(&run_dir_rel)).unwrap();

            let result: String = conn
                .query_row(
                    "SELECT result FROM test_run_results WHERE run_id = ? AND file_path = ?",
                    params![run_id, fp_a],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(result, "passed");

            let case_b_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                    params![slug, run_id, fp_b],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(case_b_count, 1);
        }
    }

    #[test]
    fn upsert_pending_diff_file_list_db_stores_empty_diffs() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let slug = "r1";
        let files = vec![
            models::PendingFileChange {
                path: ".gitoza/test/cases/p/a.md".to_string(),
                status: "M".to_string(),
                old_path: None,
            },
            models::PendingFileChange {
                path: ".gitoza/test/cases/p/b.md".to_string(),
                status: "A".to_string(),
                old_path: None,
            },
        ];
        upsert_pending_diff_file_list_db(&conn, slug, &files).unwrap();
        let stored = pending_diff_files_db(&conn, slug).unwrap();
        assert_eq!(
            stored,
            vec![
                ".gitoza/test/cases/p/a.md".to_string(),
                ".gitoza/test/cases/p/b.md".to_string(),
            ]
        );
        let changes = pending_case_file_changes_db(&conn, slug).unwrap();
        assert_eq!(changes[0].status, "M");
        assert_eq!(changes[1].status, "A");
        assert!(pending_diff_content_db(&conn, slug, &files[0].path)
            .unwrap()
            .is_empty());
        cache_pending_diff_content_db(&conn, slug, &files[0].path, "diff-text").unwrap();
        assert_eq!(
            pending_diff_content_db(&conn, slug, &files[0].path).unwrap(),
            "diff-text"
        );
    }

    #[test]
    fn remap_case_file_path_updates_single_case() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let slug = "r1";
        let old_path = ".gitoza/test/cases/proj/suite/old_name.md";
        let new_path = ".gitoza/test/cases/proj/suite/new_name.md";
        seed_case_index_row(&conn, slug, old_path);

        let updated = remap_case_file_path(&conn, slug, old_path, new_path, "new_name").unwrap();
        assert_eq!(updated, 1);

        let (case_id, file_path): (String, String) = conn
            .query_row(
                "SELECT case_id, file_path FROM test_cases WHERE repo_slug = ?",
                [slug],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(case_id, "new_name");
        assert_eq!(file_path, new_path);
    }

    #[test]
    fn remap_case_index_paths_by_prefix_updates_suite_files() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let slug = "r1";
        let old_suite = ".gitoza/test/cases/proj/old_suite";
        let new_suite = ".gitoza/test/cases/proj/new_suite";
        for name in ["a", "b", "c"] {
            seed_case_index_row(&conn, slug, &format!("{old_suite}/{name}.md"));
        }
        let updated = remap_case_index_paths_by_prefix(&conn, slug, old_suite, new_suite).unwrap();
        assert_eq!(updated, 3);
        for name in ["a", "b", "c"] {
            let fp = format!("{new_suite}/{name}.md");
            let title: String = conn
                .query_row(
                    "SELECT title FROM test_cases WHERE repo_slug = ? AND file_path = ?",
                    params![slug, fp],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(title, "Title");
            let directory = directory_from_file_path(&fp);
            assert_eq!(directory, ".gitoza/test/cases/proj");
        }
    }

    #[test]
    fn parse_name_status_changes_reads_amrd_lines() {
        let out = "R100\t.gitoza/test/cases/p/old/a.md\t.gitoza/test/cases/p/new/a.md\nM\t.gitoza/test/cases/p/b.md\nA\t.gitoza/test/cases/p/c.md\nD\t.gitoza/test/cases/p/gone.md\nM\t.gitoza/config.json\n";
        let changes = parse_name_status_changes(out);
        assert_eq!(changes.len(), 5);
        assert_eq!(changes[0].status, "R");
        assert_eq!(
            changes[0].old_path.as_deref(),
            Some(".gitoza/test/cases/p/old/a.md")
        );
        assert_eq!(changes[0].path, ".gitoza/test/cases/p/new/a.md");
        assert_eq!(changes[1].status, "M");
        assert_eq!(changes[1].path, ".gitoza/test/cases/p/b.md");
        assert_eq!(changes[2].status, "A");
        assert_eq!(changes[3].status, "D");
        assert_eq!(changes[3].path, ".gitoza/test/cases/p/gone.md");
    }

    #[test]
    fn partition_discard_git_ops_splits_added_modified_and_rename() {
        let mut status = HashMap::new();
        status.insert(
            ".gitoza/test/cases/p/a.md".into(),
            models::PendingFileChange {
                path: ".gitoza/test/cases/p/a.md".into(),
                status: "M".into(),
                old_path: None,
            },
        );
        status.insert(
            ".gitoza/test/cases/p/new.md".into(),
            models::PendingFileChange {
                path: ".gitoza/test/cases/p/new.md".into(),
                status: "A".into(),
                old_path: None,
            },
        );
        status.insert(
            ".gitoza/test/cases/p/renamed.md".into(),
            models::PendingFileChange {
                path: ".gitoza/test/cases/p/renamed.md".into(),
                status: "R".into(),
                old_path: Some(".gitoza/test/cases/p/old.md".into()),
            },
        );
        status.insert(
            ".gitoza/test/cases/p/gone.md".into(),
            models::PendingFileChange {
                path: ".gitoza/test/cases/p/gone.md".into(),
                status: "D".into(),
                old_path: None,
            },
        );

        let paths = vec![
            ".gitoza/test/cases/p/a.md".into(),
            ".gitoza/test/cases/p/new.md".into(),
            ".gitoza/test/cases/p/renamed.md".into(),
            ".gitoza/test/cases/p/gone.md".into(),
        ];
        let (restore, rm) = partition_discard_git_ops(&paths, &status);
        assert_eq!(
            restore,
            vec![
                ".gitoza/test/cases/p/a.md".to_string(),
                ".gitoza/test/cases/p/gone.md".to_string(),
                ".gitoza/test/cases/p/old.md".to_string(),
                ".gitoza/test/cases/p/renamed.md".to_string(),
            ]
        );
        assert_eq!(rm, vec![".gitoza/test/cases/p/new.md".to_string()]);
    }

    #[test]
    fn is_allowed_discard_path_rejects_traversal_and_outside_gitoza() {
        assert!(is_allowed_discard_path(".gitoza/test/cases/p/a.md"));
        assert!(is_allowed_discard_path(".gitoza/config.json"));
        assert!(!is_allowed_discard_path("../.gitoza/test/cases/a.md"));
        assert!(!is_allowed_discard_path("/.gitoza/test/cases/a.md"));
        assert!(!is_allowed_discard_path("README.md"));
    }

    #[tokio::test]
    async fn discard_staged_and_worktree_paths_restores_modified_and_removes_added() {
        let dir = temp_dir("discard_paths");
        let repo_path = dir.join("repo");
        fs::create_dir_all(repo_path.join(".gitoza/test/cases/p")).unwrap();
        init_test_git_repo(&repo_path, "Tester", "tester@example.com");

        let mod_rel = ".gitoza/test/cases/p/mod.md";
        let add_rel = ".gitoza/test/cases/p/add.md";
        fs::write(repo_path.join(mod_rel), "title: original\n").unwrap();
        let _ = std::process::Command::new("git")
            .current_dir(&repo_path)
            .args(["add", "."])
            .output()
            .unwrap();
        let _ = std::process::Command::new("git")
            .current_dir(&repo_path)
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();

        fs::write(repo_path.join(mod_rel), "title: changed\n").unwrap();
        fs::write(repo_path.join(add_rel), "title: brand new\n").unwrap();
        let _ = std::process::Command::new("git")
            .current_dir(&repo_path)
            .args(["add", "."])
            .output()
            .unwrap();

        discard_staged_and_worktree_paths(
            &repo_path,
            &[mod_rel.to_string()],
            &[add_rel.to_string()],
        )
        .await
        .expect("discard");

        let mod_body = fs::read_to_string(repo_path.join(mod_rel)).unwrap();
        assert_eq!(mod_body, "title: original\n");
        assert!(!repo_path.join(add_rel).exists());

        let staged = git_cached_name_status_changes(&repo_path).await.unwrap();
        assert!(staged.is_empty());
    }

    #[test]
    fn case_changes_from_name_status_filters_cases_and_tickets_prefix() {
        let all = parse_name_status_changes(
            "M\t.gitoza/test/cases/p/a.md\n\
             D\t.gitoza/test/cases/p/b.md\n\
             A\t.gitoza/tasks/tickets/auth/Auth-1.md\n\
             M\t.gitoza/config.json\n",
        );
        let cases = case_changes_from_name_status(&all);
        assert_eq!(cases.len(), 3);
        assert_eq!(cases[0].status, "M");
        assert_eq!(cases[1].status, "D");
        assert_eq!(cases[2].path, ".gitoza/tasks/tickets/auth/Auth-1.md");
        assert_eq!(cases[2].status, "A");
    }

    #[test]
    fn resolve_optional_string_patch_keeps_existing_when_omitted() {
        let existing = Some("PROJ-1".to_string());
        assert_eq!(
            resolve_optional_string_patch(None, &existing).as_deref(),
            Some("PROJ-1")
        );
    }

    #[test]
    fn resolve_optional_string_patch_clears_on_empty_string() {
        let existing = Some("PROJ-1".to_string());
        assert_eq!(resolve_optional_string_patch(Some(""), &existing), None);
        assert_eq!(resolve_optional_string_patch(Some("  "), &existing), None);
    }

    #[test]
    fn resolve_optional_string_patch_sets_trimmed_value() {
        let existing = Some("PROJ-1".to_string());
        assert_eq!(
            resolve_optional_string_patch(Some("PROJ-2"), &existing).as_deref(),
            Some("PROJ-2")
        );
        assert_eq!(
            resolve_optional_string_patch(Some("  PROJ-3  "), &existing).as_deref(),
            Some("PROJ-3")
        );
    }

    #[test]
    fn effective_assigned_to_prefers_case_over_run() {
        assert_eq!(
            effective_assigned_to(Some("Alice"), Some("Bob")).as_deref(),
            Some("Alice")
        );
        assert_eq!(
            effective_assigned_to(None, Some("Bob")).as_deref(),
            Some("Bob")
        );
        assert_eq!(effective_assigned_to(None, None), None);
    }

    #[test]
    fn effective_assigned_to_unassigned_blocks_run() {
        assert_eq!(
            effective_assigned_to(Some(ASSIGNEE_UNASSIGNED), Some("Bob")),
            None
        );
        assert_eq!(
            effective_assigned_to(Some(ASSIGNEE_UNASSIGNED_LABEL), Some("Bob")),
            None
        );
    }

    #[test]
    fn assignee_match_key_leaves_cjk_unchanged() {
        assert_eq!(assignee_match_key("张三"), "张三");
        assert_eq!(assignee_match_key("  Alice  "), "alice");
    }

    #[test]
    fn canonical_assignee_picks_first_nocase_match() {
        let known = vec!["Alice".to_string(), "alice".to_string()];
        assert_eq!(
            canonical_assignee("alice", &known).as_deref(),
            Some("Alice")
        );
        assert_eq!(
            canonical_assignee("ALICE", &known).as_deref(),
            Some("Alice")
        );
    }

    #[test]
    fn canonical_assignee_new_name_passthrough() {
        let known = vec!["Alice".to_string()];
        assert_eq!(canonical_assignee("Bob", &known).as_deref(), Some("Bob"));
        assert_eq!(canonical_assignee("张三", &known).as_deref(), Some("张三"));
    }

    #[test]
    fn dedupe_assignees_case_insensitive_collapses_variants() {
        let input = vec!["alice".to_string(), "Alice".to_string(), "Bob".to_string()];
        assert_eq!(
            dedupe_assignees_case_insensitive(input),
            vec!["alice".to_string(), "Bob".to_string()]
        );
    }

    #[test]
    fn assignees_equal_ignore_case_treats_variants_as_same() {
        assert!(assignees_equal_ignore_case(Some("Alice"), Some("alice")));
        assert!(!assignees_equal_ignore_case(Some("Alice"), Some("Bob")));
        assert!(assignees_equal_ignore_case(None, None));
    }

    #[test]
    fn normalize_stored_assignee_maps_unassigned_label() {
        assert_eq!(
            normalize_stored_assignee("Unassigned").as_deref(),
            Some(ASSIGNEE_UNASSIGNED)
        );
        assert_eq!(normalize_stored_assignee("").as_deref(), None);
        assert_eq!(normalize_stored_assignee("Alice").as_deref(), Some("Alice"));
    }

    #[test]
    fn assignee_to_yaml_value_writes_label_for_sentinel() {
        assert_eq!(
            assignee_to_yaml_value(ASSIGNEE_UNASSIGNED),
            ASSIGNEE_UNASSIGNED_LABEL
        );
        assert_eq!(assignee_to_yaml_value("Alice"), "Alice");
    }

    #[test]
    fn get_run_case_item_unassigned_blocks_run_header() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-unassigned";
        let fp = ".gitoza/test/cases/a/case.md";
        seed_test_run_header(&conn, repo, run_id);
        conn.execute(
            "UPDATE test_runs SET assigned_to = ?1 WHERE run_id = ?2",
            params!["RunOwner", run_id],
        )
        .unwrap();
        conn.execute(
            r#"INSERT INTO test_run_cases (run_id, repo_slug, file_path, case_id, executed_at, assigned_to)
               VALUES (?1, ?2, ?3, 'C1', '2020-01-01T00:00:00Z', ?4)"#,
            params![run_id, repo, fp, ASSIGNEE_UNASSIGNED],
        )
        .unwrap();
        let item = get_run_case_item(&conn, repo, run_id, fp)
            .unwrap()
            .expect("case");
        assert_eq!(item.assigned_to.as_deref(), Some(ASSIGNEE_UNASSIGNED));
        assert_eq!(item.effective_assigned_to, None);
    }

    #[test]
    fn case_yaml_roundtrip_assigned_to() {
        let dir = temp_dir("case_assigned_yaml");
        let path = dir.join("TC-1.md");
        let detail = models::YamlCaseDetail {
            case_id: "TC-1".to_string(),
            title: Some("Title".to_string()),
            tags: vec![],
            status: Some("active".to_string()),
            priority: Some("medium".to_string()),
            file_path: path.to_string_lossy().to_string(),
            body: "Body".to_string(),
            raw: String::new(),
            approve_status: "draft".to_string(),
            updated_at: None,
            updated_by: None,
            approved_by: None,
            approved_at: None,
            requirement_ids: vec![],
            assigned_to: Some("Carol".to_string()),
            automated: false,
            comments: vec![],
            params: BTreeMap::new(),
        };
        let fm = case_detail_to_front_matter(&detail);
        write_full_yaml(&path, &fm, &detail.body).unwrap();
        let parsed = read_full_yaml(&path).unwrap().expect("parsed");
        assert_eq!(parsed.assigned_to.as_deref(), Some("Carol"));
    }

    #[test]
    fn get_run_case_item_effective_assigned_to_from_run_header() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "repo1";
        let run_id = "run-assign";
        let fp = ".gitoza/test/cases/a/case.md";
        seed_test_run_header(&conn, repo, run_id);
        conn.execute(
            "UPDATE test_runs SET assigned_to = ?1 WHERE run_id = ?2",
            params!["RunOwner", run_id],
        )
        .unwrap();
        conn.execute(
            r#"INSERT INTO test_run_cases (run_id, repo_slug, file_path, case_id, executed_at)
               VALUES (?1, ?2, ?3, 'C1', '2020-01-01T00:00:00Z')"#,
            params![run_id, repo, fp],
        )
        .unwrap();
        let item = get_run_case_item(&conn, repo, run_id, fp)
            .unwrap()
            .expect("case");
        assert_eq!(item.assigned_to, None);
        assert_eq!(item.effective_assigned_to.as_deref(), Some("RunOwner"));
    }

    fn git_ok(repo: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .current_dir(repo)
            .args(args)
            .output()
            .unwrap_or_else(|e| panic!("git {:?}: {e}", args));
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn git_stdout_sync(repo: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .current_dir(repo)
            .args(args)
            .output()
            .unwrap_or_else(|e| panic!("git {:?}: {e}", args));
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[tokio::test]
    async fn changed_paths_since_pre_rebase_includes_upstream_ticket() {
        let repo = temp_dir("rebase_index_range");
        init_test_git_repo(&repo, "Tester", "tester@example.com");
        // Avoid depending on init.defaultBranch.
        git_ok(&repo, &["checkout", "-b", "main"]);

        // Shared parent commit.
        fs::write(repo.join("README"), "base\n").unwrap();
        git_ok(&repo, &["add", "."]);
        git_ok(&repo, &["commit", "-m", "base"]);
        let parent = git_stdout_sync(&repo, &["rev-parse", "HEAD"]);

        // Upstream commit A (machine A ticket).
        let a_ticket = ".gitoza/tasks/tickets/demo/AAA-1.md";
        fs::create_dir_all(repo.join(".gitoza/tasks/tickets/demo")).unwrap();
        fs::write(
            repo.join(a_ticket),
            "---\nticket_id: AAA-1\ntitle: From A\nstatus: open\ntype: task\n---\nA\n",
        )
        .unwrap();
        git_ok(&repo, &["add", "."]);
        git_ok(&repo, &["commit", "-m", "ticket A"]);
        let tip_a = git_stdout_sync(&repo, &["rev-parse", "HEAD"]);

        // Local commit B from parent (machine B ticket), then rebase onto A.
        git_ok(&repo, &["checkout", "-b", "local-b", &parent]);
        let b_ticket = ".gitoza/tasks/tickets/demo/BBB-1.md";
        fs::create_dir_all(repo.join(".gitoza/tasks/tickets/demo")).unwrap();
        fs::write(
            repo.join(b_ticket),
            "---\nticket_id: BBB-1\ntitle: From B\nstatus: open\ntype: task\n---\nB\n",
        )
        .unwrap();
        git_ok(&repo, &["add", "."]);
        git_ok(&repo, &["commit", "-m", "ticket B"]);
        let pre_rebase = git_stdout_sync(&repo, &["rev-parse", "HEAD"]);

        git_ok(&repo, &["rebase", &tip_a]);
        let after = git_stdout_sync(&repo, &["rev-parse", "HEAD"]);
        assert_ne!(pre_rebase, after);

        let changed = changed_paths_since(&repo, &pre_rebase)
            .await
            .expect("changed_paths_since");
        assert!(
            changed.iter().any(|p| p == a_ticket),
            "pre_rebase..HEAD must include upstream ticket {a_ticket}; got {changed:?}"
        );

        // Incremental ticket index should upsert A's ticket when given that list.
        let conn = Connection::open_in_memory().unwrap();
        tickets::init_tickets_schema(&conn).unwrap();
        tickets::apply_incremental_ticket_changes(
            &conn,
            &repo,
            "repo",
            &tickets::filter_ticket_yaml_paths(&changed),
            &AuditStampSource::CommitMeta(HashMap::new()),
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tickets WHERE repo_slug = ? AND ticket_id = ?",
                params!["repo", "AAA-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    fn write_min_ticket_yaml(repo: &Path, rel: &str, title: &str) {
        let path = repo.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            path,
            format!("---\ntitle: {title}\nstatus: open\ntype: task\npriority: medium\n---\n"),
        )
        .unwrap();
    }

    fn write_min_case_yaml(repo: &Path, rel: &str, title: &str) {
        let path = repo.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, format!("---\ntitle: {title}\nstatus: draft\n---\n")).unwrap();
    }

    fn ticket_updated_at(conn: &Connection, slug: &str, ticket_id: &str) -> Option<String> {
        conn.query_row(
            "SELECT updated_at FROM tickets WHERE repo_slug = ?1 AND ticket_id = ?2",
            params![slug, ticket_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    }

    fn ticket_count(conn: &Connection, slug: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM tickets WHERE repo_slug = ?",
            [slug],
            |r| r.get(0),
        )
        .unwrap_or(0)
    }

    fn setup_warm_index_repo(prefix: &str) -> (AppState, PathBuf, String) {
        let config = temp_dir(prefix);
        let slug = "myrepo".to_string();
        let repo_path = config.join("repos").join(&slug);
        fs::create_dir_all(&repo_path).unwrap();
        init_test_git_repo(&repo_path, "Tester", "tester@example.com");
        git_ok(&repo_path, &["checkout", "-b", "main"]);
        write_min_case_yaml(
            &repo_path,
            ".gitoza/test/cases/alpha.gitoza.test/suite/case-a.md",
            "Case A",
        );
        write_min_ticket_yaml(
            &repo_path,
            ".gitoza/tasks/tickets/demo/AAA-1.md",
            "Ticket A",
        );
        git_ok(&repo_path, &["add", "."]);
        git_ok(&repo_path, &["commit", "-m", "seed"]);
        (new_state(config), repo_path, slug)
    }

    #[tokio::test]
    async fn ensure_repo_index_cold_indexes_and_stamps_head() {
        let (state, repo_path, slug) = setup_warm_index_repo("ensure_index_cold");
        let out = ensure_repo_index(&state, &repo_path, &slug)
            .await
            .expect("ensure");
        assert!(out.did_full);
        assert!(out.gitoza_paths_indexed >= 2);

        let head = git_stdout_sync(&repo_path, &["rev-parse", "HEAD"]);
        let conn_arc = open_repo_db(&state, &slug).unwrap();
        let conn = conn_arc.lock().unwrap();
        assert_eq!(
            get_indexed_head_sha(&conn, &slug).unwrap().as_deref(),
            Some(head.as_str())
        );
        assert_eq!(count_cases_db(&conn, &slug).unwrap(), 1);
        assert_eq!(ticket_count(&conn, &slug), 1);
    }

    #[tokio::test]
    async fn ensure_repo_index_warm_preserves_ticket_updated_at() {
        let (state, repo_path, slug) = setup_warm_index_repo("ensure_index_warm");
        ensure_repo_index(&state, &repo_path, &slug)
            .await
            .expect("cold");

        let conn_arc = open_repo_db(&state, &slug).unwrap();
        {
            let conn = conn_arc.lock().unwrap();
            conn.execute(
                "UPDATE tickets SET updated_at = ?1 WHERE repo_slug = ?2 AND ticket_id = ?3",
                params!["2024-06-01T12:00:00Z", slug, "AAA-1"],
            )
            .unwrap();
        }

        let out = ensure_repo_index(&state, &repo_path, &slug)
            .await
            .expect("warm");
        assert!(!out.did_full);
        assert_eq!(out.gitoza_paths_indexed, 0);

        let conn = conn_arc.lock().unwrap();
        assert_eq!(
            ticket_updated_at(&conn, &slug, "AAA-1").as_deref(),
            Some("2024-06-01T12:00:00Z")
        );
        assert_eq!(ticket_count(&conn, &slug), 1);
    }

    #[tokio::test]
    async fn ensure_repo_index_indexes_ticket_committed_while_closed() {
        let (state, repo_path, slug) = setup_warm_index_repo("ensure_index_closed_commit");
        ensure_repo_index(&state, &repo_path, &slug)
            .await
            .expect("cold");

        write_min_ticket_yaml(
            &repo_path,
            ".gitoza/tasks/tickets/demo/BBB-1.md",
            "Ticket B",
        );
        git_ok(&repo_path, &["add", "."]);
        git_ok(&repo_path, &["commit", "-m", "ticket B while closed"]);

        let out = ensure_repo_index(&state, &repo_path, &slug)
            .await
            .expect("warm");
        assert!(!out.did_full);
        assert!(out.gitoza_paths_indexed >= 1);

        let conn_arc = open_repo_db(&state, &slug).unwrap();
        let conn = conn_arc.lock().unwrap();
        assert_eq!(ticket_count(&conn, &slug), 2);
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tickets WHERE repo_slug = ? AND ticket_id = ?",
                params![slug, "BBB-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn ensure_repo_index_dirty_ticket_keeps_updated_at() {
        let (state, repo_path, slug) = setup_warm_index_repo("ensure_index_dirty");
        ensure_repo_index(&state, &repo_path, &slug)
            .await
            .expect("cold");

        let rel = ".gitoza/tasks/tickets/demo/CCC-1.md";
        write_min_ticket_yaml(&repo_path, rel, "Ticket C");
        {
            let conn_arc = open_repo_db(&state, &slug).unwrap();
            let conn = conn_arc.lock().unwrap();
            tickets::upsert_ticket_db(
                &conn,
                tickets::UpsertTicketArgs {
                    ticket_id: "CCC-1".to_string(),
                    title: Some("Ticket C".to_string()),
                    tags: vec![],
                    ticket_type: Some("task".to_string()),
                    status: Some("open".to_string()),
                    priority: Some("medium".to_string()),
                    file_path: rel.to_string(),
                    repo_slug: slug.clone(),
                    updated_at: Some("2024-01-01T00:00:00Z".to_string()),
                    updated_by: Some("Tester".to_string()),
                    assigned_to: None,
                    reporter: None,
                    sprint: None,
                    release: None,
                    parent: None,
                    params: BTreeMap::new(),
                },
            )
            .unwrap();
        }

        let out = ensure_repo_index(&state, &repo_path, &slug)
            .await
            .expect("dirty warm");
        assert!(!out.did_full);
        assert!(out.gitoza_paths_indexed >= 1);

        let conn_arc = open_repo_db(&state, &slug).unwrap();
        let conn = conn_arc.lock().unwrap();
        let at = ticket_updated_at(&conn, &slug, "CCC-1");
        assert!(
            at.is_some(),
            "dirty incremental must not wipe SQLite updated_at; got {at:?}"
        );
    }

    #[tokio::test]
    async fn ensure_repo_index_bad_cursor_falls_back_to_full() {
        let (state, repo_path, slug) = setup_warm_index_repo("ensure_index_bad_sha");
        ensure_repo_index(&state, &repo_path, &slug)
            .await
            .expect("cold");
        {
            let conn_arc = open_repo_db(&state, &slug).unwrap();
            set_indexed_head_sha(
                &conn_arc.lock().unwrap(),
                &slug,
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
            .unwrap();
        }

        let out = ensure_repo_index(&state, &repo_path, &slug)
            .await
            .expect("repair");
        assert!(out.did_full);

        let head = git_stdout_sync(&repo_path, &["rev-parse", "HEAD"]);
        let conn_arc = open_repo_db(&state, &slug).unwrap();
        assert_eq!(
            get_indexed_head_sha(&conn_arc.lock().unwrap(), &slug)
                .unwrap()
                .as_deref(),
            Some(head.as_str())
        );
    }

    #[test]
    fn run_header_requirement_ids_sync_list_and_patch() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "r1";
        let run_id = "run-req-1";
        let doc = serde_json::json!({
            "run_id": run_id,
            "title": "Sprint verify",
            "description": "",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "archived": false,
            "approve_status": "draft",
            "requirement_ids": ["DEMO-1", "DEMO-2"],
        });
        sync_test_run_header_from_doc(&conn, repo, &doc).unwrap();

        let item = get_test_run_list_item(&conn, repo, run_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            item.requirement_ids,
            vec!["DEMO-1".to_string(), "DEMO-2".to_string()]
        );

        let listed = list_test_runs(&conn, repo).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0]
            .requirement_ids
            .iter()
            .any(|id| id.eq_ignore_ascii_case("demo-1")));

        update_test_run_header_db(
            &conn,
            repo,
            run_id,
            None,
            None,
            None,
            None,
            Some(&["DEMO-1".to_string(), "DEMO-3".to_string()]),
            None,
            Some("tester"),
        )
        .unwrap();
        let after = get_test_run_list_item(&conn, repo, run_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            after.requirement_ids,
            vec!["DEMO-1".to_string(), "DEMO-3".to_string()]
        );

        let linked = requirement_ids::add_requirement_id(after.requirement_ids.clone(), "DEMO-4");
        let unlinked = requirement_ids::remove_requirement_id(linked.clone(), "DEMO-1");
        assert_eq!(
            linked,
            vec![
                "DEMO-1".to_string(),
                "DEMO-3".to_string(),
                "DEMO-4".to_string()
            ]
        );
        assert_eq!(unlinked, vec!["DEMO-3".to_string(), "DEMO-4".to_string()]);
        assert_eq!(
            requirement_ids::remove_requirement_id(unlinked.clone(), "DEMO-1"),
            unlinked
        );
    }

    #[test]
    fn run_header_release_sync_list_patch_and_clear() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let repo = "r1";
        let run_id = "run-rel-1";
        let doc = serde_json::json!({
            "run_id": run_id,
            "title": "Release smoke",
            "description": "",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "archived": false,
            "approve_status": "draft",
            "release": "ios/gitoza_1.1.0",
        });
        sync_test_run_header_from_doc(&conn, repo, &doc).unwrap();

        let item = get_test_run_list_item(&conn, repo, run_id)
            .unwrap()
            .unwrap();
        assert_eq!(item.release.as_deref(), Some("ios/gitoza_1.1.0"));

        let listed = list_test_runs(&conn, repo).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].release.as_deref(), Some("ios/gitoza_1.1.0"));

        // Case-insensitive filter match (mirrors list_runs IPC).
        let want = "IOS/gitoza_1.1.0".to_lowercase();
        let matched: Vec<_> = listed
            .iter()
            .filter(|r| {
                r.release
                    .as_deref()
                    .map(|s| s.trim().to_lowercase())
                    .as_deref()
                    == Some(want.as_str())
            })
            .collect();
        assert_eq!(matched.len(), 1);
        let missed: Vec<_> = listed
            .iter()
            .filter(|r| {
                r.release
                    .as_deref()
                    .map(|s| s.trim().to_lowercase())
                    .as_deref()
                    == Some("other/1.0.0")
            })
            .collect();
        assert!(missed.is_empty());

        update_test_run_header_db(
            &conn,
            repo,
            run_id,
            None,
            None,
            None,
            None,
            None,
            Some(Some("android/cut_2.0")),
            Some("tester"),
        )
        .unwrap();
        let after = get_test_run_list_item(&conn, repo, run_id)
            .unwrap()
            .unwrap();
        assert_eq!(after.release.as_deref(), Some("android/cut_2.0"));

        update_test_run_header_db(
            &conn,
            repo,
            run_id,
            None,
            None,
            None,
            None,
            None,
            Some(None),
            Some("tester"),
        )
        .unwrap();
        let cleared = get_test_run_list_item(&conn, repo, run_id)
            .unwrap()
            .unwrap();
        assert!(cleared.release.is_none());
    }

    #[test]
    fn commit_label_from_path_extracts_entity_ids() {
        assert_eq!(
            commit_label_from_path(".gitoza/test/cases/auth/login/TC-001.md").as_deref(),
            Some("TC-001")
        );
        assert_eq!(
            commit_label_from_path(".gitoza/tasks/tickets/demo/DEMO-A3F9K2.md").as_deref(),
            Some("DEMO-A3F9K2")
        );
        assert_eq!(
            commit_label_from_path(".gitoza/tasks/tickets/demo/releases/1.1.0.md").as_deref(),
            Some("demo/1.1.0")
        );
        assert_eq!(
            commit_label_from_path(".gitoza/wiki/architecture/data/W-ABC123.md").as_deref(),
            Some("W-ABC123")
        );
        assert_eq!(
            commit_label_from_path(".gitoza/test/runs/R-XYZ789/head.md").as_deref(),
            Some("R-XYZ789")
        );
        assert_eq!(
            commit_label_from_path(".gitoza/test/runs/.archive/old_run/results.md").as_deref(),
            Some("old_run")
        );
        assert_eq!(
            commit_label_from_path(".gitoza/test/templates/smoke.md").as_deref(),
            Some("smoke")
        );
        assert_eq!(
            commit_label_from_path(".gitoza/config.json").as_deref(),
            Some("config")
        );
        assert_eq!(
            commit_label_from_path(".gitoza/tasks/tickets/demo/.project.md"),
            None
        );
    }

    #[test]
    fn format_auto_sync_commit_message_dedupes_run_shards() {
        let msg = format_auto_sync_commit_message(&[
            ".gitoza/test/runs/R-ABC/head.md",
            ".gitoza/test/runs/R-ABC/results.md",
            ".gitoza/test/cases/proj/TC-001.md",
        ])
        .unwrap();
        assert_eq!(msg, "Auto-sync: R-ABC, TC-001");
    }

    #[test]
    fn format_auto_sync_commit_message_lists_up_to_eight_labels() {
        let paths: Vec<String> = (1..=8)
            .map(|i| format!(".gitoza/test/cases/p/TC-{i:03}.md"))
            .collect();
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        let msg = format_auto_sync_commit_message(&refs).unwrap();
        assert_eq!(
            msg,
            "Auto-sync: TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007, TC-008"
        );
    }

    #[test]
    fn format_auto_sync_commit_message_counts_when_over_threshold() {
        let paths: Vec<String> = (1..=9)
            .map(|i| format!(".gitoza/test/cases/p/TC-{i:03}.md"))
            .collect();
        let refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        let msg = format_auto_sync_commit_message(&refs).unwrap();
        assert_eq!(msg, "Auto-sync: 9 items");
    }

    #[test]
    fn format_auto_sync_commit_message_empty_paths_returns_none() {
        assert_eq!(format_auto_sync_commit_message(&[]), None);
    }
}
