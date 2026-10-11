//! S3 connection broker: alignment checks, connection probes target, intentional repo linking.

use std::path::Path;

use crate::asset_sync;
use crate::models::S3VerifyResolveResponse;
use crate::project_sync_config::{self, ProjectSyncConfig};
use crate::sync_secrets::{self, GlobalS3Blueprint, SyncSecrets};
use crate::AppState;

const EXPIRED_CREDENTIALS_MSG: &str =
    "Connection failed. Your global access keys may have expired. Please update credentials manually.";

const BUCKET_MISMATCH_MSG: &str =
    "The repository S3 layout does not match this machine's saved global blueprint. Verify bucket, region, prefix, endpoint, and credentials before saving.";

fn normalize_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

pub fn repo_has_s3_layout(cfg: &ProjectSyncConfig) -> bool {
    cfg.s3_bucket
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some()
        && cfg
            .s3_region
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .is_some()
}

pub fn blueprint_from_config(cfg: &ProjectSyncConfig) -> GlobalS3Blueprint {
    GlobalS3Blueprint {
        s3_bucket: cfg
            .s3_bucket
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or_default()
            .to_string(),
        s3_region: cfg
            .s3_region
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or_default()
            .to_string(),
        s3_prefix: normalize_opt(cfg.s3_prefix.as_deref()),
        s3_endpoint: normalize_opt(cfg.s3_endpoint.as_deref()),
    }
}

pub fn config_from_blueprint(blueprint: &GlobalS3Blueprint) -> ProjectSyncConfig {
    ProjectSyncConfig {
        provider_type: "cloud_api".to_string(),
        s3_bucket: Some(blueprint.s3_bucket.clone()),
        s3_region: Some(blueprint.s3_region.clone()),
        s3_prefix: blueprint.s3_prefix.clone(),
        s3_endpoint: blueprint.s3_endpoint.clone(),
        ..Default::default()
    }
}

pub fn blueprints_align(repo: &GlobalS3Blueprint, global: &GlobalS3Blueprint) -> bool {
    normalize_opt(Some(repo.s3_bucket.as_str())) == normalize_opt(Some(global.s3_bucket.as_str()))
        && normalize_opt(Some(repo.s3_region.as_str()))
            == normalize_opt(Some(global.s3_region.as_str()))
        && normalize_opt(repo.s3_prefix.as_deref()) == normalize_opt(global.s3_prefix.as_deref())
        && normalize_opt(repo.s3_endpoint.as_deref())
            == normalize_opt(global.s3_endpoint.as_deref())
}

async fn resolve_secrets(state: &AppState) -> Result<SyncSecrets, String> {
    tokio::task::block_in_place(|| sync_secrets::load_global_sync_secrets(state))
}

pub async fn test_s3_connection(
    cfg: &ProjectSyncConfig,
    secrets: &SyncSecrets,
) -> Result<(), String> {
    let bucket = cfg
        .s3_bucket
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "s3_bucket is not configured".to_string())?;

    let client = asset_sync::build_s3_client(cfg, secrets).await?;

    if let Err(head_err) = client.head_bucket().bucket(bucket).send().await {
        let head_msg = head_err.to_string();
        if client
            .list_objects_v2()
            .bucket(bucket)
            .max_keys(1)
            .send()
            .await
            .is_err()
        {
            return Err(head_msg);
        }
    }
    Ok(())
}

async fn persist_repo_s3_config(
    state: &AppState,
    slug: &str,
    repo_path: &Path,
    cfg: &ProjectSyncConfig,
) -> Result<(), String> {
    let repo_lock = crate::repo_git_lock(state, slug);
    let _repo_guard = repo_lock.lock().await;
    project_sync_config::save_project_sync_config(repo_path, cfg)
        .map_err(|e| format!("Failed to save project sync config: {e:#}"))?;
    crate::mark_workplace_editing_best_effort(state, slug, repo_path).await;
    let _ = crate::broadcast_refresh(state).await;
    Ok(())
}

fn connection_failure_response(
    state: &AppState,
    repo_slug: &str,
    response_cfg: &ProjectSyncConfig,
    global_blueprint: Option<GlobalS3Blueprint>,
    case_one: bool,
) -> S3VerifyResolveResponse {
    if let Some(ref global) = global_blueprint {
        let repo_bp = blueprint_from_config(response_cfg);
        if blueprints_align(&repo_bp, global) {
            return S3VerifyResolveResponse::ExpiredCredentials {
                message: EXPIRED_CREDENTIALS_MSG.to_string(),
                config: crate::ipc_api::project_sync_config_to_response(
                    state,
                    repo_slug,
                    response_cfg,
                ),
            };
        }
        return S3VerifyResolveResponse::BucketMismatch {
            message: BUCKET_MISMATCH_MSG.to_string(),
            config: crate::ipc_api::project_sync_config_to_response(state, repo_slug, response_cfg),
            global_blueprint: global.clone(),
        };
    }

    let message = if case_one {
        Some(
            "S3 connection test failed using the machine global blueprint. Update credentials or infrastructure settings."
                .to_string(),
        )
    } else {
        Some(format!(
            "S3 connection test failed for bucket {:?}.",
            response_cfg.s3_bucket
        ))
    };

    S3VerifyResolveResponse::NeedsSetup {
        message,
        global_blueprint: None,
    }
}

pub async fn verify_and_resolve_s3_state(
    state: &AppState,
    repo: Option<String>,
    activate: bool,
) -> Result<S3VerifyResolveResponse, crate::ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| crate::ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| crate::ApiError::not_found(format!("{e:#}")))?;

    let repo_cfg = project_sync_config::load_project_sync_config(&repo_path);
    let provider = repo_cfg.provider_type_normalized();

    if provider != "cloud_api" && !activate {
        return Ok(S3VerifyResolveResponse::Skipped);
    }

    let global_blueprint = sync_secrets::load_global_s3_blueprint(state).await.ok();

    if !repo_has_s3_layout(&repo_cfg) {
        if !activate {
            return Ok(S3VerifyResolveResponse::Skipped);
        }
        if let Some(blueprint) = global_blueprint.clone() {
            return Ok(S3VerifyResolveResponse::GlobalProfileAvailable {
                global_blueprint: blueprint,
                aws_credentials_configured: sync_secrets::sync_secrets_configured(state),
            });
        }
        return Ok(S3VerifyResolveResponse::NeedsSetup {
            message: None,
            global_blueprint,
        });
    }

    // Case II — configured repo with explicit bucket settings
    let test_cfg = if provider == "cloud_api" {
        repo_cfg.clone()
    } else {
        // activate=true but repo not yet cloud_api — use global blueprint if present
        global_blueprint
            .as_ref()
            .map(config_from_blueprint)
            .unwrap_or(repo_cfg.clone())
    };

    if !repo_has_s3_layout(&test_cfg) {
        return Ok(S3VerifyResolveResponse::NeedsSetup {
            message: None,
            global_blueprint,
        });
    }

    let secrets = match resolve_secrets(state).await {
        Ok(s) => s,
        Err(_) => {
            return Ok(S3VerifyResolveResponse::NeedsSetup {
                message: Some(
                    "AWS credentials are not saved on this device. Add access keys in Storage Sync settings."
                        .to_string(),
                ),
                global_blueprint,
            });
        }
    };

    match test_s3_connection(&test_cfg, &secrets).await {
        Ok(()) => {
            let saved = project_sync_config::load_project_sync_config(&repo_path);
            Ok(S3VerifyResolveResponse::Active {
                config: crate::ipc_api::project_sync_config_to_response(state, &slug, &saved),
                auto_configured: false,
            })
        }
        Err(_) => Ok(connection_failure_response(
            state,
            &slug,
            if provider == "cloud_api" {
                &repo_cfg
            } else {
                &test_cfg
            },
            global_blueprint,
            false,
        )),
    }
}

/// Intentionally write global blueprint into the repo, then verify S3 connectivity.
pub async fn link_repo_to_global_s3_profile(
    state: &AppState,
    repo: Option<String>,
) -> Result<S3VerifyResolveResponse, crate::ApiError> {
    let slug = crate::resolve_repo_slug(state, repo.as_deref())
        .map_err(|e| crate::ApiError::bad_request(format!("{e:#}")))?;
    let repo_path = crate::resolve_repo_path(state, Some(&slug))
        .map_err(|e| crate::ApiError::not_found(format!("{e:#}")))?;

    let blueprint = sync_secrets::load_global_s3_blueprint(state)
        .await
        .map_err(|e| crate::ApiError::bad_request(format!("{e}")))?;

    let test_cfg = config_from_blueprint(&blueprint);
    persist_repo_s3_config(state, &slug, &repo_path, &test_cfg)
        .await
        .map_err(|e| crate::ApiError::internal(e))?;

    let secrets = match resolve_secrets(state).await {
        Ok(s) => s,
        Err(_) => {
            return Ok(S3VerifyResolveResponse::NeedsSetup {
                message: Some(
                    "Repository linked to global storage layout, but AWS credentials are not saved on this device. Add access keys in Storage Sync settings."
                        .to_string(),
                ),
                global_blueprint: Some(blueprint),
            });
        }
    };

    match test_s3_connection(&test_cfg, &secrets).await {
        Ok(()) => {
            let saved = project_sync_config::load_project_sync_config(&repo_path);
            Ok(S3VerifyResolveResponse::Active {
                config: crate::ipc_api::project_sync_config_to_response(state, &slug, &saved),
                auto_configured: false,
            })
        }
        Err(_) => Ok(connection_failure_response(
            state,
            &slug,
            &test_cfg,
            Some(blueprint),
            false,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blueprints_align_normalizes_optional_fields() {
        let a = GlobalS3Blueprint {
            s3_bucket: "b".to_string(),
            s3_region: "auto".to_string(),
            s3_prefix: None,
            s3_endpoint: Some("".to_string()),
        };
        let b = GlobalS3Blueprint {
            s3_bucket: "b".to_string(),
            s3_region: "auto".to_string(),
            s3_prefix: None,
            s3_endpoint: None,
        };
        assert!(blueprints_align(&a, &b));
    }

    #[test]
    fn blueprints_detect_bucket_mismatch() {
        let a = GlobalS3Blueprint {
            s3_bucket: "bucket-a".to_string(),
            s3_region: "auto".to_string(),
            s3_prefix: None,
            s3_endpoint: None,
        };
        let b = GlobalS3Blueprint {
            s3_bucket: "bucket-b".to_string(),
            s3_region: "auto".to_string(),
            s3_prefix: None,
            s3_endpoint: None,
        };
        assert!(!blueprints_align(&a, &b));
    }

    #[test]
    fn repo_has_s3_layout_requires_bucket_and_region() {
        let cfg = ProjectSyncConfig {
            s3_bucket: Some("b".to_string()),
            s3_region: None,
            ..Default::default()
        };
        assert!(!repo_has_s3_layout(&cfg));
    }
}
