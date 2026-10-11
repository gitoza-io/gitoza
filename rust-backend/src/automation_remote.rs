//! Discover and download test-result artifacts from S3 or local shared folders.

use std::collections::HashMap;
use std::path::Path;
use std::time::SystemTime;

use chrono::{DateTime, Utc};

use crate::automation_paths::{self, parse_execution_file_relative, ExecutionPathParts};
use crate::project_sync_config::ProjectSyncConfig;
use crate::AppState;

#[derive(Debug, Clone)]
pub struct RemoteExecutionRef {
    pub pipeline_name: String,
    pub date_folder: String,
    pub build_id: String,
    pub remote_prefix: String,
    pub junit_files: Vec<String>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RemoteObjectRef {
    pub relative_path: String,
    pub modified_at: Option<String>,
}

pub async fn list_remote_executions(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
) -> Result<Vec<RemoteExecutionRef>, String> {
    let provider = cfg.provider_type_normalized();
    match provider.as_str() {
        "cloud_api" => list_s3_executions(state, cfg, repo_slug).await,
        "local_path" => Ok(list_local_executions(state, cfg, repo_slug)?),
        _ => Err("Storage sync is not configured (provider_type)".to_string()),
    }
}

pub async fn download_repo_relative_file(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    path_under_slug: &str,
) -> Result<Vec<u8>, String> {
    let provider = cfg.provider_type_normalized();
    match provider.as_str() {
        "cloud_api" => download_s3_file(state, cfg, repo_slug, path_under_slug).await,
        "local_path" => read_local_file(state, cfg, repo_slug, path_under_slug),
        _ => Err("Storage sync is not configured (provider_type)".to_string()),
    }
}

fn list_local_executions(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
) -> Result<Vec<RemoteExecutionRef>, String> {
    let Some(base) = crate::local_sync_paths::effective_local_assets_path(state, repo_slug, cfg)
    else {
        return Err("local_assets_path is not configured".to_string());
    };
    let root = base
        .join(repo_slug.trim())
        .join(automation_paths::TEST_RESULTS_SUBFOLDER);
    if !root.is_dir() {
        return Ok(vec![]);
    }

    let mut by_exec: HashMap<String, RemoteExecutionRef> = HashMap::new();
    walk_local_dir(&root, &root, &mut by_exec)?;
    let mut out: Vec<_> = by_exec.into_values().collect();
    out.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.pipeline_name.cmp(&b.pipeline_name))
    });
    Ok(out)
}

fn walk_local_dir(
    root: &Path,
    current: &Path,
    by_exec: &mut HashMap<String, RemoteExecutionRef>,
) -> Result<(), String> {
    let entries =
        std::fs::read_dir(current).map_err(|e| format!("read_dir {}: {e}", current.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let path = entry.path();
        if path.is_dir() {
            walk_local_dir(root, &path, by_exec)?;
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| "strip_prefix failed".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let relative = format!("{}/{}", automation_paths::TEST_RESULTS_SUBFOLDER, rel);
        if let Some(parts) = parse_execution_file_relative(&relative) {
            if !is_junit_file(&parts.file_name) {
                continue;
            }
            let modified_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(system_time_to_rfc3339);
            merge_execution_ref(by_exec, parts, modified_at);
        }
    }
    Ok(())
}

async fn list_s3_executions(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
) -> Result<Vec<RemoteExecutionRef>, String> {
    let secrets = crate::sync_secrets::load_global_sync_secrets(state)?;
    let bucket = cfg
        .s3_bucket
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "s3_bucket is not configured".to_string())?;
    let client = crate::asset_sync::build_s3_client(cfg, &secrets).await?;
    let prefix = automation_paths::s3_test_results_list_prefix(cfg, repo_slug);

    let mut continuation: Option<String> = None;
    let mut by_exec: HashMap<String, RemoteExecutionRef> = HashMap::new();

    loop {
        let mut req = client.list_objects_v2().bucket(bucket).prefix(&prefix);
        if let Some(token) = continuation.as_ref() {
            req = req.continuation_token(token);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("S3 list failed: {e}"))?;

        for obj in resp.contents() {
            let key = obj.key().unwrap_or_default();
            let relative = s3_key_to_repo_relative(cfg, repo_slug, key);
            let Some(parts) = parse_execution_file_relative(&relative) else {
                continue;
            };
            if !is_junit_file(&parts.file_name) {
                continue;
            }
            let modified_at = obj.last_modified().map(|t| {
                let secs = t.secs();
                DateTime::<Utc>::from_timestamp(secs, 0)
                    .unwrap_or_else(Utc::now)
                    .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
            });
            merge_execution_ref(&mut by_exec, parts, modified_at);
        }

        if resp.is_truncated() == Some(true) {
            continuation = resp.next_continuation_token().map(|s| s.to_string());
        } else {
            break;
        }
    }

    let mut out: Vec<_> = by_exec.into_values().collect();
    out.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.pipeline_name.cmp(&b.pipeline_name))
    });
    Ok(out)
}

fn s3_key_to_repo_relative(cfg: &ProjectSyncConfig, repo_slug: &str, key: &str) -> String {
    let full_prefix = automation_paths::s3_repo_relative_key(cfg, repo_slug, "");
    let trimmed = full_prefix.trim_end_matches('/');
    let key_trim = key.trim_start_matches('/');
    if let Some(rest) = key_trim.strip_prefix(trimmed) {
        rest.trim_start_matches('/').to_string()
    } else if let Some(rest) = key_trim.strip_prefix(&format!("{}/", repo_slug.trim())) {
        rest.to_string()
    } else {
        key_trim.to_string()
    }
}

fn merge_execution_ref(
    by_exec: &mut HashMap<String, RemoteExecutionRef>,
    parts: ExecutionPathParts,
    modified_at: Option<String>,
) {
    let exec_id =
        automation_paths::execution_id(&parts.pipeline_name, &parts.date_folder, &parts.build_id);
    let remote_prefix = automation_paths::execution_folder_relative(
        &parts.pipeline_name,
        &parts.date_folder,
        &parts.build_id,
    );
    let entry = by_exec
        .entry(exec_id)
        .or_insert_with(|| RemoteExecutionRef {
            pipeline_name: parts.pipeline_name.clone(),
            date_folder: parts.date_folder.clone(),
            build_id: parts.build_id.clone(),
            remote_prefix: remote_prefix.clone(),
            junit_files: Vec::new(),
            modified_at: None,
        });
    if !entry.junit_files.contains(&parts.file_name) {
        entry.junit_files.push(parts.file_name.clone());
    }
    if modified_at.is_some() && (entry.modified_at.is_none() || modified_at > entry.modified_at) {
        entry.modified_at = modified_at;
    }
}

fn is_junit_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".xml")
}

async fn download_s3_file(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    path_under_slug: &str,
) -> Result<Vec<u8>, String> {
    let secrets = crate::sync_secrets::load_global_sync_secrets(state)?;
    let bucket = cfg
        .s3_bucket
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "s3_bucket is not configured".to_string())?;
    let client = crate::asset_sync::build_s3_client(cfg, &secrets).await?;
    let key = automation_paths::s3_repo_relative_key(cfg, repo_slug, path_under_slug);
    let out = client
        .get_object()
        .bucket(bucket)
        .key(&key)
        .send()
        .await
        .map_err(|e| format!("S3 download failed: {e}"))?;
    let bytes = out
        .body
        .collect()
        .await
        .map_err(|e| format!("S3 body read failed: {e}"))?
        .into_bytes();
    Ok(bytes.to_vec())
}

fn read_local_file(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    path_under_slug: &str,
) -> Result<Vec<u8>, String> {
    let Some(base) = crate::local_sync_paths::effective_local_assets_path(state, repo_slug, cfg)
    else {
        return Err("local_assets_path is not configured".to_string());
    };
    let path = base.join(repo_slug.trim()).join(path_under_slug);
    std::fs::read(&path).map_err(|e| format!("Failed to read {}: {e}", path.display()))
}

fn system_time_to_rfc3339(t: SystemTime) -> String {
    DateTime::<Utc>::from(t).to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn junit_file_filter() {
        assert!(is_junit_file("junit.xml"));
        assert!(is_junit_file("JUNIT-API.XML"));
        assert!(!is_junit_file("meta.json"));
    }
}
