//! Per-repo pending run YAML flush queue in SQLite (`pending_run_yaml_flush`).

use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingRunFlushFlags {
    #[serde(default)]
    pub flush_head: bool,
    #[serde(default)]
    pub flush_cases: bool,
    #[serde(default)]
    pub flush_results: bool,
}

impl PendingRunFlushFlags {
    pub fn results_only() -> Self {
        Self {
            flush_head: false,
            flush_cases: false,
            flush_results: true,
        }
    }

    pub fn head_only() -> Self {
        Self {
            flush_head: true,
            flush_cases: false,
            flush_results: false,
        }
    }

    pub fn cases_only() -> Self {
        Self {
            flush_head: false,
            flush_cases: true,
            flush_results: false,
        }
    }

    pub fn cases_and_results() -> Self {
        Self {
            flush_head: false,
            flush_cases: true,
            flush_results: true,
        }
    }

    pub fn all() -> Self {
        Self {
            flush_head: true,
            flush_cases: true,
            flush_results: true,
        }
    }

    #[cfg(test)]
    fn merge(&mut self, other: Self) {
        self.flush_head |= other.flush_head;
        self.flush_cases |= other.flush_cases;
        self.flush_results |= other.flush_results;
    }

    fn any(&self) -> bool {
        self.flush_head || self.flush_cases || self.flush_results
    }
}

fn flags_i32(v: bool) -> i32 {
    if v {
        1
    } else {
        0
    }
}

fn flags_from_row(flush_head: i32, flush_cases: i32, flush_results: i32) -> PendingRunFlushFlags {
    PendingRunFlushFlags {
        flush_head: flush_head != 0,
        flush_cases: flush_cases != 0,
        flush_results: flush_results != 0,
    }
}

pub fn has_pending_run_yaml(state: &AppState, repo_slug: &str) -> bool {
    let Ok(conn_arc) = crate::open_repo_db(state, repo_slug) else {
        return false;
    };
    let Ok(conn) = conn_arc.lock() else {
        return false;
    };
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pending_run_yaml_flush LIMIT 1)",
        [],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n != 0)
    .unwrap_or(false)
}

/// Run IDs still listed in the pending YAML flush queue.
pub(crate) fn pending_run_yaml_ids(state: &AppState, repo_slug: &str) -> Vec<String> {
    let Ok(conn_arc) = crate::open_repo_db(state, repo_slug) else {
        return Vec::new();
    };
    let Ok(conn) = conn_arc.lock() else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare("SELECT run_id FROM pending_run_yaml_flush") else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |r| r.get::<_, String>(0));
    match rows {
        Ok(iter) => iter
            .filter_map(|r| r.ok())
            .filter(|id| !id.trim().is_empty())
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// Mark a run as needing YAML flush (deduped); merges shard flags per run_id.
pub fn mark_run_yaml_pending(
    state: &AppState,
    repo_slug: &str,
    run_id: &str,
    flags: PendingRunFlushFlags,
) -> Result<(), String> {
    let rid = run_id.trim();
    if rid.is_empty() || !flags.any() {
        return Ok(());
    }
    let conn_arc = crate::open_repo_db(state, repo_slug).map_err(|e| format!("{e:#}"))?;
    let conn = conn_arc.lock().map_err(|_| "Database lock poisoned".to_string())?;
    conn.execute(
        r#"
INSERT INTO pending_run_yaml_flush (run_id, flush_head, flush_cases, flush_results)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT(run_id) DO UPDATE SET
  flush_head = MAX(pending_run_yaml_flush.flush_head, excluded.flush_head),
  flush_cases = MAX(pending_run_yaml_flush.flush_cases, excluded.flush_cases),
  flush_results = MAX(pending_run_yaml_flush.flush_results, excluded.flush_results)
"#,
        rusqlite::params![
            rid,
            flags_i32(flags.flush_head),
            flags_i32(flags.flush_cases),
            flags_i32(flags.flush_results),
        ],
    )
    .map_err(|e| format!("Failed to mark pending run YAML flush: {e}"))?;
    Ok(())
}

fn clear_run_from_queue(state: &AppState, repo_slug: &str, run_id: &str) -> Result<(), String> {
    let conn_arc = crate::open_repo_db(state, repo_slug).map_err(|e| format!("{e:#}"))?;
    let conn = conn_arc.lock().map_err(|_| "Database lock poisoned".to_string())?;
    conn.execute(
        "DELETE FROM pending_run_yaml_flush WHERE run_id = ?1",
        rusqlite::params![run_id],
    )
    .map_err(|e| format!("Failed to clear pending run YAML flush: {e}"))?;
    Ok(())
}

/// Drop a run from the pending YAML flush queue without writing DB→disk.
pub(crate) fn clear_pending_run_yaml_entry(
    state: &AppState,
    repo_slug: &str,
    run_id: &str,
) -> Result<(), String> {
    clear_run_from_queue(state, repo_slug, run_id)
}

fn read_pending_flags(
    state: &AppState,
    repo_slug: &str,
    run_id: &str,
) -> Result<Option<PendingRunFlushFlags>, String> {
    let conn_arc = crate::open_repo_db(state, repo_slug).map_err(|e| format!("{e:#}"))?;
    let conn = conn_arc.lock().map_err(|_| "Database lock poisoned".to_string())?;
    let row = conn.query_row(
        "SELECT flush_head, flush_cases, flush_results FROM pending_run_yaml_flush WHERE run_id = ?1",
        rusqlite::params![run_id],
        |r| Ok((r.get::<_, i32>(0)?, r.get::<_, i32>(1)?, r.get::<_, i32>(2)?)),
    );
    match row {
        Ok((h, c, res)) => Ok(Some(flags_from_row(h, c, res))),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to read pending run YAML flush: {e}")),
    }
}

/// Flush one run's pending YAML shards from DB to disk (no git lock).
async fn flush_one_run_yaml_from_db(
    state: &AppState,
    repo_slug: &str,
    run_id: &str,
) -> Result<bool, String> {
    let Some(flags) = read_pending_flags(state, repo_slug, run_id)? else {
        return Ok(false);
    };

    let repo_path =
        crate::resolve_repo_path(state, Some(repo_slug)).map_err(|e| format!("{e:#}"))?;
    let conn_arc = crate::open_repo_db(state, repo_slug).map_err(|e| format!("{e:#}"))?;
    let (wrote_head, wrote_cases, wrote_results) = {
        let conn = conn_arc.lock().unwrap();
        let wrote_head = if flags.flush_head {
            crate::run_publish::flush_run_head_yaml_from_db(&repo_path, &conn, repo_slug, run_id)
                .map_err(|e| format!("{e:#}"))?
        } else {
            false
        };
        let wrote_cases = if flags.flush_cases {
            crate::run_publish::flush_run_cases_yaml_from_db(&repo_path, &conn, repo_slug, run_id)
                .map_err(|e| format!("{e:#}"))?
        } else {
            false
        };
        let wrote_results = if flags.flush_results {
            crate::run_publish::flush_run_results_yaml_from_db(&repo_path, &conn, repo_slug, run_id)
                .map_err(|e| format!("{e:#}"))?
        } else {
            false
        };
        (wrote_head, wrote_cases, wrote_results)
    };
    if wrote_head || wrote_cases || wrote_results {
        clear_run_from_queue(state, repo_slug, run_id)?;
    }
    Ok(wrote_head || wrote_cases || wrote_results)
}

/// Flush pending run YAML shards before index reads disk (no-op when queue empty).
pub async fn flush_pending_run_yaml_before_index(
    state: &AppState,
    repo_slug: &str,
) -> Result<(), String> {
    if !has_pending_run_yaml(state, repo_slug) {
        return Ok(());
    }
    flush_all_pending_run_yaml_inner(state, repo_slug).await?;
    Ok(())
}

/// Flush all pending runs without acquiring `repo_git_lock` (caller must hold lock if needed).
pub async fn flush_all_pending_run_yaml_inner(
    state: &AppState,
    repo_slug: &str,
) -> Result<usize, String> {
    let ids = pending_run_yaml_ids(state, repo_slug);
    let mut flushed = 0usize;
    for run_id in ids {
        if flush_one_run_yaml_from_db(state, repo_slug, &run_id).await? {
            flushed += 1;
        } else {
            let _ = clear_run_from_queue(state, repo_slug, &run_id);
        }
    }
    Ok(flushed)
}

/// Flush pending results YAML for a single run; returns true if a file was written.
pub async fn flush_pending_run_yaml(
    state: &AppState,
    repo_slug: &str,
    run_id: &str,
) -> Result<bool, String> {
    let git_lock = crate::repo_git_lock(state, repo_slug);
    let _guard = git_lock.lock().await;
    flush_one_run_yaml_from_db(state, repo_slug, run_id).await
}

/// Flush all runs pending YAML export for a repo (acquires git lock).
pub async fn flush_all_pending_run_yaml(
    state: &AppState,
    repo_slug: &str,
) -> Result<usize, String> {
    let git_lock = crate::repo_git_lock(state, repo_slug);
    let _guard = git_lock.lock().await;
    flush_all_pending_run_yaml_inner(state, repo_slug).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
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

    #[tokio::test]
    async fn flush_inner_empty_queue_returns_zero_without_git_lock() {
        let base = std::env::temp_dir().join(format!(
            "gitoza_pending_run_yaml_inner_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let state = test_state(base.clone());
        let slug = "my-repo";

        assert!(!has_pending_run_yaml(&state, slug));
        let flushed = flush_all_pending_run_yaml_inner(&state, slug)
            .await
            .unwrap();
        assert_eq!(flushed, 0);
        assert!(state.git_op_locks.lock().unwrap().is_empty());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn mark_and_has_pending_run_yaml() {
        let base = std::env::temp_dir().join(format!(
            "gitoza_pending_run_yaml_mark_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let state = test_state(base.clone());
        let slug = "my-repo";

        mark_run_yaml_pending(&state, slug, "run-1", PendingRunFlushFlags::results_only()).unwrap();
        mark_run_yaml_pending(&state, slug, "run-1", PendingRunFlushFlags::results_only()).unwrap();
        assert!(has_pending_run_yaml(&state, slug));

        let flags = read_pending_flags(&state, slug, "run-1").unwrap().unwrap();
        assert!(flags.flush_results);
        assert!(!flags.flush_cases);
        assert!(!flags.flush_head);

        mark_run_yaml_pending(&state, slug, "run-1", PendingRunFlushFlags::cases_only()).unwrap();
        let flags = read_pending_flags(&state, slug, "run-1").unwrap().unwrap();
        assert!(flags.flush_results);
        assert!(flags.flush_cases);

        clear_pending_run_yaml_entry(&state, slug, "run-1").unwrap();
        assert!(!has_pending_run_yaml(&state, slug));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn merge_pending_flags() {
        let mut f = PendingRunFlushFlags::results_only();
        f.merge(PendingRunFlushFlags::head_only());
        assert!(f.flush_results);
        assert!(f.flush_head);
        assert!(!f.flush_cases);
    }
}
