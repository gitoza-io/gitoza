//! Team-synced project settings at `{repo}/.gitoza/config.json` (storage sync, review toggle, module menus; no secrets).

use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub const PROJECT_CONFIG_REL: &str = ".gitoza/config.json";

/// Alias used across the asset sync pipeline.
pub const PROJECT_SYNC_CONFIG_REL: &str = PROJECT_CONFIG_REL;

fn default_true() -> bool {
    true
}

fn skip_true_bool(v: &bool) -> bool {
    *v
}

fn is_default_modules(m: &ProjectModules) -> bool {
    *m == ProjectModules::default()
}

/// Per-menu visibility flags (missing keys default enabled).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectModules {
    #[serde(default = "default_true", skip_serializing_if = "skip_true_bool")]
    pub tickets: bool,
    #[serde(default = "default_true", skip_serializing_if = "skip_true_bool")]
    pub releases: bool,
    #[serde(default = "default_true", skip_serializing_if = "skip_true_bool")]
    pub wiki: bool,
    #[serde(default = "default_true", skip_serializing_if = "skip_true_bool")]
    pub dashboard: bool,
    #[serde(default = "default_true", skip_serializing_if = "skip_true_bool")]
    pub test_repository: bool,
    #[serde(default = "default_true", skip_serializing_if = "skip_true_bool")]
    pub test_run: bool,
    #[serde(default = "default_true", skip_serializing_if = "skip_true_bool")]
    pub automation: bool,
}

impl Default for ProjectModules {
    fn default() -> Self {
        Self {
            tickets: true,
            releases: true,
            wiki: true,
            dashboard: true,
            test_repository: true,
            test_run: true,
            automation: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitozaProjectConfig {
    #[serde(default = "default_true", skip_serializing_if = "skip_true_bool")]
    pub enable_review_system: bool,
    #[serde(default, skip_serializing_if = "is_default_modules")]
    pub modules: ProjectModules,
    #[serde(default)]
    pub provider_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_assets_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s3_bucket: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s3_region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s3_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s3_endpoint: Option<String>,
}

/// Alias retained for asset sync call sites.
pub type ProjectSyncConfig = GitozaProjectConfig;

impl Default for GitozaProjectConfig {
    fn default() -> Self {
        Self {
            enable_review_system: true,
            modules: ProjectModules::default(),
            provider_type: String::new(),
            local_assets_path: None,
            s3_bucket: None,
            s3_region: None,
            s3_prefix: None,
            s3_endpoint: None,
        }
    }
}

impl GitozaProjectConfig {
    pub fn provider_type_normalized(&self) -> String {
        self.provider_type.trim().to_ascii_lowercase()
    }

    pub fn is_sync_configured(&self) -> bool {
        !self.provider_type.trim().is_empty()
    }
}

pub fn project_config_path(repo_path: &Path) -> std::path::PathBuf {
    repo_path.join(PROJECT_CONFIG_REL)
}

pub fn project_sync_config_path(repo_path: &Path) -> std::path::PathBuf {
    project_config_path(repo_path)
}

pub fn load_project_config(repo_path: &Path) -> GitozaProjectConfig {
    let path = project_config_path(repo_path);
    if !path.is_file() {
        return GitozaProjectConfig::default();
    }
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => GitozaProjectConfig::default(),
    }
}

pub fn save_project_config(repo_path: &Path, cfg: &GitozaProjectConfig) -> Result<()> {
    let path = project_config_path(repo_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create dir {}", parent.display()))?;
    }
    let out = serde_json::to_string_pretty(cfg)?;
    std::fs::write(&path, out).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

pub fn load_project_sync_config(repo_path: &Path) -> ProjectSyncConfig {
    load_project_config(repo_path)
}

pub fn save_project_sync_config(repo_path: &Path, sync: &ProjectSyncConfig) -> Result<()> {
    let mut cfg = load_project_config(repo_path);
    cfg.provider_type = sync.provider_type.clone();
    cfg.local_assets_path = None;
    cfg.s3_bucket = sync.s3_bucket.clone();
    cfg.s3_region = sync.s3_region.clone();
    cfg.s3_prefix = sync.s3_prefix.clone();
    cfg.s3_endpoint = sync.s3_endpoint.clone();
    save_project_config(repo_path, &cfg)
}

/// Build repo-safe sync fields from a set request (strips secrets and clears unused fields).
/// Review settings are preserved when saving via [`save_project_sync_config`].
pub fn project_sync_config_from_set_request(
    payload: &crate::models::SetProjectSyncConfigRequest,
) -> ProjectSyncConfig {
    let provider = payload.provider_type.trim().to_ascii_lowercase();
    match provider.as_str() {
        "local_path" => ProjectSyncConfig {
            provider_type: "local_path".to_string(),
            local_assets_path: None,
            s3_bucket: None,
            s3_region: None,
            s3_prefix: None,
            s3_endpoint: None,
            ..Default::default()
        },
        "cloud_api" => ProjectSyncConfig {
            provider_type: "cloud_api".to_string(),
            local_assets_path: None,
            s3_bucket: payload
                .s3_bucket
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            s3_region: payload
                .s3_region
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            s3_prefix: payload
                .s3_prefix
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            s3_endpoint: payload
                .s3_endpoint
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            ..Default::default()
        },
        _ => ProjectSyncConfig::default(),
    }
}

pub fn local_assets_dir(cfg: &ProjectSyncConfig) -> Option<std::path::PathBuf> {
    cfg.local_assets_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
}

/// `{local_assets_path}/{repo_slug}/` — per-workspace folder for `local_path` sync.
pub fn local_assets_project_dir(
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
) -> Option<std::path::PathBuf> {
    local_assets_dir(cfg).map(|base| base.join(repo_slug.trim()))
}

/// S3 object key: `{optional_prefix}/{repo_slug}/{file_name}`.
pub fn s3_object_key(cfg: &ProjectSyncConfig, repo_slug: &str, file_name: &str) -> String {
    let slug = repo_slug.trim();
    let name = file_name.trim();
    let relative = format!("{slug}/{name}");
    let prefix = cfg
        .s3_prefix
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("");
    if prefix.is_empty() {
        relative
    } else {
        let p = prefix.trim_end_matches('/');
        format!("{p}/{relative}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SetProjectSyncConfigRequest;
    use std::path::PathBuf;

    fn temp_dir(prefix: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "gitoza_project_sync_{}_{}",
            prefix,
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::create_dir_all(&p);
        p
    }

    #[test]
    fn s3_object_key_includes_repo_slug_under_prefix() {
        let cfg = ProjectSyncConfig {
            provider_type: "cloud_api".to_string(),
            s3_prefix: Some("team-assets/".to_string()),
            ..Default::default()
        };
        assert_eq!(
            s3_object_key(&cfg, "my-repo", "img_abc12345.png"),
            "team-assets/my-repo/img_abc12345.png"
        );

        let no_prefix = ProjectSyncConfig::default();
        assert_eq!(
            s3_object_key(&no_prefix, "my-repo", "img_abc12345.png"),
            "my-repo/img_abc12345.png"
        );
    }

    #[test]
    fn from_set_request_snake_case() {
        let req = SetProjectSyncConfigRequest {
            provider_type: "local_path".to_string(),
            local_assets_path: Some("/tmp/assets".to_string()),
            s3_bucket: None,
            s3_region: None,
            s3_prefix: None,
            s3_endpoint: None,
            access_key_id: None,
            secret_access_key: None,
        };
        let cfg = project_sync_config_from_set_request(&req);
        assert_eq!(cfg.provider_type, "local_path");
        assert!(cfg.local_assets_path.is_none());
    }

    #[test]
    fn cloud_api_s3_endpoint_round_trip() {
        let req = SetProjectSyncConfigRequest {
            provider_type: "cloud_api".to_string(),
            local_assets_path: None,
            s3_bucket: Some("my-bucket".to_string()),
            s3_region: Some("auto".to_string()),
            s3_prefix: None,
            s3_endpoint: Some("https://abc.r2.cloudflarestorage.com".to_string()),
            access_key_id: None,
            secret_access_key: None,
        };
        let cfg = project_sync_config_from_set_request(&req);
        assert_eq!(
            cfg.s3_endpoint.as_deref(),
            Some("https://abc.r2.cloudflarestorage.com")
        );
        let json = serde_json::to_string(&cfg).expect("serialize");
        assert!(json.contains("s3_endpoint"));
        let empty_endpoint = project_sync_config_from_set_request(&SetProjectSyncConfigRequest {
            provider_type: "cloud_api".to_string(),
            local_assets_path: None,
            s3_bucket: Some("b".to_string()),
            s3_region: Some("eu-central-1".to_string()),
            s3_prefix: None,
            s3_endpoint: Some("   ".to_string()),
            access_key_id: None,
            secret_access_key: None,
        });
        let json_empty = serde_json::to_string(&empty_endpoint).expect("serialize");
        assert!(!json_empty.contains("s3_endpoint"));
    }

    #[test]
    fn local_assets_project_dir_joins_slug() {
        let cfg = ProjectSyncConfig {
            provider_type: "local_path".to_string(),
            local_assets_path: Some("/tmp/shared".to_string()),
            ..Default::default()
        };
        let dir = local_assets_project_dir(&cfg, "my-repo").expect("dir");
        assert_eq!(dir, std::path::PathBuf::from("/tmp/shared/my-repo"));
    }

    #[test]
    fn deserialize_set_request_camel_case() {
        let req: SetProjectSyncConfigRequest = serde_json::from_str(
            r#"{"providerType":"local_path","localAssetsPath":"/tmp/assets"}"#,
        )
        .expect("deserialize");
        let cfg = project_sync_config_from_set_request(&req);
        assert_eq!(cfg.provider_type, "local_path");
        assert!(cfg.local_assets_path.is_none());
    }

    #[test]
    fn local_path_serialization_omits_local_assets_path() {
        let req = SetProjectSyncConfigRequest {
            provider_type: "local_path".to_string(),
            local_assets_path: Some("/tmp/assets".to_string()),
            s3_bucket: None,
            s3_region: None,
            s3_prefix: None,
            s3_endpoint: None,
            access_key_id: None,
            secret_access_key: None,
        };
        let cfg = project_sync_config_from_set_request(&req);
        let json = serde_json::to_string(&cfg).expect("serialize");
        assert!(!json.contains("local_assets_path"));
    }

    #[test]
    fn save_sync_preserves_review_setting() {
        let dir = temp_dir("preserve_review");
        let mut cfg = GitozaProjectConfig::default();
        cfg.enable_review_system = false;
        cfg.provider_type = "local_path".to_string();
        cfg.local_assets_path = Some("/tmp/a".to_string());
        save_project_config(&dir, &cfg).unwrap();

        let sync_only = project_sync_config_from_set_request(&SetProjectSyncConfigRequest {
            provider_type: "cloud_api".to_string(),
            local_assets_path: None,
            s3_bucket: Some("b".to_string()),
            s3_region: Some("eu-central-1".to_string()),
            s3_prefix: None,
            s3_endpoint: None,
            access_key_id: None,
            secret_access_key: None,
        });
        save_project_sync_config(&dir, &sync_only).unwrap();

        let loaded = load_project_config(&dir);
        assert!(!loaded.enable_review_system);
        assert_eq!(loaded.provider_type, "cloud_api");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn modules_round_trip_and_defaults() {
        let dir = temp_dir("modules");
        let missing = load_project_config(&dir);
        assert!(missing.modules.tickets);
        assert!(missing.modules.wiki);

        let mut cfg = GitozaProjectConfig::default();
        cfg.modules.tickets = false;
        cfg.modules.automation = false;
        save_project_config(&dir, &cfg).unwrap();

        let loaded = load_project_config(&dir);
        assert!(!loaded.modules.tickets);
        assert!(!loaded.modules.automation);
        assert!(loaded.modules.wiki);
        assert!(loaded.modules.test_repository);

        let raw = std::fs::read_to_string(project_config_path(&dir)).unwrap();
        assert!(raw.contains("\"tickets\": false"));
        assert!(!raw.contains("\"wiki\""));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
