use std::collections::{BTreeMap, HashSet};

use chrono::Utc;
use indexmap::IndexMap;
use rusqlite::params;
use serde_json::json;

use crate::error::ApiError;
use crate::models;
use crate::AppState;

// ───────────────────────────────────────────────────────────────────────
// 1. get_repo_connection
// ───────────────────────────────────────────────────────────────────────

pub async fn get_repo_connection(
    state: &AppState,
) -> Result<models::RepoConnectionResponse, ApiError> {
    match crate::load_config(&state.config_dir) {
        Ok(Some(cfg)) => Ok(models::RepoConnectionResponse {
            connected: true,
            repo_path: Some(cfg.repo_path.to_string_lossy().to_string()),
        }),
        Ok(None) => Ok(models::RepoConnectionResponse {
            connected: false,
            repo_path: None,
        }),
        Err(e) => Err(ApiError::internal(format!("{e:#}"))),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 2. list_repos
// ───────────────────────────────────────────────────────────────────────

pub async fn list_repos(state: &AppState) -> Result<models::ReposListResponse, ApiError> {
    let repos_dir = state.config_dir.join("repos");
    let cfg = crate::load_config(&state.config_dir).ok().flatten();
    let default_slug = cfg.as_ref().and_then(|c| {
        c.repo_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
    });

    let mut items = vec![];
    if let Ok(entries) = std::fs::read_dir(&repos_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() || !path.join(".git").is_dir() {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().to_string();
            let kind = crate::workspace::workspace_kind_for_repo(&path).to_string();
            let display_name = if kind == crate::workspace::WORKSPACE_KIND_PLAYGROUND {
                "Playground".to_string()
            } else {
                slug.clone()
            };
            let total = match crate::open_repo_db(state, &slug) {
                Ok(conn) => crate::count_cases_db(&conn.lock().unwrap(), &slug).unwrap_or(0),
                Err(_) => 0,
            };
            items.push(models::RepoListItem {
                slug,
                display_name,
                repo_path: path.to_string_lossy().to_string(),
                total_test_cases: total,
                total_suites: 0,
                last_sync: None,
                workspace_kind: kind,
            });
        }
    }
    Ok(models::ReposListResponse {
        repos: items,
        default_slug,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 3. delete_repo
// ───────────────────────────────────────────────────────────────────────

pub async fn delete_repo(state: &AppState, slug: String) -> Result<serde_json::Value, ApiError> {
    let slug = slug.trim().to_string();
    if !crate::is_safe_repo_slug(&slug) {
        return Err(ApiError::bad_request("Invalid repository slug."));
    }

    let repo_path = state.config_dir.join("repos").join(&slug);
    if !repo_path.is_dir() || !repo_path.join(".git").is_dir() {
        return Err(ApiError::not_found(format!("Repository not found: {slug}")));
    }

    let git_lock = crate::repo_git_lock(state, &slug);
    let _guard = git_lock.lock().await;

    if let Some(arc) = state.dbs.lock().unwrap().remove(&slug) {
        drop(arc);
    }

    let db_dir = state.config_dir.join("db");
    for suffix in ["", "-wal", "-shm"] {
        let p = db_dir.join(format!("{slug}.db{suffix}"));
        if p.is_file() {
            let _ = tokio::fs::remove_file(&p).await;
        }
    }

    if let Err(e) = tokio::fs::remove_dir_all(&repo_path).await {
        return Err(ApiError::internal(format!(
            "Failed to remove repository directory: {e:#}"
        )));
    }

    if let Err(e) = crate::refresh_config_after_repo_removed(&state.config_dir, &slug) {
        return Err(ApiError::internal(format!(
            "Removed clone but failed to update config: {e:#}"
        )));
    }

    let _ = state.git_op_locks.lock().unwrap().remove(&slug);
    let _ = crate::broadcast_refresh(state).await;

    Ok(json!({
        "status": "ok",
        "removed_slug": slug,
    }))
}

// ───────────────────────────────────────────────────────────────────────
// 4. quick_sync_repo
// ───────────────────────────────────────────────────────────────────────

pub async fn quick_sync_repo(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::QuickSyncResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    if crate::workspace::is_playground_slug(state, &slug) {
        return Ok(models::QuickSyncResponse {
            status: "ok".to_string(),
            pulled: 0,
            message: "Playground has no remote.".to_string(),
        });
    }

    let git_lock = crate::repo_git_lock(state, &slug);
    let _git_guard = git_lock.lock().await;

    let _ = crate::git_fetch_origin(&repo_path).await;

    let gate = crate::collect_repo_pull_gate(state, &slug, &repo_path)
        .await
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let should_pull = crate::should_pull_for_repo(&gate);

    let mut pulled: i64 = 0;
    let mut message =
        "Already up to date or pull skipped (editing / pending results / rebase in progress)."
            .to_string();
    if should_pull {
        match crate::pull_if_behind(&repo_path).await {
            Ok(true) => {
                pulled = 1;
                message = "Updated from remote.".to_string();
                let _ = crate::sync_index_after_pull(state, &repo_path, &slug).await;
                let _ = crate::broadcast_refresh(state).await;
            }
            Ok(false) => {
                message = "Already up to date.".to_string();
            }
            Err(e) => {
                return Err(ApiError::internal(format!("pull check failed: {e:#}")));
            }
        }
    }

    Ok(models::QuickSyncResponse {
        status: "ok".to_string(),
        pulled,
        message,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 5. index_from_git_status
// ───────────────────────────────────────────────────────────────────────

pub async fn index_from_git_status(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::IndexFromGitStatusResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let git_lock = crate::repo_git_lock(state, &slug);
    let _git_guard = git_lock.lock().await;

    let porcelain_paths = crate::git_status_porcelain_paths(&repo_path)
        .await
        .map_err(|e| ApiError::internal(format!("git status --porcelain failed: {e:#}")))?;
    let n_porcelain = porcelain_paths.len();
    if crate::project_config::paths_include_project_config(&porcelain_paths) {
        let _ = crate::project_config::sync_feature_flags_from_disk(state, &slug, &repo_path);
    }
    let (_, mut changed_runs) = crate::filter_case_and_run_yaml_paths(&porcelain_paths);

    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("open repo db: {e:#}")))?;
    let changed_cases = {
        let conn = conn_arc.lock().unwrap();
        let changed_cases =
            crate::merge_external_refresh_case_paths(&repo_path, &slug, &porcelain_paths, &conn)
                .map_err(|e| ApiError::internal(format!("case path reconcile failed: {e:#}")))?;
        let run_reconcile = crate::reconcile_run_paths(&conn, &repo_path, &slug)
            .map_err(|e| ApiError::internal(format!("run path reconcile failed: {e:#}")))?;
        changed_runs = crate::merge_path_lists(changed_runs, run_reconcile);
        changed_cases
    };

    let n_case = changed_cases.len();
    let n_run = changed_runs.len();

    let _ = crate::sync_repo_git_user_cache(state, &slug, &repo_path).await;
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let mut all_changed = changed_cases.clone();
    all_changed.extend(changed_runs.iter().cloned());
    let case_run_audit = crate::audit_source_for_ide_refresh(
        &repo_path,
        &porcelain_paths,
        &all_changed,
        &[".gitoza/test/cases", ".gitoza/test/runs"],
        &git_name,
    );

    crate::sync_index_for_changed_paths(
        state,
        &repo_path,
        &slug,
        changed_cases,
        changed_runs,
        Some(&case_run_audit),
        Some(&case_run_audit),
    )
    .await
    .map_err(|e| ApiError::internal(format!("incremental index failed: {e:#}")))?;

    let changed_tickets = crate::tickets::filter_ticket_yaml_paths(&porcelain_paths);
    let changed_releases = crate::ticket_releases::filter_release_yaml_paths(&porcelain_paths);
    let changed_wiki = crate::wiki::filter_wiki_yaml_paths(&porcelain_paths);
    let _ = crate::apply_incremental_tickets_releases_wiki(
        state,
        &repo_path,
        &slug,
        &changed_tickets,
        &changed_releases,
        &changed_wiki,
        &porcelain_paths,
        &git_name,
    )
    .await;

    let _ = crate::stamp_indexed_head(state, &repo_path, &slug).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::IndexFromGitStatusResponse {
        status: "ok".to_string(),
        porcelain_paths: n_porcelain,
        case_paths: n_case,
        run_paths: n_run,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 6. get_ssh_status
// ───────────────────────────────────────────────────────────────────────

pub async fn get_ssh_status() -> Result<models::SshStatusResponse, ApiError> {
    Ok(models::SshStatusResponse {
        system_key_detected: crate::ssh_key::has_system_ssh_key(),
    })
}

// ───────────────────────────────────────────────────────────────────────
// 7. connect_repo
// ───────────────────────────────────────────────────────────────────────

pub async fn connect_repo(
    state: &AppState,
    payload: models::ConnectRepoRequest,
) -> Result<models::ConnectRepoResponse, ApiError> {
    let remote_url = payload.remote_url.trim().to_string();
    if remote_url.is_empty() {
        return Err(ApiError::bad_request("Remote URL is required."));
    }

    let branch = {
        let b = payload.branch.trim();
        if b.is_empty() {
            crate::paths::GITOZA_WORK_BRANCH.to_string()
        } else {
            b.to_string()
        }
    };
    let use_ssh = payload.connection_type.trim().eq_ignore_ascii_case("ssh");

    let clone_res = if use_ssh {
        crate::clone_service::clone_remote_ssh(&state.config_dir, &remote_url, &branch).await
    } else {
        crate::clone_service::clone_remote_https(
            &state.config_dir,
            &remote_url,
            payload.personal_access_token.as_deref(),
            &branch,
        )
        .await
    };

    let (path, warnings) = match clone_res {
        Ok(v) => v,
        Err(e) => return Err(ApiError::bad_request(format!("{e:#}"))),
    };

    let token_stored = !use_ssh
        && payload
            .personal_access_token
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
    if let Err(e) = crate::repo_config::save_config(
        &state.config_dir,
        &path,
        &remote_url,
        &branch,
        token_stored,
        if use_ssh { "ssh" } else { "https" },
    ) {
        return Err(ApiError::internal(format!("{e:#}")));
    }

    let slug = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| crate::repo_config::slug_from_url(&remote_url));

    let bg = crate::clone_app_state(state);
    let slug_bg = slug.clone();
    let path_bg = path.clone();
    tokio::spawn(async move {
        let _ = crate::async_index_repo(&bg, &path_bg, &slug_bg).await;
        let _ = crate::sync_repo_git_user_cache(&bg, &slug_bg, &path_bg).await;
        let _ = crate::broadcast_refresh(&bg).await;
    });

    let mut msg =
        "Repository cloned successfully. Indexing test cases in the background.".to_string();
    if !warnings.is_empty() {
        msg.push(' ');
        msg.push_str(&warnings.join(" "));
    }

    Ok(models::ConnectRepoResponse {
        status: "ok".to_string(),
        message: msg,
        repo_path: path.to_string_lossy().to_string(),
        slug,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 7b. create_playground
// ───────────────────────────────────────────────────────────────────────

pub async fn create_playground(state: &AppState) -> Result<models::ConnectRepoResponse, ApiError> {
    let path = crate::playground_service::create_or_open_playground(&state.config_dir)
        .await
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    crate::repo_config::save_playground_config(&state.config_dir, &path)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let slug = crate::paths::PLAYGROUND_SLUG.to_string();
    let bg = crate::clone_app_state(state);
    let slug_bg = slug.clone();
    let path_bg = path.clone();
    tokio::spawn(async move {
        let _ = crate::async_index_repo(&bg, &path_bg, &slug_bg).await;
        let _ = crate::sync_repo_git_user_cache(&bg, &slug_bg, &path_bg).await;
        let _ = crate::broadcast_refresh(&bg).await;
    });

    Ok(models::ConnectRepoResponse {
        status: "ok".to_string(),
        message: "Playground ready. Indexing sample cases in the background.".to_string(),
        repo_path: path.to_string_lossy().to_string(),
        slug,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 7c. playground_save_changes
// ───────────────────────────────────────────────────────────────────────

pub async fn playground_save_changes(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::PlaygroundSaveResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    crate::workspace::require_playground_workspace(state, &slug)?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let git_lock = crate::repo_git_lock(state, &slug);
    let _git_guard = git_lock.lock().await;

    let _ = crate::pending_run_yaml::flush_all_pending_run_yaml_inner(state, &slug)
        .await
        .map_err(|e| ApiError::internal(e))?;

    let add_r = crate::git_run(&repo_path, &["add", "."])
        .await
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    if !add_r.success {
        return Err(ApiError::bad_request(
            add_r.output.chars().take(500).collect::<String>(),
        ));
    }

    let msg = match crate::build_commit_message(&repo_path).await {
        Ok(m) => m,
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };
    let Some(m) = msg else {
        if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
            let conn = conn_arc.lock().unwrap();
            let _ = crate::clear_confirm_workflow_state_db(&conn, &slug);
        }
        return Ok(models::PlaygroundSaveResponse {
            success: true,
            message: "Nothing to save.".to_string(),
        });
    };

    let commit_r = crate::git_run(&repo_path, &["commit", "-m", &m])
        .await
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    if !commit_r.success {
        return Err(ApiError::bad_request(
            commit_r.output.chars().take(500).collect::<String>(),
        ));
    }

    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::clear_confirm_workflow_state_db(&conn, &slug);
        let _ = crate::clear_pending_diffs_db(&conn, &slug);
    }

    let _ = crate::broadcast_refresh(state).await;

    Ok(models::PlaygroundSaveResponse {
        success: true,
        message: "Changes saved locally.".to_string(),
    })
}

// ───────────────────────────────────────────────────────────────────────
// 9. create_project
// ───────────────────────────────────────────────────────────────────────

pub async fn create_project(
    state: &AppState,
    payload: models::CreateProjectRequest,
) -> Result<models::CreateProjectResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let name = payload.project_name.trim().to_string();
    if !crate::is_valid_project_name(&name) {
        return Err(ApiError::bad_request(
            "Invalid project name. Use only letters, numbers, underscores, and hyphens.",
        ));
    }

    let project_dir = repo_path
        .join(crate::CASES_PREFIX.trim_end_matches('/'))
        .join(&name);
    if project_dir.exists() {
        return Err(ApiError::conflict(format!(
            "Project '{name}' already exists."
        )));
    }
    if let Err(e) = std::fs::create_dir_all(&project_dir) {
        return Err(ApiError::internal(format!(
            "Failed to create project directory: {e:#}"
        )));
    }
    if let Err(e) = crate::case_ids::init_case_project_meta(&repo_path, &name) {
        let _ = std::fs::remove_dir_all(&project_dir);
        return Err(ApiError::internal(format!(
            "Failed to initialize case project meta: {e:#}"
        )));
    }

    let project_rel = crate::file_rel_from_repo(&repo_path, &project_dir);
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::CreateProjectResponse {
        status: "ok".to_string(),
        project_name: name,
        project_path: project_rel,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 10. delete_project
// ───────────────────────────────────────────────────────────────────────

pub async fn delete_project(
    state: &AppState,
    payload: models::DeleteProjectRequest,
) -> Result<models::DeleteProjectResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let raw = payload.directory_path.trim().replace('\\', "/");
    if raw.is_empty() || raw.contains("..") || raw.starts_with('/') {
        return Err(ApiError::bad_request("directory_path is required"));
    }
    let target = repo_path.join(&raw);
    let cases_root = repo_path.join(crate::CASES_PREFIX.trim_end_matches('/'));
    if !cases_root.is_dir() {
        return Err(ApiError::not_found("Test cases root not found"));
    }
    if !target.is_dir() {
        return Err(ApiError::not_found(format!(
            "Project directory not found: {raw}"
        )));
    }
    if !crate::is_archived_project_directory_path(&raw) {
        return Err(ApiError::bad_request(
            "Only archived projects under .gitoza/test/cases/.archive/ can be deleted permanently. Archive the project first.",
        ));
    }
    let archive_root = repo_path.join(".gitoza/test/cases/.archive");
    if target.parent() != Some(archive_root.as_path()) {
        return Err(ApiError::bad_request(
            "Only a top-level archived project directory can be deleted.",
        ));
    }

    if let Err(e) = std::fs::remove_dir_all(&target) {
        return Err(ApiError::internal(format!(
            "Failed to delete project: {e:#}"
        )));
    }

    if let Err(e) = crate::reindex_cases_for_repo(state, &slug, &repo_path) {
        return Err(ApiError::internal(format!(
            "Failed to reindex cases after project delete: {e:#}"
        )));
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::DeleteProjectResponse {
        status: "ok".to_string(),
        directory_path: raw,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 11. create_folder
// ───────────────────────────────────────────────────────────────────────

pub async fn create_folder(
    state: &AppState,
    payload: models::CreateFolderRequest,
) -> Result<models::CreateFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let parent_path = payload.parent_path.trim().replace('\\', "/");
    if parent_path.is_empty() || parent_path.contains("..") || parent_path.starts_with('/') {
        return Err(ApiError::bad_request("Invalid parent_path"));
    }
    let parent_dir = repo_path.join(&parent_path);
    if !parent_dir.is_dir() {
        return Err(ApiError::not_found(format!(
            "Parent folder not found: {parent_path}"
        )));
    }

    let folder_name = payload.folder_name.trim();
    if folder_name.is_empty() {
        return Err(ApiError::bad_request("Folder name cannot be empty."));
    }
    let sanitized = crate::run_publish::sanitize_folder_name(folder_name);
    if sanitized.trim().is_empty() {
        return Err(ApiError::bad_request(
            "Invalid folder name. Use only letters, numbers, spaces, underscores, and hyphens.",
        ));
    }

    let new_folder = parent_dir.join(&sanitized);
    if new_folder.exists() {
        return Err(ApiError::conflict(format!(
            "A folder named '{sanitized}' already exists."
        )));
    }
    if let Err(e) = std::fs::create_dir_all(&new_folder) {
        return Err(ApiError::internal(format!(
            "Failed to create folder: {e:#}"
        )));
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::CreateFolderResponse {
        status: "ok".to_string(),
        folder_path: crate::file_rel_from_repo(&repo_path, &new_folder),
    })
}

// ───────────────────────────────────────────────────────────────────────
// 12. rename_folder
// ───────────────────────────────────────────────────────────────────────

pub async fn rename_folder(
    state: &AppState,
    payload: models::RenameFolderRequest,
) -> Result<models::RenameFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let folder_path = payload.folder_path.trim().replace('\\', "/");
    if folder_path.is_empty() || folder_path.contains("..") || folder_path.starts_with('/') {
        return Err(ApiError::bad_request("Invalid folder_path"));
    }
    let src = repo_path.join(&folder_path);
    if !src.is_dir() {
        return Err(ApiError::not_found(format!(
            "Folder not found: {folder_path}"
        )));
    }

    let new_name = payload.new_name.trim();
    if new_name.is_empty() {
        return Err(ApiError::bad_request("Folder name cannot be empty."));
    }
    let sanitized = crate::run_publish::sanitize_folder_name(new_name);
    if sanitized.trim().is_empty() {
        return Err(ApiError::bad_request(
            "Invalid folder name. Use only letters, numbers, spaces, underscores, and hyphens.",
        ));
    }
    if sanitized == src.file_name().and_then(|s| s.to_str()).unwrap_or_default() {
        return Ok(models::RenameFolderResponse {
            status: "ok".to_string(),
            old_path: folder_path.clone(),
            new_path: folder_path,
        });
    }

    let dest = src.parent().unwrap_or(&repo_path).join(&sanitized);
    if dest.exists() {
        return Err(ApiError::conflict(format!(
            "A folder named '{sanitized}' already exists."
        )));
    }
    if let Err(e) = std::fs::rename(&src, &dest) {
        return Err(ApiError::internal(format!(
            "Failed to rename folder: {e:#}"
        )));
    }

    let new_rel = crate::file_rel_from_repo(&repo_path, &dest);
    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    {
        let conn = conn_arc.lock().unwrap();
        if let Err(e) =
            crate::remap_case_index_paths_by_prefix(&conn, &slug, &folder_path, &new_rel)
        {
            return Err(ApiError::internal(format!(
                "Failed to remap case index after folder rename: {e:#}"
            )));
        }
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::RenameFolderResponse {
        status: "ok".to_string(),
        old_path: folder_path,
        new_path: new_rel,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 13. delete_folder
// ───────────────────────────────────────────────────────────────────────

pub async fn delete_folder(
    state: &AppState,
    payload: models::DeleteFolderRequest,
) -> Result<models::DeleteFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let folder_path = payload.folder_path.trim().replace('\\', "/");
    if folder_path.is_empty() || folder_path.contains("..") || folder_path.starts_with('/') {
        return Err(ApiError::bad_request("Invalid folder_path"));
    }
    let target = repo_path.join(&folder_path);
    if !target.is_dir() {
        return Err(ApiError::not_found(format!(
            "Folder not found: {folder_path}"
        )));
    }

    if !crate::is_archived_suite_directory_path(&folder_path) {
        return Err(ApiError::bad_request(
            "Only archived test suites under .gitoza/test/cases/.archive/ can be deleted permanently. Archive the suite first.",
        ));
    }

    if let Err(e) = std::fs::remove_dir_all(&target) {
        return Err(ApiError::internal(format!(
            "Failed to delete folder: {e:#}"
        )));
    }

    if let Err(e) = crate::reindex_cases_for_repo(state, &slug, &repo_path) {
        return Err(ApiError::internal(format!(
            "Failed to reindex cases after folder delete: {e:#}"
        )));
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::DeleteFolderResponse {
        status: "ok".to_string(),
        folder_path,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 14. create_case
// ───────────────────────────────────────────────────────────────────────

pub async fn create_case(
    state: &AppState,
    payload: models::CreateTestCaseRequest,
) -> Result<models::CreateTestCaseResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    if !payload.directory.starts_with(crate::CASES_PREFIX) || payload.directory.contains("..") {
        return Err(ApiError::bad_request(
            "Invalid directory. Must be under .gitoza/test/cases/",
        ));
    }

    let project_dir = repo_path.join(payload.directory.trim_start_matches('/'));
    if !project_dir.is_dir() {
        return Err(ApiError::not_found(format!(
            "Project directory not found: {}",
            payload.directory
        )));
    }

    let target_dir = if let Some(tf) = payload.target_folder.clone() {
        if !tf.trim().is_empty() {
            let tf = tf.trim().replace('\\', "/");
            if !tf.starts_with(&payload.directory) {
                return Err(ApiError::bad_request(
                    "Target folder must be inside the provided directory.",
                ));
            }
            let td = repo_path.join(tf.trim_start_matches('/'));
            if td.exists() && !td.is_dir() {
                return Err(ApiError::bad_request(format!(
                    "Target path is not a directory: {tf}"
                )));
            }
            if let Err(e) = std::fs::create_dir_all(&td) {
                return Err(ApiError::internal(format!(
                    "Failed to create target directory: {e:#}"
                )));
            }
            td
        } else {
            project_dir.clone()
        }
    } else {
        project_dir.clone()
    };

    let now_iso = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let review_enabled =
        crate::project_config::load_project_test_config(&repo_path).enable_review_system;
    let approve_status =
        crate::project_config::effective_approve_status_for_write(review_enabled).to_string();

    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;

    let requested = payload.case_id.trim().to_string();
    let case_id = if requested.is_empty() {
        let prefix_dir = payload
            .target_folder
            .as_ref()
            .map(|s| s.trim().replace('\\', "/"))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| payload.directory.trim().replace('\\', "/"));
        let prefix = crate::case_ids::ensure_case_prefix_for_directory(&repo_path, &prefix_dir)
            .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
        let conn = conn_arc.lock().unwrap();
        crate::case_ids::generate_unique_case_id(&conn, &repo_path, &slug, &prefix)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    } else {
        if !crate::is_valid_case_id(&requested) {
            return Err(ApiError::bad_request(
                "Invalid case_id. Use letters, numbers, underscores, and hyphens.",
            ));
        }
        let taken = {
            let conn = conn_arc.lock().unwrap();
            crate::case_ids::case_id_taken_in_repo(&conn, &repo_path, &slug, &requested)
        };
        if taken {
            return Err(ApiError::conflict(format!(
                "Case '{requested}' already exists in this repository (case or ticket)."
            )));
        }
        requested
    };

    let file_path = target_dir.join(format!("{case_id}.md"));
    if file_path.exists() {
        return Err(ApiError::conflict(format!(
            "Case '{case_id}' already exists in this location."
        )));
    }

    let assigned_to_canonical = if payload.assigned_to.trim().is_empty() {
        None
    } else {
        let conn = conn_arc.lock().unwrap();
        crate::canonicalize_assignee_for_repo(&conn, &slug, &payload.assigned_to)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };

    let mut fm: IndexMap<String, serde_yaml::Value> = IndexMap::new();
    fm.insert(
        "title".to_string(),
        serde_yaml::Value::String(payload.title.trim().to_string()),
    );

    let tags_for_yaml = crate::normalize_tags_for_storage(payload.tags.clone());
    if !tags_for_yaml.is_empty() {
        fm.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(
                tags_for_yaml
                    .into_iter()
                    .map(serde_yaml::Value::String)
                    .collect(),
            ),
        );
    }

    let status_for_yaml = payload.status.trim().to_lowercase();
    fm.insert(
        "status".to_string(),
        serde_yaml::Value::String(status_for_yaml.clone()),
    );
    let priority_for_yaml = payload.priority.trim().to_lowercase();
    fm.insert(
        "priority".to_string(),
        serde_yaml::Value::String(priority_for_yaml.clone()),
    );
    fm.insert(
        "approve_status".to_string(),
        serde_yaml::Value::String(approve_status.clone()),
    );

    let requirement_ids = crate::requirement_ids::normalize_requirement_ids({
        let mut ids = payload.requirement_ids.clone();
        if !payload.requirement_id.trim().is_empty() {
            ids.push(payload.requirement_id.clone());
        }
        ids
    });
    crate::requirement_ids::insert_requirement_ids_into_fm(&mut fm, &requirement_ids);
    if payload.automated {
        fm.insert("automated".to_string(), serde_yaml::Value::Bool(true));
    }
    if let Some(ref at) = assigned_to_canonical {
        fm.insert(
            "assigned_to".to_string(),
            serde_yaml::Value::String(at.clone()),
        );
    }
    let params_for_yaml = crate::normalize_params_for_storage(payload.params.clone());
    if !params_for_yaml.is_empty() {
        fm.insert(
            "params".to_string(),
            crate::params_to_yaml_value(&params_for_yaml),
        );
    }

    let default_body = format!(
        "# {}\n\n## Steps\n1. [Add your test steps here]\n\n## Expected Result\n[Describe the expected outcome]\n",
        payload.title.trim()
    );
    let body = payload.body.unwrap_or(default_body);

    crate::write_full_yaml(&file_path, &fm, &body)
        .map_err(|e| ApiError::internal(format!("Failed to write YAML: {e:#}")))?;

    let file_rel = crate::file_rel_from_repo(&repo_path, &file_path);
    let directory = crate::directory_from_file_path(&file_rel);

    let title_opt = {
        let t = payload.title.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    };
    let status_opt = if status_for_yaml.trim().is_empty() {
        None
    } else {
        Some(status_for_yaml)
    };
    let priority_opt = if priority_for_yaml.trim().is_empty() {
        None
    } else {
        Some(priority_for_yaml)
    };
    let req_opt = crate::requirement_ids::requirement_ids_json_for_db(&requirement_ids);
    let assigned_opt = assigned_to_canonical;

    let tags_db = crate::normalize_tags_for_storage(payload.tags.clone());
    let upsert = crate::UpsertCaseArgs {
        case_id: case_id.clone(),
        title: title_opt,
        tags: tags_db,
        status: status_opt,
        priority: priority_opt,
        file_path: file_rel.clone(),
        repo_slug: slug.clone(),
        directory,
        approve_status: approve_status.clone(),
        updated_at: Some(now_iso),
        updated_by: Some(git_name),
        approved_by: None,
        approved_at: None,
        requirement_id: req_opt,
        assigned_to: assigned_opt,
        automated: payload.automated,
        params: params_for_yaml,
    };

    {
        let conn = conn_arc.lock().unwrap();
        crate::upsert_case_db(&conn, upsert)
            .map_err(|e| ApiError::internal(format!("Failed to update SQLite index: {e:#}")))?;
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::CreateTestCaseResponse {
        status: "ok".to_string(),
        file_path: file_rel,
        case_id,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 15. batch_create_cases
// ───────────────────────────────────────────────────────────────────────

pub async fn batch_create_cases(
    state: &AppState,
    payload: models::BatchCreateTestCasesRequest,
) -> Result<models::BatchCreateTestCasesResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let mut results: Vec<models::CreateTestCaseResponse> = Vec::new();
    let mut failures: Vec<models::BatchCreateFailure> = Vec::new();

    for (i, item) in payload.cases.iter().enumerate() {
        let mut item = item.clone();
        let cid = item.case_id.trim().to_string();
        if item
            .repo
            .as_ref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
        {
            item.repo = Some(slug.clone());
        }
        match create_case(state, item).await {
            Ok(res) => results.push(res),
            Err(e) => failures.push(models::BatchCreateFailure {
                index: i,
                case_id: cid,
                detail: e.message,
            }),
        }
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::BatchCreateTestCasesResponse {
        status: "ok".to_string(),
        created_count: results.len() as i64,
        results,
        failures,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 16. rename_case
// ───────────────────────────────────────────────────────────────────────

pub async fn rename_case(
    _state: &AppState,
    _payload: models::RenameCaseRequest,
) -> Result<models::RenameCaseResponse, ApiError> {
    Err(ApiError::bad_request(
        "Case ID cannot be changed. Create a new case or edit the title instead.",
    ))
}

// ───────────────────────────────────────────────────────────────────────
// 17. move_case
// ───────────────────────────────────────────────────────────────────────

pub async fn move_case(
    state: &AppState,
    payload: models::MoveCaseRequest,
) -> Result<models::MoveCaseResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let file_path = payload.file_path.trim().replace('\\', "/");
    let target_folder = payload.target_folder.trim().replace('\\', "/");

    if file_path.is_empty()
        || target_folder.is_empty()
        || file_path.contains("..")
        || target_folder.contains("..")
        || file_path.starts_with('/')
        || target_folder.starts_with('/')
    {
        return Err(ApiError::bad_request("Invalid file_path/target_folder"));
    }
    if !file_path.starts_with(crate::CASES_PREFIX)
        || file_path == crate::CASES_PREFIX.trim_end_matches('/')
    {
        return Err(ApiError::bad_request(
            "Case must be under .gitoza/test/cases/",
        ));
    }
    if !target_folder.starts_with(crate::CASES_PREFIX)
        || target_folder == crate::CASES_PREFIX.trim_end_matches('/')
    {
        return Err(ApiError::bad_request(
            "Target folder must be under .gitoza/test/cases/",
        ));
    }
    if crate::is_archived_file_path(&file_path) || crate::is_archived_file_path(&target_folder) {
        return Err(ApiError::bad_request(
            "Moving cases into or out of archived paths is not supported.",
        ));
    }

    let src = repo_path.join(&file_path);
    if !src.is_file() {
        return Err(ApiError::not_found(format!(
            "Case file not found: {file_path}"
        )));
    }

    let suffix = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(suffix.as_str(), "md") {
        return Err(ApiError::bad_request("Not a YAML case file."));
    }

    let target_dir = repo_path.join(&target_folder);
    if !target_dir.is_dir() {
        return Err(ApiError::not_found(format!(
            "Target folder not found: {target_folder}"
        )));
    }

    let file_name = src
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| "page.md".into());
    let dest = target_dir.join(file_name);
    if dest == src {
        return Ok(models::MoveCaseResponse {
            status: "ok".to_string(),
            old_path: file_path.clone(),
            new_path: file_path,
        });
    }
    if dest.exists() {
        return Err(ApiError::conflict(format!(
            "A case file named '{}' already exists in the target folder.",
            src.file_name().unwrap_or_default().to_string_lossy()
        )));
    }

    std::fs::rename(&src, &dest)
        .map_err(|e| ApiError::internal(format!("Failed to move case file: {e:#}")))?;

    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    {
        let conn = conn_arc.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM test_cases WHERE repo_slug = ?",
            [slug.as_str()],
        );
        let _ = crate::index_cases_from_yaml(&conn, &repo_path, &slug);
    }

    let new_rel = dest
        .strip_prefix(&repo_path)
        .unwrap_or(&dest)
        .to_string_lossy()
        .replace('\\', "/");

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::MoveCaseResponse {
        status: "ok".to_string(),
        old_path: file_path,
        new_path: new_rel,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 18. delete_case
// ───────────────────────────────────────────────────────────────────────

pub async fn delete_case(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let file_path = file_path.trim_start_matches('/').trim().replace('\\', "/");
    if file_path.is_empty() || file_path.contains("..") || file_path.starts_with('/') {
        return Err(ApiError::bad_request("Invalid file_path"));
    }
    if !file_path.starts_with(crate::CASES_PREFIX)
        || file_path == crate::CASES_PREFIX.trim_end_matches('/')
    {
        return Err(ApiError::bad_request(
            "Case must be under .gitoza/test/cases/",
        ));
    }
    if !crate::is_archived_file_path(&file_path) {
        return Err(ApiError::bad_request(
            "Only archived test cases can be deleted permanently. Archive the case first.",
        ));
    }

    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found(format!(
            "Case file not found: {file_path}"
        )));
    }

    std::fs::remove_file(&full_path)
        .map_err(|e| ApiError::internal(format!("Failed to delete case file: {e:#}")))?;

    if let Some(parent) = full_path.parent() {
        let parent_rel = crate::file_rel_from_repo(&repo_path, parent);
        prune_empty_case_dirs_upward(&repo_path, &parent_rel);
    }

    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM test_cases WHERE repo_slug = ? AND file_path = ?",
            [slug.as_str(), file_path.as_str()],
        );
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(json!({ "status": "ok", "file_path": file_path }))
}

// ───────────────────────────────────────────────────────────────────────
// 19. approve_case
// ───────────────────────────────────────────────────────────────────────

pub async fn approve_case(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
    payload: models::ApproveCaseRequest,
) -> Result<serde_json::Value, ApiError> {
    let mut file_path = file_path.trim_start_matches('/').trim().replace('\\', "/");
    if file_path.ends_with("/approve") {
        file_path = file_path.trim_end_matches("/approve").to_string();
    }
    if file_path.is_empty() {
        return Err(ApiError::bad_request("Invalid file_path"));
    }
    if !file_path.starts_with(crate::CASES_PREFIX)
        || file_path == crate::CASES_PREFIX.trim_end_matches('/')
    {
        return Err(ApiError::bad_request(
            "Case must be under .gitoza/test/cases/",
        ));
    }

    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found(format!(
            "Case file not found: {file_path}"
        )));
    }

    let existing = match crate::read_full_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => return Err(ApiError::internal(format!("Failed to read YAML: {e:#}"))),
    };

    let approve_status = match payload.approve_status {
        models::ApproveStatus::Approved => "approved",
        models::ApproveStatus::Rejected => "rejected",
    }
    .to_string();

    let now_iso = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;

    let mut fm: IndexMap<String, serde_yaml::Value> = IndexMap::new();
    if let Some(title) = existing.title.clone() {
        fm.insert("title".to_string(), serde_yaml::Value::String(title));
    }
    if !existing.tags.is_empty() {
        let tags = crate::normalize_tags_for_storage(existing.tags.clone());
        fm.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(tags.into_iter().map(serde_yaml::Value::String).collect()),
        );
    }
    if let Some(status) = existing.status.clone() {
        fm.insert(
            "status".to_string(),
            serde_yaml::Value::String(status.to_lowercase()),
        );
    }
    if let Some(priority) = existing.priority.clone() {
        fm.insert(
            "priority".to_string(),
            serde_yaml::Value::String(priority.to_lowercase()),
        );
    }
    fm.insert(
        "approve_status".to_string(),
        serde_yaml::Value::String(approve_status.clone()),
    );
    fm.insert(
        "approved_by".to_string(),
        serde_yaml::Value::String(git_name.clone()),
    );
    fm.insert(
        "approved_at".to_string(),
        serde_yaml::Value::String(now_iso.clone()),
    );
    crate::requirement_ids::insert_requirement_ids_into_fm(&mut fm, &existing.requirement_ids);
    if existing.automated {
        fm.insert("automated".to_string(), serde_yaml::Value::Bool(true));
    }
    crate::insert_comments_into_fm(&mut fm, &existing.comments);

    let _ = crate::write_yaml_from_existing_raw(&full_path, &existing.raw, &fm, &existing.body);

    let directory = crate::directory_from_file_path(&file_path);
    let case_id = full_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let tags_db = crate::normalize_tags_for_storage(existing.tags.clone());
    let status_opt = existing
        .status
        .clone()
        .map(|s| s.to_lowercase())
        .filter(|s| !s.trim().is_empty());
    let priority_opt = existing
        .priority
        .clone()
        .map(|s| s.to_lowercase())
        .filter(|s| !s.trim().is_empty());

    let upsert = crate::UpsertCaseArgs {
        case_id,
        title: existing.title.clone(),
        tags: tags_db,
        status: status_opt,
        priority: priority_opt,
        file_path: file_path.clone(),
        repo_slug: slug.clone(),
        directory,
        approve_status,
        updated_at: existing.updated_at.clone(),
        updated_by: existing.updated_by.clone(),
        approved_by: Some(git_name),
        approved_at: Some(now_iso),
        requirement_id: crate::requirement_ids::requirement_ids_json_for_db(
            &existing.requirement_ids,
        ),
        assigned_to: existing.assigned_to.clone(),
        automated: existing.automated,
        params: crate::normalize_params_for_storage(existing.params.clone()),
    };

    let response = if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::upsert_case_db(&conn, upsert);
        if let Ok(Some(mut d)) = crate::read_full_yaml(&full_path) {
            d.file_path = file_path.clone();
            crate::apply_case_audit_from_db(&conn, &slug, &file_path, &mut d);
            serde_json::to_value(d).unwrap_or_default()
        } else {
            // YAML re-read failed; still return in-memory detail with SQLite audit.
            let mut existing = existing;
            existing.file_path = file_path.clone();
            crate::apply_case_audit_from_db(&conn, &slug, &file_path, &mut existing);
            serde_json::to_value(existing).unwrap_or_default()
        }
    } else if let Ok(Some(mut d)) = crate::read_full_yaml(&full_path) {
        d.file_path = file_path;
        serde_json::to_value(d).unwrap_or_default()
    } else {
        serde_json::to_value(existing).unwrap_or_default()
    };

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(response)
}

// ───────────────────────────────────────────────────────────────────────
// 20. archive_case
// ───────────────────────────────────────────────────────────────────────

/// Move one active case YAML to its archived path. Does not reindex, broadcast, or prune.
fn archive_case_on_disk(
    repo_path: &std::path::Path,
    file_path: &str,
    reason: &str,
    _git_name: &str,
) -> Result<String, ApiError> {
    let file_path = file_path.trim().replace('\\', "/");
    if file_path.is_empty() {
        return Err(ApiError::bad_request("file_path is required"));
    }
    if !file_path.starts_with(crate::CASES_PREFIX)
        || file_path == crate::CASES_PREFIX.trim_end_matches('/')
    {
        return Err(ApiError::bad_request(
            "Case must be under .gitoza/test/cases/",
        ));
    }
    if crate::is_archived_file_path(&file_path) {
        return Err(ApiError::bad_request(
            "Case is already under .archive/ and cannot be archived again.",
        ));
    }

    let new_path = crate::to_archive_path(&file_path).map_err(ApiError::bad_request)?;

    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found(format!(
            "Case file not found: {file_path}"
        )));
    }

    let existing = match crate::read_full_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => {
            return Err(ApiError::unprocessable(format!(
                "Could not parse YAML: {file_path}"
            )))
        }
        Err(e) => return Err(ApiError::internal(format!("Failed to read YAML: {e:#}"))),
    };

    let body = existing.body.clone();
    let existing_raw = existing.raw.clone();
    let now_iso = Utc::now().to_rfc3339();

    let priority_val = existing
        .priority
        .clone()
        .unwrap_or_else(|| "medium".to_string());
    let status_val = existing
        .status
        .clone()
        .unwrap_or_else(|| "active".to_string())
        .trim()
        .to_lowercase();
    let mut fm: IndexMap<String, serde_yaml::Value> = IndexMap::new();
    fm.insert(
        "title".to_string(),
        serde_yaml::Value::String(existing.title.clone().unwrap_or_default()),
    );
    fm.insert(
        "tags".to_string(),
        serde_yaml::Value::Sequence(
            existing
                .tags
                .iter()
                .cloned()
                .map(serde_yaml::Value::String)
                .collect(),
        ),
    );
    fm.insert("status".to_string(), serde_yaml::Value::String(status_val));
    fm.insert(
        "priority".to_string(),
        serde_yaml::Value::String(priority_val.to_lowercase()),
    );
    fm.insert(
        "approve_status".to_string(),
        serde_yaml::Value::String(existing.approve_status.clone()),
    );
    fm.insert(
        "archived_at".to_string(),
        serde_yaml::Value::String(now_iso.clone()),
    );
    fm.insert(
        "archived_reason".to_string(),
        serde_yaml::Value::String(reason.to_string()),
    );
    if let Some(v) = existing.approved_by.clone() {
        fm.insert("approved_by".to_string(), serde_yaml::Value::String(v));
    }
    if let Some(v) = existing.approved_at.clone() {
        fm.insert("approved_at".to_string(), serde_yaml::Value::String(v));
    }
    crate::insert_comments_into_fm(&mut fm, &existing.comments);

    let dest = repo_path.join(&new_path);
    if let Some(par) = dest.parent() {
        if let Err(e) = std::fs::create_dir_all(par) {
            return Err(ApiError::internal(format!(
                "Failed to create archived directory: {e:#}"
            )));
        }
    }
    if dest.exists() {
        return Err(ApiError::conflict(format!(
            "Target already exists: {new_path}"
        )));
    }

    crate::write_yaml_from_existing_raw(&dest, &existing_raw, &fm, &body)
        .map_err(|e| ApiError::internal(format!("Failed to write archived YAML: {e:#}")))?;

    if let Err(e) = std::fs::remove_file(&full_path) {
        let _ = std::fs::remove_file(&dest);
        return Err(ApiError::internal(format!(
            "Failed to remove original file: {e:#}"
        )));
    }

    Ok(new_path)
}

fn active_parent_rel_for_prune(
    repo_path: &std::path::Path,
    active_file_path: &str,
) -> Option<String> {
    let full_path = repo_path.join(active_file_path);
    full_path
        .parent()
        .map(|parent| crate::file_rel_from_repo(repo_path, parent))
}

async fn archive_active_paths_batch(
    state: &AppState,
    slug: &str,
    repo_path: &std::path::Path,
    file_paths: Vec<String>,
    reason: &str,
    extra_prune_roots: &[String],
) -> models::ArchiveCasesResponse {
    let git_name = crate::resolve_git_user_name_cached(state, repo_path, slug).await;
    let mut archived_paths = Vec::new();
    let mut failed_paths = Vec::new();
    let mut prune_dirs: Vec<String> = Vec::new();

    for file_path in file_paths {
        let fp = file_path.trim().replace('\\', "/");
        if fp.is_empty() {
            continue;
        }
        match archive_case_on_disk(repo_path, &fp, reason, &git_name) {
            Ok(new_path) => {
                if let Some(parent_rel) = active_parent_rel_for_prune(repo_path, &fp) {
                    prune_dirs.push(parent_rel);
                }
                archived_paths.push(new_path);
            }
            Err(_) => failed_paths.push(fp),
        }
    }

    for root in extra_prune_roots {
        let norm = normalize_case_dir_rel(root);
        if !norm.is_empty() {
            prune_dirs.push(norm);
        }
    }

    prune_dirs.sort_by(|a, b| b.len().cmp(&a.len()));
    prune_dirs.dedup();

    if !archived_paths.is_empty() {
        for dir_rel in prune_dirs {
            prune_empty_case_dirs_upward(repo_path, &dir_rel);
        }
        reindex_cases_and_broadcast_with_local_stamp(
            state,
            slug,
            repo_path,
            &archived_paths,
            &git_name,
        )
        .await;
    }

    models::ArchiveCasesResponse {
        status: if failed_paths.is_empty() {
            "ok".to_string()
        } else {
            "partial".to_string()
        },
        archived_paths,
        failed_paths,
    }
}

pub async fn archive_case(
    state: &AppState,
    repo: Option<String>,
    payload: models::ArchiveCaseRequest,
) -> Result<models::ArchiveCaseResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let file_path = payload.file_path.trim().replace('\\', "/");
    if file_path.is_empty() {
        return Err(ApiError::bad_request("file_path is required"));
    }

    let reason = payload.reason.trim();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let new_path = archive_case_on_disk(&repo_path, &file_path, reason, &git_name)?;

    if let Some(parent_rel) = active_parent_rel_for_prune(&repo_path, &file_path) {
        prune_empty_case_dirs_upward(&repo_path, &parent_rel);
    }

    reindex_cases_and_broadcast_with_local_stamp(
        state,
        &slug,
        &repo_path,
        &[new_path.clone()],
        &git_name,
    )
    .await;

    Ok(models::ArchiveCaseResponse {
        status: "ok".to_string(),
        file_path: new_path,
    })
}

pub async fn archive_cases(
    state: &AppState,
    repo: Option<String>,
    payload: models::ArchiveCasesRequest,
) -> Result<models::ArchiveCasesResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let file_paths: Vec<String> = payload
        .file_paths
        .iter()
        .map(|p| p.trim().replace('\\', "/"))
        .filter(|p| !p.is_empty())
        .collect();

    if file_paths.is_empty() {
        return Err(ApiError::bad_request("file_paths must not be empty"));
    }

    Ok(archive_active_paths_batch(
        state,
        &slug,
        &repo_path,
        file_paths,
        payload.reason.trim(),
        &[],
    )
    .await)
}

// ───────────────────────────────────────────────────────────────────────
// 21. restore_case
// ───────────────────────────────────────────────────────────────────────

/// Move one archived case YAML to its active path. Does not reindex, broadcast, or prune.
fn restore_case_on_disk(
    repo_path: &std::path::Path,
    file_path: &str,
    _git_name: &str,
) -> Result<String, ApiError> {
    let file_path = file_path.trim().replace('\\', "/");
    if file_path.is_empty() {
        return Err(ApiError::bad_request("file_path is required"));
    }
    if !file_path.starts_with(crate::CASES_PREFIX)
        || file_path == crate::CASES_PREFIX.trim_end_matches('/')
    {
        return Err(ApiError::bad_request(
            "Case must be under .gitoza/test/cases/",
        ));
    }
    if !crate::is_archived_file_path(&file_path) {
        return Err(ApiError::bad_request(
            "Case is not under .archive/ and cannot be restored.",
        ));
    }

    let new_path = crate::to_active_path(&file_path).map_err(ApiError::bad_request)?;

    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found(format!(
            "Case file not found: {file_path}"
        )));
    }

    let existing = match crate::read_full_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => {
            return Err(ApiError::unprocessable(format!(
                "Could not parse YAML: {file_path}"
            )))
        }
        Err(e) => return Err(ApiError::internal(format!("Failed to read YAML: {e:#}"))),
    };

    let body = existing.body.clone();
    let existing_raw = existing.raw.clone();
    let status_val = existing
        .status
        .clone()
        .unwrap_or_else(|| "active".to_string())
        .trim()
        .to_lowercase();
    let priority_val = existing
        .priority
        .clone()
        .unwrap_or_else(|| "medium".to_string())
        .trim()
        .to_lowercase();

    let mut fm: IndexMap<String, serde_yaml::Value> = IndexMap::new();
    fm.insert(
        "title".to_string(),
        serde_yaml::Value::String(existing.title.clone().unwrap_or_default()),
    );
    fm.insert(
        "tags".to_string(),
        serde_yaml::Value::Sequence(
            existing
                .tags
                .iter()
                .cloned()
                .map(serde_yaml::Value::String)
                .collect(),
        ),
    );
    fm.insert("status".to_string(), serde_yaml::Value::String(status_val));
    fm.insert(
        "priority".to_string(),
        serde_yaml::Value::String(priority_val),
    );
    fm.insert(
        "approve_status".to_string(),
        serde_yaml::Value::String(existing.approve_status.clone()),
    );
    if let Some(v) = existing.approved_by.clone() {
        fm.insert("approved_by".to_string(), serde_yaml::Value::String(v));
    }
    if let Some(v) = existing.approved_at.clone() {
        fm.insert("approved_at".to_string(), serde_yaml::Value::String(v));
    }
    crate::requirement_ids::insert_requirement_ids_into_fm(&mut fm, &existing.requirement_ids);
    if existing.automated {
        fm.insert("automated".to_string(), serde_yaml::Value::Bool(true));
    }
    crate::insert_comments_into_fm(&mut fm, &existing.comments);

    let dest = repo_path.join(&new_path);
    if let Some(par) = dest.parent() {
        if let Err(e) = std::fs::create_dir_all(par) {
            return Err(ApiError::internal(format!(
                "Failed to create target directory: {e:#}"
            )));
        }
    }
    if dest.exists() {
        return Err(ApiError::conflict(format!(
            "Target already exists: {new_path}"
        )));
    }

    crate::write_yaml_from_existing_raw(&dest, &existing_raw, &fm, &body)
        .map_err(|e| ApiError::internal(format!("Failed to write restored YAML: {e:#}")))?;
    if let Err(e) = std::fs::remove_file(&full_path) {
        let _ = std::fs::remove_file(&dest);
        return Err(ApiError::internal(format!(
            "Failed to remove archived file: {e:#}"
        )));
    }

    Ok(new_path)
}

async fn reindex_cases_and_broadcast_with_local_stamp(
    state: &AppState,
    slug: &str,
    repo_path: &std::path::Path,
    stamp_paths: &[String],
    git_name: &str,
) {
    if let Ok(conn_arc) = crate::open_repo_db(state, slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = conn.execute("DELETE FROM test_cases WHERE repo_slug = ?", [slug]);
        let _ = crate::index_cases_from_yaml(&conn, repo_path, slug);
        if !stamp_paths.is_empty() && !git_name.trim().is_empty() {
            let now = Utc::now().to_rfc3339();
            let _ = crate::stamp_case_audit_in_db(&conn, slug, stamp_paths, git_name, &now);
        }
    }
    crate::mark_workplace_editing_best_effort(state, slug, repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
}

fn archive_parent_rel_for_prune(
    repo_path: &std::path::Path,
    archived_file_path: &str,
) -> Option<String> {
    let full_path = repo_path.join(archived_file_path);
    full_path
        .parent()
        .map(|parent| crate::file_rel_from_repo(repo_path, parent))
}

async fn restore_archived_paths_batch(
    state: &AppState,
    slug: &str,
    repo_path: &std::path::Path,
    file_paths: Vec<String>,
    extra_prune_roots: &[String],
) -> models::RestoreCasesResponse {
    let git_name = crate::resolve_git_user_name_cached(state, repo_path, slug).await;
    let mut restored_paths = Vec::new();
    let mut failed_paths = Vec::new();
    let mut prune_dirs: Vec<String> = Vec::new();

    for file_path in file_paths {
        let fp = file_path.trim().replace('\\', "/");
        if fp.is_empty() {
            continue;
        }
        match restore_case_on_disk(repo_path, &fp, &git_name) {
            Ok(new_path) => {
                if let Some(parent_rel) = archive_parent_rel_for_prune(repo_path, &fp) {
                    prune_dirs.push(parent_rel);
                }
                restored_paths.push(new_path);
            }
            Err(_) => failed_paths.push(fp),
        }
    }

    for root in extra_prune_roots {
        let norm = normalize_case_dir_rel(root);
        if !norm.is_empty() {
            prune_dirs.push(norm);
        }
    }

    prune_dirs.sort_by(|a, b| b.len().cmp(&a.len()));
    prune_dirs.dedup();

    if !restored_paths.is_empty() {
        for dir_rel in prune_dirs {
            prune_empty_case_dirs_upward(repo_path, &dir_rel);
        }
        reindex_cases_and_broadcast_with_local_stamp(
            state,
            slug,
            repo_path,
            &restored_paths,
            &git_name,
        )
        .await;
    }

    models::RestoreCasesResponse {
        status: if failed_paths.is_empty() {
            "ok".to_string()
        } else {
            "partial".to_string()
        },
        restored_paths,
        failed_paths,
    }
}

pub async fn restore_case(
    state: &AppState,
    repo: Option<String>,
    payload: models::RestoreCaseRequest,
) -> Result<models::RestoreCaseResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let file_path = payload.file_path.trim().replace('\\', "/");
    if file_path.is_empty() {
        return Err(ApiError::bad_request("file_path is required"));
    }

    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let new_path = restore_case_on_disk(&repo_path, &file_path, &git_name)?;

    if let Some(parent_rel) = archive_parent_rel_for_prune(&repo_path, &file_path) {
        prune_empty_case_dirs_upward(&repo_path, &parent_rel);
    }

    reindex_cases_and_broadcast_with_local_stamp(
        state,
        &slug,
        &repo_path,
        &[new_path.clone()],
        &git_name,
    )
    .await;

    Ok(models::RestoreCaseResponse {
        status: "ok".to_string(),
        file_path: new_path,
    })
}

pub async fn restore_cases(
    state: &AppState,
    repo: Option<String>,
    payload: models::RestoreCasesRequest,
) -> Result<models::RestoreCasesResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let file_paths: Vec<String> = payload
        .file_paths
        .iter()
        .map(|p| p.trim().replace('\\', "/"))
        .filter(|p| !p.is_empty())
        .collect();

    if file_paths.is_empty() {
        return Err(ApiError::bad_request("file_paths must not be empty"));
    }

    Ok(restore_archived_paths_batch(state, &slug, &repo_path, file_paths, &[]).await)
}

pub async fn restore_folder(
    state: &AppState,
    repo: Option<String>,
    payload: models::RestoreFolderRequest,
) -> Result<models::RestoreFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let directory_path = payload.directory_path.trim().replace('\\', "/");
    if directory_path.is_empty() {
        return Err(ApiError::bad_request("directory_path is required"));
    }
    if !crate::is_archived_file_path(&directory_path) {
        return Err(ApiError::bad_request(
            "Folder must be under .gitoza/test/cases/.archive/",
        ));
    }

    let case_paths = collect_archived_case_yaml_paths_under(&repo_path, &directory_path);
    if case_paths.is_empty() {
        return Err(ApiError::bad_request("No archived cases found in folder"));
    }

    let batch = restore_archived_paths_batch(
        state,
        &slug,
        &repo_path,
        case_paths,
        if directory_path.is_empty() {
            &[]
        } else {
            std::slice::from_ref(&directory_path)
        },
    )
    .await;

    if batch.failed_paths.is_empty() {
        prune_empty_case_dirs_upward(&repo_path, &directory_path);
    }

    Ok(models::RestoreFolderResponse {
        status: batch.status,
        restored_paths: batch.restored_paths,
        failed_paths: batch.failed_paths,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 21b. archive_folder
// ───────────────────────────────────────────────────────────────────────

fn collect_archived_case_yaml_paths_under(
    repo_path: &std::path::Path,
    directory_rel: &str,
) -> Vec<String> {
    let mut out = Vec::new();
    let root = repo_path.join(directory_rel);
    if !root.is_dir() {
        return out;
    }
    let ignore: std::collections::HashSet<&str> =
        crate::CASE_TREE_IGNORE_DIRS.iter().copied().collect();
    let mut stack = vec![root];
    while let Some(dir) = stack.pop() {
        let parent_rel = crate::file_rel_from_repo(repo_path, &dir);
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if crate::should_skip_case_scan_dir(&parent_rel, &name, &ignore) {
                    continue;
                }
                stack.push(p);
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
            let rel = crate::file_rel_from_repo(repo_path, &p);
            if crate::is_archived_file_path(&rel) {
                out.push(rel);
            }
        }
    }
    out.sort();
    out
}

fn collect_active_case_yaml_paths_under(
    repo_path: &std::path::Path,
    directory_rel: &str,
) -> Vec<String> {
    let mut out = Vec::new();
    let root = repo_path.join(directory_rel);
    if !root.is_dir() {
        return out;
    }
    let ignore: std::collections::HashSet<&str> =
        crate::CASE_TREE_IGNORE_DIRS.iter().copied().collect();
    let mut stack = vec![root];
    while let Some(dir) = stack.pop() {
        let parent_rel = crate::file_rel_from_repo(repo_path, &dir);
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if crate::should_skip_case_scan_dir(&parent_rel, &name, &ignore) {
                    continue;
                }
                stack.push(p);
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
            let rel = crate::file_rel_from_repo(repo_path, &p);
            if !crate::is_archived_file_path(&rel) {
                out.push(rel);
            }
        }
    }
    out.sort();
    out
}

fn normalize_case_dir_rel(dir_rel: &str) -> String {
    dir_rel
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn is_under_cases_root(dir_rel: &str) -> bool {
    let norm = normalize_case_dir_rel(dir_rel);
    let cases_root = crate::CASES_PREFIX.trim_end_matches('/');
    !norm.is_empty() && norm.starts_with(cases_root) && norm != cases_root
}

fn is_directory_empty(dir_abs: &std::path::Path) -> bool {
    std::fs::read_dir(dir_abs)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false)
}

fn subtree_contains_case_yaml(
    repo_path: &std::path::Path,
    dir_abs: &std::path::Path,
    ignore: &HashSet<&str>,
) -> bool {
    let mut stack = vec![dir_abs.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let parent_rel = crate::file_rel_from_repo(repo_path, &dir);
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if crate::should_skip_case_scan_dir(&parent_rel, &name, ignore) {
                    continue;
                }
                stack.push(p);
                continue;
            }
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if ext == "md" {
                return true;
            }
        }
    }
    false
}

fn prune_empty_descendants(
    repo_path: &std::path::Path,
    dir_abs: &std::path::Path,
    ignore: &HashSet<&str>,
) {
    let Ok(entries) = std::fs::read_dir(dir_abs) else {
        return;
    };
    let mut child_dirs = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let parent_rel = crate::file_rel_from_repo(repo_path, dir_abs);
        if crate::should_skip_case_scan_dir(&parent_rel, &name, ignore) {
            continue;
        }
        child_dirs.push(p);
    }
    for child in child_dirs {
        prune_empty_descendants(repo_path, &child, ignore);
        if !subtree_contains_case_yaml(repo_path, &child, ignore) && is_directory_empty(&child) {
            let _ = std::fs::remove_dir(&child);
        }
    }
}

fn remove_empty_dirs_upward(repo_path: &std::path::Path, mut dir_rel: &str) {
    let cases_root = repo_path.join(crate::CASES_PREFIX.trim_end_matches('/'));
    while !dir_rel.is_empty() {
        let abs = repo_path.join(dir_rel);
        if abs == cases_root {
            break;
        }
        if !is_directory_empty(&abs) {
            break;
        }
        let _ = std::fs::remove_dir(&abs);
        dir_rel = match dir_rel.rsplit_once('/') {
            Some((parent, _)) => parent,
            None => break,
        };
    }
}

/// Remove empty suite/project directories after archive, delete, or restore.
fn prune_empty_case_dirs_upward(repo_path: &std::path::Path, dir_rel: &str) {
    let dir_rel = normalize_case_dir_rel(dir_rel);
    if !is_under_cases_root(&dir_rel) {
        return;
    }
    let ignore: HashSet<&str> = crate::CASE_TREE_IGNORE_DIRS.iter().copied().collect();
    let start_abs = repo_path.join(&dir_rel);
    if start_abs.is_dir() {
        prune_empty_descendants(repo_path, &start_abs, &ignore);
    }
    remove_empty_dirs_upward(repo_path, &dir_rel);
}

pub async fn archive_folder(
    state: &AppState,
    repo: Option<String>,
    payload: models::ArchiveFolderRequest,
) -> Result<models::ArchiveFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let directory_path = payload.directory_path.trim().replace('\\', "/");
    if directory_path.is_empty() {
        return Err(ApiError::bad_request("directory_path is required"));
    }
    if !directory_path.starts_with(crate::CASES_PREFIX)
        || directory_path == crate::CASES_PREFIX.trim_end_matches('/')
    {
        return Err(ApiError::bad_request(
            "Folder must be under .gitoza/test/cases/",
        ));
    }
    if crate::is_archived_file_path(&directory_path) {
        return Err(ApiError::bad_request(
            "Cannot archive a folder under .archive/",
        ));
    }

    let reason = payload.reason.trim().to_string();
    let case_paths = collect_active_case_yaml_paths_under(&repo_path, &directory_path);
    if case_paths.is_empty() {
        return Err(ApiError::bad_request("No active cases found in folder"));
    }

    let batch = archive_active_paths_batch(
        state,
        &slug,
        &repo_path,
        case_paths,
        &reason,
        std::slice::from_ref(&directory_path),
    )
    .await;

    Ok(models::ArchiveFolderResponse {
        status: batch.status,
        archived_paths: batch.archived_paths,
        failed_paths: batch.failed_paths,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 22. reindex_cases
// ───────────────────────────────────────────────────────────────────────

pub async fn reindex_cases(
    state: &AppState,
    repo: Option<String>,
    stamp_external: Option<bool>,
) -> Result<Vec<models::YamlIndexStats>, ApiError> {
    let stamp_external = stamp_external.unwrap_or(false);
    let slugs: Vec<String> = if let Some(s) = repo.clone() {
        let s = s.trim().to_string();
        if !s.is_empty() {
            vec![s]
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    let slugs = if !slugs.is_empty() {
        slugs
    } else {
        let repos_dir = state.config_dir.join("repos");
        let mut out = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&repos_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() && p.join(".git").is_dir() {
                    out.push(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
        out
    };

    let mut stats: Vec<models::YamlIndexStats> = Vec::new();
    for slug in slugs {
        let repo_path = match crate::resolve_repo_path(state, Some(&slug)) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let audit = if stamp_external {
            let git_lock = crate::repo_git_lock(state, &slug);
            let _git_guard = git_lock.lock().await;
            let _ = crate::sync_repo_git_user_cache(state, &slug, &repo_path).await;
            let porcelain_paths = match crate::git_status_porcelain_paths(&repo_path).await {
                Ok(paths) => paths,
                Err(_) => continue,
            };
            let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
            crate::audit_source_for_ide_refresh(
                &repo_path,
                &porcelain_paths,
                &porcelain_paths,
                &[
                    ".gitoza/test/cases",
                    ".gitoza/test/runs",
                    ".gitoza/tasks/tickets",
                    ".gitoza/wiki",
                ],
                &git_name,
            )
        } else {
            crate::AuditStampSource::for_cases_full(&repo_path)
        };

        let conn_arc = match crate::open_repo_db(state, &slug) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let indexer = crate::CaseEntityIndexer {
            conn: conn_arc.clone(),
            audit,
        };
        let res = crate::file_truth_framework::index_entities_full(&repo_path, &slug, &indexer);
        let indexed = res.as_ref().map(|s| s.indexed).unwrap_or(0);
        let errors = res.as_ref().map(|s| s.errors).unwrap_or(0);
        let removed = res.as_ref().map(|s| s.removed).unwrap_or(0);

        {
            let conn = conn_arc.lock().unwrap();
            let _ = crate::tickets::reindex_tickets_for_repo(&conn, &repo_path, &slug);
            let _ = crate::ticket_releases::reindex_releases_for_repo(&conn, &repo_path, &slug);
            let _ = crate::wiki::reindex_wiki_for_repo(&conn, &repo_path, &slug);
        }
        let _ = crate::stamp_indexed_head(state, &repo_path, &slug).await;

        stats.push(models::YamlIndexStats {
            repo_slug: slug,
            indexed,
            errors,
            removed,
            directories: 0,
        });
    }

    let _ = crate::broadcast_refresh(state).await;
    Ok(stats)
}

// ───────────────────────────────────────────────────────────────────────
// 22b. get_git_user_name
// ───────────────────────────────────────────────────────────────────────

pub async fn get_git_user_name(
    state: &AppState,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let user_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    Ok(serde_json::json!({ "user_name": user_name }))
}

// ───────────────────────────────────────────────────────────────────────
// 22c. git profile (global identity + cache sync)
// ───────────────────────────────────────────────────────────────────────

async fn build_git_profile_response(
    state: &AppState,
    repo: Option<&str>,
    sync_caches: bool,
) -> Result<models::GitProfileResponse, ApiError> {
    let repos_synced = if sync_caches {
        crate::sync_all_repo_git_user_caches(state)
            .await
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    } else {
        0
    };

    let global_user_name = crate::git_global_user_name().await.ok().flatten();
    let global_user_email = crate::git_global_user_email().await.ok().flatten();

    let mut effective_user_name = None;
    let mut effective_user_email = None;
    let mut local_user_name = None;
    let mut local_user_email = None;
    let mut cached_user_name = None;
    let mut cached_user_email = None;
    let mut has_local_override = false;

    if let Some(slug) = repo {
        if let Ok(repo_path) = crate::resolve_repo_path(state, Some(slug)) {
            let raw_local_name = crate::git_local_user_name(&repo_path).await.ok().flatten();
            let raw_local_email = crate::git_local_user_email(&repo_path).await.ok().flatten();
            effective_user_name = crate::git_effective_user_name(&repo_path)
                .await
                .ok()
                .flatten();
            effective_user_email = crate::git_effective_user_email(&repo_path)
                .await
                .ok()
                .flatten();
            local_user_name = crate::local_identity_for_display(
                raw_local_name,
                &global_user_name,
                &effective_user_name,
            );
            local_user_email = crate::local_identity_for_display(
                raw_local_email,
                &global_user_email,
                &effective_user_email,
            );
            if let Ok(conn_arc) = crate::open_repo_db(state, slug) {
                let conn = conn_arc.lock().unwrap();
                if let Ok((name, email)) = crate::get_cached_git_user_db(&conn, slug) {
                    cached_user_name = name;
                    cached_user_email = email;
                }
            }
            has_local_override = local_user_name.is_some() || local_user_email.is_some();
        }
    }

    Ok(models::GitProfileResponse {
        global_user_name,
        global_user_email,
        local_user_name,
        local_user_email,
        effective_user_name,
        effective_user_email,
        cached_user_name,
        cached_user_email,
        has_local_override,
        repos_synced,
    })
}

fn resolve_optional_active_slug(state: &AppState, repo: Option<String>) -> Option<String> {
    if let Some(r) = repo {
        let trimmed = r.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    crate::resolve_repo_slug(state, None).ok()
}

pub async fn get_git_profile(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::GitProfileResponse, ApiError> {
    let active_slug = resolve_optional_active_slug(state, repo);
    build_git_profile_response(state, active_slug.as_deref(), true).await
}

pub async fn set_git_profile(
    state: &AppState,
    repo: Option<String>,
    payload: models::SetGitProfileRequest,
) -> Result<models::GitProfileResponse, ApiError> {
    let global_name = crate::validate_git_identity_field(
        payload.global_user_name.as_deref().unwrap_or(""),
        crate::GitIdentityField::Name,
    )
    .map_err(ApiError::bad_request)?;
    let global_email = crate::validate_git_identity_field(
        payload.global_user_email.as_deref().unwrap_or(""),
        crate::GitIdentityField::Email,
    )
    .map_err(ApiError::bad_request)?;
    let local_name = crate::validate_git_identity_field(
        payload.local_user_name.as_deref().unwrap_or(""),
        crate::GitIdentityField::Name,
    )
    .map_err(ApiError::bad_request)?;
    let local_email = crate::validate_git_identity_field(
        payload.local_user_email.as_deref().unwrap_or(""),
        crate::GitIdentityField::Email,
    )
    .map_err(ApiError::bad_request)?;

    crate::apply_git_global_identity_name(global_name.as_deref())
        .await
        .map_err(|e| ApiError::bad_request(format!("Could not write ~/.gitconfig: {e:#}")))?;
    crate::apply_git_global_identity_email(global_email.as_deref())
        .await
        .map_err(|e| ApiError::bad_request(format!("Could not write ~/.gitconfig: {e:#}")))?;

    let _ = crate::sync_all_repo_git_user_caches(state)
        .await
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let explicit_repo = repo
        .as_deref()
        .or(payload.repo.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let active_slug = match crate::resolve_repo_slug(state, explicit_repo) {
        Ok(slug) => Some(slug),
        Err(e) => {
            if explicit_repo.is_some() {
                return Err(ApiError::bad_request(format!("{e:#}")));
            }
            None
        }
    };

    if let Some(slug) = active_slug {
        let repo_path = crate::resolve_repo_path(state, Some(&slug))
            .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
        crate::apply_git_local_identity_name(&repo_path, local_name.as_deref())
            .await
            .map_err(|e| {
                ApiError::bad_request(format!("Could not write repo git config: {e:#}"))
            })?;
        crate::apply_git_local_identity_email(&repo_path, local_email.as_deref())
            .await
            .map_err(|e| {
                ApiError::bad_request(format!("Could not write repo git config: {e:#}"))
            })?;
        crate::sync_repo_git_user_cache(state, &slug, &repo_path)
            .await
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
        build_git_profile_response(state, Some(&slug), false).await
    } else {
        build_git_profile_response(state, None, false).await
    }
}

pub async fn sync_git_user_cache(
    state: &AppState,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    crate::sync_repo_git_user_cache(state, &slug, &repo_path)
        .await
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(serde_json::json!({ "status": "ok" }))
}

// ───────────────────────────────────────────────────────────────────────
// 22b. project test config
// ───────────────────────────────────────────────────────────────────────

pub async fn get_project_test_config(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::ProjectTestConfigResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let cfg = crate::project_config::load_project_test_config(&repo_path);
    Ok(models::ProjectTestConfigResponse {
        enable_review_system: cfg.enable_review_system,
    })
}

pub async fn set_project_test_config(
    state: &AppState,
    repo: Option<String>,
    payload: models::SetProjectTestConfigRequest,
) -> Result<models::ProjectTestConfigResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    crate::project_config::save_project_test_config(&repo_path, payload.enable_review_system)
        .map_err(|e| ApiError::internal(format!("Failed to save project config: {e:#}")))?;
    let _ = crate::project_config::sync_feature_flags_from_disk(state, &slug, &repo_path);

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::ProjectTestConfigResponse {
        enable_review_system: payload.enable_review_system,
    })
}

pub async fn set_project_feature_flags(
    state: &AppState,
    repo: Option<String>,
    payload: models::SetProjectFeatureFlagsRequest,
) -> Result<models::ProjectFeatureFlagsResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    crate::project_config::save_project_feature_flags(
        &repo_path,
        payload.enable_review_system,
        payload.modules.clone(),
    )
    .map_err(|e| ApiError::internal(format!("Failed to save project config: {e:#}")))?;
    let _ = crate::project_config::sync_feature_flags_from_disk(state, &slug, &repo_path);

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::ProjectFeatureFlagsResponse {
        enable_review_system: payload.enable_review_system,
        modules: payload.modules,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 22c. project sync config (asset storage)
// ───────────────────────────────────────────────────────────────────────

pub fn project_sync_config_to_response(
    state: &AppState,
    repo_slug: &str,
    cfg: &crate::project_sync_config::ProjectSyncConfig,
) -> models::ProjectSyncConfigResponse {
    let aws_credentials_configured = crate::sync_secrets::sync_secrets_configured(state);
    let local_assets_path = if cfg.provider_type_normalized() == "local_path" {
        crate::local_sync_paths::effective_local_assets_path(state, repo_slug, cfg)
            .map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    };
    models::ProjectSyncConfigResponse {
        provider_type: cfg.provider_type.clone(),
        local_assets_path,
        s3_bucket: cfg.s3_bucket.clone(),
        s3_region: cfg.s3_region.clone(),
        s3_prefix: cfg.s3_prefix.clone(),
        s3_endpoint: cfg.s3_endpoint.clone(),
        aws_credentials_configured,
        credentials_storage: crate::sync_secrets::credentials_storage_kind(state)
            .map(str::to_string),
    }
}

pub async fn get_project_sync_config(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::ProjectSyncConfigResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    if let Err(e) = crate::local_sync_paths::migrate_legacy_local_assets_path_if_needed(
        state, &slug, &repo_path,
    ) {
        tracing::warn!(repo = %slug, "Failed to migrate local_path profile to machine-local storage: {e}");
    }
    let cfg = crate::project_sync_config::load_project_sync_config(&repo_path);
    Ok(project_sync_config_to_response(state, &slug, &cfg))
}

pub async fn set_project_sync_config(
    state: &AppState,
    repo: Option<String>,
    payload: models::SetProjectSyncConfigRequest,
) -> Result<models::ProjectSyncConfigResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let provider = payload.provider_type.trim().to_ascii_lowercase();
    let mut new_global_profile: Option<crate::sync_secrets::GlobalS3Profile> = None;
    let mut local_path_to_save: Option<String> = None;
    match provider.as_str() {
        "" => {}
        "local_path" => {
            let path = payload
                .local_assets_path
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    ApiError::bad_request("local_assets_path is required for local_path provider")
                })?;
            local_path_to_save = Some(path.to_string());
        }
        "cloud_api" => {
            if payload
                .s3_bucket
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .is_none()
            {
                return Err(ApiError::bad_request(
                    "s3_bucket is required for cloud_api provider",
                ));
            }
            if payload
                .s3_region
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .is_none()
            {
                return Err(ApiError::bad_request(
                    "s3_region is required for cloud_api provider",
                ));
            }

            let access_key = payload
                .access_key_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let secret_key = payload
                .secret_access_key
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());

            match (access_key, secret_key) {
                (Some(ak), Some(sk)) => {
                    new_global_profile = Some(crate::sync_secrets::GlobalS3Profile {
                        access_key_id: ak.to_string(),
                        secret_access_key: sk.to_string(),
                    });
                }
                (None, None) => {
                    if !crate::sync_secrets::sync_secrets_configured(state) {
                        return Err(ApiError::bad_request(
                            "AWS credentials required: provide access_key_id and secret_access_key",
                        ));
                    }
                }
                _ => {
                    return Err(ApiError::bad_request(
                        "Provide both access_key_id and secret_access_key, or leave both blank to keep existing credentials",
                    ));
                }
            }
        }
        other => {
            return Err(ApiError::bad_request(format!(
                "Invalid provider_type: {other}"
            )));
        }
    }

    let cfg = crate::project_sync_config::project_sync_config_from_set_request(&payload);

    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    crate::project_sync_config::save_project_sync_config(&repo_path, &cfg)
        .map_err(|e| ApiError::internal(format!("Failed to save project sync config: {e:#}")))?;

    if provider == "local_path" {
        let Some(path) = local_path_to_save.as_deref() else {
            return Err(ApiError::bad_request(
                "local_assets_path is required for local_path provider",
            ));
        };
        crate::local_sync_paths::save_local_assets_path(state, &slug, path).map_err(|e| {
            ApiError::internal(format!("Failed to save local sync folder path: {e}"))
        })?;
    } else {
        crate::local_sync_paths::clear_local_assets_path(state, &slug).map_err(|e| {
            ApiError::internal(format!("Failed to clear local sync folder path: {e}"))
        })?;
    }

    if provider == "cloud_api" {
        let blueprint = crate::sync_secrets::GlobalS3Blueprint {
            s3_bucket: cfg.s3_bucket.clone().unwrap_or_default().trim().to_string(),
            s3_region: cfg.s3_region.clone().unwrap_or_default().trim().to_string(),
            s3_prefix: cfg.s3_prefix.clone(),
            s3_endpoint: cfg.s3_endpoint.clone(),
        };
        let profile = if let Some(p) = new_global_profile {
            p
        } else {
            crate::sync_secrets::load_global_sync_secrets(state)
                .map(|s| crate::sync_secrets::GlobalS3Profile {
                    access_key_id: s.access_key_id,
                    secret_access_key: s.secret_access_key,
                })
                .map_err(|e| ApiError::internal(format!("Failed to load global S3 profile: {e}")))?
        };
        crate::sync_secrets::save_global_s3_cache(state, &profile, &blueprint)
            .await
            .map_err(|e| ApiError::internal(format!("Failed to save global S3 cache: {e}")))?;
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    let saved = crate::project_sync_config::load_project_sync_config(&repo_path);
    Ok(project_sync_config_to_response(state, &slug, &saved))
}

pub async fn verify_and_resolve_s3_state(
    state: &AppState,
    repo: Option<String>,
    activate: Option<bool>,
) -> Result<models::S3VerifyResolveResponse, ApiError> {
    crate::s3_broker::verify_and_resolve_s3_state(state, repo, activate.unwrap_or(false)).await
}

pub async fn link_repo_to_global_s3_profile(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::S3VerifyResolveResponse, ApiError> {
    crate::s3_broker::link_repo_to_global_s3_profile(state, repo).await
}

pub async fn probe_global_s3_onboarding(
    state: &AppState,
) -> Result<models::ProbeGlobalS3OnboardingResponse, ApiError> {
    match crate::sync_secrets::probe_global_s3_onboarding(state).await {
        Ok((available, global_blueprint)) => Ok(models::ProbeGlobalS3OnboardingResponse {
            available,
            global_blueprint,
        }),
        Err(e) => Err(ApiError::bad_request(e)),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 23. get_repo_status
// ───────────────────────────────────────────────────────────────────────

pub async fn get_repo_status(
    state: &AppState,
    repo: Option<String>,
    sync: Option<bool>,
) -> Result<models::RepoStatusResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    if sync.unwrap_or(true) && !crate::workspace::is_playground_slug(state, &slug) {
        let git_lock = crate::repo_git_lock(state, &slug);
        let _git_guard = git_lock.lock().await;
        let _ = crate::git_fetch_origin(&repo_path).await;
        let gate = crate::collect_repo_pull_gate(state, &slug, &repo_path)
            .await
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
        if crate::should_pull_for_repo(&gate) {
            if let Ok(true) = crate::pull_if_behind(&repo_path).await {
                let _ = crate::sync_index_after_pull(state, &repo_path, &slug).await;
                let _ = crate::broadcast_refresh(state).await;
            }
        }
        let git = crate::read_repo_git_snapshot(&repo_path)
            .await
            .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
        return crate::build_repo_status_response(state, &slug, &repo_path, git)
            .await
            .map_err(|e| ApiError::bad_request(format!("{e:#}")));
    }

    if sync.unwrap_or(true) && crate::workspace::is_playground_slug(state, &slug) {
        let git = {
            let git_lock = crate::repo_git_lock(state, &slug);
            let _guard = git_lock.lock().await;
            crate::read_repo_git_snapshot(&repo_path)
                .await
                .map_err(|e| ApiError::bad_request(format!("{e:#}")))?
        };
        return crate::build_repo_status_response(state, &slug, &repo_path, git)
            .await
            .map_err(|e| ApiError::bad_request(format!("{e:#}")));
    }

    crate::read_repo_status(state, &slug, &repo_path)
        .await
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))
}

// ───────────────────────────────────────────────────────────────────────
// 24. get_dashboard_summary
// ───────────────────────────────────────────────────────────────────────

pub async fn get_dashboard_summary(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::DashboardSummaryResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let db_rows = crate::dashboard_projects_from_db(&conn.lock().unwrap(), &slug)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let mut indexed_dirs: HashSet<String> = HashSet::new();
    for r in &db_rows {
        indexed_dirs.insert(r.directory.clone());
    }
    let mut total_cases = 0i64;
    let mut total_high = 0i64;
    let mut total_automated = 0i64;
    let mut projects: Vec<models::DashboardProjectDetail> = Vec::new();
    for r in db_rows {
        total_cases += r.total_test_cases;
        total_high += r.high_count;
        total_automated += r.automated_count;
        projects.push(crate::build_dashboard_project_detail(
            &r.directory,
            r.total_test_cases,
            r.high_count,
            r.medium_count,
            r.low_count,
            r.automated_count,
            r.latest_modified.clone(),
        ));
    }
    for rel in crate::discover_case_project_rel_paths(&repo_path) {
        if !indexed_dirs.contains(&rel) {
            projects.push(crate::build_dashboard_project_detail(
                &rel, 0, 0, 0, 0, 0, None,
            ));
        }
    }
    projects.sort_by(|a, b| a.project_path.cmp(&b.project_path));
    let total_projects = projects.len() as i64;
    let last_sync = crate::git_head_commit_time(&repo_path).await.ok().flatten();
    Ok(models::DashboardSummaryResponse {
        global_stats: models::DashboardGlobalStats {
            total_test_cases: total_cases,
            total_projects,
            high_priority_focus: total_high,
            automated_count: total_automated,
            last_repository_sync: last_sync,
        },
        projects,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 25. get_repository_tree
// ───────────────────────────────────────────────────────────────────────

pub async fn get_repository_tree(
    state: &AppState,
    repo: Option<String>,
    project: Option<String>,
    folder_prefix: Option<String>,
    depth: Option<String>,
    archive_mode: Option<bool>,
) -> Result<Vec<models::RepositoryTreeNode>, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();

    let effective_prefix = folder_prefix
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            project
                .as_deref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        });

    let tree_depth = crate::repository_tree::parse_repository_tree_depth(depth.as_deref());

    let archive_flag = archive_mode.unwrap_or(false);
    let tree = crate::repository_tree::build_repository_tree_scoped(
        &conn,
        &repo_path,
        &slug,
        effective_prefix.as_deref(),
        tree_depth,
        archive_flag,
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(tree)
}

// ───────────────────────────────────────────────────────────────────────
// 26. list_cases
// ───────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn list_cases(
    state: &AppState,
    repo: Option<String>,
    search: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    tag: Option<String>,
    directory: Option<String>,
    directories: Option<String>,
    path_prefix: Option<String>,
    approve_status: Option<String>,
    updated_by: Option<String>,
    assigned_to: Option<String>,
    requirement_id: Option<String>,
    automated: Option<bool>,
    param_filters: Option<String>,
    include_archived: Option<bool>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<models::YamlCaseListResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let offset = offset.unwrap_or(0).max(0);
    let include_archived = include_archived.unwrap_or(false);
    let archived_only = status
        .as_deref()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("archived");
    let exclude_archived = !include_archived && !archived_only;

    let dirs_list = directories
        .as_deref()
        .map(|s| {
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|v| !v.is_empty());

    let sort_by = sort_by.unwrap_or_else(|| "case_id".to_string());
    let sort_dir = sort_dir.unwrap_or_else(|| "asc".to_string());

    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let assigned_to_filter =
        crate::resolve_assigned_to_query_filter(assigned_to.as_deref(), &git_name);
    if assigned_to_filter == crate::AssignedToQueryFilter::NoMatch {
        return Ok(models::YamlCaseListResponse {
            total: 0,
            items: vec![],
            limit,
            offset,
        });
    }
    let assigned_to = match assigned_to_filter {
        crate::AssignedToQueryFilter::Match(s) => Some(s),
        crate::AssignedToQueryFilter::None | crate::AssignedToQueryFilter::NoMatch => None,
    };

    let param_filters_parsed = match param_filters
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        None => None,
        Some(raw) => parse_param_filters_json(raw).map_err(|e| ApiError::bad_request(e))?,
    };

    let (items, total) = crate::query_cases_db(
        &conn.lock().unwrap(),
        &slug,
        crate::QueryCasesArgs {
            search,
            status: if archived_only { None } else { status },
            priority,
            tag,
            directory: if dirs_list.is_some() || path_prefix.is_some() {
                None
            } else {
                directory
            },
            directories: dirs_list,
            path_prefix,
            approve_status,
            updated_by,
            assigned_to,
            requirement_id,
            automated,
            param_filters: param_filters_parsed,
            exclude_archived,
            sort_by,
            sort_dir,
            limit,
            offset,
        },
        archived_only,
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    Ok(models::YamlCaseListResponse {
        total,
        items,
        limit,
        offset,
    })
}

#[derive(serde::Deserialize)]
struct ParamFilterEntry {
    key: String,
    value: String,
}

fn parse_param_filters_json(raw: &str) -> Result<Option<Vec<(String, String)>>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let entries: Vec<ParamFilterEntry> =
        serde_json::from_str(trimmed).map_err(|e| format!("Invalid param_filters JSON: {e}"))?;
    let mut out = Vec::new();
    for entry in entries {
        let key = entry.key.trim().to_string();
        let value = entry.value.trim().to_string();
        if key.is_empty() || value.is_empty() {
            continue;
        }
        out.push((key, value));
    }
    if out.is_empty() {
        Ok(None)
    } else {
        Ok(Some(out))
    }
}

// ───────────────────────────────────────────────────────────────────────
// 27. get_case_filters
// ───────────────────────────────────────────────────────────────────────

pub async fn get_case_filters(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::YamlCaseFilters, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn.lock().unwrap();
    let statuses = crate::distinct_values(&conn, &slug, "status").unwrap_or_default();
    let priorities = crate::distinct_values(&conn, &slug, "priority").unwrap_or_default();
    let directories = crate::distinct_values(&conn, &slug, "directory").unwrap_or_default();
    let tags = crate::all_tags(&conn, &slug).unwrap_or_default();
    let assigned_to = crate::dedupe_assignees_case_insensitive(
        crate::distinct_values(&conn, &slug, "assigned_to").unwrap_or_default(),
    );
    let updated_by = crate::dedupe_assignees_case_insensitive(
        crate::distinct_values(&conn, &slug, "updated_by").unwrap_or_default(),
    );
    let param_keys = crate::all_param_keys(&conn, &slug).unwrap_or_default();
    let param_values_by_key = crate::all_param_values_by_key(&conn, &slug).unwrap_or_default();
    Ok(models::YamlCaseFilters {
        statuses,
        priorities,
        tags,
        directories,
        assigned_to,
        updated_by,
        param_keys,
        param_values_by_key,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 27b. search_run_cases
// ───────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn search_run_cases(
    state: &AppState,
    repo: Option<String>,
    search: Option<String>,
    tag: Option<String>,
    priority: Option<String>,
    requirement_id: Option<String>,
    executed_by: Option<String>,
    assigned_to: Option<String>,
    automated: Option<bool>,
    result: Option<String>,
    include_archived: Option<bool>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<models::RunCaseListResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let offset = offset.unwrap_or(0).max(0);
    let include_archived = include_archived.unwrap_or(false);

    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let assigned_to_filter =
        crate::resolve_assigned_to_query_filter(assigned_to.as_deref(), &git_name);
    if assigned_to_filter == crate::AssignedToQueryFilter::NoMatch {
        return Ok(models::RunCaseListResponse {
            total: 0,
            items: vec![],
            limit,
            offset,
        });
    }
    let assigned_to = match assigned_to_filter {
        crate::AssignedToQueryFilter::Match(s) => Some(s),
        crate::AssignedToQueryFilter::None | crate::AssignedToQueryFilter::NoMatch => None,
    };

    let (items, total) = crate::query_run_cases_db(
        &conn.lock().unwrap(),
        &slug,
        crate::QueryRunCasesArgs {
            run_id: None,
            folder_prefix: None,
            search,
            tag,
            priority,
            requirement_id,
            executed_by,
            assigned_to,
            automated,
            result,
            include_archived,
            per_run_order: false,
            limit,
            offset,
        },
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    Ok(models::RunCaseListResponse {
        total,
        items,
        limit,
        offset,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 27c. get_run_case_filters
// ───────────────────────────────────────────────────────────────────────

pub async fn get_run_case_filters(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::RunCaseFilters, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn.lock().unwrap();
    let priorities = crate::distinct_run_case_values(&conn, &slug, "priority").unwrap_or_default();
    let requirement_ids =
        crate::distinct_run_case_values(&conn, &slug, "requirement_id").unwrap_or_default();
    let executed_by =
        crate::distinct_run_case_values(&conn, &slug, "executed_by").unwrap_or_default();
    let assigned_to =
        crate::distinct_effective_run_case_assignees(&conn, &slug).unwrap_or_default();
    let tags = crate::run_case_all_tags(&conn, &slug).unwrap_or_default();
    Ok(models::RunCaseFilters {
        priorities,
        tags,
        requirement_ids,
        executed_by,
        assigned_to,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 28. get_case_detail
// ───────────────────────────────────────────────────────────────────────

pub async fn get_case_detail(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
) -> Result<models::YamlCaseDetail, ApiError> {
    let file_path = file_path.trim_start_matches('/').to_string();
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let full_path = repo_path.join(&file_path);
    match crate::read_full_yaml(&full_path) {
        Ok(Some(mut d)) => {
            d.file_path = file_path.clone();
            if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
                let conn = conn_arc.lock().unwrap();
                crate::apply_case_audit_from_db(&conn, &slug, &file_path, &mut d);
            }
            Ok(d)
        }
        Ok(None) => Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => Err(ApiError::not_found(format!("{e:#}"))),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 29. update_case
// ───────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn update_case(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
    title: String,
    tags: Vec<String>,
    status: String,
    priority: String,
    body: Option<String>,
    requirement_ids: Option<Vec<String>>,
    assigned_to: Option<String>,
    params: Option<BTreeMap<String, String>>,
    automated: Option<bool>,
) -> Result<serde_json::Value, ApiError> {
    let file_path =
        crate::validate_case_file_path_for_write(&file_path).map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found("Case file not found"));
    }

    let existing = match crate::read_full_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };

    let incoming_title = title.trim().to_string();
    let incoming_priority = priority.trim().to_lowercase();
    let incoming_status = status.trim().to_lowercase();
    let incoming_tags = crate::normalize_tags_for_storage(tags.clone());
    let existing_tags = crate::normalize_tags_for_storage(existing.tags.clone());
    let incoming_requirement_ids = match requirement_ids {
        Some(v) => crate::requirement_ids::normalize_requirement_ids(v),
        None => existing.requirement_ids.clone(),
    };
    let existing_requirement_ids =
        crate::requirement_ids::normalize_requirement_ids(existing.requirement_ids.clone());
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let mut incoming_assigned_to =
        crate::resolve_optional_string_patch(assigned_to.as_deref(), &existing.assigned_to);
    if let Some(ref raw) = incoming_assigned_to {
        let conn = conn_arc.lock().unwrap();
        incoming_assigned_to = crate::canonicalize_assignee_for_repo(&conn, &slug, raw)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    }
    let existing_assigned_to = existing
        .assigned_to
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let incoming_params = match params {
        Some(p) => crate::normalize_params_for_storage(p),
        None => crate::normalize_params_for_storage(existing.params.clone()),
    };
    let existing_params = crate::normalize_params_for_storage(existing.params.clone());
    let incoming_body = body.clone().unwrap_or_else(|| existing.body.clone());
    let incoming_automated = automated.unwrap_or(existing.automated);
    let is_noop = incoming_title
        == existing
            .title
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string()
        && incoming_priority
            == existing
                .priority
                .clone()
                .unwrap_or_else(|| "medium".to_string())
                .trim()
                .to_lowercase()
        && incoming_status
            == existing
                .status
                .clone()
                .unwrap_or_else(|| "active".to_string())
                .trim()
                .to_lowercase()
        && incoming_tags == existing_tags
        && incoming_requirement_ids == existing_requirement_ids
        && crate::assignees_equal_ignore_case(
            incoming_assigned_to.as_deref(),
            existing_assigned_to.as_deref(),
        )
        && incoming_params == existing_params
        && incoming_automated == existing.automated
        && incoming_body.trim() == existing.body.trim();
    if is_noop {
        return match crate::read_full_yaml(&full_path) {
            Ok(Some(mut d)) => {
                d.file_path = file_path.clone();
                crate::apply_case_audit_from_db(
                    &conn_arc.lock().unwrap(),
                    &slug,
                    &file_path,
                    &mut d,
                );
                Ok(serde_json::to_value(d).unwrap_or_default())
            }
            _ => Ok(json!({ "status": "ok" })),
        };
    }

    let now = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let review_enabled =
        crate::project_config::load_project_test_config(&repo_path).enable_review_system;
    let approve_status =
        crate::project_config::effective_approve_status_for_write(review_enabled).to_string();
    let approved_by = existing.approved_by.clone();
    let approved_at = existing.approved_at.clone();
    let mut fm = IndexMap::<String, serde_yaml::Value>::new();
    fm.insert(
        "title".to_string(),
        serde_yaml::Value::String(incoming_title.clone()),
    );
    fm.insert(
        "tags".to_string(),
        serde_yaml::Value::Sequence(
            tags.iter()
                .map(|t| serde_yaml::Value::String(t.trim().to_string()))
                .filter(|v| match v {
                    serde_yaml::Value::String(s) => !s.is_empty(),
                    _ => true,
                })
                .collect(),
        ),
    );
    fm.insert(
        "status".to_string(),
        serde_yaml::Value::String(incoming_status.clone()),
    );
    fm.insert(
        "priority".to_string(),
        serde_yaml::Value::String(incoming_priority.clone()),
    );
    fm.insert(
        "approve_status".to_string(),
        serde_yaml::Value::String(approve_status.clone()),
    );
    if let Some(v) = approved_by.clone() {
        fm.insert("approved_by".to_string(), serde_yaml::Value::String(v));
    }
    if let Some(v) = approved_at.clone() {
        fm.insert("approved_at".to_string(), serde_yaml::Value::String(v));
    }
    crate::requirement_ids::insert_requirement_ids_into_fm(&mut fm, &incoming_requirement_ids);
    if let Some(v) = incoming_assigned_to.clone() {
        fm.insert("assigned_to".to_string(), serde_yaml::Value::String(v));
    }
    if incoming_automated {
        fm.insert("automated".to_string(), serde_yaml::Value::Bool(true));
    }
    if !incoming_params.is_empty() {
        fm.insert(
            "params".to_string(),
            crate::params_to_yaml_value(&incoming_params),
        );
    }
    crate::insert_comments_into_fm(&mut fm, &existing.comments);

    let fm = crate::reconcile_desired_front_matter_with_disk(&existing.raw, &fm);
    let fm_unchanged = crate::front_matter_matches_desired(&existing.raw, &fm);
    crate::write_yaml_update_preserving_order(
        &full_path,
        &existing.raw,
        &fm,
        &incoming_body,
        fm_unchanged,
    )
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let case_id = full_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let directory = crate::directory_from_file_path(&file_path);
    crate::upsert_case_db(
        &conn_arc.lock().unwrap(),
        crate::UpsertCaseArgs {
            case_id,
            title: Some(incoming_title),
            tags,
            status: Some(incoming_status),
            priority: Some(incoming_priority),
            file_path: file_path.clone(),
            repo_slug: slug.clone(),
            directory,
            approve_status,
            updated_at: Some(now.clone()),
            updated_by: Some(git_name.clone()),
            approved_by,
            approved_at,
            requirement_id: crate::requirement_ids::requirement_ids_json_for_db(
                &incoming_requirement_ids,
            ),
            assigned_to: incoming_assigned_to,
            automated: incoming_automated,
            params: incoming_params,
        },
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    // Content-only write: no broadcast_refresh — IPC response + frontend patchCaseInCache
    // update col 2 in place; structural endpoints still broadcast.

    match crate::read_full_yaml(&full_path) {
        Ok(Some(mut d)) => {
            d.file_path = file_path;
            d.updated_at = Some(now);
            d.updated_by = Some(git_name);
            Ok(serde_json::to_value(d).unwrap_or_default())
        }
        _ => Ok(json!({ "status": "ok" })),
    }
}

async fn patch_case_requirement_ids(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
    ticket_id: String,
    unlink: bool,
) -> Result<models::YamlCaseDetail, ApiError> {
    let file_path =
        crate::validate_case_file_path_for_write(&file_path).map_err(ApiError::bad_request)?;
    let ticket_id = ticket_id.trim().to_string();
    if ticket_id.is_empty() {
        return Err(ApiError::bad_request("ticket_id is required"));
    }
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found("Case file not found"));
    }

    let mut existing = match crate::read_full_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };
    let next = if unlink {
        crate::requirement_ids::remove_requirement_id(existing.requirement_ids.clone(), &ticket_id)
    } else {
        crate::requirement_ids::add_requirement_id(existing.requirement_ids.clone(), &ticket_id)
    };
    if next == existing.requirement_ids {
        existing.file_path = file_path;
        return Ok(existing);
    }

    existing.requirement_ids = next;
    let fm = crate::case_detail_to_front_matter(&existing);
    crate::write_yaml_from_existing_raw(&full_path, &existing.raw, &fm, &existing.body)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let now = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let directory = crate::directory_from_file_path(&file_path);
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    crate::upsert_case_db(
        &conn_arc.lock().unwrap(),
        crate::UpsertCaseArgs {
            case_id: existing.case_id.clone(),
            title: existing.title.clone(),
            tags: crate::normalize_tags_for_storage(existing.tags.clone()),
            status: existing.status.clone(),
            priority: existing.priority.clone(),
            file_path: file_path.clone(),
            repo_slug: slug.clone(),
            directory,
            approve_status: existing.approve_status.clone(),
            updated_at: Some(now.clone()),
            updated_by: Some(git_name.clone()),
            approved_by: existing.approved_by.clone(),
            approved_at: existing.approved_at.clone(),
            requirement_id: crate::requirement_ids::requirement_ids_json_for_db(
                &existing.requirement_ids,
            ),
            assigned_to: existing.assigned_to.clone(),
            automated: existing.automated,
            params: crate::normalize_params_for_storage(existing.params.clone()),
        },
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    existing.file_path = file_path;
    existing.updated_at = Some(now);
    existing.updated_by = Some(git_name);
    Ok(existing)
}

pub async fn link_case_requirement(
    state: &AppState,
    file_path: String,
    ticket_id: String,
    repo: Option<String>,
) -> Result<models::YamlCaseDetail, ApiError> {
    patch_case_requirement_ids(state, file_path, repo, ticket_id, false).await
}

pub async fn unlink_case_requirement(
    state: &AppState,
    file_path: String,
    ticket_id: String,
    repo: Option<String>,
) -> Result<models::YamlCaseDetail, ApiError> {
    patch_case_requirement_ids(state, file_path, repo, ticket_id, true).await
}

// ───────────────────────────────────────────────────────────────────────
// 29b. post_case_comment
// ───────────────────────────────────────────────────────────────────────

pub async fn post_case_comment(
    state: &AppState,
    file_path: String,
    text: String,
    repo: Option<String>,
) -> Result<models::YamlCaseDetail, ApiError> {
    let file_path =
        crate::validate_case_file_path_for_write(&file_path).map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found("Case file not found"));
    }

    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(ApiError::bad_request("Comment text cannot be empty"));
    }

    let mut existing = match crate::read_full_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };

    let now = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    existing.comments.push(models::Comment {
        author: git_name.clone(),
        timestamp: now,
        text,
    });

    let fm = crate::case_detail_to_front_matter(&existing);
    crate::write_yaml_from_existing_raw(&full_path, &existing.raw, &fm, &existing.body)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    // Content-only write: no broadcast_refresh — frontend updates case detail from IPC response.

    existing.file_path = file_path;
    Ok(existing)
}

// ───────────────────────────────────────────────────────────────────────
// 29c. delete_case_comment
// ───────────────────────────────────────────────────────────────────────

pub async fn delete_case_comment(
    state: &AppState,
    file_path: String,
    index: usize,
    repo: Option<String>,
) -> Result<models::YamlCaseDetail, ApiError> {
    let file_path =
        crate::validate_case_file_path_for_write(&file_path).map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found("Case file not found"));
    }

    let mut existing = match crate::read_full_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };

    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    if let Err(e) = crate::remove_comment_at_index(&mut existing.comments, index, &git_name) {
        return Err(comment_delete_error(e));
    }

    let fm = crate::case_detail_to_front_matter(&existing);
    crate::write_yaml_from_existing_raw(&full_path, &existing.raw, &fm, &existing.body)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    // Content-only write: no broadcast_refresh — frontend updates case detail from IPC response.

    existing.file_path = file_path;
    Ok(existing)
}

// ───────────────────────────────────────────────────────────────────────
// 30. list_case_templates
// ───────────────────────────────────────────────────────────────────────

pub async fn list_case_templates(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::CaseTemplateListResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let dir = repo_path.join(".gitoza/test/templates");
    let mut items: Vec<models::CaseTemplateItem> = vec![];
    if dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let p = e.path();
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
                let name_os = match p.file_name() {
                    Some(n) => n.to_string_lossy().to_string(),
                    None => continue,
                };
                let rel = format!("{}{name_os}", crate::TEMPLATES_PREFIX);
                let stem = p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                items.push(models::CaseTemplateItem {
                    file_path: rel,
                    stem,
                });
            }
        }
    }
    items.sort_by(|a, b| a.stem.cmp(&b.stem));
    Ok(models::CaseTemplateListResponse { items })
}

// ───────────────────────────────────────────────────────────────────────
// 31. get_case_template_content
// ───────────────────────────────────────────────────────────────────────

pub async fn get_case_template_content(
    state: &AppState,
    repo: Option<String>,
    file_path: String,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let file_path =
        crate::validate_template_file_path(file_path.trim()).map_err(ApiError::bad_request)?;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found(format!(
            "Template not found: {file_path}"
        )));
    }
    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| ApiError::internal(format!("Failed to read template: {e:#}")))?;
    Ok(json!({ "content": content }))
}

// ───────────────────────────────────────────────────────────────────────
// 32. save_case_template
// ───────────────────────────────────────────────────────────────────────

pub async fn save_case_template(
    state: &AppState,
    repo: Option<String>,
    payload: models::SaveCaseTemplateRequest,
) -> Result<models::SaveCaseTemplateResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let raw_name = payload.name.trim();
    if raw_name.is_empty() {
        return Err(ApiError::bad_request("Template name is required"));
    }

    let stem = crate::run_publish::sanitize_filename(raw_name);
    let rel = format!("{}{stem}.md", crate::TEMPLATES_PREFIX);
    if crate::validate_template_file_path(&rel).is_err() {
        return Err(ApiError::bad_request("Invalid template name"));
    }

    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let full_path = repo_path.join(&rel);
    if full_path.exists() {
        return Err(ApiError::conflict(format!(
            "A template named \"{stem}.md\" already exists. Choose a different name."
        )));
    }

    crate::atomic_write_file(&full_path, payload.body.as_bytes())
        .map_err(|e| ApiError::internal(format!("Failed to write template: {e:#}")))?;

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::SaveCaseTemplateResponse { file_path: rel })
}

// ───────────────────────────────────────────────────────────────────────
// 33. capture_pending_changes
// ───────────────────────────────────────────────────────────────────────

pub async fn capture_pending_changes(
    state: &AppState,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    crate::workspace::require_remote_git_workspace(state, &slug)?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let git_lock = crate::repo_git_lock(state, &slug);
    let _git_guard = git_lock.lock().await;
    let _ = crate::pending_run_yaml::flush_all_pending_run_yaml_inner(state, &slug)
        .await
        .map_err(|e| ApiError::internal(e))?;
    let add_r = crate::git_run(&repo_path, &["add", "."])
        .await
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    if !add_r.success {
        return Err(ApiError::bad_request(
            add_r.output.chars().take(500).collect::<String>(),
        ));
    }
    let all_changes = crate::git_cached_name_status_changes(&repo_path)
        .await
        .unwrap_or_default();
    let files: Vec<String> = all_changes.iter().map(|c| c.path.clone()).collect();
    let changes = crate::case_changes_from_name_status(&all_changes);
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    {
        let conn_guard = conn.lock().unwrap();
        crate::upsert_pending_diff_file_list_db(&conn_guard, &slug, &all_changes)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    }
    Ok(
        serde_json::to_value(models::WorkflowDiffFilesResponse { files, changes })
            .unwrap_or_default(),
    )
}

// ───────────────────────────────────────────────────────────────────────
// 34. clear_pending_changes
// ───────────────────────────────────────────────────────────────────────

pub async fn clear_pending_changes(
    state: &AppState,
    repo: Option<String>,
    unstage: bool,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    if unstage {
        if let Ok(repo_path) = crate::resolve_repo_path(state, Some(&slug)) {
            let git_lock = crate::repo_git_lock(state, &slug);
            let _git_guard = git_lock.lock().await;
            let _ = crate::git_run(&repo_path, &["reset"]).await;
        }
    }
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let _ = crate::clear_pending_diffs_db(&conn.lock().unwrap(), &slug);
    Ok(json!({ "status": "ok" }))
}

// ───────────────────────────────────────────────────────────────────────
// 34b. discard_pending_paths
// ───────────────────────────────────────────────────────────────────────

pub async fn discard_pending_paths(
    state: &AppState,
    repo: Option<String>,
    payload: models::DiscardPendingPathsRequest,
) -> Result<models::WorkflowDiffFilesResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    crate::workspace::require_remote_git_workspace(state, &slug)?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let mut discard_paths: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in &payload.paths {
        let path = raw.replace('\\', "/");
        if path.is_empty() || !seen.insert(path.clone()) {
            continue;
        }
        if !crate::is_allowed_discard_path(&path) {
            return Err(ApiError::bad_request(format!(
                "Invalid discard path: {path}"
            )));
        }
        discard_paths.push(path);
    }
    if discard_paths.is_empty() {
        return Err(ApiError::bad_request("No paths to discard"));
    }

    let git_lock = crate::repo_git_lock(state, &slug);
    let _git_guard = git_lock.lock().await;

    let _ = crate::pending_run_yaml::flush_all_pending_run_yaml_inner(state, &slug)
        .await
        .map_err(|e| ApiError::internal(e))?;

    let staged = crate::git_cached_name_status_changes(&repo_path)
        .await
        .unwrap_or_default();
    let mut status_by_path: std::collections::HashMap<String, models::PendingFileChange> =
        std::collections::HashMap::new();
    for c in &staged {
        status_by_path.insert(c.path.replace('\\', "/"), c.clone());
    }
    for c in &payload.changes {
        let path = c.path.replace('\\', "/");
        if path.is_empty() {
            continue;
        }
        status_by_path.insert(
            path.clone(),
            models::PendingFileChange {
                path,
                status: c.status.clone(),
                old_path: c.old_path.as_ref().map(|p| p.replace('\\', "/")),
            },
        );
    }

    let (restore_paths, rm_paths) =
        crate::partition_discard_git_ops(&discard_paths, &status_by_path);
    crate::discard_staged_and_worktree_paths(&repo_path, &restore_paths, &rm_paths)
        .await
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let all_changes = crate::git_cached_name_status_changes(&repo_path)
        .await
        .unwrap_or_default();
    let files: Vec<String> = all_changes.iter().map(|c| c.path.clone()).collect();
    let changes = crate::case_changes_from_name_status(&all_changes);

    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    {
        let conn_guard = conn.lock().unwrap();
        crate::upsert_pending_diff_file_list_db(&conn_guard, &slug, &all_changes)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    }

    // Index paths that were discarded (disk may now match HEAD / file removed).
    let mut index_paths = discard_paths.clone();
    for c in payload.changes.iter().chain(staged.iter()) {
        if let Some(old) = &c.old_path {
            let old = old.replace('\\', "/");
            if discard_paths
                .iter()
                .any(|p| p == &c.path.replace('\\', "/"))
                && !old.is_empty()
            {
                index_paths.push(old);
            }
        }
    }
    let (changed_cases, changed_runs) = crate::filter_case_and_run_yaml_paths(&index_paths);
    if !changed_cases.is_empty() {
        crate::sync_index_for_changed_paths(
            state,
            &repo_path,
            &slug,
            changed_cases,
            Vec::new(),
            None,
            None,
        )
        .await
        .map_err(|e| ApiError::internal(format!("incremental index failed: {e:#}")))?;
    }
    if !changed_runs.is_empty() {
        let run_ids = crate::run_ids_from_yaml_paths(&changed_runs);
        crate::reconcile_runs_from_disk(state, &repo_path, &slug, &run_ids)
            .await
            .map_err(|e| ApiError::internal(format!("run reconcile failed: {e:#}")))?;
    }

    let changed_tickets = crate::tickets::filter_ticket_yaml_paths(&index_paths);
    if !changed_tickets.is_empty() {
        let conn_guard = conn.lock().unwrap();
        let ticket_audit =
            crate::AuditStampSource::CommitMeta(crate::git_last_commit_meta_for_paths(
                &repo_path,
                &changed_tickets,
                &[".gitoza/tasks/tickets"],
            ));
        if changed_tickets.len() > crate::INCREMENTAL_THRESHOLD {
            let _ = crate::tickets::reindex_tickets_for_repo(&conn_guard, &repo_path, &slug);
        } else {
            let _ = crate::tickets::apply_incremental_ticket_changes(
                &conn_guard,
                &repo_path,
                &slug,
                &changed_tickets,
                &ticket_audit,
            );
        }
    }

    let changed_releases = crate::ticket_releases::filter_release_yaml_paths(&index_paths);
    if !changed_releases.is_empty() {
        let conn_guard = conn.lock().unwrap();
        let release_audit =
            crate::AuditStampSource::CommitMeta(crate::git_last_commit_meta_for_paths(
                &repo_path,
                &changed_releases,
                &[".gitoza/tasks/tickets"],
            ));
        if changed_releases.len() > crate::INCREMENTAL_THRESHOLD {
            let _ =
                crate::ticket_releases::reindex_releases_for_repo(&conn_guard, &repo_path, &slug);
        } else {
            let _ = crate::ticket_releases::apply_incremental_release_changes(
                &conn_guard,
                &repo_path,
                &slug,
                &changed_releases,
                &release_audit,
            );
        }
    }

    let changed_wiki = crate::wiki::filter_wiki_yaml_paths(&index_paths);
    if !changed_wiki.is_empty() {
        let conn_guard = conn.lock().unwrap();
        let wiki_audit = crate::AuditStampSource::CommitMeta(
            crate::git_last_commit_meta_for_paths(&repo_path, &changed_wiki, &[".gitoza/wiki"]),
        );
        if changed_wiki.len() > crate::INCREMENTAL_THRESHOLD {
            let _ = crate::wiki::reindex_wiki_for_repo(&conn_guard, &repo_path, &slug);
        } else {
            let _ = crate::wiki::apply_incremental_wiki_changes(
                &conn_guard,
                &repo_path,
                &slug,
                &changed_wiki,
                &wiki_audit,
            );
        }
    }

    let _ = crate::broadcast_refresh(state).await;

    Ok(models::WorkflowDiffFilesResponse { files, changes })
}

// ───────────────────────────────────────────────────────────────────────
// 35. get_pending_diff_files
// ───────────────────────────────────────────────────────────────────────

pub async fn get_pending_diff_files(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::WorkflowDiffFilesResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn_guard = conn.lock().unwrap();
    let files = crate::pending_diff_files_db(&conn_guard, &slug).unwrap_or_default();
    let changes = crate::pending_case_file_changes_db(&conn_guard, &slug).unwrap_or_default();
    Ok(models::WorkflowDiffFilesResponse { files, changes })
}

// ───────────────────────────────────────────────────────────────────────
// 36. get_pending_diff_content
// ───────────────────────────────────────────────────────────────────────

pub async fn get_pending_diff_content(
    state: &AppState,
    repo: Option<String>,
    file_path: String,
) -> Result<models::WorkflowDiffContentResponse, ApiError> {
    if file_path.contains("..") || file_path.starts_with('/') {
        return Err(ApiError::bad_request("Invalid file_path"));
    }
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let cached = crate::pending_diff_content_db(&conn.lock().unwrap(), &slug, &file_path)
        .unwrap_or_default();
    if !cached.is_empty() {
        return Ok(models::WorkflowDiffContentResponse { content: cached });
    }

    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let git_lock = crate::repo_git_lock(state, &slug);
    let _git_guard = git_lock.lock().await;
    let diff = crate::git_cached_file_diff(&repo_path, &file_path)
        .await
        .unwrap_or_default();
    crate::cache_pending_diff_content_db(&conn.lock().unwrap(), &slug, &file_path, &diff)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(models::WorkflowDiffContentResponse { content: diff })
}

// ───────────────────────────────────────────────────────────────────────
// 37. workflow_ensure_draft
// ───────────────────────────────────────────────────────────────────────

pub async fn workflow_ensure_draft(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::WorkflowEnsureDraftResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    crate::workspace::require_remote_git_workspace(state, &slug)?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let git_lock = crate::repo_git_lock(state, &slug);
    let _git_guard = git_lock.lock().await;

    let _ = crate::git_fetch_origin(&repo_path).await;

    let origin_ref = crate::paths::origin_work_branch_ref();
    let head_ref = crate::paths::work_branch_head_ref();
    let work_branch = crate::paths::GITOZA_WORK_BRANCH;

    let remote_ok =
        crate::git_run(&repo_path, &["rev-parse", "--verify", origin_ref.as_str()]).await;
    if remote_ok.as_ref().map(|r| r.success).unwrap_or(false) {
        let _ = crate::git_run(
            &repo_path,
            &["checkout", "-B", work_branch, origin_ref.as_str()],
        )
        .await;
    } else {
        let _ = crate::git_run(&repo_path, &["checkout", "-B", work_branch]).await;
    }

    let existed = crate::git_run(
        &repo_path,
        &["show-ref", "--verify", "--quiet", head_ref.as_str()],
    )
    .await
    .ok()
    .map(|r| r.success)
    .unwrap_or(true);

    Ok(models::WorkflowEnsureDraftResponse {
        branch: work_branch.to_string(),
        created: !existed,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 38. workflow_push_failed_status
// ───────────────────────────────────────────────────────────────────────

pub async fn workflow_push_failed_status(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::PushFailedStatusResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    let reason = crate::get_push_failed_reason_db(&conn, &slug)
        .ok()
        .flatten();
    let failed = crate::has_push_failed_db(&conn, &slug).unwrap_or(false);
    if failed {
        let _ = crate::clear_push_failed_db(&conn, &slug);
    }
    Ok(models::PushFailedStatusResponse {
        push_failed_due_to_remote: failed,
        push_failed_reason: reason,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 39. confirm_changes
// ───────────────────────────────────────────────────────────────────────

pub async fn confirm_changes(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::WorkflowConfirmResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    crate::workspace::require_remote_git_workspace(state, &slug)?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let (workflow, push_failed) = crate::sync_engine_adapter::make_stores(state, &slug);
    let lock = crate::repo_git_lock(state, &slug);
    let engine = sync_engine::SyncEngine {
        repo_path: &repo_path,
        work_branch: crate::paths::GITOZA_WORK_BRANCH,
        lock,
        workflow: workflow.as_ref(),
        push_failed: push_failed.as_ref(),
    };

    let outcome = engine
        .publish_with_builder(|path| {
            let path = path.to_path_buf();
            async move { crate::build_commit_message(&path).await }
        })
        .await
        .map_err(crate::sync_engine_adapter::map_publish_error)?;

    crate::sync_engine_adapter::map_publish_outcome(
        state,
        &repo_path,
        &slug,
        outcome,
        "Changes pushed.",
    )
    .await
}

// ───────────────────────────────────────────────────────────────────────
// 40. resolve_rebase
// ───────────────────────────────────────────────────────────────────────

pub async fn resolve_rebase(
    state: &AppState,
    repo: Option<String>,
    payload: models::ResolveRebaseRequest,
) -> Result<models::WorkflowConfirmResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    crate::workspace::require_remote_git_workspace(state, &slug)?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let resolutions: Vec<_> = payload
        .resolved_files
        .into_iter()
        .map(crate::sync_engine_adapter::resolve_item_to_engine)
        .collect();

    let (workflow, push_failed) = crate::sync_engine_adapter::make_stores(state, &slug);
    let lock = crate::repo_git_lock(state, &slug);
    let engine = sync_engine::SyncEngine {
        repo_path: &repo_path,
        work_branch: crate::paths::GITOZA_WORK_BRANCH,
        lock,
        workflow: workflow.as_ref(),
        push_failed: push_failed.as_ref(),
    };

    let outcome = engine
        .resolve_and_finish(&resolutions)
        .await
        .map_err(crate::sync_engine_adapter::map_publish_error)?;

    crate::sync_engine_adapter::map_publish_outcome(
        state,
        &repo_path,
        &slug,
        outcome,
        "Rebase completed and synced.",
    )
    .await
}

// ───────────────────────────────────────────────────────────────────────
// 41. abort_rebase
// ───────────────────────────────────────────────────────────────────────

pub async fn abort_rebase(
    state: &AppState,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let (workflow, push_failed) = crate::sync_engine_adapter::make_stores(state, &slug);
    let lock = crate::repo_git_lock(state, &slug);
    let engine = sync_engine::SyncEngine {
        repo_path: &repo_path,
        work_branch: crate::paths::GITOZA_WORK_BRANCH,
        lock,
        workflow: workflow.as_ref(),
        push_failed: push_failed.as_ref(),
    };

    match engine.abort_rebase().await {
        Ok(_) => {
            let porcelain_paths = crate::git_status_porcelain_paths(&repo_path)
                .await
                .unwrap_or_default();
            let (changed_cases, changed_runs) =
                crate::filter_case_and_run_yaml_paths(&porcelain_paths);
            if !changed_cases.is_empty() {
                let _ = crate::sync_index_for_changed_paths(
                    state,
                    &repo_path,
                    &slug,
                    changed_cases,
                    Vec::new(),
                    None,
                    None,
                )
                .await;
            }
            let mut run_ids = crate::run_ids_from_yaml_paths(&changed_runs);
            for id in crate::pending_run_yaml::pending_run_yaml_ids(state, &slug) {
                if !run_ids.iter().any(|r| r == &id) {
                    run_ids.push(id);
                }
            }
            if !run_ids.is_empty() {
                let _ = crate::reconcile_runs_from_disk(state, &repo_path, &slug, &run_ids).await;
            }
            let _ = crate::broadcast_refresh(state).await;
            Ok(serde_json::to_value(models::WorkflowConfirmResponse {
                success: true,
                message: format!(
                    "Rebase aborted; changes restored to working tree on {}.",
                    crate::paths::GITOZA_WORK_BRANCH
                ),
                conflict_files: None,
                conflict: false,
                conflict_file_contents: None,
                push_failed_due_to_remote: false,
                push_failed_reason: None,
            })
            .unwrap_or_default())
        }
        Err(e) => Err(ApiError::bad_request(format!("{e:#}"))),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 42. recover_confirm_workflow
// ───────────────────────────────────────────────────────────────────────

pub async fn recover_confirm_workflow(
    state: &AppState,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    if crate::workspace::is_playground_slug(state, &slug) {
        return Ok(json!({ "status": "ok" }));
    }
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let (workflow, push_failed) = crate::sync_engine_adapter::make_stores(state, &slug);
    let lock = crate::repo_git_lock(state, &slug);
    let engine = sync_engine::SyncEngine {
        repo_path: &repo_path,
        work_branch: crate::paths::GITOZA_WORK_BRANCH,
        lock,
        workflow: workflow.as_ref(),
        push_failed: push_failed.as_ref(),
    };

    engine
        .recover()
        .await
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(json!({ "status": "ok" }))
}

// ───────────────────────────────────────────────────────────────────────
// 43. prefetch_repo
// ───────────────────────────────────────────────────────────────────────

pub async fn prefetch_repo(
    _state: &AppState,
    _repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    Err(ApiError::unprocessable(
        "POST /api/workflow/prefetch not implemented yet.",
    ))
}

// ───────────────────────────────────────────────────────────────────────
// 44. create_run
// ───────────────────────────────────────────────────────────────────────

pub async fn create_run(
    state: &AppState,
    repo: Option<String>,
    payload: models::CreateRunRequest,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let review_enabled =
        crate::project_config::load_project_test_config(&repo_path).enable_review_system;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let new_run_id = {
        let conn = conn_arc.lock().unwrap();
        crate::run_publish::generate_unique_run_id(&conn, &slug, &repo_path)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };

    let mut doc = crate::run_publish::build_new_run_doc(
        payload.name.trim(),
        Some(&new_run_id),
        Some(payload.description.as_str()),
        Some(vec![]),
        Some(git_name.as_str()),
        review_enabled,
    );

    if let Some(rel) = payload
        .release
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        if let Some(obj) = doc.as_object_mut() {
            obj.insert(
                "release".to_string(),
                serde_json::Value::String(rel.to_string()),
            );
        }
    }

    if let Some(case_specs) = payload.cases.clone() {
        if let Ok(entries) =
            crate::build_case_entries_for_run(state, &repo_path, &slug, case_specs).await
        {
            crate::run_publish::add_cases_to_doc(&mut doc, &entries, Some(git_name.as_str()));
        }
    }

    let run_id_str = doc
        .get("run_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let rel = match crate::run_publish::write_run_triplet(&repo_path, &doc, true) {
        Some(r) => r,
        None => return Err(ApiError::internal("Failed to write run YAML")),
    };

    let run_dir = crate::run_publish::run_dir_from_shard_rel(&rel)
        .unwrap_or_else(|| crate::run_publish::get_run_dir_rel_path(&run_id_str, false));

    let loaded_item = {
        let conn = conn_arc.lock().unwrap();
        if let Err(e) = crate::upsert_test_run_from_doc(&conn, &slug, &doc, Some(&run_dir)) {
            return Err(ApiError::internal(format!("{e:#}")));
        }
        crate::get_test_run_list_item(&conn, &slug, &run_id_str)
            .ok()
            .flatten()
    };

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    match loaded_item {
        Some(item) => Ok(serde_json::to_value(item).unwrap_or_default()),
        None => Err(ApiError::internal("Run created but could not be loaded")),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 45. list_runs
// ───────────────────────────────────────────────────────────────────────

pub async fn list_runs(
    state: &AppState,
    repo: Option<String>,
    include_archived: Option<bool>,
    archived_only: Option<bool>,
    search: Option<String>,
    approve_status: Option<String>,
    requirement_id: Option<String>,
    requirement_ids: Option<Vec<String>>,
    release: Option<String>,
) -> Result<Vec<models::RunListItem>, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    match crate::list_test_runs(&conn, &slug) {
        Ok(items) => {
            let include_archived = include_archived.unwrap_or(false);
            let archived_only = archived_only.unwrap_or(false);
            let approve_status = approve_status
                .as_deref()
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty());
            let search = search
                .as_deref()
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty());
            let mut filter_ids = requirement_ids.unwrap_or_default();
            if let Some(id) = requirement_id {
                filter_ids.push(id);
            }
            let filter_ids = crate::requirement_ids::normalize_requirement_ids(filter_ids);
            let filter_ids_lower: Vec<String> =
                filter_ids.iter().map(|s| s.to_lowercase()).collect();
            let release_filter = release
                .as_deref()
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty());

            let filtered: Vec<models::RunListItem> = items
                .into_iter()
                .filter(|r| {
                    if archived_only {
                        r.archived
                    } else if include_archived {
                        true
                    } else {
                        !r.archived
                    }
                })
                .filter(|r| {
                    if let Some(ref ap) = approve_status {
                        r.approve_status.trim().to_lowercase() == *ap
                    } else {
                        true
                    }
                })
                .filter(|r| {
                    if let Some(ref s) = search {
                        let hay = format!(
                            "{}\n{}",
                            r.name.to_lowercase(),
                            r.description.to_lowercase()
                        );
                        hay.contains(s)
                    } else {
                        true
                    }
                })
                .filter(|r| {
                    if filter_ids_lower.is_empty() {
                        return true;
                    }
                    let run_ids_lower: Vec<String> = r
                        .requirement_ids
                        .iter()
                        .map(|id| id.to_lowercase())
                        .collect();
                    filter_ids_lower
                        .iter()
                        .any(|need| run_ids_lower.iter().any(|have| have == need))
                })
                .filter(|r| {
                    if let Some(ref want) = release_filter {
                        r.release
                            .as_deref()
                            .map(|s| s.trim().to_lowercase())
                            .as_deref()
                            == Some(want.as_str())
                    } else {
                        true
                    }
                })
                .collect();

            Ok(filtered)
        }
        Err(e) => Err(ApiError::internal(format!("{e:#}"))),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 46. get_run
// ───────────────────────────────────────────────────────────────────────

pub async fn get_run(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    include_cases: Option<bool>,
    include_case_comments: Option<bool>,
) -> Result<models::RunDetailResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    let include_cases = include_cases.unwrap_or(false);
    let include_case_comments = include_case_comments.unwrap_or(false);

    match crate::get_run_detail(&conn, &slug, &run_id, include_cases, include_case_comments) {
        Ok(Some(d)) => Ok(d),
        Ok(None) => Err(ApiError::not_found(format!("Run not found: {run_id}"))),
        Err(e) => Err(ApiError::internal(format!("{e:#}"))),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 46a. list_run_cases
// ───────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn list_run_cases(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    folder_prefix: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<models::RunCaseListResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let limit = limit.unwrap_or(50).clamp(1, 5000);
    let offset = offset.unwrap_or(0).max(0);

    let (mut items, total) = crate::query_run_cases_db(
        &conn_arc.lock().unwrap(),
        &slug,
        crate::QueryRunCasesArgs {
            run_id: Some(run_id.clone()),
            folder_prefix,
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
            limit,
            offset,
        },
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    if !items.is_empty() {
        let paths: Vec<String> = items.iter().map(|c| c.file_path.clone()).collect();
        let comments_by_path = {
            let conn = conn_arc.lock().unwrap();
            crate::load_run_case_comments_for_paths(&conn, &slug, &run_id, &paths)
                .map_err(|e| ApiError::internal(format!("{e:#}")))?
        };
        for item in &mut items {
            if let Some(cm) = comments_by_path.get(&item.file_path) {
                item.comments = cm.clone();
            }
        }
    }

    Ok(models::RunCaseListResponse {
        total,
        items,
        limit,
        offset,
    })
}

// ───────────────────────────────────────────────────────────────────────
// 46b2. list_run_case_paths
// ───────────────────────────────────────────────────────────────────────

pub async fn list_run_case_paths(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
) -> Result<models::RunCasePathsResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    if crate::get_test_run_list_item(&conn, &slug, &run_id)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?
        .is_none()
    {
        return Err(ApiError::not_found(format!("Run not found: {run_id}")));
    }
    crate::list_run_case_paths_db(&conn, &slug, &run_id)
        .map_err(|e| ApiError::internal(format!("{e:#}")))
}

// ───────────────────────────────────────────────────────────────────────
// 46c. get_run_folder_tree
// ───────────────────────────────────────────────────────────────────────

pub async fn get_run_folder_tree(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    folder_prefix: Option<String>,
    depth: Option<String>,
) -> Result<Vec<models::RunFolderTreeNode>, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    if crate::get_test_run_list_item(&conn, &slug, &run_id)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?
        .is_none()
    {
        return Err(ApiError::not_found(format!("Run not found: {run_id}")));
    }
    let prefix = folder_prefix
        .map(|s| s.trim().replace('\\', "/"))
        .filter(|s| !s.is_empty());
    let tree_depth = match depth.as_deref().map(str::to_ascii_lowercase).as_deref() {
        Some("projects") => crate::run_folder_tree::RunFolderTreeDepth::Projects,
        _ => crate::run_folder_tree::RunFolderTreeDepth::Full,
    };
    crate::run_folder_tree::build_run_folder_tree_scoped(
        &conn,
        &slug,
        &run_id,
        prefix.as_deref(),
        tree_depth,
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))
}

// ───────────────────────────────────────────────────────────────────────
// 46b. get_run_breakdown
// ───────────────────────────────────────────────────────────────────────

pub async fn get_run_breakdown(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
) -> Result<models::RunBreakdownResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    crate::run_breakdown::build_run_breakdown(&conn, &slug, &run_id).map_err(|e| {
        if e.to_string().contains("not found") {
            ApiError::not_found(format!("Run not found: {run_id}"))
        } else {
            ApiError::internal(format!("{e:#}"))
        }
    })
}

// ───────────────────────────────────────────────────────────────────────
// 46c. get_project_case_breakdown
// ───────────────────────────────────────────────────────────────────────

pub async fn get_project_case_breakdown(
    state: &AppState,
    project_path: String,
    repo: Option<String>,
) -> Result<models::ProjectCaseBreakdownResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    crate::case_breakdown::build_project_case_breakdown(&conn, &slug, &project_path).map_err(|e| {
        if e.to_string().contains("required") {
            ApiError::bad_request(e.to_string())
        } else {
            ApiError::internal(format!("{e:#}"))
        }
    })
}

// ───────────────────────────────────────────────────────────────────────
// 47. get_run_case_content
// ───────────────────────────────────────────────────────────────────────

pub async fn get_run_case_content(
    state: &AppState,
    run_id: String,
    file_path: String,
    repo: Option<String>,
) -> Result<models::YamlCaseDetail, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let (file_path, case_id, mut content_snapshot, picked_at_sha) = {
        let conn = conn_arc.lock().unwrap();
        let run_exists: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM test_runs WHERE repo_slug = ? AND run_id = ?",
                params![slug, run_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if run_exists.is_none() {
            return Err(ApiError::not_found("Run not found."));
        }
        let row: Option<(String, String, String, Option<String>)> = conn
            .query_row(
                "SELECT file_path, case_id, content_snapshot, picked_at_sha FROM test_run_cases WHERE repo_slug = ? AND run_id = ? AND file_path = ?",
                params![slug, run_id, file_path],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .ok()
            .flatten();
        let Some((fp, cid, cs, sha)) = row else {
            return Err(ApiError::not_found("Case not found in run."));
        };
        (fp, cid, cs, sha)
    };

    if content_snapshot.trim().is_empty() {
        if let Some(sha) = picked_at_sha.clone() {
            let fp = file_path.trim().replace('\\', "/");
            if !fp.is_empty() && !fp.contains("..") && !fp.starts_with('/') {
                let spec = format!("{}:{}", sha.trim(), fp);
                let content = crate::git_stdout(&repo_path, &["show", &spec])
                    .await
                    .unwrap_or_default();
                if !content.trim().is_empty() {
                    content_snapshot = content;
                    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
                        let conn = conn_arc.lock().unwrap();
                        let _ = conn.execute(
                            "UPDATE test_run_cases SET content_snapshot = ?1 WHERE repo_slug = ?2 AND run_id = ?3 AND file_path = ?4",
                            params![content_snapshot, slug, run_id, file_path],
                        );
                    }
                }
            }
        }
    }

    let parsed = crate::parse_full_yaml_content_for_api(&content_snapshot, &file_path, &case_id)
        .ok_or_else(|| ApiError::unprocessable("Could not parse case snapshot."))?;
    Ok(parsed)
}

// ───────────────────────────────────────────────────────────────────────
// 48. patch_run
// ───────────────────────────────────────────────────────────────────────

pub async fn patch_run(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    payload: models::PatchRunRequest,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;

    let archived_before = {
        let conn = conn_arc.lock().unwrap();
        let row: Option<i64> = conn
            .query_row(
                "SELECT archived FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
                params![slug, run_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
        let Some(a) = row else {
            return Err(ApiError::not_found(format!("Run not found: {run_id}")));
        };
        a != 0
    };

    {
        let conn = conn_arc.lock().unwrap();
        let assigned_to_patch = match &payload.assigned_to {
            None => None,
            Some(s) if s.trim().is_empty() => Some(None),
            Some(s) => {
                let canonical = crate::canonicalize_assignee_for_repo(&conn, &slug, s)
                    .map_err(|e| ApiError::internal(format!("{e:#}")))?;
                Some(canonical)
            }
        };
        let requirement_ids_patch = payload
            .requirement_ids
            .as_ref()
            .map(|ids| crate::requirement_ids::normalize_requirement_ids(ids.clone()));
        let release_patch = match &payload.release {
            None => None,
            Some(s) if s.trim().is_empty() => Some(None),
            Some(s) => Some(Some(s.trim())),
        };
        if let Err(e) = crate::update_test_run_header_db(
            &conn,
            &slug,
            &run_id,
            payload.name.as_deref(),
            payload.description.as_deref(),
            payload.archived,
            assigned_to_patch.as_ref().map(|opt| opt.as_deref()),
            requirement_ids_patch.as_deref(),
            release_patch,
            Some(git_name.as_str()),
        ) {
            return Err(ApiError::internal(format!("{e:#}")));
        }
    }

    if let Some(archived_new) = payload.archived {
        if archived_new != archived_before {
            if let Err(msg) =
                crate::move_run_dir_for_archive(&repo_path, &run_id, archived_before, archived_new)
            {
                return Err(ApiError::internal(msg));
            }
            let new_dir = crate::run_publish::get_run_dir_rel_path(&run_id, archived_new);
            let conn = conn_arc.lock().unwrap();
            let _ = crate::set_run_dir_path_db(&conn, &run_id, &new_dir);
        }
    }

    {
        let conn = conn_arc.lock().unwrap();
        crate::run_publish::flush_run_head_yaml_from_db(&repo_path, &conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    }

    let loaded_item = {
        let conn = conn_arc.lock().unwrap();
        crate::get_test_run_list_item(&conn, &slug, &run_id)
            .ok()
            .flatten()
    };

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    match loaded_item {
        Some(item) => Ok(serde_json::to_value(item).unwrap_or_default()),
        None => Err(ApiError::internal("Run updated but could not be loaded")),
    }
}

async fn patch_run_requirement_ids(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    ticket_id: String,
    unlink: bool,
) -> Result<serde_json::Value, ApiError> {
    let ticket_id = ticket_id.trim().to_string();
    if ticket_id.is_empty() {
        return Err(ApiError::bad_request("ticket_id is required"));
    }
    let run_id = run_id.trim().to_string();
    if run_id.is_empty() {
        return Err(ApiError::bad_request("run_id is required"));
    }
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;

    let existing = {
        let conn = conn_arc.lock().unwrap();
        match crate::get_test_run_list_item(&conn, &slug, &run_id) {
            Ok(Some(item)) => item,
            Ok(None) => return Err(ApiError::not_found(format!("Run not found: {run_id}"))),
            Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
        }
    };

    let next = if unlink {
        crate::requirement_ids::remove_requirement_id(existing.requirement_ids.clone(), &ticket_id)
    } else {
        crate::requirement_ids::add_requirement_id(existing.requirement_ids.clone(), &ticket_id)
    };
    if next == existing.requirement_ids {
        return Ok(serde_json::to_value(existing).unwrap_or_default());
    }

    {
        let conn = conn_arc.lock().unwrap();
        if let Err(e) = crate::update_test_run_header_db(
            &conn,
            &slug,
            &run_id,
            None,
            None,
            None,
            None,
            Some(next.as_slice()),
            None,
            Some(git_name.as_str()),
        ) {
            return Err(ApiError::internal(format!("{e:#}")));
        }
        crate::run_publish::flush_run_head_yaml_from_db(&repo_path, &conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    }

    let loaded_item = {
        let conn = conn_arc.lock().unwrap();
        crate::get_test_run_list_item(&conn, &slug, &run_id)
            .ok()
            .flatten()
    };

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    match loaded_item {
        Some(item) => Ok(serde_json::to_value(item).unwrap_or_default()),
        None => Err(ApiError::internal("Run updated but could not be loaded")),
    }
}

pub async fn link_run_requirement(
    state: &AppState,
    run_id: String,
    ticket_id: String,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    patch_run_requirement_ids(state, run_id, repo, ticket_id, false).await
}

pub async fn unlink_run_requirement(
    state: &AppState,
    run_id: String,
    ticket_id: String,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    patch_run_requirement_ids(state, run_id, repo, ticket_id, true).await
}

// ───────────────────────────────────────────────────────────────────────
// 48b. patch_run_case
// ───────────────────────────────────────────────────────────────────────

pub async fn patch_run_case(
    state: &AppState,
    run_id: String,
    file_path: String,
    repo: Option<String>,
    payload: models::PatchRunCaseRequest,
) -> Result<serde_json::Value, ApiError> {
    let file_path = file_path.trim().replace('\\', "/");
    if file_path.is_empty() {
        return Err(ApiError::bad_request("file_path is required"));
    }
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    if payload.assigned_to.is_none() {
        return Err(ApiError::bad_request("No fields to update"));
    }

    let new_assigned = match payload.assigned_to.as_deref() {
        None => None,
        Some(s) => {
            let conn = conn_arc.lock().unwrap();
            let canonical = crate::canonicalize_assignee_for_repo(&conn, &slug, s)
                .map_err(|e| ApiError::internal(format!("{e:#}")))?;
            match canonical {
                None => None,
                Some(v) => crate::normalize_stored_assignee(&v),
            }
        }
    };

    {
        let conn = conn_arc.lock().unwrap();
        if !crate::run_case_path_is_member(&conn, &slug, &run_id, &file_path)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
        {
            return Err(ApiError::not_found("Case not in run"));
        }
        conn.execute(
            "UPDATE test_run_cases SET assigned_to = ?1 WHERE repo_slug = ?2 AND run_id = ?3 AND file_path = ?4",
            params![new_assigned, slug, run_id, file_path],
        )
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    }

    let _ = crate::pending_run_yaml::mark_run_yaml_pending(
        state,
        &slug,
        &run_id,
        crate::pending_run_yaml::PendingRunFlushFlags::cases_only(),
    );
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    let item = {
        let conn = conn_arc.lock().unwrap();
        crate::get_run_case_item(&conn, &slug, &run_id, &file_path)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };
    match item {
        Some(i) => Ok(serde_json::to_value(i).unwrap_or_default()),
        None => Err(ApiError::internal("Case updated but could not be loaded")),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 48c. get_workspace_usernames
// ───────────────────────────────────────────────────────────────────────

pub async fn get_workspace_usernames(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::WorkspaceUsernames, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let mut usernames = {
        let conn = conn.lock().unwrap();
        crate::workspace_usernames(&conn, &slug).unwrap_or_default()
    };
    let git_trim = git_name.trim();
    if !git_trim.is_empty() && !usernames.iter().any(|u| u == git_trim) {
        usernames.push(git_trim.to_string());
        usernames.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    }
    Ok(models::WorkspaceUsernames { usernames })
}

// ───────────────────────────────────────────────────────────────────────
// 49. approve_run
// ───────────────────────────────────────────────────────────────────────

pub async fn approve_run(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    payload: models::ApproveRunRequest,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let approve_status = match payload.approve_status {
        models::ApproveStatus::Approved => "approved",
        models::ApproveStatus::Rejected => "rejected",
    };
    let now = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;

    {
        let conn = conn_arc.lock().unwrap();
        if crate::get_test_run_list_item(&conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
            .is_none()
        {
            return Err(ApiError::not_found(format!("Run not found: {run_id}")));
        }
        if let Err(e) = crate::update_test_run_approval_db(
            &conn,
            &slug,
            &run_id,
            approve_status,
            Some(git_name.as_str()),
            Some(now.as_str()),
            Some(git_name.as_str()),
        ) {
            return Err(ApiError::internal(format!("{e:#}")));
        }
        crate::run_publish::flush_run_head_yaml_from_db(&repo_path, &conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    }

    let loaded_item = {
        let conn = conn_arc.lock().unwrap();
        crate::get_test_run_list_item(&conn, &slug, &run_id)
            .ok()
            .flatten()
    };

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    match loaded_item {
        Some(item) => Ok(serde_json::to_value(item).unwrap_or_default()),
        None => Err(ApiError::internal("Run updated but could not be loaded")),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 50. duplicate_run
// ───────────────────────────────────────────────────────────────────────

pub async fn duplicate_run(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    payload: models::DuplicateRunRequest,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let (dup_cases, source_assigned_to, source_release) = {
        let conn = conn_arc.lock().unwrap();
        if crate::get_test_run_list_item(&conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
            .is_none()
        {
            return Err(ApiError::not_found(format!("Run not found: {run_id}")));
        }
        let source = crate::get_test_run_list_item(&conn, &slug, &run_id)
            .ok()
            .flatten();
        let source_assigned_to = source.as_ref().and_then(|r| r.assigned_to.clone());
        let source_release = source.as_ref().and_then(|r| r.release.clone());
        let mut stmt = conn
            .prepare(
                r#"SELECT file_path, case_id, picked_at_sha, title, tags, priority, requirement_id, assigned_to, automated
                   FROM test_run_cases WHERE repo_slug = ?1 AND run_id = ?2 ORDER BY file_path"#,
            )
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
        let rows = stmt
            .query_map(params![slug, run_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, i32>(8)?,
                ))
            })
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
        let mut out = Vec::new();
        for row in rows.flatten() {
            let (
                fp,
                case_id,
                picked_at_sha,
                title,
                tags_json,
                priority,
                requirement_id,
                case_assigned_to,
                automated,
            ) = row;
            let mut co = serde_json::Map::new();
            co.insert("file_path".to_string(), serde_json::Value::String(fp));
            co.insert("case_id".to_string(), serde_json::Value::String(case_id));
            co.insert(
                "result".to_string(),
                serde_json::Value::String("pending".to_string()),
            );
            if let Some(t) = title.filter(|s| !s.trim().is_empty()) {
                co.insert("title".to_string(), serde_json::Value::String(t));
            }
            if let Some(p) = priority.filter(|s| !s.trim().is_empty()) {
                co.insert("priority".to_string(), serde_json::Value::String(p));
            }
            if let Some(tags) = tags_json
                .as_deref()
                .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                .filter(|v| !v.is_empty())
            {
                co.insert(
                    "tags".to_string(),
                    serde_json::Value::Array(
                        tags.into_iter().map(serde_json::Value::String).collect(),
                    ),
                );
            }
            if let Some(v) = crate::requirement_ids::requirement_ids_to_json_value(
                &crate::requirement_ids::requirement_ids_from_db(requirement_id.as_deref()),
            ) {
                co.insert("requirement_ids".to_string(), v);
            }
            if automated != 0 {
                co.insert("automated".to_string(), serde_json::Value::Bool(true));
            }
            if let Some(a) = case_assigned_to.filter(|s| !s.trim().is_empty()) {
                co.insert("assigned_to".to_string(), serde_json::Value::String(a));
            }
            if let Some(sha) = picked_at_sha.filter(|s| !s.trim().is_empty()) {
                co.insert("picked_at_sha".to_string(), serde_json::Value::String(sha));
            }
            out.push(serde_json::Value::Object(co));
        }
        (out, source_assigned_to, source_release)
    };

    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let review_enabled =
        crate::project_config::load_project_test_config(&repo_path).enable_review_system;
    let new_run_id = {
        let conn = conn_arc.lock().unwrap();
        crate::run_publish::generate_unique_run_id(&conn, &slug, &repo_path)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };
    let mut doc = crate::run_publish::build_new_run_doc(
        payload.name.trim(),
        Some(&new_run_id),
        Some(payload.description.as_str()),
        Some(dup_cases),
        Some(git_name.as_str()),
        review_enabled,
    );
    if let Some(obj) = doc.as_object_mut() {
        if let Some(at) = source_assigned_to.filter(|s| !s.trim().is_empty()) {
            obj.insert("assigned_to".to_string(), serde_json::Value::String(at));
        }
        if let Some(rel) = source_release.filter(|s| !s.trim().is_empty()) {
            obj.insert("release".to_string(), serde_json::Value::String(rel));
        }
    }
    let run_id_new = doc
        .get("run_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let rel = match crate::run_publish::write_run_triplet(&repo_path, &doc, true) {
        Some(r) => r,
        None => return Err(ApiError::internal("Failed to write run YAML")),
    };
    let run_dir = crate::run_publish::run_dir_from_shard_rel(&rel)
        .unwrap_or_else(|| crate::run_publish::get_run_dir_rel_path(&run_id_new, false));
    let loaded_item = {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::upsert_test_run_from_doc(&conn, &slug, &doc, Some(&run_dir));
        crate::get_test_run_list_item(&conn, &slug, &run_id_new)
            .ok()
            .flatten()
    };

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    match loaded_item {
        Some(item) => Ok(serde_json::to_value(item).unwrap_or_default()),
        None => Err(ApiError::internal("Run duplicated but could not be loaded")),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 51. add_run_cases
// ───────────────────────────────────────────────────────────────────────

pub async fn add_run_cases(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    payload: models::AddRunCasesRequest,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let entries = crate::build_case_entries_for_run(state, &repo_path, &slug, payload.cases)
        .await
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let added = {
        let conn = conn_arc.lock().unwrap();
        if crate::get_test_run_list_item(&conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
            .is_none()
        {
            return Err(ApiError::not_found("Run not found."));
        }
        let stamped: Vec<serde_json::Value> = entries
            .iter()
            .map(|e| {
                let mut entry = e.clone();
                if let Some(obj) = entry.as_object_mut() {
                    if !obj.contains_key("result") {
                        obj.insert(
                            "result".to_string(),
                            serde_json::Value::String("pending".to_string()),
                        );
                    }
                }
                entry
            })
            .collect();
        let n = crate::insert_run_cases_from_entries(&conn, &slug, &run_id, &stamped)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
        if n > 0 {
            let _ =
                crate::touch_run_header_for_comment(&conn, &slug, &run_id, Some(git_name.as_str()));
        }
        n
    };

    if added > 0 {
        let _ = crate::pending_run_yaml::mark_run_yaml_pending(
            state,
            &slug,
            &run_id,
            crate::pending_run_yaml::PendingRunFlushFlags::cases_only(),
        );
        crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
        let _ = crate::broadcast_refresh(state).await;
    }
    let executed_by = if git_name.trim().is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(git_name.trim().to_string())
    };
    let run_assigned_to = {
        let conn = conn_arc.lock().unwrap();
        conn.query_row(
            "SELECT assigned_to FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
            params![slug, run_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .map(|s| serde_json::Value::String(s))
        .unwrap_or(serde_json::Value::Null)
    };
    Ok(
        json!({ "status": "ok", "added": added, "executed_by": executed_by, "run_assigned_to": run_assigned_to }),
    )
}

// ───────────────────────────────────────────────────────────────────────
// 52. remove_run_cases
// ───────────────────────────────────────────────────────────────────────

pub async fn remove_run_cases(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    file_paths: Option<Vec<String>>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let file_paths: Vec<String> = file_paths
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.trim().replace('\\', "/"))
        .filter(|p| !p.is_empty())
        .collect();
    if file_paths.is_empty() {
        return Ok(json!({ "status": "ok", "removed": 0 }));
    }

    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let (removed, results_deleted) = {
        let conn = conn_arc.lock().unwrap();
        if crate::get_test_run_list_item(&conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
            .is_none()
        {
            return Err(ApiError::not_found("Run not found."));
        }
        let mut removed = 0usize;
        for fp in &file_paths {
            let exists: bool = conn
                .query_row(
                    "SELECT 1 FROM test_run_cases WHERE repo_slug = ?1 AND run_id = ?2 AND file_path = ?3",
                    params![slug, run_id, fp],
                    |r| r.get::<_, i32>(0),
                )
                .optional()
                .map_err(|e| ApiError::internal(format!("{e:#}")))?
                .is_some();
            if exists {
                removed += 1;
            }
        }
        let results_deleted = crate::delete_run_cases_by_paths(&conn, &slug, &run_id, &file_paths)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
        if removed > 0 {
            let _ =
                crate::touch_run_header_for_comment(&conn, &slug, &run_id, Some(git_name.as_str()));
        }
        (removed, results_deleted)
    };

    if removed > 0 {
        let flags = if results_deleted > 0 {
            crate::pending_run_yaml::PendingRunFlushFlags::cases_and_results()
        } else {
            crate::pending_run_yaml::PendingRunFlushFlags::cases_only()
        };
        let _ = crate::pending_run_yaml::mark_run_yaml_pending(state, &slug, &run_id, flags);
        crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
        let _ = crate::broadcast_refresh(state).await;
    }
    Ok(json!({ "status": "ok", "removed": removed }))
}

// ───────────────────────────────────────────────────────────────────────
// 52b. post_run_comment
// ───────────────────────────────────────────────────────────────────────

pub async fn post_run_comment(
    state: &AppState,
    run_id: String,
    text: String,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(ApiError::bad_request("Comment text cannot be empty"));
    }

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let now = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let comment = models::Comment {
        author: git_name.clone(),
        timestamp: now,
        text,
    };

    let comments = {
        let conn = conn_arc.lock().unwrap();
        if crate::get_test_run_list_item(&conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
            .is_none()
        {
            return Err(ApiError::not_found("Run not found."));
        }
        crate::append_run_comment_db(&conn, &slug, &run_id, &comment, Some(git_name.as_str()))
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };

    let _ = crate::pending_run_yaml::mark_run_yaml_pending(
        state,
        &slug,
        &run_id,
        crate::pending_run_yaml::PendingRunFlushFlags::head_only(),
    );
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(json!({ "comments": comments }))
}

// ───────────────────────────────────────────────────────────────────────
// 52c. post_run_case_comment
// ───────────────────────────────────────────────────────────────────────

pub async fn post_run_case_comment(
    state: &AppState,
    run_id: String,
    file_path: String,
    text: String,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(ApiError::bad_request("Comment text cannot be empty"));
    }

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let now = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let comment = models::Comment {
        author: git_name.clone(),
        timestamp: now,
        text,
    };

    let case_comments = {
        let conn = conn_arc.lock().unwrap();
        crate::append_run_case_comment_db(
            &conn,
            &slug,
            &run_id,
            &file_path,
            &comment,
            Some(git_name.as_str()),
        )
        .map_err(|e| {
            if format!("{e:#}").contains("case_not_found") {
                ApiError::not_found("Case not found in run.")
            } else {
                ApiError::internal(format!("{e:#}"))
            }
        })?
    };

    let _ = crate::pending_run_yaml::mark_run_yaml_pending(
        state,
        &slug,
        &run_id,
        crate::pending_run_yaml::PendingRunFlushFlags::cases_only(),
    );
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(json!({
        "file_path": file_path,
        "comments": case_comments,
    }))
}

// ───────────────────────────────────────────────────────────────────────
// 52d. delete_run_comment
// ───────────────────────────────────────────────────────────────────────

pub async fn delete_run_comment(
    state: &AppState,
    run_id: String,
    index: usize,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;

    let comments = {
        let conn = conn_arc.lock().unwrap();
        if crate::get_test_run_list_item(&conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
            .is_none()
        {
            return Err(ApiError::not_found("Run not found."));
        }
        crate::delete_run_comment_db(&conn, &slug, &run_id, index, &git_name)
            .map_err(comment_delete_error)?
    };

    let _ = crate::pending_run_yaml::mark_run_yaml_pending(
        state,
        &slug,
        &run_id,
        crate::pending_run_yaml::PendingRunFlushFlags::head_only(),
    );
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(json!({ "comments": comments }))
}

// ───────────────────────────────────────────────────────────────────────
// 52e. delete_run_case_comment
// ───────────────────────────────────────────────────────────────────────

pub async fn delete_run_case_comment(
    state: &AppState,
    run_id: String,
    file_path: String,
    index: usize,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;

    let case_comments = {
        let conn = conn_arc.lock().unwrap();
        crate::delete_run_case_comment_db(&conn, &slug, &run_id, &file_path, index, &git_name)
            .map_err(comment_delete_error)?
    };

    let _ = crate::pending_run_yaml::mark_run_yaml_pending(
        state,
        &slug,
        &run_id,
        crate::pending_run_yaml::PendingRunFlushFlags::cases_only(),
    );
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(json!({
        "file_path": file_path,
        "comments": case_comments,
    }))
}

// ───────────────────────────────────────────────────────────────────────
// 52f. get_run_case_comments
// ───────────────────────────────────────────────────────────────────────

pub async fn get_run_case_comments(
    state: &AppState,
    run_id: String,
    file_path: String,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    if crate::get_test_run_list_item(&conn, &slug, &run_id)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?
        .is_none()
    {
        return Err(ApiError::not_found("Run not found."));
    }
    let comments = crate::load_run_case_comments(&conn, &slug, &run_id, &file_path)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(json!({
        "file_path": file_path,
        "comments": comments,
    }))
}

fn comment_delete_error(code: &'static str) -> ApiError {
    match code {
        "not_author" => ApiError::bad_request("You can only delete your own comments."),
        "comment_not_found" => ApiError::not_found("Comment not found."),
        "case_not_found" => ApiError::not_found("Case not found in run."),
        _ => ApiError::bad_request("Could not delete comment."),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 53. set_run_result
// ───────────────────────────────────────────────────────────────────────

pub async fn set_run_result(
    state: &AppState,
    run_id: String,
    file_path: String,
    repo: Option<String>,
    payload: models::SetRunResultRequest,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let review_enabled =
        crate::project_config::load_project_test_config(&repo_path).enable_review_system;
    let comment = payload.comment.trim();

    let response = {
        let conn = conn_arc.lock().unwrap();
        let stamp = crate::set_run_result_in_db(
            &conn,
            &slug,
            &run_id,
            &file_path,
            payload.result.trim(),
            if comment.is_empty() {
                None
            } else {
                Some(comment)
            },
            Some(git_name.as_str()),
            review_enabled,
        )
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
        let Some(stamp) = stamp else {
            return Err(ApiError::not_found("Case not found in run."));
        };
        let run = crate::build_run_result_header_patch(&conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
        models::SetRunResultsBatchResponse {
            status: "ok".to_string(),
            updated: 1,
            run,
            cases: vec![crate::db_stamp_to_model(stamp)],
        }
    };

    let _ = crate::pending_run_yaml::mark_run_yaml_pending(
        state,
        &slug,
        &run_id,
        crate::pending_run_yaml::PendingRunFlushFlags::results_only(),
    );
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(serde_json::to_value(response).unwrap_or_default())
}

// ───────────────────────────────────────────────────────────────────────
// 54. set_run_results_batch
// ───────────────────────────────────────────────────────────────────────

pub async fn set_run_results_batch(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
    payload: models::SetRunResultsBatchRequest,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let review_enabled =
        crate::project_config::load_project_test_config(&repo_path).enable_review_system;

    let response = {
        let conn = conn_arc.lock().unwrap();
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
                params![slug, run_id],
                |r| r.get::<_, i32>(0),
            )
            .optional()
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
            .is_some();
        if !exists {
            return Err(ApiError::not_found("Run not found."));
        }
        crate::set_run_results_batch_in_db(
            &conn,
            &slug,
            &run_id,
            &payload.results,
            Some(git_name.as_str()),
            review_enabled,
        )
        .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };

    if response.updated > 0 {
        let _ = crate::pending_run_yaml::mark_run_yaml_pending(
            state,
            &slug,
            &run_id,
            crate::pending_run_yaml::PendingRunFlushFlags::results_only(),
        );
        crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
        let _ = crate::broadcast_refresh(state).await;
    }
    Ok(serde_json::to_value(response).unwrap_or_default())
}

// ───────────────────────────────────────────────────────────────────────
// 55. delete_run
// ───────────────────────────────────────────────────────────────────────

pub async fn delete_run(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    {
        let conn = conn_arc.lock().unwrap();
        let row: Option<(String, i64)> = conn
            .query_row(
                "SELECT name, archived FROM test_runs WHERE repo_slug = ? AND run_id = ?",
                params![slug, run_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .ok()
            .flatten();
        if let Some((_name, archived_i)) = row {
            crate::remove_run_by_id(&repo_path, &run_id, archived_i != 0);
        }

        let _ = conn.execute(
            "DELETE FROM test_run_results WHERE run_id = ?",
            [run_id.as_str()],
        );
        let _ = crate::delete_run_comments_for_run(&conn, &slug, &run_id);
        let _ = conn.execute(
            "DELETE FROM test_run_cases WHERE repo_slug = ? AND run_id = ?",
            params![slug, run_id],
        );
        let _ = conn.execute(
            "DELETE FROM test_runs WHERE repo_slug = ? AND run_id = ?",
            params![slug, run_id],
        );
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(json!({ "status": "ok", "run_id": run_id }))
}

// ───────────────────────────────────────────────────────────────────────
// 56. restore_run
// ───────────────────────────────────────────────────────────────────────

pub async fn restore_run(
    state: &AppState,
    run_id: String,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let archived = {
        let conn = conn_arc.lock().unwrap();
        let row: Option<i64> = conn
            .query_row(
                "SELECT archived FROM test_runs WHERE repo_slug = ? AND run_id = ?",
                params![slug, run_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        let Some(a) = row else {
            return Err(ApiError::not_found("Run not found."));
        };
        a != 0
    };

    if !archived {
        return Err(ApiError::bad_request(
            "Run is not archived and cannot be restored.",
        ));
    }

    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    if let Err(msg) = crate::move_run_dir_for_archive(&repo_path, &run_id, true, false) {
        return Err(ApiError::internal(msg));
    }

    {
        let conn = conn_arc.lock().unwrap();
        if let Err(e) = crate::update_test_run_header_db(
            &conn,
            &slug,
            &run_id,
            None,
            None,
            Some(false),
            None,
            None,
            None,
            Some(git_name.as_str()),
        ) {
            return Err(ApiError::internal(format!("{e:#}")));
        }
        let new_dir = crate::run_publish::get_run_dir_rel_path(&run_id, false);
        let _ = crate::set_run_dir_path_db(&conn, &run_id, &new_dir);
        crate::run_publish::flush_run_head_yaml_from_db(&repo_path, &conn, &slug, &run_id)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    }

    let loaded_item = {
        let conn = conn_arc.lock().unwrap();
        crate::get_test_run_list_item(&conn, &slug, &run_id)
            .ok()
            .flatten()
    };

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    match loaded_item {
        Some(item) => Ok(serde_json::to_value(item).unwrap_or_default()),
        None => Err(ApiError::internal("Run restored but could not be loaded")),
    }
}

// ───────────────────────────────────────────────────────────────────────
// 57. ensure_baseline_sync
// ───────────────────────────────────────────────────────────────────────

pub async fn ensure_baseline_sync(
    state: &AppState,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    if crate::workspace::is_playground_slug(state, &slug) {
        return Ok(json!({
            "success": true,
            "message": "Playground has no remote baseline.",
            "aligned": true
        }));
    }
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let is_dirty = !crate::git_stdout(&repo_path, &["status", "--porcelain"])
        .await
        .unwrap_or_default()
        .trim()
        .is_empty();
    let run_yaml_pending = crate::pending_run_yaml::has_pending_run_yaml(state, &slug);
    if is_dirty || run_yaml_pending {
        return Ok(json!({
            "success": true,
            "message": "Workplace has unpublished work; no baseline align.",
            "aligned": true
        }));
    }

    let git_lock = crate::repo_git_lock(state, &slug);
    let _git_guard = git_lock.lock().await;
    let _ = crate::git_fetch_origin(&repo_path).await;
    let origin_ref = crate::paths::origin_work_branch_ref();
    let work_branch = crate::paths::GITOZA_WORK_BRANCH;
    let verify = crate::git_run(&repo_path, &["rev-parse", "--verify", origin_ref.as_str()]).await;
    if verify.as_ref().map(|r| r.success).unwrap_or(false) {
        let co = crate::git_run(
            &repo_path,
            &["checkout", "-B", work_branch, origin_ref.as_str()],
        )
        .await;
        if co.as_ref().map(|r| r.success).unwrap_or(false) {
            return Ok(json!({
                "success": true,
                "message": format!("Aligned to {work_branch} ({origin_ref})."),
                "aligned": true
            }));
        }
    }
    Ok(json!({
        "success": false,
        "message": format!("Remote {origin_ref} not found or checkout failed."),
        "aligned": false
    }))
}

// ───────────────────────────────────────────────────────────────────────
// 58. flush_pending_run_yaml
// ───────────────────────────────────────────────────────────────────────

pub async fn flush_pending_run_yaml(
    state: &AppState,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let flushed = crate::pending_run_yaml::flush_all_pending_run_yaml(state, &slug)
        .await
        .map_err(ApiError::internal)?;
    Ok(json!({ "status": "ok", "flushed": flushed }))
}

// ───────────────────────────────────────────────────────────────────────
// Assets: save_test_asset / resolve_and_load_asset
// ───────────────────────────────────────────────────────────────────────

pub async fn sync_pending_assets(
    state: &AppState,
    project_id: String,
) -> Result<crate::models::SyncPendingAssetsResponse, String> {
    let slug =
        crate::resolve_repo_slug(state, Some(project_id.trim())).map_err(|e| format!("{e:#}"))?;
    if !crate::is_safe_repo_slug(&slug) {
        return Err("Invalid project_id".to_string());
    }
    let repo_path = crate::resolve_repo_path(state, Some(&slug)).map_err(|e| format!("{e:#}"))?;

    let result = crate::asset_sync::sync_pending_provider_assets(state, &slug, &repo_path).await?;
    Ok(crate::models::SyncPendingAssetsResponse {
        skipped: result.skipped,
        uploaded_count: result.uploaded_count,
        failed: result
            .failures
            .into_iter()
            .map(|(file_name, message)| crate::models::PendingAssetFailure { file_name, message })
            .collect(),
    })
}

pub async fn save_test_asset(
    state: &AppState,
    project_id: String,
    file_name: String,
    file_bytes: Vec<u8>,
) -> Result<String, String> {
    let slug =
        crate::resolve_repo_slug(state, Some(project_id.trim())).map_err(|e| format!("{e:#}"))?;
    if !crate::is_safe_repo_slug(&slug) {
        return Err("Invalid project_id".to_string());
    }
    let repo_path = crate::resolve_repo_path(state, Some(&slug)).map_err(|e| format!("{e:#}"))?;

    let asset_lock = crate::asset_sync::repo_asset_lock(state, &slug);
    let _asset_guard = asset_lock.lock().await;
    let cache_path = crate::asset_store::write_cache_bytes(state, &slug, &file_name, &file_bytes)?;

    crate::asset_sync::after_cache_write(
        state,
        slug.clone(),
        repo_path,
        file_name,
        cache_path.clone(),
    )
    .await;

    crate::asset_store::absolute_path_string(&cache_path)
}

pub async fn resolve_and_load_asset(
    state: &AppState,
    project_id: String,
    file_name: String,
) -> Result<String, String> {
    let slug =
        crate::resolve_repo_slug(state, Some(project_id.trim())).map_err(|e| format!("{e:#}"))?;
    if !crate::is_safe_repo_slug(&slug) {
        return Err("Invalid project_id".to_string());
    }
    crate::asset_store::validate_file_name(&file_name)?;

    if crate::asset_store::cache_hit(state, &slug, &file_name) {
        let path = crate::asset_store::cache_file_path(state, &slug, &file_name);
        return crate::asset_store::absolute_path_string(&path);
    }

    let repo_path = crate::resolve_repo_path(state, Some(&slug)).map_err(|e| format!("{e:#}"))?;
    let path =
        crate::asset_sync::resolve_remote_into_cache(state, &slug, &repo_path, &file_name).await?;
    crate::asset_store::absolute_path_string(&path)
}

pub async fn delete_local_asset(
    state: &AppState,
    project_id: String,
    file_name: String,
) -> Result<(), String> {
    let slug =
        crate::resolve_repo_slug(state, Some(project_id.trim())).map_err(|e| format!("{e:#}"))?;
    if !crate::is_safe_repo_slug(&slug) {
        return Err("Invalid project_id".to_string());
    }
    crate::asset_store::validate_file_name(&file_name)?;

    let asset_lock = crate::asset_sync::repo_asset_lock(state, &slug);
    let _asset_guard = asset_lock.lock().await;

    crate::asset_store::delete_cache_file(state, &slug, &file_name)?;
    crate::pending_assets::remove_pending_upload(state, &slug, &file_name)?;

    Ok(())
}

// ── Test automation (CI JUnit) ───────────────────────────────────────────

pub async fn sync_automation_executions(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::AutomationSyncResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let cfg = crate::project_sync_config::load_project_sync_config(&repo_path);
    if cfg.provider_type_normalized().is_empty() {
        return Err(ApiError::bad_request(
            "Storage sync is not configured for this repository".to_string(),
        ));
    }
    crate::automation_index::sync_automation_executions(state, &cfg, &slug)
        .await
        .map_err(ApiError::internal)
}

pub async fn list_automation_pipelines(
    state: &AppState,
    repo: Option<String>,
) -> Result<Vec<models::AutomationPipelineListItem>, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    crate::automation_index::list_automation_pipelines(&conn, &slug).map_err(ApiError::internal)
}

pub async fn list_automation_executions(
    state: &AppState,
    repo: Option<String>,
    pipeline_name: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<models::AutomationExecutionListItem>, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);
    let conn = conn_arc.lock().unwrap();
    crate::automation_index::list_automation_executions(
        &conn,
        &slug,
        pipeline_name.trim(),
        limit,
        offset,
    )
    .map_err(ApiError::internal)
}

pub async fn get_automation_execution(
    state: &AppState,
    repo: Option<String>,
    execution_id: String,
) -> Result<models::AutomationExecutionDetailResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    crate::automation_index::get_automation_execution(&conn, &slug, execution_id.trim())
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Automation execution not found".to_string()))
}

pub async fn list_automation_results(
    state: &AppState,
    repo: Option<String>,
    execution_id: String,
    suite_key: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<models::AutomationResultListResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let limit = limit.unwrap_or(50).clamp(1, 5000);
    let offset = offset.unwrap_or(0).max(0);
    let conn = conn_arc.lock().unwrap();
    crate::automation_index::list_automation_results(
        &conn,
        &slug,
        execution_id.trim(),
        suite_key.as_deref(),
        limit,
        offset,
    )
    .map_err(ApiError::internal)
}

pub async fn list_automation_suites(
    state: &AppState,
    repo: Option<String>,
    execution_id: String,
) -> Result<models::AutomationSuiteListResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    crate::automation_index::list_automation_suites(&conn, &slug, execution_id.trim())
        .map_err(ApiError::internal)
}

pub async fn get_automation_result_detail(
    state: &AppState,
    repo: Option<String>,
    execution_id: String,
    case_key: Option<String>,
    junit_file: Option<String>,
    classname: Option<String>,
    name: Option<String>,
) -> Result<models::AutomationResultDetailResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let execution_id = execution_id.trim().to_string();
    let row = {
        let conn = conn_arc.lock().unwrap();
        let mut found: Option<crate::automation_index::ResultDetailRow> = None;

        if let Some(key) = case_key.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            found = crate::automation_index::load_automation_result_detail_row(
                &conn,
                &slug,
                &execution_id,
                key,
            )
            .map_err(ApiError::internal)?;
        }

        if found.is_none() {
            if let (Some(jf), Some(test_name)) = (
                junit_file
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty()),
                name.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            ) {
                let cn = classname.as_deref().map(str::trim).unwrap_or("");
                found = crate::automation_index::load_automation_result_detail_row_by_identity(
                    &conn,
                    &slug,
                    &execution_id,
                    jf,
                    cn,
                    test_name,
                )
                .map_err(ApiError::internal)?;
            } else if found.is_none()
                && case_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .is_none()
            {
                return Err(ApiError::bad_request(
                    "case_key or junit_file+name is required".to_string(),
                ));
            }
        }

        found
    };
    let Some(row) = row else {
        return Err(ApiError::not_found(
            "Automation result not found".to_string(),
        ));
    };
    let cfg = match crate::resolve_repo_path(state, Some(&slug)) {
        Ok(repo_path) => crate::project_sync_config::load_project_sync_config(&repo_path),
        Err(_) => crate::project_sync_config::ProjectSyncConfig::default(),
    };
    crate::automation_index::resolve_automation_result_detail(
        state,
        &cfg,
        &slug,
        execution_id.trim(),
        row,
    )
    .await
    .map_err(ApiError::internal)
}

// ───────────────────────────────────────────────────────────────────────
// Tickets (Tasks)
// ───────────────────────────────────────────────────────────────────────

pub async fn list_tickets(
    state: &AppState,
    repo: Option<String>,
    search: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    ticket_type: Option<String>,
    tag: Option<String>,
    assigned_to: Option<String>,
    sprint: Option<String>,
    release: Option<String>,
    project: Option<String>,
    parent: Option<String>,
    ticket_id: Option<String>,
    param_filters: Option<String>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<models::YamlTicketListResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let offset = offset.unwrap_or(0).max(0);

    let sort_by = sort_by.unwrap_or_else(|| "updated_at".to_string());
    let sort_dir = sort_dir.unwrap_or_else(|| "desc".to_string());

    let param_filters_parsed = match param_filters
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        None => None,
        Some(raw) => parse_param_filters_json(raw).map_err(|e| ApiError::bad_request(e))?,
    };

    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let assigned_to_filter =
        crate::resolve_assigned_to_query_filter(assigned_to.as_deref(), &git_name);
    if assigned_to_filter == crate::AssignedToQueryFilter::NoMatch {
        return Ok(models::YamlTicketListResponse {
            total: 0,
            items: vec![],
            limit,
            offset,
        });
    }
    let assigned_to = match assigned_to_filter {
        crate::AssignedToQueryFilter::Match(s) => Some(s),
        crate::AssignedToQueryFilter::None | crate::AssignedToQueryFilter::NoMatch => None,
    };

    let (items, total) = crate::tickets::query_tickets_db(
        &conn.lock().unwrap(),
        &slug,
        crate::tickets::QueryTicketsArgs {
            search,
            status,
            priority,
            ticket_type,
            tag,
            assigned_to,
            sprint,
            release,
            parent,
            ticket_id,
            project,
            param_filters: param_filters_parsed,
            sort_by,
            sort_dir,
            limit,
            offset,
        },
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    Ok(models::YamlTicketListResponse {
        total,
        items,
        limit,
        offset,
    })
}

pub async fn get_ticket_filters(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::YamlTicketFilters, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn.lock().unwrap();
    Ok(models::YamlTicketFilters {
        statuses: crate::tickets::distinct_ticket_values(&conn, &slug, "status")
            .unwrap_or_default(),
        priorities: crate::tickets::distinct_ticket_values(&conn, &slug, "priority")
            .unwrap_or_default(),
        types: crate::tickets::distinct_ticket_values(&conn, &slug, "type").unwrap_or_default(),
        tags: crate::tickets::all_ticket_tags(&conn, &slug).unwrap_or_default(),
        assigned_to: crate::dedupe_assignees_case_insensitive(
            crate::tickets::distinct_ticket_values(&conn, &slug, "assigned_to").unwrap_or_default(),
        ),
        sprints: crate::tickets::distinct_ticket_values(&conn, &slug, "sprint").unwrap_or_default(),
        releases: crate::tickets::distinct_ticket_values(&conn, &slug, "release")
            .unwrap_or_default(),
        param_keys: crate::tickets::all_ticket_param_keys(&conn, &slug).unwrap_or_default(),
        param_values_by_key: crate::tickets::all_ticket_param_values_by_key(&conn, &slug)
            .unwrap_or_default(),
    })
}

pub async fn get_ticket_detail(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
) -> Result<models::YamlTicketDetail, ApiError> {
    let file_path = crate::tickets::validate_ticket_file_path_for_write(&file_path)
        .map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let full_path = repo_path.join(&file_path);
    match crate::tickets::read_ticket_yaml(&full_path) {
        Ok(Some(mut d)) => {
            d.file_path = file_path.clone();
            if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
                let conn = conn_arc.lock().unwrap();
                crate::tickets::apply_ticket_audit_from_db(&conn, &slug, &file_path, &mut d);
            }
            Ok(d)
        }
        Ok(None) => Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => Err(ApiError::not_found(format!("{e:#}"))),
    }
}

pub async fn list_ticket_projects(
    state: &AppState,
    repo: Option<String>,
    archived_only: Option<bool>,
) -> Result<Vec<models::RepositoryTreeNode>, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let filter = if archived_only.unwrap_or(false) {
        crate::tickets::TicketProjectListFilter::ArchivedOnly
    } else {
        crate::tickets::TicketProjectListFilter::ActiveOnly
    };
    let nodes =
        crate::tickets::list_ticket_projects(&conn.lock().unwrap(), &repo_path, &slug, filter)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(nodes)
}

pub async fn create_ticket_project(
    state: &AppState,
    payload: models::CreateTicketProjectRequest,
) -> Result<models::CreateTicketProjectResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let name = payload.project_name.trim().to_string();
    if !crate::is_valid_project_name(&name)
        || name == crate::tickets::TICKETS_RESERVED_DIR
        || name == crate::tickets::TICKETS_RELEASES_DIR
    {
        return Err(ApiError::bad_request(
            "Invalid project name. Use only letters, numbers, underscores, and hyphens.",
        ));
    }

    let project_dir = repo_path.join(crate::tickets::TICKETS_ROOT_REL).join(&name);
    if project_dir.exists() {
        return Err(ApiError::conflict(format!(
            "Project '{name}' already exists."
        )));
    }
    crate::tickets::ensure_ticket_project_dir(&repo_path, &name)
        .map_err(|e| ApiError::internal(format!("Failed to create project directory: {e:#}")))?;

    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    let ticket_prefix = {
        let conn = conn_arc.lock().unwrap();
        crate::tickets::ensure_project_prefix(&repo_path, &conn, &slug, &name)
            .map_err(|e| ApiError::internal(format!("Failed to allocate ticket prefix: {e:#}")))?
    };

    let project_rel = crate::file_rel_from_repo(&repo_path, &project_dir);
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::CreateTicketProjectResponse {
        status: "ok".to_string(),
        project_name: name,
        project_path: project_rel,
        ticket_prefix,
    })
}

pub async fn get_ticket_project(
    state: &AppState,
    project_name: String,
    repo: Option<String>,
) -> Result<models::TicketProjectDetail, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let name = project_name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Project name is required."));
    }
    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    crate::tickets::get_ticket_project(&conn, &repo_path, &slug, &name).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("not found") || msg.contains("Invalid") {
            ApiError::bad_request(format!("{e:#}"))
        } else {
            ApiError::internal(format!("{e:#}"))
        }
    })
}

pub async fn update_ticket_project(
    state: &AppState,
    payload: models::UpdateTicketProjectRequest,
) -> Result<models::TicketProjectDetail, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let name = payload.project_name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Project name is required."));
    }
    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    let detail = {
        let conn = conn_arc.lock().unwrap();
        crate::tickets::update_ticket_project(
            &conn,
            &repo_path,
            &slug,
            &name,
            &payload.description,
        )
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("archived") || msg.contains("not found") || msg.contains("Invalid") {
                ApiError::bad_request(format!("{e:#}"))
            } else {
                ApiError::internal(format!("{e:#}"))
            }
        })?
    };
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(detail)
}

pub async fn get_ticket_project_breakdown(
    state: &AppState,
    project_name: String,
    repo: Option<String>,
) -> Result<models::TicketProjectBreakdownResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let name = project_name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Project name is required."));
    }
    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    crate::tickets::get_ticket_project_breakdown(&conn, &slug, &name).map_err(|e| {
        if e.to_string().contains("required") {
            ApiError::bad_request(e.to_string())
        } else {
            ApiError::internal(format!("{e:#}"))
        }
    })
}

pub async fn get_release_ticket_breakdown(
    state: &AppState,
    release_id: String,
    repo: Option<String>,
) -> Result<models::TicketProjectBreakdownResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let id = release_id.trim().to_string();
    if id.is_empty() {
        return Err(ApiError::bad_request("Release id is required."));
    }
    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    crate::tickets::get_release_ticket_breakdown(&conn, &slug, &id).map_err(|e| {
        if e.to_string().contains("required") {
            ApiError::bad_request(e.to_string())
        } else {
            ApiError::internal(format!("{e:#}"))
        }
    })
}

pub async fn set_ticket_project_archived(
    state: &AppState,
    payload: models::SetTicketProjectArchivedRequest,
) -> Result<models::TicketProjectMutationResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let name = payload.project_name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Project name is required."));
    }
    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    {
        let conn = conn_arc.lock().unwrap();
        crate::tickets::set_ticket_project_archived(
            &conn,
            &repo_path,
            &slug,
            &name,
            payload.archived,
        )
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    }
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::TicketProjectMutationResponse {
        status: "ok".to_string(),
        project_name: name,
    })
}

pub async fn delete_ticket_project(
    state: &AppState,
    payload: models::DeleteTicketProjectRequest,
) -> Result<models::TicketProjectMutationResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let name = payload.project_name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Project name is required."));
    }
    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    {
        let conn = conn_arc.lock().unwrap();
        crate::tickets::delete_ticket_project(&conn, &repo_path, &slug, &name)
            .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    }
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::TicketProjectMutationResponse {
        status: "ok".to_string(),
        project_name: name,
    })
}

pub async fn create_ticket(
    state: &AppState,
    payload: models::CreateTicketRequest,
) -> Result<models::CreateTicketResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let project = payload.project.trim().to_string();
    if !crate::is_valid_project_name(&project)
        || project == crate::tickets::TICKETS_RESERVED_DIR
        || project == crate::tickets::TICKETS_RELEASES_DIR
    {
        return Err(ApiError::bad_request(
            "Invalid project name. Use only letters, numbers, underscores, and hyphens.",
        ));
    }

    let project_dir = crate::tickets::ensure_ticket_project_dir(&repo_path, &project)
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;

    {
        let conn = conn_arc.lock().unwrap();
        if crate::tickets::is_ticket_project_archived(&conn, &repo_path, &slug, &project) {
            return Err(ApiError::bad_request(
                "Cannot create tickets in an archived project. Restore the project first.",
            ));
        }
    }

    let ticket_id = {
        let requested = payload.ticket_id.trim().to_string();
        if requested.is_empty() {
            let conn = conn_arc.lock().unwrap();
            let prefix = crate::tickets::ensure_project_prefix(&repo_path, &conn, &slug, &project)
                .map_err(|e| {
                    ApiError::internal(format!("Failed to resolve ticket prefix: {e:#}"))
                })?;
            crate::tickets::generate_unique_ticket_id(
                &conn,
                &repo_path,
                &slug,
                &project_dir,
                &prefix,
            )
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
        } else {
            if !crate::tickets::is_valid_ticket_id(&requested) {
                return Err(ApiError::bad_request(
                    "Invalid ticket_id. Use letters, numbers, underscores, and hyphens.",
                ));
            }
            let taken = {
                let conn = conn_arc.lock().unwrap();
                crate::case_ids::entity_id_taken_in_repo(&conn, &repo_path, &slug, &requested)
            };
            if taken {
                return Err(ApiError::conflict(format!(
                    "Ticket '{requested}' already exists in this repository (ticket or case)."
                )));
            }
            let file_path = project_dir.join(format!("{requested}.md"));
            if file_path.exists() {
                return Err(ApiError::conflict(format!(
                    "Ticket '{requested}' already exists in project '{project}'."
                )));
            }
            requested
        }
    };

    let file_path = project_dir.join(format!("{ticket_id}.md"));
    if file_path.exists() {
        return Err(ApiError::conflict(format!(
            "Ticket '{ticket_id}' already exists in project '{project}'."
        )));
    }

    let now_iso = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;

    let assigned_to_canonical = if payload.assigned_to.trim().is_empty() {
        None
    } else {
        let conn = conn_arc.lock().unwrap();
        crate::canonicalize_assignee_for_repo(&conn, &slug, &payload.assigned_to)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };

    let mut fm: IndexMap<String, serde_yaml::Value> = IndexMap::new();
    fm.insert(
        "title".to_string(),
        serde_yaml::Value::String(payload.title.trim().to_string()),
    );
    let tags_for_yaml = crate::normalize_tags_for_storage(payload.tags.clone());
    if !tags_for_yaml.is_empty() {
        fm.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(
                tags_for_yaml
                    .into_iter()
                    .map(serde_yaml::Value::String)
                    .collect(),
            ),
        );
    }
    let type_for_yaml = payload.ticket_type.trim().to_lowercase();
    fm.insert(
        "type".to_string(),
        serde_yaml::Value::String(if type_for_yaml.is_empty() {
            "task".to_string()
        } else {
            type_for_yaml.clone()
        }),
    );
    let status_for_yaml = payload.status.trim().to_lowercase();
    fm.insert(
        "status".to_string(),
        serde_yaml::Value::String(if status_for_yaml.is_empty() {
            "open".to_string()
        } else {
            status_for_yaml.clone()
        }),
    );
    let priority_for_yaml = payload.priority.trim().to_lowercase();
    fm.insert(
        "priority".to_string(),
        serde_yaml::Value::String(if priority_for_yaml.is_empty() {
            "medium".to_string()
        } else {
            priority_for_yaml.clone()
        }),
    );
    let reporter = if payload.reporter.trim().is_empty() {
        git_name.clone()
    } else {
        payload.reporter.trim().to_string()
    };
    fm.insert(
        "reporter".to_string(),
        serde_yaml::Value::String(reporter.clone()),
    );
    if let Some(ref at) = assigned_to_canonical {
        fm.insert(
            "assigned_to".to_string(),
            serde_yaml::Value::String(at.clone()),
        );
    }
    if !payload.sprint.trim().is_empty() {
        fm.insert(
            "sprint".to_string(),
            serde_yaml::Value::String(payload.sprint.trim().to_string()),
        );
    }
    if !payload.release.trim().is_empty() {
        fm.insert(
            "release".to_string(),
            serde_yaml::Value::String(payload.release.trim().to_string()),
        );
    }
    if !payload.parent.trim().is_empty() {
        fm.insert(
            "parent".to_string(),
            serde_yaml::Value::String(payload.parent.trim().to_string()),
        );
    }
    let params_for_yaml = crate::normalize_params_for_storage(payload.params.clone());
    if !params_for_yaml.is_empty() {
        fm.insert(
            "params".to_string(),
            crate::params_to_yaml_value(&params_for_yaml),
        );
    }

    let body = payload.body.unwrap_or_default();

    crate::write_full_yaml(&file_path, &fm, &body)
        .map_err(|e| ApiError::internal(format!("Failed to write YAML: {e:#}")))?;

    let file_rel = crate::file_rel_from_repo(&repo_path, &file_path);
    let upsert = crate::tickets::UpsertTicketArgs {
        ticket_id: ticket_id.clone(),
        title: Some(payload.title.trim().to_string()).filter(|s| !s.is_empty()),
        tags: crate::normalize_tags_for_storage(payload.tags.clone()),
        ticket_type: Some(if type_for_yaml.is_empty() {
            "task".to_string()
        } else {
            type_for_yaml
        }),
        status: Some(if status_for_yaml.is_empty() {
            "open".to_string()
        } else {
            status_for_yaml
        }),
        priority: Some(if priority_for_yaml.is_empty() {
            "medium".to_string()
        } else {
            priority_for_yaml
        }),
        file_path: file_rel.clone(),
        repo_slug: slug.clone(),
        updated_at: Some(now_iso),
        updated_by: Some(git_name),
        assigned_to: assigned_to_canonical,
        reporter: Some(reporter),
        sprint: Some(payload.sprint.trim().to_string()).filter(|s| !s.is_empty()),
        release: Some(payload.release.trim().to_string()).filter(|s| !s.is_empty()),
        parent: Some(payload.parent.trim().to_string()).filter(|s| !s.is_empty()),
        params: params_for_yaml,
    };
    {
        let conn = conn_arc.lock().unwrap();
        crate::tickets::upsert_ticket_db(&conn, upsert)
            .map_err(|e| ApiError::internal(format!("Failed to update SQLite index: {e:#}")))?;
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::CreateTicketResponse {
        status: "ok".to_string(),
        file_path: file_rel,
        ticket_id,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn update_ticket(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
    title: String,
    tags: Vec<String>,
    status: String,
    priority: String,
    ticket_type: Option<String>,
    body: Option<String>,
    assigned_to: Option<String>,
    sprint: Option<String>,
    release: Option<String>,
    parent: Option<String>,
    params: Option<BTreeMap<String, String>>,
) -> Result<serde_json::Value, ApiError> {
    let file_path = crate::tickets::validate_ticket_file_path_for_write(&file_path)
        .map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found("Ticket file not found"));
    }

    let existing = match crate::tickets::read_ticket_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };

    let incoming_title = title.trim().to_string();
    let incoming_priority = priority.trim().to_lowercase();
    let incoming_status = status.trim().to_lowercase();
    let incoming_type = ticket_type
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .or_else(|| existing.ticket_type.clone())
        .unwrap_or_else(|| "task".to_string());
    let incoming_tags = crate::normalize_tags_for_storage(tags.clone());
    let existing_tags = crate::normalize_tags_for_storage(existing.tags.clone());
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let mut incoming_assigned_to =
        crate::resolve_optional_string_patch(assigned_to.as_deref(), &existing.assigned_to);
    if let Some(ref raw) = incoming_assigned_to {
        let conn = conn_arc.lock().unwrap();
        incoming_assigned_to = crate::canonicalize_assignee_for_repo(&conn, &slug, raw)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    }
    let incoming_sprint = crate::resolve_optional_string_patch(sprint.as_deref(), &existing.sprint);
    let incoming_release =
        crate::resolve_optional_string_patch(release.as_deref(), &existing.release);
    let incoming_parent = crate::resolve_optional_string_patch(parent.as_deref(), &existing.parent);
    let incoming_params = match params {
        Some(p) => crate::normalize_params_for_storage(p),
        None => crate::normalize_params_for_storage(existing.params.clone()),
    };
    let existing_params = crate::normalize_params_for_storage(existing.params.clone());
    let incoming_body = body.clone().unwrap_or_else(|| existing.body.clone());

    let is_noop = incoming_title
        == existing
            .title
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string()
        && incoming_priority
            == existing
                .priority
                .clone()
                .unwrap_or_else(|| "medium".to_string())
                .trim()
                .to_lowercase()
        && incoming_status
            == existing
                .status
                .clone()
                .unwrap_or_else(|| "open".to_string())
                .trim()
                .to_lowercase()
        && Some(incoming_type.clone()) == existing.ticket_type
        && incoming_tags == existing_tags
        && crate::assignees_equal_ignore_case(
            incoming_assigned_to.as_deref(),
            existing.assigned_to.as_deref(),
        )
        && incoming_sprint == existing.sprint
        && incoming_release == existing.release
        && incoming_parent == existing.parent
        && incoming_params == existing_params
        && incoming_body.trim() == existing.body.trim();
    if is_noop {
        return match crate::tickets::read_ticket_yaml(&full_path) {
            Ok(Some(mut d)) => {
                d.file_path = file_path.clone();
                crate::tickets::apply_ticket_audit_from_db(
                    &conn_arc.lock().unwrap(),
                    &slug,
                    &file_path,
                    &mut d,
                );
                Ok(serde_json::to_value(d).unwrap_or_default())
            }
            _ => Ok(json!({ "status": "ok" })),
        };
    }

    let now = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let mut updated = existing.clone();
    updated.title = Some(incoming_title.clone());
    updated.tags = incoming_tags.clone();
    updated.status = Some(incoming_status.clone());
    updated.priority = Some(incoming_priority.clone());
    updated.ticket_type = Some(incoming_type.clone());
    updated.assigned_to = incoming_assigned_to.clone();
    updated.sprint = incoming_sprint.clone();
    updated.release = incoming_release.clone();
    updated.parent = incoming_parent.clone();
    updated.params = incoming_params.clone();
    updated.body = incoming_body.clone();
    updated.updated_at = Some(now.clone());
    updated.updated_by = Some(git_name.clone());

    let fm = crate::tickets::ticket_detail_to_front_matter(&updated);
    let fm = crate::reconcile_desired_front_matter_with_disk(&existing.raw, &fm);
    let fm_unchanged = crate::front_matter_matches_desired(&existing.raw, &fm);
    crate::write_yaml_update_preserving_order(
        &full_path,
        &existing.raw,
        &fm,
        &incoming_body,
        fm_unchanged,
    )
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::tickets::upsert_ticket_db(
            &conn,
            crate::tickets::UpsertTicketArgs {
                ticket_id: updated.ticket_id.clone(),
                title: updated.title.clone(),
                tags: incoming_tags,
                ticket_type: updated.ticket_type.clone(),
                status: updated.status.clone(),
                priority: updated.priority.clone(),
                file_path: file_path.clone(),
                repo_slug: slug.clone(),
                updated_at: Some(now),
                updated_by: Some(git_name),
                assigned_to: incoming_assigned_to,
                reporter: updated.reporter.clone(),
                sprint: incoming_sprint,
                release: incoming_release,
                parent: incoming_parent,
                params: incoming_params,
            },
        );
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    updated.file_path = file_path;
    Ok(serde_json::to_value(updated).unwrap_or_default())
}

pub async fn rename_ticket(
    state: &AppState,
    payload: models::RenameTicketRequest,
) -> Result<models::RenameTicketResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let file_path = crate::tickets::validate_ticket_file_path_for_write(&payload.file_path)
        .map_err(ApiError::bad_request)?;
    let new_ticket_id = payload.new_ticket_id.trim().to_string();
    if !crate::tickets::is_valid_ticket_id(&new_ticket_id) {
        return Err(ApiError::bad_request(
            "Invalid new_ticket_id. Use only letters, numbers, underscores, and hyphens.",
        ));
    }

    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found(format!(
            "Ticket file not found: {file_path}"
        )));
    }
    let suffix = full_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("md")
        .to_ascii_lowercase();
    let cur_stem = full_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    if new_ticket_id == cur_stem {
        return Ok(models::RenameTicketResponse {
            status: "ok".to_string(),
            old_path: file_path.clone(),
            new_path: file_path,
            ticket_id: new_ticket_id,
        });
    }
    let dest = full_path
        .parent()
        .unwrap_or(&repo_path)
        .join(format!("{new_ticket_id}.{suffix}"));
    if dest.exists() {
        return Err(ApiError::conflict(format!(
            "A ticket named '{new_ticket_id}.{suffix}' already exists."
        )));
    }
    std::fs::rename(&full_path, &dest)
        .map_err(|e| ApiError::internal(format!("Failed to rename ticket file: {e:#}")))?;
    let new_rel = crate::file_rel_from_repo(&repo_path, &dest);

    let conn_arc = crate::open_repo_db(state, &slug)
        .map_err(|e| ApiError::internal(format!("Failed to open DB: {e:#}")))?;
    {
        let conn = conn_arc.lock().unwrap();
        let updated = crate::tickets::remap_ticket_file_path(
            &conn,
            &slug,
            &file_path,
            &new_rel,
            &new_ticket_id,
        )
        .map_err(|e| ApiError::internal(format!("Failed to remap ticket index: {e:#}")))?;
        if updated == 0 {
            return Err(ApiError::not_found(format!(
                "Ticket index entry not found for: {file_path}"
            )));
        }
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::RenameTicketResponse {
        status: "ok".to_string(),
        old_path: file_path,
        new_path: new_rel,
        ticket_id: new_ticket_id,
    })
}

pub async fn post_ticket_comment(
    state: &AppState,
    file_path: String,
    text: String,
    repo: Option<String>,
) -> Result<models::YamlTicketDetail, ApiError> {
    let file_path = crate::tickets::validate_ticket_file_path_for_write(&file_path)
        .map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found("Ticket file not found"));
    }
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(ApiError::bad_request("Comment text cannot be empty"));
    }
    let mut existing = match crate::tickets::read_ticket_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };
    let now = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    existing.comments.push(models::Comment {
        author: git_name,
        timestamp: now,
        text,
    });
    let fm = crate::tickets::ticket_detail_to_front_matter(&existing);
    crate::write_yaml_from_existing_raw(&full_path, &existing.raw, &fm, &existing.body)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    existing.file_path = file_path;
    Ok(existing)
}

pub async fn delete_ticket_comment(
    state: &AppState,
    file_path: String,
    index: usize,
    repo: Option<String>,
) -> Result<models::YamlTicketDetail, ApiError> {
    let file_path = crate::tickets::validate_ticket_file_path_for_write(&file_path)
        .map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found("Ticket file not found"));
    }
    let mut existing = match crate::tickets::read_ticket_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    if let Err(e) = crate::remove_comment_at_index(&mut existing.comments, index, &git_name) {
        return Err(comment_delete_error(e));
    }
    let fm = crate::tickets::ticket_detail_to_front_matter(&existing);
    crate::write_yaml_from_existing_raw(&full_path, &existing.raw, &fm, &existing.body)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    existing.file_path = file_path;
    Ok(existing)
}

pub async fn reindex_tickets(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::YamlIndexStats, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let indexed = {
        let conn = conn_arc.lock().unwrap();
        crate::tickets::reindex_tickets_for_repo(&conn, &repo_path, &slug)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };
    let _ = crate::stamp_indexed_head(state, &repo_path, &slug).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::YamlIndexStats {
        repo_slug: slug,
        indexed,
        errors: 0,
        removed: 0,
        directories: 0,
    })
}

// ───────────────────────────────────────────────────────────────────────
// Wiki
// ───────────────────────────────────────────────────────────────────────

pub async fn list_wiki_pages(
    state: &AppState,
    repo: Option<String>,
    search: Option<String>,
    tag: Option<String>,
    status: Option<String>,
    folder: Option<String>,
    page_id: Option<String>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    include_archived: Option<bool>,
    archived_only: Option<bool>,
) -> Result<models::YamlWikiPageListResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let limit = limit.unwrap_or(5000).clamp(1, 10000);
    let offset = offset.unwrap_or(0).max(0);
    let archived_only = archived_only.unwrap_or(false);
    let include_archived = include_archived.unwrap_or(false);
    let exclude_archived = !include_archived && !archived_only;
    let (items, total) = crate::wiki::query_wiki_pages_db(
        &conn.lock().unwrap(),
        &slug,
        crate::wiki::QueryWikiPagesArgs {
            search,
            tag,
            status,
            folder,
            page_id,
            sort_by: sort_by.unwrap_or_else(|| "title".to_string()),
            sort_dir: sort_dir.unwrap_or_else(|| "asc".to_string()),
            limit,
            offset,
            exclude_archived,
            archived_only,
        },
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(models::YamlWikiPageListResponse {
        total,
        items,
        limit,
        offset,
    })
}

pub async fn get_wiki_filters(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::YamlWikiFilters, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let tags = crate::wiki::all_wiki_tags(&conn.lock().unwrap(), &slug).unwrap_or_default();
    Ok(models::YamlWikiFilters { tags })
}

pub async fn get_wiki_page_detail(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
) -> Result<models::YamlWikiPageDetail, ApiError> {
    let file_path =
        crate::wiki::validate_wiki_file_path_for_read(&file_path).map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let full_path = repo_path.join(&file_path);
    match crate::wiki::read_wiki_yaml(&full_path) {
        Ok(Some(mut d)) => {
            d.file_path = file_path.clone();
            d.folder = crate::wiki::wiki_folder_from_path(&file_path).unwrap_or_default();
            if d.page_id.trim().is_empty() {
                d.page_id = crate::wiki::wiki_page_id_from_path(&file_path).unwrap_or_default();
            }
            if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
                let conn = conn_arc.lock().unwrap();
                crate::wiki::apply_wiki_audit_from_db(&conn, &slug, &file_path, &mut d);
            }
            Ok(d)
        }
        Ok(None) => Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => Err(ApiError::not_found(format!("{e:#}"))),
    }
}

pub async fn get_wiki_tree(
    state: &AppState,
    repo: Option<String>,
    archive_mode: Option<bool>,
) -> Result<Vec<models::RepositoryTreeNode>, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let nodes = crate::wiki::list_wiki_tree(
        &conn.lock().unwrap(),
        &repo_path,
        &slug,
        archive_mode.unwrap_or(false),
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(nodes)
}

pub async fn create_wiki_folder(
    state: &AppState,
    payload: models::CreateWikiFolderRequest,
) -> Result<models::CreateWikiFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;

    let parent_path = crate::wiki::validate_wiki_folder_path(&payload.parent_path)
        .map_err(ApiError::bad_request)?;
    let parent_dir = repo_path.join(&parent_path);
    crate::wiki::ensure_wiki_folder_dir(&repo_path, &parent_path)
        .map_err(|e| ApiError::internal(format!("Failed to create parent folder: {e:#}")))?;
    if !parent_dir.is_dir() {
        return Err(ApiError::not_found(format!(
            "Parent folder not found: {parent_path}"
        )));
    }

    let folder_name =
        crate::wiki::allocate_unique_wiki_folder_name(&parent_dir, &payload.folder_name)
            .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let new_rel = if parent_path == crate::wiki::WIKI_ROOT_REL {
        format!("{}/{folder_name}", crate::wiki::WIKI_ROOT_REL)
    } else {
        format!("{parent_path}/{folder_name}")
    };
    crate::wiki::ensure_wiki_folder_dir(&repo_path, &new_rel)
        .map_err(|e| ApiError::internal(format!("Failed to create folder: {e:#}")))?;

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::CreateWikiFolderResponse {
        status: "ok".to_string(),
        folder_name,
        folder_path: new_rel,
    })
}

pub async fn create_wiki_page(
    state: &AppState,
    payload: models::CreateWikiPageRequest,
) -> Result<models::CreateWikiPageResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let folder =
        crate::wiki::validate_wiki_folder_path(&payload.folder).map_err(ApiError::bad_request)?;
    let folder_dir = crate::wiki::ensure_wiki_folder_dir(&repo_path, &folder)
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let title = payload.title.trim().to_string();
    if title.is_empty() {
        return Err(ApiError::bad_request("Wiki page name is required."));
    }

    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let page_id = {
        let conn = conn_arc.lock().unwrap();
        crate::wiki::generate_unique_wiki_id(&conn, &slug, &repo_path)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };
    let file_path = folder_dir.join(format!("{page_id}.md"));
    if file_path.exists() {
        return Err(ApiError::conflict(format!(
            "A wiki page file named '{page_id}.md' already exists. Retry create."
        )));
    }

    let now_iso = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let tags = crate::normalize_tags_for_storage(payload.tags.clone());
    let mut fm: IndexMap<String, serde_yaml::Value> = IndexMap::new();
    fm.insert(
        "title".to_string(),
        serde_yaml::Value::String(title.clone()),
    );
    // Wiki pages default to `draft` unless explicitly changed in the editor.
    fm.insert(
        "status".to_string(),
        serde_yaml::Value::String("draft".to_string()),
    );
    if !tags.is_empty() {
        fm.insert(
            "tags".to_string(),
            serde_yaml::Value::Sequence(
                tags.iter()
                    .cloned()
                    .map(serde_yaml::Value::String)
                    .collect(),
            ),
        );
    }
    let body = payload.body.unwrap_or_else(|| format!("# {title}\n\n"));
    crate::write_full_yaml(&file_path, &fm, &body)
        .map_err(|e| ApiError::internal(format!("Failed to write YAML: {e:#}")))?;

    let file_rel = crate::file_rel_from_repo(&repo_path, &file_path);
    let folder_rel = crate::wiki::wiki_folder_from_path(&file_rel).unwrap_or_default();
    {
        let conn = conn_arc.lock().unwrap();
        crate::wiki::upsert_wiki_page_db(
            &conn,
            crate::wiki::UpsertWikiPageArgs {
                page_id: page_id.clone(),
                title: Some(title),
                tags,
                status: Some("draft".to_string()),
                folder: folder_rel,
                file_path: file_rel.clone(),
                repo_slug: slug.clone(),
                updated_at: Some(now_iso),
                updated_by: Some(git_name),
            },
        )
        .map_err(|e| ApiError::internal(format!("Failed to update SQLite index: {e:#}")))?;
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::CreateWikiPageResponse {
        status: "ok".to_string(),
        file_path: file_rel,
        page_id,
    })
}

pub async fn update_wiki_page(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
    title: String,
    tags: Vec<String>,
    status: Option<String>,
    body: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let file_path = crate::wiki::validate_wiki_file_path_for_write(&file_path)
        .map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_lock = crate::repo_git_lock(state, &slug);
    let _repo_guard = repo_lock.lock().await;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found("Wiki page not found"));
    }

    let existing = match crate::wiki::read_wiki_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => return Err(ApiError::unprocessable("Could not parse YAML")),
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };

    let incoming_title = title.trim().to_string();
    let incoming_tags = crate::normalize_tags_for_storage(tags.clone());
    let incoming_status = status
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let existing_tags = crate::normalize_tags_for_storage(existing.tags.clone());
    let incoming_body = body.clone().unwrap_or_else(|| existing.body.clone());
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;

    let is_noop = incoming_title
        == existing
            .title
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string()
        && incoming_tags == existing_tags
        && incoming_status == existing.status
        && incoming_body.trim() == existing.body.trim();
    if is_noop {
        return match crate::wiki::read_wiki_yaml(&full_path) {
            Ok(Some(mut d)) => {
                d.file_path = file_path.clone();
                d.folder = crate::wiki::wiki_folder_from_path(&file_path).unwrap_or_default();
                crate::wiki::apply_wiki_audit_from_db(
                    &conn_arc.lock().unwrap(),
                    &slug,
                    &file_path,
                    &mut d,
                );
                Ok(serde_json::to_value(d).unwrap_or_default())
            }
            _ => Ok(json!({ "status": "ok" })),
        };
    }

    let now = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let mut updated = existing.clone();
    updated.title = Some(incoming_title.clone());
    updated.tags = incoming_tags.clone();
    updated.status = incoming_status;
    updated.body = incoming_body.clone();
    updated.updated_at = Some(now.clone());
    updated.updated_by = Some(git_name.clone());
    updated.file_path = file_path.clone();
    updated.folder = crate::wiki::wiki_folder_from_path(&file_path).unwrap_or_default();
    if updated.page_id.trim().is_empty() {
        updated.page_id = crate::wiki::wiki_page_id_from_path(&file_path).unwrap_or_default();
    }

    let fm = crate::wiki::wiki_detail_to_front_matter(&updated);
    let fm = crate::reconcile_desired_front_matter_with_disk(&existing.raw, &fm);
    let fm_unchanged = crate::front_matter_matches_desired(&existing.raw, &fm);
    crate::write_yaml_update_preserving_order(
        &full_path,
        &existing.raw,
        &fm,
        &incoming_body,
        fm_unchanged,
    )
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    {
        let conn = conn_arc.lock().unwrap();
        crate::wiki::upsert_wiki_page_db(
            &conn,
            crate::wiki::UpsertWikiPageArgs {
                page_id: updated.page_id.clone(),
                title: updated.title.clone(),
                tags: incoming_tags,
                status: updated.status.clone(),
                folder: updated.folder.clone(),
                file_path: file_path.clone(),
                repo_slug: slug.clone(),
                updated_at: Some(now),
                updated_by: Some(git_name),
            },
        )
        .map_err(|e| ApiError::internal(format!("Failed to update SQLite index: {e:#}")))?;
        crate::wiki::apply_wiki_audit_from_db(&conn, &slug, &file_path, &mut updated);
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(serde_json::to_value(updated).unwrap_or_default())
}

pub async fn reindex_wiki(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::YamlIndexStats, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let indexed = {
        let conn = conn_arc.lock().unwrap();
        crate::wiki::reindex_wiki_for_repo(&conn, &repo_path, &slug)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };
    let _ = crate::stamp_indexed_head(state, &repo_path, &slug).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::YamlIndexStats {
        repo_slug: slug,
        indexed,
        errors: 0,
        removed: 0,
        directories: 0,
    })
}

fn map_wiki_disk_err(e: String) -> ApiError {
    let lower = e.to_lowercase();
    if lower.contains("not found") {
        ApiError::not_found(e)
    } else if lower.contains("already exists") {
        ApiError::conflict(e)
    } else if lower.contains("parse") {
        ApiError::unprocessable(e)
    } else if lower.starts_with("failed") {
        ApiError::internal(e)
    } else {
        ApiError::bad_request(e)
    }
}

async fn reindex_wiki_and_broadcast_with_local_stamp(
    state: &AppState,
    slug: &str,
    repo_path: &std::path::Path,
    stamp_paths: &[String],
    git_name: &str,
) {
    if let Ok(conn_arc) = crate::open_repo_db(state, slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::wiki::reindex_wiki_for_repo(&conn, repo_path, slug);
        if !stamp_paths.is_empty() && !git_name.trim().is_empty() {
            let now = Utc::now().to_rfc3339();
            let _ = crate::wiki::stamp_wiki_audit_in_db(&conn, slug, stamp_paths, git_name, &now);
        }
    }
    crate::mark_workplace_editing_best_effort(state, slug, repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
}

fn wiki_parent_rel_for_prune(repo_path: &std::path::Path, file_path: &str) -> Option<String> {
    let full_path = repo_path.join(file_path);
    full_path
        .parent()
        .map(|parent| crate::file_rel_from_repo(repo_path, parent))
}

pub async fn move_wiki_page(
    state: &AppState,
    payload: models::MoveCaseRequest,
) -> Result<models::MoveCaseResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let file_path = crate::wiki::validate_wiki_file_path_for_write(&payload.file_path)
        .map_err(ApiError::bad_request)?;
    let target_folder = crate::wiki::validate_wiki_folder_path(&payload.target_folder)
        .map_err(ApiError::bad_request)?;
    if crate::wiki::is_archived_wiki_path(&file_path)
        || crate::wiki::is_archived_wiki_path(&target_folder)
    {
        return Err(ApiError::bad_request(
            "Moving wiki pages into or out of archived paths is not supported.",
        ));
    }

    let src = repo_path.join(&file_path);
    if !src.is_file() {
        return Err(ApiError::not_found(format!(
            "Wiki page not found: {file_path}"
        )));
    }
    crate::wiki::ensure_wiki_folder_dir(&repo_path, &target_folder)
        .map_err(|e| ApiError::internal(format!("Failed to create target folder: {e:#}")))?;
    let file_name = src
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_else(|| "page.md".into());
    let dest = repo_path.join(&target_folder).join(&file_name);
    if dest == src {
        return Ok(models::MoveCaseResponse {
            status: "ok".to_string(),
            old_path: file_path.clone(),
            new_path: file_path,
        });
    }
    if dest.exists() {
        return Err(ApiError::conflict(format!(
            "A wiki page named '{}' already exists in the target folder.",
            src.file_name().unwrap_or_default().to_string_lossy()
        )));
    }
    std::fs::rename(&src, &dest)
        .map_err(|e| ApiError::internal(format!("Failed to move wiki page: {e:#}")))?;
    let new_rel = crate::file_rel_from_repo(&repo_path, &dest);
    if let Some(parent_rel) = wiki_parent_rel_for_prune(&repo_path, &file_path) {
        crate::wiki::prune_empty_wiki_dirs_upward(&repo_path, &parent_rel);
    }
    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::wiki::remap_wiki_file_path(&conn, &slug, &file_path, &new_rel);
    }
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::MoveCaseResponse {
        status: "ok".to_string(),
        old_path: file_path,
        new_path: new_rel,
    })
}

pub async fn move_wiki_pages(
    state: &AppState,
    payload: models::MoveWikiPagesRequest,
) -> Result<models::MoveWikiPagesResponse, ApiError> {
    let mut moved = Vec::new();
    let mut failed_paths = Vec::new();
    for file_path in payload.file_paths {
        let fp = file_path.trim().replace('\\', "/");
        if fp.is_empty() {
            continue;
        }
        let one = models::MoveCaseRequest {
            file_path: fp.clone(),
            target_folder: payload.target_folder.clone(),
            repo: payload.repo.clone(),
        };
        match move_wiki_page(state, one).await {
            Ok(res) => moved.push(res),
            Err(_) => failed_paths.push(fp),
        }
    }
    if moved.is_empty() && failed_paths.is_empty() {
        return Err(ApiError::bad_request("file_paths must not be empty"));
    }
    Ok(models::MoveWikiPagesResponse {
        status: if failed_paths.is_empty() {
            "ok".to_string()
        } else {
            "partial".to_string()
        },
        moved,
        failed_paths,
    })
}

async fn archive_wiki_paths_batch(
    state: &AppState,
    slug: &str,
    repo_path: &std::path::Path,
    file_paths: Vec<String>,
    reason: &str,
    extra_prune_roots: &[String],
) -> models::ArchiveCasesResponse {
    let git_name = crate::resolve_git_user_name_cached(state, repo_path, slug).await;
    let mut archived_paths = Vec::new();
    let mut failed_paths = Vec::new();
    let mut prune_dirs: Vec<String> = Vec::new();
    for file_path in file_paths {
        let fp = file_path.trim().replace('\\', "/");
        if fp.is_empty() {
            continue;
        }
        match crate::wiki::archive_wiki_page_on_disk(repo_path, &fp, reason) {
            Ok(new_path) => {
                if let Some(parent_rel) = wiki_parent_rel_for_prune(repo_path, &fp) {
                    prune_dirs.push(parent_rel);
                }
                archived_paths.push(new_path);
            }
            Err(_) => failed_paths.push(fp),
        }
    }
    for root in extra_prune_roots {
        let norm = root
            .trim()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string();
        if !norm.is_empty() {
            prune_dirs.push(norm);
        }
    }
    prune_dirs.sort_by(|a, b| b.len().cmp(&a.len()));
    prune_dirs.dedup();
    if !archived_paths.is_empty() {
        for dir_rel in prune_dirs {
            crate::wiki::prune_empty_wiki_dirs_upward(repo_path, &dir_rel);
        }
        reindex_wiki_and_broadcast_with_local_stamp(
            state,
            slug,
            repo_path,
            &archived_paths,
            &git_name,
        )
        .await;
    }
    models::ArchiveCasesResponse {
        status: if failed_paths.is_empty() {
            "ok".to_string()
        } else {
            "partial".to_string()
        },
        archived_paths,
        failed_paths,
    }
}

pub async fn archive_wiki_page(
    state: &AppState,
    repo: Option<String>,
    payload: models::ArchiveCaseRequest,
) -> Result<models::ArchiveCaseResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let file_path = payload.file_path.trim().replace('\\', "/");
    if file_path.is_empty() {
        return Err(ApiError::bad_request("file_path is required"));
    }
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let new_path =
        crate::wiki::archive_wiki_page_on_disk(&repo_path, &file_path, payload.reason.trim())
            .map_err(map_wiki_disk_err)?;
    if let Some(parent_rel) = wiki_parent_rel_for_prune(&repo_path, &file_path) {
        crate::wiki::prune_empty_wiki_dirs_upward(&repo_path, &parent_rel);
    }
    reindex_wiki_and_broadcast_with_local_stamp(
        state,
        &slug,
        &repo_path,
        &[new_path.clone()],
        &git_name,
    )
    .await;
    Ok(models::ArchiveCaseResponse {
        status: "ok".to_string(),
        file_path: new_path,
    })
}

pub async fn archive_wiki_pages(
    state: &AppState,
    repo: Option<String>,
    payload: models::ArchiveCasesRequest,
) -> Result<models::ArchiveCasesResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let file_paths: Vec<String> = payload
        .file_paths
        .iter()
        .map(|p| p.trim().replace('\\', "/"))
        .filter(|p| !p.is_empty())
        .collect();
    if file_paths.is_empty() {
        return Err(ApiError::bad_request("file_paths must not be empty"));
    }
    Ok(archive_wiki_paths_batch(
        state,
        &slug,
        &repo_path,
        file_paths,
        payload.reason.trim(),
        &[],
    )
    .await)
}

pub async fn archive_wiki_folder(
    state: &AppState,
    repo: Option<String>,
    payload: models::ArchiveFolderRequest,
) -> Result<models::ArchiveFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let directory_path = crate::wiki::validate_wiki_folder_path(&payload.directory_path)
        .map_err(ApiError::bad_request)?;
    if crate::wiki::is_archived_wiki_path(&directory_path) {
        return Err(ApiError::bad_request(
            "Cannot archive a folder under .archive/",
        ));
    }
    if directory_path == crate::wiki::WIKI_ROOT_REL {
        return Err(ApiError::bad_request("Cannot archive the wiki root."));
    }
    let page_paths = crate::wiki::collect_wiki_yaml_paths_under(&repo_path, &directory_path)
        .into_iter()
        .filter(|p| !crate::wiki::is_archived_wiki_path(p))
        .collect::<Vec<_>>();
    if page_paths.is_empty() {
        return Err(ApiError::bad_request(
            "No active wiki pages found in folder",
        ));
    }
    let batch = archive_wiki_paths_batch(
        state,
        &slug,
        &repo_path,
        page_paths,
        payload.reason.trim(),
        std::slice::from_ref(&directory_path),
    )
    .await;
    // If all pages were archived successfully, remove the now-empty source directory
    // so the folder disappears from the active tree completely.
    if batch.failed_paths.is_empty() {
        let active_dir = repo_path.join(&directory_path);
        if active_dir.is_dir() {
            let _ = std::fs::remove_dir_all(&active_dir);
        }
    }
    Ok(models::ArchiveFolderResponse {
        status: batch.status,
        archived_paths: batch.archived_paths,
        failed_paths: batch.failed_paths,
    })
}

async fn restore_wiki_paths_batch(
    state: &AppState,
    slug: &str,
    repo_path: &std::path::Path,
    file_paths: Vec<String>,
    extra_prune_roots: &[String],
) -> models::RestoreCasesResponse {
    let git_name = crate::resolve_git_user_name_cached(state, repo_path, slug).await;
    let mut restored_paths = Vec::new();
    let mut failed_paths = Vec::new();
    let mut prune_dirs: Vec<String> = Vec::new();
    for file_path in file_paths {
        let fp = file_path.trim().replace('\\', "/");
        if fp.is_empty() {
            continue;
        }
        match crate::wiki::restore_wiki_page_on_disk(repo_path, &fp) {
            Ok(new_path) => {
                if let Some(parent_rel) = wiki_parent_rel_for_prune(repo_path, &fp) {
                    prune_dirs.push(parent_rel);
                }
                restored_paths.push(new_path);
            }
            Err(_) => failed_paths.push(fp),
        }
    }
    for root in extra_prune_roots {
        let norm = root
            .trim()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string();
        if !norm.is_empty() {
            prune_dirs.push(norm);
        }
    }
    prune_dirs.sort_by(|a, b| b.len().cmp(&a.len()));
    prune_dirs.dedup();
    if !restored_paths.is_empty() {
        for dir_rel in prune_dirs {
            crate::wiki::prune_empty_wiki_dirs_upward(repo_path, &dir_rel);
        }
        reindex_wiki_and_broadcast_with_local_stamp(
            state,
            slug,
            repo_path,
            &restored_paths,
            &git_name,
        )
        .await;
    }
    models::RestoreCasesResponse {
        status: if failed_paths.is_empty() {
            "ok".to_string()
        } else {
            "partial".to_string()
        },
        restored_paths,
        failed_paths,
    }
}

pub async fn restore_wiki_page(
    state: &AppState,
    repo: Option<String>,
    payload: models::RestoreCaseRequest,
) -> Result<models::RestoreCaseResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let file_path = payload.file_path.trim().replace('\\', "/");
    if file_path.is_empty() {
        return Err(ApiError::bad_request("file_path is required"));
    }
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let new_path = crate::wiki::restore_wiki_page_on_disk(&repo_path, &file_path)
        .map_err(map_wiki_disk_err)?;
    if let Some(parent_rel) = wiki_parent_rel_for_prune(&repo_path, &file_path) {
        crate::wiki::prune_empty_wiki_dirs_upward(&repo_path, &parent_rel);
    }
    reindex_wiki_and_broadcast_with_local_stamp(
        state,
        &slug,
        &repo_path,
        &[new_path.clone()],
        &git_name,
    )
    .await;
    Ok(models::RestoreCaseResponse {
        status: "ok".to_string(),
        file_path: new_path,
    })
}

pub async fn restore_wiki_pages(
    state: &AppState,
    repo: Option<String>,
    payload: models::RestoreCasesRequest,
) -> Result<models::RestoreCasesResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let file_paths: Vec<String> = payload
        .file_paths
        .iter()
        .map(|p| p.trim().replace('\\', "/"))
        .filter(|p| !p.is_empty())
        .collect();
    if file_paths.is_empty() {
        return Err(ApiError::bad_request("file_paths must not be empty"));
    }
    Ok(restore_wiki_paths_batch(state, &slug, &repo_path, file_paths, &[]).await)
}

pub async fn restore_wiki_folder(
    state: &AppState,
    repo: Option<String>,
    payload: models::RestoreFolderRequest,
) -> Result<models::RestoreFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let directory_path = crate::wiki::validate_wiki_archived_folder_path(&payload.directory_path)
        .map_err(ApiError::bad_request)?;
    let page_paths = crate::wiki::collect_wiki_yaml_paths_under(&repo_path, &directory_path);
    if page_paths.is_empty() {
        return Err(ApiError::bad_request(
            "No archived wiki pages found in folder",
        ));
    }
    let batch = restore_wiki_paths_batch(
        state,
        &slug,
        &repo_path,
        page_paths,
        std::slice::from_ref(&directory_path),
    )
    .await;
    if batch.failed_paths.is_empty() {
        crate::wiki::prune_empty_wiki_dirs_upward(&repo_path, &directory_path);
    }
    Ok(models::RestoreFolderResponse {
        status: batch.status,
        restored_paths: batch.restored_paths,
        failed_paths: batch.failed_paths,
    })
}

pub async fn delete_wiki_page(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
) -> Result<serde_json::Value, ApiError> {
    let file_path = crate::wiki::validate_wiki_archived_file_path_for_write(&file_path)
        .map_err(ApiError::bad_request)?;
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let full_path = repo_path.join(&file_path);
    if !full_path.is_file() {
        return Err(ApiError::not_found(format!(
            "Wiki page not found: {file_path}"
        )));
    }
    std::fs::remove_file(&full_path)
        .map_err(|e| ApiError::internal(format!("Failed to delete wiki page: {e:#}")))?;
    if let Some(parent_rel) = wiki_parent_rel_for_prune(&repo_path, &file_path) {
        crate::wiki::prune_empty_wiki_dirs_upward(&repo_path, &parent_rel);
    }
    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM wiki_pages WHERE repo_slug = ? AND file_path = ?",
            [slug.as_str(), file_path.as_str()],
        );
    }
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(json!({ "status": "ok", "file_path": file_path }))
}

pub async fn delete_wiki_folder(
    state: &AppState,
    payload: models::DeleteFolderRequest,
) -> Result<models::DeleteFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let folder_path = crate::wiki::validate_wiki_archived_folder_path(&payload.folder_path)
        .map_err(ApiError::bad_request)?;
    if folder_path == crate::wiki::WIKI_ARCHIVE_ROOT {
        return Err(ApiError::bad_request(
            "Cannot delete the wiki archive root. Delete individual archived folders instead.",
        ));
    }

    let target = repo_path.join(&folder_path);
    if !target.is_dir() {
        return Err(ApiError::not_found(format!(
            "Folder not found: {folder_path}"
        )));
    }
    std::fs::remove_dir_all(&target)
        .map_err(|e| ApiError::internal(format!("Failed to delete folder: {e:#}")))?;
    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::wiki::reindex_wiki_for_repo(&conn, &repo_path, &slug);
    }
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::DeleteFolderResponse {
        status: "ok".to_string(),
        folder_path,
    })
}

pub async fn delete_active_wiki_folder(
    state: &AppState,
    payload: models::DeleteFolderRequest,
) -> Result<models::DeleteFolderResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::not_found(format!("{e:#}")))?;
    let folder_path = crate::wiki::validate_wiki_folder_path(&payload.folder_path)
        .map_err(ApiError::bad_request)?;
    if folder_path == crate::wiki::WIKI_ROOT_REL {
        return Err(ApiError::bad_request("Cannot delete the wiki root."));
    }
    if crate::wiki::is_archived_wiki_path(&folder_path) {
        return Err(ApiError::bad_request(
            "Use delete_wiki_folder for archived folders.",
        ));
    }
    let target = repo_path.join(&folder_path);
    if !target.is_dir() {
        return Err(ApiError::not_found(format!(
            "Folder not found: {folder_path}"
        )));
    }
    // Only allow deletion of folders that have no active wiki pages.
    let active_pages = crate::wiki::collect_wiki_yaml_paths_under(&repo_path, &folder_path)
        .into_iter()
        .filter(|p| !crate::wiki::is_archived_wiki_path(p))
        .count();
    if active_pages > 0 {
        return Err(ApiError::bad_request(
            "Cannot delete a folder that still contains wiki pages. Archive or delete its pages first.",
        ));
    }
    std::fs::remove_dir_all(&target)
        .map_err(|e| ApiError::internal(format!("Failed to delete folder: {e:#}")))?;
    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::wiki::reindex_wiki_for_repo(&conn, &repo_path, &slug);
    }
    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::DeleteFolderResponse {
        status: "ok".to_string(),
        folder_path,
    })
}

// ───────────────────────────────────────────────────────────────────────
// Ticket releases
// ───────────────────────────────────────────────────────────────────────

pub async fn list_releases(
    state: &AppState,
    repo: Option<String>,
    search: Option<String>,
    project: Option<String>,
    project_empty: Option<bool>,
    release_id: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<models::YamlReleaseListResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    let (items, total) = crate::ticket_releases::list_releases(
        &conn,
        &slug,
        crate::ticket_releases::QueryReleasesArgs {
            search,
            project,
            project_empty: project_empty.unwrap_or(false),
            release_id,
            status,
            limit: limit.unwrap_or(200).clamp(1, 500),
            offset: offset.unwrap_or(0).max(0),
        },
    )
    .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(models::YamlReleaseListResponse { items, total })
}

pub async fn get_release_filters(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::YamlReleaseFilters, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let conn = conn_arc.lock().unwrap();
    let projects = crate::ticket_releases::distinct_release_projects(&conn, &slug)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    Ok(models::YamlReleaseFilters { projects })
}

pub async fn get_release_detail(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
) -> Result<models::YamlReleaseDetail, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let file_path = crate::ticket_releases::validate_release_file_path_for_write(&file_path)
        .map_err(ApiError::bad_request)?;
    let full = repo_path.join(&file_path);
    let mut detail = match crate::ticket_releases::read_release_yaml(&full) {
        Ok(Some(d)) => d,
        Ok(None) => {
            return Err(ApiError::not_found(format!(
                "Release not found: {file_path}"
            )))
        }
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };
    let (project, stem) = crate::ticket_releases::parse_release_path(&file_path)
        .ok_or_else(|| ApiError::bad_request("Invalid release path".to_string()))?;
    detail.file_path = file_path.clone();
    detail.release_id = crate::ticket_releases::compose_release_id(&project, &stem);
    detail.project = Some(project);
    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        crate::ticket_releases::apply_release_audit_from_db(&conn, &slug, &file_path, &mut detail);
    }
    Ok(detail)
}

pub async fn create_release(
    state: &AppState,
    payload: models::CreateReleaseRequest,
) -> Result<models::CreateReleaseResponse, ApiError> {
    let slug = crate::resolve_repo_slug(state, payload.repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;

    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Release name is required."));
    }
    let project = payload.project.trim().to_string();
    if project.is_empty() {
        return Err(ApiError::bad_request("Release project is required."));
    }
    if !crate::is_valid_project_name(&project)
        || project == crate::tickets::TICKETS_RESERVED_DIR
        || project == crate::tickets::TICKETS_RELEASES_DIR
    {
        return Err(ApiError::bad_request("Invalid release project name."));
    }

    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        if crate::tickets::is_ticket_project_archived(&conn, &repo_path, &slug, &project) {
            return Err(ApiError::bad_request(
                "Cannot create releases in an archived project. Restore the project first.",
            ));
        }
    }

    let stem = crate::ticket_releases::slugify_release_name(&name);
    if !crate::ticket_releases::is_valid_release_stem(&stem) {
        return Err(ApiError::bad_request(
            "Could not derive a valid release id from the name.",
        ));
    }
    let release_id = crate::ticket_releases::compose_release_id(&project, &stem);
    if !crate::ticket_releases::is_valid_release_id(&release_id) {
        return Err(ApiError::bad_request(
            "Could not derive a valid release id from the name.",
        ));
    }

    let releases_dir = crate::ticket_releases::ensure_releases_dir(&repo_path, &project)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let file_name = format!("{stem}.md");
    let full_path = releases_dir.join(&file_name);
    if full_path.exists() {
        return Err(ApiError::conflict(format!(
            "A release file named '{file_name}' already exists in project '{project}'. Choose a different name."
        )));
    }
    let rel = crate::ticket_releases::release_file_rel(&project, &stem);

    let status = {
        let s = payload.status.trim().to_lowercase();
        if s.is_empty() {
            "open".to_string()
        } else {
            s
        }
    };
    let now_iso = Utc::now().to_rfc3339();
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;

    let detail = models::YamlReleaseDetail {
        release_id: release_id.clone(),
        name: Some(name),
        project: Some(project.clone()),
        status: Some(status),
        file_path: rel.clone(),
        body: payload.body.unwrap_or_default(),
        raw: String::new(),
        updated_at: Some(now_iso.clone()),
        updated_by: Some(git_name.clone()),
    };

    crate::ticket_releases::write_release_yaml(&full_path, &detail)
        .map_err(|e| ApiError::internal(format!("Failed to write release YAML: {e:#}")))?;

    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::ticket_releases::upsert_release_db(
            &conn,
            crate::ticket_releases::UpsertReleaseArgs {
                release_id: release_id.clone(),
                name: detail.name.clone(),
                project: Some(project),
                status: detail.status.clone(),
                file_path: rel.clone(),
                repo_slug: slug.clone(),
                updated_at: Some(now_iso),
                updated_by: Some(git_name),
            },
        );
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;

    Ok(models::CreateReleaseResponse {
        status: "ok".to_string(),
        release_id,
        file_path: rel,
    })
}

pub async fn update_release(
    state: &AppState,
    file_path: String,
    repo: Option<String>,
    name: String,
    _project: Option<String>,
    status: Option<String>,
    body: Option<String>,
) -> Result<models::YamlReleaseDetail, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let file_path = crate::ticket_releases::validate_release_file_path_for_write(&file_path)
        .map_err(ApiError::bad_request)?;
    let full_path = repo_path.join(&file_path);
    let mut existing = match crate::ticket_releases::read_release_yaml(&full_path) {
        Ok(Some(d)) => d,
        Ok(None) => {
            return Err(ApiError::not_found(format!(
                "Release not found: {file_path}"
            )))
        }
        Err(e) => return Err(ApiError::internal(format!("{e:#}"))),
    };

    let (project, stem) = crate::ticket_releases::parse_release_path(&file_path)
        .ok_or_else(|| ApiError::bad_request("Invalid release path".to_string()))?;
    let release_id = crate::ticket_releases::compose_release_id(&project, &stem);

    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("Release name is required."));
    }
    existing.name = Some(name);
    existing.release_id = release_id;
    existing.project = Some(project);
    if let Some(s) = status {
        let t = s.trim().to_lowercase();
        if !t.is_empty() {
            existing.status = Some(t);
        }
    }
    if let Some(b) = body {
        existing.body = b;
    }
    let git_name = crate::resolve_git_user_name_cached(state, &repo_path, &slug).await;
    let now_iso = Utc::now().to_rfc3339();
    existing.updated_at = Some(now_iso.clone());
    existing.updated_by = Some(git_name.clone());
    existing.file_path = file_path.clone();

    crate::ticket_releases::write_release_yaml(&full_path, &existing)
        .map_err(|e| ApiError::internal(format!("{e:#}")))?;

    if let Ok(conn_arc) = crate::open_repo_db(state, &slug) {
        let conn = conn_arc.lock().unwrap();
        let _ = crate::ticket_releases::upsert_release_db(
            &conn,
            crate::ticket_releases::UpsertReleaseArgs {
                release_id: existing.release_id.clone(),
                name: existing.name.clone(),
                project: existing.project.clone(),
                status: existing.status.clone(),
                file_path: file_path.clone(),
                repo_slug: slug.clone(),
                updated_at: Some(now_iso),
                updated_by: Some(git_name),
            },
        );
    }

    crate::mark_workplace_editing_best_effort(state, &slug, &repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(existing)
}

pub async fn reindex_releases(
    state: &AppState,
    repo: Option<String>,
) -> Result<models::YamlIndexStats, ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| ApiError::bad_request(format!("{e:#}")))?;
    let conn_arc =
        crate::open_repo_db(state, &slug).map_err(|e| ApiError::internal(format!("{e:#}")))?;
    let indexed = {
        let conn = conn_arc.lock().unwrap();
        crate::ticket_releases::reindex_releases_for_repo(&conn, &repo_path, &slug)
            .map_err(|e| ApiError::internal(format!("{e:#}")))?
    };
    let _ = crate::stamp_indexed_head(state, &repo_path, &slug).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(models::YamlIndexStats {
        repo_slug: slug,
        indexed,
        errors: 0,
        removed: 0,
        directories: 0,
    })
}

use rusqlite::OptionalExtension;

pub async fn _start_initial_indexing(state: &crate::AppState) -> Result<(), crate::ApiError> {
    let any = crate::async_index_all_repos(state).await.unwrap_or(false);
    if any {
        let _ = crate::broadcast_refresh(state).await;
    }
    Ok(())
}

#[cfg(test)]
mod prune_empty_case_dirs_tests {
    use super::*;
    use std::path::Path;

    const CASES_ROOT: &str = ".gitoza/test/cases";

    fn project_rel(name: &str) -> String {
        format!("{CASES_ROOT}/{name}.gitoza.test")
    }

    fn suite_rel(project: &str, suite: &str) -> String {
        format!("{project}/{suite}")
    }

    fn archive_suite_rel(project: &str, suite: &str) -> String {
        format!("{CASES_ROOT}/.archive/{project}/{suite}")
    }

    fn touch_yaml(repo: &Path, rel: &str) {
        let path = repo.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, "title: test\n").unwrap();
    }

    fn mkdir(repo: &Path, rel: &str) {
        std::fs::create_dir_all(repo.join(rel)).unwrap();
    }

    fn exists(repo: &Path, rel: &str) -> bool {
        repo.join(rel).exists()
    }

    #[test]
    fn prune_removes_suite_and_project_after_last_case_gone() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let project = project_rel("alpha");
        let suite = suite_rel(&project, "regression");
        touch_yaml(repo, &format!("{suite}/case-a.md"));
        std::fs::remove_file(repo.join(format!("{suite}/case-a.md"))).unwrap();

        prune_empty_case_dirs_upward(repo, &suite);

        assert!(!exists(repo, &suite));
        assert!(!exists(repo, &project));
        assert!(exists(repo, CASES_ROOT));
    }

    #[test]
    fn prune_removes_project_with_never_used_empty_suite() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let project = project_rel("beta");
        mkdir(repo, &suite_rel(&project, "empty-suite"));
        touch_yaml(repo, &format!("{project}/active-suite/case-b.md"));
        std::fs::remove_file(repo.join(format!("{project}/active-suite/case-b.md"))).unwrap();

        prune_empty_case_dirs_upward(repo, &project);

        assert!(!exists(repo, &project));
    }

    #[test]
    fn prune_keeps_sibling_suite_with_remaining_cases() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let project = project_rel("gamma");
        let suite_a = suite_rel(&project, "suite-a");
        let suite_b = suite_rel(&project, "suite-b");
        touch_yaml(repo, &format!("{suite_a}/case-a.md"));
        touch_yaml(repo, &format!("{suite_b}/case-b.md"));
        std::fs::remove_file(repo.join(format!("{suite_a}/case-a.md"))).unwrap();

        prune_empty_case_dirs_upward(repo, &suite_a);

        assert!(!exists(repo, &suite_a));
        assert!(exists(repo, &suite_b));
        assert!(exists(repo, &project));
    }

    #[test]
    fn prune_removes_empty_archive_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let archive_suite = archive_suite_rel("delta.gitoza.test", "legacy");
        touch_yaml(repo, &format!("{archive_suite}/case-x.md"));
        std::fs::remove_file(repo.join(format!("{archive_suite}/case-x.md"))).unwrap();

        prune_empty_case_dirs_upward(repo, &archive_suite);

        assert!(!exists(repo, &archive_suite));
        assert!(!exists(
            repo,
            &format!("{CASES_ROOT}/.archive/delta.gitoza.test")
        ));
    }

    #[test]
    fn prune_skips_outside_cases_root() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        mkdir(repo, "other/empty");

        prune_empty_case_dirs_upward(repo, "other/empty");

        assert!(exists(repo, "other/empty"));
    }

    #[test]
    fn prune_keeps_dir_with_non_yaml_files() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let project = project_rel("epsilon");
        mkdir(repo, &project);
        std::fs::write(repo.join(format!("{project}/notes.txt")), "keep").unwrap();

        prune_empty_case_dirs_upward(repo, &project);

        assert!(exists(repo, &project));
    }
}

#[cfg(test)]
mod restore_batch_tests {
    use super::*;
    use indexmap::IndexMap;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const CASES_ROOT: &str = ".gitoza/test/cases";
    const ARCHIVE_ROOT: &str = ".gitoza/test/cases/.archive";

    fn archive_project_rel(name: &str) -> String {
        format!("{ARCHIVE_ROOT}/{name}.gitoza.test")
    }

    fn archive_case_rel(project: &str, suite: &str, case_file: &str) -> String {
        format!("{project}/{suite}/{case_file}")
    }

    fn active_case_rel(project_name: &str, suite: &str, case_file: &str) -> String {
        format!("{CASES_ROOT}/{project_name}.gitoza.test/{suite}/{case_file}")
    }

    fn touch_yaml(repo: &Path, rel: &str) {
        let path = repo.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("test".to_string()),
        );
        fm.insert(
            "status".to_string(),
            serde_yaml::Value::String("archived".to_string()),
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
            serde_yaml::Value::String("tester".to_string()),
        );
        crate::write_full_yaml(&path, &fm, "Body").unwrap();
    }

    fn exists(repo: &Path, rel: &str) -> bool {
        repo.join(rel).exists()
    }

    fn setup_repo() -> (tempfile::TempDir, AppState, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let config_dir = tmp.path().join("config");
        std::fs::create_dir_all(&config_dir).unwrap();
        let repo_path = config_dir.join("repos").join("testrepo");
        std::fs::create_dir_all(&repo_path).unwrap();
        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .expect("git init");
        let state = crate::new_state(config_dir);
        (tmp, state, repo_path)
    }

    #[test]
    fn collect_archived_case_yaml_paths_under_finds_nested_cases() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let project = archive_project_rel("alpha");
        let case_a = archive_case_rel(&project, "regression", "case-a.md");
        let case_b = archive_case_rel(&project, "regression", "case-b.md");
        touch_yaml(repo, &case_a);
        touch_yaml(repo, &case_b);

        let paths = collect_archived_case_yaml_paths_under(repo, &project);
        assert_eq!(paths, vec![case_a, case_b]);
    }

    #[test]
    fn restore_case_on_disk_moves_yaml_to_active_path() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let project = archive_project_rel("beta");
        let archived = archive_case_rel(&project, "suite", "case-x.md");
        touch_yaml(repo, &archived);

        let active = restore_case_on_disk(repo, &archived, "tester").unwrap();
        let expected = active_case_rel("beta", "suite", "case-x.md");
        assert_eq!(active, expected);
        assert!(exists(repo, &expected));
        assert!(!exists(repo, &archived));
    }

    #[tokio::test]
    async fn restore_cases_batch_restores_all_and_prunes_archive_project() {
        let (_tmp, state, repo_path) = setup_repo();
        let project = archive_project_rel("gamma");
        let case_a = archive_case_rel(&project, "suite", "case-a.md");
        let case_b = archive_case_rel(&project, "suite", "case-b.md");
        touch_yaml(&repo_path, &case_a);
        touch_yaml(&repo_path, &case_b);

        let resp = restore_cases(
            &state,
            Some("testrepo".to_string()),
            models::RestoreCasesRequest {
                file_paths: vec![case_a.clone(), case_b.clone()],
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.status, "ok");
        assert_eq!(resp.failed_paths.len(), 0);
        assert_eq!(resp.restored_paths.len(), 2);
        assert!(!exists(&repo_path, &case_a));
        assert!(!exists(&repo_path, &case_b));
        assert!(exists(
            &repo_path,
            &active_case_rel("gamma", "suite", "case-a.md")
        ));
        assert!(exists(
            &repo_path,
            &active_case_rel("gamma", "suite", "case-b.md")
        ));
        assert!(!exists(&repo_path, &project));
    }

    #[tokio::test]
    async fn restore_cases_partial_failure_keeps_failed_archived_case() {
        let (_tmp, state, repo_path) = setup_repo();
        let project = archive_project_rel("delta");
        let case_a = archive_case_rel(&project, "suite", "case-a.md");
        let case_b = archive_case_rel(&project, "suite", "case-b.md");
        touch_yaml(&repo_path, &case_a);
        touch_yaml(&repo_path, &case_b);
        touch_yaml(
            &repo_path,
            &active_case_rel("delta", "suite", "case-b.md"),
        );

        let resp = restore_cases(
            &state,
            Some("testrepo".to_string()),
            models::RestoreCasesRequest {
                file_paths: vec![case_a.clone(), case_b.clone()],
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.status, "partial");
        assert_eq!(resp.restored_paths.len(), 1);
        assert_eq!(resp.failed_paths, vec![case_b.clone()]);
        assert!(!exists(&repo_path, &case_a));
        assert!(exists(&repo_path, &case_b));
    }

    #[tokio::test]
    async fn restore_folder_restores_all_cases_under_directory() {
        let (_tmp, state, repo_path) = setup_repo();
        let project = archive_project_rel("epsilon");
        let case_a = archive_case_rel(&project, "suite", "case-a.md");
        touch_yaml(&repo_path, &case_a);

        let resp = restore_folder(
            &state,
            Some("testrepo".to_string()),
            models::RestoreFolderRequest {
                directory_path: project.clone(),
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.status, "ok");
        assert_eq!(resp.restored_paths.len(), 1);
        assert!(!exists(&repo_path, &case_a));
        assert!(exists(
            &repo_path,
            &active_case_rel("epsilon", "suite", "case-a.md")
        ));
        assert!(!exists(&repo_path, &project));
    }
}

#[cfg(test)]
mod archive_batch_tests {
    use super::*;
    use indexmap::IndexMap;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const CASES_ROOT: &str = ".gitoza/test/cases";
    const ARCHIVE_ROOT: &str = ".gitoza/test/cases/.archive";

    fn active_project_rel(name: &str) -> String {
        format!("{CASES_ROOT}/{name}.gitoza.test")
    }

    fn active_case_rel(project: &str, suite: &str, case_file: &str) -> String {
        format!("{project}/{suite}/{case_file}")
    }

    fn archived_case_rel(project_name: &str, suite: &str, case_file: &str) -> String {
        format!("{ARCHIVE_ROOT}/{project_name}.gitoza.test/{suite}/{case_file}")
    }

    fn touch_yaml(repo: &Path, rel: &str) {
        let path = repo.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let mut fm = IndexMap::new();
        fm.insert(
            "title".to_string(),
            serde_yaml::Value::String("test".to_string()),
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
            serde_yaml::Value::String("tester".to_string()),
        );
        crate::write_full_yaml(&path, &fm, "Body").unwrap();
    }

    fn exists(repo: &Path, rel: &str) -> bool {
        repo.join(rel).exists()
    }

    fn setup_repo() -> (tempfile::TempDir, AppState, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let config_dir = tmp.path().join("config");
        std::fs::create_dir_all(&config_dir).unwrap();
        let repo_path = config_dir.join("repos").join("testrepo");
        std::fs::create_dir_all(&repo_path).unwrap();
        Command::new("git")
            .args(["init"])
            .current_dir(&repo_path)
            .output()
            .expect("git init");
        let state = crate::new_state(config_dir);
        (tmp, state, repo_path)
    }

    #[test]
    fn archive_case_on_disk_moves_yaml_to_archive_path() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let project = active_project_rel("beta");
        let active = active_case_rel(&project, "suite", "case-x.md");
        touch_yaml(repo, &active);

        let archived = archive_case_on_disk(repo, &active, "", "tester").unwrap();
        let expected = archived_case_rel("beta", "suite", "case-x.md");
        assert_eq!(archived, expected);
        assert!(exists(repo, &expected));
        assert!(!exists(repo, &active));
    }

    #[tokio::test]
    async fn archive_folder_batch_archives_all_and_prunes_active_project() {
        let (_tmp, state, repo_path) = setup_repo();
        let project = active_project_rel("gamma");
        let case_a = active_case_rel(&project, "suite", "case-a.md");
        let case_b = active_case_rel(&project, "suite", "case-b.md");
        touch_yaml(&repo_path, &case_a);
        touch_yaml(&repo_path, &case_b);

        let resp = archive_folder(
            &state,
            Some("testrepo".to_string()),
            models::ArchiveFolderRequest {
                directory_path: project.clone(),
                reason: String::new(),
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.status, "ok");
        assert_eq!(resp.failed_paths.len(), 0);
        assert_eq!(resp.archived_paths.len(), 2);
        assert!(!exists(&repo_path, &case_a));
        assert!(!exists(&repo_path, &case_b));
        assert!(exists(
            &repo_path,
            &archived_case_rel("gamma", "suite", "case-a.md")
        ));
        assert!(exists(
            &repo_path,
            &archived_case_rel("gamma", "suite", "case-b.md")
        ));
        assert!(!exists(&repo_path, &project));
    }

    #[tokio::test]
    async fn archive_cases_partial_failure_keeps_failed_active_case() {
        let (_tmp, state, repo_path) = setup_repo();
        let project = active_project_rel("delta");
        let case_a = active_case_rel(&project, "suite", "case-a.md");
        let case_b = active_case_rel(&project, "suite", "case-b.md");
        touch_yaml(&repo_path, &case_a);
        touch_yaml(&repo_path, &case_b);
        touch_yaml(
            &repo_path,
            &archived_case_rel("delta", "suite", "case-b.md"),
        );

        let resp = archive_cases(
            &state,
            Some("testrepo".to_string()),
            models::ArchiveCasesRequest {
                file_paths: vec![case_a.clone(), case_b.clone()],
                reason: String::new(),
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.status, "partial");
        assert_eq!(resp.archived_paths.len(), 1);
        assert_eq!(resp.failed_paths, vec![case_b.clone()]);
        assert!(!exists(&repo_path, &case_a));
        assert!(exists(&repo_path, &case_b));
    }
}
