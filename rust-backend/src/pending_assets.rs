//! Per-repo pending cloud upload manifest under `assets_cache/{repo_slug}_pending_assets.json`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::asset_store::{self, ASSETS_CACHE_DIR};
use crate::AppState;

pub fn pending_manifest_file_name(repo_slug: &str) -> String {
    format!("{repo_slug}_pending_assets.json")
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingAssetsManifest {
    #[serde(default)]
    pub pending_uploads: Vec<String>,
}

pub fn manifest_path(state: &AppState, repo_slug: &str) -> Result<PathBuf, String> {
    if !crate::is_safe_repo_slug(repo_slug) {
        return Err("Invalid repo slug".to_string());
    }
    Ok(state
        .config_dir
        .join(ASSETS_CACHE_DIR)
        .join(pending_manifest_file_name(repo_slug)))
}

fn read_manifest_file(path: &std::path::Path) -> Result<PendingAssetsManifest, String> {
    if !path.is_file() {
        return Ok(PendingAssetsManifest::default());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read pending assets manifest: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid pending assets manifest: {e}"))
}

fn write_manifest_file(
    path: &std::path::Path,
    manifest: &PendingAssetsManifest,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create asset cache directory: {e}"))?;
    }
    if manifest.pending_uploads.is_empty() {
        if path.is_file() {
            std::fs::remove_file(path)
                .map_err(|e| format!("Failed to remove empty pending assets manifest: {e}"))?;
        }
        return Ok(());
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize pending assets manifest: {e}"))?;
    std::fs::write(&tmp, json)
        .map_err(|e| format!("Failed to write pending assets manifest: {e}"))?;
    std::fs::rename(&tmp, path)
        .map_err(|e| format!("Failed to finalize pending assets manifest: {e}"))?;
    Ok(())
}

pub fn load_pending_uploads(state: &AppState, repo_slug: &str) -> Result<Vec<String>, String> {
    let path = manifest_path(state, repo_slug)?;
    let manifest = read_manifest_file(&path)?;
    Ok(manifest.pending_uploads)
}

/// Append a validated filename to the manifest (deduped). Caller should hold asset lock when possible.
pub fn append_pending_upload(
    state: &AppState,
    repo_slug: &str,
    file_name: &str,
) -> Result<(), String> {
    asset_store::validate_file_name(file_name)?;
    let path = manifest_path(state, repo_slug)?;
    let mut manifest = read_manifest_file(&path)?;
    let name = file_name.trim().to_string();
    if !manifest.pending_uploads.iter().any(|f| f == &name) {
        manifest.pending_uploads.push(name);
    }
    write_manifest_file(&path, &manifest)
}

pub fn remove_pending_upload(
    state: &AppState,
    repo_slug: &str,
    file_name: &str,
) -> Result<(), String> {
    let path = manifest_path(state, repo_slug)?;
    let mut manifest = read_manifest_file(&path)?;
    let name = file_name.trim();
    manifest.pending_uploads.retain(|f| f != name);
    write_manifest_file(&path, &manifest)
}

pub fn delete_manifest(state: &AppState, repo_slug: &str) -> Result<(), String> {
    let path = manifest_path(state, repo_slug)?;
    if path.is_file() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete pending assets manifest: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

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

    #[test]
    fn append_dedupes_and_remove_clears_manifest() {
        let base =
            std::env::temp_dir().join(format!("gitoza_pending_assets_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let state = test_state(base.clone());
        let slug = "my-repo";

        append_pending_upload(&state, slug, "img_abc12345.png").unwrap();
        append_pending_upload(&state, slug, "img_abc12345.png").unwrap();
        append_pending_upload(&state, slug, "img_def67890.jpg").unwrap();

        let list = load_pending_uploads(&state, slug).unwrap();
        assert_eq!(list.len(), 2);

        remove_pending_upload(&state, slug, "img_abc12345.png").unwrap();
        let list = load_pending_uploads(&state, slug).unwrap();
        assert_eq!(list, vec!["img_def67890.jpg".to_string()]);

        remove_pending_upload(&state, slug, "img_def67890.jpg").unwrap();
        assert!(load_pending_uploads(&state, slug).unwrap().is_empty());
        assert!(!manifest_path(&state, slug).unwrap().is_file());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn manifest_lives_directly_under_assets_cache() {
        let base =
            std::env::temp_dir().join(format!("gitoza_pending_assets_path_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let state = test_state(base.clone());
        let slug = "my-repo";

        append_pending_upload(&state, slug, "img_abc12345.png").unwrap();

        let path = manifest_path(&state, slug).unwrap();
        assert_eq!(
            path,
            base.join("assets_cache")
                .join("my-repo_pending_assets.json")
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn delete_cache_and_manifest_entry_together() {
        use crate::asset_store;

        let base =
            std::env::temp_dir().join(format!("gitoza_delete_asset_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let state = test_state(base.clone());
        let slug = "my-repo";
        let file_name = "img_a1b2c3d4.png";

        asset_store::write_cache_bytes(&state, slug, file_name, b"png-bytes").unwrap();
        append_pending_upload(&state, slug, file_name).unwrap();
        assert!(asset_store::cache_hit(&state, slug, file_name));
        assert_eq!(
            load_pending_uploads(&state, slug).unwrap(),
            vec![file_name.to_string()]
        );

        asset_store::delete_cache_file(&state, slug, file_name).unwrap();
        remove_pending_upload(&state, slug, file_name).unwrap();

        assert!(!asset_store::cache_hit(&state, slug, file_name));
        assert!(load_pending_uploads(&state, slug).unwrap().is_empty());
        assert!(!manifest_path(&state, slug).unwrap().is_file());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn rejects_invalid_slug_and_filename() {
        let base =
            std::env::temp_dir().join(format!("gitoza_pending_assets_bad_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let state = test_state(base.clone());

        assert!(append_pending_upload(&state, "../evil", "img_abc12345.png").is_err());
        assert!(append_pending_upload(&state, "ok", "not-an-asset.png").is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}
