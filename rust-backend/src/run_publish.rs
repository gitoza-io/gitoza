use std::path::Path;

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};

use crate::atomic_write_file;

pub const RESULTS_DIR: &str = ".gitoza/test/runs";
pub const ARCHIVE_DIR: &str = ".archive";
pub const HEAD_FILE: &str = "head.yaml";
pub const CASES_FILE: &str = "cases.yaml";
pub const RESULTS_FILE: &str = "results.yaml";

/// Allocated run ids: `R-` + 6 alphanumeric chars (wiki-style).
const RUN_ID_PREFIX: &str = "R";
const RUN_ID_SUFFIX_LEN: usize = 6;
const RUN_ID_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

pub fn sanitize_filename(name: &str) -> String {
    // Python behavior (approx): remove non [\w\s-], collapse whitespace and hyphens to underscores,
    // trim underscores, default to "run", and cap length.
    let mut filtered = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch.is_whitespace() {
            filtered.push(ch);
        }
    }
    let mut collapsed = String::new();
    let mut last_was_sep = false;
    for ch in filtered.chars() {
        let sep = ch.is_whitespace() || ch == '-';
        if sep {
            if !last_was_sep {
                collapsed.push('_');
                last_was_sep = true;
            }
        } else {
            collapsed.push(ch);
            last_was_sep = false;
        }
    }
    let s = collapsed.trim_matches('_');
    if s.is_empty() {
        "run".to_string()
    } else {
        s.chars().take(80).collect()
    }
}

pub fn sanitize_folder_name(name: &str) -> String {
    // Python behavior (approx): remove non [\w\s-], collapse whitespace/hyphens to underscores.
    let mut filtered = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch.is_whitespace() {
            filtered.push(ch);
        }
    }
    let mut collapsed = String::new();
    let mut last_was_sep = false;
    for ch in filtered.chars() {
        let sep = ch.is_whitespace() || ch == '-';
        if sep {
            if !last_was_sep {
                collapsed.push('_');
                last_was_sep = true;
            }
        } else {
            collapsed.push(ch);
            last_was_sep = false;
        }
    }
    collapsed.trim_matches('_').to_string()
}

pub fn get_run_id_from_value(run: &Value) -> Option<String> {
    run.get("run_id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_run_archived(run: &Value) -> bool {
    run.get("archived")
        .map(|v| {
            if let Some(b) = v.as_bool() {
                b
            } else if let Some(i) = v.as_i64() {
                i != 0
            } else {
                false
            }
        })
        .unwrap_or(false)
}

/// Validate `run_id` is safe as a single path segment (folder name).
pub fn validate_run_id_for_dir(run_id: &str) -> bool {
    let rid = run_id.trim();
    !rid.is_empty() && !rid.contains("..") && !rid.contains('/') && !rid.contains('\\')
}

/// True when `run_id` matches the allocated form `R-XXXXXX`.
pub fn is_allocated_run_id(run_id: &str) -> bool {
    let Some(rest) = run_id.strip_prefix(&format!("{RUN_ID_PREFIX}-")) else {
        return false;
    };
    rest.len() == RUN_ID_SUFFIX_LEN
        && rest
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        && validate_run_id_for_dir(run_id)
        && crate::is_valid_case_id(run_id)
}

fn random_run_id_suffix(len: usize) -> String {
    let mut out = String::with_capacity(len);
    while out.len() < len {
        let u = uuid::Uuid::new_v4();
        for b in u.as_bytes() {
            if out.len() >= len {
                break;
            }
            out.push(RUN_ID_ALPHABET[(*b as usize) % RUN_ID_ALPHABET.len()] as char);
        }
    }
    out
}

/// True if a run directory exists under active runs or `.archive` for this id.
pub fn run_id_taken_on_disk(repo_path: &Path, run_id: &str) -> bool {
    if !validate_run_id_for_dir(run_id) {
        return true;
    }
    repo_path.join(get_run_dir_rel_path(run_id, false)).is_dir()
        || repo_path.join(get_run_dir_rel_path(run_id, true)).is_dir()
}

fn run_id_taken_in_db(conn: &Connection, slug: &str, run_id: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2 LIMIT 1",
        params![slug, run_id],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

/// Generate `R-{6}` not used on disk (active + archive) or in `test_runs`.
pub fn generate_unique_run_id(conn: &Connection, slug: &str, repo_path: &Path) -> Result<String> {
    for _ in 0..64 {
        let id = format!(
            "{RUN_ID_PREFIX}-{}",
            random_run_id_suffix(RUN_ID_SUFFIX_LEN)
        );
        if !is_allocated_run_id(&id) {
            continue;
        }
        if run_id_taken_on_disk(repo_path, &id) {
            continue;
        }
        if run_id_taken_in_db(conn, slug, &id) {
            continue;
        }
        return Ok(id);
    }
    anyhow::bail!("Failed to allocate unique run id")
}

pub fn get_run_dir_rel_path(run_id: &str, archived: bool) -> String {
    if archived {
        format!("{RESULTS_DIR}/{ARCHIVE_DIR}/{run_id}")
    } else {
        format!("{RESULTS_DIR}/{run_id}")
    }
}

pub fn get_run_head_rel_path_from_run_id(run_id: &str, archived: bool) -> String {
    format!("{}/{HEAD_FILE}", get_run_dir_rel_path(run_id, archived))
}

pub fn get_run_cases_rel_path_from_run_id(run_id: &str, archived: bool) -> String {
    format!("{}/{CASES_FILE}", get_run_dir_rel_path(run_id, archived))
}

pub fn get_run_results_rel_path_from_run_id(run_id: &str, archived: bool) -> String {
    format!("{}/{RESULTS_FILE}", get_run_dir_rel_path(run_id, archived))
}

pub fn get_run_head_rel_path(run: &Value) -> String {
    let run_id = get_run_id_from_value(run).unwrap_or_else(|| "unknown".to_string());
    get_run_head_rel_path_from_run_id(&run_id, get_run_archived(run))
}

pub fn get_run_cases_rel_path(run: &Value) -> String {
    let run_id = get_run_id_from_value(run).unwrap_or_else(|| "unknown".to_string());
    get_run_cases_rel_path_from_run_id(&run_id, get_run_archived(run))
}

pub fn get_run_results_rel_path(run: &Value) -> String {
    let run_id = get_run_id_from_value(run).unwrap_or_else(|| "unknown".to_string());
    get_run_results_rel_path_from_run_id(&run_id, get_run_archived(run))
}

#[cfg(test)]
pub fn is_run_head_rel_path(rel: &str) -> bool {
    let r = rel.replace('\\', "/");
    r.ends_with("/head.yaml") || r.ends_with("/head.yml")
}

pub fn is_run_results_rel_path(rel: &str) -> bool {
    let r = rel.replace('\\', "/");
    r.ends_with("/results.yaml")
        || r.ends_with("/results.yml")
        || r.ends_with(".results.yaml")
        || r.ends_with(".results.yml")
}

pub fn run_dir_from_shard_rel(rel: &str) -> Option<String> {
    let r = rel.replace('\\', "/");
    if r.ends_with("/head.yaml") || r.ends_with("/head.yml") {
        return Some(
            r.trim_end_matches("/head.yaml")
                .trim_end_matches("/head.yml")
                .to_string(),
        );
    }
    if r.ends_with("/cases.yaml") || r.ends_with("/cases.yml") {
        return Some(
            r.trim_end_matches("/cases.yaml")
                .trim_end_matches("/cases.yml")
                .to_string(),
        );
    }
    if is_run_results_rel_path(&r) {
        if r.ends_with("/results.yaml") || r.ends_with("/results.yml") {
            return Some(
                r.trim_end_matches("/results.yaml")
                    .trim_end_matches("/results.yml")
                    .to_string(),
            );
        }
    }
    None
}

const CASE_RESULT_FIELD_KEYS: &[&str] = &["result", "executed_at", "executed_by", "comment"];

fn read_yaml_file(repo_path: &Path, rel: &str) -> Option<Value> {
    let full = repo_path.join(rel);
    if !full.is_file() {
        return None;
    }
    let raw = std::fs::read_to_string(&full).ok()?;
    let doc: Value = serde_yaml::from_str(&raw).ok()?;
    if doc.is_object() {
        Some(doc)
    } else {
        None
    }
}

pub fn read_run_head(repo_path: &Path, run: &Value) -> Option<Value> {
    read_yaml_file(repo_path, &get_run_head_rel_path(run))
}

pub fn read_run_cases_doc(repo_path: &Path, run: &Value) -> Option<Value> {
    read_yaml_file(repo_path, &get_run_cases_rel_path(run))
}

pub fn read_run_results_doc(repo_path: &Path, run: &Value) -> Option<Value> {
    read_yaml_file(repo_path, &get_run_results_rel_path(run))
}

/// Load head + cases + results shards and merge into one in-memory run doc (index / legacy callers).
pub fn load_run_shards_from_disk(repo_path: &Path, run_id: &str, archived: bool) -> Option<Value> {
    let hint = Value::Object(Map::from_iter([
        ("run_id".to_string(), Value::String(run_id.to_string())),
        ("archived".to_string(), Value::Bool(archived)),
    ]));
    let mut head = read_run_head(repo_path, &hint)?;
    let cases_doc = read_run_cases_doc(repo_path, &hint);
    if let Some(obj) = head.as_object_mut() {
        if let Some(cd) = cases_doc {
            if let Some(cases) = cd.get("cases") {
                obj.insert("cases".to_string(), cases.clone());
            }
        } else {
            obj.insert("cases".to_string(), Value::Array(vec![]));
        }
        if let Some(title) = obj.get("title").and_then(|v| v.as_str()) {
            obj.insert("run_name".to_string(), Value::String(title.to_string()));
        }
    }
    let results = read_run_results_doc(repo_path, &hint);
    Some(merge_results_into_manifest(head, results.as_ref()))
}

/// Merge sparse results file into manifest cases for in-memory doc operations.
/// Legacy `summary` in results.yaml is ignored — counts come from SQLite / result rows.
pub fn merge_results_into_manifest(mut manifest: Value, results_doc: Option<&Value>) -> Value {
    let Some(results_doc) = results_doc else {
        return manifest;
    };
    let results_map = results_doc.get("results").and_then(|v| v.as_object());
    if let Some(obj) = manifest.as_object_mut() {
        if let Some(arr) = obj.get_mut("cases").and_then(|v| v.as_array_mut()) {
            for c in arr.iter_mut() {
                let Some(co) = c.as_object_mut() else {
                    continue;
                };
                let fp = co
                    .get("file_path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if fp.is_empty() {
                    continue;
                }
                let Some(rm) = results_map else {
                    continue;
                };
                let Some(r) = rm.get(&fp).or_else(|| rm.get(fp.as_str())) else {
                    continue;
                };
                let Some(ro) = r.as_object() else {
                    continue;
                };
                for (k, v) in ro {
                    co.insert(k.clone(), v.clone());
                }
            }
        }
    }
    manifest
}

pub fn build_new_run_doc(
    name: &str,
    run_id: Option<&str>,
    description: Option<&str>,
    cases: Option<Vec<Value>>,
    updated_by: Option<&str>,
    review_enabled: bool,
) -> Value {
    let now = chrono::Utc::now().to_rfc3339();
    let case_list = cases.unwrap_or_default();
    // Prefer an allocated id from the caller (`generate_unique_run_id`). When omitted
    // (unit tests), emit a random `R-XXXXXX` without uniqueness checks.
    let run_id_str = match run_id {
        Some(id) => id.to_string(),
        None => format!(
            "{RUN_ID_PREFIX}-{}",
            random_run_id_suffix(RUN_ID_SUFFIX_LEN)
        ),
    };
    let mut doc = Map::new();
    // Stable, human-readable key order in YAML (id, name); repo is implied by file location.
    doc.insert("run_id".to_string(), Value::String(run_id_str));
    doc.insert("title".to_string(), Value::String(name.to_string()));
    doc.insert("run_name".to_string(), Value::String(name.to_string()));
    doc.insert("created_at".to_string(), Value::String(now.clone()));
    doc.insert("updated_at".to_string(), Value::String(now));
    doc.insert("archived".to_string(), Value::Bool(false));
    let approve_status = crate::project_config::effective_approve_status_for_write(review_enabled);
    doc.insert(
        "approve_status".to_string(),
        Value::String(approve_status.to_string()),
    );
    doc.insert("cases".to_string(), Value::Array(case_list));
    doc.insert("comments".to_string(), Value::Array(vec![]));
    if let Some(u) = updated_by {
        doc.insert("updated_by".to_string(), Value::String(u.to_string()));
    }
    if let Some(d) = description {
        doc.insert("description".to_string(), Value::String(d.to_string()));
    }
    Value::Object(doc)
}

fn strip_result_fields_from_case_map(co: Map<String, Value>) -> Map<String, Value> {
    let mut new_case = Map::new();
    for (ck, cv) in co {
        if CASE_RESULT_FIELD_KEYS.contains(&ck.as_str()) {
            continue;
        }
        if ck.starts_with('_') || cv.is_null() {
            continue;
        }
        new_case.insert(ck, cv);
    }
    new_case
}

#[cfg(test)]
fn clean_doc_for_yaml(doc: &Value) -> Value {
    clean_manifest_for_yaml(doc)
}

/// Head shard: metadata and run comments only (no cases, no summary).
/// Strips SQLite-owned `updated_at` / `updated_by` so they are never written to YAML.
pub fn clean_head_for_yaml(doc: &Value) -> Value {
    if let Some(obj) = doc.as_object() {
        let mut cleaned = Map::new();
        for (k, v) in obj {
            if k == "repo_slug" || k == "cases" || k == "summary" {
                continue;
            }
            if k == "updated_at" || k == "updated_by" {
                continue;
            }
            if k.starts_with('_') || v.is_null() {
                continue;
            }
            if k == "run_name" {
                continue;
            }
            cleaned.insert(k.clone(), v.clone());
        }
        if !cleaned.contains_key("title") {
            if let Some(n) = obj.get("run_name").and_then(|v| v.as_str()) {
                cleaned.insert("title".to_string(), Value::String(n.to_string()));
            }
        }
        Value::Object(cleaned)
    } else {
        doc.clone()
    }
}

/// Cases shard: run_id + membership array (no result fields).
pub fn clean_cases_for_yaml(doc: &Value) -> Value {
    let run_id = doc
        .get("run_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let cases = doc
        .get("cases")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|c| {
                    if let Some(co) = c.as_object() {
                        Value::Object(strip_result_fields_from_case_map(co.clone()))
                    } else {
                        c.clone()
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "run_id": run_id,
        "cases": cases,
    })
}

/// Manifest YAML: strip internal keys and per-case result fields.
#[cfg(test)]
pub fn clean_manifest_for_yaml(doc: &Value) -> Value {
    if let Some(obj) = doc.as_object() {
        let mut cleaned = Map::new();
        for (k, v) in obj {
            if k == "repo_slug" {
                continue;
            }
            if k.starts_with('_') || v.is_null() {
                continue;
            }
            if k == "cases" {
                if let Some(arr) = v.as_array() {
                    let cleaned_cases: Vec<Value> = arr
                        .iter()
                        .map(|c| {
                            if let Some(co) = c.as_object() {
                                Value::Object(strip_result_fields_from_case_map(co.clone()))
                            } else {
                                c.clone()
                            }
                        })
                        .collect();
                    cleaned.insert(k.clone(), Value::Array(cleaned_cases));
                } else {
                    cleaned.insert(k.clone(), v.clone());
                }
            } else if k == "summary" {
                // Derived counts live in SQLite only; never persist `summary` in YAML.
                continue;
            } else {
                cleaned.insert(k.clone(), v.clone());
            }
        }
        Value::Object(cleaned)
    } else {
        doc.clone()
    }
}

/// Stamp who/when last acted on this case in the run (add, Pass/Fail/Skip, comment edit).
fn stamp_case_execution_meta(case: &mut Map<String, Value>, executed_by: Option<&str>) {
    let now = chrono::Utc::now().to_rfc3339();
    case.insert("executed_at".to_string(), Value::String(now));
    if let Some(u) = executed_by.filter(|s| !s.trim().is_empty()) {
        case.insert(
            "executed_by".to_string(),
            Value::String(u.trim().to_string()),
        );
    }
}

fn touch_doc(doc: &mut Value, updated_by: Option<&str>) {
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(obj) = doc.as_object_mut() {
        obj.insert("updated_at".to_string(), Value::String(now));
        if let Some(u) = updated_by {
            obj.insert("updated_by".to_string(), Value::String(u.to_string()));
        }
        // Drop legacy in-memory summary if present (counts are SQLite-derived).
        obj.remove("summary");
    }
}

pub fn add_cases_to_doc(doc: &mut Value, entries: &[Value], updated_by: Option<&str>) -> usize {
    let mut cases: Vec<Value> = doc
        .get("cases")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut existing_paths: std::collections::HashSet<String> = cases
        .iter()
        .filter_map(|c| {
            c.get("file_path")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        })
        .collect();

    let mut added = 0usize;
    for e in entries {
        let fp = e.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
        if fp.is_empty() || existing_paths.contains(fp) {
            continue;
        }
        let mut entry = e.clone();
        if let Some(obj) = entry.as_object_mut() {
            if !obj.contains_key("result") {
                obj.insert("result".to_string(), Value::String("pending".to_string()));
            }
            stamp_case_execution_meta(obj, updated_by);
        }
        cases.push(entry);
        existing_paths.insert(fp.to_string());
        added += 1;
    }

    if let Some(obj) = doc.as_object_mut() {
        obj.insert("cases".to_string(), Value::Array(cases));
    }
    if added > 0 {
        touch_doc(doc, updated_by);
    }
    added
}

/// `serde_json::Map` iteration is key-sorted; `serde_yaml::to_string` on `serde_json::Value` also
/// sorts keys. We convert explicitly so run documents start with `run_id`, `run_name`.
fn json_value_to_yaml_preserving_key_order(v: &Value) -> serde_yaml::Value {
    match v {
        Value::Null => serde_yaml::Value::Null,
        Value::Bool(b) => serde_yaml::Value::Bool(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_yaml::Value::Number(serde_yaml::Number::from(i))
            } else if let Some(u) = n.as_u64() {
                serde_yaml::Value::Number(serde_yaml::Number::from(u))
            } else if let Some(f) = n.as_f64() {
                serde_yaml::Value::Number(serde_yaml::Number::from(f))
            } else {
                serde_yaml::Value::Null
            }
        }
        Value::String(s) => serde_yaml::Value::String(s.clone()),
        Value::Array(a) => serde_yaml::Value::Sequence(
            a.iter()
                .map(json_value_to_yaml_preserving_key_order)
                .collect(),
        ),
        Value::Object(o) => {
            if o.contains_key("run_id") && (o.contains_key("title") || o.contains_key("run_name")) {
                let mut m = serde_yaml::Mapping::new();
                if let Some(vv) = o.get("run_id") {
                    m.insert(
                        serde_yaml::Value::String("run_id".to_string()),
                        json_value_to_yaml_preserving_key_order(vv),
                    );
                }
                if let Some(vv) = o.get("title").or_else(|| o.get("run_name")) {
                    m.insert(
                        serde_yaml::Value::String("title".to_string()),
                        json_value_to_yaml_preserving_key_order(vv),
                    );
                }
                let first_two: std::collections::HashSet<&str> =
                    ["run_id", "title", "run_name"].into_iter().collect();
                let mut rest: Vec<&String> = o
                    .keys()
                    .filter(|k| !first_two.contains(k.as_str()))
                    .collect();
                rest.sort();
                for k in rest {
                    if let Some(vv) = o.get(k) {
                        m.insert(
                            serde_yaml::Value::String(k.clone()),
                            json_value_to_yaml_preserving_key_order(vv),
                        );
                    }
                }
                serde_yaml::Value::Mapping(m)
            } else if o.contains_key("file_path") {
                let case_order = [
                    "file_path",
                    "case_id",
                    "title",
                    "priority",
                    "tags",
                    "requirement_ids",
                    "automated",
                    "picked_at_sha",
                    "result",
                    "executed_at",
                    "executed_by",
                    "comment",
                ];
                let mut m = serde_yaml::Mapping::new();
                let pinned: std::collections::HashSet<&str> = case_order.into_iter().collect();
                for k in case_order {
                    if let Some(vv) = o.get(k) {
                        m.insert(
                            serde_yaml::Value::String(k.to_string()),
                            json_value_to_yaml_preserving_key_order(vv),
                        );
                    }
                }
                let mut rest: Vec<&String> =
                    o.keys().filter(|k| !pinned.contains(k.as_str())).collect();
                rest.sort();
                for k in rest {
                    if let Some(vv) = o.get(k) {
                        m.insert(
                            serde_yaml::Value::String(k.clone()),
                            json_value_to_yaml_preserving_key_order(vv),
                        );
                    }
                }
                serde_yaml::Value::Mapping(m)
            } else {
                let mut m = serde_yaml::Mapping::new();
                for (k, vv) in o {
                    m.insert(
                        serde_yaml::Value::String(k.clone()),
                        json_value_to_yaml_preserving_key_order(vv),
                    );
                }
                serde_yaml::Value::Mapping(m)
            }
        }
    }
}

fn write_yaml_value(repo_path: &Path, rel: &str, cleaned: &Value) -> Option<()> {
    let full = repo_path.join(rel);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    let yaml_val = json_value_to_yaml_preserving_key_order(cleaned);
    let yaml = serde_yaml::to_string(&yaml_val).ok()?;
    atomic_write_file(&full, yaml.as_bytes()).ok()?;
    Some(())
}

pub fn write_run_head_yaml(repo_path: &Path, doc: &Value) -> Option<String> {
    let rel = get_run_head_rel_path(doc);
    let cleaned = clean_head_for_yaml(doc);
    write_yaml_value(repo_path, &rel, &cleaned)?;
    Some(rel)
}

pub fn write_run_cases_yaml(repo_path: &Path, doc: &Value) -> Option<String> {
    let rel = get_run_cases_rel_path(doc);
    let cleaned = clean_cases_for_yaml(doc);
    write_yaml_value(repo_path, &rel, &cleaned)?;
    Some(rel)
}

/// Write head + cases (+ optional empty results) under `run_id/` directory.
pub fn write_run_triplet(
    repo_path: &Path,
    doc: &Value,
    write_empty_results: bool,
) -> Option<String> {
    let run_id = get_run_id_from_value(doc)?;
    let archived = get_run_archived(doc);
    let dir_rel = get_run_dir_rel_path(&run_id, archived);
    let dir_abs = repo_path.join(&dir_rel);
    std::fs::create_dir_all(&dir_abs).ok()?;
    let head_rel = write_run_head_yaml(repo_path, doc)?;
    let _cases_rel = write_run_cases_yaml(repo_path, doc)?;
    if write_empty_results {
        let empty_results = json!({
            "run_id": run_id,
            "results": {},
        });
        let _ = write_run_results_yaml(repo_path, doc, &empty_results);
    }
    Some(head_rel)
}

/// Write sparse run results YAML from a results doc value.
/// Strips legacy `summary` so flushes heal old files (counts are SQLite-derived).
pub fn write_run_results_yaml(
    repo_path: &Path,
    run: &Value,
    results_doc: &Value,
) -> Option<String> {
    let rel = get_run_results_rel_path(run);
    let cleaned = clean_results_for_yaml(results_doc);
    write_yaml_value(repo_path, &rel, &cleaned)?;
    Some(rel)
}

/// Results shard for disk: no derived `summary` (avoids merge conflicts on denormalized counts).
fn clean_results_for_yaml(doc: &Value) -> Value {
    if let Some(obj) = doc.as_object() {
        let mut cleaned = Map::new();
        for (k, v) in obj {
            if k == "summary" {
                continue;
            }
            if k.starts_with('_') || v.is_null() {
                continue;
            }
            cleaned.insert(k.clone(), v.clone());
        }
        Value::Object(cleaned)
    } else {
        doc.clone()
    }
}

pub fn remove_run_dir(repo_path: &Path, run_id: &str, archived: bool) {
    let dir = repo_path.join(get_run_dir_rel_path(run_id, archived));
    let _ = std::fs::remove_dir_all(&dir);
}

pub fn move_run_dir(
    repo_path: &Path,
    run_id: &str,
    from_archived: bool,
    to_archived: bool,
) -> Result<(), String> {
    if from_archived == to_archived {
        return Ok(());
    }
    let from = repo_path.join(get_run_dir_rel_path(run_id, from_archived));
    let to = repo_path.join(get_run_dir_rel_path(run_id, to_archived));
    if !from.is_dir() {
        return Err(format!("Run directory not found: {}", from.display()));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create archive parent: {e}"))?;
    }
    if to.exists() {
        std::fs::remove_dir_all(&to).map_err(|e| {
            format!(
                "Failed to remove existing run directory at {}: {e}",
                to.display()
            )
        })?;
    }
    std::fs::rename(&from, &to).map_err(|e| format!("Failed to move run directory: {e}"))
}

/// Build sparse results doc from SQLite for YAML export.
pub fn build_run_results_doc_from_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<Value> {
    let row: Option<(String, String, Option<String>, i64)> = conn
        .query_row(
            "SELECT name, updated_at, updated_by, archived FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
            params![repo_slug, run_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((name, _updated_at, _updated_by, archived_i)) = row else {
        return Err(anyhow!("Run not found"));
    };

    let mut results_map = Map::new();
    let mut stmt = conn.prepare(
        r#"
SELECT r.file_path, r.result, r.executed_at, r.comment
FROM test_run_results r
INNER JOIN test_run_cases c
  ON c.run_id = r.run_id AND c.file_path = r.file_path AND c.repo_slug = ?2
WHERE r.run_id = ?1
"#,
    )?;
    let rows = stmt.query_map(params![run_id, repo_slug], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows.flatten() {
        let (fp, result, executed_at, comment) = row;
        let mut entry = Map::new();
        entry.insert("result".to_string(), Value::String(result));
        entry.insert("executed_at".to_string(), Value::String(executed_at));
        if let Some(c) = comment.filter(|s| !s.trim().is_empty()) {
            entry.insert("comment".to_string(), Value::String(c));
        }
        let eb: Option<String> = conn
            .query_row(
                "SELECT executed_by FROM test_run_cases WHERE run_id = ?1 AND file_path = ?2",
                params![run_id, fp],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        if let Some(e) = eb.filter(|s| !s.trim().is_empty()) {
            entry.insert("executed_by".to_string(), Value::String(e));
        }
        results_map.insert(fp, Value::Object(entry));
    }

    let mut doc = Map::new();
    doc.insert("run_id".to_string(), Value::String(run_id.to_string()));
    doc.insert("title".to_string(), Value::String(name.clone()));
    doc.insert("run_name".to_string(), Value::String(name));
    doc.insert("archived".to_string(), Value::Bool(archived_i != 0));
    doc.insert("results".to_string(), Value::Object(results_map));
    Ok(Value::Object(doc))
}

fn run_row_for_flush(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<
    Option<(
        String,
        String,
        String,
        String,
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    )>,
> {
    conn.query_row(
        r#"
SELECT name, COALESCE(description, ''), COALESCE(created_at, ''), COALESCE(updated_at, ''),
       archived, COALESCE(approve_status, 'draft'),
       updated_by, approved_by, approved_at, COALESCE(run_dir_path, ''), assigned_to, requirement_id, release
FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2
"#,
        params![repo_slug, run_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, Option<String>>(8)?,
                r.get::<_, String>(9)?,
                r.get::<_, Option<String>>(10)?,
                r.get::<_, Option<String>>(11)?,
                r.get::<_, Option<String>>(12)?,
            ))
        },
    )
    .optional()
    .map_err(Into::into)
}

fn run_hint_from_row(run_id: &str, archived: bool) -> Value {
    Value::Object(Map::from_iter([
        ("run_id".to_string(), Value::String(run_id.to_string())),
        ("archived".to_string(), Value::Bool(archived)),
    ]))
}

/// Build head shard document from SQLite.
pub fn build_run_head_doc_from_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<Value> {
    let row = run_row_for_flush(conn, repo_slug, run_id)?;
    let Some((
        name,
        description,
        created_at,
        _updated_at,
        archived_i,
        approve_status,
        _updated_by,
        approved_by,
        approved_at,
        _run_dir_path,
        assigned_to,
        requirement_id,
        release,
    )) = row
    else {
        return Err(anyhow!("Run not found"));
    };
    let run_comments = crate::load_run_comments(conn, repo_slug, run_id)?;
    let mut doc = Map::new();
    doc.insert("run_id".to_string(), Value::String(run_id.to_string()));
    doc.insert("title".to_string(), Value::String(name));
    if !description.trim().is_empty() {
        doc.insert("description".to_string(), Value::String(description));
    }
    if let Some(at) = assigned_to.filter(|s| !s.trim().is_empty()) {
        doc.insert("assigned_to".to_string(), Value::String(at));
    }
    if let Some(req) = crate::requirement_ids::requirement_ids_to_json_value(
        &crate::requirement_ids::requirement_ids_from_db(requirement_id.as_deref()),
    ) {
        doc.insert("requirement_ids".to_string(), req);
    }
    if let Some(rel) = release.filter(|s| !s.trim().is_empty()) {
        doc.insert("release".to_string(), Value::String(rel));
    }
    doc.insert("created_at".to_string(), Value::String(created_at));
    // updated_at / updated_by are SQLite-owned; omit from YAML-bound head docs.
    doc.insert("archived".to_string(), Value::Bool(archived_i != 0));
    doc.insert("approve_status".to_string(), Value::String(approve_status));
    if let Some(ab) = approved_by.filter(|s| !s.trim().is_empty()) {
        doc.insert("approved_by".to_string(), Value::String(ab));
    }
    if let Some(aa) = approved_at.filter(|s| !s.trim().is_empty()) {
        doc.insert("approved_at".to_string(), Value::String(aa));
    }
    if !run_comments.is_empty() {
        doc.insert(
            "comments".to_string(),
            crate::comments_to_json_value(&run_comments),
        );
    }
    Ok(Value::Object(doc))
}

/// Build cases shard document from SQLite.
pub fn build_run_cases_doc_from_db(
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<Value> {
    let archived_i: i64 = conn
        .query_row(
            "SELECT archived FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
            params![repo_slug, run_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let _ = archived_i;
    let case_comments = crate::load_all_run_case_comments_grouped(conn, repo_slug, run_id)?;
    let mut stmt = conn.prepare(
        r#"
SELECT file_path, case_id, picked_at_sha, title, tags, priority, requirement_id, assigned_to, automated
FROM test_run_cases
WHERE repo_slug = ?1 AND run_id = ?2
ORDER BY file_path
"#,
    )?;
    let rows = stmt.query_map(params![repo_slug, run_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, Option<String>>(7)?,
            r.get::<_, i32>(8)?,
        ))
    })?;
    let mut cases: Vec<Value> = Vec::new();
    for row in rows.flatten() {
        let (
            fp,
            case_id,
            picked_at_sha,
            title,
            tags_json,
            priority,
            requirement_id,
            assigned_to,
            automated,
        ) = row;
        let mut co = Map::new();
        co.insert("file_path".to_string(), Value::String(fp.clone()));
        co.insert("case_id".to_string(), Value::String(case_id));
        if let Some(t) = title.filter(|s| !s.trim().is_empty()) {
            co.insert("title".to_string(), Value::String(t));
        }
        if let Some(p) = priority.filter(|s| !s.trim().is_empty()) {
            co.insert("priority".to_string(), Value::String(p));
        }
        if let Some(tags) = tags_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
            .filter(|v| !v.is_empty())
        {
            co.insert(
                "tags".to_string(),
                Value::Array(tags.into_iter().map(Value::String).collect()),
            );
        }
        if let Some(v) = crate::requirement_ids::requirement_ids_to_json_value(
            &crate::requirement_ids::requirement_ids_from_db(requirement_id.as_deref()),
        ) {
            co.insert("requirement_ids".to_string(), v);
        }
        if automated != 0 {
            co.insert("automated".to_string(), Value::Bool(true));
        }
        if let Some(a) = assigned_to.filter(|s| !s.trim().is_empty()) {
            co.insert(
                "assigned_to".to_string(),
                Value::String(crate::assignee_to_yaml_value(&a)),
            );
        }
        if let Some(sha) = picked_at_sha.filter(|s| !s.trim().is_empty()) {
            co.insert("picked_at_sha".to_string(), Value::String(sha));
        }
        if let Some(cm) = case_comments.get(&fp) {
            if !cm.is_empty() {
                co.insert("comments".to_string(), crate::comments_to_json_value(cm));
            }
        }
        cases.push(Value::Object(co));
    }
    Ok(json!({
        "run_id": run_id,
        "cases": cases,
    }))
}

pub fn flush_run_head_yaml_from_db(
    repo_path: &Path,
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<bool> {
    let archived_i: i64 = conn
        .query_row(
            "SELECT archived FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
            params![repo_slug, run_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let head_doc = build_run_head_doc_from_db(conn, repo_slug, run_id)?;
    let mut hint_doc = head_doc.clone();
    if let Some(obj) = hint_doc.as_object_mut() {
        obj.insert("archived".to_string(), Value::Bool(archived_i != 0));
    }
    write_run_head_yaml(repo_path, &hint_doc)
        .ok_or_else(|| anyhow!("Failed to write run head YAML"))?;
    Ok(true)
}

pub fn flush_run_cases_yaml_from_db(
    repo_path: &Path,
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<bool> {
    let archived_i: i64 = conn
        .query_row(
            "SELECT archived FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
            params![repo_slug, run_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let cases_doc = build_run_cases_doc_from_db(conn, repo_slug, run_id)?;
    let mut hint_doc = cases_doc;
    if let Some(obj) = hint_doc.as_object_mut() {
        obj.insert("archived".to_string(), Value::Bool(archived_i != 0));
    }
    write_run_cases_yaml(repo_path, &hint_doc)
        .ok_or_else(|| anyhow!("Failed to write run cases YAML"))?;
    Ok(true)
}

/// Export DB results to `.results.yaml`. Pending clear is handled by the caller.
pub fn flush_run_results_yaml_from_db(
    repo_path: &Path,
    conn: &Connection,
    repo_slug: &str,
    run_id: &str,
) -> Result<bool> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM test_run_results WHERE run_id = ?1",
            params![run_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if count == 0 {
        let archived_i: i64 = conn
            .query_row(
                "SELECT archived FROM test_runs WHERE repo_slug = ?1 AND run_id = ?2",
                params![repo_slug, run_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let results_rel = get_run_results_rel_path_from_run_id(run_id, archived_i != 0);
        let abs = repo_path.join(&results_rel);
        if abs.is_file() {
            std::fs::remove_file(&abs).ok();
        }
        return Ok(false);
    }

    let results_doc = build_run_results_doc_from_db(conn, repo_slug, run_id)?;
    let archived = results_doc
        .get("archived")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let run_hint = run_hint_from_row(run_id, archived);
    write_run_results_yaml(repo_path, &run_hint, &results_doc)
        .ok_or_else(|| anyhow!("Failed to write run results YAML"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_head_preserves_requirement_ids() {
        let mut doc = Map::new();
        doc.insert("run_id".to_string(), Value::String("r1".to_string()));
        doc.insert("title".to_string(), Value::String("Run".to_string()));
        doc.insert(
            "requirement_ids".to_string(),
            Value::Array(vec![
                Value::String("DEMO-1".to_string()),
                Value::String("DEMO-2".to_string()),
            ]),
        );
        doc.insert("updated_at".to_string(), Value::String("x".to_string()));
        let cleaned = clean_head_for_yaml(&Value::Object(doc));
        let ids = cleaned
            .get("requirement_ids")
            .and_then(|v| v.as_array())
            .expect("requirement_ids kept");
        assert_eq!(ids.len(), 2);
        assert!(cleaned.get("updated_at").is_none());
    }

    #[test]
    fn build_run_head_doc_emits_release_when_set_omits_when_empty() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::init_schema(&conn).unwrap();
        let repo = "r1";
        let run_id = "run-rel-yaml";
        crate::sync_test_run_header_from_doc(
            &conn,
            repo,
            &serde_json::json!({
                "run_id": run_id,
                "title": "Release smoke",
                "description": "",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
                "archived": false,
                "approve_status": "draft",
                "release": "ios/gitoza_1.1.0",
            }),
        )
        .unwrap();

        let with_rel = build_run_head_doc_from_db(&conn, repo, run_id).unwrap();
        assert_eq!(
            with_rel.get("release").and_then(|v| v.as_str()),
            Some("ios/gitoza_1.1.0")
        );

        crate::update_test_run_header_db(
            &conn,
            repo,
            run_id,
            None,
            None,
            None,
            None,
            None,
            Some(None),
            Some("tester"),
        )
        .unwrap();
        let without_rel = build_run_head_doc_from_db(&conn, repo, run_id).unwrap();
        assert!(without_rel.get("release").is_none());
    }

    #[test]
    fn run_doc_yaml_starts_with_run_id_run_name() {
        let doc = build_new_run_doc(
            "Run name",
            None,
            Some("desc"),
            Some(vec![]),
            Some("tester"),
            true,
        );
        let cleaned = clean_doc_for_yaml(&doc);
        let yaml_val = json_value_to_yaml_preserving_key_order(&cleaned);
        let s = serde_yaml::to_string(&yaml_val).expect("serialize");
        let lines: Vec<&str> = s.lines().collect();
        assert!(
            lines.first().is_some_and(|l| l.starts_with("run_id:")),
            "expected run_id first, got:\n{s}"
        );
        assert!(
            lines.get(1).is_some_and(|l| l.starts_with("title:")),
            "expected title second, got:\n{s}"
        );
    }

    #[test]
    fn run_case_yaml_pins_metadata_key_order() {
        let mut case = Map::new();
        case.insert("comment".to_string(), Value::String("note".to_string()));
        case.insert("result".to_string(), Value::String("pending".to_string()));
        case.insert("title".to_string(), Value::String("My Case".to_string()));
        case.insert(
            "file_path".to_string(),
            Value::String(".gitoza/test/cases/p/s.yaml".to_string()),
        );
        case.insert("case_id".to_string(), Value::String("P1".to_string()));
        case.insert("priority".to_string(), Value::String("high".to_string()));
        case.insert(
            "tags".to_string(),
            Value::Array(vec![
                Value::String("smoke".to_string()),
                Value::String("regression".to_string()),
            ]),
        );
        case.insert(
            "requirement_ids".to_string(),
            Value::Array(vec![Value::String("REQ-42".to_string())]),
        );
        case.insert(
            "picked_at_sha".to_string(),
            Value::String("abc123".to_string()),
        );
        let doc = Value::Object(case);
        let yaml_val = json_value_to_yaml_preserving_key_order(&doc);
        let s = serde_yaml::to_string(&yaml_val).expect("serialize");
        let lines: Vec<&str> = s.lines().collect();
        let idx = |prefix: &str| lines.iter().position(|l| l.starts_with(prefix));
        assert_eq!(idx("file_path:"), Some(0), "got:\n{s}");
        assert_eq!(idx("case_id:"), Some(1), "got:\n{s}");
        assert_eq!(idx("title:"), Some(2), "got:\n{s}");
        assert!(
            idx("priority:").unwrap() < idx("tags:").unwrap(),
            "got:\n{s}"
        );
        assert!(
            idx("tags:").unwrap() < idx("requirement_ids:").unwrap(),
            "got:\n{s}"
        );
        assert!(
            idx("requirement_ids:").unwrap() < idx("picked_at_sha:").unwrap(),
            "got:\n{s}"
        );
    }

    #[test]
    fn run_id_dir_paths_use_fixed_shard_names() {
        let rid = "R-ABC123";
        assert_eq!(
            get_run_dir_rel_path(rid, false),
            ".gitoza/test/runs/R-ABC123"
        );
        assert_eq!(
            get_run_head_rel_path_from_run_id(rid, false),
            ".gitoza/test/runs/R-ABC123/head.yaml"
        );
        assert_eq!(
            get_run_cases_rel_path_from_run_id(rid, false),
            ".gitoza/test/runs/R-ABC123/cases.yaml"
        );
        assert_eq!(
            get_run_results_rel_path_from_run_id(rid, false),
            ".gitoza/test/runs/R-ABC123/results.yaml"
        );
        assert!(is_run_head_rel_path(".gitoza/test/runs/R-ABC123/head.yaml"));
    }

    #[test]
    fn is_allocated_run_id_accepts_r_form() {
        assert!(is_allocated_run_id("R-ABC123"));
        assert!(is_allocated_run_id("R-000000"));
        assert!(!is_allocated_run_id("W-ABC123"));
        assert!(!is_allocated_run_id("R-abc123"));
        assert!(!is_allocated_run_id("R-ABC12"));
        assert!(!is_allocated_run_id("R-ABCDEFG"));
        assert!(!is_allocated_run_id("550e8400-e29b-41d4-a716-446655440000"));
        assert!(!is_allocated_run_id("run-abc"));
    }

    #[test]
    fn build_new_run_doc_emits_allocated_run_id() {
        let doc = build_new_run_doc("Smoke", None, None, Some(vec![]), None, false);
        let rid = get_run_id_from_value(&doc).expect("run_id");
        assert!(is_allocated_run_id(&rid), "got {rid}");
    }

    fn temp_repo(prefix: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        p.push(format!("gitoza_run_id_{prefix}_{t}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn init_test_runs_table(conn: &Connection) {
        conn.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS test_runs (
  run_id TEXT NOT NULL UNIQUE,
  repo_slug TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
"#,
        )
        .unwrap();
    }

    #[test]
    fn generate_unique_run_id_is_allocated() {
        let repo = temp_repo("gen_id");
        let conn = Connection::open_in_memory().unwrap();
        init_test_runs_table(&conn);
        let id = generate_unique_run_id(&conn, "repo", &repo).unwrap();
        assert!(is_allocated_run_id(&id));
        assert!(!run_id_taken_on_disk(&repo, &id));
    }

    #[test]
    fn head_yaml_accepts_free_form_title() {
        let mut doc = build_new_run_doc(
            "[IOS] {smoke} Sprint",
            Some("rid-1"),
            None,
            Some(vec![]),
            None,
            false,
        );
        let cleaned = clean_head_for_yaml(&doc);
        assert_eq!(
            cleaned.get("title").and_then(|v| v.as_str()),
            Some("[IOS] {smoke} Sprint")
        );
        assert!(cleaned.get("cases").is_none());
        let _ = &mut doc;
    }

    #[test]
    fn clean_doc_strips_repo_slug_from_legacy_yaml() {
        let mut m = Map::new();
        m.insert(
            "repo_slug".to_string(),
            Value::String("old-slug".to_string()),
        );
        m.insert("run_id".to_string(), Value::String("rid".to_string()));
        m.insert("run_name".to_string(), Value::String("N".to_string()));
        m.insert("cases".to_string(), Value::Array(vec![]));
        m.insert(
            "summary".to_string(),
            json!({ "total": 0, "passed": 0, "failed": 0, "skipped": 0 }),
        );
        let cleaned = clean_doc_for_yaml(&Value::Object(m));
        assert!(cleaned.get("repo_slug").is_none());
        assert!(cleaned.get("summary").is_none());
        assert_eq!(cleaned.get("run_id").and_then(|v| v.as_str()), Some("rid"));
    }

    #[test]
    fn clean_results_strips_legacy_summary() {
        let doc = json!({
            "run_id": "R-ABC123",
            "summary": { "total": 2, "passed": 1, "failed": 0, "skipped": 0 },
            "results": {
                ".gitoza/test/cases/p/a.yaml": {
                    "result": "passed",
                    "executed_at": "2026-01-01T00:00:00Z"
                }
            }
        });
        let cleaned = clean_results_for_yaml(&doc);
        assert!(cleaned.get("summary").is_none());
        assert_eq!(
            cleaned.get("run_id").and_then(|v| v.as_str()),
            Some("R-ABC123")
        );
        assert!(cleaned
            .get("results")
            .and_then(|v| v.as_object())
            .map(|m| m.contains_key(".gitoza/test/cases/p/a.yaml"))
            .unwrap_or(false));
    }

    #[test]
    fn merge_results_ignores_legacy_summary() {
        let manifest = json!({
            "run_id": "R-1",
            "cases": [{
                "file_path": ".gitoza/test/cases/p/a.yaml",
                "case_id": "a"
            }]
        });
        let results = json!({
            "run_id": "R-1",
            "summary": { "total": 1, "passed": 1, "failed": 0, "skipped": 0 },
            "results": {
                ".gitoza/test/cases/p/a.yaml": {
                    "result": "passed",
                    "executed_at": "2026-01-01T00:00:00Z"
                }
            }
        });
        let merged = merge_results_into_manifest(manifest, Some(&results));
        assert!(merged.get("summary").is_none());
        assert_eq!(
            merged
                .get("cases")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|c| c.get("result"))
                .and_then(|v| v.as_str()),
            Some("passed")
        );
    }
}
