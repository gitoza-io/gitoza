//! Copy assets to local shared folders or S3 per `.gitoza/config.json`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use aws_sdk_s3::primitives::ByteStream;
use tracing::{error, warn};

use crate::asset_store::{self, cache_file_path, copy_into_cache};
use crate::pending_assets;
use crate::project_sync_config::{self, ProjectSyncConfig};
use crate::sync_secrets::{self, SyncSecrets};
use crate::AppState;

/// Result of batch-uploading pending cloud assets (manifest-driven).
#[derive(Debug, Clone, Default)]
pub struct SyncPendingCloudAssetsResult {
    pub skipped: bool,
    pub uploaded_count: u32,
    pub failures: Vec<(String, String)>,
}

pub fn repo_asset_lock(state: &AppState, slug: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut guard = state.asset_op_locks.lock().unwrap();
    guard
        .entry(slug.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn list_paths_referencing_asset(repo_path: &Path, file_name: &str) -> Vec<String> {
    // Only scan case + ticket YAML files; avoid broad filesystem searches.
    let mut out: Vec<String> = Vec::new();
    for rel in crate::discover_case_yaml_rel_paths(repo_path) {
        let abs = repo_path.join(&rel);
        if !abs.is_file() {
            continue;
        }
        let raw = match std::fs::read_to_string(&abs) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if raw.contains(file_name) {
            out.push(rel);
        }
    }
    for rel in crate::tickets::discover_ticket_yaml_rel_paths(repo_path) {
        let abs = repo_path.join(&rel);
        if !abs.is_file() {
            continue;
        }
        let raw = match std::fs::read_to_string(&abs) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if raw.contains(file_name) {
            out.push(rel);
        }
    }
    out.sort();
    out.dedup();
    out
}

fn local_path_dest_file(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    let Some(base) = crate::local_sync_paths::effective_local_assets_path(state, repo_slug, cfg)
    else {
        return Err("local_assets_path is not configured".to_string());
    };
    let dest_dir = base.join(repo_slug.trim());
    if dest_dir.as_os_str().is_empty() {
        return Err("local_assets_path is not configured".to_string());
    }
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create local assets project directory: {e}"))?;
    Ok(dest_dir.join(file_name))
}

fn sync_pending_to_local_path(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    repo_path: &Path,
    file_name: &str,
) -> Result<(), String> {
    let cache_path = cache_file_path(state, repo_slug, file_name);
    if !cache_path.is_file() {
        return Err(format!("Cache file not found: {}", cache_path.display()));
    }

    let dest = local_path_dest_file(state, cfg, repo_slug, file_name)?;
    if dest.exists() {
        let refs = list_paths_referencing_asset(repo_path, file_name);
        let refs_summary = if refs.is_empty() {
            "No case or ticket references found under .gitoza/test/cases/ or .gitoza/tasks/tickets/."
                .to_string()
        } else {
            refs.join("\n")
        };
        return Err(format!(
            "Local-path asset sync conflict: destination already exists.\n\n\
asset_id: {file_name}\n\
destination: {}\n\n\
To resolve: open the case(s) or ticket(s) below, remove the image, then add it again so a new asset id is generated.\n\
referenced_in: {refs_summary}",
            dest.display()
        ));
    }

    std::fs::copy(&cache_path, &dest)
        .map_err(|e| format!("Failed to copy asset to local path: {e}"))?;
    Ok(())
}

pub fn sync_to_local_path(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    cache_path: &Path,
    file_name: &str,
) -> Result<(), String> {
    let Some(base) = crate::local_sync_paths::effective_local_assets_path(state, repo_slug, cfg)
    else {
        return Err("local_assets_path is not configured".to_string());
    };
    let dest_dir = base.join(repo_slug.trim());
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create local assets project directory: {e}"))?;
    let dest = dest_dir.join(file_name);
    std::fs::copy(cache_path, &dest)
        .map_err(|e| format!("Failed to copy asset to local path: {e}"))?;
    Ok(())
}

/// Read-through source path: `{base}/{repo_slug}/{file}` first, then legacy `{base}/{file}`.
fn local_path_source_file(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    file_name: &str,
) -> Option<PathBuf> {
    let base = crate::local_sync_paths::effective_local_assets_path(state, repo_slug, cfg)?;
    let project_path = base.join(repo_slug.trim()).join(file_name);
    if project_path.is_file() {
        return Some(project_path);
    }
    let legacy_path = base.join(file_name);
    if legacy_path.is_file() {
        return Some(legacy_path);
    }
    None
}

pub fn resolve_from_local_path(
    state: &AppState,
    repo_slug: &str,
    cfg: &ProjectSyncConfig,
    file_name: &str,
) -> Result<PathBuf, String> {
    let Some(base) = crate::local_sync_paths::effective_local_assets_path(state, repo_slug, cfg)
    else {
        return Err("local_assets_path is not configured".to_string());
    };
    let source = local_path_source_file(state, cfg, repo_slug, file_name).ok_or_else(|| {
        format!(
            "Asset not found in local path (checked {} and {})",
            base.join(repo_slug.trim()).join(file_name).display(),
            base.join(file_name).display()
        )
    })?;
    copy_into_cache(state, repo_slug, file_name, &source)
}

pub async fn build_s3_client(
    cfg: &ProjectSyncConfig,
    secrets: &SyncSecrets,
) -> Result<aws_sdk_s3::Client, String> {
    let region = cfg
        .s3_region
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "s3_region is not configured".to_string())?;

    let session_token = secrets
        .session_token
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let access_key = aws_sdk_s3::config::Credentials::new(
        secrets.access_key_id.trim(),
        secrets.secret_access_key.trim(),
        session_token,
        None,
        "gitoza-sync-secrets",
    );

    let shared = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new(region.to_string()))
        .credentials_provider(access_key)
        .load()
        .await;

    let mut s3_builder = aws_sdk_s3::config::Builder::from(&shared);
    if let Some(endpoint) = cfg
        .s3_endpoint
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        s3_builder = s3_builder.endpoint_url(endpoint).force_path_style(true);
    }

    Ok(aws_sdk_s3::Client::from_conf(s3_builder.build()))
}

pub async fn upload_s3_object(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    file_name: &str,
    cache_path: &Path,
) -> Result<(), String> {
    let secrets = sync_secrets::load_global_sync_secrets(state)?;
    let bucket = cfg
        .s3_bucket
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "s3_bucket is not configured".to_string())?;
    let client = build_s3_client(cfg, &secrets).await?;
    let key = project_sync_config::s3_object_key(cfg, repo_slug, file_name);
    let body = tokio::fs::read(cache_path)
        .await
        .map_err(|e| format!("read cache for upload: {e}"))?;
    client
        .put_object()
        .bucket(bucket)
        .key(&key)
        .body(ByteStream::from(body))
        .send()
        .await
        .map_err(|e| format!("S3 upload failed: {e}"))?;
    Ok(())
}

/// Sync all filenames listed in the per-repo pending manifest (no remote listing).
pub async fn sync_pending_provider_assets(
    state: &AppState,
    repo_slug: &str,
    repo_path: &Path,
) -> Result<SyncPendingCloudAssetsResult, String> {
    let cfg = project_sync_config::load_project_sync_config(repo_path);
    let provider = cfg.provider_type_normalized();
    let is_supported = matches!(provider.as_str(), "cloud_api" | "local_path");

    if !is_supported {
        let pending = pending_assets::load_pending_uploads(state, repo_slug)?;
        if !pending.is_empty() {
            warn!(
                repo = %repo_slug,
                count = pending.len(),
                "pending asset manifest exists but provider is unsupported; skipping provider sync"
            );
        }
        return Ok(SyncPendingCloudAssetsResult {
            skipped: true,
            ..Default::default()
        });
    }

    let pending = pending_assets::load_pending_uploads(state, repo_slug)?;
    if pending.is_empty() {
        return Ok(SyncPendingCloudAssetsResult {
            skipped: true,
            ..Default::default()
        });
    }

    let lock = repo_asset_lock(state, repo_slug);
    let _guard = lock.lock().await;

    let mut uploaded_count = 0u32;
    let mut failures: Vec<(String, String)> = Vec::new();

    for file_name in pending {
        let sync_result = match provider.as_str() {
            "cloud_api" => {
                let cache_path = cache_file_path(state, repo_slug, &file_name);
                if !cache_path.is_file() {
                    Err(format!("Cache file not found: {}", cache_path.display()))
                } else {
                    upload_s3_object(state, &cfg, repo_slug, &file_name, &cache_path).await
                }
            }
            "local_path" => {
                sync_pending_to_local_path(state, &cfg, repo_slug, repo_path, &file_name)
            }
            _ => unreachable!(),
        };

        match sync_result {
            Ok(()) => {
                if let Err(e) = pending_assets::remove_pending_upload(state, repo_slug, &file_name)
                {
                    error!(repo = %repo_slug, file = %file_name, "remove from pending manifest: {e}");
                } else {
                    uploaded_count += 1;
                }
            }
            Err(e) => {
                error!(repo = %repo_slug, file = %file_name, "{e}");
                failures.push((file_name, e));
            }
        }
    }

    if failures.is_empty() {
        let _ = pending_assets::delete_manifest(state, repo_slug);
        Ok(SyncPendingCloudAssetsResult {
            skipped: false,
            uploaded_count,
            failures: vec![],
        })
    } else {
        let summary = failures
            .iter()
            .map(|(f, m)| format!("{f}: {m}"))
            .collect::<Vec<_>>()
            .join("; ");
        Err(format!(
            "Failed to upload {} asset(s): {}",
            failures.len(),
            summary
        ))
    }
}

pub async fn download_from_s3(
    state: &AppState,
    repo_slug: &str,
    cfg: &ProjectSyncConfig,
    file_name: &str,
) -> Result<PathBuf, String> {
    let secrets = sync_secrets::load_global_sync_secrets(state)?;
    let bucket = cfg
        .s3_bucket
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "s3_bucket is not configured".to_string())?;
    let client = build_s3_client(cfg, &secrets).await?;
    let key = project_sync_config::s3_object_key(cfg, repo_slug, file_name);
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
    asset_store::write_cache_bytes(state, repo_slug, file_name, &bytes)
}

pub async fn after_cache_write(
    state: &AppState,
    repo_slug: String,
    repo_path: PathBuf,
    file_name: String,
    cache_path: PathBuf,
) {
    let cfg = project_sync_config::load_project_sync_config(&repo_path);
    match cfg.provider_type_normalized().as_str() {
        "local_path" => {
            // Unify with `cloud_api`: on attach, write cache only and enqueue the asset for
            // Proceed-time sync.
            // Caller (`save_test_asset`) already holds `repo_asset_lock` for this slug.
            if let Err(e) = pending_assets::append_pending_upload(state, &repo_slug, &file_name) {
                warn!(repo = %repo_slug, file = %file_name, "{e}");
            }
            let _ = cache_path;
        }
        "cloud_api" => {
            // Caller (`save_test_asset`) already holds `repo_asset_lock` for this slug.
            if let Err(e) = pending_assets::append_pending_upload(state, &repo_slug, &file_name) {
                warn!(repo = %repo_slug, file = %file_name, "{e}");
            }
            let _ = cache_path;
        }
        _ => {}
    }
}

/// Return cache path when the file exists locally; otherwise fetch per project sync settings.
pub async fn ensure_in_cache(
    state: &AppState,
    repo_slug: &str,
    repo_path: &Path,
    file_name: &str,
) -> Result<PathBuf, String> {
    asset_store::validate_file_name(file_name)?;
    if asset_store::cache_hit(state, repo_slug, file_name) {
        return Ok(cache_file_path(state, repo_slug, file_name));
    }
    resolve_remote_into_cache(state, repo_slug, repo_path, file_name).await
}

pub async fn resolve_remote_into_cache(
    state: &AppState,
    repo_slug: &str,
    repo_path: &Path,
    file_name: &str,
) -> Result<PathBuf, String> {
    let cfg = project_sync_config::load_project_sync_config(repo_path);
    let lock = repo_asset_lock(state, repo_slug);
    let _guard = lock.lock().await;
    match cfg.provider_type_normalized().as_str() {
        "local_path" => resolve_from_local_path(state, repo_slug, &cfg, file_name),
        "cloud_api" => download_from_s3(state, repo_slug, &cfg, file_name).await,
        other => Err(format!(
            "Asset not in cache and provider_type {:?} cannot resolve remote assets",
            other
        )),
    }
}

#[allow(dead_code)]
pub fn remote_source_path(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    file_name: &str,
) -> Option<PathBuf> {
    local_path_source_file(state, cfg, repo_slug, file_name)
}

#[allow(dead_code)]
pub fn cache_path_for(state: &AppState, repo_slug: &str, file_name: &str) -> PathBuf {
    cache_file_path(state, repo_slug, file_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Arc, Mutex};

    #[test]
    fn local_path_source_file_legacy_root_then_project_precedence() {
        let base =
            std::env::temp_dir().join(format!("gitoza_local_assets_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let cfg = ProjectSyncConfig {
            provider_type: "local_path".to_string(),
            local_assets_path: Some(base.to_string_lossy().into_owned()),
            ..Default::default()
        };
        let state = test_state(std::env::temp_dir().join(format!(
            "gitoza_local_source_state_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        )));
        let slug = "my-project";
        let name = "img_abc12345.png";

        fs::write(base.join(name), b"legacy").unwrap();
        assert_eq!(
            local_path_source_file(&state, &cfg, slug, name).as_deref(),
            Some(base.join(name).as_path())
        );

        fs::create_dir_all(base.join(slug)).unwrap();
        fs::write(base.join(slug).join(name), b"project").unwrap();
        assert_eq!(
            local_path_source_file(&state, &cfg, slug, name).as_deref(),
            Some(base.join(slug).join(name).as_path())
        );

        let _ = fs::remove_dir_all(&base);
    }

    fn test_state(dir: PathBuf) -> AppState {
        AppState {
            config_dir: dir,
            dbs: Arc::new(Mutex::new(std::collections::BTreeMap::new())),
            ws_tx: tokio::sync::broadcast::channel(1).0,
            active_ws_clients: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            git_op_locks: Arc::new(Mutex::new(std::collections::BTreeMap::new())),
            asset_op_locks: Arc::new(Mutex::new(std::collections::BTreeMap::new())),
        }
    }

    #[tokio::test]
    async fn local_path_pending_sync_conflict_lists_referencing_cases() {
        let base = std::env::temp_dir().join(format!(
            "gitoza_local_path_pending_conflict_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();

        let config_dir = base.join("cfg");
        let repo_dir = base.join("repo");
        let shared_dir = base.join("shared");
        fs::create_dir_all(&config_dir).unwrap();
        fs::create_dir_all(&repo_dir).unwrap();
        fs::create_dir_all(&shared_dir).unwrap();

        // Repo: one case and one ticket referencing the asset id.
        let case_rel = ".gitoza/test/cases/proj/a.md";
        let case_abs = repo_dir.join(case_rel);
        fs::create_dir_all(case_abs.parent().unwrap()).unwrap();
        let file_name = "img_abc12345.png";
        fs::write(&case_abs, format!("title: A\nbody: \"![]({file_name})\"\n")).unwrap();

        let ticket_rel = ".gitoza/tasks/tickets/proj/T-1.md";
        let ticket_abs = repo_dir.join(ticket_rel);
        fs::create_dir_all(ticket_abs.parent().unwrap()).unwrap();
        fs::write(
            &ticket_abs,
            format!("title: Ticket\nbody: \"![]({file_name})\"\n"),
        )
        .unwrap();

        // Repo config: local_path.
        let cfg = ProjectSyncConfig {
            provider_type: "local_path".to_string(),
            local_assets_path: Some(shared_dir.to_string_lossy().into_owned()),
            ..Default::default()
        };
        project_sync_config::save_project_sync_config(&repo_dir, &cfg).unwrap();

        // Cache + pending manifest.
        let state = test_state(config_dir);
        crate::local_sync_paths::save_local_assets_path(
            &state,
            "my-repo",
            &shared_dir.to_string_lossy(),
        )
        .unwrap();
        let slug = "my-repo";
        asset_store::write_cache_bytes(&state, slug, file_name, b"png-bytes").unwrap();
        pending_assets::append_pending_upload(&state, slug, file_name).unwrap();

        // Create destination conflict.
        let dest = shared_dir.join(slug).join(file_name);
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        fs::write(&dest, b"other-bytes").unwrap();

        let err = sync_pending_provider_assets(&state, slug, &repo_dir)
            .await
            .unwrap_err();
        assert!(err.contains("Local-path asset sync conflict"));
        assert!(err.contains(file_name));
        assert!(err.contains(case_rel));
        assert!(err.contains(ticket_rel));

        let _ = fs::remove_dir_all(&base);
    }
}
