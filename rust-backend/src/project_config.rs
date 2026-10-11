//! Review-system helpers and project feature-flag SQLite cache.
//! Settings are stored in unified `.gitoza/config.json`.

use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

pub use crate::project_sync_config::{
    load_project_config, save_project_config, GitozaProjectConfig, ProjectModules, PROJECT_CONFIG_REL,
};

/// Subset returned by review-specific IPC (backed by [`GitozaProjectConfig`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTestConfig {
    pub enable_review_system: bool,
}

impl From<GitozaProjectConfig> for ProjectTestConfig {
    fn from(cfg: GitozaProjectConfig) -> Self {
        Self {
            enable_review_system: cfg.enable_review_system,
        }
    }
}

/// `approve_status` written on create/edit when review is enabled vs disabled.
pub fn effective_approve_status_for_write(review_enabled: bool) -> &'static str {
    if review_enabled {
        "draft"
    } else {
        "approved"
    }
}

pub fn load_project_test_config(repo_path: &Path) -> ProjectTestConfig {
    load_project_config(repo_path).into()
}

pub fn save_project_test_config(repo_path: &Path, enable_review_system: bool) -> Result<()> {
    let mut cfg = load_project_config(repo_path);
    cfg.enable_review_system = enable_review_system;
    save_project_config(repo_path, &cfg)
}

pub fn save_project_feature_flags(
    repo_path: &Path,
    enable_review_system: bool,
    modules: ProjectModules,
) -> Result<()> {
    let mut cfg = load_project_config(repo_path);
    cfg.enable_review_system = enable_review_system;
    cfg.modules = modules;
    save_project_config(repo_path, &cfg)
}

fn bool_i32(v: bool) -> i32 {
    if v {
        1
    } else {
        0
    }
}

fn i32_bool(v: i32) -> bool {
    v != 0
}

/// Upsert singleton feature-flag row from disk config.
pub fn upsert_project_feature_flags(conn: &Connection, cfg: &GitozaProjectConfig) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"
INSERT INTO project_feature_flags (
  id, enable_review_system,
  module_tickets, module_releases, module_wiki, module_dashboard,
  module_test_repository, module_test_run, module_automation,
  updated_at
) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
ON CONFLICT(id) DO UPDATE SET
  enable_review_system = excluded.enable_review_system,
  module_tickets = excluded.module_tickets,
  module_releases = excluded.module_releases,
  module_wiki = excluded.module_wiki,
  module_dashboard = excluded.module_dashboard,
  module_test_repository = excluded.module_test_repository,
  module_test_run = excluded.module_test_run,
  module_automation = excluded.module_automation,
  updated_at = excluded.updated_at
"#,
        params![
            bool_i32(cfg.enable_review_system),
            bool_i32(cfg.modules.tickets),
            bool_i32(cfg.modules.releases),
            bool_i32(cfg.modules.wiki),
            bool_i32(cfg.modules.dashboard),
            bool_i32(cfg.modules.test_repository),
            bool_i32(cfg.modules.test_run),
            bool_i32(cfg.modules.automation),
            now,
        ],
    )
    .context("upsert project_feature_flags")?;
    Ok(())
}

/// Read cached flags; `None` if the singleton row is missing.
pub fn read_project_feature_flags(
    conn: &Connection,
) -> Result<Option<(bool, ProjectModules)>> {
    let row = conn.query_row(
        r#"
SELECT enable_review_system,
       module_tickets, module_releases, module_wiki, module_dashboard,
       module_test_repository, module_test_run, module_automation
FROM project_feature_flags WHERE id = 1
"#,
        [],
        |r| {
            Ok((
                i32_bool(r.get::<_, i32>(0)?),
                ProjectModules {
                    tickets: i32_bool(r.get::<_, i32>(1)?),
                    releases: i32_bool(r.get::<_, i32>(2)?),
                    wiki: i32_bool(r.get::<_, i32>(3)?),
                    dashboard: i32_bool(r.get::<_, i32>(4)?),
                    test_repository: i32_bool(r.get::<_, i32>(5)?),
                    test_run: i32_bool(r.get::<_, i32>(6)?),
                    automation: i32_bool(r.get::<_, i32>(7)?),
                },
            ))
        },
    );
    match row {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e).context("read project_feature_flags"),
    }
}

/// Load `.gitoza/config.json` into the SQLite feature-flag cache.
pub fn sync_feature_flags_from_disk(
    state: &crate::AppState,
    slug: &str,
    repo_path: &Path,
) -> Result<()> {
    let cfg = load_project_config(repo_path);
    let conn_arc = crate::open_repo_db(state, slug)?;
    let conn = conn_arc.lock().map_err(|_| anyhow::anyhow!("Database lock poisoned"))?;
    upsert_project_feature_flags(&conn, &cfg)?;
    Ok(())
}

/// Resolve flags for status: SQLite cache, or cold-load from disk and upsert.
pub fn resolve_feature_flags_for_status(
    state: &crate::AppState,
    slug: &str,
    repo_path: &Path,
) -> (bool, ProjectModules) {
    if let Ok(conn_arc) = crate::open_repo_db(state, slug) {
        if let Ok(conn) = conn_arc.lock() {
            if let Ok(Some((review, modules))) = read_project_feature_flags(&conn) {
                return (review, modules);
            }
            let cfg = load_project_config(repo_path);
            let _ = upsert_project_feature_flags(&conn, &cfg);
            return (cfg.enable_review_system, cfg.modules);
        }
    }
    let cfg = load_project_config(repo_path);
    (cfg.enable_review_system, cfg.modules)
}

/// True when a changed-path list includes the team project config file.
pub fn paths_include_project_config(paths: &[String]) -> bool {
    paths.iter().any(|p| {
        let n = p.trim().trim_start_matches("./");
        n == PROJECT_CONFIG_REL || n.ends_with("/.gitoza/config.json")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(prefix: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "gitoza_project_config_{}_{}",
            prefix,
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::create_dir_all(&p);
        p
    }

    #[test]
    fn missing_file_defaults_review_enabled() {
        let dir = temp_dir("missing");
        let cfg = load_project_test_config(&dir);
        assert!(cfg.enable_review_system);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_and_load_disable_review() {
        let dir = temp_dir("save");
        save_project_test_config(&dir, false).unwrap();
        let cfg = load_project_test_config(&dir);
        assert!(!cfg.enable_review_system);
        assert!(project_config_path(&dir).is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn effective_approve_status() {
        assert_eq!(effective_approve_status_for_write(true), "draft");
        assert_eq!(effective_approve_status_for_write(false), "approved");
    }

    #[test]
    fn feature_flags_sqlite_round_trip() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
CREATE TABLE project_feature_flags (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enable_review_system INTEGER NOT NULL DEFAULT 1,
  module_tickets INTEGER NOT NULL DEFAULT 1,
  module_releases INTEGER NOT NULL DEFAULT 1,
  module_wiki INTEGER NOT NULL DEFAULT 1,
  module_dashboard INTEGER NOT NULL DEFAULT 1,
  module_test_repository INTEGER NOT NULL DEFAULT 1,
  module_test_run INTEGER NOT NULL DEFAULT 1,
  module_automation INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
"#,
        )
        .unwrap();

        assert!(read_project_feature_flags(&conn).unwrap().is_none());

        let mut cfg = GitozaProjectConfig::default();
        cfg.enable_review_system = false;
        cfg.modules.wiki = false;
        cfg.modules.test_run = false;
        upsert_project_feature_flags(&conn, &cfg).unwrap();

        let (review, modules) = read_project_feature_flags(&conn).unwrap().unwrap();
        assert!(!review);
        assert!(!modules.wiki);
        assert!(!modules.test_run);
        assert!(modules.tickets);
    }

    #[test]
    fn paths_include_project_config_detects_rel() {
        assert!(paths_include_project_config(&[
            ".gitoza/test/cases/a.yaml".into(),
            ".gitoza/config.json".into(),
        ]));
        assert!(!paths_include_project_config(&[
            ".gitoza/test/cases/a.yaml".into(),
        ]));
    }

    fn project_config_path(repo_path: &Path) -> std::path::PathBuf {
        crate::project_sync_config::project_config_path(repo_path)
    }
}
