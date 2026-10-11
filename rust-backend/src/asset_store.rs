//! Local asset cache under `~/.gitoza/assets_cache/{repo_slug}/`.

use std::path::{Path, PathBuf};

use crate::AppState;

pub const ASSETS_CACHE_DIR: &str = "assets_cache";
pub const MAX_ASSET_BYTES: usize = 15 * 1024 * 1024;

/// Validates `img_[a-z0-9]{6,32}.(png|jpg|jpeg|webp|gif)`.
pub fn validate_file_name(file_name: &str) -> Result<(), String> {
    let name = file_name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid asset file name".to_string());
    }
    let lower = name.to_ascii_lowercase();
    let valid = lower.starts_with("img_")
        && lower.len() >= 14
        && lower.len() <= 40
        && lower
            .strip_prefix("img_")
            .and_then(|rest| rest.rsplit_once('.'))
            .map(|(id, ext)| {
                id.len() >= 6
                    && id.len() <= 32
                    && id
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
                    && matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "gif")
            })
            .unwrap_or(false);
    if !valid {
        return Err("Asset file name must match img_<id>.(png|jpg|jpeg|webp|gif)".to_string());
    }
    Ok(())
}

pub fn cache_dir(state: &AppState, repo_slug: &str) -> PathBuf {
    state.config_dir.join(ASSETS_CACHE_DIR).join(repo_slug)
}

pub fn cache_file_path(state: &AppState, repo_slug: &str, file_name: &str) -> PathBuf {
    cache_dir(state, repo_slug).join(file_name)
}

pub fn ensure_cache_dir(state: &AppState, repo_slug: &str) -> Result<PathBuf, String> {
    let dir = cache_dir(state, repo_slug);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create asset cache: {e}"))?;
    Ok(dir)
}

pub fn cache_hit(state: &AppState, repo_slug: &str, file_name: &str) -> bool {
    let path = cache_file_path(state, repo_slug, file_name);
    path.is_file()
}

/// Remove a cached asset file if present. Missing files are not an error.
pub fn delete_cache_file(state: &AppState, repo_slug: &str, file_name: &str) -> Result<(), String> {
    validate_file_name(file_name)?;
    let path = cache_file_path(state, repo_slug, file_name);
    if path.is_file() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete asset cache file: {e}"))?;
    }
    Ok(())
}

/// Atomic write: `.tmp` then rename.
pub fn write_cache_bytes(
    state: &AppState,
    repo_slug: &str,
    file_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    validate_file_name(file_name)?;
    if bytes.is_empty() {
        return Err("Empty asset payload".to_string());
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(format!(
            "Asset exceeds maximum size ({} bytes)",
            MAX_ASSET_BYTES
        ));
    }
    ensure_cache_dir(state, repo_slug)?;
    let dest = cache_file_path(state, repo_slug, file_name);
    let tmp = dest.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Failed to write asset cache: {e}"))?;
    std::fs::rename(&tmp, &dest).map_err(|e| format!("Failed to finalize asset cache: {e}"))?;
    Ok(dest)
}

pub fn copy_into_cache(
    state: &AppState,
    repo_slug: &str,
    file_name: &str,
    source: &Path,
) -> Result<PathBuf, String> {
    validate_file_name(file_name)?;
    ensure_cache_dir(state, repo_slug)?;
    let dest = cache_file_path(state, repo_slug, file_name);
    std::fs::copy(source, &dest).map_err(|e| format!("Failed to copy asset into cache: {e}"))?;
    Ok(dest)
}

pub fn absolute_path_string(path: &Path) -> Result<String, String> {
    let p = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Ok(p.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_safe_names() {
        assert!(validate_file_name("img_a1b2c3d4.png").is_ok());
        assert!(validate_file_name("img_abcdef.jpeg").is_ok());
    }

    #[test]
    fn validate_rejects_path_traversal() {
        assert!(validate_file_name("../img_abc.png").is_err());
        assert!(validate_file_name("img_abc.png/..").is_err());
    }
}
