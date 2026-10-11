//! SQLite index and sync orchestration for CI test automation results.

use std::collections::HashSet;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use tracing::warn;

use crate::automation_cache::{self, cache_name_for_junit};
use crate::automation_paths::{self, automation_case_key, automation_suite_key};
use crate::automation_remote::{self, RemoteExecutionRef};
use crate::junit_parser::{
    execution_status_from_stats, merge_junit_stats, parse_junit_xml, ParsedJUnitStats,
};
use crate::models::{
    AutomationExecutionDetailResponse, AutomationExecutionListItem, AutomationExecutionSummary,
    AutomationJunitFileBreakdown, AutomationPipelineListItem, AutomationResultDetailResponse,
    AutomationResultListItem, AutomationResultListResponse, AutomationSuiteListItem,
    AutomationSuiteListResponse, AutomationSyncResponse,
};
use crate::project_sync_config::ProjectSyncConfig;
use crate::AppState;

#[derive(Debug, Default, Deserialize)]
struct ExecutionMeta {
    title: Option<String>,
    branch: Option<String>,
    commit_sha: Option<String>,
    ci_url: Option<String>,
    triggered_by: Option<String>,
    finished_at: Option<String>,
    duration_sec: Option<f64>,
    pipeline_display_name: Option<String>,
}

pub fn init_automation_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
CREATE TABLE IF NOT EXISTS automation_executions (
  execution_id   TEXT PRIMARY KEY,
  repo_slug      TEXT NOT NULL,
  pipeline_name  TEXT NOT NULL,
  build_id       TEXT NOT NULL,
  title          TEXT,
  branch         TEXT,
  commit_sha     TEXT,
  ci_url         TEXT,
  triggered_by   TEXT,
  finished_at    TEXT,
  duration_sec   REAL,
  junit_file_count INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  passed         INTEGER NOT NULL DEFAULT 0,
  failed         INTEGER NOT NULL DEFAULT 0,
  skipped        INTEGER NOT NULL DEFAULT 0,
  error          INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL,
  remote_prefix  TEXT NOT NULL,
  indexed_at     TEXT NOT NULL,
  UNIQUE(repo_slug, pipeline_name, build_id)
);
CREATE INDEX IF NOT EXISTS idx_automation_exec_repo ON automation_executions(repo_slug, finished_at DESC);

CREATE TABLE IF NOT EXISTS automation_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id   TEXT NOT NULL,
  repo_slug      TEXT NOT NULL,
  case_key       TEXT NOT NULL,
  classname      TEXT,
  name           TEXT NOT NULL,
  result         TEXT NOT NULL,
  duration_sec   REAL,
  junit_file     TEXT,
  suite_name     TEXT,
  failure_message TEXT,
  failure_body   TEXT,
  system_out     TEXT,
  UNIQUE(execution_id, case_key)
);
CREATE INDEX IF NOT EXISTS idx_automation_results_exec ON automation_results(execution_id, result);
"#,
    )?;
    let _ = conn.execute(
        "ALTER TABLE automation_results ADD COLUMN suite_name TEXT",
        [],
    );
    Ok(())
}

pub async fn sync_automation_executions(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
) -> Result<AutomationSyncResponse, String> {
    let remote = automation_remote::list_remote_executions(state, cfg, repo_slug).await?;
    let mut discovered = 0u32;
    let mut updated = 0u32;
    let mut errors: Vec<String> = Vec::new();

    for exec_ref in &remote {
        discovered += 1;
        let execution_id = automation_paths::execution_id(
            &exec_ref.pipeline_name,
            &exec_ref.date_folder,
            &exec_ref.build_id,
        );
        let skip = {
            let conn_arc =
                crate::open_repo_db(state, repo_slug).map_err(|e| format!("open db: {e:#}"))?;
            let conn = conn_arc.lock().unwrap();
            should_skip_execution_index(
                &conn,
                &execution_id,
                exec_ref.modified_at.as_deref(),
                &exec_ref.junit_files,
            )?
        };
        if skip {
            continue;
        }

        match fetch_execution_payload(state, cfg, repo_slug, &execution_id, exec_ref).await {
            Ok(payload) => {
                let conn_arc =
                    crate::open_repo_db(state, repo_slug).map_err(|e| format!("open db: {e:#}"))?;
                let conn = conn_arc.lock().unwrap();
                match persist_execution_payload(&conn, repo_slug, &payload) {
                    Ok(()) => updated += 1,
                    Err(e) => errors.push(format!(
                        "{}/{}: {e}",
                        exec_ref.pipeline_name, exec_ref.build_id
                    )),
                }
            }
            Err(e) => errors.push(format!(
                "{}/{}: {e}",
                exec_ref.pipeline_name, exec_ref.build_id
            )),
        }
    }

    let remote_ids = remote_execution_ids(&remote);
    let removed_ids = {
        let conn_arc =
            crate::open_repo_db(state, repo_slug).map_err(|e| format!("open db: {e:#}"))?;
        let conn = conn_arc.lock().unwrap();
        prune_stale_automation_executions(&conn, repo_slug, &remote_ids)?
    };
    for id in &removed_ids {
        if let Err(e) = automation_cache::purge_execution_cache(state, repo_slug, id) {
            warn!(repo = %repo_slug, execution = %id, "{e}");
        }
    }

    Ok(AutomationSyncResponse {
        discovered,
        updated,
        removed: removed_ids.len() as u32,
        errors,
    })
}

fn remote_execution_ids(remote: &[RemoteExecutionRef]) -> HashSet<String> {
    remote
        .iter()
        .map(|exec_ref| {
            automation_paths::execution_id(
                &exec_ref.pipeline_name,
                &exec_ref.date_folder,
                &exec_ref.build_id,
            )
        })
        .collect()
}

fn indexed_junit_files(conn: &Connection, execution_id: &str) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT junit_file FROM automation_results WHERE execution_id = ?1 AND junit_file IS NOT NULL",
        )
        .map_err(|e| format!("prepare junit files: {e}"))?;
    let rows = stmt
        .query_map(params![execution_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query junit files: {e}"))?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|e| format!("collect junit files: {e}"))
}

fn prune_stale_automation_executions(
    conn: &Connection,
    repo_slug: &str,
    remote_ids: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT execution_id FROM automation_executions WHERE repo_slug = ?1")
        .map_err(|e| format!("prepare stale executions: {e}"))?;
    let db_ids = stmt
        .query_map(params![repo_slug], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query stale executions: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect stale executions: {e}"))?;

    let stale: Vec<String> = db_ids
        .into_iter()
        .filter(|id| !remote_ids.contains(id))
        .collect();
    if stale.is_empty() {
        return Ok(vec![]);
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("begin prune tx: {e}"))?;
    for id in &stale {
        tx.execute(
            "DELETE FROM automation_results WHERE execution_id = ?1",
            params![id],
        )
        .map_err(|e| format!("delete stale results: {e}"))?;
        tx.execute(
            "DELETE FROM automation_executions WHERE execution_id = ?1 AND repo_slug = ?2",
            params![id, repo_slug],
        )
        .map_err(|e| format!("delete stale execution: {e}"))?;
    }
    tx.commit().map_err(|e| format!("commit prune tx: {e}"))?;
    Ok(stale)
}

fn should_skip_execution_index(
    conn: &Connection,
    execution_id: &str,
    remote_modified_at: Option<&str>,
    remote_junit_files: &[String],
) -> Result<bool, String> {
    let existing_modified = conn
        .query_row(
            "SELECT indexed_at FROM automation_executions WHERE execution_id = ?1",
            params![execution_id],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("query execution: {e}"))?;

    let Some(ref indexed_at) = existing_modified else {
        return Ok(false);
    };

    let indexed_junit = indexed_junit_files(conn, execution_id)?;
    let remote_junit: HashSet<String> = remote_junit_files.iter().cloned().collect();
    if indexed_junit != remote_junit {
        return Ok(false);
    }

    if let Some(remote_at) = remote_modified_at {
        if remote_at <= indexed_at.as_str() {
            return Ok(true);
        }
        return Ok(false);
    }

    Ok(true)
}

struct ExecutionPayload {
    execution_id: String,
    exec_ref: RemoteExecutionRef,
    meta: ExecutionMeta,
    all_cases: Vec<IndexedCase>,
    merged: ParsedJUnitStats,
    status: String,
    indexed_at: String,
    title: Option<String>,
    finished_at: Option<String>,
}

async fn fetch_execution_payload(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    execution_id: &str,
    exec_ref: &RemoteExecutionRef,
) -> Result<ExecutionPayload, String> {
    let meta_path = format!("{}meta.json", exec_ref.remote_prefix);
    let meta = if let Ok(bytes) =
        automation_remote::download_repo_relative_file(state, cfg, repo_slug, &meta_path).await
    {
        serde_json::from_slice::<ExecutionMeta>(&bytes).unwrap_or_default()
    } else {
        ExecutionMeta::default()
    };

    let mut file_stats: Vec<(String, ParsedJUnitStats)> = Vec::new();
    let mut all_cases: Vec<IndexedCase> = Vec::new();

    for junit_file in &exec_ref.junit_files {
        let rel = format!("{}{}", exec_ref.remote_prefix, junit_file);
        let bytes =
            automation_remote::download_repo_relative_file(state, cfg, repo_slug, &rel).await?;
        let cache_name = cache_name_for_junit(execution_id, junit_file);
        automation_cache::write_cache_bytes(state, repo_slug, &cache_name, &bytes)?;
        let parsed = parse_junit_xml(&bytes)?;
        file_stats.push((junit_file.clone(), parsed.stats.clone()));
        for tc in parsed.cases {
            let case_key =
                automation_case_key(junit_file, tc.classname.as_deref().unwrap_or(""), &tc.name);
            all_cases.push(IndexedCase {
                case_key,
                classname: tc.classname,
                name: tc.name,
                suite_name: tc.suite_name,
                result: tc.result,
                duration_sec: tc.duration_sec,
                junit_file: junit_file.clone(),
                failure_message: tc.failure_message,
                failure_body: tc.failure_body,
                system_out: tc.system_out,
            });
        }
    }

    let merged = merge_junit_stats(
        &file_stats
            .iter()
            .map(|(_, s)| s.clone())
            .collect::<Vec<_>>(),
    );
    let status = execution_status_from_stats(&merged);
    let now = Utc::now().to_rfc3339();
    let title = meta
        .title
        .clone()
        .or(meta.pipeline_display_name.clone())
        .or_else(|| Some(format!("{} #{}", exec_ref.pipeline_name, exec_ref.build_id)));
    let finished_at = meta
        .finished_at
        .clone()
        .or(exec_ref.modified_at.clone())
        .or(Some(now.clone()));

    Ok(ExecutionPayload {
        execution_id: execution_id.to_string(),
        exec_ref: exec_ref.clone(),
        meta,
        all_cases,
        merged,
        status,
        indexed_at: now,
        title,
        finished_at,
    })
}

fn persist_execution_payload(
    conn: &Connection,
    repo_slug: &str,
    payload: &ExecutionPayload,
) -> Result<(), String> {
    let exec_ref = &payload.exec_ref;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("begin tx: {e}"))?;

    tx.execute(
        r#"
INSERT INTO automation_executions (
  execution_id, repo_slug, pipeline_name, build_id, title, branch, commit_sha, ci_url,
  triggered_by, finished_at, duration_sec, junit_file_count, total, passed, failed,
  skipped, error, status, remote_prefix, indexed_at
) VALUES (
  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
)
ON CONFLICT(execution_id) DO UPDATE SET
  title = excluded.title,
  branch = excluded.branch,
  commit_sha = excluded.commit_sha,
  ci_url = excluded.ci_url,
  triggered_by = excluded.triggered_by,
  finished_at = excluded.finished_at,
  duration_sec = excluded.duration_sec,
  junit_file_count = excluded.junit_file_count,
  total = excluded.total,
  passed = excluded.passed,
  failed = excluded.failed,
  skipped = excluded.skipped,
  error = excluded.error,
  status = excluded.status,
  remote_prefix = excluded.remote_prefix,
  indexed_at = excluded.indexed_at
"#,
        params![
            payload.execution_id,
            repo_slug,
            exec_ref.pipeline_name,
            exec_ref.build_id,
            payload.title,
            payload.meta.branch,
            payload.meta.commit_sha,
            payload.meta.ci_url,
            payload.meta.triggered_by,
            payload.finished_at,
            payload.meta.duration_sec,
            exec_ref.junit_files.len() as i64,
            payload.merged.total,
            payload.merged.passed,
            payload.merged.failed,
            payload.merged.skipped,
            payload.merged.error,
            payload.status,
            exec_ref.remote_prefix,
            payload.indexed_at,
        ],
    )
    .map_err(|e| format!("upsert execution: {e}"))?;

    tx.execute(
        "DELETE FROM automation_results WHERE execution_id = ?1",
        params![payload.execution_id],
    )
    .map_err(|e| format!("clear results: {e}"))?;

    for c in &payload.all_cases {
        tx.execute(
            r#"
INSERT INTO automation_results (
  execution_id, repo_slug, case_key, classname, name, result, duration_sec,
  junit_file, suite_name, failure_message, failure_body, system_out
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
"#,
            params![
                payload.execution_id,
                repo_slug,
                c.case_key,
                c.classname,
                c.name,
                c.result,
                c.duration_sec,
                c.junit_file,
                c.suite_name,
                c.failure_message,
                c.failure_body,
                c.system_out,
            ],
        )
        .map_err(|e| format!("insert result: {e}"))?;
    }

    tx.commit().map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

struct IndexedCase {
    case_key: String,
    classname: Option<String>,
    name: String,
    suite_name: Option<String>,
    result: String,
    duration_sec: Option<f64>,
    junit_file: String,
    failure_message: Option<String>,
    failure_body: Option<String>,
    system_out: Option<String>,
}

fn suite_display_label(suite_name: &str) -> String {
    if suite_name.is_empty() {
        "Default".to_string()
    } else {
        suite_name.to_string()
    }
}

pub fn list_automation_pipelines(
    conn: &Connection,
    repo_slug: &str,
) -> Result<Vec<AutomationPipelineListItem>, String> {
    let mut stmt = conn
        .prepare(
            r#"
SELECT pipeline_name,
       COUNT(*) AS execution_count,
       MAX(finished_at) AS last_finished_at,
       SUM(CASE WHEN status != 'passed' THEN 1 ELSE 0 END) AS failed_count
FROM automation_executions
WHERE repo_slug = ?1
GROUP BY pipeline_name
ORDER BY last_finished_at DESC
"#,
        )
        .map_err(|e| format!("prepare pipelines: {e}"))?;

    let rows = stmt
        .query_map(params![repo_slug], |row| {
            Ok(AutomationPipelineListItem {
                pipeline_name: row.get(0)?,
                execution_count: row.get(1)?,
                last_finished_at: row.get(2)?,
                failed_count: row.get(3)?,
            })
        })
        .map_err(|e| format!("query pipelines: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect pipelines: {e}"))
}

pub fn list_automation_executions(
    conn: &Connection,
    repo_slug: &str,
    pipeline_name: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<AutomationExecutionListItem>, String> {
    let mut stmt = conn
        .prepare(
            r#"
SELECT execution_id, pipeline_name, build_id, title, branch, commit_sha, finished_at,
       junit_file_count, total, passed, failed, skipped, error, status
FROM automation_executions
WHERE repo_slug = ?1 AND pipeline_name = ?2
ORDER BY finished_at DESC
LIMIT ?3 OFFSET ?4
"#,
        )
        .map_err(|e| format!("prepare executions: {e}"))?;

    let rows = stmt
        .query_map(params![repo_slug, pipeline_name, limit, offset], |row| {
            Ok(AutomationExecutionListItem {
                execution_id: row.get(0)?,
                pipeline_name: row.get(1)?,
                build_id: row.get(2)?,
                title: row.get(3)?,
                branch: row.get(4)?,
                commit_sha: row.get(5)?,
                finished_at: row.get(6)?,
                junit_file_count: row.get(7)?,
                total: row.get(8)?,
                passed: row.get(9)?,
                failed: row.get(10)?,
                skipped: row.get(11)?,
                error: row.get(12)?,
                status: row.get(13)?,
            })
        })
        .map_err(|e| format!("query executions: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect executions: {e}"))
}

pub fn get_automation_execution(
    conn: &Connection,
    repo_slug: &str,
    execution_id: &str,
) -> Result<Option<AutomationExecutionDetailResponse>, String> {
    let summary = conn
        .query_row(
            r#"
SELECT execution_id, pipeline_name, build_id, title, branch, commit_sha, ci_url,
       triggered_by, finished_at, duration_sec, junit_file_count, total, passed, failed,
       skipped, error, status, remote_prefix
FROM automation_executions
WHERE repo_slug = ?1 AND execution_id = ?2
"#,
            params![repo_slug, execution_id],
            |row| {
                Ok(AutomationExecutionSummary {
                    execution_id: row.get(0)?,
                    pipeline_name: row.get(1)?,
                    build_id: row.get(2)?,
                    title: row.get(3)?,
                    branch: row.get(4)?,
                    commit_sha: row.get(5)?,
                    ci_url: row.get(6)?,
                    triggered_by: row.get(7)?,
                    finished_at: row.get(8)?,
                    duration_sec: row.get(9)?,
                    junit_file_count: row.get(10)?,
                    total: row.get(11)?,
                    passed: row.get(12)?,
                    failed: row.get(13)?,
                    skipped: row.get(14)?,
                    error: row.get(15)?,
                    status: row.get(16)?,
                    remote_prefix: row.get(17)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("get execution: {e}"))?;

    let Some(summary) = summary else {
        return Ok(None);
    };

    let mut stmt = conn
        .prepare(
            r#"
SELECT junit_file,
       COUNT(*) AS total,
       SUM(CASE WHEN result = 'passed' THEN 1 ELSE 0 END) AS passed,
       SUM(CASE WHEN result = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN result = 'skipped' THEN 1 ELSE 0 END) AS skipped,
       SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) AS error
FROM automation_results
WHERE execution_id = ?1
GROUP BY junit_file
ORDER BY junit_file
"#,
        )
        .map_err(|e| format!("prepare junit breakdown: {e}"))?;

    let junit_files = stmt
        .query_map(params![execution_id], |row| {
            Ok(AutomationJunitFileBreakdown {
                junit_file: row.get(0)?,
                total: row.get(1)?,
                passed: row.get(2)?,
                failed: row.get(3)?,
                skipped: row.get(4)?,
                error: row.get(5)?,
            })
        })
        .map_err(|e| format!("query junit breakdown: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect junit breakdown: {e}"))?;

    Ok(Some(AutomationExecutionDetailResponse {
        execution: summary,
        junit_files,
    }))
}

const RESULT_SORT: &str = r#"
CASE result
  WHEN 'failed' THEN 0
  WHEN 'error' THEN 1
  WHEN 'skipped' THEN 2
  WHEN 'passed' THEN 3
  ELSE 4
END,
name COLLATE NOCASE
"#;

pub fn list_automation_results(
    conn: &Connection,
    repo_slug: &str,
    execution_id: &str,
    suite_key: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<AutomationResultListResponse, String> {
    let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<AutomationResultListItem> {
        let name: String = row.get(2)?;
        let classname: Option<String> = row.get(1)?;
        let case_key: String = row.get(0)?;
        let title = if let Some(ref cn) = classname {
            if cn.is_empty() {
                name.clone()
            } else {
                format!("{cn} :: {name}")
            }
        } else {
            name.clone()
        };
        Ok(AutomationResultListItem {
            case_key: case_key.clone(),
            file_path: case_key,
            case_id: classname.unwrap_or_default(),
            title,
            name,
            result: row.get(3)?,
            duration_sec: row.get(4)?,
            junit_file: row.get(5)?,
            suite_name: row.get(6)?,
            failure_message: row.get(7)?,
        })
    };

    let list_sql_base = format!(
        r#"
SELECT case_key, classname, name, result, duration_sec, junit_file, suite_name, failure_message
FROM automation_results
WHERE repo_slug = ?1 AND execution_id = ?2
ORDER BY {RESULT_SORT}
"#
    );

    let (total, items) = if let Some(key) = suite_key.map(str::trim).filter(|s| !s.is_empty()) {
        let (junit_file, suite_name) = automation_paths::parse_automation_suite_key(key)
            .ok_or_else(|| format!("Invalid suite_key: {key}"))?;
        let total: i64 = conn
            .query_row(
                r#"
SELECT COUNT(*) FROM automation_results
WHERE repo_slug = ?1 AND execution_id = ?2
  AND junit_file = ?3 AND COALESCE(suite_name, '') = ?4
"#,
                params![repo_slug, execution_id, junit_file, suite_name],
                |r| r.get(0),
            )
            .map_err(|e| format!("count results: {e}"))?;
        let sql = format!(
            "{list_sql_base} AND junit_file = ?3 AND COALESCE(suite_name, '') = ?4\nLIMIT ?5 OFFSET ?6"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("prepare results: {e}"))?;
        let items = stmt
            .query_map(
                params![
                    repo_slug,
                    execution_id,
                    junit_file,
                    suite_name,
                    limit,
                    offset
                ],
                map_row,
            )
            .map_err(|e| format!("query results: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("collect results: {e}"))?;
        (total, items)
    } else {
        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM automation_results WHERE repo_slug = ?1 AND execution_id = ?2",
                params![repo_slug, execution_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("count results: {e}"))?;
        let sql = format!("{list_sql_base}\nLIMIT ?3 OFFSET ?4");
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("prepare results: {e}"))?;
        let items = stmt
            .query_map(params![repo_slug, execution_id, limit, offset], map_row)
            .map_err(|e| format!("query results: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("collect results: {e}"))?;
        (total, items)
    };

    Ok(AutomationResultListResponse {
        total,
        items,
        limit,
        offset,
    })
}

pub fn list_automation_suites(
    conn: &Connection,
    repo_slug: &str,
    execution_id: &str,
) -> Result<AutomationSuiteListResponse, String> {
    let mut stmt = conn
        .prepare(
            r#"
SELECT junit_file,
       COALESCE(suite_name, '') AS suite_name,
       COUNT(*) AS total,
       SUM(CASE WHEN result = 'passed' THEN 1 ELSE 0 END) AS passed,
       SUM(CASE WHEN result = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN result = 'skipped' THEN 1 ELSE 0 END) AS skipped,
       SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) AS error
FROM automation_results
WHERE repo_slug = ?1 AND execution_id = ?2
GROUP BY junit_file, COALESCE(suite_name, '')
ORDER BY junit_file COLLATE NOCASE, suite_name COLLATE NOCASE
"#,
        )
        .map_err(|e| format!("prepare suites: {e}"))?;

    let rows: Vec<(String, String, i64, i64, i64, i64, i64)> = stmt
        .query_map(params![repo_slug, execution_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })
        .map_err(|e| format!("query suites: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect suites: {e}"))?;

    let name_counts: std::collections::HashMap<String, usize> = rows.iter().fold(
        std::collections::HashMap::new(),
        |mut acc, (_, suite_name, _, _, _, _, _)| {
            let label = suite_display_label(suite_name);
            *acc.entry(label).or_insert(0) += 1;
            acc
        },
    );

    let items = rows
        .into_iter()
        .map(
            |(junit_file, suite_name, total, passed, failed, skipped, error)| {
                let label = suite_display_label(&suite_name);
                let display_name = if name_counts.get(&label).copied().unwrap_or(0) > 1 {
                    format!("{label} ({junit_file})")
                } else {
                    label.clone()
                };
                AutomationSuiteListItem {
                    suite_key: automation_suite_key(&junit_file, &suite_name),
                    junit_file,
                    suite_name: suite_name.clone(),
                    display_name,
                    total,
                    passed,
                    failed,
                    skipped,
                    error,
                }
            },
        )
        .collect();

    Ok(AutomationSuiteListResponse { items })
}

pub(crate) struct ResultDetailRow {
    case_key: String,
    classname: Option<String>,
    name: String,
    result: String,
    duration_sec: Option<f64>,
    junit_file: Option<String>,
    failure_message: Option<String>,
    failure_body: Option<String>,
    system_out: Option<String>,
    remote_prefix: String,
}

pub(crate) fn load_automation_result_detail_row(
    conn: &Connection,
    repo_slug: &str,
    execution_id: &str,
    case_key: &str,
) -> Result<Option<ResultDetailRow>, String> {
    conn.query_row(
        r#"
SELECT r.case_key, r.classname, r.name, r.result, r.duration_sec, r.junit_file,
       r.failure_message, r.failure_body, r.system_out, e.remote_prefix
FROM automation_results r
JOIN automation_executions e ON e.execution_id = r.execution_id
WHERE r.repo_slug = ?1 AND r.execution_id = ?2 AND r.case_key = ?3
"#,
        params![repo_slug, execution_id, case_key],
        map_result_detail_row,
    )
    .optional()
    .map_err(|e| format!("get result: {e}"))
}

pub(crate) fn load_automation_result_detail_row_by_identity(
    conn: &Connection,
    repo_slug: &str,
    execution_id: &str,
    junit_file: &str,
    classname: &str,
    name: &str,
) -> Result<Option<ResultDetailRow>, String> {
    conn.query_row(
        r#"
SELECT r.case_key, r.classname, r.name, r.result, r.duration_sec, r.junit_file,
       r.failure_message, r.failure_body, r.system_out, e.remote_prefix
FROM automation_results r
JOIN automation_executions e ON e.execution_id = r.execution_id
WHERE r.repo_slug = ?1 AND r.execution_id = ?2 AND r.junit_file = ?3
  AND COALESCE(r.classname, '') = ?4 AND r.name = ?5
"#,
        params![repo_slug, execution_id, junit_file, classname, name],
        map_result_detail_row,
    )
    .optional()
    .map_err(|e| format!("get result by identity: {e}"))
}

fn map_result_detail_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResultDetailRow> {
    Ok(ResultDetailRow {
        case_key: row.get(0)?,
        classname: row.get(1)?,
        name: row.get(2)?,
        result: row.get(3)?,
        duration_sec: row.get(4)?,
        junit_file: row.get(5)?,
        failure_message: row.get(6)?,
        failure_body: row.get(7)?,
        system_out: row.get(8)?,
        remote_prefix: row.get(9)?,
    })
}

pub(crate) async fn resolve_automation_result_detail(
    state: &AppState,
    cfg: &ProjectSyncConfig,
    repo_slug: &str,
    execution_id: &str,
    mut row: ResultDetailRow,
) -> Result<AutomationResultDetailResponse, String> {
    let needs_failure_enrichment = matches!(row.result.as_str(), "failed" | "error")
        && (row.failure_body.is_none() || row.failure_message.is_none());

    if needs_failure_enrichment {
        if let Some(ref jf) = row.junit_file {
            let cache_name = cache_name_for_junit(execution_id, jf);
            let bytes = if automation_cache::cache_hit(state, repo_slug, &cache_name) {
                automation_cache::read_cache_bytes(state, repo_slug, &cache_name).ok()
            } else {
                let rel = format!("{}{}", row.remote_prefix, jf);
                if let Ok(downloaded) =
                    automation_remote::download_repo_relative_file(state, cfg, repo_slug, &rel)
                        .await
                {
                    let _ = automation_cache::write_cache_bytes(
                        state,
                        repo_slug,
                        &cache_name,
                        &downloaded,
                    );
                    Some(downloaded)
                } else {
                    None
                }
            };

            if let Some(bytes) = bytes {
                if let Ok(parsed) = parse_junit_xml(&bytes) {
                    let cn = row.classname.as_deref().unwrap_or("");
                    if let Some(tc) = parsed
                        .cases
                        .into_iter()
                        .find(|c| c.classname.as_deref().unwrap_or("") == cn && c.name == row.name)
                    {
                        if row.failure_body.is_none() {
                            row.failure_body = tc.failure_body;
                        }
                        if row.failure_message.is_none() {
                            row.failure_message = tc.failure_message;
                        }
                    }
                }
            }
        }
    }

    Ok(AutomationResultDetailResponse {
        case_key: row.case_key,
        classname: row.classname,
        name: row.name,
        result: row.result,
        duration_sec: row.duration_sec,
        junit_file: row.junit_file,
        failure_message: row.failure_message,
        failure_body: row.failure_body,
        system_out: row.system_out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_automation_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn list_pipelines_empty() {
        let conn = mem_conn();
        let items = list_automation_pipelines(&conn, "repo").unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn load_detail_by_case_key_and_identity() {
        let conn = mem_conn();
        let slug = "repo.git";
        let exec_id = "nightly-api/2026-06-24/42";
        let junit_file = "junit.xml";
        let classname = "com.gitoza.auth.LoginTest";
        let name = "testInvalidPassword";
        let case_key = automation_case_key(junit_file, classname, name);
        let failure_body = "java.lang.AssertionError: expected false";

        conn.execute(
            r#"
INSERT INTO automation_executions (
  execution_id, repo_slug, pipeline_name, build_id, remote_prefix,
  junit_file_count, total, passed, failed, skipped, error, status, indexed_at
) VALUES (?1, ?2, 'nightly-api', '42', 'test_results/nightly-api/2026-06-24/42/', 1, 1, 0, 1, 0, 0, 'failed', '2026-06-24T00:00:00Z')
"#,
            params![exec_id, slug],
        )
        .unwrap();

        conn.execute(
            r#"
INSERT INTO automation_results (
  repo_slug, execution_id, case_key, classname, name, result, junit_file,
  failure_message, failure_body
) VALUES (?1, ?2, ?3, ?4, ?5, 'failed', ?6, 'Assertion failed', ?7)
"#,
            params![
                slug,
                exec_id,
                case_key,
                classname,
                name,
                junit_file,
                failure_body
            ],
        )
        .unwrap();

        let by_key = load_automation_result_detail_row(&conn, slug, exec_id, &case_key).unwrap();
        let by_identity = load_automation_result_detail_row_by_identity(
            &conn, slug, exec_id, junit_file, classname, name,
        )
        .unwrap();

        assert!(by_key.is_some());
        assert!(by_identity.is_some());
        assert_eq!(
            by_key.unwrap().failure_body,
            by_identity.unwrap().failure_body
        );
    }

    #[test]
    fn list_suites_and_filter_results_by_suite_key() {
        let conn = mem_conn();
        let slug = "repo.git";
        let exec_id = "nightly-ui/2026-06-24/55";
        let junit_file = "junit-ui.xml";

        conn.execute(
            r#"
INSERT INTO automation_executions (
  execution_id, repo_slug, pipeline_name, build_id, remote_prefix,
  junit_file_count, total, passed, failed, skipped, error, status, indexed_at
) VALUES (?1, ?2, 'nightly-ui', '55', 'test_results/nightly-ui/2026-06-24/55/', 1, 2, 2, 0, 0, 0, 'passed', '2026-06-24T00:00:00Z')
"#,
            params![exec_id, slug],
        )
        .unwrap();

        for (suite_name, case_name) in [("LoginSuite", "testA"), ("DashboardSuite", "testB")] {
            let case_key = automation_case_key(junit_file, "com.example.Test", case_name);
            conn.execute(
                r#"
INSERT INTO automation_results (
  repo_slug, execution_id, case_key, classname, name, result, junit_file, suite_name
) VALUES (?1, ?2, ?3, 'com.example.Test', ?4, 'passed', ?5, ?6)
"#,
                params![slug, exec_id, case_key, case_name, junit_file, suite_name],
            )
            .unwrap();
        }

        let suites = list_automation_suites(&conn, slug, exec_id).unwrap();
        assert_eq!(suites.items.len(), 2);
        assert!(suites.items.iter().any(|s| s.display_name == "LoginSuite"));
        assert!(suites
            .items
            .iter()
            .any(|s| s.display_name == "DashboardSuite"));

        let login_key = automation_suite_key(junit_file, "LoginSuite");
        let filtered =
            list_automation_results(&conn, slug, exec_id, Some(&login_key), 50, 0).unwrap();
        assert_eq!(filtered.total, 1);
        assert_eq!(filtered.items[0].name, "testA");

        let all = list_automation_results(&conn, slug, exec_id, None, 50, 0).unwrap();
        assert_eq!(all.total, 2);
    }

    fn insert_execution(
        conn: &Connection,
        slug: &str,
        exec_id: &str,
        pipeline: &str,
        build_id: &str,
        indexed_at: &str,
    ) {
        conn.execute(
            r#"
INSERT INTO automation_executions (
  execution_id, repo_slug, pipeline_name, build_id, remote_prefix,
  junit_file_count, total, passed, failed, skipped, error, status, indexed_at
) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0, 0, 0, 0, 'passed', ?6)
"#,
            params![
                exec_id,
                slug,
                pipeline,
                build_id,
                format!("test_results/{exec_id}/"),
                indexed_at,
            ],
        )
        .unwrap();
    }

    #[test]
    fn prune_stale_automation_executions_removes_missing() {
        let conn = mem_conn();
        let slug = "repo.git";
        let keep_id = "nightly-api/2026-06-24/42";
        let stale_id = "nightly-api/2026-06-24/99";
        insert_execution(
            &conn,
            slug,
            keep_id,
            "nightly-api",
            "42",
            "2026-06-24T00:00:00Z",
        );
        insert_execution(
            &conn,
            slug,
            stale_id,
            "nightly-api",
            "99",
            "2026-06-24T00:00:00Z",
        );
        conn.execute(
            "INSERT INTO automation_results (repo_slug, execution_id, case_key, name, result, junit_file)
             VALUES (?1, ?2, 'k1', 'testA', 'passed', 'junit.xml')",
            params![slug, stale_id],
        )
        .unwrap();

        let remote_ids = HashSet::from([keep_id.to_string()]);
        let removed = prune_stale_automation_executions(&conn, slug, &remote_ids).unwrap();
        assert_eq!(removed, vec![stale_id.to_string()]);

        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM automation_executions WHERE repo_slug = ?1",
                params![slug],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 1);
        let stale_results: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM automation_results WHERE execution_id = ?1",
                params![stale_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stale_results, 0);
    }

    #[test]
    fn prune_stale_automation_executions_noop_when_aligned() {
        let conn = mem_conn();
        let slug = "repo.git";
        let exec_id = "nightly-api/2026-06-24/42";
        insert_execution(
            &conn,
            slug,
            exec_id,
            "nightly-api",
            "42",
            "2026-06-24T00:00:00Z",
        );

        let remote_ids = HashSet::from([exec_id.to_string()]);
        let removed = prune_stale_automation_executions(&conn, slug, &remote_ids).unwrap();
        assert!(removed.is_empty());
    }

    #[test]
    fn should_skip_when_junit_files_unchanged() {
        let conn = mem_conn();
        let exec_id = "nightly-api/2026-06-24/42";
        insert_execution(
            &conn,
            "repo.git",
            exec_id,
            "nightly-api",
            "42",
            "2026-06-24T12:00:00Z",
        );
        conn.execute(
            "INSERT INTO automation_results (repo_slug, execution_id, case_key, name, result, junit_file)
             VALUES ('repo.git', ?1, 'k1', 'testA', 'passed', 'junit.xml')",
            params![exec_id],
        )
        .unwrap();

        let skip = should_skip_execution_index(
            &conn,
            exec_id,
            Some("2026-06-24T10:00:00Z"),
            &["junit.xml".to_string()],
        )
        .unwrap();
        assert!(skip);
    }

    #[test]
    fn should_not_skip_when_junit_files_differ() {
        let conn = mem_conn();
        let exec_id = "nightly-api/2026-06-24/42";
        insert_execution(
            &conn,
            "repo.git",
            exec_id,
            "nightly-api",
            "42",
            "2026-06-24T12:00:00Z",
        );
        conn.execute(
            "INSERT INTO automation_results (repo_slug, execution_id, case_key, name, result, junit_file)
             VALUES ('repo.git', ?1, 'k1', 'testA', 'passed', 'junit-a.xml'),
                    ('repo.git', ?1, 'k2', 'testB', 'passed', 'junit-b.xml')",
            params![exec_id],
        )
        .unwrap();

        let skip = should_skip_execution_index(
            &conn,
            exec_id,
            Some("2026-06-24T10:00:00Z"),
            &["junit-a.xml".to_string()],
        )
        .unwrap();
        assert!(!skip);
    }
}
