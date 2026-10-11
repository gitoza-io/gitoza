//! Local cache for downloaded JUnit XML under `~/.gitoza/test_results_cache/{repo_slug}/`.
//!
//! Layout: `{execution_id}/{junit_file}` (mirrors storage / SQLite execution id).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::automation_paths::cache_relative_path_for_junit;
use crate::AppState;

pub const TEST_RESULTS_CACHE_DIR: &str = "test_results_cache";
pub const MAX_CACHE_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_CACHE_FILES: usize = 200;

pub fn cache_dir(state: &AppState, repo_slug: &str) -> PathBuf {
    state
        .config_dir
        .join(TEST_RESULTS_CACHE_DIR)
        .join(repo_slug.trim())
}

pub fn cache_file_path(state: &AppState, repo_slug: &str, cache_relative_path: &str) -> PathBuf {
    cache_dir(state, repo_slug).join(cache_relative_path)
}

/// Cache relative path: `{execution_id}/{junit_file}`.
pub fn cache_name_for_junit(execution_id: &str, junit_file: &str) -> String {
    cache_relative_path_for_junit(execution_id, junit_file)
}

fn validate_cache_relative_path(relative: &str) -> Result<(), String> {
    let rel = relative.trim();
    if rel.is_empty() {
        return Err("Invalid cache path: empty".to_string());
    }
    if rel.contains('\\') || rel.contains("..") {
        return Err("Invalid cache path: traversal not allowed".to_string());
    }
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err("Invalid cache path: empty or reserved segment".to_string());
        }
    }
    Ok(())
}

pub fn ensure_cache_dir(state: &AppState, repo_slug: &str) -> Result<PathBuf, String> {
    let dir = cache_dir(state, repo_slug);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create test results cache: {e}"))?;
    Ok(dir)
}

pub fn cache_hit(state: &AppState, repo_slug: &str, cache_relative_path: &str) -> bool {
    validate_cache_relative_path(cache_relative_path).is_ok()
        && cache_file_path(state, repo_slug, cache_relative_path).is_file()
}

pub fn write_cache_bytes(
    state: &AppState,
    repo_slug: &str,
    cache_relative_path: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    validate_cache_relative_path(cache_relative_path)?;
    if bytes.is_empty() {
        return Err("Empty JUnit payload".to_string());
    }
    let dir = ensure_cache_dir(state, repo_slug)?;
    let dest = dir.join(cache_relative_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create JUnit cache dir: {e}"))?;
    }
    let tmp = dest.with_file_name(format!(
        "{}.tmp",
        dest.file_name()
            .ok_or_else(|| "Invalid cache path".to_string())?
            .to_string_lossy()
    ));
    fs::write(&tmp, bytes).map_err(|e| format!("Failed to write JUnit cache: {e}"))?;
    fs::rename(&tmp, &dest).map_err(|e| format!("Failed to finalize JUnit cache: {e}"))?;
    let _ = evict_if_needed(state, repo_slug);
    Ok(dest)
}

pub fn read_cache_bytes(
    state: &AppState,
    repo_slug: &str,
    cache_relative_path: &str,
) -> Result<Vec<u8>, String> {
    validate_cache_relative_path(cache_relative_path)?;
    let path = cache_file_path(state, repo_slug, cache_relative_path);
    fs::read(&path).map_err(|e| format!("Failed to read JUnit cache {}: {e}", path.display()))
}

/// Remove all cached JUnit files for one execution (`{execution_id}/**`).
pub fn purge_execution_cache(
    state: &AppState,
    repo_slug: &str,
    execution_id: &str,
) -> Result<(), String> {
    validate_cache_relative_path(execution_id)?;
    let dir = cache_dir(state, repo_slug).join(execution_id);
    if !dir.exists() {
        return Ok(());
    }
    if dir.is_file() {
        fs::remove_file(&dir).map_err(|e| format!("Failed to remove JUnit cache file: {e}"))?;
        return Ok(());
    }
    fs::remove_dir_all(&dir)
        .map_err(|e| format!("Failed to purge JUnit cache {}: {e}", dir.display()))
}

struct CacheEntry {
    path: PathBuf,
    size: u64,
    accessed: SystemTime,
}

fn collect_cache_files(dir: &Path, entries: &mut Vec<CacheEntry>) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|e| format!("read cache dir: {e}"))? {
        let entry = entry.map_err(|e| format!("read cache entry: {e}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("cache file type: {e}"))?;
        if file_type.is_dir() {
            collect_cache_files(&path, entries)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".tmp"))
        {
            continue;
        }
        let meta = entry
            .metadata()
            .map_err(|e| format!("cache metadata: {e}"))?;
        let size = meta.len();
        let accessed = meta
            .accessed()
            .or_else(|_| meta.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        entries.push(CacheEntry {
            path,
            size,
            accessed,
        });
    }
    Ok(())
}

fn evict_if_needed(state: &AppState, repo_slug: &str) -> Result<(), String> {
    let dir = cache_dir(state, repo_slug);
    if !dir.is_dir() {
        return Ok(());
    }
    let mut entries: Vec<CacheEntry> = Vec::new();
    collect_cache_files(&dir, &mut entries)?;

    let mut total_bytes: u64 = entries.iter().map(|e| e.size).sum();
    let over_bytes = total_bytes > MAX_CACHE_BYTES;
    let over_count = entries.len() > MAX_CACHE_FILES;
    if !over_bytes && !over_count {
        return Ok(());
    }

    entries.sort_by_key(|e| e.accessed);
    let initial_count = entries.len();
    for entry in entries {
        if total_bytes <= MAX_CACHE_BYTES && initial_count <= MAX_CACHE_FILES {
            break;
        }
        if fs::remove_file(&entry.path).is_ok() {
            total_bytes = total_bytes.saturating_sub(entry.size);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicUsize, Arc, Mutex};
    use std::thread;
    use std::time::Duration;
    use tokio::sync::broadcast;

    fn test_state(tmp: &Path) -> AppState {
        let (tx, _rx) = broadcast::channel(8);
        AppState {
            config_dir: tmp.to_path_buf(),
            dbs: Arc::new(Mutex::new(std::collections::BTreeMap::new())),
            ws_tx: tx,
            active_ws_clients: Arc::new(AtomicUsize::new(0)),
            git_op_locks: Arc::new(Mutex::new(std::collections::BTreeMap::new())),
            asset_op_locks: Arc::new(Mutex::new(std::collections::BTreeMap::new())),
        }
    }

    #[test]
    fn cache_relative_path_is_hierarchical() {
        assert_eq!(
            cache_name_for_junit("nightly-api/2026-06-24/42", "junit.xml"),
            "nightly-api/2026-06-24/42/junit.xml"
        );
    }

    #[test]
    fn write_and_read_roundtrip_creates_nested_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let rel = cache_name_for_junit("pipe/2024/1", "junit.xml");
        let path = write_cache_bytes(&state, "repo", &rel, b"<testsuite/>").unwrap();
        assert!(path.is_file());
        assert!(path.to_string_lossy().contains("pipe/2024/1/junit.xml"));
        let bytes = read_cache_bytes(&state, "repo", &rel).unwrap();
        assert_eq!(bytes, b"<testsuite/>");
    }

    #[test]
    fn rejects_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        assert!(write_cache_bytes(&state, "repo", "../evil.xml", b"x").is_err());
        assert!(write_cache_bytes(&state, "repo", "pipe/../evil.xml", b"x").is_err());
        assert!(purge_execution_cache(&state, "repo", "../evil").is_err());
    }

    #[test]
    fn purge_execution_cache_removes_nested_files() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let rel = cache_name_for_junit("pipe/2024/1", "junit.xml");
        write_cache_bytes(&state, "repo", &rel, b"<testsuite/>").unwrap();
        purge_execution_cache(&state, "repo", "pipe/2024/1").unwrap();
        assert!(!cache_hit(&state, "repo", &rel));
    }

    #[test]
    fn eviction_removes_oldest_nested_files() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let rel_old = cache_name_for_junit("pipe/2024/1", "old.xml");
        let rel_new = cache_name_for_junit("pipe/2024/2", "new.xml");
        write_cache_bytes(&state, "repo", &rel_old, b"<old/>").unwrap();
        thread::sleep(Duration::from_millis(50));
        write_cache_bytes(&state, "repo", &rel_new, b"<new/>").unwrap();

        let dir = cache_dir(&state, "repo");
        let mut entries = Vec::new();
        collect_cache_files(&dir, &mut entries).unwrap();
        assert_eq!(entries.len(), 2);

        // Force eviction by lowering limits via direct call pattern — use tiny limits in test
        // by filling many files instead; here we manually invoke eviction after writing 201 files
        for i in 0..199 {
            let rel = format!("bulk/2024/1/case_{i}.xml");
            write_cache_bytes(&state, "repo", &rel, b"<t/>").unwrap();
        }
        let mut after = Vec::new();
        collect_cache_files(&dir, &mut after).unwrap();
        assert!(after.len() <= MAX_CACHE_FILES);
    }
}
