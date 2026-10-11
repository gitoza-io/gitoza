//! Machine-local local_path settings under `~/.gitoza/sync_secrets/local_path/`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::project_sync_config::{self, ProjectSyncConfig};
use crate::AppState;

const LOCAL_PATH_DIR: &str = "local_path";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LocalPathProfile {
    local_assets_path: String,
}

fn local_path_profiles_dir(state: &AppState) -> PathBuf {
    crate::sync_secrets::secrets_dir(state).join(LOCAL_PATH_DIR)
}

pub fn local_path_profile_path(state: &AppState, repo_slug: &str) -> PathBuf {
    local_path_profiles_dir(state).join(format!("{}.json", repo_slug.trim()))
}

pub fn load_local_assets_path(state: &AppState, repo_slug: &str) -> Option<String> {
    let path = local_path_profile_path(state, repo_slug);
    let raw = std::fs::read_to_string(path).ok()?;
    let profile: LocalPathProfile = serde_json::from_str(&raw).ok()?;
    let trimmed = profile.local_assets_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

pub fn save_local_assets_path(state: &AppState, repo_slug: &str, path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("local_assets_path must not be empty".to_string());
    }
    let out = serde_json::to_string_pretty(&LocalPathProfile {
        local_assets_path: trimmed.to_string(),
    })
    .map_err(|e| format!("Failed to serialize local path profile: {e}"))?;
    let profile_path = local_path_profile_path(state, repo_slug);
    write_json_atomic(&profile_path, &out)
}

pub fn clear_local_assets_path(state: &AppState, repo_slug: &str) -> Result<(), String> {
    let path = local_path_profile_path(state, repo_slug);
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(&path).map_err(|e| {
        format!(
            "Failed to remove local path profile {}: {e}",
            path.display()
        )
    })
}

pub fn effective_local_assets_path(
    state: &AppState,
    repo_slug: &str,
    git_cfg: &ProjectSyncConfig,
) -> Option<PathBuf> {
    let local = load_local_assets_path(state, repo_slug).map(PathBuf::from);
    if local.is_some() {
        return local;
    }
    git_cfg
        .local_assets_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

pub fn migrate_legacy_local_assets_path_if_needed(
    state: &AppState,
    repo_slug: &str,
    repo_path: &Path,
) -> Result<(), String> {
    if load_local_assets_path(state, repo_slug).is_some() {
        return Ok(());
    }
    let mut cfg = project_sync_config::load_project_config(repo_path);
    let Some(legacy_path) = cfg
        .local_assets_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
    else {
        return Ok(());
    };
    save_local_assets_path(state, repo_slug, &legacy_path)?;
    cfg.local_assets_path = None;
    project_sync_config::save_project_config(repo_path, &cfg)
        .map_err(|e| format!("Failed to rewrite repo config without local_assets_path: {e:#}"))
}

fn write_json_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "Invalid local path profile location".to_string())?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create local path profile dir: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents)
        .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    set_private_file_permissions(&tmp);
    std::fs::rename(&tmp, path).map_err(|e| format!("Failed to rename {}: {e}", path.display()))?;
    set_private_file_permissions(path);
    Ok(())
}

fn set_private_file_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_path_profile_round_trip_and_clear() {
        let base = std::env::temp_dir().join(format!(
            "gitoza_local_sync_paths_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let state = crate::new_state(base.clone());
        let slug = "repo-a";
        save_local_assets_path(&state, slug, " /tmp/team-assets ").unwrap();
        assert_eq!(
            load_local_assets_path(&state, slug).as_deref(),
            Some("/tmp/team-assets")
        );
        clear_local_assets_path(&state, slug).unwrap();
        assert!(load_local_assets_path(&state, slug).is_none());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn save_local_assets_path_rejects_empty() {
        let base = std::env::temp_dir().join(format!(
            "gitoza_local_sync_paths_empty_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let state = crate::new_state(base.clone());
        let err = save_local_assets_path(&state, "repo-a", "   ").unwrap_err();
        assert!(err.contains("must not be empty"));
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn local_path_profiles_are_repo_scoped() {
        let base = std::env::temp_dir().join(format!(
            "gitoza_local_sync_paths_scope_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let state = crate::new_state(base.clone());
        save_local_assets_path(&state, "repo-a", "/tmp/a").unwrap();
        save_local_assets_path(&state, "repo-b", "/tmp/b").unwrap();
        assert_eq!(
            load_local_assets_path(&state, "repo-a").as_deref(),
            Some("/tmp/a")
        );
        assert_eq!(
            load_local_assets_path(&state, "repo-b").as_deref(),
            Some("/tmp/b")
        );
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn migrate_legacy_local_assets_path_moves_to_machine_local() {
        let base = std::env::temp_dir().join(format!(
            "gitoza_local_sync_paths_migrate_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let state = crate::new_state(base.join("cfg"));
        let repo_path = base.join("repo");
        std::fs::create_dir_all(&repo_path).unwrap();
        let mut cfg = project_sync_config::GitozaProjectConfig::default();
        cfg.provider_type = "local_path".to_string();
        cfg.local_assets_path = Some("/tmp/legacy-path".to_string());
        project_sync_config::save_project_config(&repo_path, &cfg).unwrap();

        migrate_legacy_local_assets_path_if_needed(&state, "repo-a", &repo_path).unwrap();

        assert_eq!(
            load_local_assets_path(&state, "repo-a").as_deref(),
            Some("/tmp/legacy-path")
        );
        let saved = project_sync_config::load_project_config(&repo_path);
        assert!(saved.local_assets_path.is_none());
        assert_eq!(saved.provider_type, "local_path");
        let _ = std::fs::remove_dir_all(base);
    }
}
